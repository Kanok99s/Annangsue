# Agent guidance

Guidance for AI agents and contributors working in this repository.

## Project

**Annangsue — Bilingual EPUB Reader.** A web app for language learners that
imports an EPUB, shows it side by side with a machine translation
(EN/JA/KO/SV), lets readers tap words to save vocabulary, and provides study
drills over the saved words.

**Supabase** is the backend: email/password auth, and each account's parsed
books + vocabulary lists are stored in Postgres behind row-level security.
The reader is open to everyone (upload, read, translate, look words up); an
account is only needed to *save* — persist books to the cloud library and keep
word lists. Sign-in is prompted at the point of need via a dialog
(`src/components/AuthProvider.tsx`, `AuthForm.tsx`, `SignInDialog.tsx`), with
`/login` as the standalone sign-in page.

## Stack

- **TanStack Start** — file-based routing + SSR; route definitions live in
  `src/routes/` (`__root.tsx` is the app shell — keep its `<Outlet />`).
- **React 19 + TypeScript** — strict.
- **Tailwind CSS v4 + shadcn/ui** — only the primitives the app actually uses
  live in `src/components/ui/` (`dialog`, `sonner`); they are generated and
  should not be edited by hand. Add a missing shadcn component by writing it as
  a fresh generated file in `src/components/ui/` or build custom components in
  `src/components/`.
- **pnpm** — the only package manager in use (`pnpm-lock.yaml`).

## Folder map

| Path | Purpose |
| --- | --- |
| `src/routes/` | File-based routes — `index.tsx` (reader), `vocabulary.tsx` (word list + study drills), `login.tsx` |
| `src/components/` | Shared React components (e.g. `Header.tsx`, `AuthProvider.tsx`) |
| `src/lib/epub.ts` | EPUB parsing (JSZip) → `ParsedBook` of plain-text pages |
| `src/lib/translate.functions.ts` | Server functions: full-page translation, word lookup, example sentences (keyless public APIs) |
| `src/lib/bookshelf.ts` | Data-layer facade + shared types; pages only ever import this module |
| `src/lib/bookshelf.supabase.ts` | Supabase implementation of the bookshelf (books + lists tables) |
| `src/lib/vocab.ts` | Per-book vocabulary store + drill logic + speech |
| `src/lib/lang.ts` | Language codes/directions and script helpers |
| `src/integrations/supabase/client.ts` | Supabase client singleton |
| `src/lib/error-capture.ts`, `error-page.ts`, `server.ts` | SSR error logging / fallback error page |
| `src/routeTree.gen.ts` | Auto-generated route tree — never edit by hand |

## Commands

| Command | Meaning |
| --- | --- |
| `pnpm dev` | Development server with hot reload |
| `pnpm build` | Production build (also used by the preview) |
| `pnpm lint` | Lint with ESLint |
| `pnpm format` | Prettier over the repo |

## Conventions

- Style with Tailwind utility classes; pull UI primitives from shadcn/ui.
- The config wrapper in `vite.config.ts` already wires TanStack Start, React,
  Tailwind, path aliases and env injection — do not add duplicate plugins.
- Translation and dictionary features are **keyless**; never introduce a
  required API key for core reading flow.
- Keep diffs LF-normalized and commit-focused; don't reformat unrelated code.
