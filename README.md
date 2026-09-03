# Annangsue — Bilingual EPUB reader

Read an EPUB in two languages at once. Annangsue shows the original page next
to a full machine translation, lets you tap any word to look it up and save it
to a per-book vocabulary list, and then quizzes you on those words.

**Live app:** <https://annangsue.vercel.app/>

## What it does

- **Read side by side** — upload (or drag & drop) any EPUB and read it
  paragraph-by-paragraph next to its translation, on facing panes. Turn pages
  with the reader controls and each page translates as you go.
- **Your language pair** — translate between English, Japanese and Korean in
  any direction (Japanese → English is the default), and swap source/target at
  any time. Swedish is next and already shows up in the picker as “coming
  soon”.
- **Tap words to look them up** — in English or Japanese text every word in
  the reading pane is tappable. Tap one to get its reading, part of speech and
  English meaning from Jisho (JMdict), plus a real example sentence from
  Tatoeba with its translation. Japanese is split into real words with
  `Intl.Segmenter`, so even an unspaced sentence breaks up into cleanly
  tappable units.
- **Save words per book** — a word you save is kept on that book's list, with
  a running `correct/attempts` drill score. The library and your lists live on
  your account and are private to it.
- **Study drills** — on the Vocabulary page, drill a single book or all books
  at once with randomized ten-word decks in three modes: **Word Recognition**
  (read an English meaning, pick the word), **Kanji** (read the kanji, pick the
  reading) and **Voiced** (hear the word spoken, pick the meaning).
- **Listen anywhere** — built-in text-to-speech reads the original page, the
  translation, and any saved word.

## Guests and accounts

Reading is free for everyone: no account is needed to upload a book, read it
side by side, or look words up. An account is only required to *keep* things —
saving words to a list, and having your books stored in a cloud library that
follows you across devices. When a guest tries to save, Annangsue opens a
sign-in prompt right where you are (nothing is lost or navigated away), and
queued saves sync automatically once you sign in.

Sign in happens by email + password through Supabase Auth, either from the
in-page prompt or the standalone `/login` page. Books and word lists are stored
in Supabase Postgres behind row-level security, so each account sees only its
own data.

## Translation and dictionaries

Everything works with no API keys. The reader is deliberately “keyless first”:

- **Page translation** uses the free [MyMemory](https://mymemory.translated.net)
  API, falling back gracefully whenever a key is not set.
- **Word lookups** use Jisho's keyless API over the JMdict dictionary.
- **Example sentences** come from [Tatoeba](https://tatoeba.org).

Optional upgrades, configured through environment variables (see `.env.example`):

- `MICROSOFT_TRANSLATOR_KEY` (+ `MICROSOFT_TRANSLATOR_REGION`) — free Azure
  tier. Replaces MyMemory with Microsoft Translator and enables *word
  alignment*: hover a word in either pane and its match lights up in the other.
- `MYMEMORY_EMAIL` — a free MyMemory account email raises the anonymous
  per-request and daily translation limits.

### Running your own instance

The app talks to a Supabase project for auth, the cloud library and word lists.
The project URL and publishable key are in
`src/integrations/supabase/client.ts` — point them at your own project. Two
tables are expected (`books` and `lists`), each scoped to `user_id` with row
level security so every account only ever accesses its own rows.

## Tech stack

- [TanStack Start](https://tanstack.com/start) (file-based routing, SSR)
- [React 19](https://react.dev) + [TypeScript](https://www.typescriptlang.org)
- [Tailwind CSS v4](https://tailwindcss.com) + shadcn/ui primitives
- [Supabase](https://supabase.com) (auth + Postgres)
- [pnpm](https://pnpm.io)

## Local development

Requires Node.js and pnpm.

```sh
pnpm install
pnpm dev
```

Then open the printed URL (default `http://localhost:3000`).

| Command        | Description                                  |
| -------------- | -------------------------------------------- |
| `pnpm dev`     | Start the development server with hot reload |
| `pnpm build`   | Production build                             |
| `pnpm preview` | Preview the production build locally         |
| `pnpm lint`    | Lint the codebase                            |
| `pnpm format`  | Format with Prettier                         |

## Deployment

The site is hosted on Vercel (<https://annangsue.vercel.app/>) as a standard
TanStack Start app: Vercel detects pnpm and runs `pnpm install` and
`pnpm build`, and every push to the default branch redeploys. Environment
variables for the optional providers above are set in the Vercel project
settings.

## License

None declared. You are free to use, modify and distribute this project under
your own terms.
