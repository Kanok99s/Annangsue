import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Header, type Direction } from "@/components/Header";
import { contentHash, parseEpub } from "@/lib/epub";
import {
  lookupExample,
  lookupWord,
  translatePage,
  type AlignSpan,
  type WordLookup,
} from "@/lib/translate.functions";
import {
  addBook,
  addWord,
  openBook,
  removeBookKeepList,
  speak,
  useVocab,
  type StoredBook,
} from "@/lib/vocab";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Annangsue — Read EPUBs in English and Japanese" },
      {
        name: "description",
        content:
          "Upload an EPUB and read it side by side with a full Japanese or English translation. Tap any word to save it and study kanji, meaning and pronunciation.",
      },
      { property: "og:title", content: "Annangsue — Bilingual EPUB Reader" },
      {
        property: "og:description",
        content:
          "Side-by-side EPUB reading in English and Japanese, with tap-to-save vocabulary and kanji, recognition and listening drills.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReaderPage,
});

type Token = { text: string; word: boolean };

// Japanese text has no spaces, so character-class chunking collapses whole
// sentences into a single tappable unit. Use the runtime's dictionary-backed
// Intl.Segmenter (browser/Node full-ICU) to split into real words. The reading
// text is only tokenized in the browser after a book loads, so this never runs
// during SSR/hydration.
type IntlSegment = { segment: string; isWordLike: boolean };

const getJapaneseSegmenter = () => {
  const Ctor = (Intl as unknown as {
    Segmenter?: new (locales?: string, options?: { granularity?: "word" }) => {
      segment(input: string): Iterable<IntlSegment>;
    };
  }).Segmenter;
  if (typeof Ctor !== "function") return null;
  try {
    return new Ctor("ja", { granularity: "word" });
  } catch {
    return null;
  }
};

const jaSegmenter = getJapaneseSegmenter();

// Grammatical particles/auxiliaries resolve to nothing useful in a dictionary
// lookup — keep them rendered for the reading flow but not tappable.
const JA_FUNCTION_WORDS = new Set([
  "は", "が", "を", "に", "へ", "と", "も", "の", "や", "か", "ね", "よ", "わ", "ぞ", "で", "だ",
  "です", "ます", "では", "には", "とは", "でも", "にも", "から", "まで", "より", "など", "だけ",
  "しか", "ほど", "くらい", "ぐらい", "ばかり", "こそ", "さえ", "ながら", "けれど", "けど",
  "ので", "のに", "ば", "たら", "って", "な", "ぜ", "て",
]);

const JP_CHARS = "\\u4e00-\\u9faf\\u3040-\\u309f\\u30a0-\\u30ff";
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

function tokenizeJapanese(text: string): Token[] {
  if (jaSegmenter) {
    const tokens: Token[] = [];
    for (const { segment, isWordLike } of jaSegmenter.segment(text)) {
      if (!segment) continue;
      // Spaces/punctuation come back as non-word-like segments; keep them as
      // plain text so the paragraph reflows exactly as before.
      const tappable = isWordLike && !JA_FUNCTION_WORDS.has(segment) && HAS_LETTER_OR_DIGIT.test(segment);
      tokens.push({ text: segment, word: tappable });
    }
    return tokens;
  }
  // Fallback for runtimes without Intl.Segmenter: split script runs so kanji
  // and kana blocks at least become individually tappable units.
  const re = new RegExp(`[${JP_CHARS}]+|[^${JP_CHARS}]+`, "g");
  return (text.match(re) ?? []).map((p) => ({
    text: p,
    word: new RegExp(`[${JP_CHARS}]`).test(p),
  }));
}

function tokenize(text: string, japanese: boolean): Token[] {
  if (japanese) return tokenizeJapanese(text);
  // Alphabet- and space-separated text (English, Swedish, Korean): every
  // letter run — including 1–2 letter words — is its own tappable token.
  return (text.match(/[\p{L}'’-]+|[^\p{L}'’-]+/gu) ?? []).map((p) => ({
    text: p,
    word: /[\p{L}]/u.test(p),
  }));
}

