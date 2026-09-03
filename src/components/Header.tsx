import { Link } from "@tanstack/react-router";
import { useVocab } from "@/lib/vocab";
import { useAuth } from "@/components/AuthProvider";
import { LANGS, splitDirection, type Direction, type Lang } from "@/lib/lang";

export type { Direction } from "@/lib/lang";

function LangSelect({
  value,
  onChange,
  label,
}: {
  value: Lang;
  onChange: (l: Lang) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as Lang)}
      className="rounded-full border border-input bg-background px-3 py-1.5 text-sm font-semibold text-foreground outline-none transition-colors hover:border-accent focus:border-accent"
    >
      {LANGS.map((l) => {
        const comingSoon = l.code === "sv";
        return (
          <option key={l.code} value={l.code} disabled={comingSoon}>
            {l.label}
            {comingSoon ? " (coming soon)" : ""}
          </option>
        );
      })}
    </select>
  );
}

export function Header({
  direction,
  onDirectionChange,
}: {
  direction?: Direction;
  onDirectionChange?: (d: Direction) => void;
}) {
  const { totalCount } = useVocab();
  const { user, askSignIn, signOut } = useAuth();

  return (
    <div className="border-b border-border">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-6 lg:px-10">
        <div className="flex items-center gap-3">
          <Link to="/" className="font-serif text-2xl font-extrabold tracking-tight">
            Annangsue
          </Link>
        </div>

        {direction && onDirectionChange ? (
          (() => {
            const { source, target } = splitDirection(direction);
            return (
              <div className="hidden items-center gap-2 md:flex">
                <LangSelect
                  label="Source language"
                  value={source}
                  onChange={(l) => onDirectionChange(`${l}-${target}` as Direction)}
                />
                <button
                  onClick={() => onDirectionChange(`${target}-${source}` as Direction)}
                  aria-label="Swap languages"
                  className="grid size-8 place-items-center rounded-full border border-input text-accent transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  ⇄
                </button>
                <LangSelect
                  label="Target language"
                  value={target}
                  onChange={(l) => onDirectionChange(`${source}-${l}` as Direction)}
                />
              </div>
            );
          })()
        ) : (
          <nav className="hidden items-center gap-6 text-sm text-mute md:flex">
            <Link to="/" activeProps={{ className: "text-foreground font-semibold" }}>
              Reader
            </Link>
            <Link to="/vocabulary" activeProps={{ className: "text-foreground font-semibold" }}>
              Vocabulary
            </Link>
          </nav>
        )}

        <div className="flex items-center gap-4">
          <Link to="/vocabulary" className="hidden text-sm text-mute sm:block">
            {totalCount} words saved
          </Link>
          <Link
            to="/vocabulary"
            aria-label="Vocabulary"
            className="grid size-9 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
          >
            V
          </Link>
          <div className="flex items-center gap-3 border-l border-border pl-4">
            {user ? (
              <>
                <span className="hidden max-w-40 truncate text-xs text-mute lg:block">
                  {user.email}
                </span>
                <button
                  onClick={() => void signOut()}
                  className="text-xs font-semibold text-mute transition-colors hover:text-foreground"
                >
                  Sign out
                </button>
              </>
            ) : (
              <button
                onClick={() =>
                  askSignIn("Sign in to save words and keep your books in the library.")
                }
                className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:opacity-90"
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
