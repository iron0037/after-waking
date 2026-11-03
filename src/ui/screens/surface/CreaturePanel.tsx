/**
 * The selected creature (AW-215/216): what it is, how it behaves, and the orders the crew can take: attempt a
 * capture, or load one that's already down. The fight itself is worked out in src/sim/creatures.ts.
 */
import { VEHICLE_WEAPONS } from "../../../data/vehicleWeapons";
import {
  captureBlockers,
  captureCreature,
  collectCreature,
  DOWNED_DAYS,
  formatDuration,
  isHunter,
  vehicleWeapons,
  type LiveCreature,
  type RoverState,
} from "../../../sim";
import { hexDistance } from "../../../sim/hex";
import { DAY } from "../../../sim/units";
import { Section } from "../../Section";
import type { GameSession } from "../../session";

const TEMPERAMENT: Record<string, { label: string; cls: string; hint: string }> = {
  hostile: { label: "hunter", cls: "danger", hint: "Comes after the rover when it notices it. Keeps clear of the freighter." },
  territorial: { label: "territorial", cls: "danger", hint: "Ignores you unless you come onto its patch." },
  skittish: { label: "skittish", cls: "", hint: "Runs from the rover. Nets, a long reach or fast motors help." },
  docile: { label: "docile", cls: "good", hint: "Pays the rover no mind, until it's shot at." },
};

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
  const t = TEMPERAMENT[c.entry.temperament] ?? TEMPERAMENT.docile!;
  const dist = rover ? hexDistance(rover, c) : null;
  const gear = vehicleWeapons(state);
  const blockers = c.down ? [] : captureBlockers(state, session.world, c.key);
  const left = c.downAt !== undefined ? c.downAt + DOWNED_DAYS * DAY - state.time : 0;

  const capture = (): void => {
    const r = session.act((s, w) => captureCreature(s, w, c.key));
    if (r.ok) session.notify(r.value.text, r.value.outcome === "disabled" ? "error" : undefined);
  };
  const collect = async (): Promise<void> => {
    if (rover && hexDistance(rover, c) > 1 && !(await goTo())) return;
    const r = session.act((s, w) => collectCreature(s, w, c.key));
    if (r.ok) session.notify(`Loaded the ${r.value} into the sample cases.`);
  };

  return (
    <Section id="creature" title="Selected creature" class="deposit-panel" revealKey={c.key}>
      <div class="dep-title">
        <span class="creature-dot" style={{ background: c.entry.color }} />
        <span>{c.entry.name}</span>
        <span class={`tag ${t.cls}`} title={t.hint}>
          {t.label}
        </span>
        {c.entry.size === 2 && <span class="tag" title="Takes two specimen slots">large</span>}
        {c.entry.aquatic && <span class="tag sea">sea life</span>}
        {c.entry.badlands && <span class="tag danger">Badlands</span>}
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
            <dd>{Math.round((100 * (c.maxHp - c.hp)) / c.maxHp)}%</dd>
          </>
        )}
        <dt>Gear aboard</dt>
        <dd>{gear.length === 0 ? <span class="danger">offline until the yard repairs it</span> : gear.map((w) => VEHICLE_WEAPONS[w.id]?.name).join(", ")}</dd>
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
          <p class="small muted">
            {isHunter(c.entry)
              ? "Capture: the rover closes until it's noticed, then holds its ground and fights until the creature drops."
              : "Capture: the rover chases it down with whatever reaches: nets take it, stunners wear it down."}{" "}
            It breaks off with enough energy to get home, plus a margin.
          </p>
          {blockers.length > 0 && (
            <ul class="blockers">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          <div class="dep-actions">
            <button class={`btn ${isHunter(c.entry) ? "danger" : "primary"}`} disabled={busy || blockers.length > 0} onClick={capture}>
              Attempt capture
            </button>
          </div>
        </>
      )}
      {DOWNED_DAYS > 0 && !c.down && <p class="small muted">Creatures are always taken alive. One brought down waits, stunned, for {DOWNED_DAYS} days.</p>}
    </Section>
  );
}
