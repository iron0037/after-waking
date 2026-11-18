/** AW-269: Recharge drops samples off, and no sample is picked up that the ship's racks couldn't take. */
import { describe, expect, it } from "vitest";
import {
  land,
  newGame,
  rackRoom,
  rechargeRover,
  roverSpecimenSlots,
  shipSpecimenSlots,
  specimenCount,
  specimenRoomBlocker,
  World,
  type GameState,
  type RoverState,
} from "../src/sim";

const world = new World(42);
const sys = world.galaxy.systems.find((x) => x.home && world.system(x.id).bodies.some((b) => b.easy))!;
const body = world.system(sys.id).bodies.find((b) => b.easy)!;

/** Landed on the Meadow, the rover out beside the ship. */
function landed(): { s: GameState; rover: RoverState } {
  const s = newGame({ seed: 42 });
  s.location = { kind: "space", systemId: sys.id, pos: { x: 0, y: 0 }, orbiting: body.id };
  if (!s.scannedBodies.includes(body.id)) s.scannedBodies.push(body.id);
  const r = land(s, world, 0);
  if (!r.ok) throw new Error(r.reason);
  const loc = s.location as unknown as Extract<GameState["location"], { kind: "surface" }>;
  const rover: RoverState = { x: loc.ship!.x, y: loc.ship!.y, energy: 100, cargo: {} };
  loc.rover = rover;
  return { s, rover };
}

describe("dropping samples off with Recharge (AW-269)", () => {
  it("hands the samples to the racks, even with the cells already full", () => {
    const { s, rover } = landed();
    rover.specimens = { [`${body.id}|bellwort`]: 2 };
    rover.energy = 1_000; // full, whatever the cells hold
    const r = rechargeRover(s, world);
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.samples).toBe(2);
    expect(specimenCount(s.ship.specimens)).toBe(2);
    expect(specimenCount(rover.specimens)).toBe(0);
    // Nothing aboard and full cells: nothing to do.
    expect(rechargeRover(s, world).ok).toBe(false);
  });
});

describe("room in the racks (AW-269)", () => {
  it("counts what's already in the sample cases against the ship's racks", () => {
    const { s, rover } = landed();
    const racks = shipSpecimenSlots(s);
    s.ship.specimens = { [`${body.id}|silver fern`]: racks - 2 };
    rover.specimens = { [`${body.id}|bellwort`]: 1 };
    expect(rackRoom(s)).toBe(1);
    expect(specimenRoomBlocker(s, rover, 1)).toBeNull();
    expect(specimenRoomBlocker(s, rover, 2)).toMatch(/room for only 1 more/);
    rover.specimens = { [`${body.id}|bellwort`]: 2 };
    expect(specimenRoomBlocker(s, rover, 1)).toMatch(/racks are full/);
  });

  it("still stops at the rover's own cases", () => {
    const { s, rover } = landed();
    rover.specimens = { [`${body.id}|bellwort`]: roverSpecimenSlots(s) };
    expect(specimenRoomBlocker(s, rover, 1)).toMatch(/sample cases are full/);
  });
});
