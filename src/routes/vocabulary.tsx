import { createFileRoute, Link } from "@tanstack/react-router";
import { Header } from "@/components/Header";
import { speak, useVocab } from "@/lib/vocab";

export const Route = createFileRoute("/vocabulary")({
  head: () => ({
    meta: [
      { title: "Vocabulary List — Annangsue" },
      {
        name: "description",
        content:
          "Every word you tapped while reading, with kanji, reading, meaning and an example sentence, ready to drill.",
      },
      { property: "og:title", content: "Your Japanese vocabulary list — Annangsue" },
      {
        property: "og:description",
        content: "Saved words from your EPUB reading, with kanji, readings, meanings and examples.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VocabularyPage,
});

function VocabularyPage() {
  const { entries, remove } = useVocab();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <div className="mx-auto max-w-[1240px] px-6 pt-14 pb-20 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-accent">
                Your list
              </span>
              <span className="h-px w-8 bg-foreground/30" />
              <span className="text-[11px] uppercase tracking-[0.3em] text-mute">
                {entries.length} words
              </span>
            </div>
            <h1 className="font-serif text-5xl font-bold leading-[0.98] md:text-6xl">
              Words <span className="italic text-accent">kept</span>
            </h1>
          </div>
          <Link
            to="/study"
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Start studying
          </Link>
        </div>

        {entries.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-input p-16 text-center">
            <p className="font-serif text-2xl">Nothing saved yet</p>
            <p className="mt-2 text-sm text-mute">
              Open a book in the reader and tap a word to add it here.
            </p>
            <Link to="/" className="mt-5 inline-block text-sm font-semibold text-accent">
              Go to the reader →
            </Link>
          </div>
        ) : (
          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-border bg-card p-5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-mute">
                    {entry.partOfSpeech}
                  </span>
                  <span className="text-xs text-mute">
                    {entry.attempts ? `${entry.correct}/${entry.attempts}` : "new"}
                  </span>
                </div>
                <p className="font-jp text-3xl">{entry.term}</p>
                <p className="mt-1 text-sm text-mute">{entry.reading}</p>
                <p className="mt-2 font-serif text-xl">{entry.meaning}</p>
                <p className="mt-3 font-jp text-sm leading-relaxed">{entry.example}</p>
                <p className="mt-1 text-xs text-mute">{entry.exampleTranslation}</p>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
                  <span className="text-mute">{entry.source}</span>
                  <div className="flex items-center gap-3">
                    <button onClick={() => speak(entry.term)} className="font-semibold text-accent">
                      Listen
                    </button>
                    <button onClick={() => remove(entry.id)} className="text-mute hover:text-foreground">
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
