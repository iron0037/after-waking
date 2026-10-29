/**
 * Pirate encounters (AW-19, combat v1): the hail, the battle, and the debrief.
 * Rules live in src/sim/combat; this only shows them. An encounter in progress is state.encounter,
 * so a reload resumes it. The debrief is UI state (session.encounterDebrief) until the captain continues.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { HEAD_BOUNTY, KINETIC_HIT, LASER_HIT, RANGE_NAMES } from "../data/combat";
import { COMMODITIES, type CommodityId } from "../data/commodities";
import { STATION_INFO, STATIONS, type Station } from "../data/crew";
import {
  ageAt,
  answerContact,
  answerHail,
  autoOrders,
  autoStep,
  cargoTonnes,
  claimPrize,
  combatTurn,
  contactOdds,
  effectiveStats,
  flightPlan,
  fold,
  foldPlan,
  formatDuration,
  hailOdds,
  holdValue,
  levelForXp,
  officerAt,
  orderAdvice,
  playerSide,
  shipDamage,
  type AutoMode,
  type CombatSide,
  type ContactChoice,
  type EncounterOutcome,
  type Orders,
  type Prize,
  type Recruit,
} from "../sim";
import { cr, damageSummary, pct, tonnes } from "./format";
import { Portrait } from "./portraits";
import type { GameSession } from "./session";
import "./encounter.css";

export function EncounterOverlay({ session }: { session: GameSession }) {
  const e = session.state.encounter;
  const stage = e?.stage;
  const mode = session.autoCombat;
  const live = !!e;

  // Leaving it to the officers: one step every so often, across the contact, hail and battle stages alike.
  // Each state change (a turn, a new stage) re-arms the timer, so the loop paces itself behind the screen.
  const progress = e ? `${e.stage}:${e.turn}:${e.log.length}` : "";
  useEffect(() => {
    if (!mode) return;
    if (!live || stage === "prize") {
      session.setAutoCombat(null); // it's over, or the prize wants the captain
      return;
    }
    const timer = window.setTimeout(
      () => {
        const r = session.act((s) => autoStep(s, mode));
        if (!r.ok) session.setAutoCombat(null);
      },
      stage === "battle" ? AUTO_BATTLE_MS : AUTO_STEP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [session, mode, live, stage, progress]);
  useEffect(() => () => session.setAutoCombat(null), [session]);

  if (e) {
    return e.stage === "contact" ? (
      <Contact session={session} />
    ) : e.stage === "hail" ? (
      <Hail session={session} />
    ) : e.stage === "prize" ? (
      <PrizeScreen session={session} />
    ) : (
      <Battle session={session} />
    );
  }
  if (session.encounterDebrief) return <Debrief session={session} />;
  return null;
}

// --- leaving it to the officers (auto-combat) ---------------------------------------------------

const AUTO_STEP_MS = 650;
const AUTO_BATTLE_MS = 500;

const AUTO_LABEL: Record<AutoMode, string> = { fight: "Fighting it out", run: "Breaking away" };

/**
 * Two buttons to hand the encounter to the officers or, while they have it, the mode and "Take command".
 * The loop itself lives in EncounterOverlay, so it carries on across the contact, hail and battle screens.
 */
function AutoRow({ session }: { session: GameSession }) {
  const mode = session.autoCombat;
  if (mode) {
    const takeCommand = () => {
      const e = session.state.encounter;
      // Carry the officers' last orders over, so the manual screen picks up where they left off.
      if (e && e.stage === "battle") Object.assign(session.orders, autoOrders(session.state, mode));
      session.setAutoCombat(null);
    };
    return (
      <div class="enc-auto on" role="status">
        <span class="enc-auto-mode small">
          <span class="enc-auto-dot" aria-hidden="true" /> Officers in command: <strong>{AUTO_LABEL[mode]}</strong>
        </span>
        <button class="btn big primary enc-take" autoFocus onClick={takeCommand}>
          Take command
        </button>
      </div>
    );
  }
  return (
    <div class="enc-auto">
      <div class="btn-row">
        <button class="btn enc-auto-btn" onClick={() => session.setAutoCombat("fight")} title="Your officers answer the hail and give the battle orders, turn by turn, to win.">
          Fight it out
        </button>
        <button class="btn enc-auto-btn" onClick={() => session.setAutoCombat("run")} title="Your officers run if they can, and if they can't, cripple the drives and open the range.">
          Break away
        </button>
      </div>
      <div class="muted small">Your officers give the orders; take command any time.</div>
    </div>
  );
}

