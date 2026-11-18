/** AW-263: battle damage to the drives and sensors matters after the fight. */
import { describe, expect, it } from "vitest";
import {
  callTow,
  damageWarning,
  flightPlan,
  foldPlan,
  newGame,
  reputation,
  scanBody,
  scanMinutes,
  towBlockers,
  towTerms,
  World,
  type GameState,
} from "../src/sim";

const world = new World(42);
const sys = world.galaxy.systems.find((x) => x.home && world.system(x.id).bodies.length > 3)!;
const bodies = world.system(sys.id).bodies;

function inSystem(drives = 0, sensors = 0): GameState {
  const s = newGame({ seed: 42 });
  s.location = { kind: "space", systemId: sys.id, pos: { x: 0, y: 0 }, orbiting: bodies[0]!.id };
  s.ship.damage = { hull: 0, drives, weapons: 0, sensors };
  return s;
}

describe("drive damage after a fight (AW-263)", () => {
  it("damaged drives make burns slower and thirstier; dead ones crawl", () => {
    const target = { edge: true as const };
    const fine = flightPlan(inSystem(0), world, target);
    const hurt = flightPlan(inSystem(50), world, target);
    const dead = flightPlan(inSystem(100), world, target);
    if (!fine.ok || !hurt.ok || !dead.ok) throw new Error("no plan");
    expect(hurt.value.fuel).toBeGreaterThan(fine.value.fuel);
    expect(hurt.value.minutes).toBeGreaterThan(fine.value.minutes);
    expect(dead.value.fuel).toBeGreaterThan(hurt.value.fuel);
    expect(dead.value.minutes).toBeGreaterThan(hurt.value.minutes * 1.5);
  });

  it("dead drives fold only home, and folds cost more fuel when damaged", () => {
    const other = world.galaxy.systems.find((x) => x.id !== sys.id)!;
    const deadMsg = /only fold they'll make/;
    expect(foldPlan(inSystem(100), world, other.id).blockers.join()).toMatch(deadMsg);
    expect(foldPlan(inSystem(100), world, "intrepid").blockers.join()).not.toMatch(deadMsg);
    expect(foldPlan(inSystem(60), world, other.id).fuel).toBeGreaterThan(foldPlan(inSystem(0), world, other.id).fuel);
  });

  it("a Helm tow hauls a dead ship home, for credits and a little standing", () => {
    expect(towBlockers(inSystem(40), world).join()).toMatch(/still run/);
    const s = inSystem(100);
    s.credits = 50_000;
    const helm = reputation(s, "helm");
    const { cr } = towTerms(s, world);
    const r = callTow(s, world);
    if (!r.ok) throw new Error(r.reason);
    expect(s.location.kind).toBe("intrepid");
    expect(s.credits).toBeLessThanOrEqual(50_000 - cr); // docking also settles wages
    expect(reputation(s, "helm")).toBeLessThan(helm);
    const broke = inSystem(100);
    broke.credits = 10;
    expect(towBlockers(broke, world).join()).toMatch(/tug costs/);
  });

  it("warns about damage that matters outside a fight", () => {
    expect(damageWarning(inSystem(0, 0))).toBeNull();
    expect(damageWarning(inSystem(100, 0))).toMatch(/drives are dead/);
    expect(damageWarning(inSystem(0, 40))).toMatch(/sensors are 40% damaged/);
  });
});

describe("sensor damage after a fight (AW-263)", () => {
  it("damaged sensors scan slower; dead ones can't scan", () => {
    expect(scanMinutes(inSystem(0, 50))).toBeGreaterThan(scanMinutes(inSystem(0, 0)));
    const s = inSystem(0, 100);
    s.scannedBodies = s.scannedBodies.filter((id) => id !== bodies[0]!.id);
    const r = scanBody(s, world);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.reason).toMatch(/knocked out/);
  });
});
