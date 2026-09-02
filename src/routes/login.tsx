import { createFileRoute, Link } from "@tanstack/react-router";

import { AuthForm } from "@/components/AuthForm";

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

function LoginPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
        <Link to="/" className="mb-6 text-sm font-semibold text-mute transition-colors hover:text-foreground">
          ← Back to the reader
        </Link>
        <p className="font-serif text-3xl font-extrabold tracking-tight">Annangsue</p>
        <p className="mb-8 text-[15px] leading-relaxed text-mute">
          Reading stays free — an account only adds a saved library and word lists that follow
          you anywhere.
        </p>

        <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          <AuthForm />
        </div>

        <p className="mt-6 text-center text-xs text-mute">
          Your books and word lists are private to your account.
        </p>
      </div>
    </div>
  );
}
