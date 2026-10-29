/**
 * Combat v1 (M3): pirates. Raider templates and the numbers behind the battle. Rules live in
 * src/sim/combat.ts. See docs/game_design.md (Combat v1).
 */

/** Ship systems that take damage. Hull is hit points; the rest are percentages of impairment. */
export type ShipSystem = "drives" | "weapons" | "sensors";
export type FireTarget = "hull" | ShipSystem;

/** 0 = close, 1 = medium, 2 = long. */
export type RangeBand = 0 | 1 | 2;
export const RANGE_NAMES = ["close", "medium", "long"] as const;

/** Chance a kinetic battery hits at each range (lasers are steadier). */
export const KINETIC_HIT = [0.8, 0.5, 0.2] as const;
export const LASER_HIT = [0.75, 0.7, 0.6] as const;

export interface RaiderTemplate {
  id: string;
  name: string;
  hull: number;
  laser: number;
  kinetic: number;
  shields: number;
  /** Relative speed; the stock freighter is 1. */
  speed: number;
  /** What Helm pays for bringing one to heel. */
  bounty: number;
  /** Below this share of hull, they think about running or striking. */
  nerve: number;
  /** What Helm pays for the raider captain, handed over alive. */
  captainBounty: number;
  /** Crew aboard besides the captain, and tonnes of plunder in their hold. */
  crew: [number, number];
  lootT: [number, number];
}

export const RAIDERS: readonly RaiderTemplate[] = [
  { id: "skiff", name: "raider skiff", hull: 60, laser: 7, kinetic: 0, shields: 0, speed: 1.15, bounty: 2_500, nerve: 0.45, captainBounty: 2_000, crew: [2, 3], lootT: [4, 10] },
  { id: "gunboat", name: "pirate gunboat", hull: 100, laser: 8, kinetic: 14, shields: 4, speed: 1.0, bounty: 5_000, nerve: 0.35, captainBounty: 4_000, crew: [3, 5], lootT: [10, 25] },
  { id: "corsair", name: "corsair", hull: 150, laser: 12, kinetic: 18, shields: 8, speed: 1.05, bounty: 9_000, nerve: 0.3, captainBounty: 7_000, crew: [4, 6], lootT: [20, 40] },
];

export const RAIDER_CAPTAINS = [
  "Mags Orlov", "Teo Vance", "the Widow Sarr", "Dace Mbeki", "Ruth Calloway", "Ivo Brandt", "Kesh Amari", "Old Pell",
] as const;

/** What Helm pays a head for raider crew handed over (besides the captain). */
export const HEAD_BOUNTY = 400;

/** The stock freighter's fighting numbers, before upgrades. */
export const BASE_COMBAT = { hull: 100, laser: 6, kinetic: 0, shields: 0 } as const;
