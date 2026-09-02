import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Header, type Direction } from "@/components/Header";
import { parseEpub, type ParsedBook } from "@/lib/epub";
import { lookupWord, translatePage, type WordLookup } from "@/lib/translate.functions";
import { speak, useVocab } from "@/lib/vocab";

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

function tokenize(text: string, japanese: boolean): Token[] {
  if (japanese) {
    // Japanese has no spaces: chunk runs of kanji/kana as tappable units.
    const parts = text.match(/[\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]+|[^\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]+/g) ?? [];
    return parts.map((p) => ({
      text: p,
      word: /[\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]/.test(p),
    }));
  }
  return (text.match(/[A-Za-z''-]+|[^A-Za-z''-]+/g) ?? []).map((p) => ({
    text: p,
    word: /[A-Za-z]/.test(p) && p.length > 2,
  }));
}

function ReaderPage() {
  const [direction, setDirection] = useState<Direction>("en-ja");
  const [book, setBook] = useState<ParsedBook | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [translation, setTranslation] = useState("");
  const [translating, setTranslating] = useState(false);
  const [selected, setSelected] = useState<{ word: string; data?: WordLookup; loading: boolean } | null>(
    null,
  );
  const fileRef = useRef<HTMLInputElement>(null);

  const { entries, add } = useVocab();
  const doTranslate = useServerFn(translatePage);
  const doLookup = useServerFn(lookupWord);

  const page = book?.pages[pageIndex];
  const sourceIsJapanese = direction === "ja-en";

  const savedTerms = useMemo(() => new Set(entries.map((e) => e.term.toLowerCase())), [entries]);

  const translateCurrent = useCallback(
    async (text: string, dir: Direction) => {
      setTranslating(true);
      setTranslation("");
      try {
        const res = await doTranslate({ data: { text, direction: dir } });
        setTranslation(res.translation);
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

  const onUpload = async (file: File) => {
    try {
      const parsed = await parseEpub(file);
      setBook(parsed);
      setPageIndex(0);
      setSelected(null);
      toast.success(`Loaded “${parsed.title}” · ${parsed.pages.length} pages`);
      const first = parsed.pages[0];
      if (first) void translateCurrent(first.text, direction);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that EPUB.");
    }
  };

  const onDirectionChange = (d: Direction) => {
    setDirection(d);
    if (page) void translateCurrent(page.text, d);
  };

  const onWordClick = async (word: string, context: string) => {
    const clean = word.replace(/[^\p{L}\p{N}'-]/gu, "");
    if (!clean) return;
    setSelected({ word: clean, loading: true });
    speak(clean, sourceIsJapanese ? "ja-JP" : "en-US");
    try {
      const data = await doLookup({ data: { word: clean, context, direction } });
      setSelected({ word: clean, data, loading: false });
    } catch (error) {
      setSelected(null);
      toast.error(error instanceof Error ? error.message : "Lookup failed.");
    }
  };

  const saveSelected = () => {
    if (!selected?.data) return;
    const ok = add({
      ...selected.data,
      source: book?.title ?? "Reader",
    });
    toast[ok ? "success" : "info"](ok ? `Saved ${selected.data.term}` : "Already in your list");
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
                  {page.text.split(/\n{2,}/).map((para, pi) => (
                    <p key={pi} className={pi ? "mt-5" : ""}>
                      {tokenize(para, sourceIsJapanese).map((token, ti) =>
                        token.word ? (
                          <span
                            key={ti}
                            role="button"
                            tabIndex={0}
                            onClick={() => void onWordClick(token.text, para)}
                            onKeyDown={(e) =>
                              e.key === "Enter" && void onWordClick(token.text, para)
                            }
                            className={
                              savedTerms.has(token.text.toLowerCase())
                                ? "word-token-saved cursor-pointer"
                                : "word-token hover:text-accent"
                            }
                          >
                            {token.text}
                          </span>
                        ) : (
                          <span key={ti}>{token.text}</span>
                        ),
                      )}
                    </p>
                  ))}
                </div>
              ) : (
                <div
                  onClick={() => fileRef.current?.click()}
                  className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-input py-16 text-center"
                >
                  <p className="font-serif text-2xl">Drop in an EPUB</p>
                  <p className="mt-2 max-w-xs text-sm text-mute">
                    Your book stays in this browser. Choose a file to begin reading.
                  </p>
                </div>
              )}

              <div className="mt-7 flex items-center justify-between border-t border-border pt-5 text-sm">
                <span className="text-mute">Tap a word to add it</span>
                <span className="font-semibold text-accent">{entries.length} saved</span>
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
                  {translation.split(/\n{2,}/).map((para, i) => (
                    <p key={i} className={i ? "mt-5" : ""}>
                      {para}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-[15px] leading-relaxed text-mute">
                  The full translation of the current page appears here, paragraph for paragraph.
                </p>
              )}

              <div className="mt-7 flex items-center justify-between border-t border-border pt-5 text-sm">
                <span className="text-mute">Whole page, translated each turn</span>
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
                  <p className="mt-4 font-jp text-[15px] leading-relaxed">{selected.data.example}</p>
                  <p className="mt-1 text-sm text-mute">{selected.data.exampleTranslation}</p>
                  <div className="mt-5 flex items-center gap-3">
                    <button
                      onClick={saveSelected}
                      className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground"
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
      </div>
    </div>
  );
}
