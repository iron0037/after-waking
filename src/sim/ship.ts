/** The player's freighter: persistent state plus stats derived from installed upgrades. */
import type { ShipDamage } from "./combat";
import type { CommodityId } from "../data/commodities";
import { BASE_STATS, UPGRADES_BY_ID, type ShipStats } from "../data/ship";
import { HULL_ONLY, HULLS_BY_ID, QUIRKS_BY_ID, type Hull, type HullId } from "../data/hulls";
import { CREATURES_BY_NAME } from "../data/creatures";

export type Cargo = Partial<Record<CommodityId, number>>;

export interface ShipState {
  name: string;
  /** Ship class (AW-103); older saves fly the starter freighter. */
  hull?: HullId;
  /** A secondhand ship's quirk from its last owner (QUIRKS). */
  quirk?: string;
  upgrades: string[];
  fuel: number;
  cargo: Cargo;
  /** Rover cell charge while stowed; it recharges from the ship's reactor before each deployment. */
  roverEnergy?: number;
  /** Battle damage carried until the Intrepid's yard repairs it (combat v1). */
  damage?: ShipDamage;
  /** A creature wrecked the rover (AW-216): its gear is offline until the yard repairs it. */
  roverWrecked?: boolean;
  /** Boat cell charge while stowed (AW-17). */
  boatEnergy?: number;
  /** Live specimens in the containment racks, keyed "bodyId|species". */
  specimens?: Record<string, number>;
  /** Atmospheric probes in the bay. */
  probes?: number;
}

export const SHIP_SPECIMEN_SLOTS = 16;
export const ROVER_SPECIMEN_SLOTS = 6;

/** Slots used by specimens keyed "bodyId|species": plants take one, large creatures two (AW-215). */
export function specimenCount(specimens: Record<string, number> | undefined): number {
  let n = 0;
  for (const [key, v] of Object.entries(specimens ?? {})) n += v * (CREATURES_BY_NAME.get(key.split("|")[1] ?? "")?.size ?? 1);
  return n;
}

export function hullOf(ship: Pick<ShipState, "hull">): Hull {
  return HULLS_BY_ID.get(ship.hull ?? "freighter") ?? HULLS_BY_ID.get("freighter")!;
}

/** Installed by the yard, or built into the hull. */
export function hasFitted(ship: ShipState, id: string): boolean {
  return ship.upgrades.includes(id) || hullOf(ship).builtIn.includes(id);
}

/** Gear that belongs to the rover or the boat, which go with the captain from ship to ship (AW-103). */
export function isVehicleGear(id: string): boolean {
  const c = UPGRADES_BY_ID.get(id)?.category;
  return c === "rover" || c === "boat";
}

/** Why this hull can't take this gear, or null if it can. */
export function fitBlocker(hull: Hull, upgradeId: string): string | null {
  if (hull.builtIn.includes(upgradeId)) return `Built into the ${hull.name.toLowerCase()}.`;
  if (hull.cannotFit.includes(upgradeId)) return `${hull.cannotFitWhy ?? "Doesn't fit this hull"}.`;
  const only = HULL_ONLY[upgradeId];
  if (only && !only.includes(hull.id)) {
    const names = only.map((h) => HULLS_BY_ID.get(h)?.name ?? h);
    return `Only fits ${names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0]} hulls.`;
  }
  return null;
}

export function shipStats(ship: ShipState): ShipStats {
  const stats: ShipStats = structuredClone(BASE_STATS);
  const hull = hullOf(ship);
  hull.base(stats);
  for (const id of hull.builtIn) UPGRADES_BY_ID.get(id)?.apply(stats);
  const quirk = ship.quirk ? QUIRKS_BY_ID.get(ship.quirk) : undefined;
  for (const id of ship.upgrades) {
    const upgrade = UPGRADES_BY_ID.get(id);
    if (!upgrade) throw new Error(`Unknown upgrade ${id}`);
    upgrade.apply(stats);
  }
  quirk?.apply(stats);
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
