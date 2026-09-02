import { supabase } from "@/integrations/supabase/client";

import type { BookPage } from "./epub";
import type { BookMeta, StoredBook, VocabEntry, VocabList } from "./bookshelf";

// ---------------------------------------------------------------------------
// Cloud bookshelf: Supabase (Postgres). Each row is scoped to the signed-in
// user (user_id), so RLS keeps every account's library and word lists private.
//
// The UI only ever imports this module through ./bookshelf, which keeps the
// same function names as the old IndexedDB implementation — no page changes.
// ---------------------------------------------------------------------------

type BookRow = {
  id: string;
  title: string;
  author: string;
  pages: BookPage[] | null;
  page_count: number;
  uploaded_at: string;
  last_opened_at: string;
};

type ListRow = {
  book_id: string;
  title: string;
  author: string;
  entries: VocabEntry[] | null;
};

const BOOK_COLUMNS = "id,title,author,pages,page_count,uploaded_at,last_opened_at";
const BOOK_META_COLUMNS = "id,title,author,page_count,last_opened_at";

async function requireUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in to use your library.");
  return user.id;
}

const toMs = (iso: string) => new Date(iso).getTime();
const toIso = (ms: number) => new Date(ms).toISOString();

function toMeta(
  row: Pick<BookRow, "id" | "title" | "author" | "page_count" | "last_opened_at">,
): BookMeta {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    pageCount: row.page_count,
    lastOpenedAt: toMs(row.last_opened_at),
  };
}

function toBook(row: BookRow): StoredBook {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    pages: row.pages ?? [],
    uploadedAt: toMs(row.uploaded_at),
    lastOpenedAt: toMs(row.last_opened_at),
  };
}

function toList(row: ListRow): VocabList {
  return {
    bookId: row.book_id,
    title: row.title,
    author: row.author,
    entries: row.entries ?? [],
  };
}

/** Newest-first library rows (pages excluded to keep the grid light). */
export async function listBooks(): Promise<BookMeta[]> {
  const uid = await requireUserId();
  const { data, error } = await supabase
    .from("books")
    .select(BOOK_META_COLUMNS)
    .eq("user_id", uid)
    .order("last_opened_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => toMeta(row as BookRow));
}

export async function getBook(id: string): Promise<StoredBook | null> {
  const uid = await requireUserId();
  const { data, error } = await supabase
    .from("books")
    .select(BOOK_COLUMNS)
    .eq("user_id", uid)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toBook(data as BookRow) : null;
}

/**
 * Save an uploaded book. Upsert keyed on (user_id, id): re-uploading the same
 * file keeps the original uploadedAt and the newest lastOpenedAt, exactly like
 * the previous IndexedDB merge.
 */
export async function saveBook(book: StoredBook): Promise<void> {
  const uid = await requireUserId();
  const { data: existing, error: readError } = await supabase
    .from("books")
    .select("uploaded_at,last_opened_at")
    .eq("user_id", uid)
    .eq("id", book.id)
    .maybeSingle();
  if (readError) throw readError;

  const uploadedAt = existing
    ? toMs((existing as Pick<BookRow, "uploaded_at">).uploaded_at)
    : book.uploadedAt;
  const lastOpenedAt = Math.max(
    existing ? toMs((existing as Pick<BookRow, "last_opened_at">).last_opened_at) : 0,
    book.lastOpenedAt,
  );

  const { error } = await supabase.from("books").upsert(
    {
      user_id: uid,
      id: book.id,
      title: book.title,
      author: book.author,
      pages: book.pages,
      page_count: book.pages.length,
      uploaded_at: toIso(uploadedAt),
      last_opened_at: toIso(lastOpenedAt),
    },
    { onConflict: "user_id,id" },
  );
  if (error) throw error;
}

export async function removeBook(id: string): Promise<void> {
  const uid = await requireUserId();
  const { error } = await supabase.from("books").delete().eq("user_id", uid).eq("id", id);
  if (error) throw error;
}

/** Update the last-opened timestamp (used when re-opening a book). */
export async function touchBook(id: string, at = Date.now()): Promise<void> {
  const uid = await requireUserId();
  const { error } = await supabase
    .from("books")
    .update({ last_opened_at: toIso(at) })
    .eq("user_id", uid)
    .eq("id", id);
  if (error) throw error;
}

/** Every saved list for the user, most recently added to first. */
export async function listLists(): Promise<VocabList[]> {
  const uid = await requireUserId();
  const { data, error } = await supabase
    .from("lists")
    .select("book_id,title,author,entries")
    .eq("user_id", uid);
  if (error) throw error;
  return (data ?? [])
    .map((row) => toList(row as ListRow))
    .sort((a, b) => (b.entries[0]?.addedAt ?? 0) - (a.entries[0]?.addedAt ?? 0));
}

export async function getList(bookId: string): Promise<VocabList | null> {
  const uid = await requireUserId();
  const { data, error } = await supabase
    .from("lists")
    .select("book_id,title,author,entries")
    .eq("user_id", uid)
    .eq("book_id", bookId)
    .maybeSingle();
  if (error) throw error;
  return data ? toList(data as ListRow) : null;
}

export async function saveList(list: VocabList): Promise<void> {
  const uid = await requireUserId();
  const { error } = await supabase.from("lists").upsert(
    {
      user_id: uid,
      book_id: list.bookId,
      title: list.title,
      author: list.author,
      entries: list.entries,
    },
    { onConflict: "user_id,book_id" },
  );
  if (error) throw error;
}
