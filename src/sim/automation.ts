/**
 * Crew-run routines that string player verbs together, so the player decides *what* and the
 * crew handles the repetition. (People doing the work, not an AI: it fits the lore.)
 *
 * Every step goes through the same actions the player uses, so time, fuel, energy, incidents
 * and the journal all behave exactly as if the player had clicked each step.
 */
import { COMMODITIES } from "../data/commodities";
import {
  deployRover,
  DRILL_ENERGY_PER_HOUR,
  drill,
  drillRate,
  moveRoverTo,
  prospect,
  remainingTonnes,
  roverMobility,
  routeEnergy,
  shipTile,
  stowRover,
  surfaceDeposit,
} from "./actions";
import type { SiteKey } from "./bodysurface";
import { boatDock, launchBoat } from "./boat";
import { boatMobility, siteOnWater, vehicleCargoT, vehicleEnergyMax, vehicleOf } from "./vehicles";
import { findPath, type PathStep } from "./pathfinding";
import { hexDistance } from "./hex";
import { fail, ok, type Result } from "./result";
import { effectiveStats } from "./perks";
import { cargoTonnes } from "./ship";
import type { GameState, RoverState } from "./state";
import { DAY } from "./units";
import type { World } from "./world";

export type WorkStop =
  | "deposit depleted"
  | "hold full"
  | "unreachable"
  | "low energy"
  | "time limit"
  | "target reached";

export interface WorkReport {
  /** Rover round trips completed (drill, haul, unload). */
  loads: number;
  /** Tonnes delivered into the ship's hold. */
  tonnes: number;
  minutes: number;
  stop: WorkStop;
  /** Human-readable explanation of why the crew stopped. */
  detail: string;
  /** Storms, quakes and breakdowns the crew handled along the way (each cost time). */
  incidents: string[];
}

const MAX_LOADS = 60;
/** Energy kept in reserve on top of the drive home. */
const ENERGY_MARGIN = 6;

function energyOf(state: GameState, path: PathStep[] | null): number {
  return routeEnergy(state, path);
}

function rover(state: GameState): RoverState | null {
  return state.location.kind === "surface" ? state.location.rover : null;
}

/**
 * Work one deposit until it's depleted, the hold is full, or something needs the captain:
 * deploy (charging as needed), drive out, prospect, drill as long as energy allows a safe trip
 * home, haul back, unload, repeat. Storms, quakes and breakdowns cost time and are reported,
 * but only stop the run if they leave the rover unable to get home safely.
 */