// --- the contact ------------------------------------------------------------------------------

function Contact({ session }: { session: GameSession }) {
  const { state } = session;
  const e = state.encounter;
  if (!e) return null;
  const auto = !!session.autoCombat;
  const odds = contactOdds(state);
  const answer = (c: ContactChoice) => {
    if (!auto) session.act((s) => answerContact(s, c));
  };
  return (
    <div class="overlay enc-overlay">
      <div class="enc-box" role="dialog" aria-label="Raider contact">
        <div class="enc-head">
          <div class="enc-kicker">Contact · {e.raiderName}</div>
          <div class={`small ${e.spottedFirst ? "good" : "danger"}`}>{e.spottedFirst ? "You saw them first" : "They saw you first"}</div>
        </div>
        <div class="enc-log">
          {e.log.map((line, i) => (
            <p key={i} class={i === 0 ? "enc-hail" : "small muted"}>
              {line}
            </p>
          ))}
        </div>
        <div class="muted small">
          At a quarter light-speed nobody can fight: to shoot, you both have to drop to combat speed, and they have to match your burn to catch you.
        </div>
        <div class="enc-sides">
          <SidePanel title={state.ship.name} side={playerSide(state)} you />
          <SidePanel title={cap(e.raiderName)} side={e.enemy} />
        </div>
        <div class="enc-choices">
          {odds.slip !== null && (
            <button class="btn enc-choice" disabled={auto} onClick={() => answer("slip")}>
              <strong>
                Steer wide <span class="enc-odds">{Math.round(odds.slip * 100)}%</span>
              </strong>
              <span class="muted small">
                Swing around them and run quiet. Costs about {formatDuration(e.detourMinutes ?? 30)} extra. If they spot your flare, they hail you.
              </span>
            </button>
          )}
          <button class="btn enc-choice" disabled={auto} onClick={() => answer("run")}>
            <strong>
              Hold your burn <span class="enc-odds">{Math.round(odds.run * 100)}%</span>
            </strong>
            <span class="muted small">Stay at a quarter light-speed and make them chase. If they match it, the fight starts at medium range.</span>
          </button>
          <button class="btn enc-choice" disabled={auto} onClick={() => answer("hail")}>
            <strong>{e.spottedFirst ? "Hail them" : "Answer the hail"}</strong>
            <span class="muted small">Drop to combat speed and talk. They make their demand.</span>
          </button>
          <button class="btn enc-choice enc-fight" disabled={auto} onClick={() => answer("engage")}>
            <strong>Drop to combat speed and attack</strong>
            <span class="muted small">Run out the guns. The battle opens at long range.</span>
          </button>
        </div>
        <AutoRow session={session} />
      </div>
    </div>
  );
}

// --- the hail ---------------------------------------------------------------------------------

function Hail({ session }: { session: GameSession }) {
  const { state } = session;
  const e = state.encounter;
  if (!e) return null;
  const odds = hailOdds(state);
  const percent = Math.round(e.demand * 100);
  const worth = holdValue(state) * e.demand;
  const auto = !!session.autoCombat;
  const answer = (c: "pay" | "talk" | "run" | "fight") => {
    if (!auto) session.act((s) => answerHail(s, c));
  };
  return (
    <div class="overlay enc-overlay">
      <div class="enc-box" role="dialog" aria-label="Raider hail">
        <div class="enc-kicker">Interdicted · {e.raiderName}</div>
        <div class="enc-log">
          {e.log.map((line, i) => (
            <p key={i} class={i === 0 ? "enc-hail" : "small muted"}>
              {line}
            </p>
          ))}
        </div>
        <div class="enc-demand">
          They want <strong class="danger">~{percent}% of the hold</strong>, about <strong class="accent">{cr(worth)}</strong> at today's prices.
        </div>
        <div class="enc-choices">
          <button class="btn enc-choice" disabled={auto} onClick={() => answer("pay")}>
            <strong>Pay</strong>
            <span class="muted small">Hand it over and go on your way. No fight, no risk.</span>
          </button>
          <button class="btn enc-choice" disabled={e.talked || auto} onClick={() => answer("talk")}>
            <strong>
              Talk <span class="enc-odds">{e.talked ? "tried" : `${Math.round(odds.talk * 100)}%`}</span>
            </strong>
            <span class="muted small">
              {e.talked ? "They've heard enough talk." : "Comms bargains the price down, or talks them off. If it fails, they open fire."}
            </span>
          </button>
          <button class="btn enc-choice" disabled={auto} onClick={() => answer("run")}>
            <strong>
              Run <span class="enc-odds">{Math.round(odds.run * 100)}%</span>
            </strong>
            <span class="muted small">Burn for open space. If they catch you, it starts at close range.</span>
          </button>
          <button class="btn enc-choice enc-fight" disabled={auto} onClick={() => answer("fight")}>
            <strong>Fight</strong>
            <span class="muted small">Run out the guns. The battle opens at long range.</span>
          </button>
        </div>
        <AutoRow session={session} />
      </div>
    </div>
  );
}

