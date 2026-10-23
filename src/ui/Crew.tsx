/**
 * Crew views: the roster (the captain and five officers), the hiring hall, and a read-only
 * overlay for looking at the crew away from the Intrepid. Rules and numbers live in src/sim/crew.
 */
import { useState } from "preact/hooks";
import { CLAN_TRAITS, STATION_INFO, STATIONS, type Station } from "../data/crew";
import { PERKS_BY_ID } from "../data/perks";
import { CLAN_NAMES } from "../data/ship";
import {
  ageAt,
  bonusLine,
  dailyWages,
  freePerkPoints,
  formatDuration,
  hireRecruit,
  levelForXp,
  levelProgress,
  MAX_LEVEL,
  officerAt,
  perkHolder,
  retrain,
  retrainCost,
  signingFee,
  wageOf,
  xpForLevel,
  type CrewMember,
  type GameState,
  type Recruit,
} from "../sim";
import { cr } from "./format";
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
  return (
    <>
      <div class="crew-actions">
        <button class={`btn ${free > 0 ? "primary" : ""}`} onClick={() => session.openPerkTree(station)}>
          Perks
          {free > 0 && (
            <span class="badge" title={`${free} unspent perk point${free === 1 ? "" : "s"}`}>
              {free}
            </span>
          )}
        </button>
        {aboard && !confirming && (
          <button
            class="btn"
            disabled={taken === 0 || short > 0}
            onClick={() => setConfirming(true)}
            title={
              taken === 0
                ? "No perks to unlearn yet."
                : short > 0
                  ? `You need ${cr(short)} more.`
                  : `The Lyceum refunds ${taken} point${taken === 1 ? "" : "s"} for ${cr(cost.credits)} and ${cost.days} days.`
            }
          >
            Retrain (Lyceum) · {cr(cost.credits)} · {cost.days} d
          </button>
        )}
      </div>
      {aboard && confirming && (
        <div class="crew-retrain-confirm">
          <span class="small">
            A Lyceum course takes <strong class="accent">{cost.days} days</strong> and <strong class="accent">{cr(cost.credits)}</strong>. It wipes{" "}
            {taken} perk{taken === 1 ? "" : "s"} and gives the point{taken === 1 ? "" : "s"} back to spend again. Time passes while it runs, and wages keep accruing.
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

function PersonCard({ session, station }: { session: GameSession; station: Station }) {
  const { state } = session;
  const info = STATION_INFO[station];
  if (station === "captain") {
    return (
      <div class="panel crew-card">
        <div class="hub-card-head">
          <div>
            <span class="accent">{info.title}</span> <strong>{state.captain.name.replace(/^Captain\s+/i, "")}</strong>
          </div>
          <span class="muted small">age {ageAt(state.captain.born, state.time)}</span>
        </div>
        <div class="muted small">That's you. Captains draw no wage; the Exchange takes its cut elsewhere.</div>
        <LevelMeter xp={state.captain.xp ?? 0} />
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
    return (
      <div class="panel crew-card">
        <div class="hub-card-head">
          <span class="accent">{info.title}</span>
        </div>
        <div class="danger small">The post is empty. Hire someone at the Intrepid.</div>
        <div class="muted small">Improves: {info.improves}</div>
      </div>
    );
  }
  return (
    <div class="panel crew-card">
      <div class="hub-card-head">
        <div>
          <span class="accent">{info.title}</span> <strong>{m.name}</strong>
        </div>
        <span class="muted small">age {ageAt(m.born, state.time)}</span>
      </div>
      <ClanLine m={m} />
      <LevelMeter xp={m.xp} />
      <dl class="kv crew-kv">
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

/** The captain and the five officers, with the daily payroll. */
export function Roster({ session }: { session: GameSession }) {
  const { state } = session;
  const wages = dailyWages(state);
  return (
    <>
      <div class="crew-payroll">
        <span>
          Payroll: <strong class="accent">{cr(wages)}</strong> a day
        </span>
        <span class="muted small">
          Wages build up while you're out and are paid from your credits when you're back aboard or selling.
          {state.payrollOwed >= 1 && <span class="accent"> Owed so far: {cr(state.payrollOwed)}.</span>}
        </span>
      </div>
      <div class="crew-cards">
        {STATIONS.map((st) => (
          <PersonCard key={st} session={session} station={st} />
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
  return (
    <div class="panel crew-card recruit">
      <div class="hub-card-head">
        <div>
          <span class="accent">{info.title}</span> <strong>{r.name}</strong>
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
        Signing someone replaces the current officer at that station: they collect their pay and go ashore. A signing fee is paid up
        front.
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
          <Roster session={session} />
        </div>
      </div>
    </div>
  );
}
