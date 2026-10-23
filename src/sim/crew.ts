/**
 * The crew: the captain (the player) and five officers, one per station. People get better at
 * their jobs by doing them: experience comes from the work, levels give small, steady bonuses,
 * and better people cost more. Clans train their people for particular stations.
 *
 * Officers can be replaced from the hiring hall aboard the Intrepid; the pool turns over monthly.
 * (Perk trees, aging and retirement come later.)
 */
import {
  CLAN_TRAITS,
  FIRST_NAMES,
  OFFICER_STATIONS,
  STATION_INFO,
  SURNAMES,
  type OfficerStation,
  type Station,
} from "../data/crew";
import { CLAN_NAMES, type ClanId } from "../data/ship";
import { fail, ok, type Result } from "./result";
import { autoSpendPerks, crossTrainingLevels, hasPerk, MAX_EFFECTIVE_LEVEL } from "./perks";
import { rngFor, type Rng } from "./rng";
import type { GameState } from "./state";
import { DAY, YEAR } from "./units";

export interface CrewMember {
  id: string;
  name: string;
  station: OfficerStation;
  clan: ClanId;
  born: number;
  xp: number;
  /** Perks taken (AW-95); they leave with the person. */
  perks?: string[];
}

/** A level gained, waiting for the player to see it (and maybe pick a perk). */
export interface LevelUp {
  station: Station;
  name: string;
  level: number;
}

/** Someone in the hiring hall. The fee is a signing bonus paid up front. */
export interface Recruit extends CrewMember {
  fee: number;
}

export const MAX_LEVEL = 10;
/** Daily wage of a level-1 officer, before clan adjustments. */
export const BASE_WAGE = 30;
/** Wage growth per level above 1. */
export const WAGE_PER_LEVEL = 0.07;
/** Extra experience in a clan's trained stations. */
export const AFFINITY_XP = 1.25;
/** How often the hiring hall's pool turns over. */
export const RECRUIT_POOL_DAYS = 30;
export const RECRUIT_POOL_SIZE = 5;
/** Signing bonus, in days of the recruit's wage. */
export const SIGNING_DAYS = 15;

// --- levels ------------------------------------------------------------------------------

/** Total experience needed to reach `level` (level 1 needs none). */
export function xpForLevel(level: number): number {
  // ~3 levels in the first ten trips for a busy station; the cap takes most of a career (80+ trips).
  return level <= 1 ? 0 : Math.round(90 * Math.pow(level - 1, 1.8));
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/** Progress toward the next level, 0..1 (1 at the cap). */
export function levelProgress(xp: number): number {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) return 1;
  const lo = xpForLevel(level);
  return (xp - lo) / (xpForLevel(level + 1) - lo);
}

export function officerAt(state: GameState, station: OfficerStation): CrewMember | null {
  return (state.crew ?? []).find((m) => m.station === station) ?? null;
}

/** Level of whoever holds a station (the captain's own for "captain"); 0 if the post is empty. */
export function stationLevel(state: GameState, station: Station): number {
  if (station === "captain") return levelForXp(state.captain.xp ?? 0);
  const m = officerAt(state, station);
  return m ? levelForXp(m.xp) : 0;
}

// --- experience --------------------------------------------------------------------------

