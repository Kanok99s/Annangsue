import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Lang } from "@/lib/lang";

// ---------------------------------------------------------------------------
// Providers (all keyless — no API key required):
//  - MyMemory  https://api.mymemory.translated.net      full-page translation
//  - Jisho     https://jisho.org/api/v1/search/words    dictionary lookups (JMdict)
//  - Tatoeba   https://tatoeba.org/en/api_v0            example sentences
// ---------------------------------------------------------------------------

const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
const JISHO_ENDPOINT = "https://jisho.org/api/v1/search/words";
const TATOEBA_SEARCH = "https://tatoeba.org/en/api_v0/search";
// Microsoft Translator (Azure Cognitive Services). The app runs keyless on
// MyMemory; set MICROSOFT_TRANSLATOR_KEY to get word-aligned translations.
const AZURE_TRANSLATE_ENDPOINT = "https://api.cognitive.microsofttranslator.com/translate";

/** ISO-639-1 codes used by the app (matches MyMemory's language codes 1:1). */
const DirectionSchema = z.string().regex(/^(en|ja|ko|sv)-(en|ja|ko|sv)$/);

const REQUEST_TIMEOUT_MS = 20_000;

// Tatoeba's language codes are ISO-639-3 (jpn/eng/…).
const TATOEBA_LANG = { en: "eng", ja: "jpn" } as const;

/**
 * One Azure alignment projection: an inclusive character range in the source
 * paragraph ([ss, se]) mapped to an inclusive character range in the returned
 * translation ([ts, te]). Both ranges are offsets into the exact strings that
 * were sent to / returned from the API.
 */
export type AlignSpan = { ss: number; se: number; ts: number; te: number };

export type PageTranslation = {
  translation: string;
  /** Per-paragraph alignment (index = paragraph index); null when the
   *  active translation provider has no alignment data. */
  alignment: AlignSpan[][] | null;
};

// Small in-memory caches so re-translating the same page (e.g. after a
// reload + re-drop) or re-tapping a word doesn't burn API quota.
const translateCache = new Map<string, PageTranslation>();
const TRANSLATE_CACHE_MAX = 100;
const lookupCache = new Map<string, WordLookup>();
const LOOKUP_CACHE_MAX = 200;

function withTimeout(ms = REQUEST_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(ms);
}

function cacheGet<V>(map: Map<string, V>, key: string): V | undefined {
  if (!map.has(key)) return undefined;
  const value = map.get(key)!;
  // Refresh recency so hot keys survive eviction.
  map.delete(key);
  map.set(key, value);
  return value;
}

