import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Header } from "@/components/Header";
import { StudyDrill } from "@/components/StudyDrill";
import { useAuth } from "@/components/AuthProvider";
import { removeWord, speak, useVocab, type ScopedEntry } from "@/lib/vocab";

export const Route = createFileRoute("/vocabulary")({
  head: () => ({
    meta: [
      { title: "Vocabulary List — Annangsue" },
      {
        name: "description",
        content:
          "Your saved words, organised by the book they came from, with kanji, reading, meaning and an example sentence, ready to drill.",
      },
      { property: "og:title", content: "Your vocabulary lists — Annangsue" },
      {
        property: "og:description",
        content:
          "Words saved from each book in your library, with kanji, readings, meanings and examples.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VocabularyPage,
});

/** A list card shows its words if it has any; 'all' spans every list. */
type View = { kind: "grid" } | { kind: "list"; bookId: string } | { kind: "all" };

function WordCard({ entry, onRemove }: { entry: ScopedEntry; onRemove: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
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
          <button onClick={onRemove} className="text-mute hover:text-foreground">
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

function VocabularyPage() {
  const { hydrated, lists, allEntries, totalCount } = useVocab();
  const { user, askSignIn } = useAuth();
  const [view, setView] = useState<View>({ kind: "grid" });
  // A running quiz session; its scope preselects the deck in the drill.
  const [drill, setDrill] = useState<{ scope: string } | null>(null);

  const activeList =
    view.kind === "list" ? lists.find((l) => l.bookId === view.bookId) : undefined;

  const shown: { entries: ScopedEntry[]; heading: string; sub: string } | null =
    view.kind === "grid"
      ? null
      : view.kind === "all"
        ? { entries: allEntries, heading: "All words", sub: `${totalCount} words across your books` }
        : activeList
          ? {
              entries: activeList.entries.map((e) => ({ ...e, bookId: activeList.bookId })),
              heading: activeList.title,
              sub: `${activeList.entries.length} words from this book`,
            }
          : null;

  const onRemove = (entry: ScopedEntry) => {
    void removeWord(entry.bookId, entry.id);
  };

  const grid = (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="mb-4 flex items-center gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-accent">
              Your lists
            </span>
            <span className="h-px w-8 bg-foreground/30" />
            <span className="text-[11px] uppercase tracking-[0.3em] text-mute">
              {totalCount} words in {lists.length} book{lists.length === 1 ? "" : "s"}
            </span>
          </div>
          <h1 className="font-serif text-5xl font-bold leading-[0.98] md:text-6xl">
            Words <span className="italic text-accent">kept</span>
          </h1>
        </div>
        <button
          onClick={() => setDrill({ scope: "all" })}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Start studying
        </button>
      </div>

      {!hydrated ? null : lists.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-input p-16 text-center">
          <p className="font-serif text-2xl">
            {user ? "Nothing saved yet" : "Your list lives with your account"}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-mute">
            {user
              ? "Open a book in the reader and tap a word to add it here — words are kept per book."
              : "Tap any word in a book to read its meaning right away. Signing in is only needed if you want to save words to a list and study them."}
          </p>
          {user ? (
            <Link to="/" className="mt-5 inline-block text-sm font-semibold text-accent">
              Go to the reader →
            </Link>
          ) : (
            <button
              onClick={() => askSignIn("Sign in to save words and study them here.")}
              className="mt-5 rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-foreground transition-colors hover:opacity-90"
            >
              Sign in to save words
            </button>
          )}
        </div>
      ) : (
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <button
            onClick={() => setView({ kind: "all" })}
            className="rounded-2xl border border-accent bg-accent/5 p-5 text-left transition-colors hover:bg-accent/10"
          >
            <p className="text-[11px] uppercase tracking-[0.2em] text-mute">Every book</p>
            <p className="mt-2 font-serif text-3xl">All words</p>
            <p className="mt-3 text-sm text-mute">{totalCount} words</p>
          </button>
          {lists.map((list) => (
            <button
              key={list.bookId}
              onClick={() => setView({ kind: "list", bookId: list.bookId })}
              className="rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-accent/60"
            >
              <p className="truncate text-[11px] uppercase tracking-[0.2em] text-mute">
                {list.author}
              </p>
              <p className="mt-2 truncate font-serif text-2xl font-semibold leading-tight">
                {list.title}
              </p>
              <p className="mt-3 text-sm text-mute">
                {list.entries.length} word{list.entries.length === 1 ? "" : "s"}
              </p>
            </button>
          ))}
        </div>
      )}
    </>
  );

  const listView = shown && (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="mb-4 flex items-center gap-3">
            <button
              onClick={() => setView({ kind: "grid" })}
              className="text-[11px] font-semibold uppercase tracking-[0.3em] text-accent hover:underline"
            >
              ← All lists
            </button>
            <span className="h-px w-8 bg-foreground/30" />
            <span className="text-[11px] uppercase tracking-[0.3em] text-mute">{shown.sub}</span>
          </div>
          <h1 className="font-serif text-5xl font-bold leading-[0.98] md:text-6xl">
            {shown.heading}
          </h1>
        </div>
        <button
          onClick={() => setDrill({ scope: view.kind === "list" ? view.bookId : "all" })}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Start studying
        </button>
      </div>

      {shown.entries.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-input p-16 text-center">
          <p className="font-serif text-2xl">This list is empty</p>
          <p className="mt-2 text-sm text-mute">
            Tap words while reading this book to add them here.
          </p>
          <Link to="/" className="mt-5 inline-block text-sm font-semibold text-accent">
            Back to the reader →
          </Link>
        </div>
      ) : (
        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {shown.entries.map((entry) => (
            <WordCard key={`${entry.bookId}-${entry.id}`} entry={entry} onRemove={() => onRemove(entry)} />
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      {drill ? (
        <StudyDrill initialScope={drill.scope} onExit={() => setDrill(null)} />
      ) : (
        <div className="mx-auto max-w-[1240px] px-6 pt-14 pb-20 lg:px-10">
          {view.kind === "grid" || !shown ? grid : listView}
        </div>
      )}
    </div>
  );
}
