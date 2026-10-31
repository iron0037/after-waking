/**
 * The boat (AW-17): launched from a ship standing at the water's edge. It sails liquid hexes,
 * dredges seabed deposits, samples sea life, and can ferry the rover to put it ashore elsewhere.
 */
import { SEAS } from "../data/seas";
import { canEnter } from "./pathfinding";
import { revealAround, roverChargePerHour, roverMobility, shipTile, visitRegion } from "./actions";
import { hexDistance, neighbors } from "./hex";
import { effectiveStats } from "./perks";
import { fail, ok, type Result } from "./result";
import { advanceTime, log, type GameState, type RoverState } from "./state";
import { Terrain } from "./surface";
import { HOUR, type Vec2 } from "./units";
import { hasBoat, siteOnWater, vehicleOf } from "./vehicles";
import type { World } from "./world";

/** Getting the rover on or off the boat. */
export const BOAT_TRANSFER_MINUTES = 20;
/** Lowering the boat from the cargo bay into the water. */
export const BOAT_LAUNCH_MINUTES = 20;

/** The water hex beside the ship where the boat launches and ties up, or null if the ship isn't on a shore. */
export function boatDock(state: GameState, world: World): Vec2 | null {
  const loc = state.location;
  if (loc.kind !== "surface") return null;
  const surface = world.surface(loc.bodyId);
  const home = shipTile(state, world);
  return neighbors(home.x, home.y).find((n) => surface.terrainAt(n.x, n.y) === Terrain.liquid) ?? null;
}

/**
 * Where the vehicle being driven heads to go home: the boat to the water beside the ship, the
 * rover to the moored boat's shore if the boat is waiting, otherwise the ship.
 */
export function vehicleHome(state: GameState, world: World): Vec2 {
  const loc = state.location;
  if (loc.kind !== "surface") return { x: 0, y: 0 };
  if (loc.rover && vehicleOf(loc.rover) === "boat") return boatDock(state, world) ?? shipTile(state, world);
  if (loc.parkedBoat) return { x: loc.parkedBoat.x, y: loc.parkedBoat.y };
  return shipTile(state, world);
}

/** Why the crew can't auto-work a deposit with the vehicles as they are right now (null if they can). The hold and depth checks stay with the caller. */
export function autoWorkVehicleBlocker(state: GameState, world: World, deposit: Vec2): string | null {
  const loc = state.location;
  if (loc.kind !== "surface") return "Land first.";
  const wet = siteOnWater(world, loc.bodyId, deposit);
  if (wet && !hasBoat(state)) return "That seam is under the sea. The Midshipmen fit survey boats.";
  if (wet && !boatDock(state, world)) return "The ship needs to stand at the water's edge for the boat to work that seam. Hop it to a shore.";
  if (loc.rover && vehicleOf(loc.rover) !== (wet ? "boat" : "rover")) {
    return wet ? "Stow the rover first: this seam needs the boat." : "Bring the boat in first: this deposit needs the rover.";
  }
  if (loc.parkedBoat) return "The boat is moored offshore: get the rover back aboard and sail home first.";
  return null;
}

/** Why the boat can't launch right now (empty if it can). */
export function launchBoatBlockers(state: GameState, world: World): string[] {
  const loc = state.location;
  if (loc.kind !== "surface") return ["Land first."];
  if (!hasBoat(state)) return ["No boat aboard. The Midshipmen fit survey boats."];
  if (loc.rover) return [vehicleOf(loc.rover) === "boat" ? "The boat is already out." : "Stow the rover first (or take it along from the bay)."];
  if (!boatDock(state, world)) return ["The ship needs to stand at the water's edge to launch the boat. Hop it to a shore."];
  // Exotic seas (AW-189): methane and acid need a kitted boat.
  const sea = world.body(loc.bodyId).body.sea;
  const needs = sea ? SEAS[sea].boatNeeds : null;
  if (needs && !effectiveStats(state)[needs.flag]) return [`${needs.why} Check the Shipyard.`];
  return [];
}

/** Charge the boat (and the rover, if it's coming along) and lower it into the water beside the ship. */
export function launchBoat(state: GameState, world: World, withRover = false): Result<{ chargedHours: number }> {
  const blockers = launchBoatBlockers(state, world);
  if (blockers.length > 0) return fail(blockers[0] as string);
  const loc = state.location as Extract<GameState["location"], { kind: "surface" }>;
  const stats = effectiveStats(state);
  const dock = boatDock(state, world) as Vec2;
  const boatStored = Math.min(stats.boatEnergy, state.ship.boatEnergy ?? stats.boatEnergy);
  const roverStored = Math.min(stats.roverEnergy, state.ship.roverEnergy ?? stats.roverEnergy);
  // Both sets of cells charge from the same reactor, one after the other.
  const chargedHours =
    ((stats.boatEnergy - boatStored) + (withRover ? stats.roverEnergy - roverStored : 0)) / roverChargePerHour(state);
  advanceTime(state, BOAT_LAUNCH_MINUTES + chargedHours * HOUR);
  state.ship.boatEnergy = stats.boatEnergy;
  loc.rover = { x: dock.x, y: dock.y, energy: stats.boatEnergy, cargo: {}, vehicle: "boat" };
  if (withRover) {
    state.ship.roverEnergy = stats.roverEnergy;
    loc.roverAboard = { x: dock.x, y: dock.y, energy: stats.roverEnergy, cargo: {} };
  }
  revealAround(state, world);
  log(state, "travel", withRover ? "Launched the boat with the rover lashed to its deck." : "Launched the boat.");
  return ok({ chargedHours });
}

/** Run the boat up to a shore hex beside it and drive the rover off. The boat waits, moored. */
export function putRoverAshore(state: GameState, world: World, x: number, y: number): Result {
  const loc = state.location;
  if (loc.kind !== "surface" || !loc.rover || vehicleOf(loc.rover) !== "boat") return fail("Take the boat out first.");
  if (!loc.roverAboard) return fail("The rover isn't aboard the boat.");
  const boat = loc.rover;
  if (hexDistance(boat, { x, y }) > 1) return fail("Pick a shore hex right next to the boat.");
  const surface = world.surface(loc.bodyId);
  if (!canEnter(surface, x, y, roverMobility(state))) return fail("The rover can't drive off there.");
  advanceTime(state, BOAT_TRANSFER_MINUTES);
  const rover: RoverState = { ...loc.roverAboard, x, y };
  loc.parkedBoat = boat;
  loc.roverAboard = undefined;
  loc.rover = rover;
  visitRegion(state, world, loc.bodyId, x, y);
  revealAround(state, world);
  log(state, "travel", "Put the rover ashore. The boat is moored offshore, waiting.");
  return ok(undefined);
}

/** Drive the rover back aboard the moored boat. */
export function boardBoat(state: GameState, world: World): Result {
  const loc = state.location;
  if (loc.kind !== "surface" || !loc.rover || vehicleOf(loc.rover) !== "rover") return fail("The rover isn't out.");
  const boat = loc.parkedBoat;
  if (!boat) return fail("There's no boat waiting.");
  if (hexDistance(loc.rover, boat) > 1) return fail("Drive the rover to the shore beside the boat first.");
  advanceTime(state, BOAT_TRANSFER_MINUTES);
  loc.roverAboard = { ...loc.rover, x: boat.x, y: boat.y };
  loc.rover = boat;
  loc.parkedBoat = undefined;
  revealAround(state, world);
  log(state, "travel", "The rover is back aboard the boat.");
  return ok(undefined);
}
