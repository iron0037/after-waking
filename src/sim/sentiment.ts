/**
 * Crew sentiment (AW-100): what each officer thinks of the captain.
 *
 * - Happiness (0–100) is short-term: it moves with recent events (finds, level-ups, good and bad
 *   trips, shore leave, long hauls, unpaid wages, incidents, bonuses).
 * - Loyalty (0–100) is long-term: it drifts with sustained happiness and with how the captain
 *   treats the officer's clan (contracts for it, gear bought from it).
 *
 * The lower the two together, the likelier an officer is to give notice at the next docking. Notice
 * runs one trip, so the captain always gets a chance to turn things around. A miserable officer
 * also works a level below themselves until things improve.
 */
import { clanMods } from "./clan";
import { OFFICER_STATIONS, STATION_INFO, type OfficerStation } from "../data/crew";
import type { ClanId } from "../data/ship";
import { levelForXp, upbringingOf, wageOf, type CrewMember } from "./crew";
import { hasPerk } from "./perks";
import { ok, type Result } from "./result";
import type { GameState } from "./state";
import { DAY, YEAR } from "./units";

export const MOOD_MIN = 0;
export const MOOD_MAX = 100;
/** Happiness below this: the officer works a level below themselves. */
export const MISERABLE = 25;
/** Where happiness settles with nothing happening, and how fast it gets there (share per day). */
export const HAPPINESS_BASELINE = 55;
export const HAPPINESS_RELAX_PER_DAY = 0.015;
/** Shore leave aboard the Intrepid restores happiness up to this. */
export const SHORE_LEAVE_CAP = 80;
export const SHORE_LEAVE_PER_DAY = 1.5;
/** Days away from the Intrepid before a long haul starts to wear on the crew. */
export const LONG_HAUL_DAYS = 90;
export const LONG_HAUL_PER_DAY = 0.2;
/** Loyalty drift per day at happiness 100 (or 0): it follows sustained happiness, slowly. */
export const LOYALTY_DRIFT_PER_DAY = 0.025;
/** Give notice below this combined score (young crew are a little more restless). */
export const NOTICE_BELOW = 30;
/** Someone on notice leaves if the score is still below this at the next docking. */
export const LEAVE_BELOW = 35;
/** ...and withdraws their notice at or above this. */
export const STAY_AT = 40;
/** The most the share of the spoils can be set to. */
export const MAX_CREW_SHARE = 0.2;

const clamp = (v: number) => Math.max(MOOD_MIN, Math.min(MOOD_MAX, v));

export type MoodLevel = "low" | "medium" | "high";

export function moodLevel(v: number): MoodLevel {
  return v < 35 ? "low" : v < 65 ? "medium" : "high";
}

/** Starting loyalty: your own clan's people trust you more (once captains have a clan); Freebooters least. */
export function startingLoyalty(clan: ClanId, newHire: boolean): number {
  if (clan === "freebooters") return newHire ? 20 : 25;
  return newHire ? 40 : 50;
}

/** Fill in sentiment for officers from before it existed (or fresh hires). */
export function ensureSentiment(m: CrewMember, newHire = false): void {
  m.happiness ??= 60;
  m.loyalty ??= startingLoyalty(m.clan, newHire);
}

/** Combined score that decides whether someone gives notice. */
export function sentimentScore(m: CrewMember): number {
  return ((m.happiness ?? 60) + (m.loyalty ?? 50)) / 2;
}

export function isMiserable(m: CrewMember): boolean {
  return (m.happiness ?? 60) < MISERABLE;
}

/** Nudge one officer's happiness (and, a little, loyalty). Morale makes good news land harder. */
export function cheer(state: GameState, m: CrewMember, amount: number): void {
  ensureSentiment(m);
  const boost = amount > 0 && hasPerk(state, "morale") ? 1.5 : 1;
  m.happiness = clamp((m.happiness as number) + amount * boost);
}

/** Change loyalty directly (clan matters, bonuses). The Loyalty perk speeds gains. */
export function bond(state: GameState, m: CrewMember, amount: number): void {
  ensureSentiment(m);
  const boost = amount > 0 && hasPerk(state, "loyalty") ? 1.5 : 1;
  m.loyalty = clamp((m.loyalty as number) + amount * boost);
}

/** Everyone aboard. */
export function cheerAll(state: GameState, amount: number): void {
  for (const m of state.crew ?? []) cheer(state, m, amount);
}

export function cheerStation(state: GameState, station: OfficerStation, amount: number): void {
  const m = (state.crew ?? []).find((x) => x.station === station);
  if (m) cheer(state, m, amount);
}

/** Officers from a clan feel it when the captain works for, or buys from, their clan. */
export function bondClan(state: GameState, clan: ClanId, amount: number): void {
  for (const m of state.crew ?? []) if (m.clan === clan) bond(state, m, amount);
}

