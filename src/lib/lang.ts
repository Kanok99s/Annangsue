export type Lang = "en" | "ja" | "ko" | "sv";

/** direction is always "<source>-<target>" */
export type Direction = `${Lang}-${Lang}`;

export const LANGS: { code: Lang; label: string; native: string; speech: string }[] = [
  { code: "en", label: "English", native: "English", speech: "en-US" },
  { code: "ja", label: "Japanese", native: "日本語", speech: "ja-JP" },
  { code: "ko", label: "Korean", native: "한국어", speech: "ko-KR" },
  { code: "sv", label: "Swedish", native: "Svenska", speech: "sv-SE" },
];

export const LANG_CODES = LANGS.map((l) => l.code);

export function splitDirection(direction: Direction): { source: Lang; target: Lang } {
  const [source, target] = direction.split("-") as [Lang, Lang];
  return { source, target };
}

export function langLabel(code: Lang): string {
  return LANGS.find((l) => l.code === code)?.label ?? code;
}

export function speechLang(code: Lang): string {
  return LANGS.find((l) => l.code === code)?.speech ?? "en-US";
}

/** Languages written without spaces between words. */
export function isScriptual(code: Lang): boolean {
  return code === "ja";
}

/** Font class for rendering a language's text. */
export function fontClass(code: Lang): string {
  if (code === "ja" || code === "ko") return "font-jp leading-[2.1]";
  return "font-serif leading-[1.95]";
}

export type Token = { text: string; word: boolean };

const JP = "\\u4e00-\\u9faf\\u3040-\\u309f\\u30a0-\\u30ff";
const KO = "\\uac00-\\ud7a3\\u1100-\\u11ff\\u3130-\\u318f";
const LATIN = "A-Za-zÀ-ÖØ-öø-ÿ'’\\-";

/** Split text so that EVERY word is individually selectable. */
export function tokenize(text: string, lang: Lang): Token[] {
  if (lang === "ja") {
    const re = new RegExp(`[${JP}]+|[^${JP}]+`, "g");
    return (text.match(re) ?? []).map((p) => ({
      text: p,
      word: new RegExp(`[${JP}]`).test(p),
    }));
  }
  if (lang === "ko") {
    const re = new RegExp(`[${KO}]+|[^${KO}]+`, "g");
    return (text.match(re) ?? []).map((p) => ({
      text: p,
      word: new RegExp(`[${KO}]`).test(p),
    }));
  }
  const re = new RegExp(`[${LATIN}]+|[^${LATIN}]+`, "g");
  return (text.match(re) ?? []).map((p) => ({
    text: p,
    word: /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(p),
  }));
}
