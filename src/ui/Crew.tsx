/**
 * Crew views: the roster (the captain and five officers), the hiring hall, and a read-only
 * overlay for looking at the crew away from the Intrepid. Rules and numbers live in src/sim/crew.
 */
import { useState } from "preact/hooks";
import { CAPTAIN_CLANS } from "../data/clans";
import { CLAN_TRAITS, STATION_INFO, STATIONS, UPBRINGINGS, type Station } from "../data/crew";
import { PERKS_BY_ID } from "../data/perks";
import { CLAN_NAMES } from "../data/ship";
import {
  ageAt,
  bonusLine,
  captainTitle,
  dailyWages,
  dailyUpkeep,
  freePerkPoints,
  formatDuration,
  hasPerk,
  hireRecruit,
  isMiserable,
  levelForXp,
  upbringingOf,
  levelProgress,
  MAX_CREW_SHARE,
  MAX_LEVEL,
  moodLevel,
  officerAt,
  perkHolder,
  retrain,
  retrainCost,
  setCrewShare,
  signingFee,
  startingLoyalty,
  trainingEndsAt,
  wageOf,
  xpForLevel,
  type CrewMember,
  type MoodLevel,
  type Recruit,
} from "../sim";
import { cr } from "./format";
import { captainSeed, Portrait } from "./portraits";
import type { GameSession } from "./session";
import "./crew.css";
import "./perks.css";

const trained = (m: CrewMember): boolean => CLAN_TRAITS[m.clan].affinity.includes(m.station);

function LevelMeter({ xp }: { xp: number }) {
  const level = levelForXp(xp);
  const max = level >= MAX_LEVEL;
  const lo = xpForLevel(level);
  const hi = xpForLevel(level + 1);
  return (
    <div class="crew-level">
      <div class="crew-level-row">
        <span>Level {level}</span>
        <span class="muted small">{max ? "max" : `${Math.floor(xp - lo)} / ${hi - lo} xp to ${level + 1}`}</span>
      </div>
      <div class={`bar crew-bar ${max ? "full" : ""}`} title={max ? "Top of the ladder" : `${Math.round(levelProgress(xp) * 100)}% of the way to level ${level + 1}`}>
        <span style={{ width: `${Math.round(levelProgress(xp) * 100)}%` }} />
      </div>
    </div>
  );
}

/** Upbringing: the second half of a background (born after the Waking, or a sleeper). Hover for who they are and what it does. */
function UpbringingTag({ m }: { m: CrewMember }) {
  const up = UPBRINGINGS[upbringingOf(m)];
  return (
    <span class="tag" title={`${up.text}\n${up.effect}`}>
      {up.name}
    </span>
  );
}

function ClanLine({ m }: { m: CrewMember }) {
  return (
    <div class="crew-clan">
      <span class="tag">{CLAN_NAMES[m.clan]}</span>
      {trained(m) && (
        <span class="tag good" title={`${CLAN_NAMES[m.clan]} trains for this station: earns +25% experience here, and starts further along.`}>
          trained
        </span>
      )}
      <span class="muted small">{CLAN_TRAITS[m.clan].trait}</span>
      <UpbringingTag m={m} />
    </div>
  );
}

/** The perks somebody has taken, as small tags (hover for what each does). */
function PerkTags({ perks }: { perks: readonly string[] | undefined }) {
  const defs = (perks ?? []).map((id) => PERKS_BY_ID.get(id)).filter((p) => p !== undefined);
  if (defs.length === 0) return <span class="muted small">no perks yet</span>;
  return (
    <div class="perk-tags">
      {defs.map((p) => (
        <span key={p.id} class="tag good" title={`${p.branch}, tier ${p.tier}: ${p.text}`}>
          {p.name}
        </span>
      ))}
    </div>
  );
}

