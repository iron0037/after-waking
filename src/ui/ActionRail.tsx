/**
 * The action rail (AW-255, docs/ui_design.md): the verbs for where you are and what you're driving, as a
 * column of icon buttons on the map's edge beside the side panel. Only actions that make sense here
 * are listed; one that can't be taken right now stays, dimmed, and its tooltip says why.
 */
import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon, type IconName } from "./icons";
import "./rail.css";

export interface RailAction {
  id: string;
  icon: IconName;
  label: string;
  /** What it does, shown under the label in the tooltip. */
  detail?: string;
  /** Shown as a key cap in the tooltip. */
  hotkey?: string;
  /** Why it can't be taken right now; the button stays, dimmed. */
  blocked?: string | null;
  /** A mode it toggles is on (e.g. picking where to hop). */
  active?: boolean;
  tone?: "danger";
  onClick: () => void;
  /** Called as the pointer comes and goes, e.g. to preview a route on the map. */
  onHover?: (on: boolean) => void;
  /**
   * Choices to pick from (AW-261): the button opens a small menu beside the rail instead of acting
   * straight away, e.g. a probe's dive depth. `onClick` isn't used for these.
   */
  menu?: RailMenuItem[];
}

export interface RailMenuItem {
  id: string;
  label: string;
  /** A second line: odds, cost, what you'd get. */
  detail?: string;
  /** Why this choice can't be taken; it stays, dimmed. */
  blocked?: string | null;
  onClick: () => void;
}

export interface RailGroup {
  label: string;
  actions: RailAction[];
}

export function ActionRail({ groups, busy = false }: { groups: RailGroup[]; busy?: boolean }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  // A click anywhere else, or Escape, closes an open menu.
  useEffect(() => {
    if (!openMenu) return;
    const away = (ev: MouseEvent) => {
      if (!navRef.current?.contains(ev.target as Node)) setOpenMenu(null);
    };
    const esc = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [openMenu]);
  const shown = groups.filter((g) => g.actions.length > 0);
  if (shown.length === 0) return null;
  return (
    <nav class="action-rail" aria-label="Actions" ref={navRef}>
      {shown.map((g, gi) => (
        <Fragment key={g.label}>
          {gi > 0 && <div class="rail-sep" />}
          <div class="rail-label">{g.label}</div>
          {g.actions.map((a) => {
            const blocked = busy ? "Wait for the current action to finish." : (a.blocked ?? null);
            const menuOpen = openMenu === a.id && !blocked && !!a.menu;
            return (
              <div key={a.id} class="rail-slot">
              <button
                class={`rail-btn ${a.active || menuOpen ? "active" : ""} ${a.tone ?? ""} ${blocked ? "blocked" : ""} ${menuOpen ? "menu-open" : ""}`}
                aria-label={a.label}
                aria-disabled={blocked ? true : undefined}
                aria-pressed={a.active === undefined ? undefined : a.active}
                aria-haspopup={a.menu ? "menu" : undefined}
                aria-expanded={a.menu ? menuOpen : undefined}
                onClick={() => {
                  if (blocked) return;
                  if (a.menu) setOpenMenu(menuOpen ? null : a.id);
                  else a.onClick();
                }}
                onMouseEnter={a.onHover && (() => a.onHover?.(true))}
                onMouseLeave={a.onHover && (() => a.onHover?.(false))}
              >
                <Icon name={a.icon} />
                <span class="rail-tip" role="tooltip">
                  <span class="rail-tip-head">
                    {a.label}
                    {a.hotkey && <kbd>{a.hotkey}</kbd>}
                  </span>
                  {blocked ? <span class="rail-tip-why">{blocked}</span> : a.detail && <span class="rail-tip-detail">{a.detail}</span>}
                </span>
              </button>
              {menuOpen && (
                <div class="rail-menu" role="menu" aria-label={a.label}>
                  <div class="rail-menu-head">{a.label}</div>
                  {a.menu!.map((m) => (
                    <button
                      key={m.id}
                      role="menuitem"
                      class={`rail-menu-item ${m.blocked ? "blocked" : ""}`}
                      aria-disabled={m.blocked ? true : undefined}
                      title={m.blocked ?? undefined}
                      onClick={() => {
                        if (m.blocked) return;
                        setOpenMenu(null);
                        m.onClick();
                      }}
                    >
                      <span class="rail-menu-label">{m.label}</span>
                      {(m.blocked || m.detail) && <span class={m.blocked ? "rail-tip-why" : "rail-tip-detail"}>{m.blocked ?? m.detail}</span>}
                    </button>
                  ))}
                </div>
              )}
              </div>
            );
          })}
        </Fragment>
      ))}
    </nav>
  );
}
