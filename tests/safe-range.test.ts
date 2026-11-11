/** AW-237: Safe range won't let the rover drive or work past what gets it home. */
import { describe, expect, it } from "vitest";
import {
  deployRover,
  drill,
  energyHomeFrom,
  flyTo,
  homeReserve,
  jobBlocker,
  knowledge,
  land,
  landingBlockers,
  moveRoverTo,
  newGame,
  safeRangeOn,
  setSafeRange,
  shipTile,
  strandingBlocker,
  World,
  type GameState,
} from "../src/sim";
import { canEnter, findPath } from "../src/sim/pathfinding";
import { hexDistance, neighbors } from "../src/sim/hex";

const SEED = 42;
const world = new World(SEED);

/** Landed with the rover out, on a world with a shallow seam several hexes from the ship. */
function landed(): { s: GameState; key: string; seam: { x: number; y: number } } {
  for (const sys of world.galaxy.systems.filter((x) => !x.home)) {
    const detail = world.system(sys.id);
    for (const body of detail.bodies.filter((b) => b.regions > 0 && (b.kind === "barren" || b.kind === "desert" || b.kind === "terrestrial"))) {
      const s = newGame({ seed: SEED });
      s.location = { kind: "space", systemId: sys.id, pos: { x: detail.edgeAU, y: 0 }, orbiting: null };
      s.ship.fuel = 60;
      if (!flyTo(s, world, { bodyId: body.id }).ok) continue;
      const surface = world.surface(body.id);
      for (let r = 0; r < Math.min(body.regions, 12); r++) {
        if (landingBlockers(s, world, r).length > 0) continue;
        const home = surface.landing(r);
        const d = surface
          .deposits(r)
          .find((x) => x.depthM <= 200 && !x.hidden && hexDistance(x, home) >= 5 && hexDistance(x, home) <= 12 && canEnter(surface, x.x, x.y, { canClimb: false }) && findPath(surface, home, x, { canClimb: false }));
        if (!d || !land(s, world, r).ok || !deployRover(s, world).ok) break;
        const know = knowledge(s, body.id, d.region);
        know.discovered.push(d.id);
        know.prospected.push(d.id);
        return { s, key: d.key, seam: d };
      }
    }
  }
  throw new Error("no landing with a seam in reach");
}

const roverOf = (s: GameState) => (s.location as Extract<GameState["location"], { kind: "surface" }>).rover!;

describe("Safe range (AW-237)", () => {
  it("is on unless turned off", () => {
    const s = newGame({ seed: SEED });
    expect(safeRangeOn(s)).toBe(true);
    setSafeRange(s, false);
    expect(safeRangeOn(s)).toBe(false);
  });

  it("won't drive somewhere the rover can't get home from; with it off, the rover goes", () => {
    const { s, seam } = landed();
    const rover = roverOf(s);
    const go = energyHomeFrom(s, world, seam)!; // the way out costs about what the way back does
    rover.energy = go * 1.4; // enough to get there, not enough to get back
    const why = strandingBlocker(s, world, seam.x, seam.y);
    expect(why).toMatch(/Safe range: the rover couldn't get back to the ship/);
    const refused = moveRoverTo(s, world, seam.x, seam.y);
    expect(refused.ok).toBe(false);
    expect({ x: rover.x, y: rover.y }).toEqual(shipTile(s, world));
    setSafeRange(s, false);
    const went = moveRoverTo(s, world, seam.x, seam.y);
    expect(went.ok && went.value.steps).toBeGreaterThan(0);
  });

  it("with energy for the round trip, the drive goes ahead", () => {
    const { s, seam } = landed();
    roverOf(s).energy = energyHomeFrom(s, world, seam)! * 2.5;
    expect(strandingBlocker(s, world, seam.x, seam.y)).toBeNull();
    expect(moveRoverTo(s, world, seam.x, seam.y).ok).toBe(true);
  });

  it("a rover already short of home may still limp homeward, never further out", () => {
    const { s, seam } = landed();
    const rover = roverOf(s);
    rover.x = seam.x;
    rover.y = seam.y;
    rover.energy = energyHomeFrom(s, world, rover)! * 0.4;
    const home = shipTile(s, world);
    const way = findPath(world.surface((s.location as { bodyId: string }).bodyId), rover, home, { canClimb: false })!;
    const step = way[0]!;
    expect(strandingBlocker(s, world, step.x, step.y)).toBeNull();
    // A neighbor that puts it further from home is refused.
    const surface = world.surface((s.location as { bodyId: string }).bodyId);
    const need = energyHomeFrom(s, world, rover)!;
    const away = neighbors(rover.x, rover.y).find((n) => canEnter(surface, n.x, n.y, { canClimb: false }) && (energyHomeFrom(s, world, n) ?? 0) > need)!;
    expect(away).toBeDefined();
    expect(strandingBlocker(s, world, away.x, away.y)).toMatch(/Safe range/);
  });

  it("jobs keep the energy for the trip home, and none is needed at the ship", () => {
    const { s, seam } = landed();
    const rover = roverOf(s);
    expect(homeReserve(s, world)).toBe(0);
    expect(jobBlocker(s, world, 10, "sampling")).toBeNull();
    rover.x = seam.x;
    rover.y = seam.y;
    const reserve = homeReserve(s, world);
    expect(reserve).toBeGreaterThan(0);
    rover.energy = reserve + 5;
    expect(jobBlocker(s, world, 4, "sampling")).toBeNull();
    expect(jobBlocker(s, world, 8, "sampling")).toMatch(/Safe range: sampling would leave too little/);
    setSafeRange(s, false);
    expect(jobBlocker(s, world, 8, "sampling")).toBeNull();
  });

  it("the drill stops short of the reserve instead of running the cells flat", () => {
    for (let salt = 0; salt < 20; salt++) {
      const { s, key, seam } = landed();
      s.rngState = (s.rngState + salt * 7919) >>> 0;
      const rover = roverOf(s);
      rover.x = seam.x;
      rover.y = seam.y;
      const reserve = homeReserve(s, world);
      rover.energy = reserve + 30;
      const r = drill(s, world, key);
      if (!r.ok) throw new Error(r.reason);
      if (r.value.incident) continue; // a breakdown can cost energy on top; try another roll
      expect(rover.energy).toBeGreaterThanOrEqual(reserve - 1e-6);
      expect(r.value.hours).toBeGreaterThan(0);
      return;
    }
    throw new Error("every roll had an incident");
  });
});
