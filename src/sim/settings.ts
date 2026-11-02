/**
 * New-game settings (AW-205), chosen once and fixed for the career.
 *
 * - **Universe** settings change what gets generated. They're packed into the high bits of
 *   `GameState.seed` (above 2^32), so everything that regenerates from the seed (the World, the
 *   terrain worker, every cache keyed on the seed) picks them up without being told. The dice only
 *   ever see the low 32 bits (hashSeed drops the rest), so the same base seed lays out the same
 *   Verge whatever the settings; only star count and abundance differ. All-normal packs to 0, so
 *   older saves are unchanged.
 * - **People** settings live in `GameState.settings`.
 *
 * This module imports nothing from the sim at run time, so generation code can use it freely.
 */
import type { GameState } from "./state";

export type Abundance = "scarce" | "normal" | "plentiful";
export type Pace = "slow" | "normal" | "fast";
export type Reliability = "limited" | "normal" | "unwavering";
export type PirateFrequency = "rare" | "normal" | "frequent";
export type PirateStrength = "easy" | "normal" | "hard";

/** Star-count choices: the galaxy's size and how many of its stars the first scouts charted. */
export const STAR_COUNTS = [22, 16, 30, 40] as const;
export type StarCount = (typeof STAR_COUNTS)[number];
const CHARTED: Record<StarCount, number> = { 16: 9, 22: 12, 30: 15, 40: 18 };

export interface UniverseSettings {
  stars: StarCount;
  ore: Abundance;
  life: Abundance;
}

export interface PeopleSettings {
  crewXp: Pace;
  reliability: Reliability;
  /** Officers retire, and the unhappy quit. Off: nobody ever leaves the ship. */
  turnover: boolean;
  clanTrust: Pace;
  pirates: PirateFrequency;
  pirateStrength: PirateStrength;
}

export type GameSettings = UniverseSettings & PeopleSettings;

export const DEFAULT_UNIVERSE: UniverseSettings = { stars: 22, ore: "normal", life: "normal" };
export const DEFAULT_PEOPLE: PeopleSettings = {
  crewXp: "normal",
  reliability: "normal",
  turnover: true,
  clanTrust: "normal",
  pirates: "normal",
  pirateStrength: "normal",
};
/** Saves from before the settings existed: officers then were steadier than the new Normal. */
export const LEGACY_PEOPLE: PeopleSettings = { ...DEFAULT_PEOPLE, reliability: "unwavering" };

// --- the universe, packed into the seed -----------------------------------------------------------

const SEED_SPAN = 2 ** 32;
const ABUNDANCE_CODE: Abundance[] = ["normal", "scarce", "plentiful"];

/** The seed the player typed (the low 32 bits). */
export function baseSeed(seed: number): number {
  return seed >= SEED_SPAN ? seed % SEED_SPAN : seed;
}

/** Pack universe settings into a seed. All-normal gives back the base seed. */
export function universeSeed(base: number, u: UniverseSettings): number {
  const stars = STAR_COUNTS.indexOf(u.stars);
  const code = Math.max(0, stars) + 4 * ABUNDANCE_CODE.indexOf(u.ore) + 12 * ABUNDANCE_CODE.indexOf(u.life);
  return baseSeed(Math.abs(Math.floor(base))) + code * SEED_SPAN;
}

/** The universe settings a seed was made with. */
export function universeOf(seed: number): UniverseSettings {
  const code = Math.floor(seed / SEED_SPAN);
  return {
    stars: STAR_COUNTS[code % 4] ?? 22,
    ore: ABUNDANCE_CODE[Math.floor(code / 4) % 3] ?? "normal",
    life: ABUNDANCE_CODE[Math.floor(code / 12) % 3] ?? "normal",
  };
}

export function chartedStars(stars: StarCount): number {
  return CHARTED[stars];
}

const ABUNDANCE_MULT: Record<Abundance, number> = { scarce: 0.6, normal: 1, plentiful: 1.5 };

/** Ore: how many seams a region holds, and (more gently) how big they are. */
export function oreCountMult(seed: number): number {
  return ABUNDANCE_MULT[universeOf(seed).ore];
}
export function oreTonnageMult(seed: number): number {
  return Math.sqrt(ABUNDANCE_MULT[universeOf(seed).ore]);
}
/** Chance a region holds a hidden seam (Hidden Seams perk). */
export function hiddenSeamChance(seed: number): number {
  return { scarce: 0.3, normal: 0.5, plentiful: 0.7 }[universeOf(seed).ore];
}

