/**
 * Surface vehicles (AW-17): the rover on land and the boat on water. Both use RoverState; the
 * one being driven sits in `location.rover`. Pure helpers only; the verbs live in actions.ts
 * and boat.ts.
 */
import type { World } from "./world";
import type { Mobility } from "./pathfinding";
import { effectiveStats } from "./perks";
import type { GameState, RoverState } from "./state";
import { Terrain } from "./surface";
import type { Vec2 } from "./units";

export type Vehicle = "rover" | "boat";

export function vehicleOf(v: RoverState): Vehicle {
  return v.vehicle ?? "rover";
}

/** The boat sails liquid hexes only. */
export function boatMobility(): Mobility {
  return { canClimb: false, water: true };
}

/** Is this hex open water (where only the boat can work)? */
export function siteOnWater(world: World, bodyId: string, p: Vec2): boolean {
  return world.surface(bodyId).terrainAt(p.x, p.y) === Terrain.liquid;
}

export function vehicleCargoT(state: GameState, v: Vehicle): number {
  const stats = effectiveStats(state);
  return v === "boat" ? stats.boatCargoT : stats.roverCargoT;
}

export function vehicleEnergyMax(state: GameState, v: Vehicle): number {
  const stats = effectiveStats(state);
  return v === "boat" ? stats.boatEnergy : stats.roverEnergy;
}

export function hasBoat(state: GameState): boolean {
  return effectiveStats(state).boatEnergy > 0;
}

/** What's out on the surface: the vehicle being driven, the boat moored offshore, the rover riding the boat. */
export function vehiclesOut(state: GameState): { rover: boolean; boat: boolean } {
  const loc = state.location;
  if (loc.kind !== "surface") return { rover: false, boat: false };
  const active = loc.rover ? vehicleOf(loc.rover) : null;
  return { rover: active === "rover" || !!loc.roverAboard, boat: active === "boat" || !!loc.parkedBoat };
}
