/** Playtest 13: the Selected Hex panel's facts, and last-known Intrepid prices. */
import { describe, expect, it } from "vitest";
import { deployRover, flyTo, fold, hexInfo, land, landingBlockers, lastKnownPrice, newGame, shipTile, World, type GameState } from "../src/sim";

const world = new World(42);
function landed(): GameState {
  for (const sys of world.galaxy.systems.filter((s) => !s.home)) {
    const detail = world.system(sys.id);
    for (const body of detail.bodies.filter((b) => b.regions > 0 && (b.kind === "barren" || b.kind === "desert"))) {
      const s = newGame({ seed: 42 });
      s.location = { kind: "space", systemId: sys.id, pos: { x: detail.edgeAU, y: 0 }, orbiting: null };
      s.ship.fuel = 60;
      if (!flyTo(s, world, { bodyId: body.id }).ok) continue;
      const region = Array.from({ length: Math.min(body.regions, 20) }, (_, r) => r).find((r) => landingBlockers(s, world, r).length === 0);
      if (region === undefined || !land(s, world, region).ok) continue;
      return s;
    }
  }
  throw new Error("nowhere to land");
}

describe("selected hex", () => {
  it("knows the terrain, the distances, whether the ship can hop there, and the rover's route", () => {
    const s = landed();
    const ship = shipTile(s, world);
    const near = { x: ship.x + 3, y: ship.y };
    let info = hexInfo(s, world, near.x, near.y)!;
    expect(info.terrain.length).toBeGreaterThan(0);
    expect(info.shipKm).toBe(6);
    expect(info.route).toBeNull(); // rover stowed
    if (info.ship.canSetDown) expect(info.ship.fuel).toBeGreaterThan(0);
    deployRover(s, world);
    info = hexInfo(s, world, near.x, near.y)!;
    expect(info.route?.vehicle).toBe("rover");
    if (info.route?.reachable) {
      expect(info.route.hours).toBeGreaterThan(0);
      expect(info.route.enough).toBe(true);
    }
    if (info.ship.canSetDown) expect(info.ship.reason).toMatch(/Stow the rover/);
    expect(hexInfo(s, world, ship.x, ship.y)!.ship.reason).toMatch(/already|is here/);
  });

  it("prices: live while docked, as last seen once you leave", () => {
    const s = newGame({ seed: 42 });
    const live = lastKnownPrice(s, "copper");
    expect(live.asOf).toBeNull();
    s.ship.fuel = 60;
    s.foldReadyAt = 0;
    const near = world.galaxy.systems.filter((x) => !x.home).sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y))[0]!;
    fold(s, world, near.id);
    s.location = { kind: "space", systemId: near.id, pos: { x: world.system(near.id).edgeAU * 1.01, y: 0 }, orbiting: null };
    s.foldReadyAt = 0;
    s.ship.cargo = {};
    fold(s, world, "intrepid");
    const docked = lastKnownPrice(s, "copper").price;
    s.foldReadyAt = 0;
    fold(s, world, near.id);
    s.market.mult.copper = 1.7; // prices move while you're away; the captain can't see it
    const away = lastKnownPrice(s, "copper");
    expect(away.price).toBe(docked);
    expect(away.asOf).not.toBeNull();
  });
});

describe("surface lists", () => {
  it("cover every region of the world where something was found, not just the neighbourhood", async () => {
    const { regionsWithFinds, autoExplore, deployRover } = await import("../src/sim");
    const s = landed();
    deployRover(s, world);
    autoExplore(s, world);
    const loc = s.location as Extract<GameState["location"], { kind: "surface" }>;
    // Something found far away, in a region the rover never reached.
    const far = (loc.region + 7) % world.body(loc.bodyId).body.regions;
    s.regions[`${loc.bodyId}#${far}`] = { ...(s.regions[`${loc.bodyId}#${far}`] ?? { discovered: [], prospected: [], drillSites: [], extracted: {}, visits: 0, floraFound: [], floraSampled: [], explored: [] }), floraFound: [100] };
    const regions = regionsWithFinds(s, loc.bodyId);
    expect(regions).toContain(far);
    expect(regions.every((r) => Number.isInteger(r))).toBe(true);
  });
});

describe("life signs", () => {
  it("giants can't be read from orbit; a floater brought up confirms life there", async () => {
    const { lifeSigns } = await import("../src/sim");
    const s = newGame({ seed: 42 });
    const giant = world.galaxy.systems.flatMap((x) => world.system(x.id).bodies).find((b) => b.kind === "gasGiant" && !s.scannedBodies.includes(b.id))!;
    expect(lifeSigns(s, giant).label).toBe("Unknown");
    s.giantLife = { [giant.id]: ["abyssal bloom"] };
    expect(lifeSigns(s, giant)).toMatchObject({ tone: "good", label: "Confirmed: abyssal bloom" });
    const rock = world.galaxy.systems.flatMap((x) => world.system(x.id).bodies).find((b) => b.kind === "barren")!;
    expect(lifeSigns(s, rock).label).toBe("None detected");
  });
});

describe("living and dead giants", () => {
  it("some giants hold life, some don't; haze hints from orbit; a deep reading settles it", async () => {
    const { giantAlive, giantHaze, lifeSigns, GIANT_LIFE_SHARE } = await import("../src/sim");
    const s = newGame({ seed: 42 });
    const giants = [42, 7, 11, 99].flatMap((seed) => {
      const w = new World(seed);
      return w.galaxy.systems.flatMap((x) => w.system(x.id).bodies).filter((b) => b.kind === "gasGiant");
    });
    const alive = giants.filter((g) => giantAlive(s, g));
    const share = alive.length / giants.length;
    expect(share).toBeGreaterThan(GIANT_LIFE_SHARE.gasGiant - 0.15);
    expect(share).toBeLessThan(GIANT_LIFE_SHARE.gasGiant + 0.15);
    // Haze is a good but imperfect sign.
    const hazeAlive = alive.filter((g) => giantHaze(s, g)).length / alive.length;
    const dead = giants.filter((g) => !giantAlive(s, g));
    const hazeDead = dead.filter((g) => giantHaze(s, g)).length / dead.length;
    expect(hazeAlive).toBeGreaterThan(0.6);
    expect(hazeDead).toBeLessThan(0.3);
    // A reading from band 2 settles it.
    const g = dead[0]!;
    s.scannedBodies.push(g.id);
    s.atmoReadings = { [g.id]: [1, 2] };
    expect(lifeSigns(s, g).label).toBe("Sterile below the clouds");
    // A confirmed catch always counts as alive.
    s.giantLife = { [g.id]: ["cloud drifter"] };
    expect(giantAlive(s, g)).toBe(true);
  });
});
