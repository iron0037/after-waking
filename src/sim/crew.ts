/**
 * The crew: the captain (the player) and five officers, one per station. People get better at
 * their jobs by doing them: experience comes from the work, levels give small, steady bonuses,
 * and better people cost more. Clans train their people for particular stations.
 *
 * Officers can be replaced from the hiring hall aboard the Intrepid; the pool turns over monthly.
 * (Perk trees, aging and retirement come later.)
 */
import { clanRefuses } from "./reputation";
import {
  CLAN_TRAITS,
  FIRST_NAMES,
  OFFICER_STATIONS,
  STATION_INFO,
  SURNAMES,
  type OfficerStation,
  type Station,
  EARTH_MEMORY_AGE,
  type UpbringingId,
} from "../data/crew";
import { CLAN_NAMES, type ClanId } from "../data/ship";
import { fail, ok, type Result } from "./result";
import { cheer, ensureSentiment, isMiserable } from "./sentiment";
import { autoSpendPerks, crossTrainingLevels, hasPerk, MAX_EFFECTIVE_LEVEL } from "./perks";
import { hashSeed, rngFor, type Rng } from "./rng";
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
  /** What they think of the captain (AW-100): short-term happiness and long-term loyalty, 0–100. */
  happiness?: number;
  loyalty?: number;
  /** When they gave notice, if they have. */
  noticeAt?: number;
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
  /** Taken from a raider and offered a berth instead of a cell (combat v1.1): waits in the hall a year. */
  formerRaider?: boolean;
  keepUntil?: number;
}

export const MAX_LEVEL = 10;
/** Daily wage of a level-1 officer, before clan adjustments. */
export const BASE_WAGE = 15;
/** Wage growth per level above 1. */
export const WAGE_PER_LEVEL = 0.07;
/** Extra experience in a clan's trained stations. */
export const AFFINITY_XP = 1.25;
/** Cryo-children learn a little faster. */
export const CRYO_CHILD_XP = 1.1;

/**
 * Where someone grew up, from when they were born relative to the Waking (time 0). Fixed for life.
 * Born before it: a sleeper, who woke at the age they went under. Born after: decks or settlement.
 */
export function upbringingOf(m: Pick<CrewMember, "id" | "name" | "born">): UpbringingId {
  if (m.born < 0) return -m.born / YEAR >= EARTH_MEMORY_AGE ? "earth" : "cryoChild";
  return hashSeed(m.id, m.name, "upbringing") % 3 === 0 ? "settlement" : "decks";
}
/** Which face of the portrait pool somebody wears (AW-150): a hash of their id, so it never needs saving and never changes. */
export function portraitFace(id: string, poolSize: number): number {
  return poolSize > 0 ? hashSeed(id, "portrait") % poolSize : 0;
}

const FEMININE_NAMES = new Set(["Ada", "Celia", "Esme", "Greta", "Ines", "Lena", "Nia", "Priya", "Rosa", "Tova", "Vesna", "Yara", "Amara", "Coral", "Elif", "Gwen", "Isolde", "Kesi", "Mira"]);
const MASCULINE_NAMES = new Set(["Bram", "Dario", "Farid", "Hollis", "Kaito", "Marek", "Oren", "Silas", "Ugo", "Xavi", "Zeno", "Bastian", "Dov", "Fenn", "Hamid", "Lior", "Nils"]);

/** Which portrait pool a first name suggests, so "Ada" doesn't wear a man's face. Unknown and neutral names (Quill, Wren, a custom captain) return null: any face. */
export function nameGender(name: string): "f" | "m" | null {
  const first = name.replace(/^Captain\s+/i, "").split(/\s+/)[0] ?? "";
  return FEMININE_NAMES.has(first) ? "f" : MASCULINE_NAMES.has(first) ? "m" : null;
}

/** Hiring order from an id: the starters ("c0".."c4") first, then recruits by pool and slot ("r12-3"). */
function hireOrder(id: string): number {
  const m = /^r(\d+)-(\d+)$/.exec(id);
  if (m) return 1000 + Number(m[1]) * 100 + Number(m[2]);
  const c = /^c(\d+)$/.exec(id);
  return c ? Number(c[1]) : 999;
}

/**
 * Faces for everybody on screen at once, so nobody shares one (AW-150): the captain first, then the
 * crew in hiring order, then the hiring hall. Each person takes their hashed face (within their
 * name's pool) or the next free one, so an officer keeps their face as people come and go around them.
 */
export function assignFaces(people: readonly { seed: string; name: string; fixed?: number }[], faces: number, genders?: string): Map<string, number> {
  const out = new Map<string, number>();
  const taken = new Set<number>();
  // A face somebody chose (the captain's) is theirs; everybody else works around it.
  for (const p of people) {
    if (p.fixed === undefined || p.fixed < 0 || p.fixed >= faces) continue;
    out.set(p.seed, p.fixed);
    taken.add(p.fixed);
  }
  for (const p of people) {
    if (out.has(p.seed)) continue;
    const g = nameGender(p.name);
    const pool = g && genders?.length === faces ? [...genders].flatMap((c, i) => (c === g ? [i] : [])) : Array.from({ length: faces }, (_, i) => i);
    if (pool.length === 0) continue;
    const start = portraitFace(p.seed, pool.length);
    let face = pool[start] as number;
    for (let k = 0; k < pool.length; k++) {
      const f = pool[(start + k) % pool.length] as number;
      if (!taken.has(f)) {
        face = f;
        break;
      }
    }
    taken.add(face);
    out.set(p.seed, face);
  }
  return out;
}

