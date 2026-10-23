/**
 * Perk trees (AW-95): the tree view for one person, and the level-up popup that leads into it.
 * Rules live in src/sim/perks; this only draws them and calls takePerk.
 */
import { STATION_INFO, type Station } from "../data/crew";
import { BRANCHES, PERKS, type PerkDef } from "../data/perks";
import {
  acknowledgeLevelUp,
  bonusLine,
  captainTitle,
  formatDuration,
  freePerkPoints,
  inTraining,
  levelForXp,
  officerAt,
  perkBlocker,
  perkHolder,
  takePerk,
  trainingEndsAt,
  wageAt,
  type CrewMember,
  type GameState,
  type LevelUp,
} from "../sim";
import { cr } from "./format";
import type { GameSession } from "./session";
import "./perks.css";

/** Who holds a station, for display: the captain's name or the officer's. */
function holderName(state: GameState, station: Station): string {
  if (station === "captain") return captainTitle(state.captain.name);
  return officerAt(state, station)?.name ?? "Nobody";
}

type PerkState = "taken" | "available" | "points" | "tiers" | "locked";

function perkState(state: GameState, station: Station, def: PerkDef): PerkState {
  const holder = perkHolder(state, station);
  if (!holder) return "tiers";
  if (holder.perks?.includes(def.id)) return "taken";
  if (def.needs) return "locked";
  const blocked = perkBlocker(holder, station, def);
  if (blocked === null) return "available";
  return blocked.startsWith("No perk points") ? "points" : "tiers";
}

function PerkCard({ session, station, def }: { session: GameSession; station: Station; def: PerkDef }) {
  const { state } = session;
  const st = perkState(state, station, def);
  const holder = perkHolder(state, station);
  const reason = holder ? perkBlocker(holder, station, def) : null;
  const away = inTraining(state, station);
  return (
    <div class={`perk perk-s-${st}`} title={reason ?? undefined}>
      <div class="perk-head">
        <span class="perk-tier muted">T{def.tier}</span>
        <strong class="perk-name">{def.name}</strong>
        {st === "taken" && <span class="tag good">taken</span>}
      </div>
      <div class="perk-text small">{def.text}</div>
      {st === "available" && (
        <button
          class="btn primary perk-take"
          disabled={away}
          title={away ? "They're away on a Lyceum course until it finishes." : undefined}
          onClick={() => session.act((s) => takePerk(s, station, def.id))}
        >
          Take this perk
        </button>
      )}
      {st === "points" && <div class="small accent">Ready: needs a perk point (each level brings one).</div>}
      {st === "tiers" && <div class="small muted">{reason}</div>}
      {st === "locked" && <div class="small perk-locked-note">Arrives with {def.needs}.</div>}
    </div>
  );
}

/** One person's tree: three branches, five tiers each. Picking works anywhere. */
export function PerkTreeModal({ session, station, onClose }: { session: GameSession; station: Station; onClose: () => void }) {
  const { state } = session;
  const info = STATION_INFO[station];
  const holder = perkHolder(state, station);
  const level = levelForXp(holder?.xp ?? 0);
  const free = holder ? freePerkPoints(holder) : 0;
  const taken = holder?.perks?.length ?? 0;
  const courseEnds = trainingEndsAt(state, station);
  return (
    <div class="overlay perk-overlay" onClick={onClose}>
      <div class="contracts perk-modal" onClick={(e) => e.stopPropagation()}>
        <div class="journal-head">
          <h2>
            {station === "captain" ? (
              <span class="accent">{holderName(state, station)}</span>
            ) : (
              <>
                <span class="accent">{info.title}</span> {holderName(state, station)}
              </>
            )}
          </h2>
          <span class="muted">
            Level {level} · {taken} perk{taken === 1 ? "" : "s"} taken
          </span>
          <span class={`perk-points ${free > 0 ? "has" : ""}`} title="Each level above 1 brings one perk point">
            {free} free point{free === 1 ? "" : "s"}
          </span>
          <button class="btn" onClick={onClose}>
            Close
          </button>
        </div>
        {!holder ? (
          <p class="danger">Nobody holds this post.</p>
        ) : (
          <div class="con-body perk-body">
            {courseEnds !== null && (
              <p class="accent small perk-note" role="status">
                On a Lyceum course: back in {formatDuration(Math.max(0, courseEnds - state.time))}. No perks can be taken until then; the points come back
                when it ends.
              </p>
            )}
            <p class="muted small perk-note">
              Tier n needs n−1 perks already taken in its branch. Nine points buy one branch and most of a second, never all three.
              {state.location.kind !== "intrepid" && " Retraining is offered aboard the Intrepid."}
            </p>
            <div class="perk-branches">
              {BRANCHES[station].map((branch) => (
                <div key={branch} class="perk-branch">
                  <h3>{branch}</h3>
                  {PERKS.filter((p) => p.station === station && p.branch === branch).map((def) => (
                    <PerkCard key={def.id} session={session} station={station} def={def} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The small celebration when somebody gains a level: shows the oldest entry in state.levelUps. */
export function LevelUpPopup({ session, up }: { session: GameSession; up: LevelUp }) {
  const { state } = session;
  const officer: CrewMember | null = up.station === "captain" ? null : officerAt(state, up.station);
  const holder = perkHolder(state, up.station);
  const free = holder ? freePerkPoints(holder) : 0;
  const line = bonusLine(state, up.station);
  const waiting = (state.levelUps?.length ?? 1) - 1;
  const dismiss = (): void => {
    session.act(acknowledgeLevelUp);
  };
  return (
    <div class="overlay levelup-overlay">
      <div class="levelup" role="dialog" aria-label="Level up">
        <div class="levelup-burst" aria-hidden="true">
          ✦
        </div>
        <div class="levelup-kicker">Level up</div>
        <div class="levelup-who">
          <span class="accent">{up.station === "captain" ? "" : STATION_INFO[up.station].title}</span> <strong>{up.name}</strong>
        </div>
        <div class="levelup-level">
          reached <strong>level {up.level}</strong>
        </div>
        <dl class="kv levelup-kv">
          {line && (
            <>
              <dt>Now gives</dt>
              <dd class="good">{line}</dd>
            </>
          )}
          {officer && (
            <>
              <dt>Wage</dt>
              <dd>
                {cr(wageAt(up.level - 1, officer.clan))} → <span class="accent">{cr(wageAt(up.level, officer.clan))}</span> / day
              </dd>
            </>
          )}
          <dt>Perk points</dt>
          <dd class={free > 0 ? "accent" : "muted"}>{free} to spend</dd>
        </dl>
        <div class="btn-row levelup-actions">
          <button
            class="btn primary"
            onClick={() => {
              session.act(acknowledgeLevelUp);
              session.openPerkTree(up.station);
            }}
          >
            Choose a perk
          </button>
          <button class="btn" onClick={dismiss} title="The point stays banked until you spend it">
            Later
          </button>
        </div>
        {waiting > 0 && <div class="muted small">{waiting} more waiting</div>}
      </div>
    </div>
  );
}