/** Life: the chance a temperate world (or a wet ice world) carries life, and plant sites per region. */
export function lifeChance(seed: number, kind: "temperate" | "ice"): number {
  const life = universeOf(seed).life;
  return kind === "temperate" ? { scarce: 0.35, normal: 0.6, plentiful: 0.85 }[life] : { scarce: 0.05, normal: 0.1, plentiful: 0.25 }[life];
}
export function floraSitesRange(seed: number): [number, number] {
  return { scarce: [1, 3], normal: [2, 5], plentiful: [3, 7] }[universeOf(seed).life] as [number, number];
}

// --- people ----------------------------------------------------------------------------------

/** The career's People settings (saves from before them play by the legacy rules). */
export function peopleOf(state: Pick<GameState, "settings">): PeopleSettings {
  return state.settings ?? LEGACY_PEOPLE;
}

const PACE_MULT: Record<Pace, number> = { slow: 0.6, normal: 1, fast: 1.6 };

export function crewXpMult(p: PeopleSettings): number {
  return PACE_MULT[p.crewXp];
}

/** Goodwill gains with the clans (losses are unchanged). */
export function clanTrustMult(p: PeopleSettings): number {
  return { slow: 0.6, normal: 1, fast: 1.5 }[p.clanTrust];
}

export function pirateChanceMult(p: PeopleSettings): number {
  return { rare: 0.4, normal: 1, frequent: 1.7 }[p.pirates];
}

/** Raider hulls, guns and shields. */
export function pirateStrengthMult(p: PeopleSettings): number {
  return { easy: 0.75, normal: 1, hard: 1.3 }[p.pirateStrength];
}

export interface ReliabilityRules {
  /** Where happiness settles with nothing happening. */
  baseline: number;
  /** Days away before a long haul wears on the crew, and how hard it wears (per day). */
  longHaulDays: number;
  longHaulPerDay: number;
  /** Loyalty lost to unhappiness runs this much faster. */
  loyaltyLossMult: number;
  /** Added to the score below which someone gives notice (and must beat to stay). */
  noticeShift: number;
}

/** Unwavering is how the crew behaved before the settings existed. */
export const RELIABILITY: Record<Reliability, ReliabilityRules> = {
  unwavering: { baseline: 55, longHaulDays: 90, longHaulPerDay: 0.2, loyaltyLossMult: 1, noticeShift: 0 },
  normal: { baseline: 52, longHaulDays: 75, longHaulPerDay: 0.3, loyaltyLossMult: 1.5, noticeShift: 4 },
  limited: { baseline: 45, longHaulDays: 45, longHaulPerDay: 0.5, loyaltyLossMult: 2, noticeShift: 10 },
};

/** "22 stars · ore normal · life plentiful · crew xp fast · …": the settings in one line, for reports. */
export function settingsLine(s: GameSettings): string {
  return [
    `${s.stars} stars`,
    `ore ${s.ore}`,
    `life ${s.life}`,
    `leveling ${s.crewXp}`,
    `reliability ${s.reliability}`,
    s.turnover ? "turnover on" : "turnover off",
    `clan trust ${s.clanTrust}`,
    `pirates ${s.pirates}, ${s.pirateStrength}`,
  ].join(" · ");
}

// --- labels, for the new-game page and the roster ---------------------------------------------------

export interface SettingChoice<T> {
  value: T;
  label: string;
}

export const SETTING_LABELS = {
  abundance: [
    { value: "scarce", label: "Scarce" },
    { value: "normal", label: "Normal" },
    { value: "plentiful", label: "Plentiful" },
  ] as SettingChoice<Abundance>[],
  pace: [
    { value: "slow", label: "Slow" },
    { value: "normal", label: "Normal" },
    { value: "fast", label: "Fast" },
  ] as SettingChoice<Pace>[],
  reliability: [
    { value: "limited", label: "Limited" },
    { value: "normal", label: "Normal" },
    { value: "unwavering", label: "Unwavering" },
  ] as SettingChoice<Reliability>[],
  pirates: [
    { value: "rare", label: "Rare" },
    { value: "normal", label: "Normal" },
    { value: "frequent", label: "Frequent" },
  ] as SettingChoice<PirateFrequency>[],
  pirateStrength: [
    { value: "easy", label: "Easy" },
    { value: "normal", label: "Normal" },
    { value: "hard", label: "Hard" },
  ] as SettingChoice<PirateStrength>[],
};
