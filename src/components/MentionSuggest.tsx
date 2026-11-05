import { avatarFor } from "@/lib/format";
import type { Database } from "@/lib/database.types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// The "@partial" right before the cursor, if any.
export function mentionQuery(value: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([A-Za-z0-9_.+-]*)$/.exec(value.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2].toLowerCase() };
}

export function mentionMatches(members: Profile[], query: string) {
  return members
    .filter((p) => p.name.toLowerCase().includes(query) || p.handle.toLowerCase().includes(query))
    .slice(0, 8);
}

export function MentionSuggest({
  items,
  active,
  onPick,
}: {
  items: Profile[];
  active: number;
  onPick: (p: Profile) => void;
}) {
  return (
    <div role="listbox" aria-label="Mencionar" className="mb-1.5 rounded-xl border border-border bg-card p-1 shadow-xl">
      <div className="px-2 py-1 text-[11px] uppercase font-semibold text-muted-foreground">Membros</div>
      {items.map((p, i) => (
        <button
          key={p.id}
          role="option"
          aria-selected={i === active}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(p);
          }}
          className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
            i === active ? "bg-secondary" : "hover:bg-secondary/50"
          }`}
        >
          <img src={avatarFor(p)} alt="" className="w-6 h-6 rounded-full object-cover" />
          <span className="font-medium truncate">{p.name}</span>
          <span className="ml-auto text-xs text-muted-foreground truncate">@{p.handle}</span>
        </button>
      ))}
    </div>
  );
}