export function workDeposit(state: GameState, world: World, key: SiteKey, maxTonnes = Infinity): Result<WorkReport> {
  const loc = state.location;
  if (loc.kind !== "surface") return fail("Not on a surface.");
  const surface = world.surface(loc.bodyId);
  const found = surfaceDeposit(state, world, key);
  if (!found) return fail("Unknown deposit.");
  const { deposit, know } = found;
  const stats = effectiveStats(state);
  // Seabed deposits are worked from the boat (AW-17), docking at the water beside the ship.
  const wet = siteOnWater(world, loc.bodyId, deposit);
  const vehicle = wet ? "boat" : "rover";
  const mobility = wet ? boatMobility() : roverMobility(state);
  const dock = () => (wet ? boatDock(state, world) : shipTile(state, world));
  if (wet && !dock()) return fail("The ship needs to stand at the water's edge for the boat to work that seam. Hop it to a shore.");
  const out0 = rover(state);
  if (out0 && vehicleOf(out0) !== vehicle) return fail(wet ? "Stow the rover first: this seam needs the boat." : "Bring the boat in first: this deposit needs the rover.");
  if (loc.parkedBoat) return fail("The boat is moored offshore: get the rover back aboard and sail home first.");
  if (deposit.depthM > stats.drillMaxDepthM) {
    return fail(`The seam is ${deposit.depthM} m down; the drill reaches ${stats.drillMaxDepthM} m.`);
  }
  if (remainingTonnes(know, deposit) <= 0.05) return fail("This deposit is worked out.");

  const startTime = state.time;
  const startHold = cargoTonnes(state.ship.cargo);
  const holdRoom = () => stats.cargoCapacityT - cargoTonnes(state.ship.cargo);
  const name = COMMODITIES[deposit.commodity].name.toLowerCase();
  let loads = 0;
  const incidents: string[] = [];

  const finish = (stop: WorkStop, detail: string): Result<WorkReport> =>
    ok({
      loads,
      tonnes: Math.round((cargoTonnes(state.ship.cargo) - startHold) * 10) / 10,
      minutes: state.time - startTime,
      stop,
      detail,
      incidents,
    });

  /** Drive home and unload; false (with the rover left out) if it can't make it. */
  const haulHome = (): boolean => {
    const r = rover(state);
    if (!r) return true;
    const home = dock() as { x: number; y: number };
    if (hexDistance(r, shipTile(state, world)) > 1) {
      const moved = moveRoverTo(state, world, home.x, home.y);
      if (!moved.ok || moved.value.stopped) return false;
    }
    return stowRover(state, world).ok;
  };

  for (let guard = 0; guard < MAX_LOADS; guard++) {
    if (state.time - startTime > 120 * DAY) return finish("time limit", "The crew has been at it for four months; time for new orders.");
    if (remainingTonnes(know, deposit) <= 0.05) {
      if (!haulHome()) return finish("low energy", "The rover can't get home on its remaining energy. Recall it.");
      return finish("deposit depleted", `The ${name} deposit is worked out.`);
    }
    // The captain asked for this much and no more.
    if (cargoTonnes(state.ship.cargo) - startHold >= maxTonnes - 0.5) {
      if (!haulHome()) return finish("low energy", "The rover can't get home on its remaining energy. Recall it.");
      return finish("target reached", `Hauled the ${Math.round(maxTonnes)} t you asked for.`);
    }
    if (holdRoom() <= 0.5) {
      if (!haulHome()) return finish("low energy", "The rover can't get home on its remaining energy. Recall it.");
      return finish("hold full", "The ship's hold is full.");
    }

    // Out of the hangar, cells charged.
    if (!rover(state)) {
      const deployed = wet ? launchBoat(state, world) : deployRover(state, world);
      if (!deployed.ok) return fail(deployed.reason);
    }
    const r = rover(state) as RoverState;

    // Drive to the deposit if we're not already beside it.
    if (hexDistance(r, deposit) > 1) {
      const out = findPath(surface, r, deposit, mobility);
      const back = findPath(surface, deposit, dock() as { x: number; y: number }, mobility);
      if (!out || !back) return finish("unreachable", `The ${vehicle} has no route to that deposit and back.`);
      if (energyOf(state, out) + energyOf(state, back) + ENERGY_MARGIN >= vehicleEnergyMax(state, vehicle)) {
        return finish("unreachable", "Too far for one charge there and back. Move the ship closer, or upgrade the rover's cells.");
      }
      const moved = moveRoverTo(state, world, deposit.x, deposit.y);
      if (!moved.ok || moved.value.stopped) return finish("low energy", "The rover ran short of energy on the way out.");
    }

    if (!know.prospected.includes(deposit.id)) {
      const sampled = prospect(state, world, key);
      if (!sampled.ok) return fail(sampled.reason);
    }

    // Drill as long as the cells can still bring the rover home.
    const homePath = findPath(surface, rover(state) as RoverState, dock() as { x: number; y: number }, mobility);
    const budget = ((rover(state) as RoverState).energy - energyOf(state, homePath) - ENERGY_MARGIN) / DRILL_ENERGY_PER_HOUR;
    const bedRoom = vehicleCargoT(state, vehicle) - cargoTonnes((rover(state) as RoverState).cargo);
    const loadCap = Math.min(bedRoom, holdRoom(), maxTonnes - (cargoTonnes(state.ship.cargo) - startHold) - cargoTonnes((rover(state) as RoverState).cargo));
    if (budget > 0.5 && loadCap > 0.5) {
      const rate = drillRate(state, deposit);
      const drilled = drill(state, world, key, Math.min(budget, loadCap / rate));
      if (!drilled.ok) return fail(drilled.reason);
      // The crew deals with storms and jams themselves; they only cost time (and the haul home
      // below still checks energy). Stopping for each would bring the tedium back.
      if (drilled.value.incident) incidents.push(drilled.value.incident);
    }

    if (!haulHome()) return finish("low energy", "The rover can't get home on its remaining energy. Recall it.");
    loads++;
  }
  return finish("time limit", "The crew stopped after many loads; check in with them.");
}
