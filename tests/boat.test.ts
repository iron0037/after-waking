import { describe, expect, it } from "vitest";
import { BASE_STATS } from "../src/data/ship";
import {
  boardBoat,
  boatDock,
  boatMobility,
  canEnter,
  cargoTonnes,
  drill,
  findPath,
  knowledge,
  landingAccess,
  launchBoat,
  moveRoverTo,
  neighbors,
  newGame,
  prospect,
  putRoverAshore,
  roverMobility,
  SEA_ID_BASE,
  stowRover,
  Terrain,
  vehicleHome,
  vehicleMinutesMult,
  vehicleMismatch,
  vehicleOf,
  World,
  workDeposit,
  collectSample,
  type Body,
  type GameState,
  type Vec2,
} from "../src/sim";

const SEED = 42;

/** A landable world with a seabed deposit that's reachable by water from a shore the ship can stand on. */
function seaScenario(): { world: World; state: GameState; body: Body; region: number; key: string; shore: Vec2 } {
  const world = new World(SEED);
  for (const sys of world.galaxy.systems) {
    for (const body of world.system(sys.id).bodies) {
      if (body.kind !== "ocean" && body.kind !== "terrestrial") continue;
      if (!landingAccess(body, BASE_STATS.ratings).ok) continue;
      const surface = world.surface(body.id);
      for (let region = 0; region < Math.min(body.regions, 6); region++) {
        const sea = surface.deposits(region).filter((d) => d.id >= SEA_ID_BASE && d.depthM <= BASE_STATS.drillMaxDepthM);
        if (sea.length === 0) continue;
        const d = sea[0]!;
        const o = surface.origin(region);
        for (let y = o.y + 1; y < o.y + 47; y++) {
          for (let x = o.x + 1; x < o.x + 47; x++) {
            if (surface.terrainAt(x, y) !== Terrain.plain) continue;
            const dock = neighbors(x, y).find((n) => surface.terrainAt(n.x, n.y) === Terrain.liquid);
            if (!dock) continue;
            const path = findPath(surface, dock, d, boatMobility());
            if (!path || path.length > 40) continue;
            const state = newGame({ seed: SEED });
            state.ship.upgrades.push("boat");
            state.location = { kind: "surface", systemId: sys.id, bodyId: body.id, region, rover: null, ship: { x, y }, globalCoords: true };
            knowledge(state, body.id, region).discovered.push(d.id);
            return { world, state, body, region, key: d.key, shore: { x, y } };
          }
        }
      }
    }
  }
  throw new Error("no sea scenario on this seed");
}

describe("ocean worlds (AW-17)", () => {
  it("are open to landing, and mostly sea with islands", () => {
    const world = new World(SEED);
    const oceans = world.galaxy.systems.flatMap((s) => world.system(s.id).bodies).filter((b) => b.kind === "ocean");
    expect(oceans.length).toBeGreaterThan(0);
    for (const b of oceans) expect(landingAccess(b, { ...BASE_STATS.ratings, maxGravityG: 9, maxPressureAtm: 999, maxTempC: 999, minTempC: -999, maxRadiation: 9, corrosionProof: true }).ok).toBe(true);
    const b = oceans[0]!;
    const map = world.region(b.id, 0);
    const water = map.terrain.filter((t) => t === Terrain.liquid).length / map.terrain.length;
    expect(water).toBeGreaterThan(0.5);
  });
});