/** Daily drift: shore leave restores, long hauls wear, and loyalty follows happiness. */
export function tickSentiment(state: GameState, minutes: number): void {
  if (!state.crew || state.crew.length === 0) return;
  const days = minutes / DAY;
  const docked = state.location.kind === "intrepid";
  const away = (state.time - (state.lastDockedAt ?? state.time)) / DAY;
  const leave = SHORE_LEAVE_PER_DAY * (hasPerk(state, "morale") ? 2 : 1) * clanMods(state).shoreLeave;
  for (const m of state.crew) {
    ensureSentiment(m);
    // Upbringing (AW-14): decks-born love shore leave, settlers shrug off long hauls, Earth's sleepers stay steady.
    const up = upbringingOf(m);
    let h = m.happiness as number;
    // Happiness is about recent events: it relaxes back toward a neutral mood over a few weeks.
    h += (HAPPINESS_BASELINE - h) * (1 - Math.exp(-HAPPINESS_RELAX_PER_DAY * days));
    if (docked && h < SHORE_LEAVE_CAP) h = Math.min(SHORE_LEAVE_CAP, h + leave * (up === "decks" ? 1.5 : 1) * days);
    if (!docked && away > LONG_HAUL_DAYS) h -= LONG_HAUL_PER_DAY * (up === "settlement" ? 0.5 : 1) * Math.min(days, away - LONG_HAUL_DAYS);
    m.happiness = clamp(h);
    const drift = ((m.happiness - 50) / 50) * LOYALTY_DRIFT_PER_DAY * days;
    const mult = drift > 0 ? (hasPerk(state, "loyalty") ? 1.5 : 1) : up === "earth" ? 0.5 : 1;
    m.loyalty = clamp((m.loyalty as number) + drift * mult);
  }
}

/**
 * Docking at the Intrepid: the crew react to how the trip went and to whether they've been paid,
 * and anyone at the end of their rope gives notice (or, already on notice, leaves).
 */
export function sentimentOnDocked(state: GameState, tripProfit: number | null): void {
  state.lastDockedAt = state.time;
  if (!state.crew) return;
  if (tripProfit !== null) cheerAll(state, tripProfit > 0 ? 6 : -6);
  if (state.payrollOwed >= 1) {
    cheerAll(state, -8);
    for (const m of state.crew) bond(state, m, -2);
    state.journal.push({ t: state.time, kind: "warning", text: "The crew docked to find their wages still owed. They noticed." });
  }

  const leaving: CrewMember[] = [];
  for (const m of state.crew) {
    ensureSentiment(m);
    const score = sentimentScore(m);
    const young = (state.time - m.born) / YEAR < 30 ? 5 : 0;
    const title = STATION_INFO[m.station].title;
    if (m.noticeAt !== undefined) {
      if (score >= STAY_AT) {
        m.noticeAt = undefined;
        state.journal.push({ t: state.time, kind: "info", text: `${title} ${m.name} has withdrawn their notice. They're staying on.` });
      } else if (score < LEAVE_BELOW + young) {
        leaving.push(m);
      }
    } else if (score < NOTICE_BELOW + young) {
      m.noticeAt = state.time;
      state.journal.push({
        t: state.time,
        kind: "warning",
        text: `${title} ${m.name} has given notice: they'll leave when we next dock unless things improve. A bonus, shore leave or a good trip might change their mind.`,
      });
    }
  }
  if (leaving.length > 0) {
    state.crew = state.crew.filter((m) => !leaving.includes(m));
    for (const m of leaving) {
      state.journal.push({
        t: state.time,
        kind: "warning",
        text: `${STATION_INFO[m.station].title} ${m.name} collected their pay and left the ship. The post is empty until you sign someone at the hiring hall.`,
      });
    }
  }
}

/**
 * The crew's share of a sale: paid out as bonuses, split by level. Bonuses lift happiness (about a
 * point per day of wages, up to 15 a payout) and, more slowly, loyalty. Returns what was paid.
 */
export function payShare(state: GameState, saleCredits: number): number {
  const share = Math.max(0, Math.min(MAX_CREW_SHARE, state.crewShare ?? 0));
  const crew = state.crew ?? [];
  if (share <= 0 || crew.length === 0 || saleCredits <= 0) return 0;
  const pot = crewCut(state, saleCredits);
  const weights = crew.map((m) => levelForXp(m.xp) + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  crew.forEach((m, i) => {
    const pay = (pot * (weights[i] as number)) / total;
    const days = pay / Math.max(1, wageOf(m));
    cheer(state, m, Math.min(15, days));
    bond(state, m, Math.min(2, days * 0.1));
  });
  return pot;
}

/** What the crew's share of a sale of this size comes to under the current setting (0 if nobody is aboard to be paid). */
export function crewCut(state: GameState, saleCredits: number): number {
  const share = Math.max(0, Math.min(MAX_CREW_SHARE, state.crewShare ?? 0));
  if (share <= 0 || (state.crew ?? []).length === 0 || saleCredits <= 0) return 0;
  return Math.round(saleCredits * share);
}

/** Things about the crew that need the captain's attention: officers on notice, and empty posts. */
export function crewAlerts(state: GameState): { onNotice: CrewMember[]; emptyPosts: OfficerStation[] } {
  const crew = state.crew ?? [];
  return {
    onNotice: crew.filter((m) => m.noticeAt !== undefined),
    emptyPosts: OFFICER_STATIONS.filter((st) => !crew.some((m) => m.station === st)),
  };
}

/** The captain's setting: what share of each sale goes to the crew as bonuses (0–20%). */
export function setCrewShare(state: GameState, share: number): Result<number> {
  state.crewShare = Math.max(0, Math.min(MAX_CREW_SHARE, Math.round(share * 100) / 100));
  return ok(state.crewShare);
}
