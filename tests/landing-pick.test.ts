/** AW-270: the region pickers never suggest a region the ship can't set down in. */
import { describe, expect, it } from "vitest";
import { PERKS_BY_ID } from "../src/data/perks";
import { canEnter, canSetDownIn, hunchRegion, land, newGame, setDownSpot, suggestedRegion, World, xpForLevel } from "../src/sim";

describe("region suggestions on ocean worlds (AW-270)", () => {
  it("the suggested region and the captain's hunch are always somewhere to land", () => {
    let oceans = 0;
    for (const seed of [42, 7, 2026]) {
      const world = new World(seed);
      const s = newGame({ seed });
      const def = PERKS_BY_ID.get("hunch")!;
      expect(def.station).toBe("captain");
      s.captain.xp = Math.max(s.captain.xp ?? 0, xpForLevel(10));
      s.captain.perks = [...(s.captain.perks ?? []), "hunch"];
      for (const sys of world.galaxy.systems) {
        for (const body of world.system(sys.id).bodies) {
          if (body.kind !== "ocean" || body.regions === 0) continue;
          const dry = Array.from({ length: body.regions }, (_, r) => r).filter((r) => canSetDownIn(s, body, r));
          if (dry.length === 0) continue;
          oceans++;
          expect(canSetDownIn(s, body, suggestedRegion(s, body, 1, 250))).toBe(true);
          const hunch = hunchRegion(s, body);
          expect(hunch === null || canSetDownIn(s, body, hunch)).toBe(true);
        }
      }
    }
    expect(oceans).toBeGreaterThan(0);
  });
});

describe("setting down on rough ground (AW-271)", () => {
  it("a region whose landing point is at sea still takes a landing on its rough ground, as a hop would", () => {
    let checked = 0;
    for (const seed of [42, 7, 2026]) {
      const world = new World(seed);
      for (const sys of world.galaxy.systems) {
        for (const body of world.system(sys.id).bodies) {
          if (body.kind !== "ocean" || body.regions === 0) continue;
          const surface = world.surface(body.id);
          for (let r = 0; r < body.regions && checked < 3; r++) {
            const p = surface.landing(r);
            if (canEnter(surface, p.x, p.y, false)) continue; // the usual case
            const spot = setDownSpot(world, body.id, r);
            if (!spot) continue; // truly no ground
            const s = newGame({ seed });
            s.ship.fuel = 60;
            s.location = { kind: "space", systemId: sys.id, pos: { x: 0, y: 0 }, orbiting: body.id };
            if (!s.scannedBodies.includes(body.id)) s.scannedBodies.push(body.id);
            const res = land(s, world, r);
            if (!res.ok) continue; // something else in the way (ratings, a den): not this test's business
            const ship = (s.location as { ship?: { x: number; y: number } }).ship!;
            expect(canEnter(surface, ship.x, ship.y, false)).toBe(true);
            expect(surface.regionAt(ship.x, ship.y)).toBe(r);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
