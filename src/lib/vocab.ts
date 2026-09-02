import { useCallback, useEffect, useState } from "react";

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

const KEY = "kotoba.vocab.v1";

function read(): VocabEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as VocabEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: VocabEntry[]) {
  window.localStorage.setItem(KEY, JSON.stringify(entries));
  window.dispatchEvent(new CustomEvent("kotoba-vocab-changed"));
}

export function useVocab() {
  const [entries, setEntries] = useState<VocabEntry[]>([]);

  useEffect(() => {
    setEntries(read());
    const sync = () => setEntries(read());
    window.addEventListener("kotoba-vocab-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("kotoba-vocab-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const add = useCallback((entry: Omit<VocabEntry, "id" | "addedAt" | "correct" | "attempts">) => {
    const current = read();
    if (current.some((e) => e.term === entry.term && e.meaning === entry.meaning)) return false;
    write([
      {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        addedAt: Date.now(),
        correct: 0,
        attempts: 0,
      },
      ...current,
    ]);
    return true;
  }, []);

  const remove = useCallback((id: string) => {
    write(read().filter((e) => e.id !== id));
  }, []);

  const score = useCallback((id: string, wasCorrect: boolean) => {
    write(
      read().map((e) =>
        e.id === id
          ? { ...e, attempts: e.attempts + 1, correct: e.correct + (wasCorrect ? 1 : 0) }
          : e,
      ),
    );
  }, []);

  return { entries, add, remove, score };
}

export function speak(text: string, lang = "ja-JP") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}
