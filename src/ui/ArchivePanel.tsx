/**
 * The Archive's first-run guidance (AW-24): a small card in the corner that annotates each procedure the first time
 * it comes up. What is due is decided in src/sim/archive.ts; this only shows it. Screens raise their own topics
 * ("starmap", "market", ...) with useArchiveTopic while the thing being explained is on screen.
 */
import { useEffect } from "preact/hooks";
import type { ArchiveTrigger } from "../data/archive";
import { archiveNext, archiveText, dismissArchive, setGuidance } from "../sim";
import { useSession, type GameSession } from "./session";
import "./archive.css";

/** Tell the Archive a screen is showing something it explains, for as long as this component is mounted and `active`. */
export function useArchiveTopic(session: GameSession, trigger: ArchiveTrigger, active = true): void {
  useEffect(() => {
    if (!active) return;
    session.raiseTopic(trigger);
    return () => session.dropTopic(trigger);
  }, [session, trigger, active]);
}

/**
 * `floating`: a window is open over the game (an encounter, the journal, a dive...). Normally the card is a strip docked
 * between the screen and the journal footer, so it takes room instead of covering anything; over a window it
 * floats in the left margin, above the dimmed overlay, where the centred window leaves room.
 */
export function ArchivePanel({ session, floating }: { session: GameSession; floating: boolean }) {
  useSession(session);
  // Nothing pops up over a flight or a time-lapse: it waits until the time has passed.
  if (session.busy) return null;
  const entry = archiveNext(session.state, session.screenTopics());
  if (!entry) return null;
  return (
    <aside class={`archive-panel ${floating ? "archive-float" : "archive-dock"}`} key={`${entry.id}${floating}`} role="note" aria-label="The Archive">
      <div class="archive-head">
        <div class="archive-kicker">
          <span class="archive-glyph" aria-hidden="true">
            ◈
          </span>
          <span>ARCHIVE</span>
          <span class="archive-rule" aria-hidden="true" />
        </div>
        <h4 class="archive-title">{entry.title}</h4>
      </div>
      <div class="archive-body">
        <p class="archive-text">{archiveText(session.state, entry)}</p>
        {entry.gloss && (
          <p class="archive-gloss">
            <span class="archive-gloss-label">Lyceum gloss</span>
            {entry.gloss}
          </p>
        )}
      </div>
      <div class="archive-side">
        <div class="archive-actions">
          <button class="btn primary" onClick={() => session.act((s) => dismissArchive(s, entry.id), { timelapse: false })}>
            Understood
          </button>
          <button
            class="btn archive-silence"
            title="Stop the Archive's notes. You can turn them back on in the Journal."
            onClick={() => {
              session.act((s) => setGuidance(s, false), { timelapse: false });
              session.notify("The Archive is silenced. Turn it back on in the Journal.");
            }}
          >
            Silence the Archive
          </button>
        </div>
        <p class="archive-note">Silenced notes can be turned back on in the Journal.</p>
      </div>
    </aside>
  );
}