/** Perk tree button (with banked points) and, aboard the Intrepid, the Lyceum retraining course. */
function PerkActions({ session, station }: { session: GameSession; station: Station }) {
  const { state } = session;
  const [confirming, setConfirming] = useState(false);
  const holder = perkHolder(state, station);
  if (!holder) return null;
  const free = freePerkPoints(holder);
  const taken = holder.perks?.length ?? 0;
  const level = levelForXp(holder.xp ?? 0);
  const cost = retrainCost(level);
  const aboard = state.location.kind === "intrepid";
  const short = cost.credits - state.credits;
  const courseEnds = trainingEndsAt(state, station);
  return (
    <>
      {courseEnds !== null && (
        <div class="accent small crew-course" role="status">
          On a Lyceum course: back in {formatDuration(Math.max(0, courseEnds - state.time))}. No perks can be taken until then.
        </div>
      )}
      <div class="crew-actions">
        <button class={`btn ${free > 0 ? "primary" : ""}`} onClick={() => session.openPerkTree(station)}>
          Perks
          {free > 0 && (
            <span class="badge" title={`${free} unspent perk point${free === 1 ? "" : "s"}`}>
              {free}
            </span>
          )}
        </button>
        {aboard && !confirming && courseEnds === null && (
          <button
            class="btn"
            disabled={taken === 0 || short > 0}
            onClick={() => setConfirming(true)}
            title={
              taken === 0
                ? "No perks to unlearn yet."
                : short > 0
                  ? `You need ${cr(short)} more.`
                  : `The Lyceum refunds ${taken} point${taken === 1 ? "" : "s"} for ${cr(cost.credits)} and ${cost.days} days. It runs alongside other yard work, and the ship can't leave until it ends.`
            }
          >
            Retrain (Lyceum) · {cr(cost.credits)} · {cost.days} d
          </button>
        )}
      </div>
      {aboard && confirming && courseEnds === null && (
        <div class="crew-retrain-confirm">
          <span class="small">
            A Lyceum course takes <strong class="accent">{cost.days} days</strong> and <strong class="accent">{cr(cost.credits)}</strong>. It wipes{" "}
            {taken} perk{taken === 1 ? "" : "s"} and gives the point{taken === 1 ? "" : "s"} back when it ends. The course runs alongside other yard work, but the ship can't leave until it's over, and meanwhile they can't take perks. Nothing
            advances the clock until you wait or fly; wages keep accruing.
          </span>
          <div class="btn-row">
            <button
              class="btn danger"
              onClick={() => {
                setConfirming(false);
                session.act((s) => retrain(s, station));
              }}
            >
              Start the course
            </button>
            <button class="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

const MOOD_LABEL: Record<MoodLevel, string> = { low: "Low", medium: "Medium", high: "High" };
const MOOD_CLASS: Record<MoodLevel, string> = { low: "danger", medium: "muted", high: "good" };

const HAPPINESS_TIP =
  "How they feel lately. Finds, level-ups, good trips, shore leave aboard the Intrepid and bonuses lift it; long hauls, losing trips, unpaid wages and incidents lower it. It settles back toward neutral over a few weeks.";
const LOYALTY_TIP =
  "Their long-term bond with you. It grows with sustained happiness, bonuses and work for their clan, and sinks when they're unhappy for long. Freebooters start low. Low spirits and low loyalty together make an officer give notice.";

/** Low / Medium / High, coloured; with Read the Room also the exact 0-100 score and a bar. */
function Mood({ value, exact }: { value: number; exact: boolean }) {
  const level = moodLevel(value);
  return (
    <span class="crew-mood">
      {exact && (
        <span class={`bar crew-mood-bar mood-${level}`} title={`${Math.round(value)} / 100`}>
          <span style={{ width: `${Math.round(value)}%` }} />
        </span>
      )}
      <span class={MOOD_CLASS[level]}>{MOOD_LABEL[level]}</span>
      {exact && <span class="muted small">{Math.round(value)}</span>}
    </span>
  );
}

/** Happiness and loyalty rows for an officer's definition list. */
function MoodRows({ m, exact }: { m: CrewMember; exact: boolean }) {
  return (
    <>
      <dt class="crew-help" title={HAPPINESS_TIP}>
        Happiness
      </dt>
      <dd title={HAPPINESS_TIP}>
        <Mood value={m.happiness ?? 60} exact={exact} />
      </dd>
      <dt class="crew-help" title={LOYALTY_TIP}>
        Loyalty
      </dt>
      <dd title={LOYALTY_TIP}>
        <Mood value={m.loyalty ?? startingLoyalty(m.clan, false)} exact={exact} />
      </dd>
    </>
  );
}

/** Warnings under a card's heading: on notice, and miserable. */
function MoodWarnings({ m }: { m: CrewMember }) {
  const miserable = isMiserable(m);
  if (m.noticeAt === undefined && !miserable) return null;
  return (
    <>
      {m.noticeAt !== undefined && (
        <div class="crew-notice" role="alert">
          <strong>Has given notice: leaves at the next docking unless things improve.</strong>
          <span class="small">Shore leave aboard the Intrepid, a bonus share of the spoils or a good trip can change their mind.</span>
        </div>
      )}
      {miserable && (
        <div>
          <span class="tag danger" title="Happiness is below 25: they just go through the motions, and their station gives the bonuses of one level lower until things pick up.">
            Miserable: working below their level
          </span>
        </div>
      )}
    </>
  );
}

function PersonCard({ session, station, onHall }: { session: GameSession; station: Station; onHall?: () => void }) {
  const { state } = session;
  const info = STATION_INFO[station];
  if (station === "captain") {
    return (
      <div class="panel crew-card">
        <div class="hub-card-head">
          <div class="crew-who">
            <Portrait state={state} seed={captainSeed(state.captain)} name={state.captain.name} age={ageAt(state.captain.born, state.time)} />
            <div>
              <span class="accent">{info.title}</span> <strong>{captainTitle(state.captain.name).replace(/^Captain\s+/i, "")}</strong>
            </div>
          </div>
          <span class="muted small">age {ageAt(state.captain.born, state.time)}</span>
        </div>
        <div class="muted small">That's you. Captains draw no wage; the Exchange takes its cut elsewhere.</div>
        <LevelMeter xp={state.captain.xp ?? 0} />
        {state.captain.clan && (
          <div class="crew-clan small" title={`${CAPTAIN_CLANS[state.captain.clan].perk}\n${CAPTAIN_CLANS[state.captain.clan].cost}`}>
            <span class="tag">{CLAN_NAMES[state.captain.clan]} clan</span>
            <div class="good">{CAPTAIN_CLANS[state.captain.clan].perk}</div>
            <div class="muted">{CAPTAIN_CLANS[state.captain.clan].cost}</div>
          </div>
        )}
        <dl class="kv crew-kv">
          <dt>Wage</dt>
          <dd class="muted">none</dd>
          <dt>Learns from</dt>
          <dd>{info.learnsFrom}</dd>
          <dt>Gives now</dt>
          <dd class="good">{bonusLine(state, station)}</dd>
        </dl>
        <PerkTags perks={state.captain.perks} />
        <PerkActions session={session} station={station} />
      </div>
    );
  }
  const m = officerAt(state, station);
  if (!m) {
    const aboard = state.location.kind === "intrepid";
    const lost = bonusLine(state, station, 0);
    return (
      <div class="panel crew-card crew-empty">
        <div class="hub-card-head">
          <span class="accent">{info.title}</span>
          <span class="tag danger">post empty</span>
        </div>
        <div class="danger small">Post empty: sign someone at the hiring hall.</div>
        <dl class="kv crew-kv">
          <dt>Improves</dt>
          <dd>{info.improves}</dd>
          <dt>Meanwhile</dt>
          <dd class="danger">{lost || "nothing"}</dd>
        </dl>
        <div class="crew-actions">
          {aboard ? (
            <button
              class="btn primary"
              title="Jump to this month's recruits"
              onClick={() => {
                onHall?.();
                session.showHiringHall();
              }}
            >
              Go to the hiring hall
            </button>
          ) : (
            <span class="muted small">Hiring happens aboard the Intrepid.</span>
          )}
        </div>
      </div>
    );
  }
  const exact = hasPerk(state, "read-the-room");
  return (
    <div class="panel crew-card">
      <div class="hub-card-head">
        <div class="crew-who">
          <Portrait state={state} seed={m.id} name={m.name} age={ageAt(m.born, state.time)} />
          <div>
            <span class="accent">{info.title}</span> <strong>{m.name}</strong>
          </div>
        </div>
        <span class="muted small">age {ageAt(m.born, state.time)}</span>
      </div>
      <MoodWarnings m={m} />
      <ClanLine m={m} />
      <LevelMeter xp={m.xp} />
      <dl class="kv crew-kv">
        <MoodRows m={m} exact={exact} />
        <dt>Wage</dt>
        <dd>{cr(wageOf(m))} / day</dd>
        <dt>Learns from</dt>
        <dd>{info.learnsFrom}</dd>
        <dt>Gives now</dt>
        <dd class="good">{bonusLine(state, station)}</dd>
      </dl>
      <PerkTags perks={m.perks} />
      <PerkActions session={session} station={station} />
    </div>
  );
}

const SHARE_CHOICES = [0, 0.05, 0.1, 0.15, MAX_CREW_SHARE];

/** The captain and the five officers, with the daily payroll. `onHall` runs before jumping to the hiring hall (the overlay closes itself). */
export function Roster({ session, onHall }: { session: GameSession; onHall?: () => void }) {
  const { state } = session;
  const share = state.crewShare ?? 0;
  const wages = dailyWages(state);
  const upkeep = dailyUpkeep(state);
  const owedSoFar = state.payrollOwed + (state.upkeepOwed ?? 0);
  return (
    <>
      <div class="crew-payroll">
        <span>
          Payroll: <strong class="accent">{cr(wages)}</strong> a day
          <span class="muted"> · equipment upkeep </span>
          <strong class="accent">{cr(upkeep)}</strong> a day
        </span>
        <span class="muted small">
          Wages and upkeep build up while you're out and are paid from your credits when you're back aboard or selling.
          {owedSoFar >= 1 && (
            <span class="accent">
              {" "}
              Owed so far: {cr(owedSoFar)}
              {state.upkeepOwed !== undefined && state.upkeepOwed >= 1 && ` (${cr(state.payrollOwed)} wages, ${cr(state.upkeepOwed)} upkeep)`}.
            </span>
          )}
        </span>
      </div>
      <div class="crew-share">
        <span class="crew-share-head">
          Share of the spoils:
          <span class="crew-seg" role="radiogroup" aria-label="Share of each sale paid to the crew">
            {SHARE_CHOICES.map((v) => {
              const on = Math.abs(share - v) < 0.001;
              return (
                <button
                  key={v}
                  role="radio"
                  aria-checked={on}
                  class={`btn crew-seg-btn ${on ? "primary" : ""}`}
                  onClick={() => session.act((s) => setCrewShare(s, v))}
                >
                  {Math.round(v * 100)}%
                </button>
              );
            })}
          </span>
        </span>
        <span class="muted small">
          That share of each sale is paid out as bonuses, split by level. It lifts everyone's happiness and, slowly, their loyalty. 0% is fine: they're
          salaried.
        </span>
      </div>
      <div class="crew-cards">
        {STATIONS.map((st) => (
          <PersonCard key={st} session={session} station={st} onHall={onHall} />
        ))}
      </div>
    </>
  );
}

function RecruitCard({ session, r }: { session: GameSession; r: Recruit }) {
  const { state } = session;
  const info = STATION_INFO[r.station];
  const level = levelForXp(r.xp);
  const wage = wageOf(r);
  const current = officerAt(state, r.station);
  const curLevel = current ? levelForXp(current.xp) : 0;
  const curWage = current ? wageOf(current) : 0;
  const fee = signingFee(state, r);
  const short = fee - state.credits;
  const diff = wage - curWage;
  const startLoyalty = startingLoyalty(r.clan, true);
  const exact = hasPerk(state, "read-the-room");
  return (
    <div class="panel crew-card recruit">
      <div class="hub-card-head">
        <div class="crew-who">
          <Portrait state={state} seed={r.id} name={r.name} age={ageAt(r.born, state.time)} />
          <div>
            <span class="accent">{info.title}</span> <strong>{r.name}</strong>
          </div>
        </div>
        <span class="muted small">age {ageAt(r.born, state.time)}</span>
      </div>
      <ClanLine m={r} />
      <LevelMeter xp={r.xp} />
      <dl class="kv crew-kv">
        <dt>Signing fee</dt>
        <dd class="accent">
          {cr(fee)}
          {fee !== r.fee && <span class="muted small"> (was {cr(r.fee)})</span>}
        </dd>
        <dt>Wage</dt>
        <dd>{cr(wage)} / day</dd>
        <dt>Learns from</dt>
        <dd>{info.learnsFrom}</dd>
        <dt class="crew-help" title={LOYALTY_TIP}>
          Loyalty
        </dt>
        <dd title={LOYALTY_TIP}>
          <Mood value={startLoyalty} exact={exact} />
          <span class="muted small"> ({r.clan === "freebooters" ? `${CLAN_NAMES[r.clan]}, ` : ""}on signing)</span>
        </dd>
        <dt>Perks</dt>
        <dd>
          <PerkTags perks={r.perks} />
        </dd>
      </dl>
      <table class="data crew-compare">
        <thead>
          <tr>
            <th />
            <th>{current ? `Now: ${current.name}` : "Now"}</th>
            <th>{r.name}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="muted">Level</td>
            <td>{current ? curLevel : <span class="danger">empty</span>}</td>
            <td class={level > curLevel ? "good" : level < curLevel ? "danger" : ""}>{level}</td>
          </tr>
          <tr>
            <td class="muted">Wage</td>
            <td>{current ? `${cr(curWage)}` : "-"}</td>
            <td>
              {cr(wage)}
              {current && diff !== 0 && <span class={diff > 0 ? "danger small" : "good small"}> ({diff > 0 ? "+" : "−"}{Math.abs(diff)})</span>}
            </td>
          </tr>
          <tr>
            <td class="muted">Gives</td>
            <td class="small">{bonusLine(state, r.station, curLevel)}</td>
            <td class="small good">{bonusLine(state, r.station, level)}</td>
          </tr>
        </tbody>
      </table>
      <button
        class="btn primary crew-sign"
        disabled={short > 0}
        title={short > 0 ? `You need ${cr(short)} more.` : `Sign ${r.name} for ${cr(fee)}${current ? `; ${current.name} goes ashore` : ""}`}
        onClick={() => session.act((s) => hireRecruit(s, r.id))}
      >
        Sign for {cr(fee)}
      </button>
    </div>
  );
}

/** The hiring hall: this month's recruits and how each compares with who they'd replace. */
export function HiringHall({ session }: { session: GameSession }) {
  const { state } = session;
  const recruits = state.recruits ?? [];
  const next = state.nextRecruitsAt;
  return (
    <>
      <p class="muted small crew-note">
        {next !== undefined && (
          <>
            The pool turns over in <span class="accent">{formatDuration(next - state.time)}</span>.{" "}
          </>
        )}
        Signing someone fills an empty post, or replaces the current officer at that station: they collect their pay and go ashore. A
        signing fee is paid up front.
      </p>
      {recruits.length > 0 ? (
        <div class="crew-cards">
          {recruits.map((r) => (
            <RecruitCard key={r.id} session={session} r={r} />
          ))}
        </div>
      ) : (
        <p class="muted">Nobody is looking for a berth right now. Check back when the pool turns over.</p>
      )}
    </>
  );
}

/** Crew view for anywhere (opened from the top bar): perks can be picked here, hiring and retraining wait for the Intrepid. */
export function CrewOverlay({ session, onClose }: { session: GameSession; onClose: () => void }) {
  return (
    <div class="overlay" onClick={onClose}>
      <div class="contracts crew-overlay" onClick={(e) => e.stopPropagation()}>
        <div class="journal-head">
          <h2>Crew</h2>
          <span class="muted">Hiring and retraining happen aboard the Intrepid</span>
          <button class="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div class="con-body">
          <Roster session={session} onHall={onClose} />
        </div>
      </div>
    </div>
  );
}
