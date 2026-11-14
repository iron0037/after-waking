/**
 * The action rail (AW-255, docs/ui_design.md): the verbs for where you are and what you're driving, as a
 * column of icon buttons on the map's edge beside the side panel. Only actions that make sense here
 * are listed; one that can't be taken right now stays, dimmed, and its tooltip says why.
 */
import { Fragment } from "preact";
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
}

export interface RailGroup {
  label: string;
  actions: RailAction[];
}

export function ActionRail({ groups, busy = false }: { groups: RailGroup[]; busy?: boolean }) {
  const shown = groups.filter((g) => g.actions.length > 0);
  if (shown.length === 0) return null;
  return (
    <nav class="action-rail" aria-label="Actions">
      {shown.map((g, gi) => (
        <Fragment key={g.label}>
          {gi > 0 && <div class="rail-sep" />}
          <div class="rail-label">{g.label}</div>
          {g.actions.map((a) => {
            const blocked = busy ? "Wait for the current action to finish." : (a.blocked ?? null);
            return (
              <button
                key={a.id}
                class={`rail-btn ${a.active ? "active" : ""} ${a.tone ?? ""} ${blocked ? "blocked" : ""}`}
                aria-label={a.label}
                aria-disabled={blocked ? true : undefined}
                aria-pressed={a.active === undefined ? undefined : a.active}
                onClick={() => {
                  if (!blocked) a.onClick();
                }}
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
            );
          })}
        </Fragment>
      ))}
    </nav>
  );
}