/** Non-blank paragraphs, used to keep source/target panes and alignment in lock-step. */
function paragraphTexts(text: string): string[] {
  return text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
}

type AlignedToken = Token & { start: number; end: number };

/** Tokenize a paragraph and annotate each token with its character range. */
function tokenizeWithRanges(text: string, japanese: boolean): AlignedToken[] {
  const tokens = tokenize(text, japanese);
  let offset = 0;
  return tokens.map((token) => {
    const start = offset;
    offset += token.text.length;
    return { ...token, start, end: offset };
  });
}

type ParaTokens = { text: string; tokens: AlignedToken[] };

/** Pre-tokenize a page's paragraphs into character-ranged tokens. */
function tokenizeParagraphs(text: string, japanese: boolean): ParaTokens[] {
  return paragraphTexts(text).map((paragraph) => ({
    text: paragraph,
    tokens: tokenizeWithRanges(paragraph, japanese),
  }));
}

/** True when token range [start, end) intersects inclusive span range [lo, hi]. */
function spanHits(start: number, end: number, lo: number, hi: number): boolean {
  return start <= hi && end - 1 >= lo;
}

function ReaderPage() {
  const [direction, setDirection] = useState<Direction>("ja-en");
  const [book, setBook] = useState<StoredBook | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [translation, setTranslation] = useState("");
  const [alignment, setAlignment] = useState<AlignSpan[][] | null>(null);
  const [translating, setTranslating] = useState(false);
  const [hover, setHover] = useState<{ side: "src" | "tgt"; para: number; token: number } | null>(
    null,
  );
  const [selected, setSelected] = useState<{
    word: string;
    data?: WordLookup;
    loading: boolean;
    exampleLoading: boolean;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const { books, wordCounts, savedTerms, totalCount } = useVocab();
  const doTranslate = useServerFn(translatePage);
  const doLookup = useServerFn(lookupWord);
  const doExample = useServerFn(lookupExample);

  const page = book?.pages[pageIndex];
  const sourceIsJapanese = direction === "ja-en";

  // Character-ranged token streams for both panes. Azure alignment spans use
  // the same character offsets, so ranges here map directly onto them.
  const srcParas = useMemo(
    () => (page ? tokenizeParagraphs(page.text, sourceIsJapanese) : []),
    [page, sourceIsJapanese],
  );
  const tgtParas = useMemo(
    () => (translation ? tokenizeParagraphs(translation, !sourceIsJapanese) : []),
    [translation, sourceIsJapanese],
  );

  // Cross-pane highlights: a hovered token in one pane marks its equivalent
  // token(s) in the other pane using the Azure alignment ranges.
  const highlight = useMemo(() => {
    const src = new Map<number, Set<number>>();
    const tgt = new Map<number, Set<number>>();
    if (!hover || !alignment) return { src, tgt };

    const { side, para, token } = hover;
    const source = srcParas[para];
    const target = tgtParas[para];
    const spans = alignment[para];
    if (!source || !target || !spans) return { src, tgt };

    const mark = (map: Map<number, Set<number>>, t: number) => {
      let set = map.get(para);
      if (!set) {
        set = new Set();
        map.set(para, set);
      }
      set.add(t);
    };

    if (side === "src") {
      // Hovered source token self-highlights, plus every target token covered
      // by the spans that include the hovered source characters.
      const range = source.tokens[token];
      if (!range) return { src, tgt };
      mark(src, token);
      for (const span of spans) {
        if (!spanHits(range.start, range.end, span.ss, span.se)) continue;
        target.tokens.forEach((t, i) => {
          if (spanHits(t.start, t.end, span.ts, span.te)) mark(tgt, i);
        });
      }
      return { src, tgt };
    }

    // Mirror image for a hovered translation token.
    const range = target.tokens[token];
    if (!range) return { src, tgt };
    mark(tgt, token);
    for (const span of spans) {
      if (!spanHits(range.start, range.end, span.ts, span.te)) continue;
      source.tokens.forEach((s, i) => {
        if (spanHits(s.start, s.end, span.ss, span.se)) mark(src, i);
      });
    }
    return { src, tgt };
  }, [hover, alignment, srcParas, tgtParas]);

  const translateCurrent = useCallback(
    async (text: string, dir: Direction) => {
      // Send paragraphs verbatim (same strings the panes render) so Azure's
      // alignment character offsets map 1:1 onto the rendered text.
      const paragraphs = paragraphTexts(text);
      setTranslating(true);
      setTranslation("");
      setAlignment(null);
      setHover(null);
      try {
        const res = await doTranslate({ data: { text, direction: dir, paragraphs } });
        setTranslation(res.translation);
        setAlignment(res.alignment);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Translation failed.");
      } finally {
        setTranslating(false);
      }
    },
    [doTranslate],
  );

  const goToPage = useCallback(
    (index: number, loaded = book) => {
      if (!loaded) return;
      const clamped = Math.max(0, Math.min(index, loaded.pages.length - 1));
      setPageIndex(clamped);
      setSelected(null);
      const target = loaded.pages[clamped];
      if (target) void translateCurrent(target.text, direction);
    },
    [book, direction, translateCurrent],
  );

  const onUpload = useCallback(
    async (file: File) => {
      try {
        const parsed = await parseEpub(file);
        // Same bytes => same id, so re-uploading merges into the same book &
        // list instead of duplicating.
        const id = await contentHash(file, file.name);
        const stored: StoredBook = {
          ...parsed,
          id,
          uploadedAt: Date.now(),
          lastOpenedAt: Date.now(),
        };
        await addBook(stored);
        setBook(stored);
        setPageIndex(0);
        setSelected(null);
        toast.success(`Loaded “${stored.title}” · ${stored.pages.length} pages`);
        const first = stored.pages[0];
        if (first) void translateCurrent(first.text, direction);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not read that EPUB.");
      }
    },
    [direction, translateCurrent],
  );

  /** Reopen a book from the on-device library. */
  const reopen = useCallback(
    async (id: string) => {
      const stored = await openBook(id);
      if (!stored) {
        toast.error("That book is no longer in your library.");
        return;
      }
      setBook(stored);
      setPageIndex(0);
      setSelected(null);
      setTranslation("");
      setAlignment(null);
      setHover(null);
      const first = stored.pages[0];
      if (first) void translateCurrent(first.text, direction);
    },
    [direction, translateCurrent],
  );

  /** Close the reader back to the library grid (nothing is lost). */
  const closeBook = useCallback(() => {
    setBook(null);
    setPageIndex(0);
    setSelected(null);
    setTranslation("");
    setAlignment(null);
    setHover(null);
  }, []);

  /** Remove only the library entry — saved words for the book are kept. */
  const removeFromLibrary = useCallback(
    async (id: string, title: string) => {
      const confirmed = window.confirm(
        `Remove “${title}” from your library?\n\nIts saved word list will be kept — you can reconnect them by uploading the same file again.`,
      );
      if (!confirmed) return;
      await removeBookKeepList(id);
      toast.success("Removed from your library — its saved words are kept.");
    },
    [],
  );

  // Accept an EPUB dropped anywhere on the page, not just via the file picker.
  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = Array.from(e.dataTransfer?.files ?? []).find(
        (f) => f.name.toLowerCase().endsWith(".epub") || f.type === "application/epub+zip",
      );
      if (file) {
        void onUpload(file);
      } else if ((e.dataTransfer?.files.length ?? 0) > 0) {
        toast.error("That doesn’t look like an EPUB — drop a .epub file instead.");
      }
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [onUpload]);

  const onDirectionChange = (d: Direction) => {
    setDirection(d);
    if (page) void translateCurrent(page.text, d);
  };

  const onWordClick = async (word: string, context: string) => {
    const clean = word.replace(/[^\p{L}\p{N}'-]/gu, "");
    if (!clean) return;
    setSelected({ word: clean, loading: true, exampleLoading: false });
    speak(clean, sourceIsJapanese ? "ja-JP" : "en-US");
    try {
      // Dictionary card first — meaning, reading and part of speech appear as
      // soon as Jisho answers, without waiting on the slower example search.
      const data = await doLookup({ data: { word: clean, context, direction } });
      setSelected((prev) =>
        prev?.word === clean
          ? { word: clean, data, loading: false, exampleLoading: true }
          : prev,
      );
      try {
        const example = await doExample({
          data: { term: data.term, reading: data.reading, word: clean },
        });
        setSelected((prev) =>
          prev?.word === clean && prev.data?.term === data.term
            ? { ...prev, data: { ...prev.data, ...example }, exampleLoading: false }
            : prev,
        );
      } catch {
        setSelected((prev) =>
          prev?.word === clean ? { ...prev, exampleLoading: false } : prev,
        );
      }
    } catch (error) {
      setSelected((prev) => (prev?.word === clean ? null : prev));
      toast.error(error instanceof Error ? error.message : "Lookup failed.");
    }
  };

  const saveSelected = async () => {
    if (!selected?.data || !book) return;
    const ok = await addWord(
      book.id,
      book,
      { ...selected.data, source: book.title },
    );
    toast[ok ? "success" : "info"](
      ok ? `Saved ${selected.data.term} to “${book.title}”` : "Already in this book’s list",
    );
    setSelected(null);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header direction={direction} onDirectionChange={onDirectionChange} />

      <div className="mx-auto max-w-[1240px] px-6 pt-14 pb-8 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <div className="mb-4 flex items-center gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-accent">
                {book ? page?.chapter?.slice(0, 40) || "Reading" : "Start here"}
              </span>
              <span className="h-px w-8 bg-foreground/30" />
              <span className="text-[11px] uppercase tracking-[0.3em] text-mute">
                {book ? book.author : "EPUB · English ⇄ 日本語"}
              </span>
            </div>
            <h1 className="font-serif text-5xl font-bold leading-[0.98] md:text-6xl">
              {book ? (
                book.title
              ) : (
                <>
                  The <span className="italic text-accent">quiet</span> hour
                </>
              )}
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-mute">
              Tap any underlined word to save it to your study list. Each page renders fully
              translated, side by side, so you can read the original alongside the translation.
            </p>
          </div>

          <div className="flex items-center gap-3 pb-1">
            <input
              ref={fileRef}
              type="file"
              accept=".epub,application/epub+zip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onUpload(file);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
            >
              Upload EPUB
            </button>
            {book && (
              <button
                onClick={closeBook}
                className="rounded-full border border-input px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                Library
              </button>
            )}
            <button
              onClick={() => page && void translateCurrent(page.text, direction)}
              disabled={!page || translating}
              className="rounded-full border border-input px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-40"
            >
              {translating ? "Translating…" : "Re-translate"}
            </button>
          </div>
        </div>
      </div>

      {!book && books.length > 0 && (
        <div className="mx-auto max-w-[1240px] px-6 pb-8 lg:px-10">
          <div className="mb-4 flex items-center gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-accent">
              Your library
            </span>
            <span className="h-px w-8 bg-foreground/30" />
            <span className="text-[11px] uppercase tracking-[0.3em] text-mute">
              {books.length} books
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {books.map((b) => (
              <div key={b.id} className="rounded-2xl border border-border bg-card p-5">
                <button
                  onClick={() => void reopen(b.id)}
                  className="block w-full text-left"
                >
                  <p className="font-serif text-xl font-semibold leading-tight">{b.title}</p>
                  <p className="mt-1 text-sm text-mute">{b.author}</p>
                  <p className="mt-3 text-xs text-mute">
                    {b.pageCount} pages · {wordCounts.get(b.id) ?? 0} words saved
                  </p>
                </button>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
                  <button
                    onClick={() => void reopen(b.id)}
                    className="font-semibold text-accent"
                  >
                    Open →
                  </button>
                  <button
                    onClick={() => void removeFromLibrary(b.id, b.title)}
                    className="text-mute hover:text-foreground"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-[1240px] px-6 pb-20 lg:px-10">
        <div className="relative">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-10">
            {/* ORIGINAL */}
            <article className="rounded-2xl border border-border bg-card p-7 md:p-9">
              <div className="mb-6 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-mute">
                  Original · {sourceIsJapanese ? "Japanese" : "English"}
                </span>
                <span className="text-[11px] tracking-[0.2em] text-mute">
                  {book ? `${pageIndex + 1} / ${book.pages.length}` : "— / —"}
                </span>
              </div>

              {page ? (
                <div
                  className={`text-[19px] ${sourceIsJapanese ? "font-jp leading-[2.1]" : "font-serif leading-[1.95]"}`}
                >
                  {srcParas.map((para, pi) => (
                    <p key={pi} className={pi ? "mt-5" : ""}>
                      {para.tokens.map((token, ti) => {
                        if (!token.word) return <span key={ti}>{token.text}</span>;
                        const highlighted = highlight.src.get(pi)?.has(ti);
                        const saved = savedTerms.has(token.text.toLowerCase());
                        return (
                          <span
                            key={ti}
                            role="button"
                            tabIndex={0}
                            onClick={() => void onWordClick(token.text, para.text)}
                            onKeyDown={(e) =>
                              e.key === "Enter" && void onWordClick(token.text, para.text)
                            }
                            onMouseEnter={() => alignment && setHover({ side: "src", para: pi, token: ti })}
                            onMouseLeave={() => alignment && setHover(null)}
                            className={[
                              highlighted ? "align-hl" : "",
                              saved
                                ? "word-token-saved cursor-pointer"
                                : "word-token hover:text-accent",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            {token.text}
                          </span>
                        );
                      })}
                    </p>
                  ))}
                </div>
              ) : (
                <div
                  onClick={() => fileRef.current?.click()}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center transition-colors ${dragging ? "border-accent bg-accent/5" : "border-input hover:border-accent"}`}
                >
                  <p className="font-serif text-2xl">Drop in an EPUB</p>
                  <p className="mt-2 max-w-xs text-sm text-mute">
                    Drag & drop your file anywhere, or click here to browse. It is saved to your
                    library on this device.
                  </p>
                </div>
              )}

              <div className="mt-7 flex items-center justify-between border-t border-border pt-5 text-sm">
                <span className="text-mute">
                  {book ? "Tap a word to add it to this book" : "Words save per book"}
                </span>
                <span className="font-semibold text-accent">
                  {book ? (wordCounts.get(book.id) ?? 0) : totalCount} saved
                </span>
              </div>
            </article>

            {/* TRANSLATION */}
            <article className="rounded-2xl border border-border bg-card p-7 md:p-9">
              <div className="mb-6 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-accent">
                  Translation · {sourceIsJapanese ? "English" : "Japanese"}
                </span>
                <span className="text-[11px] tracking-[0.2em] text-mute">
                  {sourceIsJapanese ? "full page" : "全訳"}
                </span>
              </div>

              {translating ? (
                <div className="space-y-3">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-4 animate-pulse rounded bg-muted" />
                  ))}
                </div>
              ) : translation ? (
                <div
                  className={`text-[19px] ${sourceIsJapanese ? "font-serif leading-[1.95]" : "font-jp leading-[2.1]"}`}
                >
                  {tgtParas.map((para, pi) => (
                    <p key={pi} className={pi ? "mt-5" : ""}>
                      {para.tokens.map((token, ti) => {
                        if (!token.word) return <span key={ti}>{token.text}</span>;
                        const highlighted = highlight.tgt.get(pi)?.has(ti);
                        return (
                          <span
                            key={ti}
                            onMouseEnter={() => alignment && setHover({ side: "tgt", para: pi, token: ti })}
                            onMouseLeave={() => alignment && setHover(null)}
                            className={highlighted ? "align-hl" : ""}
                          >
                            {token.text}
                          </span>
                        );
                      })}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-[15px] leading-relaxed text-mute">
                  The full translation of the current page appears here, paragraph for paragraph.
                </p>
              )}

              <div className="mt-7 flex items-center justify-between border-t border-border pt-5 text-sm">
                <span className="text-mute">
                  {alignment ? "Hover any word to see its match" : "Whole page, translated each turn"}
                </span>
                <button
                  onClick={() =>
                    translation && speak(translation, sourceIsJapanese ? "en-US" : "ja-JP")
                  }
                  className="text-mute transition-colors hover:text-accent"
                >
                  Listen
                </button>
              </div>
            </article>
          </div>

          <div className="absolute left-1/2 top-1/2 z-10 hidden size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-input bg-background font-serif text-lg text-accent md:flex">
            ⇄
          </div>
        </div>

        {/* PAGE NAV */}
        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            onClick={() => goToPage(pageIndex - 1)}
            disabled={!book || pageIndex === 0}
            className="rounded-full border border-input px-5 py-2 text-sm font-semibold disabled:opacity-40"
          >
            ← Previous page
          </button>
          <span className="font-mono text-xs text-mute">
            {book ? `${pageIndex + 1} / ${book.pages.length}` : "no book loaded"}
          </span>
          <button
            onClick={() => goToPage(pageIndex + 1)}
            disabled={!book || pageIndex >= (book?.pages.length ?? 1) - 1}
            className="rounded-full border border-input px-5 py-2 text-sm font-semibold disabled:opacity-40"
          >
            Next page →
          </button>
        </div>

        {/* WORD SLIP */}
        {selected && (
          <div className="fixed inset-x-0 bottom-0 z-20 flex justify-center px-6 pb-6">
            <div className="w-full max-w-lg rounded-2xl border border-border bg-popover p-6 shadow-xl">
              {selected.loading ? (
                <p className="text-sm text-mute">Looking up “{selected.word}”…</p>
              ) : selected.data ? (
                <>
                  <div>
                    <p className="font-jp text-3xl leading-tight">{selected.data.term}</p>
                    <p className="mt-1 text-sm text-mute">
                      {selected.data.reading} · {selected.data.partOfSpeech}
                    </p>
                    <p className="mt-3 font-serif text-2xl leading-snug">
                      {selected.data.meaning}
                    </p>
                  </div>
                  {selected.data.example ? (
                    <>
                      <p className="mt-4 font-jp text-[15px] leading-relaxed">
                        {selected.data.example}
                      </p>
                      {selected.data.exampleTranslation && (
                        <p className="mt-1 text-sm text-mute">
                          {selected.data.exampleTranslation}
                        </p>
                      )}
                    </>
                  ) : selected.exampleLoading ? (
                    <p className="mt-4 animate-pulse text-sm text-mute">
                      Finding an example sentence…
                    </p>
                  ) : null}
                  <p className="mt-5 text-[11px] uppercase tracking-[0.2em] text-mute">
                    Save to “{book?.title ?? "your list"}”
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      onClick={saveSelected}
                      disabled={selected.loading || selected.exampleLoading}
                      className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-40"
                    >
                      Save to list
                    </button>
                    <button
                      onClick={() => speak(selected.data!.term)}
                      className="rounded-full border border-input px-5 py-2 text-sm font-semibold"
                    >
                      Listen
                    </button>
                    <button
                      onClick={() => setSelected(null)}
                      className="ml-auto text-sm text-mute hover:text-foreground"
                    >
                      Close
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}

        {/* DRAG & DROP OVERLAY */}
        {dragging && (
          <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm">
            <div className="rounded-3xl border-2 border-dashed border-accent bg-card px-12 py-10 text-center shadow-2xl">
              <p className="font-serif text-3xl">Drop your EPUB</p>
              <p className="mt-2 text-sm text-mute">Release to start reading</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
