import type { BookMeta, StoredBook, VocabList } from "./bookshelf";

// ---------------------------------------------------------------------------
// Default bookshelf implementation: IndexedDB with an in-memory fallback so
// the app still works in a private/blocked-storage session.
// ---------------------------------------------------------------------------

const DB_NAME = "kotoba.library.v1";
const DB_VERSION = 1;

type DBSchema = {
  books: Record<string, StoredBook>;
  lists: Record<string, VocabList>;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

// In-memory fallback when IndexedDB is unavailable (SSR, private mode, errors).
const memory: DBSchema = { books: {}, lists: {} };

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === "undefined") {
    dbPromise = Promise.resolve(null);
    return dbPromise;
  }
  dbPromise = new Promise((resolve) => {
    let attempts = 0;

    const tryOpen = () => {
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        console.error("Bookshelf: IndexedDB unavailable, using in-memory storage.", error);
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("books")) {
          db.createObjectStore("books", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("lists")) {
          db.createObjectStore("lists", { keyPath: "bookId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.error("Bookshelf: opening IndexedDB failed, using in-memory storage.", request.error);
        resolve(null);
      };
      request.onblocked = () => {
        // Another tab holds an older DB version open. Wait for it to release,
        // retrying a few times before falling back to in-memory storage.
        attempts += 1;
        if (attempts >= 4) {
          console.error("Bookshelf: IndexedDB stayed blocked, using in-memory storage.");
          resolve(null);
          return;
        }
        setTimeout(tryOpen, 300);
      };
    };

    tryOpen();
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB error"));
  });
}

async function dbStore(name: "books" | "lists", mode: IDBTransactionMode = "readonly") {
  const db = await openDb();
  return db ? db.transaction(name, mode).objectStore(name) : null;
}

export async function listBooks(): Promise<BookMeta[]> {
  const store = await dbStore("books");
  if (!store) {
    return Object.values(memory.books).map(toMeta);
  }
  const all = (await requestToPromise(store.getAll() as IDBRequest<StoredBook[]>)) ?? [];
  return all.map(toMeta).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function getBook(id: string): Promise<StoredBook | null> {
  const store = await dbStore("books");
  if (!store) return memory.books[id] ?? null;
  return (await requestToPromise(store.get(id) as IDBRequest<StoredBook | undefined>)) ?? null;
}

export async function saveBook(book: StoredBook): Promise<void> {
  const store = await dbStore("books", "readwrite");
  if (!store) {
    const existing = memory.books[book.id];
    memory.books[book.id] = {
      ...book,
      uploadedAt: existing?.uploadedAt ?? book.uploadedAt,
      lastOpenedAt: existing?.lastOpenedAt ?? book.lastOpenedAt,
    };
    return;
  }
  const existing = await requestToPromise(store.get(book.id) as IDBRequest<StoredBook | undefined>);
  const merged: StoredBook = {
    ...book,
    uploadedAt: existing?.uploadedAt ?? book.uploadedAt,
    // Prefer the newest known activity when saving.
    lastOpenedAt: Math.max(existing?.lastOpenedAt ?? 0, book.lastOpenedAt),
  };
  await requestToPromise(store.put(merged) as IDBRequest<IDBValidKey>);
}

export async function removeBook(id: string): Promise<void> {
  const store = await dbStore("books", "readwrite");
  if (!store) {
    delete memory.books[id];
    return;
  }
  await requestToPromise(store.delete(id) as IDBRequest<undefined>);
}

/** Update the last-opened timestamp (used when re-opening a book). */
export async function touchBook(id: string, at = Date.now()): Promise<void> {
  const existing = await getBook(id);
  if (!existing) return;
  await saveBook({ ...existing, lastOpenedAt: at });
}

export async function listLists(): Promise<VocabList[]> {
  const store = await dbStore("lists");
  if (!store) {
    return Object.values(memory.lists).sort(
      (a, b) => (b.entries[0]?.addedAt ?? 0) - (a.entries[0]?.addedAt ?? 0),
    );
  }
  const all = (await requestToPromise(store.getAll() as IDBRequest<VocabList[]>)) ?? [];
  return all.sort((a, b) => (b.entries[0]?.addedAt ?? 0) - (a.entries[0]?.addedAt ?? 0));
}

export async function getList(bookId: string): Promise<VocabList | null> {
  const store = await dbStore("lists");
  if (!store) return memory.lists[bookId] ?? null;
  return (await requestToPromise(store.get(bookId) as IDBRequest<VocabList | undefined>)) ?? null;
}

export async function saveList(list: VocabList): Promise<void> {
  const store = await dbStore("lists", "readwrite");
  if (!store) {
    memory.lists[list.bookId] = list;
    return;
  }
  await requestToPromise(store.put(list) as IDBRequest<IDBValidKey>);
}

function toMeta(book: StoredBook): BookMeta {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    pageCount: book.pages.length,
    lastOpenedAt: book.lastOpenedAt,
  };
}