/** Credit work done at a station. Logs level-ups. */
export function awardXp(state: GameState, station: Station, amount: number): void {
  if (amount <= 0) return;
  // Mentor (medic) and Inspiring (captain) lift everyone's learning.
  const boost = 1 + (hasPerk(state, "mentor") ? 0.1 : 0) + (hasPerk(state, "inspiring") ? 0.1 : 0);
  if (station === "captain") {
    const before = levelForXp(state.captain.xp ?? 0);
    state.captain.xp = (state.captain.xp ?? 0) + amount * boost;
    const after = levelForXp(state.captain.xp);
    if (after > before) {
      state.journal.push({ t: state.time, kind: "info", text: `${captainTitle(state.captain.name)} reached level ${after}: ${bonusLine(state, "captain")}.` });
      queueLevelUp(state, { station, name: captainTitle(state.captain.name), level: after });
    }
    return;
  }
  const m = officerAt(state, station);
  if (!m) return;
  const before = levelForXp(m.xp);
  m.xp += amount * boost * (CLAN_TRAITS[m.clan].affinity.includes(station) ? AFFINITY_XP : 1);
  const after = levelForXp(m.xp);
  if (after > before) {
    state.journal.push({
      t: state.time,
      kind: "info",
      text: `${STATION_INFO[station].title} ${m.name} reached level ${after}: ${bonusLine(state, station)}. Wage now ${wageOf(m)} cr a day.`,
    });
    queueLevelUp(state, { station, name: m.name, level: after });
  }
}

function queueLevelUp(state: GameState, up: LevelUp): void {
  state.levelUps = [...(state.levelUps ?? []).filter((x) => x.station !== up.station), up];
}

/** The player has seen the oldest level-up notice (the point stays banked if no perk was picked). */
export function acknowledgeLevelUp(state: GameState): Result<LevelUp | null> {
  const [first, ...rest] = state.levelUps ?? [];
  state.levelUps = rest;
  return ok(first ?? null);
}

/** "Captain Reyes", whether or not the saved name already carries the rank. */
export function captainTitle(name: string): string {
  return /^captain\s/i.test(name) ? name : `Captain ${name}`;
}

// --- wages -------------------------------------------------------------------------------

export function wageAt(level: number, clan: ClanId): number {
  return Math.round(BASE_WAGE * (1 + WAGE_PER_LEVEL * (level - 1)) * CLAN_TRAITS[clan].wage);
}

export function wageOf(m: CrewMember): number {
  return wageAt(levelForXp(m.xp), m.clan);
}

/** What the officers earn per day, together. (The captain draws no wage.) */
export function dailyWages(state: GameState): number {
  return (state.crew ?? []).reduce((sum, m) => sum + wageOf(m), 0);
}

// --- bonuses -----------------------------------------------------------------------------

export interface CrewBonuses {
  /** Science: extra hexes of sensor sweep. */
  sensorRadius: number;
  /** Engineering: drill rate multiplier. */
  drillRate: number;
  /** Engineering: storm/quake/breakdown chance multiplier. */
  incidentRate: number;
  /** Medical: multiplier on time lost to incidents. */
  incidentHours: number;
  /** Medical: specimen price multiplier. */
  specimenPrice: number;
  /** Navigation: in-system fuel multiplier. */
  flightFuel: number;
  /** Navigation: fold fuel multiplier. */
  foldFuel: number;
  /** Engineering: fold-drive refit time multiplier. */
  foldRefit: number;
  /** Navigation: in-system flight time multiplier. */
  flightTime: number;
  /** Captain: sale price multiplier. */
  salePrice: number;
  /** Comms: contract pay multiplier. */
  contractPay: number;
}

/** The effect of a station at a given level. Level 1 is the baseline; an empty post (0) is a penalty. */
export function stationBonuses(station: Station, level: number): Partial<CrewBonuses> {
  const b = level - 1; // -1 when the post is empty
  switch (station) {
    case "science":
      return { sensorRadius: b < 0 ? -1 : Math.floor(b / 3) };
    case "engineering":
      return { drillRate: 1 + 0.04 * b, incidentRate: 1 - 0.05 * b, foldRefit: 1 - 0.04 * b };
    case "navigation":
      return { flightFuel: 1 - 0.03 * b, foldFuel: 1 - 0.02 * b, flightTime: 1 - 0.02 * b };
    case "captain":
      return { salePrice: 1 + 0.01 * b };
    case "comms":
      return { contractPay: 1 + 0.03 * b };
    case "medical":
      return { incidentHours: 1 - 0.05 * b, specimenPrice: 1 + 0.03 * b };
  }
}

