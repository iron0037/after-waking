/** A side-panel section with a clickable header that folds it. Folded state is remembered per section. */
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import "./fold.css";

/** Kept under its original key so folds made before the Shipyard used it carry over. */
const FOLD_KEY = "after-waking/ui/surface-folded";

let folded: Record<string, boolean> | null = null;

function foldedMap(): Record<string, boolean> {
  if (folded) return folded;
  folded = {};
  try {
    const raw = localStorage.getItem(FOLD_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (v === true) folded[k] = true;
    }
  } catch {
    /* storage unavailable: sections just start unfolded */
  }
  return folded;
}

function remember(id: string, isFolded: boolean): void {
  const map = foldedMap();
  if (isFolded) map[id] = true;
  else delete map[id];
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Make sure a section starts unfolded the next time it mounts (an already-mounted one needs its revealKey bumped). */
export function unfoldSection(id: string): void {
  remember(id, false);
}

export function Section({
  id,
  title,
  level = 3,
  class: className = "",
  summary,
  revealKey,
  children,
}: {
  id: string;
  title: string;
  level?: 2 | 3;
  class?: string;
  /** Shown beside the title while folded. */
  summary?: string;
  /** When this changes, the section unfolds (e.g. a new selection). */
  revealKey?: string | number | null;
  children: ComponentChildren;
}) {
  const [open, setOpen] = useState(() => !foldedMap()[id]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (revealKey !== null && revealKey !== undefined) {
      setOpen(true);
      remember(id, false);
    }
  }, [revealKey]);

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    remember(id, !next);
  };
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div id={`sec-${id}`} class={`panel fold ${open ? "" : "folded"} ${className}`}>
      <div
        class="fold-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        title={open ? "Click to fold" : "Click to unfold"}
        onClick={toggle}
        onKeyDown={(ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            toggle();
          }
        }}
      >
        <span class="chev" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <Heading>{title}</Heading>
        {!open && summary && <span class="fold-summary muted small">{summary}</span>}
      </div>
      {open && <div class="fold-body">{children}</div>}
    </div>
  );
}