/** Who's on the roster, in the order faces are handed out. */
export function portraitRoster(state: Pick<GameState, "captain" | "crew" | "recruits">, captainSeed: string): { seed: string; name: string; fixed?: number }[] {
  const crew = [...(state.crew ?? [])].sort((a, b) => hireOrder(a.id) - hireOrder(b.id));
  return [{ seed: captainSeed, name: state.captain.name, fixed: state.captain.face }, ...crew.map((m) => ({ seed: m.id, name: m.name })), ...(state.recruits ?? []).map((r) => ({ seed: r.id, name: r.name }))];
}

/** Portrait age band 0..3 (20s, 40s, 50s, 60+) for somebody of this age. The cut-offs follow how the pictures look. */
export function portraitBand(age: number): number {
  return age < 32 ? 0 : age < 47 ? 1 : age < 58 ? 2 : 3;
}

/** How often the hiring hall's pool turns over. */
export const RECRUIT_POOL_DAYS = 60;
export const RECRUIT_POOL_SIZE = 5;
/** Signing bonus, in days of the recruit's wage. */
export const SIGNING_DAYS = 30;

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

/**
 * How fast each station learns, relative to the raw awards. Science and navigation get a steady
 * stream of small awards (every find, every burn), so they're scaled down toward the pace of the
 * others: a busy station reaches level 3-4 in its first ten trips, 7 in about fifty.
 */
export const STATION_XP_RATE: Record<Station, number> = {
  captain: 1,
  science: 0.45,
  navigation: 0.6,
  engineering: 1,
  comms: 1,
  medical: 1,
};

/** Credit work done at a station. Logs level-ups. */
export function awardXp(state: GameState, station: Station, amount: number): void {
  amount *= STATION_XP_RATE[station];
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
  m.xp +=
    amount * boost * (CLAN_TRAITS[m.clan].affinity.includes(station) ? AFFINITY_XP : 1) * (upbringingOf(m) === "cryoChild" ? CRYO_CHILD_XP : 1);
  const after = levelForXp(m.xp);
  if (after > before) {
    state.journal.push({
      t: state.time,
      kind: "info",
      text: `${STATION_INFO[station].title} ${m.name} reached level ${after}: ${bonusLine(state, station)}. Wage now ${wageOf(m)} cr a day.`,
    });
    queueLevelUp(state, { station, name: m.name, level: after });
    cheer(state, m, 8);
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

/** The level someone actually works at: a miserable officer goes through the motions, a level below. */
export function workingLevel(state: GameState, station: Station): number {
  const holder = station === "captain" ? null : officerAt(state, station);
  return Math.max(0, stationLevel(state, station) - (holder && isMiserable(holder) ? 1 : 0));
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
    const level = workingLevel(state, station);
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
    // Veterans skew older; plenty of sleepers who woke as adults still sign on.
    born: now - Math.round((22 + level * 2.5 + rng.range(0, 22)) * YEAR),
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
  // Former raiders you offered a berth wait for you (a year) while the rest of the hall turns over.
  const waiting = (state.recruits ?? []).filter((r) => r.formerRaider && state.time < (r.keepUntil ?? 0));
  state.recruits = [...waiting, ...rollPool(state, pool)];
  state.nextRecruitsAt = (pool + 1) * RECRUIT_POOL_DAYS * DAY;
}

/**
 * A promising hand from a beaten raider's crew: a Freebooter of some experience, grateful for the
 * berth (more loyal, half the usual signing fee). Waits in the hiring hall for a year.
 */
export function raiderRecruit(rng: Rng, id: string, now: number): Recruit {
  const station = rng.pick(OFFICER_STATIONS);
  const person = newPerson(rng, id, station, "freebooters", rng.int(2, 4), now);
  autoSpendPerks(person, rng);
  ensureSentiment(person, true);
  person.loyalty = Math.min(100, (person.loyalty ?? 50) + 15);
  return { ...person, fee: Math.round((SIGNING_DAYS * wageOf(person)) / 2), formerRaider: true, keepUntil: now + 365 * DAY };
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
  if (clanRefuses(state, r.clan)) return fail(`${r.name} won't sign with a captain ${CLAN_NAMES[r.clan]} won't deal with.`);
  const fee = signingFee(state, r);
  if (state.credits < fee) return fail(`Signing ${r.name} costs ${fee.toLocaleString()} cr.`);
  state.credits -= fee;
  const { fee: _fee, formerRaider: _raider, keepUntil: _keep, ...hired } = r;
  ensureSentiment(hired, true);
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
  for (const m of state.crew) ensureSentiment(m);
  state.lastDockedAt ??= state.time;
  if (state.nextRecruitsAt === undefined) {
    state.nextRecruitsAt = state.time;
    tickRecruits(state);
  }
}

/** Choose the captain's portrait (a face index from the portrait atlas), or clear it to be assigned one. */
export function setCaptainFace(state: GameState, face: number | null): Result<number | null> {
  if (face === null) {
    delete state.captain.face;
    return ok(null);
  }
  if (!Number.isInteger(face) || face < 0) return fail("No such portrait.");
  state.captain.face = face;
  return ok(face);
}
