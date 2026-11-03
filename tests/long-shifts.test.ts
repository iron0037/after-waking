/** AW-213: the portable refinery leaves the yard; Long Shifts takes Field Refinery's place. */
import { describe, expect, it } from "vitest";
import {
  autoExplore,
  buyUpgrade,
  deployRover,
  deserialize,
  effectiveStats,
  flyTo,
  land,
  landingBlockers,
  moveRoverTo,
  newGame,
  refineBlockers,
  serialize,
  spareCellEnergy,
  World,
  yardUpgrades,
  type GameState,
} from "../src/sim";
import { canEnter } from "../src/sim/pathfinding";
import { neighbors } from "../src/sim/hex";

const SEED = 42;
const world = new World(SEED);

function landed(longShifts: boolean): GameState {
  for (const sys of world.galaxy.systems.filter((s) => !s.home)) {
    const detail = world.system(sys.id);
    for (const body of detail.bodies.filter((b) => b.regions > 0 && (b.kind === "barren" || b.kind === "desert" || b.kind === "terrestrial"))) {
      const s = newGame({ seed: SEED });
      if (longShifts) s.crew!.find((m) => m.station === "engineering")!.perks = ["drill-master", "jury-rig", "deep-bore", "rover-overhaul", "long-shifts"];
      s.location = { kind: "space", systemId: sys.id, pos: { x: detail.edgeAU, y: 0 }, orbiting: null };
      s.ship.fuel = 60;
      if (!flyTo(s, world, { bodyId: body.id }).ok) continue;
      const region = Array.from({ length: Math.min(body.regions, 20) }, (_, r) => r).find((r) => landingBlockers(s, world, r).length === 0);
      if (region === undefined || !land(s, world, region).ok || !deployRover(s, world).ok) continue;
      return s;
    }
  }
  throw new Error("nowhere to land");
}

describe("the portable refinery is retired (AW-213)", () => {
  it("the yard no longer lists or sells it", () => {
    const s = newGame({ seed: SEED });
    s.credits = 1_000_000;
    expect(yardUpgrades(s).some((u) => u.id === "refinery")).toBe(false);
    const r = buyUpgrade(s, "refinery");
    expect(r.ok).toBe(false);
    expect(s.ship.upgrades).not.toContain("refinery");
  });

  it("a ship that already carries one keeps it, and it still works", () => {
    const s = newGame({ seed: SEED });
    s.ship.upgrades.push("refinery");
    expect(yardUpgrades(s).some((u) => u.id === "refinery")).toBe(true);
    expect(effectiveStats(s).refineryRateTph).toBeGreaterThan(0);
    s.location = { kind: "space", systemId: world.galaxy.systems[0]!.id, pos: { x: 1, y: 0 }, orbiting: null };
    s.ship.cargo = { ironNickel: 10 };
    expect(refineBlockers(s, "ironNickel")).toEqual([]);
  });

  it("old saves move a Field Refinery point to Long Shifts", () => {
    const s = newGame({ seed: SEED });
    const eng = s.crew!.find((m) => m.station === "engineering")!;
    eng.perks = ["drill-master", "jury-rig", "deep-bore", "rover-overhaul", "field-refinery"];
    const back = deserialize(serialize(s));
    expect(back.crew!.find((m) => m.station === "engineering")!.perks).toEqual(["drill-master", "jury-rig", "deep-bore", "rover-overhaul", "long-shifts"]);
  });
});

describe("Long Shifts (AW-213)", () => {
  it("the rover rolls out with a spare pack, half a charge, plugged in once when the cells run dry", () => {
    const s = landed(true);
    const loc = s.location as Extract<GameState["location"], { kind: "surface" }>;
    const rover = loc.rover!;
    const full = effectiveStats(s).roverEnergy;
    expect(rover.spareCells).toBe(true);
    expect(spareCellEnergy(s, rover)).toBe(full * 0.5);
    const surface = world.surface(loc.bodyId);
    const next = neighbors(rover.x, rover.y).find((n) => canEnter(surface, n.x, n.y, { canClimb: false }))!;
    rover.energy = 0;
    const moved = moveRoverTo(s, world, next.x, next.y);
    expect(moved.ok && moved.value.stopped).toBe(null);
    expect(rover.spareCells).toBe(false);
    expect(rover.energy).toBeGreaterThan(full * 0.4);
    expect(spareCellEnergy(s, rover)).toBe(0);
  });

  it("without the perk, a flat rover stops", () => {
    const s = landed(false);
    const loc = s.location as Extract<GameState["location"], { kind: "surface" }>;
    const rover = loc.rover!;
    expect(rover.spareCells).toBeUndefined();
    const surface = world.surface(loc.bodyId);
    const next = neighbors(rover.x, rover.y).find((n) => canEnter(surface, n.x, n.y, { canClimb: false }))!;
    rover.energy = 0;
    const moved = moveRoverTo(s, world, next.x, next.y);
    expect(moved.ok && moved.value.stopped).toBeTruthy();
  });

  it("auto-explore needs fewer trips home to recharge", () => {
    const plain = autoExplore(landed(false), world);
    const shifts = autoExplore(landed(true), world);
    if (!plain.ok || !shifts.ok) throw new Error("auto-explore failed");
    expect(plain.value.recharges).toBeGreaterThan(0);
    expect(shifts.value.recharges).toBeLessThan(plain.value.recharges);
    expect(shifts.value.days).toBeLessThan(plain.value.days);
  });
});
