import type { BookPage } from "./epub";

// ---------------------------------------------------------------------------
// Bookshelf — the app's data layer for uploaded books and their vocab lists.
//
// Every page talks to this module (never to IndexedDB directly). When a cloud
// backend arrives, swap the `export { ... } from` source below for a fetch/API
// implementation with the same function names and the UI stays untouched.
// ---------------------------------------------------------------------------

export type VocabEntry = {
  id: string;
  term: string;
  reading: string;
  meaning: string;
  partOfSpeech: string;
  example: string;
  exampleTranslation: string;
  source: string;
  addedAt: number;
  correct: number;
  attempts: number;
};

/** Saved words for one book. Lives independently of the book record. */
export type VocabList = {
  bookId: string;
  title: string;
  author: string;
  entries: VocabEntry[];
};

/** A parsed EPUB persisted in the library. */
export type StoredBook = {
  id: string;
  title: string;
  author: string;
  pages: BookPage[];
  uploadedAt: number;
  lastOpenedAt: number;
};

/** Lightweight library row for grids (pages not included). */
export type BookMeta = {
  id: string;
  title: string;
  author: string;
  pageCount: number;
  lastOpenedAt: number;
};

// ---------------------------------------------------------------------------
// Implementation swap point.
// ---------------------------------------------------------------------------

export {
  listBooks,
  getBook,
  saveBook,
  removeBook,
  touchBook,
  listLists,
  getList,
  saveList,
} from "./bookshelf.indexeddb";
