/** AW-23 (3/4): the pirate's den's tower, and what the Freebooters think of you. */
import { describe, expect, it } from "vitest";
import {
  answerHail,
  DAY,
  DEFAULT_UNIVERSE,
  denClearanceChance,
  HELM_STATION_RAIDS,
  land,
  landingBlockers,
  lanePirateActivity,
  newGame,
  outposts,
  pirateActivity,
  reputation,
  tickReputation,
  universeSeed,
  World,
  type GameState,
} from "../src/sim";

const SEED = universeSeed(42, { ...DEFAULT_UNIVERSE, outposts: 7 });
const world = new World(SEED);
const den = outposts(world).find((o) => o.clan === "freebooters")!;

/** In orbit over the den's world, scanned, with fuel to land. */
function overDen(freebooters: number): GameState {
  const s = newGame({ seed: SEED });
  s.reputation = { freebooters };
  s.location = { kind: "space", systemId: den.systemId, pos: { x: 1, y: 0 }, orbiting: den.bodyId };
  s.scannedBodies.push(den.bodyId);
  s.visitedSystems.push(den.systemId);
  s.ship.fuel = 60;
  // Dens are out of the way: fit the ship for any world an outpost can stand on.
  s.ship.hull = "bulker";
  s.ship.upgrades.push("landingStruts", "pressureHull2", "pressureHull3", "cryoHull", "corrosionHull", "radShielding");
  return s;
}

describe("the pirate's den (AW-23)", () => {
  it("clearance follows Freebooter standing, certain at the top", () => {
    expect(denClearanceChance(overDen(-60))).toBe(0);
    expect(denClearanceChance(overDen(0))).toBe(0.5);
    expect(denClearanceChance(overDen(30))).toBe(0.8);
    expect(denClearanceChance(overDen(80))).toBe(1);
  });

  it("a trusted captain always lands", () => {
    const s = overDen(80);
    expect(landingBlockers(s, world, den.region)).toEqual([]);
    const r = land(s, world, den.region);
    if (!r.ok) throw new Error(r.reason);
    expect(s.location.kind).toBe("surface");
  });

  it("refused, a den ship comes for you, and the tower won't hear you again this visit", () => {
    const s = overDen(-60);
    const r = land(s, world, den.region);
    expect(r.ok).toBe(false);
    expect(s.location.kind).toBe("space");
    expect(s.encounter?.stage).toBe("hail");
    s.encounter = undefined;
    expect(landingBlockers(s, world, den.region).join()).toMatch(/won't clear you again/);
    // Other regions of the same world are fine.
    const other = den.region === 0 ? 1 : 0;
    expect(landingBlockers(s, world, other).join()).not.toMatch(/won't clear you/);
  });

  it("a fight with raiders costs Freebooter standing; paying them off doesn't", () => {
    const fought = overDen(-60);
    land(fought, world, den.region);
    const before = reputation(fought, "freebooters");
    fought.encounter!.turn = 2; // as if the battle had run
    answerHail(fought, "pay");
    expect(reputation(fought, "freebooters")).toBeCloseTo(before - 4, 1);
    const paid = overDen(-60);
    land(paid, world, den.region);
    const b2 = reputation(paid, "freebooters");
    answerHail(paid, "pay");
    expect(reputation(paid, "freebooters")).toBeCloseTo(b2, 1);
  });
});

describe("happy officers speak well of you (AW-23)", () => {
  it("each happy officer earns their clan about a point a month, a few at most", () => {
    const s = newGame({ seed: SEED });
    const officers = s.crew!.slice(0, 2);
    for (const m of officers) {
      m.clan = "lyceum";
      m.happiness = 90;
    }
    for (const m of s.crew!.slice(2)) m.happiness = 40;
    const before = reputation(s, "lyceum");
    tickReputation(s, 60 * DAY);
    // Two happy officers, two months: about 4 points (less the slow drift home).
    expect(reputation(s, "lyceum") - before).toBeGreaterThan(3);
    expect(reputation(s, "lyceum") - before).toBeLessThanOrEqual(4);
  });
});

describe("a Helm patrol station (AW-23)", () => {
  it("keeps the raiders down in its system", () => {
    const helm = outposts(world).find((o) => o.clan === "helm")!;
    expect(pirateActivity(world, helm.systemId)).toBeCloseTo(lanePirateActivity(world, helm.systemId) * HELM_STATION_RAIDS, 6);
  });
});
