import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";
const MODEL = "openai/gpt-5.6-sol";

const DirectionSchema = z.enum(["en-ja", "ja-en"]);

async function callGateway(instructions: string, input: string): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured for this app.");

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
    },
    body: JSON.stringify({
      model: MODEL,
      instructions,
      input,
      stream: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try {
      message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body;
    } catch {
      /* keep raw body */
    }
    if (res.status === 429) throw new Error("Too many requests right now — try again shortly.");
    if (res.status === 402) throw new Error(message || "AI credits are exhausted for this app.");
    if (res.status === 403) throw new Error(message || "AI access is blocked for this workspace.");
    throw new Error(message || `Translation failed (${res.status}).`);
  }

  const data = (await res.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  const text =
    data.output
      ?.flatMap((item) => item.content ?? [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text ?? "")
      .join("") ?? "";
  return text;
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

/** Translate a full page of text, preserving paragraph breaks. */
export const translatePage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ text: z.string().min(1).max(6000), direction: DirectionSchema }).parse(input),
  )
  .handler(async ({ data }) => {
    const target = data.direction === "en-ja" ? "Japanese" : "English";
    const instructions = `You are a literary translator. Translate the user's text into natural, fluent ${target}.
Preserve the paragraph structure exactly (same number of paragraphs, separated by blank lines).
Return ONLY the translation, with no commentary, notes or quotation marks.`;
    const translation = await callGateway(instructions, data.text);
    return { translation: translation.trim() };
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

/** Look up a single tapped word in the context of its sentence. */
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
    const sourceIsEnglish = data.direction === "en-ja";
    const instructions = `You are a bilingual English–Japanese dictionary for language learners.
The learner tapped a word in a ${sourceIsEnglish ? "English" : "Japanese"} text.
Reply with ONLY a JSON object, no code fences, using exactly these keys:
{"term": "the Japanese form (kanji where natural)",
 "reading": "hiragana reading, or romaji for an English headword",
 "meaning": "short English meaning",
 "partOfSpeech": "noun | verb | adjective | ...",
 "example": "a short Japanese example sentence using the term",
 "exampleTranslation": "English translation of the example"}
Base the sense on how the word is used in the provided context.`;
    const raw = await callGateway(
      instructions,
      `Word: ${data.word}\nContext: ${data.context}`,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(raw));
    } catch {
      throw new Error("Could not read the dictionary response. Please try again.");
    }
    return LookupSchema.parse(parsed);
  });
