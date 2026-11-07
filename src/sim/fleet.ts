/**
 * The captain's ships (AW-103): buy a clan's hull, lay ships up at the Intrepid, and take command of
 * another. Only the ship you're flying is in use. Its fitted gear, fuel, probes and battle damage stay
 * with it; the rover, the boat and their gear, the hold and the specimen racks move with the captain.
 */
import { HULLS, HULLS_BY_ID, HULL_RESALE, HULL_STANDING, QUIRKS, SWAP_MINUTES, type Hull, type HullId } from "../data/hulls";
import { CLAN_NAMES, UPGRADES_BY_ID } from "../data/ship";
import { upgradePriceFor } from "./clan";
import { effectiveStats, shipSpecimenSlots } from "./perks";
import { changeRep, clanRefuses, TIER_INFO, tierOf, type RepTier } from "./reputation";
import { fail, ok, type Result } from "./result";
import { bondClan } from "./sentiment";
import { cargoTonnes, hullOf, isVehicleGear, specimenCount, type ShipState } from "./ship";
import { advanceTime, log, withRng, type GameState } from "./state";

const TIER_ORDER: RepTier[] = ["hostile", "cool", "neutral", "friendly", "trusted"];

/** Hulls the clans build (everything but the starter freighter). */
export function hullsForSale(): readonly Hull[] {
  return HULLS.filter((h) => h.vendor !== null);
}

/** What a hull costs this captain: their own clan's discount and the builder's view of them. */
export function hullPrice(state: GameState, hull: Hull): number {
  return hull.vendor ? upgradePriceFor(state, hull.vendor, hull.price) : hull.price;
}

/** Why this captain can't buy this hull right now; empty if they can. */
export function hullBlockers(state: GameState, id: HullId): string[] {
  const hull = HULLS_BY_ID.get(id);
  if (!hull || !hull.vendor) return ["Nobody builds that hull new."];
  const out: string[] = [];
  if (state.location.kind !== "intrepid") out.push("Ships are bought at the Intrepid.");
  const tier = tierOf(state, hull.vendor);
  if (clanRefuses(state, hull.vendor)) out.push(`${CLAN_NAMES[hull.vendor]} won't deal with you.`);
  else if (TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(HULL_STANDING))
    out.push(`${CLAN_NAMES[hull.vendor]} sells its ships to friends: you're ${TIER_INFO[tier].label.toLowerCase()} with them.`);
  const price = hullPrice(state, hull);
  if (state.credits < price) out.push(`Costs ${price.toLocaleString()} cr; you have ${Math.floor(state.credits).toLocaleString()}.`);
  return out;
}

/** Every ship the captain owns, the one in use first. */
export function fleet(state: GameState): ShipState[] {
  return [state.ship, ...(state.berthed ?? [])];
}

function defaultName(state: GameState, hull: Hull): string {
  const used = new Set(fleet(state).map((s) => s.name));
  const free = hull.names.find((n) => !used.has(n));
  if (free) return free;
  let n = 2;
  while (used.has(`${hull.names[0]} ${n}`)) n++;
  return `${hull.names[0]} ${n}`;
}

/** Buy a new ship from its clan's yard. It's berthed at the Intrepid, fuelled, ready to take command of. */
export function buyHull(state: GameState, id: HullId, name?: string): Result<ShipState> {
  const blockers = hullBlockers(state, id);
  if (blockers.length > 0) return fail(blockers[0]!);
  const hull = HULLS_BY_ID.get(id)!;
  const vendor = hull.vendor!;
  const price = hullPrice(state, hull);
  const ship: ShipState = { name: name?.trim() || defaultName(state, hull), hull: id, upgrades: [], fuel: 0, cargo: {} };
  // The Freebooters' ships come secondhand, with something left over from the last owner.
  if (id === "corsair") ship.quirk = withRng(state, (rng) => rng.pick(QUIRKS)).id;
  ship.fuel = effectiveFuelCap(state, ship);
  state.credits -= price;
  state.berthed = [...(state.berthed ?? []), ship];
  state.shipsBought = (state.shipsBought ?? 0) + 1;
  changeRep(state, vendor, 5, `Bought a ${hull.name.toLowerCase()}`);
  bondClan(state, vendor, 4);
  log(state, "trade", `Bought the ${ship.name}, a ${CLAN_NAMES[vendor]} ${hull.name.toLowerCase()}, for ${price.toLocaleString()} cr. She's berthed at the Intrepid with full tanks.`);
  return ok(ship);
}