export function crewBonuses(state: GameState): CrewBonuses {
  const out: CrewBonuses = {
    sensorRadius: 0,
    drillRate: 1,
    incidentRate: 1,
    incidentHours: 1,
    specimenPrice: 1,
    flightFuel: 1,
    foldFuel: 1,
    foldRefit: 1,
    flightTime: 1,
    salePrice: 1,
    contractPay: 1,
  };
  for (const station of ["captain", ...OFFICER_STATIONS] as Station[]) {
    const level = stationLevel(state, station);
    const bonuses = stationBonuses(station, level) as Record<string, number>;
    for (const key of Object.keys(bonuses)) {
      // Cross-training perks count as extra levels for one named bonus.
      const extra = crossTrainingLevels(state, key);
      if (extra > 0) bonuses[key] = (stationBonuses(station, Math.min(MAX_EFFECTIVE_LEVEL, level + extra)) as Record<string, number>)[key] as number;
    }
    Object.assign(out, bonuses);
  }
  if (hasPerk(state, "sensor-boost")) out.sensorRadius += 1;
  if (hasPerk(state, "steady-hands")) out.incidentRate *= 0.85;
  return out;
}

const pct = (m: number) => `${m >= 1 ? "+" : "−"}${Math.round(Math.abs(m - 1) * 100)}%`;

/** "drill rate +12%, incidents −15%": what a station's current holder adds, for the roster and the journal. */
export function bonusLine(state: GameState, station: Station, level = stationLevel(state, station)): string {
  const b = stationBonuses(station, level);
  const parts: string[] = [];
  if (b.sensorRadius !== undefined) parts.push(`sensor sweep ${b.sensorRadius >= 0 ? "+" : "−"}${Math.abs(b.sensorRadius)} hex`);
  if (b.drillRate !== undefined) parts.push(`drill rate ${pct(b.drillRate)}`);
  if (b.incidentRate !== undefined) parts.push(`incidents ${pct(b.incidentRate)}`);
  if (b.flightFuel !== undefined) parts.push(`flight fuel ${pct(b.flightFuel)}`);
  if (b.foldFuel !== undefined) parts.push(`fold fuel ${pct(b.foldFuel)}`);
  if (b.foldRefit !== undefined) parts.push(`fold refit ${pct(b.foldRefit)}`);
  if (b.flightTime !== undefined) parts.push(`flight time ${pct(b.flightTime)}`);
  if (b.salePrice !== undefined) parts.push(`sale prices ${pct(b.salePrice)}`);
  if (b.contractPay !== undefined) parts.push(`contract pay ${pct(b.contractPay)}`);
  if (b.incidentHours !== undefined) parts.push(`time lost to incidents ${pct(b.incidentHours)}`);
  if (b.specimenPrice !== undefined) parts.push(`specimen prices ${pct(b.specimenPrice)}`);
  return parts.join(", ");
}

// --- people ------------------------------------------------------------------------------

function newPerson(rng: Rng, id: string, station: OfficerStation, clan: ClanId, level: number, now: number): CrewMember {
  const lo = xpForLevel(level);
  const span = level >= MAX_LEVEL ? 0 : xpForLevel(level + 1) - lo;
  return {
    id,
    name: `${rng.pick(FIRST_NAMES)} ${rng.pick(SURNAMES)}`,
    station,
    clan,
    // Veterans skew older.
    born: now - Math.round((22 + level * 2.5 + rng.range(0, 10)) * YEAR),
    xp: lo + Math.floor(rng.range(0, 0.5) * span),
  };
}

const CLAN_IDS = Object.keys(CLAN_NAMES) as ClanId[];

/** The five officers who came with the freighter: green, from all over the Intrepid. */
export function starterCrew(seed: number, now: number): CrewMember[] {
  const rng = rngFor(seed, "crew", "starter");
  return OFFICER_STATIONS.map((station, i) => {
    const m = newPerson(rng, `c${i}`, station, rng.pick(CLAN_IDS), 1, now);
    m.xp = 0;
    return m;
  });
}

