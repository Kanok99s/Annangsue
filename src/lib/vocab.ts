import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getBook,
  getList,
  listBooks,
  listLists,
  removeBook,
  saveBook,
  saveList,
  touchBook,
  type BookMeta,
  type StoredBook,
  type VocabEntry,
  type VocabList,
} from "./bookshelf";

export type { VocabEntry };
export type { BookMeta, StoredBook, VocabList } from "./bookshelf";

/**
 * A word plus the id of the list (book) it belongs to — used by the "All
 * words" view and Study drills that operate across books.
 */
export type ScopedEntry = VocabEntry & { bookId: string };

// ---------------------------------------------------------------------------
// Change broadcast. Every mutation (vocab list OR library book) emits this so
// all open pages re-read from the bookshelf and stay in sync.
// ---------------------------------------------------------------------------

const EVENT = "kotoba-vocab-changed";

function emitChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT));
}

// ---------------------------------------------------------------------------
// Data-loading helpers (async; used by hooks and mutation callbacks).
// ---------------------------------------------------------------------------

async function loadState(): Promise<{ books: BookMeta[]; lists: VocabList[] }> {
  const [books, lists] = await Promise.all([listBooks(), listLists()]);
  return { books, lists };
}

/** Flatten every list into one newest-first stream, tagged with its book id. */
function flatten(lists: VocabList[]): ScopedEntry[] {
  const flat: ScopedEntry[] = [];
  for (const list of lists) {
    for (const entry of list.entries) flat.push({ ...entry, bookId: list.bookId });
  }
  return flat.sort((a, b) => b.addedAt - a.addedAt);
}

// ---------------------------------------------------------------------------
// Mutations (used by the reader and management pages).
// ---------------------------------------------------------------------------

/**
 * Persist an uploaded book. Upsert keeps the original uploadedAt and any prior
 * lastOpenedAt history; the list is untouched (re-upload merges, never wipes).
 */
export async function addBook(book: StoredBook): Promise<void> {
  await saveBook(book);
  emitChanged();
}

export async function removeBookKeepList(id: string): Promise<void> {
  // Library record only — saved words live in the list, which is left alone.
  await removeBook(id);
  emitChanged();
}

/** Record that a book was opened so the library sorts by recency. */
export async function openBook(id: string): Promise<StoredBook | null> {
  const book = await getBook(id);
  if (book) {
    await touchBook(id);
    emitChanged();
  }
  return book;
}

/**
 * Add a word to a book's list. Returns false when the same term+meaning is
 * already saved for that book (dedupe is per-list).
 */
export async function addWord(
  bookId: string,
  book: Pick<StoredBook, "title" | "author">,
  word: Omit<VocabEntry, "id" | "addedAt" | "correct" | "attempts">,
): Promise<boolean> {
  const list =
    (await getList(bookId)) ?? { bookId, title: book.title, author: book.author, entries: [] };
  if (list.entries.some((e) => e.term === word.term && e.meaning === word.meaning)) return false;

  const entry: VocabEntry = {
    ...word,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    addedAt: Date.now(),
    correct: 0,
    attempts: 0,
  };
  await saveList({ ...list, entries: [entry, ...list.entries] });
  emitChanged();
  return true;
}

export async function removeWord(bookId: string, entryId: string): Promise<void> {
  const list = await getList(bookId);
  if (!list) return;
  await saveList({ ...list, entries: list.entries.filter((e) => e.id !== entryId) });
  emitChanged();
}

export async function scoreWord(bookId: string, entryId: string, wasCorrect: boolean): Promise<void> {
  const list = await getList(bookId);
  if (!list) return;
  await saveList({
    ...list,
    entries: list.entries.map((e) =>
      e.id === entryId
        ? { ...e, attempts: e.attempts + 1, correct: e.correct + (wasCorrect ? 1 : 0) }
        : e,
    ),
  });
  emitChanged();
}

// ---------------------------------------------------------------------------
// React hooks.
// ---------------------------------------------------------------------------

/**
 * Full library + vocabulary state for a page. Re-reads the bookshelf whenever
 * any tab/page mutates it, so the reader, vocabulary, study and header always
 * agree.
 */
export function useVocab() {
  const [state, setState] = useState<{ books: BookMeta[]; lists: VocabList[] }>({
    books: [],
    lists: [],
  });
  const [hydrated, setHydrated] = useState(false);
  const alive = useRef(true);

  const reload = useCallback(() => {
    void loadState()
      .then((next) => {
        if (alive.current) {
          setState(next);
          setHydrated(true);
        }
      })
      .catch((error) => {
        console.error("Could not load your library.", error);
        if (alive.current) setHydrated(true);
      });
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    // v1 kept one flat list keyed by book title; books now own their lists via
    // the bookshelf, so drop the legacy key on first load (fresh start).
    try {
      window.localStorage.removeItem("kotoba.vocab.v1");
    } catch {
      // ignore storage failures
    }
    window.addEventListener(EVENT, reload);
    window.addEventListener("storage", reload);
    return () => {
      alive.current = false;
      window.removeEventListener(EVENT, reload);
      window.removeEventListener("storage", reload);
    };
  }, [reload]);

  const { books, lists } = state;

  const allEntries = useMemo(() => flatten(lists), [lists]);

  const savedTerms = useMemo(() => {
    const terms = new Set<string>();
    for (const entry of allEntries) terms.add(entry.term.toLowerCase());
    return terms;
  }, [allEntries]);

  const wordCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const list of lists) counts.set(list.bookId, list.entries.length);
    return counts;
  }, [lists]);

  return {
    /** True once the first read from the bookshelf finished. */
    hydrated,
    books,
    lists,
    allEntries,
    savedTerms,
    /** Book id -> number of saved words. */
    wordCounts,
    /** Live total across every list. */
    totalCount: allEntries.length,
  };
}

export function speak(text: string, lang = "ja-JP") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}
