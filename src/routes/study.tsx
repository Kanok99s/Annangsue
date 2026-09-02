import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Header } from "@/components/Header";
import { speak, useVocab, type VocabEntry } from "@/lib/vocab";

export const Route = createFileRoute("/study")({
  head: () => ({
    meta: [
      { title: "Study Drills — Annangsue" },
      {
        name: "description",
        content:
          "Drill your saved words three ways: word recognition, kanji reading, and listening — pick the correct answer by ear.",
      },
      { property: "og:title", content: "Word, kanji and listening drills — Annangsue" },
      {
        property: "og:description",
        content: "Practise the words you saved while reading with recognition, kanji and voiced drills.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StudyPage,
});

type Mode = "recognition" | "kanji" | "voiced";

const MODES: { id: Mode; label: string }[] = [
  { id: "recognition", label: "Word Recognition" },
  { id: "kanji", label: "Kanji" },
  { id: "voiced", label: "Voiced" },
];

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function StudyPage() {
  const { entries, score } = useVocab();
  const [mode, setMode] = useState<Mode>("recognition");
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [seed, setSeed] = useState(0);

  const deck = useMemo(() => (entries.length ? shuffle(entries).slice(0, 10) : []), [entries, seed]);
  const current: VocabEntry | undefined = deck[index];

  const options = useMemo(() => {
    if (!current) return [] as VocabEntry[];
    const distractors = shuffle(entries.filter((e) => e.id !== current.id)).slice(0, 3);
    return shuffle([current, ...distractors]);
  }, [current, entries]);

  useEffect(() => {
    if (mode === "voiced" && current) speak(current.term);
  }, [mode, current]);

  const onPick = (entry: VocabEntry) => {
    if (picked || !current) return;
    const wasCorrect = entry.id === current.id;
    setPicked(entry.id);
    score(current.id, wasCorrect);
    if (wasCorrect) setCorrectCount((c) => c + 1);
  };

  const next = () => {
    setPicked(null);
    if (index + 1 >= deck.length) {
      setIndex(0);
      setCorrectCount(0);
      setSeed((s) => s + 1);
    } else {
      setIndex((i) => i + 1);
    }
  };

  const optionLabel = (entry: VocabEntry) =>
    mode === "kanji" ? entry.reading : mode === "voiced" ? entry.meaning : entry.term;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <div className="mx-auto max-w-[1240px] px-6 pt-14 pb-20 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <div className="mb-4 flex items-center gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-accent">
                Drill
              </span>
              <span className="h-px w-8 bg-foreground/30" />
              <span className="text-[11px] uppercase tracking-[0.3em] text-mute">
                {deck.length ? `${index + 1} of ${deck.length}` : "empty deck"}
              </span>
            </div>
            <h1 className="font-serif text-5xl font-bold leading-[0.98] md:text-6xl">
              The <span className="italic text-accent">practice</span> hour
            </h1>
          </div>
          <div className="flex items-center overflow-hidden rounded-full border border-input">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setMode(m.id);
                  setPicked(null);
                }}
                className={`px-4 py-2.5 text-sm font-semibold transition-colors ${
                  mode === m.id ? "bg-primary text-primary-foreground" : "text-mute"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {entries.length < 4 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-input p-16 text-center">
            <p className="font-serif text-2xl">Save at least four words first</p>
            <p className="mt-2 text-sm text-mute">
              Drills need a few alternatives to choose between.
            </p>
            <Link to="/" className="mt-5 inline-block text-sm font-semibold text-accent">
              Back to the reader →
            </Link>
          </div>
        ) : (
          current && (
            <div className="mt-10 grid gap-6 md:grid-cols-[1.2fr_1fr]">
              <div className="rounded-2xl border border-border bg-card p-9">
                <div className="mb-6 flex items-center justify-between text-[11px] uppercase tracking-[0.25em] text-mute">
                  <span>
                    {mode === "recognition"
                      ? "Which word means this?"
                      : mode === "kanji"
                        ? "How is this kanji read?"
                        : "Which word did you hear?"}
                  </span>
                  <span>
                    {correctCount} / {deck.length}
                  </span>
                </div>

                {mode === "recognition" && (
                  <p className="font-serif text-4xl">{current.meaning}</p>
                )}
                {mode === "kanji" && <p className="font-jp text-6xl">{current.term}</p>}
                {mode === "voiced" && (
                  <button
                    onClick={() => speak(current.term)}
                    className="flex items-center gap-4 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
                  >
                    ▶ Play the word again
                  </button>
                )}

                <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {options.map((option) => {
                    const isAnswer = option.id === current.id;
                    const state = !picked
                      ? "idle"
                      : isAnswer
                        ? "correct"
                        : option.id === picked
                          ? "wrong"
                          : "idle";
                    return (
                      <button
                        key={option.id}
                        onClick={() => onPick(option)}
                        className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                          state === "correct"
                            ? "border-accent bg-accent/10 text-accent"
                            : state === "wrong"
                              ? "border-input bg-muted text-mute line-through"
                              : "border-border hover:border-foreground/40"
                        }`}
                      >
                        <span
                          className={
                            mode === "voiced" ? "font-serif text-lg" : "font-jp text-xl"
                          }
                        >
                          {optionLabel(option)}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {picked && (
                  <div className="mt-7 flex items-center justify-between border-t border-border pt-5">
                    <p className="text-sm text-mute">
                      <span className="font-jp text-base text-foreground">{current.term}</span>{" "}
                      {current.reading} — {current.meaning}
                    </p>
                    <button
                      onClick={next}
                      className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-border bg-card p-9">
                <span className="text-[11px] uppercase tracking-[0.25em] text-mute">In context</span>
                <p className="mt-4 font-jp text-lg leading-[2]">{current.example}</p>
                <p className="mt-3 text-sm text-mute">
                  {picked ? current.exampleTranslation : "Answer to reveal the translation."}
                </p>
                <p className="mt-8 border-t border-border pt-5 text-xs text-mute">
                  From {current.source}
                </p>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
