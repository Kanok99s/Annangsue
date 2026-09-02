import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Annangsue" },
      {
        name: "description",
        content:
          "Sign in to Annangsue to read EPUBs side by side and keep your vocabulary, per book, across devices.",
      },
    ],
  }),
  component: LoginPage,
});

type Mode = "sign-in" | "sign-up";

const inputClass =
  "w-full rounded-xl border border-input bg-background px-4 py-2.5 text-[15px] text-foreground outline-none transition-colors placeholder:text-mute/70 focus:border-accent";

function LoginPage() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      if (mode === "sign-in") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
        // AuthProvider watches auth state and routes into the app.
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setNotice(
            "Account created — check your inbox for a confirmation link, then sign in below.",
          );
          setMode("sign-in");
        }
        // With a session present the AuthProvider routes into the app.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
        <p className="mb-2 font-serif text-3xl font-extrabold tracking-tight">Annangsue</p>
        <p className="mb-8 text-[15px] leading-relaxed text-mute">
          Read EPUBs side by side in English and Japanese. Your library and saved words are kept
          per account, so they follow you anywhere.
        </p>

        <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="mb-6 flex items-center overflow-hidden rounded-full border border-input text-sm font-semibold">
            <button
              type="button"
              onClick={() => switchMode("sign-in")}
              className={`flex-1 px-4 py-2.5 transition-colors ${
                mode === "sign-in"
                  ? "bg-primary text-primary-foreground"
                  : "text-mute hover:text-foreground"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode("sign-up")}
              className={`flex-1 px-4 py-2.5 transition-colors ${
                mode === "sign-up"
                  ? "bg-primary text-primary-foreground"
                  : "text-mute hover:text-foreground"
              }`}
            >
              Create account
            </button>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-mute"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-mute"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={inputClass}
              />
              {mode === "sign-up" && (
                <p className="mt-1.5 text-xs text-mute">Use at least 6 characters.</p>
              )}
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
                {notice}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {submitting
                ? "Please wait…"
                : mode === "sign-in"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-mute">
          Your books and word lists are private to your account.
        </p>
      </div>
    </div>
  );
}
