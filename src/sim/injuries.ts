/**
 * Crew injuries (AW-214, part of AW-96). Surface incidents, raider hits and (later) hostile creatures can hurt
 * an officer. The captain stays on the bridge and isn't hurt.
 *
 * - Minor: works a level below for a few days.
 * - Serious: works three levels below for weeks.
 * - Critical: off duty (no level, perks or talent), and a race home: the Intrepid's surgeons stabilize them at
 *   docking, or a medic with the Surgeon perk does it aboard (unless the medic is the one hurt). If the clock runs
 *   out first, they die. The stakes come from the captain's choices, not a sudden roll.
 *
 * Healing runs faster with a better medic, with Stabilize, and while docked at the Intrepid.
 */
import type { OfficerStation } from "../data/crew";
import { awardXp, ensureVolunteers, officerAt, stationLevel, type CrewMember } from "./crew";
import { hasPerk } from "./perks";
import type { Rng } from "./rng";
import { cheer, cheerAll } from "./sentiment";
import { log, withRng, type GameState } from "./state";
import { formatDuration } from "./time";
import { DAY } from "./units";

export type InjurySeverity = 1 | 2 | 3;

export interface Injury {
  severity: InjurySeverity;
  /** What happened, for the roster ("hurt in a quake"). */
  cause: string;
  /** Days of healing left (at the normal rate); a critical injury doesn't heal until it's stabilized. */
  healDays: number;
  since: number;
  /** Critical only: when they die if not stabilized. */
  deadline?: number;
}

export const INJURY_NAMES: Record<InjurySeverity, string> = { 1: "minor", 2: "serious", 3: "critical" };
/** Working levels lost while injured (critical: off duty altogether). */
export const INJURY_LEVELS_LOST: Record<1 | 2, number> = { 1: 1, 2: 3 };
const HEAL_DAYS: Record<1 | 2, readonly [number, number]> = { 1: [4, 8], 2: [18, 30] };
/** Days a critically injured officer can hold on, at medic level 1; each medic level adds CRITICAL_DAYS_PER_LEVEL. */
export const CRITICAL_DAYS = 30;
export const CRITICAL_DAYS_PER_LEVEL = 4;
/** A Surgeon medic stabilizes a critical injury after this long aboard. */
const SURGEON_DAYS = 2;

/** Weights for minor / serious / critical. */
export type SeverityWeights = readonly [number, number, number];
export const INCIDENT_SEVERITY: SeverityWeights = [80, 18, 2];

export function isOffDuty(m: Pick<CrewMember, "injury">): boolean {
  return m.injury?.severity === 3;
}

/** Working levels an injury costs (99 for off duty). */
export function injuryLevelsLost(m: Pick<CrewMember, "injury">): number {
  const s = m.injury?.severity;
  return !s ? 0 : s === 3 ? 99 : INJURY_LEVELS_LOST[s];
}

/** Can the medic operate (Surgeon) on this patient? Not on themselves, and not while off duty. */
function surgeonFor(state: GameState, patient: CrewMember): boolean {
  const medic = officerAt(state, "medical");
  return !!medic && medic.id !== patient.id && !isOffDuty(medic) && hasPerk(state, "surgeon");
}

/** How fast injuries heal right now: the medic's level, Stabilize, and the Intrepid's infirmary. */
export function healRate(state: GameState): number {
  const medic = officerAt(state, "medical");
  const lvl = medic && !isOffDuty(medic) ? Math.max(1, stationLevel(state, "medical") - injuryLevelsLost(medic)) : 0;
  let rate = lvl === 0 ? 0.6 : 1 + 0.06 * (lvl - 1);
  if (hasPerk(state, "stabilize")) rate *= 2;
  if (state.location.kind === "intrepid") rate *= 2;
  return rate;
}

/** Days a critical injury gives the ship to get home. */
export function criticalDays(state: GameState): number {
  const medic = officerAt(state, "medical");
  const lvl = medic && !isOffDuty(medic) ? stationLevel(state, "medical") : 0;
  return CRITICAL_DAYS + CRITICAL_DAYS_PER_LEVEL * Math.max(0, lvl - 1);
}

export interface InjuryOptions {
  /** Who might be hurt; any officer if left out. */
  stations?: readonly OfficerStation[];
  cause: string;
  weights?: SeverityWeights;
  /** Lighten the injury by this many steps (Combat Medic, Fauna Handler); a minor one stepped down is a near miss. */
  lighten?: number;
}

/** Roll a severity from weights. */
export function rollSeverity(rng: Rng, weights: SeverityWeights): InjurySeverity {
  return rng.weighted([
    [1, weights[0]],
    [2, weights[1]],
    [3, weights[2]],
  ] as const);
}

/**
 * Hurt one officer. Returns who (and how badly), or null if nobody was there or the injury was lightened away.
 * A new injury never makes an existing one milder; two serious ones make a critical.
 */
