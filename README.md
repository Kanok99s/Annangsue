# Annangsue — Bilingual EPUB Reader

Read EPUBs side by side in English and Japanese. Upload a book, get a full
page-by-page translation, tap any word to save it to your vocabulary, and then
drill it with kanji, meaning and pronunciation exercises.

## What it is

Annangsue turns any EPUB into a bilingual reading experience for language
learners:

- **Import any EPUB** — parse the book in the browser (JSZip) and start
  reading right away; when signed in it's saved to your account's cloud
  library (guests read from the current tab only). Drag & drop a file anywhere
  on the page works too.
- **Side-by-side reading** — read the original page next to its translation,
  with configurable source/target language directions (EN ↔ JA/KO/SV).
- **Hover-to-match** — hover a word in either pane and its equivalent in the
  other pane lights up (via Microsoft Translator's word-alignment data).
- **Tap-to-save vocabulary** — tap any word (Japanese chunks of kanji/kana or
  English words) to look it up against JMdict (via Jisho) and save it with its
  reading, meaning, part of speech and a real example sentence (Tatoeba).
- **Study drills** — drill your saved words three ways: word recognition,
  kanji reading, and listening (pick the correct answer by ear).
- **Vocabulary list** — every word you tapped, with an SRS-style drill score,
  ready to review.

Reading is free for everyone — upload an EPUB, read it side by side, and look
words up without an account. Sign in with email + password (Supabase Auth)
when you want to keep things: books saved to your cloud library and word lists
stored per-account in Supabase Postgres behind row-level security.
Translation/dictionary requests use keyless public APIs (MyMemory, Jisho,
Tatoeba). Setting `MICROSOFT_TRANSLATOR_KEY` (free Azure tier) upgrades page
translation to Microsoft Translator and enables the word-alignment hover
feature; the app gracefully falls back to MyMemory when no key is present. See
`.env.example`.

## Features

- Full-page translation that preserves paragraph structure
- Smart word chunking so every word is individually tappable
- Cloud library synced to your account — pick up reading on any device
- Built-in text-to-speech for reading practice
- No API keys required to run

## Tech stack

- [TanStack Start](https://tanstack.com/start) (file-based routing, SSR)
- [React 19](https://react.dev)
- [TypeScript](https://www.typescriptlang.org)
- [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com)
- [pnpm](https://pnpm.io) as the package manager

## Local development

Requires Node.js and pnpm.

```sh
pnpm install
pnpm dev
```

Then open the printed URL (default `http://localhost:3000`).

### Scripts

| Command          | Description                                   |
| ---------------- | --------------------------------------------- |
| `pnpm dev`       | Start the development server with hot reload  |
| `pnpm build`     | Production build (SSR + static)               |
| `pnpm preview`   | Preview the production build locally          |
| `pnpm lint`      | Lint the codebase                             |
| `pnpm format`    | Format with Prettier                          |

## Deploying to Vercel

The project is a standard TanStack Start app and deploys to Vercel with no
special configuration:

1. Push this repository to GitHub.
2. In Vercel, **Import** the repository.
3. Keep the defaults — Vercel detects pnpm automatically and runs
   `pnpm install` and `pnpm build`. Framework preset: **Other** (TanStack Start
   outputs a Nitro server, which Vercel picks up from `.output/`).

That's it — every push to the default branch redeploys.

## License

None declared yet. You are free to use, modify and distribute this project
under your own terms.
