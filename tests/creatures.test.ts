/** AW-215 / AW-216: surface creatures, roaming, fights and captures. */
import { describe, expect, it } from "vitest";
import { CREATURES_BY_ID, type Temperament } from "../src/data/creatures";
import {
  bodyCreatureSpecies,
  captureBlockers,
  captureCreature,
  collectCreature,
  creatureByKey,
  deployRover,
  DOWNED_DAYS,
  captureOdds,
  settleFight,
  visibleCreatures,
  markExplored,
  hostilesAllowed,
  isBadlands,
  newGame,
  recallRover,
  repairQuote,
  finishRepairs,
  SAFE_RADIUS,
  specimenCount,
  specimenUnitPrice,
  stirCreatures,
  universeSeed,
  World,
  DEFAULT_UNIVERSE,
  type GameState,
} from "../src/sim";
import { canEnter } from "../src/sim/pathfinding";
import { hexDistance, neighbors } from "../src/sim/hex";
import { DAY } from "../src/sim/units";

const SEED = 42;
const world = new World(SEED);

interface Found {
  bodyId: string;
  region: number;
  key: string;
  species: string;
}

/** Every creature spawn in the galaxy (a few regions per living world), for picking test subjects. */
function census(w: World): Found[] {
  const out: Found[] = [];
  for (const sys of w.galaxy.systems) {
    for (const body of w.system(sys.id).bodies) {
      if (!body.life || body.regions === 0) continue;
      const surface = w.surface(body.id);
      for (let r = 0; r < Math.min(body.regions, 6); r++) for (const c of surface.creatures(r)) out.push({ bodyId: body.id, region: r, key: c.key, species: c.species });
    }
  }
  return out;
}
const ALL = census(world);

function pick(t: Temperament, aquatic = false): Found {
  const f = ALL.find((x) => CREATURES_BY_ID.get(x.species)!.temperament === t && !!CREATURES_BY_ID.get(x.species)!.aquatic === aquatic);
  if (!f) throw new Error(`no ${t} creature in seed ${SEED}`);
  return f;
}

type Surface = Extract<GameState["location"], { kind: "surface" }>;

/** Landed on the creature's world with the rover out near the creature's home, and the creature `gap` hexes off. */
function scene(f: Found, gap: number): GameState {
  const s = newGame({ seed: SEED });
  const surface = world.surface(f.bodyId);
  const spawn = surface.creature(f.key)!;
  const land = (p: { x: number; y: number }) => canEnter(surface, p.x, p.y, { canClimb: false });
  const ship = surface.landing(f.region);
  s.location = { kind: "surface", systemId: f.bodyId.split(".")[0]!, bodyId: f.bodyId, region: f.region, rover: null, ship, globalCoords: true } as Surface;
  deployRover(s, world);
  const rover = (s.location as Surface).rover!;
  // A dry spot near the creature's home, well clear of the ship, for the rover.
  const seen = new Set<string>();
  const queue = [{ x: spawn.x, y: spawn.y }];
  let spot = queue[0]!;
  while (queue.length > 0) {
    const p = queue.shift()!;
    if (land(p) && hexDistance(p, ship) > SAFE_RADIUS + 4) {
      spot = p;
      break;
    }
    for (const n of neighbors(p.x, p.y)) {
      const k = `${n.x},${n.y}`;
      if (!seen.has(k) && hexDistance(n, spawn) < 10) {
        seen.add(k);
        queue.push(n);
      }
    }
  }
  rover.x = spot.x;
  rover.y = spot.y;
  // Walk the creature out `gap` hexes along open ground.
  let c = { ...spot };
  for (let i = 0; i < gap; i++) {
    const n = neighbors(c.x, c.y).find((p) => land(p) && hexDistance(p, spot) > hexDistance(c, spot) && hexDistance(p, ship) > SAFE_RADIUS);
    if (!n) break;
    c = n;
  }
  s.fauna = { [f.bodyId]: { [f.key]: { x: c.x, y: c.y } } };
  return s;
}