describe("the boat (AW-17)", () => {
  it("needs the upgrade and a shore", () => {
    const { world, state } = seaScenario();
    state.ship.upgrades = state.ship.upgrades.filter((u) => u !== "boat");
    expect(launchBoat(state, world).ok).toBe(false);
    state.ship.upgrades.push("boat");
    expect(boatDock(state, world)).not.toBeNull();
    expect(launchBoat(state, world).ok).toBe(true);
    const loc = state.location as { rover: { vehicle?: string } };
    expect(loc.rover.vehicle).toBe("boat");
  });

  it("dredges a seabed deposit and brings the haul home", () => {
    const { world, state, key } = seaScenario();
    const d = world.surface((state.location as { bodyId: string }).bodyId).deposit(key)!;
    // The rover can't work it.
    expect(launchBoat(state, world).ok).toBe(true);
    expect(moveRoverTo(state, world, d.x, d.y).ok).toBe(true);
    expect(prospect(state, world, key).ok).toBe(true);
    const r = drill(state, world, key, 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tonnes).toBeGreaterThan(0);
    const dock = boatDock(state, world)!;
    expect(moveRoverTo(state, world, dock.x, dock.y).ok).toBe(true);
    const before = cargoTonnes(state.ship.cargo);
    expect(stowRover(state, world).ok).toBe(true);
    expect(cargoTonnes(state.ship.cargo)).toBeGreaterThan(before);
    expect((state.location as { rover: unknown }).rover).toBeNull();
  });

  it("the rover can't dredge, and the boat can't drill on land", () => {
    const { world, state, key, shore } = seaScenario();
    const loc = state.location as Extract<GameState["location"], { kind: "surface" }>;
    const d = world.surface(loc.bodyId).deposit(key)!;
    loc.rover = { x: shore.x, y: shore.y, energy: 100, cargo: {} };
    const r = prospect(state, world, key);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/boat/);
    loc.rover = { x: d.x, y: d.y, energy: 100, cargo: {}, vehicle: "boat" };
    const land = world.surface(loc.bodyId).deposits(loc.region).find((x) => x.id < SEA_ID_BASE && !x.hidden);
    if (land) {
      knowledge(state, loc.bodyId, loc.region).discovered.push(land.id);
      const l = prospect(state, world, land.key);
      expect(l.ok).toBe(false);
      if (!l.ok) expect(l.reason).toMatch(/rover ashore/);
    }
  });

  it("ferries the rover: put it ashore, drive, board again, stow both", () => {
    const { world, state } = seaScenario();
    expect(launchBoat(state, world, true).ok).toBe(true);
    const loc = state.location as Extract<GameState["location"], { kind: "surface" }>;
    expect(loc.roverAboard).toBeDefined();
    const surface = world.surface(loc.bodyId);
    const boat = loc.rover!;
    const ashore = neighbors(boat.x, boat.y).find((n) => findPath(surface, boat, n, roverMobility(state)) !== null || surface.terrainAt(n.x, n.y) === Terrain.plain)!;
    expect(putRoverAshore(state, world, ashore.x, ashore.y).ok).toBe(true);
    expect(vehicleOf(loc.rover!)).toBe("rover");
    expect(loc.parkedBoat).toBeDefined();
    // Can't stow the rover and leave the boat out.
    expect(stowRover(state, world).ok).toBe(false);
    expect(boardBoat(state, world).ok).toBe(true);
    expect(vehicleOf(loc.rover!)).toBe("boat");
    expect(stowRover(state, world).ok).toBe(true);
    expect(loc.rover).toBeNull();
    expect(loc.roverAboard).toBeUndefined();
  });

  it("auto-work runs seabed deposits with the boat", () => {
    const { world, state, key } = seaScenario();
    const before = cargoTonnes(state.ship.cargo);
    const r = workDeposit(state, world, key);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.tonnes).toBeGreaterThan(0);
    expect(cargoTonnes(state.ship.cargo)).toBeGreaterThan(before);
  });

  it("samples sea life where there is some", () => {
    const world = new World(SEED);
    const body = world.galaxy.systems
      .flatMap((s) => world.system(s.id).bodies)
      .find((b) => b.life && (b.kind === "ocean" || b.kind === "terrestrial") && world.surface(b.id).flora(0).some((f) => f.id >= SEA_ID_BASE));
    expect(body).toBeDefined();
    if (!body) return;
    const site = world.surface(body.id).flora(0).find((f) => f.id >= SEA_ID_BASE)!;
    const state = newGame({ seed: SEED });
    state.ship.upgrades.push("boat");
    state.location = { kind: "surface", systemId: body.id.split(".")[0]!, bodyId: body.id, region: 0, rover: { x: site.x, y: site.y, energy: 140, cargo: {}, vehicle: "boat" }, ship: { x: 0, y: 0 }, globalCoords: true };
    knowledge(state, body.id, 0).floraFound.push(site.id);
    expect(collectSample(state, world, site.key).ok).toBe(true);
  });
});

describe("boat UI helpers (AW-17)", () => {
  it("vehicleMismatch matches sites to vehicles", () => {
    expect(vehicleMismatch(null, true, "deposit")).toMatch(/boat/);
    expect(vehicleMismatch("rover", true, "plants")).toMatch(/boat/);
    expect(vehicleMismatch("boat", false, "deposit")).toMatch(/ashore/);
    expect(vehicleMismatch("boat", true, "deposit")).toBeNull();
    expect(vehicleMismatch("rover", false, "plants")).toBeNull();
  });

  it("vehicleHome: the boat heads to its dock, a rover to the moored boat, otherwise the ship", () => {
    const { world, state, shore } = seaScenario();
    expect(vehicleHome(state, world)).toEqual(shore);
    expect(launchBoat(state, world, true).ok).toBe(true);
    expect(vehicleHome(state, world)).toEqual(boatDock(state, world));
    const loc = state.location as { rover: { x: number; y: number } | null; parkedBoat?: { x: number; y: number } };
    const boat = { x: loc.rover!.x, y: loc.rover!.y };
    const spot = neighbors(boat.x, boat.y).find((n) => canEnter(world.surface((state.location as { bodyId: string }).bodyId), n.x, n.y, roverMobility(state)));
    expect(spot).toBeDefined();
    expect(putRoverAshore(state, world, spot!.x, spot!.y).ok).toBe(true);
    expect(vehicleHome(state, world)).toEqual(boat);
  });

  it("vehicleMinutesMult: drive motors speed the rover, not the boat", () => {
    const { world, state } = seaScenario();
    state.ship.upgrades.push("roverMotors");
    expect(vehicleMinutesMult(state)).toBeLessThan(1);
    expect(launchBoat(state, world).ok).toBe(true);
    expect(vehicleMinutesMult(state)).toBe(1);
  });
});
