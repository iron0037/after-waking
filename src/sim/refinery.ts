/**
 * The portable refinery (AW-18): turns ore in the hold into concentrate. CONC_RATIO tonnes of ore
 * make one tonne of concentrate, worth CONC_PREMIUM more than the ore it came from. It frees
 * hold space and lightens the ship (cheaper folds), at the cost of crew hours.
 */
import { CONC_IDS, CONC_RATIO, CONC_SOURCE, COMMODITIES, type CommodityId, type ConcId, type OreId } from "../data/commodities";
import { awardXp } from "./crew";
import { effectiveStats } from "./perks";
import { fail, ok, type Result } from "./result";
import { addCargo, removeCargo } from "./ship";
import { advanceTime, log, type GameState } from "./state";
import { formatDuration } from "./time";
import { HOUR } from "./units";

/** Refining is crew work, two shifts a day, like everything hands-on. */
const REFINE_SHIFT_FACTOR = 1.5;

const CONC_OF = new Map<OreId, ConcId>(CONC_IDS.map((c) => [CONC_SOURCE[c], c]));

/** The concentrate an ore refines into, or null (water ice and plicite go to market raw). */
export function concentrateOf(ore: CommodityId): ConcId | null {
  return CONC_OF.get(ore as OreId) ?? null;
}

export function isConcentrate(id: CommodityId): id is ConcId {
  return (CONC_IDS as readonly string[]).includes(id);
}

/** Hours (on the clock, shifts included) to refine `tonnesOre` of ore. */
export function refineHours(state: GameState, tonnesOre: number): number {
  const rate = effectiveStats(state).refineryRateTph;
  return rate > 0 ? (tonnesOre / rate) * REFINE_SHIFT_FACTOR : Infinity;
}

/** Why the refinery can't run on this ore right now (empty if it can). */
export function refineBlockers(state: GameState, ore: CommodityId): string[] {
  const out: string[] = [];
  if (effectiveStats(state).refineryRateTph <= 0) out.push("No refinery aboard. The Diggers fit portable refineries.");
  if (state.location.kind === "intrepid") out.push("The refinery runs off the ship's reactor away from the Intrepid; here, just sell the ore.");
  if (!concentrateOf(ore)) out.push(`${COMMODITIES[ore].name} goes to market as it is.`);
  if ((state.ship.cargo[ore] ?? 0) < 0.1) out.push(`No ${COMMODITIES[ore].name.toLowerCase()} in the hold.`);
  return out;
}

/** Refine up to `tonnesOre` (default: all of it) of an ore in the hold into concentrate. Takes crew hours. */
export function refineOre(state: GameState, ore: CommodityId, tonnesOre?: number): Result<{ ore: number; concentrate: number; hours: number }> {
  const blockers = refineBlockers(state, ore);
  if (blockers.length > 0) return fail(blockers[0] as string);
  const conc = concentrateOf(ore) as ConcId;
  const have = state.ship.cargo[ore] ?? 0;
  const take = Math.round(Math.min(have, tonnesOre ?? have) * 10) / 10;
  if (take < 0.1) return fail("Nothing to refine.");
  const made = Math.round((take / CONC_RATIO) * 100) / 100;
  const hours = refineHours(state, take);
  removeCargo(state.ship.cargo, ore, take);
  // The concentrate is lighter than the ore it replaces, so it always fits.
  addCargo(state.ship.cargo, conc, made, Infinity);
  advanceTime(state, hours * HOUR);
  awardXp(state, "engineering", Math.min(20, take / 10));
  log(state, "trade", `Refined ${take} t of ${COMMODITIES[ore].name.toLowerCase()} into ${made} t of concentrate in ${formatDuration(hours * HOUR)}.`);
  return ok({ ore: take, concentrate: made, hours });
}

/**
 * Ore-equivalent tonnes aboard for a delivery: the ore itself plus its concentrate at CONC_RATIO.
 * Delivery contracts take either.
 */
export function oreEquivalent(state: GameState, ore: CommodityId): number {
  const conc = concentrateOf(ore);
  return (state.ship.cargo[ore] ?? 0) + (conc ? (state.ship.cargo[conc] ?? 0) * CONC_RATIO : 0);
}

/** Take `tonnes` of ore-equivalent from the hold for a delivery: raw ore first, then concentrate. */
export function takeOreEquivalent(state: GameState, ore: CommodityId, tonnes: number): void {
  const raw = Math.min(tonnes, state.ship.cargo[ore] ?? 0);
  removeCargo(state.ship.cargo, ore, raw);
  const left = tonnes - raw;
  const conc = concentrateOf(ore);
  if (conc && left > 0.001) removeCargo(state.ship.cargo, conc, Math.min(state.ship.cargo[conc] ?? 0, Math.round((left / CONC_RATIO) * 100) / 100));
}