describe("creature placement (AW-215)", () => {
  it("living worlds have creatures; dead ones don't", () => {
    expect(ALL.length).toBeGreaterThan(10);
    for (const sys of world.galaxy.systems.slice(0, 6)) {
      for (const b of world.system(sys.id).bodies) if (!b.life) expect(bodyCreatureSpecies(SEED, b)).toEqual({ land: [], sea: [] });
    }
  });

  it("no hunters at home, on the Meadow, or anywhere with Hostile life off; Badlands only past the charts", () => {
    for (const sys of world.galaxy.systems) {
      for (const b of world.system(sys.id).bodies) {
        if (!b.life) continue;
        const species = bodyCreatureSpecies(SEED, b);
        const fierce = [...species.land, ...species.sea].some((id) => ["hostile", "territorial"].includes(CREATURES_BY_ID.get(id)!.temperament));
        if (sys.home || b.nickname || b.easy) {
          expect(hostilesAllowed(SEED, b)).toBe(false);
          expect(fierce, b.name).toBe(false);
        }
        if (isBadlands(SEED, b)) expect(sys.charted).toBe(false);
      }
    }
    const calm = new World(universeSeed(SEED, { ...DEFAULT_UNIVERSE, hostile: "none" }));
    for (const f of census(calm)) expect(["hostile", "territorial"]).not.toContain(CREATURES_BY_ID.get(f.species)!.temperament);
  });

  it("creature specimens take their size in slots and fetch more than plants", () => {
    const s = newGame({ seed: SEED });
    expect(specimenCount({ "x|snowshell": 2, "x|bellwort": 1 })).toBe(5);
    expect(specimenUnitPrice(s, "x|ridgeback stalker")).toBeGreaterThan(specimenUnitPrice(s, "x|bellwort"));
  });
});

describe("roaming (AW-215)", () => {
  it("skittish creatures run from the rover", () => {
    const f = pick("skittish");
    const s = scene(f, 2);
    const loc = s.location as Surface;
    const before = hexDistance(creatureByKey(s, world, f.bodyId, f.key)!, loc.rover!);
    stirCreatures(s, world, 60);
    expect(hexDistance(creatureByKey(s, world, f.bodyId, f.key)!, loc.rover!)).toBeGreaterThan(before);
  });

  it("hunters close in and catch the rover, but never come near the ship", () => {
    const f = pick("hostile");
    const s = scene(f, 4);
    const loc = s.location as Surface;
    let caught = null;
    for (let i = 0; i < 12 && !caught; i++) caught = stirCreatures(s, world, 20);
    expect(caught?.key).toBe(f.key);
    // Park the rover beside the ship: the hunter keeps its distance.
    loc.rover!.x = loc.ship!.x;
    loc.rover!.y = loc.ship!.y;
    for (let i = 0; i < 10; i++) expect(stirCreatures(s, world, 30)).toBeNull();
    expect(hexDistance(creatureByKey(s, world, f.bodyId, f.key)!, loc.ship!)).toBeGreaterThan(SAFE_RADIUS);
  });
});