// --- the battle -------------------------------------------------------------------------------

type OrderKey = keyof Orders;
interface OrderOption {
  id: string;
  label: string;
  hint: string;
}
const ORDER_GROUPS: { key: OrderKey; label: string; options: OrderOption[] }[] = [
  {
    key: "helm",
    label: "Helm",
    options: [
      { id: "close", label: "Close in", hint: "Close in: shorten the range by a band. Kinetic batteries bite hard up close, theirs too." },
      { id: "hold", label: "Hold", hint: "Hold range: keep the distance where it is." },
      { id: "open", label: "Open", hint: "Open range: back away. Opening from long range with working drives breaks off and folds you clear." },
      { id: "evade", label: "Evade", hint: "Evade: jink and weave. Their shots miss more, and so do yours." },
    ],
  },
  {
    key: "guns",
    label: "Guns",
    options: [
      { id: "hull", label: "Hull", hint: "Fire at their hull: the surest way to a win." },
      { id: "drives", label: "Drives", hint: "Fire at their drives: a crippled ship can't run or close. Some damage shakes the hull too." },
      { id: "weapons", label: "Weapons", hint: "Fire at their weapons: disarm them. Crippled guns hit weaker, and a disarmed crew may strike." },
      { id: "sensors", label: "Sensors", hint: "Fire at their sensors: blinded gunners miss more." },
      { id: "hold", label: "Hold fire", hint: "Hold fire: no shots this turn." },
    ],
  },
  {
    key: "engineering",
    label: "Engineering",
    options: [
      { id: "repair", label: "Repair", hint: "Damage control: patch your worst-hit system, or shore up the hull if the systems are sound. Faster with a good engineer." },
      { id: "shields", label: "Shields", hint: "Push power to the deflectors: the screens soak about 60% more this turn." },
      { id: "guns", label: "Guns", hint: "Push power to the guns: your shots hit 25% harder this turn." },
    ],
  },
  {
    key: "comms",
    label: "Comms",
    options: [
      { id: "quiet", label: "Quiet", hint: "Stay quiet and keep the channel clear." },
      { id: "demand", label: "Demand surrender", hint: "Demand their surrender. Only works once they're beaten (low hull or disarmed); better with a good comms officer." },
      { id: "strike", label: "Strike colours", hint: "Strike your colours: they strip 70% of the hold and let you go. Your credits are safe. Ends the fight at once." },
    ],
  },
];

