/** The player's freighter: persistent state plus stats derived from installed upgrades. */
import type { ShipDamage } from "./combat";
import type { CommodityId } from "../data/commodities";
import { BASE_STATS, UPGRADES_BY_ID, type ShipStats } from "../data/ship";

export type Cargo = Partial<Record<CommodityId, number>>;

export interface ShipState {
  name: string;
  upgrades: string[];
  fuel: number;
  cargo: Cargo;
  /** Rover cell charge while stowed; it recharges from the ship's reactor before each deployment. */
  roverEnergy?: number;
  /** Battle damage carried until the Intrepid's yard repairs it (combat v1). */
  damage?: ShipDamage;
  /** Boat cell charge while stowed (AW-17). */
  boatEnergy?: number;
  /** Live specimens in the containment racks, keyed "bodyId|species". */
  specimens?: Record<string, number>;
  /** Atmospheric probes in the bay. */
  probes?: number;
}

export const SHIP_SPECIMEN_SLOTS = 16;
export const ROVER_SPECIMEN_SLOTS = 6;

export function specimenCount(specimens: Record<string, number> | undefined): number {
  let n = 0;
  for (const v of Object.values(specimens ?? {})) n += v;
  return n;
}

export function shipStats(ship: ShipState): ShipStats {
  const stats: ShipStats = structuredClone(BASE_STATS);
  for (const id of ship.upgrades) {
    const upgrade = UPGRADES_BY_ID.get(id);
    if (!upgrade) throw new Error(`Unknown upgrade ${id}`);
    upgrade.apply(stats);
  }
  return stats;
}

export function cargoTonnes(cargo: Cargo): number {
  let total = 0;
  for (const t of Object.values(cargo)) total += t ?? 0;
  return total;
}

/** Fuel is plicite, roughly 1 t per fuel unit. */
export const FUEL_MASS_T = 1;

export function shipMassT(ship: ShipState, stats: ShipStats = shipStats(ship)): number {
  return stats.hullMassT + cargoTonnes(ship.cargo) + ship.fuel * FUEL_MASS_T;
}

/** Add up to `tonnes` of a commodity; returns how much actually fit. */
export function addCargo(cargo: Cargo, id: CommodityId, tonnes: number, capacity: number): number {
  const room = Math.max(0, capacity - cargoTonnes(cargo));
  const added = Math.min(room, tonnes);
  if (added > 0) cargo[id] = (cargo[id] ?? 0) + added;
  return added;
}

export function removeCargo(cargo: Cargo, id: CommodityId, tonnes: number): number {
  const have = cargo[id] ?? 0;
  const removed = Math.min(have, tonnes);
  const left = have - removed;
  if (left <= 1e-9) delete cargo[id];
  else cargo[id] = left;
  return removed;
}