export function injureCrew(state: GameState, opts: InjuryOptions): { member: CrewMember; severity: InjurySeverity } | null {
  const pool = (state.crew ?? []).filter((m) => !opts.stations || opts.stations.includes(m.station));
  if (pool.length === 0) return null;
  return withRng(state, (rng) => {
    const member = rng.pick(pool);
    const rolled = rollSeverity(rng, opts.weights ?? INCIDENT_SEVERITY) - (opts.lighten ?? 0);
    if (rolled < 1) {
      log(state, "info", `${member.name} had a near miss: ${opts.cause}, but walked away unhurt.`);
      return null;
    }
    const old = member.injury?.severity ?? 0;
    const severity = Math.min(3, old >= 2 && rolled >= 2 ? 3 : Math.max(old, rolled)) as InjurySeverity;
    const healDays = severity === 3 ? rng.range(...HEAL_DAYS[2]) : rng.range(...HEAL_DAYS[severity]);
    member.injury = {
      severity,
      cause: opts.cause,
      healDays: Math.max(member.injury?.healDays ?? 0, healDays),
      since: state.time,
      ...(severity === 3 ? { deadline: state.time + criticalDays(state) * DAY } : {}),
    };
    cheer(state, member, -5 * severity);
    state.stats.injuries = (state.stats.injuries ?? 0) + 1;
    if (severity === 3) {
      cheerAll(state, -3);
      const aboard = surgeonFor(state, member);
      log(
        state,
        "warning",
        aboard
          ? `${member.name} is critically injured (${opts.cause}). The medic is operating; they should pull through.`
          : `${member.name} is critically injured (${opts.cause}) and off duty. Get them to the Intrepid's surgeons within ${Math.round(criticalDays(state))} days.`,
      );
    } else {
      log(state, "warning", `${member.name} has a ${INJURY_NAMES[severity]} injury (${opts.cause}): working below their level for a while.`);
    }
    return { member, severity };
  });
}

function stabilize(state: GameState, m: CrewMember, how: string): void {
  if (!m.injury) return;
  m.injury = { severity: 2, cause: m.injury.cause, healDays: m.injury.healDays, since: m.injury.since };
  awardXp(state, "medical", 15);
  log(state, "info", `${m.name} is out of danger: ${how}. Still a long recovery ahead.`);
}

function die(state: GameState, m: CrewMember): void {
  state.crew = (state.crew ?? []).filter((x) => x.id !== m.id);
  state.stats.crewLost = (state.stats.crewLost ?? 0) + 1;
  cheerAll(state, -15);
  log(state, "warning", `${m.name} died of their injuries before the ship could reach the Intrepid. The ${m.station} post is empty.`);
  ensureVolunteers(state);
}

/** Time passes: wounds heal, critical patients are stabilized or lost. Called from advanceTime. */
export function tickInjuries(state: GameState, minutes: number): void {
  const hurt = (state.crew ?? []).filter((m) => m.injury);
  if (hurt.length === 0) return;
  const days = minutes / DAY;
  const rate = healRate(state);
  for (const m of hurt) {
    const inj = m.injury!;
    if (inj.severity === 3) {
      if (state.location.kind === "intrepid") stabilize(state, m, "the Intrepid's surgeons stabilized them");
      else if (surgeonFor(state, m) && state.time - inj.since >= SURGEON_DAYS * DAY) stabilize(state, m, "the medic's surgery held");
      else if (inj.deadline !== undefined && state.time >= inj.deadline) die(state, m);
      continue;
    }
    inj.healDays -= days * rate;
    if (inj.healDays <= 0) {
      awardXp(state, "medical", inj.severity === 2 ? 10 : 4);
      delete m.injury;
      log(state, "info", `${m.name} is fit for duty again.`);
    }
  }
}

/** What the roster shows: "serious injury, about 12 days" / "critical: 9 days to reach the Intrepid". */
export function injuryLine(state: GameState, m: CrewMember): string | null {
  const inj = m.injury;
  if (!inj) return null;
  if (inj.severity === 3) {
    if (surgeonFor(state, m)) return `Critical injury (${inj.cause}): the medic is operating.`;
    const left = Math.max(0, (inj.deadline ?? state.time) - state.time);
    return `Critical injury (${inj.cause}), off duty: ${formatDuration(left)} to reach the Intrepid's surgeons.`;
  }
  const days = inj.healDays / Math.max(0.1, healRate(state));
  return `${INJURY_NAMES[inj.severity][0]!.toUpperCase()}${INJURY_NAMES[inj.severity].slice(1)} injury (${inj.cause}): works ${INJURY_LEVELS_LOST[inj.severity]} level${inj.severity === 1 ? "" : "s"} below for about ${formatDuration(days * DAY)}.`;
}

/** The most urgent critical patient, for the top bar: who and how long is left. */
export function criticalPatient(state: GameState): { member: CrewMember; minutesLeft: number } | null {
  let best: { member: CrewMember; minutesLeft: number } | null = null;
  for (const m of state.crew ?? []) {
    if (m.injury?.severity !== 3 || m.injury.deadline === undefined || surgeonFor(state, m)) continue;
    const left = m.injury.deadline - state.time;
    if (!best || left < best.minutesLeft) best = { member: m, minutesLeft: left };
  }
  return best;
}