function cachePut<V>(map: Map<string, V>, key: string, value: V, max: number) {
  if (map.size >= max) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

// ---------------------------------------------------------------------------
// MyMemory — full-page translation
// ---------------------------------------------------------------------------

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

/**
 * Split a single paragraph into requests of at most `max` characters.
 * Tries whitespace boundaries first; falls back to character slicing so long
 * unbroken CJK sentences are never rejected.
 */
function chunkParagraph(paragraph: string, max: number): string[] {
  if (paragraph.length <= max) return [paragraph];
  const chunks: string[] = [];
  const tokens = paragraph.match(/\S+\s*/g) ?? [paragraph];
  let buffer = "";
  for (const token of tokens) {
    if (token.length > max) {
      if (buffer) {
        chunks.push(buffer.trim());
        buffer = "";
      }
      for (let i = 0; i < token.length; i += max) {
        chunks.push(token.slice(i, i + max));
      }
      continue;
    }
    if (buffer.length + token.length > max) {
      chunks.push(buffer.trim());
      buffer = token;
    } else {
      buffer += token;
    }
  }
  if (buffer) chunks.push(buffer.trim());
  return chunks;
}

async function myMemoryRequest(q: string, langpair: string): Promise<string> {
  const params = new URLSearchParams({ q, langpair });
  const email = process.env["MYMEMORY_EMAIL"];
  if (email) params.set("de", email);

  let response: Response;
  try {
    response = await fetch(`${MYMEMORY_ENDPOINT}?${params.toString()}`, {
      signal: withTimeout(),
    });
  } catch {
    throw new Error("The translation service could not be reached.");
  }

  if (!response.ok) {
    throw new Error(`The translation service failed (${response.status}).`);
  }

  const data = (await response.json()) as {
    responseStatus?: number;
    responseDetails?: string;
    responseData?: { translatedText?: string };
  };

  if (data.responseStatus !== 200) {
    const detail = data.responseDetails ?? "";
    if (String(data.responseStatus) === "429" || /used all available|quota/i.test(detail)) {
      throw new Error(
        "MyMemory’s free daily translation quota is used up — try again later or set MYMEMORY_EMAIL.",
      );
    }
    if (detail) throw new Error(detail);
    throw new Error("The translation service returned an error.");
  }

  const text = data.responseData?.translatedText?.trim();
  if (!text) throw new Error("The translation service returned an empty result.");
  return text;
}

async function translateWithMyMemory(text: string, from: Lang, to: Lang): Promise<string> {
  const email = process.env["MYMEMORY_EMAIL"];
  // Anonymous free tier caps each request around 500 chars; a registered email
  // raises the per-request ceiling to ~5000. Leave margin for URL encoding.
  const maxChunk = email ? 4000 : 450;
  const langpair = `${from}|${to}`;
  // Japanese/Korean need no spaces between chunks; other languages do.
  const join = from === "ja" || from === "ko" ? "" : " ";

  const paragraphs = splitParagraphs(text);
  const translated: string[] = [];

  for (const paragraph of paragraphs) {
    const chunks = chunkParagraph(paragraph, maxChunk);
    const parts: string[] = [];
    for (const chunk of chunks) {
      parts.push(await myMemoryRequest(chunk, langpair));
    }
    translated.push(parts.join(join));
  }

  return translated.join("\n\n");
}

// ---------------------------------------------------------------------------
// Jisho — dictionary lookup
// ---------------------------------------------------------------------------
//
// Jisho serves JMdict through a stable, keyless JSON API with a single request
// shape, so each lookup is exactly one GET (no payload probing needed). A
// tapped word may be Japanese (we want its English senses) or English (we want
// the Japanese headword whose glosses contain it) — both are keyword searches.

type JishoForm = { word: string; reading: string };
type DictEntry = {
  forms: JishoForm[];
  common: boolean;
  english: string[];
  partsOfSpeech: string[];
};

function toStr(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return toStr(value[0]);
  return "";
}

function strArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "string" ? v : toStr(v))).filter(Boolean);
  }
  if (typeof value === "string" && value) return [value];
  return [];
}

/** Normalize one /api/v1/search/words response body into headword entries. */
function parseJishoResults(data: unknown): DictEntry[] {
  if (!Array.isArray(data)) return [];
  const entries: DictEntry[] = [];

  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const result = raw as { is_common?: unknown; japanese?: unknown; senses?: unknown };

    const forms: JishoForm[] = [];
    if (Array.isArray(result.japanese)) {
      for (const form of result.japanese) {
        if (!form || typeof form !== "object") continue;
        const f = form as { word?: unknown; reading?: unknown };
        const word = typeof f.word === "string" ? f.word : "";
        const reading = typeof f.reading === "string" ? f.reading : "";
        if (word || reading) forms.push({ word, reading });
      }
    }
    if (forms.length === 0) continue;

    const english: string[] = [];
    const partsOfSpeech: string[] = [];
    if (Array.isArray(result.senses)) {
      for (const sense of result.senses) {
        if (!sense || typeof sense !== "object") continue;
        const s = sense as { english_definitions?: unknown; parts_of_speech?: unknown };
        for (const def of strArray(s.english_definitions)) {
          if (!english.includes(def)) english.push(def);
        }
        for (const pos of strArray(s.parts_of_speech)) {
          if (!partsOfSpeech.includes(pos)) partsOfSpeech.push(pos);
        }
      }
    }
    if (english.length === 0) continue; // a hit with no English gloss is useless

    entries.push({ forms, common: result.is_common === true, english, partsOfSpeech });
  }
  return entries;
}