/** The fuel tanks a ship would have under this crew. */
function effectiveFuelCap(state: GameState, ship: ShipState): number {
  return withShip(state, ship, () => effectiveStats(state).fuelCapacity);
}

/** Run `fn` as if `ship` were the one in use (for stats that depend on the crew). */
function withShip<T>(state: GameState, ship: ShipState, fn: () => T): T {
  const was = state.ship;
  state.ship = ship;
  try {
    return fn();
  } finally {
    state.ship = was;
  }
}

/** Why the captain can't move to the berthed ship at this index; empty if they can. */
export function commandBlockers(state: GameState, index: number): string[] {
  const target = state.berthed?.[index];
  if (!target) return ["No such ship."];
  const out: string[] = [];
  if (state.location.kind !== "intrepid") out.push("Ships are changed at the Intrepid.");
  if ((state.yard ?? []).some((j) => j.kind === "install" || j.kind === "repair")) out.push("Wait for the yard to finish its work on this ship.");
  const moved = withShip(state, target, () => ({ hold: effectiveStats(state).cargoCapacityT, racks: shipSpecimenSlots(state) }));
  const hold = cargoTonnes(state.ship.cargo);
  if (hold > moved.hold + 1e-6) out.push(`The ${target.name} holds ${Math.floor(moved.hold)} t; sell or unload down from ${Math.ceil(hold)} t first.`);
  const racks = specimenCount(state.ship.specimens);
  if (racks > moved.racks) out.push(`The ${target.name} has ${moved.racks} specimen racks; you're carrying ${racks}.`);
  return out;
}

/**
 * Take command of a berthed ship. The crew, the rover and the boat (with their gear and charge), the
 * hold and the specimens come across; the old ship is berthed with its own fittings, fuel and probes.
 */
export function commandShip(state: GameState, index: number): Result<ShipState> {
  const blockers = commandBlockers(state, index);
  if (blockers.length > 0) return fail(blockers[0]!);
  const berthed = [...(state.berthed ?? [])];
  const next = berthed[index]!;
  const prev = state.ship;
  const vehicles = prev.upgrades.filter(isVehicleGear);
  next.upgrades = [...next.upgrades.filter((id) => !isVehicleGear(id)), ...vehicles.filter((id) => !next.upgrades.includes(id))];
  prev.upgrades = prev.upgrades.filter((id) => !isVehicleGear(id));
  next.cargo = prev.cargo;
  prev.cargo = {};
  if (prev.specimens) next.specimens = prev.specimens;
  delete prev.specimens;
  for (const key of ["roverEnergy", "boatEnergy", "roverWrecked"] as const) {
    if (prev[key] !== undefined) (next as unknown as Record<string, unknown>)[key] = prev[key];
    else delete next[key];
    delete prev[key];
  }
  berthed.splice(index, 1, prev);
  state.berthed = berthed;
  state.ship = next;
  advanceTime(state, SWAP_MINUTES);
  log(state, "trade", `Moved the crew, the rover${vehicles.includes("boat") ? " and the boat" : ""} across to the ${next.name}. The ${prev.name} is berthed at the Intrepid.`);
  return ok(next);
}

/** What the yard pays for a laid-up ship: half its hull and fitted gear. */
export function resaleValue(ship: ShipState): number {
  const gear = ship.upgrades.filter((id) => !isVehicleGear(id)).reduce((sum, id) => sum + (UPGRADES_BY_ID.get(id)?.price ?? 0), 0);
  return Math.round(((hullOf(ship).price + gear) * HULL_RESALE) / 100) * 100;
}

/** Sell a berthed ship back to the yards. */
export function sellShip(state: GameState, index: number): Result<number> {
  const ship = state.berthed?.[index];
  if (!ship) return fail("No such ship.");
  if (state.location.kind !== "intrepid") return fail("Ships are sold at the Intrepid.");
  const value = resaleValue(ship);
  state.credits += value;
  state.berthed = (state.berthed ?? []).filter((_, i) => i !== index);
  log(state, "trade", `Sold the ${ship.name} for ${value.toLocaleString()} cr.`);
  return ok(value);
}

/** Pirate colours (the corsair): Helm marks it each time you dock. */
export const PIRATE_COLOURS_REP = -1.5;

export function fleetOnDocked(state: GameState): void {
  if ((state.ship.hull ?? "freighter") === "corsair") changeRep(state, "helm", PIRATE_COLOURS_REP, "Docked under pirate colours", false);
}
