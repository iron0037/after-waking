import { useMemo, useState } from "preact/hooks";
import { formatDate, type JournalKind } from "../sim";
import type { GameSession } from "./session";

const KINDS: { kind: JournalKind; label: string }[] = [
  { kind: "discovery", label: "Discoveries" },
  { kind: "travel", label: "Travel" },
  { kind: "trade", label: "Trade" },
  { kind: "warning", label: "Warnings" },
  { kind: "info", label: "Other" },
];

export function Journal({ session, onClose }: { session: GameSession; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<Set<JournalKind>>(new Set());
  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return session.state.journal
      .filter((e) => !hidden.has(e.kind) && (!q || e.text.toLowerCase().includes(q)))
      .slice()
      .reverse();
  }, [session.state.journal.length, query, hidden]);

  const toggle = (kind: JournalKind) => {
    const next = new Set(hidden);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setHidden(next);
  };

  return (
    <div class="overlay" onClick={onClose}>
      <div class="journal" onClick={(e) => e.stopPropagation()}>
        <div class="journal-head">
          <h2>Captain's journal</h2>
          <input
            class="search"
            placeholder="Search…"
            value={query}
            autoFocus
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
          <button class="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div class="chips">
          {KINDS.map(({ kind, label }) => (
            <button key={kind} class={`chip kind-${kind} ${hidden.has(kind) ? "off" : ""}`} onClick={() => toggle(kind)}>
              {label}
            </button>
          ))}
        </div>
        <ol class="journal-list">
          {entries.map((e, i) => (
            <li key={i} class={`kind-${e.kind}`}>
              <span class="when">{formatDate(e.t)}</span>
              <span class="what">{e.text}</span>
            </li>
          ))}
          {entries.length === 0 && <li class="muted">Nothing matches.</li>}
        </ol>
      </div>
    </div>
  );
}