function rollPool(state: GameState, pool: number): Recruit[] {
  const rng = rngFor(state.seed, "crew", "recruits", pool);
  // Talent Scout: two more names on the board, and better ones.
  const scout = hasPerk(state, "talent-scout");
  return Array.from({ length: RECRUIT_POOL_SIZE + (scout ? 2 : 0) }, (_, i) => {
    const station = rng.pick(OFFICER_STATIONS);
    const trained = CLAN_IDS.filter((c) => CLAN_TRAITS[c].affinity.includes(station));
    // About half come from a clan that trains for the post, and those start further along.
    const clan = trained.length > 0 && rng.chance(0.5) ? rng.pick(trained) : rng.pick(CLAN_IDS);
    const base = rng.weighted([
      [1, 3],
      [2, 4],
      [3, 3],
      [4, 2],
      [5, 1],
    ] as const);
    const level = Math.min(MAX_LEVEL, base + (CLAN_TRAITS[clan].affinity.includes(station) ? 1 : 0) + (scout ? 1 : 0));
    const person = newPerson(rng, `r${pool}-${i}`, station, clan, level, state.time);
    autoSpendPerks(person, rng);
    return { ...person, fee: SIGNING_DAYS * wageOf(person) };
  });
}

/** Turn the hiring hall's pool over when its month is up. Called as time passes. */
export function tickRecruits(state: GameState): void {
  if (state.nextRecruitsAt === undefined) return;
  if (state.time < state.nextRecruitsAt) return;
  const pool = Math.floor(state.time / (RECRUIT_POOL_DAYS * DAY));
  state.recruits = rollPool(state, pool);
  state.nextRecruitsAt = (pool + 1) * RECRUIT_POOL_DAYS * DAY;
}

/** Sign a recruit: pays the signing bonus; whoever held that station leaves the ship. */
/** What signing a recruit costs now (Recruiter halves it). */
export function signingFee(state: GameState, r: Recruit): number {
  return hasPerk(state, "recruiter") ? Math.round(r.fee / 2) : r.fee;
}

export function hireRecruit(state: GameState, recruitId: string): Result<{ hired: CrewMember; replaced: CrewMember | null }> {
  if (state.location.kind !== "intrepid") return fail("Hiring happens aboard the Intrepid.");
  const recruits = state.recruits ?? [];
  const r = recruits.find((x) => x.id === recruitId);
  if (!r) return fail("That recruit has signed elsewhere.");
  const fee = signingFee(state, r);
  if (state.credits < fee) return fail(`Signing ${r.name} costs ${fee.toLocaleString()} cr.`);
  state.credits -= fee;
  const { fee: _fee, ...hired } = r;
  const replaced = officerAt(state, r.station);
  state.crew = [...(state.crew ?? []).filter((m) => m.station !== r.station), hired];
  state.recruits = recruits.filter((x) => x.id !== recruitId);
  const title = STATION_INFO[r.station].title.toLowerCase();
  state.journal.push({
    t: state.time,
    kind: "info",
    text:
      `Signed ${r.name} (${CLAN_NAMES[r.clan]}, level ${levelForXp(r.xp)}) as ${title} for ${fee.toLocaleString()} cr.` +
      (replaced ? ` ${replaced.name} collected their pay and went ashore.` : ""),
  });
  return ok({ hired, replaced });
}

/** Saves from before the crew roster get the starting officers and an open hiring hall. */
export function ensureCrew(state: GameState): void {
  state.captain.xp ??= 0;
  if (!state.crew || state.crew.length === 0) state.crew = starterCrew(state.seed, state.time);
  if (state.nextRecruitsAt === undefined) {
    state.nextRecruitsAt = state.time;
    tickRecruits(state);
  }
}
