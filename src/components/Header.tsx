import { Link } from "@tanstack/react-router";
import { useVocab } from "@/lib/vocab";
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
      {LANGS.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
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
  const { entries } = useVocab();

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
            <Link to="/study" activeProps={{ className: "text-foreground font-semibold" }}>
              Study
            </Link>
          </nav>
        )}

        <div className="flex items-center gap-4">
          <Link to="/vocabulary" className="hidden text-sm text-mute sm:block">
            {entries.length} words saved
          </Link>
          <Link
            to="/study"
            className="grid size-9 place-items-center rounded-full bg-primary font-serif text-sm text-primary-foreground"
          >
            学
          </Link>
        </div>
      </div>
    </div>
  );
}
