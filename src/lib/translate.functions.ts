import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Lang } from "@/lib/lang";

// ---------------------------------------------------------------------------
// Providers (all keyless — no API key required):
//  - MyMemory  https://api.mymemory.translated.net  full-page translation
//  - Jotoba    https://jotoba.de/api/search/words    dictionary lookups (JMdict)
//  - Tatoeba   https://tatoeba.org/en/api_v0          example sentences
// ---------------------------------------------------------------------------

const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
const JOTOBA_ENDPOINT = "https://jotoba.de/api/search/words";
const TATOEBA_SEARCH = "https://tatoeba.org/en/api_v0/search";

/** ISO-639-1 codes used by the app (matches MyMemory's language codes 1:1). */
const DirectionSchema = z.string().regex(/^(en|ja|ko|sv)-(en|ja|ko|sv)$/);

const REQUEST_TIMEOUT_MS = 20_000;

// Tatoeba's language codes are ISO-639-3 (jpn/eng/…).
const TATOEBA_LANG = { en: "eng", ja: "jpn" } as const;

// Small in-memory caches so re-translating the same page (e.g. after a
// reload + re-drop) or re-tapping a word doesn't burn API quota.
const translateCache = new Map<string, string>();
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
// Jotoba — dictionary lookup
// ---------------------------------------------------------------------------

type JotobaWord = {
  reading?: { kanji?: unknown; kana?: unknown; word?: unknown };
  common?: boolean;
  is_common?: boolean;
  senses?: { english?: unknown; part_of_speech?: unknown }[];
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

async function jotobaSearch(search: string, language: "Japanese" | "English"): Promise<JotobaWord[]> {
  let response: Response;
  try {
    response = await fetch(JOTOBA_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: { search, language },
        no_english: false,
      }),
      signal: withTimeout(),
    });
  } catch {
    throw new Error("The dictionary service could not be reached.");
  }

  if (!response.ok) throw new Error(`The dictionary service failed (${response.status}).`);

  const data = (await response.json()) as { words?: unknown };
  if (!Array.isArray(data.words)) return [];
  return data.words.filter((w): w is JotobaWord => !!w && typeof w === "object");
}

function termOf(word: JotobaWord): string {
  return toStr(word.reading?.kanji) || toStr(word.reading?.word) || toStr(word.reading?.kana);
}

function readingOf(word: JotobaWord): string {
  return toStr(word.reading?.kana);
}

function englishSenses(word: JotobaWord): string[] {
  const defs: string[] = [];
  for (const sense of word.senses ?? []) {
    defs.push(...strArray(sense.english));
  }
  return defs;
}

function partOfSpeechOf(word: JotobaWord): string {
  const pos = word.senses?.[0]?.part_of_speech;
  return strArray(pos)[0] ?? "";
}

function joinMeaning(word: JotobaWord): string {
  const defs = englishSenses(word);
  let meaning = "";
  for (const def of defs) {
    const next = meaning ? `${meaning}, ${def}` : def;
    if (next.length > 300) break;
    meaning = next;
  }
  return meaning;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Score how strongly an English tap matches a Jotoba word’s glosses. */
function scoreEnglishMatch(word: JotobaWord, query: string): number {
  const re = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(query)}([^\\p{L}\\p{N}]|$)`,
    "iu",
  );
  let best = 0;
  for (const def of englishSenses(word)) {
    if (re.test(def)) {
      const atStart = new RegExp(`^${escapeRegExp(query)}([^\\p{L}\\p{N}]|$)`, "iu").test(def);
      best = Math.max(best, atStart ? 2 : 1);
    }
  }
  return best;
}

function pickJapaneseWord(words: JotobaWord[], query: string): JotobaWord | undefined {
  let exact: JotobaWord | undefined;
  let exactKana: JotobaWord | undefined;
  for (const word of words) {
    const term = termOf(word);
    if (term === query) {
      if (!exact) exact = word;
      continue;
    }
    if (!exact && readingOf(word) === query && !exactKana) exactKana = word;
  }
  if (exact || exactKana) {
    const candidate = exact ?? exactKana!;
    const common = words.find(
      (w) => termOf(w) === termOf(candidate) && (w.common || w.is_common),
    );
    return common ?? candidate;
  }
  return (
    words.find((w) => w.common || w.is_common) ?? words.find((w) => termOf(w) === query) ?? words[0]
  );
}

function pickEnglishWord(words: JotobaWord[], query: string): JotobaWord | undefined {
  const scored = words
    .map((word) => ({ word, score: scoreEnglishMatch(word, query) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      const commonDiff =
        Number(b.word.common || b.word.is_common) - Number(a.word.common || a.word.is_common);
      return commonDiff !== 0 ? commonDiff : b.score - a.score;
    });
  return scored[0]?.word;
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

/** Translate a full page of text, preserving blank-line paragraph breaks. */
export const translatePage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ text: z.string().min(1).max(6000), direction: DirectionSchema }).parse(input),
  )
  .handler(async ({ data }) => {
    const [source, target] = data.direction.split("-") as [Lang, Lang];
    const cacheKey = `${data.direction}\u0000${data.text}`;
    const cached = cacheGet(translateCache, cacheKey);
    if (cached !== undefined) return { translation: cached };

    const translation = await translateWithMyMemory(data.text, source, target);
    cachePut(translateCache, cacheKey, translation, TRANSLATE_CACHE_MAX);
    return { translation };
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

    const results = await jotobaSearch(word, japanese ? "Japanese" : "English");
    const entry = japanese
      ? pickJapaneseWord(results, word)
      : pickEnglishWord(results, word);

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
