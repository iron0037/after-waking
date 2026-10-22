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
  knowledge,
  moveRoverTo,
  prospect,
  remainingTonnes,
  shipTile,
  stowRover,
} from "./actions";
import { findPath, type PathStep } from "./pathfinding";
import { fail, ok, type Result } from "./result";
import { cargoTonnes, shipStats } from "./ship";
import type { GameState, RoverState } from "./state";
import { DAY } from "./units";
import type { World } from "./world";

export type WorkStop =
  | "deposit depleted"
  | "hold full"
  | "unreachable"
  | "low energy"
  | "time limit";

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

function energyOf(path: PathStep[] | null): number {
  return (path ?? []).reduce((sum, s) => sum + s.energy, 0);
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
export function workDeposit(state: GameState, world: World, depositId: number): Result<WorkReport> {
  const loc = state.location;
  if (loc.kind !== "surface") return fail("Not on a surface.");
  const map = world.region(loc.bodyId, loc.region);
  const know = knowledge(state, loc.bodyId, loc.region);
  const deposit = map.deposits.find((d) => d.id === depositId);
  if (!deposit || !know.discovered.includes(depositId)) return fail("Unknown deposit.");
  const stats = shipStats(state.ship);
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
    const home = shipTile(state, map);
    if (Math.max(Math.abs(r.x - home.x), Math.abs(r.y - home.y)) > 1) {
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
    if (holdRoom() <= 0.5) {
      if (!haulHome()) return finish("low energy", "The rover can't get home on its remaining energy. Recall it.");
      return finish("hold full", "The ship's hold is full.");
    }

    // Out of the hangar, cells charged.
    if (!rover(state)) {
      const deployed = deployRover(state, world);
      if (!deployed.ok) return fail(deployed.reason);
    }
    const r = rover(state) as RoverState;

    // Drive to the deposit if we're not already beside it.
    if (Math.max(Math.abs(r.x - deposit.x), Math.abs(r.y - deposit.y)) > 1) {
      const out = findPath(map, r, deposit, stats.roverCanClimb);
      const back = findPath(map, deposit, shipTile(state, map), stats.roverCanClimb);
      if (!out || !back) return finish("unreachable", "The rover has no route to that deposit and back.");
      if (energyOf(out) + energyOf(back) + ENERGY_MARGIN >= stats.roverEnergy) {
        return finish("unreachable", "Too far for one charge there and back. Move the ship closer, or upgrade the rover's cells.");
      }
      const moved = moveRoverTo(state, world, deposit.x, deposit.y);
      if (!moved.ok || moved.value.stopped) return finish("low energy", "The rover ran short of energy on the way out.");
    }

    if (!know.prospected.includes(depositId)) {
      const sampled = prospect(state, world, depositId);
      if (!sampled.ok) return fail(sampled.reason);
    }

    // Drill as long as the cells can still bring the rover home.
    const homePath = findPath(map, rover(state) as RoverState, shipTile(state, map), stats.roverCanClimb);
    const budget = ((rover(state) as RoverState).energy - energyOf(homePath) - ENERGY_MARGIN) / DRILL_ENERGY_PER_HOUR;
    const bedRoom = stats.roverCargoT - cargoTonnes((rover(state) as RoverState).cargo);
    const loadCap = Math.min(bedRoom, holdRoom());
    if (budget > 0.5 && loadCap > 0.5) {
      const rate = stats.drillRateTph * (0.4 + deposit.grade);
      const drilled = drill(state, world, depositId, Math.min(budget, loadCap / rate));
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
