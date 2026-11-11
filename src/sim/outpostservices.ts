/**
 * What an outpost offers a ship landed in its region (AW-23): fuel at a markup, a handful of the
 * owning clan's own fittings fitted on the spot, and, at a trading post, a buyer for the hold.
 * The pirate's den is also the only place the Corsair is sold (see fleet.ts).
 */
import { COMMODITIES, type CommodityId } from "../data/commodities";
import { CLAN_NAMES, UPGRADES, type Upgrade } from "../data/ship";
import { fuelPriceFor, sellCargo, yardStatus } from "./actions";
import { upgradePriceFor } from "./clan";
import { worldFor } from "./contracts";
import { outpostAt, type Outpost } from "./outposts";
import { effectiveStats } from "./perks";
import { changeRep, clanRefuses } from "./reputation";
import { fail, ok, type Result } from "./result";
import { rngFor } from "./rng";
import { advanceTime, log, type GameState } from "./state";
import { DAY } from "./units";
import type { World } from "./world";

/** Fuel costs this much more out here than at the Intrepid. */
export const OUTPOST_FUEL_MARKUP = 1.5;
/** A trading post pays this share of the Intrepid's price for cargo. */
export const TRADING_POST_RATE = 0.9;
/** Fittings cost this much more out here, and take this long to fit. */
export const OUTPOST_GEAR_MARKUP = 1.15;
export const OUTPOST_INSTALL_DAYS = 2;
/** How many of its clan's fittings an outpost keeps in stock. */
const OUTPOST_STOCK = 5;

/** The outpost the ship is landed beside: anywhere in its region counts. */
export function currentOutpost(state: GameState, world: World = worldFor(state.seed, state.worldGen ?? 1)): Outpost | null {
  const loc = state.location;
  if (loc.kind !== "surface") return null;
  return outpostAt(world, loc.bodyId, loc.region) ?? null;
}

export function outpostFuelPrice(state: GameState): number {
  return Math.round(fuelPriceFor(state) * OUTPOST_FUEL_MARKUP);
}

export function buyOutpostFuel(state: GameState, world: World, units: number): Result<number> {
  const o = currentOutpost(state, world);
  if (!o) return fail("There's no outpost here.");
  if (clanRefuses(state, o.clan)) return fail(`${CLAN_NAMES[o.clan]} won't sell you anything.`);
  const room = effectiveStats(state).fuelCapacity - state.ship.fuel;
  const price = outpostFuelPrice(state);
  const n = Math.min(Math.floor(units), Math.floor(room), Math.floor(state.credits / price));
  if (n <= 0) return fail(room < 1 ? "Tanks are full." : "You can't afford any fuel.");
  state.ship.fuel += n;
  state.credits -= n * price;
  log(state, "trade", `Bought ${n} units of plicite at ${o.name} for ${(n * price).toLocaleString()} cr (${price} cr a unit).`);
  return ok(n);
}

/** The fittings in stock: a fixed handful of the clan's own, picked by the seed. */
export function outpostGear(state: GameState, o: Outpost): Upgrade[] {
  const own = UPGRADES.filter((u) => u.vendor === o.clan && !u.retired);
  const rng = rngFor(state.seed, "outpost-stock", o.id);
  const deck = [...own];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [deck[i], deck[j]] = [deck[j] as Upgrade, deck[i] as Upgrade];
  }
  return deck.slice(0, OUTPOST_STOCK).sort((a, b) => a.price - b.price);
}

export function outpostGearPrice(state: GameState, o: Outpost, u: Upgrade): number {
  return Math.round((upgradePriceFor(state, u.vendor, u.price) * OUTPOST_GEAR_MARKUP) / 100) * 100;
}

/** Why this fitting can't be bought here now (empty if it can). */
export function outpostGearBlockers(state: GameState, world: World, upgradeId: string): string[] {
  const o = currentOutpost(state, world);
  if (!o) return ["There's no outpost here."];
  const u = outpostGear(state, o).find((x) => x.id === upgradeId);
  if (!u) return ["Not in stock here."];
  const status = yardStatus(state, upgradeId);
  if (status === "equipped") return ["Already fitted."];
  if (status === "incompatible") return ["This hull can't take it."];
  if (status === "locked") return ["Not yet: it needs research, an earlier fitting, or better standing."];
  const price = outpostGearPrice(state, o, u);
  if (state.credits < price) return [`Costs ${price.toLocaleString()} cr.`];
  return [];
}

/** Buy and fit on the spot: the outpost's shop does the work while the ship waits. */
export function buyOutpostGear(state: GameState, world: World, upgradeId: string): Result {
  const blockers = outpostGearBlockers(state, world, upgradeId);
  if (blockers.length > 0) return fail(blockers[0]!);
  const o = currentOutpost(state, world)!;
  const u = outpostGear(state, o).find((x) => x.id === upgradeId)!;
  const price = outpostGearPrice(state, o, u);
  state.credits -= price;
  advanceTime(state, OUTPOST_INSTALL_DAYS * DAY);
  state.ship.upgrades.push(u.id);
  if (u.id === "probeBay") state.ship.probes = (state.ship.probes ?? 0) + 1;
  changeRep(state, o.clan, Math.min(5, u.price / 10_000), `Bought the ${u.name} at ${o.name}`);
  log(state, "trade", `${o.name}'s shop fitted the ${u.name} for ${price.toLocaleString()} cr.`);
  return ok(undefined);
}

/** A trading post buys cargo, a little under the Intrepid's price. */
export function tradingPostHere(state: GameState, world: World): boolean {
  return currentOutpost(state, world)?.clan === "exchange";
}

export function sellAtOutpost(state: GameState, world: World, id: CommodityId, tonnes?: number): Result<number> {
  const o = currentOutpost(state, world);
  if (!o || o.clan !== "exchange") return fail("Only a trading post buys cargo out here.");
  if (clanRefuses(state, o.clan)) return fail("The Exchange won't trade with you.");
  if (!(state.ship.cargo[id] ?? 0)) return fail(`No ${COMMODITIES[id].name.toLowerCase()} aboard.`);
  return sellCargo(state, id, tonnes, TRADING_POST_RATE);
}