async function jishoSearch(search: string): Promise<DictEntry[]> {
  let response: Response;
  try {
    response = await fetch(`${JISHO_ENDPOINT}?${new URLSearchParams({ keyword: search })}`, {
      headers: { Accept: "application/json" },
      signal: withTimeout(),
    });
  } catch {
    throw new Error("The dictionary service could not be reached.");
  }

  if (response.status === 429) {
    throw new Error("The dictionary is rate-limiting requests — wait a moment and tap again.");
  }
  if (!response.ok) {
    throw new Error(`The dictionary service failed (${response.status}).`);
  }

  const payload = (await response.json().catch(() => null)) as
    | { meta?: { status?: unknown }; data?: unknown }
    | null;
  if (!payload || payload.meta?.status !== 200) {
    throw new Error("The dictionary service returned an unexpected response.");
  }
  return parseJishoResults(payload.data);
}

function termOf(entry: DictEntry): string {
  return entry.forms.find((f) => f.word)?.word ?? entry.forms[0]?.reading ?? "";
}

function readingOf(entry: DictEntry): string {
  return entry.forms.find((f) => f.reading)?.reading ?? "";
}

function partOfSpeechOf(entry: DictEntry): string {
  return entry.partsOfSpeech[0] ?? "";
}

function joinMeaning(entry: DictEntry): string {
  let meaning = "";
  for (const def of entry.english) {
    const next = meaning ? `${meaning}, ${def}` : def;
    if (next.length > 300) break;
    meaning = next;
  }
  return meaning;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Score how strongly an English tap matches an entry’s glosses. */
function scoreEnglishMatch(entry: DictEntry, query: string): number {
  const re = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(query)}([^\\p{L}\\p{N}]|$)`,
    "iu",
  );
  let best = 0;
  for (const def of entry.english) {
    if (re.test(def)) {
      const atStart = new RegExp(`^${escapeRegExp(query)}([^\\p{L}\\p{N}]|$)`, "iu").test(def);
      best = Math.max(best, atStart ? 2 : 1);
    }
  }
  return best;
}

function commonFirst(entries: DictEntry[]): DictEntry | undefined {
  return entries.find((e) => e.common) ?? entries[0];
}

/** Prefer the entry that is exactly the tapped Japanese word (then reading). */
function pickJapaneseWord(entries: DictEntry[], query: string): DictEntry | undefined {
  const byTerm: DictEntry[] = [];
  const byReading: DictEntry[] = [];
  for (const entry of entries) {
    if (entry.forms.some((f) => f.word === query)) byTerm.push(entry);
    else if (entry.forms.some((f) => f.reading === query)) byReading.push(entry);
  }
  if (byTerm.length > 0) return commonFirst(byTerm);
  if (byReading.length > 0) return commonFirst(byReading);

  // No exact headword came back — Jisho still lists compounds containing the
  // query, so prefer the closest headword over an arbitrary first hit.
  const closest = entries.find(
    (e) => termOf(e).startsWith(query) || readingOf(e).startsWith(query),
  );
  return closest ?? commonFirst(entries);
}

/** For an English tap, find the Japanese headword whose glosses contain it. */
function pickEnglishWord(entries: DictEntry[], query: string): DictEntry | undefined {
  const scored = entries
    .map((entry) => ({ entry, score: scoreEnglishMatch(entry, query) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      const commonDiff = Number(b.entry.common) - Number(a.entry.common);
      return commonDiff !== 0 ? commonDiff : b.score - a.score;
    });
  return scored[0]?.entry;
}

// ---------------------------------------------------------------------------
// Tatoeba — example sentences
// ---------------------------------------------------------------------------

type TatoebaHit = {
  text?: string;
  translations?: { text?: string; lang?: string }[];
};

async function tatoebaExample(queries: string[]): Promise<{ example: string; exampleTranslation: string }> {
  for (const query of queries) {
    if (!query) continue;
    try {
      const params = new URLSearchParams({
        from: TATOEBA_LANG.ja,
        to: TATOEBA_LANG.en,
        query,
        sort: "relevance",
        limit: "5",
        orphans: "no",
        unapproved: "no",
      });
      const response = await fetch(`${TATOEBA_SEARCH}?${params.toString()}`, {
        signal: withTimeout(10_000),
      });
      if (!response.ok) continue;
      const data = (await response.json()) as { results?: unknown };
      if (!Array.isArray(data.results)) continue;
      for (const hit of data.results as TatoebaHit[]) {
        const text = typeof hit.text === "string" ? hit.text.trim() : "";
        if (!text || !text.includes(query)) continue;
        const translation = (hit.translations ?? []).find((t) =>
          typeof t.lang === "string" && t.lang.startsWith(TATOEBA_LANG.en),
        );
        const translationText = translation?.text?.trim() ?? "";
        if (translationText) {
          return { example: text, exampleTranslation: translationText };
        }
      }
    } catch {
      // A missing example sentence must never fail the whole lookup.
    }
  }
  return { example: "", exampleTranslation: "" };
}

// ---------------------------------------------------------------------------
// Script detection
// ---------------------------------------------------------------------------

const JP_SCRIPT = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/;
const LATIN_SCRIPT = /[A-Za-z]/;

function isJapaneseText(text: string): boolean {
  return JP_SCRIPT.test(text);
}

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Microsoft Translator — page translation with word alignment
// ---------------------------------------------------------------------------
//
// Used when MICROSOFT_TRANSLATOR_KEY is set. Each request element is one source
// paragraph, sent verbatim (natural spacing — CJK included) so that Azure's
// "proj" character ranges line up exactly with the text the client renders and
// tokenizes. Azure emits one projection per aligned fragment:
//   "0:0-0:2 4:6-27:29"  →  source chars [0,0] ↔ target chars [0,2],
//                           source chars [4,6] ↔ target chars [27,29]
// (both ranges inclusive).

/** Parse Azure's proj alignment string into source→target character ranges. */
function parseAlignmentProj(proj: unknown): AlignSpan[] {
  if (typeof proj !== "string") return [];
  const spans: AlignSpan[] = [];
  for (const part of proj.split(/[\s,]+/)) {
    const match = /^(\d+):(\d+)-(\d+):(\d+)$/.exec(part);
    if (!match) continue;
    spans.push({
      ss: Number(match[1]),
      se: Number(match[2]),
      ts: Number(match[3]),
      te: Number(match[4]),
    });
  }
  return spans;
}

async function translateWithMicrosoft(
  paragraphs: string[],
  from: Lang,
  to: Lang,
): Promise<{ parts: string[]; alignment: AlignSpan[][] }> {
  const key = process.env["MICROSOFT_TRANSLATOR_KEY"] ?? "";
  const region = process.env["MICROSOFT_TRANSLATOR_REGION"] ?? "";
  const params = new URLSearchParams({
    "api-version": "3.0",
    from,
    to,
    includeAlignment: "true",
  });

  let response: Response;
  try {
    response = await fetch(`${AZURE_TRANSLATE_ENDPOINT}?${params.toString()}`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/json",
        ...(region ? { "Ocp-Apim-Subscription-Region": region } : {}),
      },
      body: JSON.stringify(paragraphs.map((text) => ({ Text: text }))),
      signal: withTimeout(30_000),
    });
  } catch {
    throw new Error("The translation service could not be reached.");
  }

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Microsoft Translator rejected the API key — check MICROSOFT_TRANSLATOR_KEY" +
          (region ? " and MICROSOFT_TRANSLATOR_REGION" : "") +
          ".",
      );
    }
    throw new Error(
      detail?.error?.message ??
        `The translation service failed (${response.status}).`,
    );
  }

  const results = (await response.json().catch(() => null)) as
    | { translations?: { text?: unknown; alignment?: { proj?: unknown } }[] }[]
    | null;
  if (!Array.isArray(results) || results.length !== paragraphs.length) {
    throw new Error("The translation service returned an unexpected response.");
  }

  const parts: string[] = [];
  const alignment: AlignSpan[][] = [];
  for (const result of results) {
    const translation = result?.translations?.[0];
    const text = typeof translation?.text === "string" ? translation.text : "";
    if (!text) throw new Error("The translation service returned an empty result.");
    parts.push(text);
    alignment.push(parseAlignmentProj(translation?.alignment?.proj));
  }
  return { parts, alignment };
}

/** Translate a whole page of text, preserving blank-line paragraph breaks. */
export const translatePage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        text: z.string().min(1).max(6000),
        direction: DirectionSchema,
        // Per-paragraph source text, sent to Azure verbatim so its alignment
        // character offsets match the strings the client renders. Each element
        // corresponds 1:1 to a paragraph in `text`.
        paragraphs: z
          .array(z.string().min(1).max(6000))
          .min(1)
          .max(200)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const [source, target] = data.direction.split("-") as [Lang, Lang];
    const cacheKey = `${data.direction}\u0000${data.text}`;
    const cached = cacheGet(translateCache, cacheKey);
    if (cached !== undefined) return cached;

    const hasMicrosoftKey = Boolean(process.env["MICROSOFT_TRANSLATOR_KEY"]);

    if (!hasMicrosoftKey) {
      const result: PageTranslation = {
        translation: await translateWithMyMemory(data.text, source, target),
        alignment: null,
      };
      cachePut(translateCache, cacheKey, result, TRANSLATE_CACHE_MAX);
      return result;
    }

    // Callers normally send pre-split paragraphs (verbatim) so Azure's offsets
    // line up with what they render; fall back to a plain split otherwise.
    const paragraphs =
      data.paragraphs && data.paragraphs.length > 0
        ? data.paragraphs
        : data.text
            .split(/\n{2,}/)
            .map((p) => p.trim())
            .filter(Boolean);

    const { parts, alignment } = await translateWithMicrosoft(paragraphs, source, target);
    const result: PageTranslation = {
      translation: parts.join("\n\n"),
      alignment,
    };
    cachePut(translateCache, cacheKey, result, TRANSLATE_CACHE_MAX);
    return result;
  });

const LookupSchema = z.object({
  term: z.string(),
  reading: z.string(),
  meaning: z.string(),
  partOfSpeech: z.string(),
  example: z.string(),
  exampleTranslation: z.string(),
});

export type WordLookup = z.infer<typeof LookupSchema>;

/** Look up a single tapped word. Returns a Japanese headword with English gloss. */
export const lookupWord = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        word: z.string().min(1).max(80),
        context: z.string().max(1200).default(""),
        direction: DirectionSchema,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const word = data.word.trim();
    if (!word) throw new Error("No word was selected.");

    const japanese = isJapaneseText(word);
    const latin = !japanese && LATIN_SCRIPT.test(word);
    if (!japanese && !latin) {
      throw new Error("Lookups currently support English and Japanese words only.");
    }

    const cacheKey = `${japanese ? "ja" : "en"}\u0000${word.toLowerCase()}`;
    const cached = cacheGet(lookupCache, cacheKey);
    if (cached !== undefined) return cached;

    const results = await jishoSearch(word);
    const entry = japanese ? pickJapaneseWord(results, word) : pickEnglishWord(results, word);

    if (!entry) {
      throw new Error(`No dictionary entry found for “${word}”.`);
    }

    const term = termOf(entry) || word;
    const reading = readingOf(entry);
    const meaning = joinMeaning(entry);
    if (!meaning) throw new Error(`No dictionary entry found for “${word}”.`);

    const { example, exampleTranslation } = await tatoebaExample([
      term,
      reading,
      japanese ? word : "",
    ]);

    const lookup: WordLookup = {
      term,
      reading,
      meaning,
      partOfSpeech: partOfSpeechOf(entry),
      example,
      exampleTranslation,
    };

    cachePut(lookupCache, cacheKey, lookup, LOOKUP_CACHE_MAX);
    return lookup;
  });