describe("captures, settled as odds (AW-225)", () => {
  it("shows odds and an energy estimate within what the rover can spare, and the rover stays put", () => {
    const f = pick("docile");
    const s = scene(f, 3);
    const loc = s.location as Surface;
    const at = { x: loc.rover!.x, y: loc.rover!.y };
    const odds = captureOdds(s, world, f.key)!;
    expect(odds.chance).toBeGreaterThan(0.3);
    expect(odds.energy).toBeGreaterThan(0);
    expect(odds.energy).toBeLessThanOrEqual(odds.budget);
    expect(odds.budget).toBeLessThan(loc.rover!.energy);
    expect(captureBlockers(s, world, f.key)).toEqual([]);
    const before = loc.rover!.energy;
    const r = captureCreature(s, world, f.key);
    if (!r.ok) throw new Error(r.reason);
    expect({ x: loc.rover!.x, y: loc.rover!.y }).toEqual(at);
    expect(r.value.chance).toBeCloseTo(odds.chance);
    if (r.value.outcome === "captured") {
      const name = CREATURES_BY_ID.get(f.species)!.name;
      expect(loc.rover!.specimens?.[`${f.bodyId}|${name}`]).toBe(1);
      expect(s.compendium[`fauna:${f.species}`]).toBeDefined();
      expect(before - loc.rover!.energy).toBeLessThanOrEqual(odds.budget + 0.01);
    } else {
      // Failed: just enough left to get home.
      expect(loc.rover!.energy).toBeCloseTo(before - odds.budget, 5);
    }
    expect(s.lastFight?.id).toBe(1);
  });

  it("better gear and faster motors improve the odds; a faster creature worsens them", () => {
    const f = pick("skittish");
    const plain = captureOdds(scene(f, 3), world, f.key)!;
    const geared = scene(f, 3);
    geared.ship.upgrades.push("stunGun", "netLauncher", "roverMotors");
    expect(captureOdds(geared, world, f.key)!.chance).toBeGreaterThan(plain.chance);
    const h = pick("hostile");
    const bare = captureOdds(scene(h, 2), world, h.key)!;
    const armed = scene(h, 2);
    armed.ship.upgrades.push("roverLaser", "roverArmour");
    const better = captureOdds(armed, world, h.key)!;
    expect(better.chance).toBeGreaterThan(bare.chance);
    expect(better.injuryRisk).toBeLessThan(bare.injuryRisk);
  });

  it("with nothing to spare, there's no attempt", () => {
    const f = pick("docile");
    const s = scene(f, 2);
    (s.location as Surface).rover!.energy = 1;
    expect(captureBlockers(s, world, f.key).join()).toMatch(/No energy to spare/);
  });

  it("a hunter that wrecks the rover disables it until recall, and the yard repairs its gear", () => {
    const h = pick("hostile");
    let wrecked: GameState | null = null;
    for (let i = 0; i < 30 && !wrecked; i++) {
      const s = scene(h, 1);
      s.rngState = (s.rngState + i * 7919) >>> 0;
      (s.location as Surface).rover!.cargo = { ironNickel: 5 };
      (s.location as Surface).rover!.hull = 4; // already badly holed
      s.ship.roverWrecked = true; // gear offline: the rover can only run
      const r = settleFight(s, world, h.key, "defend");
      if (!r.ok) throw new Error(r.reason);
      expect(r.value.outcome === "disabled" || r.value.outcome === "broke off").toBe(true);
      if (r.value.outcome === "disabled") wrecked = s;
    }
    expect(wrecked).not.toBeNull();
    const s = wrecked!;
    const loc = s.location as Surface;
    expect(loc.rover!.disabled).toBe(true);
    expect(loc.rover!.cargo).toEqual({});
    expect(captureBlockers(s, world, h.key).join()).toMatch(/disabled/);
    expect(recallRover(s, world).ok).toBe(true);
    expect(loc.rover!.disabled).toBeUndefined();
    expect(repairQuote(s)!.cost).toBeGreaterThanOrEqual(2_500);
    finishRepairs(s);
    expect(s.ship.roverWrecked).toBeUndefined();
  });

  it("creatures on swept ground show anywhere on the world; unswept ones don't", () => {
    const f = pick("docile");
    const s = scene(f, 3);
    const c = creatureByKey(s, world, f.bodyId, f.key)!;
    expect(visibleCreatures(s, world).some((v) => v.key === f.key)).toBe(false);
    const local = world.surface(f.bodyId).toLocal(c.x, c.y)!;
    const k = (s.regions[`${f.bodyId}#${local.region}`] ??= { discovered: [], prospected: [], drillSites: [], extracted: {}, visits: 0, floraFound: [], floraSampled: [], explored: [] });
    markExplored(k, local.x, local.y, 0);
    // Park the rover far off: still on the map.
    const loc = s.location as Surface;
    loc.rover!.x = loc.ship!.x;
    loc.rover!.y = loc.ship!.y;
    expect(visibleCreatures(s, world).some((v) => v.key === f.key)).toBe(true);
  });

  it("a downed creature can be collected, and is gone after 30 days", () => {
    const f = pick("docile");
    const s = scene(f, 1);
    const loc = s.location as Surface;
    s.fauna![f.bodyId]![f.key]!.downAt = s.time;
    expect(creatureByKey(s, world, f.bodyId, f.key)!.down).toBe(true);
    const r = collectCreature(s, world, f.key);
    if (!r.ok) throw new Error(r.reason);
    expect(specimenCount(loc.rover!.specimens)).toBeGreaterThan(0);
    expect(creatureByKey(s, world, f.bodyId, f.key)).toBeNull();
    const t = scene(f, 1);
    t.fauna![f.bodyId]![f.key]!.downAt = t.time;
    t.time += (DOWNED_DAYS + 1) * DAY;
    expect(creatureByKey(t, world, f.bodyId, f.key)).toBeNull();
  });
});
