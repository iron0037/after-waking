/**
 * The selected creature (AW-215, AW-225): its portrait, how it behaves, and the odds of taking it from where the
 * vehicle stands. The attempt itself is settled at once in src/sim/creatures.ts; the rover doesn't move.
 */
import {
  captureBlockers,
  captureCreature,
  captureOdds,
  collectCreature,
  compendiumKey,
  DOWNED_DAYS,
  formatDuration,
  isHunter,
  type LiveCreature,
  type RoverState,
} from "../../../sim";
import { hexDistance } from "../../../sim/hex";
import { DAY } from "../../../sim/units";
import { CompIcon, useSpriteIndex } from "../../compendiumSprites";
import { Section } from "../../Section";
import type { GameSession } from "../../session";
import { TEMPERAMENT_COLOR } from "./mapDraw";

const TEMPERAMENT: Record<string, { label: string; cls: string; hint: string }> = {
  hostile: { label: "hunter", cls: "danger", hint: "Comes after the rover when it notices it. Keeps clear of the freighter." },
  territorial: { label: "territorial", cls: "warn", hint: "Ignores you unless you come onto its patch." },
  skittish: { label: "skittish", cls: "", hint: "Runs from the rover. Nets, a long reach or fast motors help." },
  docile: { label: "docile", cls: "good", hint: "Pays the rover no mind, until it's shot at." },
};

const pct = (p: number) => `${Math.round(p * 100)}%`;

export function CreaturePanel({
  session,
  creature: c,
  rover,
  goTo,
  busy,
}: {
  session: GameSession;
  creature: LiveCreature;
  rover: RoverState | null;
  /** Drives the vehicle alongside; resolves true once it's there. */
  goTo: () => Promise<boolean>;
  busy: boolean;
}) {
  const state = session.state;
  const sprites = useSpriteIndex();
  const t = TEMPERAMENT[c.entry.temperament] ?? TEMPERAMENT.docile!;
  const dist = rover ? hexDistance(rover, c) : null;
  const blockers = c.down ? [] : captureBlockers(state, session.world, c.key);
  const odds = c.down || !rover ? null : captureOdds(state, session.world, c.key);
  const left = c.downAt !== undefined ? c.downAt + DOWNED_DAYS * DAY - state.time : 0;
  const hunter = isHunter(c.entry);

  const capture = (): void => {
    session.act((s, w) => captureCreature(s, w, c.key));
  };
  const collect = async (): Promise<void> => {
    if (rover && hexDistance(rover, c) > 1 && !(await goTo())) return;
    const r = session.act((s, w) => collectCreature(s, w, c.key));
    if (r.ok) session.notify(`Loaded the ${r.value} into the sample cases.`);
  };

  return (
    <Section id="creature" title="Selected creature" class="deposit-panel" revealKey={c.key}>
      <div class="creature-head">
        <CompIcon index={sprites} entryKey={compendiumKey("fauna", c.entry.id)} color={c.entry.color} found />
        <div>
          <div class="dep-title">
            <span class="creature-dot" style={{ background: TEMPERAMENT_COLOR[c.entry.temperament] }} />
            <span>{c.entry.name}</span>
          </div>
          <div class="dep-title">
            <span class={`tag ${t.cls}`} title={t.hint}>
              {t.label}
            </span>
            {c.entry.size === 2 && <span class="tag" title="Takes two specimen slots">large</span>}
            {c.entry.aquatic && <span class="tag sea">sea life</span>}
            {c.entry.badlands && <span class="tag danger">Badlands</span>}
          </div>
        </div>
      </div>
      <p class="small muted">{c.entry.blurb}</p>
      <dl class="kv">
        <dt>Position</dt>
        <dd>
          {c.x}, {c.y}
          {dist !== null && <span class="muted"> · {dist} tiles</span>}
        </dd>
        {!c.down && c.hp < c.maxHp && (
          <>
            <dt>Worn down</dt>
            <dd>{pct((c.maxHp - c.hp) / c.maxHp)}</dd>
          </>
        )}
      </dl>
      {c.down ? (
        <>
          <p class="small">Out cold. It will wake and wander off in {formatDuration(Math.max(0, left))}.</p>
          <div class="dep-actions">
            <button class="btn primary" disabled={busy || !rover} onClick={() => void collect()} title={`Drive alongside and load it (${c.entry.size} slot${c.entry.size === 1 ? "" : "s"}, 30 min)`}>
              Collect
            </button>
          </div>
        </>
      ) : (
        <>
          {odds && (
            <dl class="kv capture-odds">
              <dt>Odds</dt>
              <dd class={odds.chance >= 0.6 ? "good" : odds.chance >= 0.3 ? "accent" : "danger"}>{pct(odds.chance)}</dd>
              <dt>Energy</dt>
              <dd>
                about {Math.round(odds.energy)} <span class="muted">of {Math.round(odds.budget)} to spare</span>
              </dd>
              <dt>Time</dt>
              <dd>about {formatDuration(odds.minutes)}</dd>
              <dt>Gear</dt>
              <dd>{odds.method}</dd>
              {hunter && (
                <>
                  <dt>Crew</dt>
                  <dd class={odds.injuryRisk >= 0.25 ? "danger" : ""}>{pct(odds.injuryRisk)} chance someone is hurt</dd>
                  {odds.wreckRisk > 0 && (
                    <>
                      <dt>Rover</dt>
                      <dd class="danger">{pct(odds.wreckRisk)} chance it's wrecked if this fails</dd>
                    </>
                  )}
                </>
              )}
            </dl>
          )}
          {odds && odds.notes.length > 0 && (
            <ul class="small muted capture-notes">
              {odds.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <p class="small muted">
            {hunter ? "The crew fights it from where the rover stands." : "The crew runs it down and comes back to this spot."} If it works, the energy it took comes off the cells; if not,
            the rover is left with just enough to get home.
          </p>
          {blockers.length > 0 && (
            <ul class="blockers">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          <div class="dep-actions">
            <button class={`btn ${hunter ? "danger" : "primary"}`} disabled={busy || blockers.length > 0} onClick={capture}>
              Attempt capture{odds && blockers.length === 0 ? ` (${pct(odds.chance)})` : ""}
            </button>
          </div>
        </>
      )}
    </Section>
  );
}
