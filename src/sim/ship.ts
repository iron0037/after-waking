/** The player's freighter: persistent state plus stats derived from installed upgrades. */
import type { CommodityId } from "../data/commodities";
import { BASE_STATS, UPGRADES_BY_ID, type ShipStats } from "../data/ship";

export type Cargo = Partial<Record<CommodityId, number>>;

export interface ShipState {
  name: string;
  upgrades: string[];
  fuel: number;
  cargo: Cargo;
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
