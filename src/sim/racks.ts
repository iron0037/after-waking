/**
 * Room for a living sample (AW-269). The rover's sample cases are small, and everything in them ends
 * up in the ship's containment racks. So the crew won't take a sample the racks couldn't hold once it's
 * home: no sample is picked up only to be released at the ship.
 */
import { roverSpecimenSlots, shipSpecimenSlots } from "./perks";
import { specimenCount } from "./ship";
import type { GameState, RoverState } from "./state";

/** Specimen slots taken on every vehicle that's out (the one driven, the rover on deck, the moored boat). */
function outInTheField(state: GameState): number {
  const loc = state.location;
  if (loc.kind !== "surface") return 0;
  return [loc.rover, loc.roverAboard, loc.parkedBoat].filter((v): v is RoverState => !!v).reduce((n, v) => n + specimenCount(v.specimens), 0);
}

/** Free slots left in the ship's racks, counting what's already out in the field. */
export function rackRoom(state: GameState): number {
  return shipSpecimenSlots(state) - specimenCount(state.ship.specimens) - outInTheField(state);
}

/** Why the vehicle can't take a sample of this size (slots), or null if it can. */
export function specimenRoomBlocker(state: GameState, vehicle: RoverState, size = 1): string | null {
  const noun = vehicle.vehicle === "boat" ? "boat" : "rover";
  if (specimenCount(vehicle.specimens) + size > roverSpecimenSlots(state)) {
    return `The ${noun}'s sample cases are full${size > 1 ? ` (it needs ${size} slots)` : ""}. Drop them off at the ship.`;
  }
  const room = rackRoom(state);
  if (size > room) {
    return room <= 0
      ? "The ship's containment racks are full, counting what's already in the sample cases."
      : `The ship's racks have room for only ${room} more sample${room === 1 ? "" : "s"}, counting what's in the sample cases${size > 1 ? `; this one needs ${size}` : ""}.`;
  }
  return null;
}