function Battle({ session }: { session: GameSession }) {
  const { state } = session;
  const e = state.encounter;
  const [hint, setHint] = useState<string | null>(null);
  const auto = session.autoCombat;
  // While the officers have the battle, show the orders they will give next instead of the captain's.
  const orders: Orders = auto ? autoOrders(state, auto) : session.orders;
  const advice = orderAdvice(state);

  const set = (key: OrderKey, id: string) => {
    (orders as unknown as Record<string, string>)[key] = id;
    session.emit();
  };
  const execute = () => {
    const enc = session.state.encounter;
    if (!enc || enc.stage !== "battle" || session.autoCombat) return;
    session.act((s) => combatTurn(s, { ...session.orders }));
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Enter" || ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat) return;
      ev.preventDefault();
      ev.stopPropagation();
      execute();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [session]);

  if (!e) return null;
  const me = playerSide(state);
  const striking = !auto && orders.comms === "strike";
  const wasted = ORDER_GROUPS.flatMap((g) => {
    const why = (advice[g.key] as Record<string, string | undefined>)[orders[g.key]];
    return why ? [why] : [];
  });
  return (
    <div class="overlay enc-overlay">
      <div class="enc-box enc-battle" role="dialog" aria-label="Ship-to-ship battle">
        <div class="enc-head">
          <div class="enc-kicker">Battle · turn {e.turn + 1}</div>
          <div class="muted small">
            {e.raiderName}, Captain {e.captain}
          </div>
        </div>

        <RangeTrack range={e.range} />

        <div class="enc-sides">
          <SidePanel title={state.ship.name} side={me} you />
          <SidePanel title={cap(e.raiderName)} side={e.enemy} />
        </div>

        <div class="enc-log enc-battlelog" aria-live="polite">
          {e.log.slice(-6).map((line, i, all) => (
            <p key={`${e.log.length}-${i}`} class={`small ${i === all.length - 1 ? "" : i >= all.length - 3 ? "enc-recent" : "muted"}`}>
              {line}
            </p>
          ))}
        </div>

        <div class="enc-orders">
          {ORDER_GROUPS.map((g) => (
            <div key={g.key} class="enc-order-row">
              <span class="enc-order-label">{g.label}</span>
              <div class="enc-seg" role="group" aria-label={g.label}>
                {g.options.map((o) => {
                  const why = (advice[g.key] as Record<string, string | undefined>)[o.id];
                  const on = orders[g.key] === o.id;
                  const text = why ? `${o.hint} (${why})` : o.hint;
                  return (
                    <button
                      key={o.id}
                      class={`enc-seg-btn ${on ? "on" : ""} ${on && auto ? "auto" : ""} ${why ? "wasted" : ""} ${o.id === "strike" ? "strike" : ""}`}
                      aria-pressed={on}
                      title={text}
                      disabled={!!auto}
                      onClick={() => set(g.key, o.id)}
                      onMouseEnter={() => setHint(text)}
                      onMouseLeave={() => setHint(null)}
                      onFocus={() => setHint(text)}
                      onBlur={() => setHint(null)}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div class={`enc-hint small ${hint ? "" : wasted.length > 0 ? "accent" : "muted"}`}>
          {hint ?? (auto ? "The highlighted orders are the ones your officers will give this turn." : wasted.length > 0 ? `Wasted: ${wasted.join(" ")}` : "Hover an order to see what it does. Enter fires the turn.")}
        </div>

        {!auto && (
          <div class="btn-row enc-actions">
            <button class={`btn big enc-execute ${striking ? "danger" : "primary"}`} onClick={execute}>
              {striking ? "Strike colours" : "Execute turn"} <span class="enc-key">Enter</span>
            </button>
          </div>
        )}
        <AutoRow session={session} />
      </div>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Three range bands with you at one end and the raider in whichever band it holds. */
function RangeTrack({ range }: { range: number }) {
  const laser = Math.round((LASER_HIT[range] ?? 0) * 100);
  const kinetic = Math.round((KINETIC_HIT[range] ?? 0) * 100);
  return (
    <div class="enc-range">
      <div class="enc-track">
        <div class="enc-you" title="Your ship">
          <span class="enc-glyph you">▶</span>
          <span class="small">You</span>
        </div>
        <div class="enc-zones">
          {([0, 1, 2] as const).map((b) => (
            <div key={b} class={`enc-zone ${range === b ? "on" : ""}`}>
              <span class="small">{RANGE_NAMES[b]}</span>
            </div>
          ))}
          <div class="enc-foe" style={{ left: `${((range * 2 + 1) / 6) * 100}%` }} title="The raider">
            <span class="small">Raider</span>
            <span class="enc-glyph foe">◀</span>
          </div>
        </div>
      </div>
      <div class="muted small enc-range-note">
        At {RANGE_NAMES[range as 0 | 1 | 2]} range, base chance to hit: lasers {laser}%, kinetics {kinetic}%.
        {range === 2 && " Open range from here to slip away and fold clear."}
      </div>
    </div>
  );
}

function hullClass(frac: number): string {
  return frac > 0.5 ? "hull-good" : frac > 0.25 ? "hull-warn" : "hull-bad";
}

function SidePanel({ title, side, you = false }: { title: string; side: CombatSide; you?: boolean }) {
  const frac = side.hullMax > 0 ? side.hull / side.hullMax : 0;
  return (
    <div class={`enc-side ${you ? "you" : "foe"}`}>
      <div class="enc-side-title">{title}</div>
      <div class="enc-stat-row">
        <span class="muted small">Hull</span>
        <span class="small">
          {Math.round(side.hull)} / {side.hullMax}
        </span>
      </div>
      <div class={`bar enc-hull ${hullClass(frac)}`}>
        <span style={{ width: `${pct(side.hull, side.hullMax)}%` }} />
      </div>
      <div class="enc-guns small">
        <span title="Shield strength: damage soaked per turn">
          <span class="muted">Shields</span> {side.shields}
        </span>
        <span title="Laser damage per hit">
          <span class="muted">Laser</span> {side.laser}
        </span>
        <span title="Kinetic battery damage per hit">
          <span class="muted">Kinetic</span> {side.kinetic}
        </span>
      </div>
      <div class="enc-systems">
        {(["drives", "weapons", "sensors"] as const).map((k) => {
          const d = Math.round(side.damage[k]);
          return (
            <div key={k} class="enc-system" title={d > 0 ? `${k}: ${d}% impaired` : `${k}: sound`}>
              <span class="small muted">{k}</span>
              <div class="bar enc-dmg">
                <span style={{ width: `${d}%` }} />
              </div>
              <span class={`small ${d >= 100 ? "danger" : d > 0 ? "accent" : "good"}`}>{d >= 100 ? "OUT" : d > 0 ? `${d}%` : "ok"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- the prize --------------------------------------------------------------------------------

const lootName = (id: string) => COMMODITIES[id as CommodityId]?.name ?? id;

function PrizeScreen({ session }: { session: GameSession }) {
  const { state } = session;
  const e = state.encounter;
  const p: Prize | undefined = e?.prize;
  // Enter hammered through the last turn must not settle the prize unseen: ignore clicks for a moment after it opens.
  const born = useRef(performance.now());
  const settled = () => performance.now() - born.current > 450;
  if (!e || !p) return null;
  const room = Math.max(0, effectiveStats(state).cargoCapacityT - cargoTonnes(state.ship.cargo));
  const lootEntries = Object.entries(p.loot).filter(([, t]) => (t ?? 0) > 0);
  const lootT = lootEntries.reduce((sum, [, t]) => sum + (t ?? 0), 0);
  const base = p.salvage + p.captainBounty;
  const turnInPay = base + p.captives * HEAD_BOUNTY;
  const keep = p.promising.length;
  const recruitPay = base + (p.captives - keep) * HEAD_BOUNTY;
  const names = p.promising.map((r) => r.name);
  const nameList = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
  const choose = (choice: "turnIn" | "recruit") => {
    if (settled()) session.act((s) => claimPrize(s, choice));
  };
  return (
    <div class="overlay enc-overlay">
      <div class="enc-box enc-prize" role="dialog" aria-label="Prize">
        <div class="enc-kicker">
          {cap(e.raiderName)} · Captain {e.captain}
        </div>
        <h2 class="good">She strikes</h2>
        <div class="enc-log" aria-live="polite">
          {e.log.slice(-3).map((line, i, all) => (
            <p key={i} class={`small ${i === all.length - 1 ? "" : "muted"}`}>
              {line}
            </p>
          ))}
        </div>
        <dl class="kv enc-results">
          <dt>Salvage</dt>
          <dd class="good">{cr(p.salvage)}</dd>
          <dt>Captain {e.captain}</dt>
          <dd class="good">{cr(p.captainBounty)} bounty, handed over alive</dd>
          <dt>Their hold</dt>
          <dd>
            {lootEntries.length > 0 ? lootEntries.map(([id, t]) => `${Math.round((t ?? 0) * 10) / 10} t ${lootName(id)}`).join(", ") : <span class="muted">empty</span>}
            {lootEntries.length > 0 && (
              <div class={`small ${lootT > room ? "accent" : "muted"}`}>
                Goes in your hold if there's room ({tonnes(room)} free{lootT > room ? "; some will be left behind" : ""}).
              </div>
            )}
          </dd>
          <dt>Crew in irons</dt>
          <dd>
            {p.captives} besides the captain
            {keep > 0 && <span class="muted"> · {keep} look{keep === 1 ? "s" : ""} promising</span>}
          </dd>
        </dl>
        {keep > 0 && (
          <div class="enc-captives">
            {p.promising.map((r) => (
              <CaptiveCard key={r.id} session={session} r={r} />
            ))}
          </div>
        )}
        <div class="enc-choices">
          <button class="btn enc-choice" onClick={() => choose("turnIn")}>
            <strong>Turn them all in</strong>
            <span class="muted small">
              Helm pays {cr(HEAD_BOUNTY)} a head for {p.captives} crew.
            </span>
            <span class="good small">You collect {cr(turnInPay)} in all.</span>
          </button>
          {keep > 0 && (
            <button class="btn enc-choice enc-recruit" onClick={() => choose("recruit")}>
              <strong>Offer a berth to {nameList}</strong>
              <span class="muted small">
                They wait a year in the Intrepid's hiring hall at half the usual signing fee. The other {p.captives - keep} go to Helm for {cr(HEAD_BOUNTY)} a head.
              </span>
              <span class="good small">You collect {cr(recruitPay)} now.</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CaptiveCard({ session, r }: { session: GameSession; r: Recruit }) {
  const { state } = session;
  const info = STATION_INFO[r.station];
  const age = ageAt(r.born, state.time);
  return (
    <div class="enc-captive">
      <Portrait state={state} seed={r.id} name={r.name} age={age} />
      <div class="enc-captive-body">
        <div>
          <strong>{r.name}</strong> <span class="muted small">age {age}</span>
        </div>
        <div class="small">
          <span class="accent">{info.title}</span> · level {levelForXp(r.xp)}
        </div>
        <div class="small muted">Freebooters · signing fee {cr(r.fee)}</div>
      </div>
    </div>
  );
}

// --- the debrief ------------------------------------------------------------------------------

const OUTCOME: Record<EncounterOutcome, { title: string; cls: string }> = {
  paid: { title: "Paid off", cls: "accent" },
  "talked off": { title: "Talked off", cls: "good" },
  escaped: { title: "Escaped", cls: "good" },
  "slipped past": { title: "Slipped past", cls: "good" },
  won: { title: "Victory", cls: "good" },
  "driven off": { title: "They broke off", cls: "good" },
  surrendered: { title: "Colours struck", cls: "danger" },
  overwhelmed: { title: "Overwhelmed", cls: "danger" },
};

/** What the encounter taught each station: who learned, how much, and who reached a new level. */
function Experience({ session, xp, levelsBefore }: { session: GameSession; xp?: Partial<Record<Station, number>>; levelsBefore?: Partial<Record<Station, number>> }) {
  const { state } = session;
  const rows = STATIONS.flatMap((st) => {
    const gained = xp?.[st] ?? 0;
    if (gained <= 0) return [];
    const who = st === "captain" ? { name: state.captain.name, xp: state.captain.xp ?? 0 } : officerAt(state, st);
    const before = levelsBefore?.[st];
    const level = who ? levelForXp(who.xp) : 0;
    return [{ st, gained, name: who?.name ?? null, level: before !== undefined && level > before ? level : 0 }];
  });
  if (rows.length === 0) return null;
  return (
    <div class="enc-xp">
      <div class="enc-xp-head small muted">Experience</div>
      <ul class="enc-xp-list">
        {rows.map((r) => (
          <li key={r.st} class="small">
            <span class="accent">{STATION_INFO[r.st].title}</span>
            {r.name && <span class="muted"> {r.name}</span>}
            <span class="good"> +{r.gained} xp</span>
            {r.level > 0 && <strong class="good"> · reached level {r.level}</strong>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Debrief({ session }: { session: GameSession }) {
  const { state, world } = session;
  const d = session.encounterDebrief;
  // Enter hammered through the last turn must not skip the debrief: ignore clicks for a moment after it opens.
  const born = useRef(performance.now());
  const settled = () => performance.now() - born.current > 450;
  if (!d) return null;
  const o = OUTCOME[d.result.outcome];
  const damage = shipDamage(state);
  const hurt = damageSummary(damage);
  const loot = Object.entries(d.result.loot ?? {}).filter(([, t]) => (t ?? 0) > 0);
  const recruited = d.result.recruited ?? [];

  // The fold that was interrupted: offer to carry on with it when the ship can.
  const target = session.pendingFold;
  const plan = target ? foldPlan(state, world, target) : null;
  const canFold = !!target && !!plan && plan.blockers.length === 0;
  const targetName = target === "intrepid" ? "the Intrepid" : (world.galaxy.systems.find((s) => s.id === target)?.name ?? "the next star");
  const foldOn = () => {
    if (!target || !settled()) return;
    session.closeEncounterDebrief();
    const r = session.act((s, w) => fold(s, w, target));
    if (r.ok) session.go(session.state.location.kind === "intrepid" ? "hub" : "system");
  };

  // A contact in flight: carry on with the burn from where the ship sits (animated by the system screen).
  const resume = d.result.resume;
  const resumePlan = resume ? flightPlan(state, world, resume) : null;
  const resumeShort = resumePlan?.ok === true && resumePlan.value.fuel > state.ship.fuel;
  const canResume = !!resume && resumePlan?.ok === true && !resumeShort;
  const resumeOn = () => {
    if (!resume || !settled()) return;
    session.closeEncounterDebrief();
    session.requestResume(resume);
  };

  return (
    <div class="overlay enc-overlay">
      <div class="enc-box enc-debrief" role="dialog" aria-label="Encounter debrief">
        <div class="enc-kicker">
          {cap(d.raiderName)} · Captain {d.captain}
        </div>
        <h2 class={o.cls}>{o.title}</h2>
        <p class="enc-outcome-text">{d.result.text}</p>
        <dl class="kv enc-results">
          {d.result.cargoLost > 0 && (
            <>
              <dt>Cargo lost</dt>
              <dd class="danger">{tonnes(d.result.cargoLost)}</dd>
            </>
          )}
          {d.result.bounty > 0 && (
            <>
              <dt>Bounty earned</dt>
              <dd class="good">{cr(d.result.bounty)}</dd>
            </>
          )}
          {d.result.cargoLost <= 0 && d.result.bounty <= 0 && (
            <>
              <dt>Cargo lost</dt>
              <dd class="good">none</dd>
            </>
          )}
          {loot.length > 0 && (
            <>
              <dt>Plunder</dt>
              <dd class="good">
                {loot.map(([id, t]) => `${t} t ${lootName(id)}`).join(", ")} <span class="muted small">(in your hold)</span>
              </dd>
            </>
          )}
          {recruited.length > 0 && (
            <>
              <dt>Recruited</dt>
              <dd>
                <span class="good">{recruited.join(", ")}</span> <span class="muted small">waiting in the hiring hall</span>
              </dd>
            </>
          )}
          {hurt && (
            <>
              <dt>Battle damage</dt>
              <dd class="accent">{hurt}</dd>
            </>
          )}
        </dl>
        {hurt && (
          <p class="muted small">
            {damage.drives > 0 ? "Drive damage slows you in flight. " : ""}The Intrepid's Shipyard repairs battle damage for credits and a few days.
          </p>
        )}
        <Experience session={session} xp={d.result.xp} levelsBefore={d.levelsBefore} />
        {d.log.length > 1 && (
          <details class="enc-replay">
            <summary class="small muted">What happened</summary>
            <div class="enc-log">
              {d.log.map((line, i) => (
                <p key={i} class="small muted">
                  {line}
                </p>
              ))}
            </div>
          </details>
        )}
        <div class="btn-row enc-actions">
          <button class={`btn big ${canFold || !!resume ? "" : "primary"}`} autoFocus onClick={() => settled() && session.closeEncounterDebrief()}>
            Continue
          </button>
          {resume && (
            <button
              class="btn big primary"
              disabled={!canResume}
              onClick={resumeOn}
              title={
                canResume
                  ? `Pick the burn back up: ${formatDuration(resumePlan.value.minutes)}, ${resumePlan.value.fuel} fuel from here.`
                  : resumeShort
                    ? `The rest of the burn needs ${resumePlan?.ok ? resumePlan.value.fuel : ""} fuel; tanks hold ${state.ship.fuel.toFixed(1)}.`
                    : "Can't resume that burn from here."
              }
            >
              Continue to {d.result.resumeName ?? "your destination"}
            </button>
          )}
          {canFold && (
            <button class="btn big primary" onClick={foldOn} title="Spool the fold drive again. The raider won't be back for this departure.">
              Fold to {targetName}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
