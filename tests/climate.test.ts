/** AW-265: latitude climate on terrestrial and ocean worlds: ice caps, a desert belt, and life to match. */
import { describe, expect, it } from "vitest";
import { FLORA_BY_NAME } from "../src/data/catalog";
import { CREATURES_BY_ID } from "../src/data/creatures";
import {
  aridBelt,
  climateSpecies,
  latitudeOf,
  polarCapLat,
  surfaceLayout,
  Terrain,
  World,
  Zone,
  zoneClimate,
  type Body,
} from "../src/sim";

const SEED = 42;
const world = new World(SEED);
const old = new World(SEED, 7);
const bodies = (w: World): Body[] => w.galaxy.systems.flatMap((s) => w.system(s.id).bodies);
const banded = bodies(world).filter((b) => b.climateBands && b.regions > 0);

describe("latitude climate (AW-265)", () => {
  it("comes with world generation 8, on terrestrial and ocean worlds with water seas only", () => {
    expect(banded.length).toBeGreaterThan(0);
    for (const b of bodies(world)) expect(!!b.climateBands).toBe((b.kind === "terrestrial" || b.kind === "ocean") && !b.sea);
    expect(bodies(old).some((b) => b.climateBands)).toBe(false);
  });

  it("leaves every other world exactly as generation 7 built it", () => {
    const others = bodies(world).filter((b) => !b.climateBands && b.regions > 0 && b.kind !== "asteroid").slice(0, 6);
    expect(others.length).toBeGreaterThan(0);
    for (const b of others) {
      const a = world.region(b.id, 0);
      const z = old.region(b.id, 0);
      expect(Array.from(a.terrain)).toEqual(Array.from(z.terrain));
      expect(a.flora).toEqual(z.flora);
      expect(a.zones).toBeUndefined();
    }
  });

  it("caps are the orbit art's caps: colder worlds have bigger ones, hot worlds none", () => {
    expect(polarCapLat(15)).toBeCloseTo(1.42, 2); // about 81°
    expect(polarCapLat(0)!).toBeLessThan(polarCapLat(15)!);
    expect(polarCapLat(50)).toBeNull();
    expect(latitudeOf(0, 100)).toBeCloseTo(Math.PI / 2, 1);
    expect(latitudeOf(49.5, 100)).toBeCloseTo(0, 5);
  });

  it("freezes the far north and south", () => {
    let polarChecked = 0;
    for (const b of banded) {
      const surface = world.surface(b.id);
      const { height, width } = surfaceLayout(b);
      const cap = polarCapLat(b.tempC);
      if (cap === null) continue;
      // Well inside the cap: ice or mountain, nothing else.
      for (let gy = 0; gy < height; gy++) {
        if (latitudeOf(gy, height) < cap + 0.25) continue;
        for (let gx = 0; gx < width; gx += 7) {
          const t = surface.terrainAt(gx, gy);
          if (t === null) continue;
          expect([Terrain.ice, Terrain.mountain]).toContain(t);
          polarChecked++;
        }
      }
    }
    expect(polarChecked).toBeGreaterThan(0);
  });

  it("dries out a belt in the low latitudes of warm terrestrial worlds, wider on hot ones", () => {
    expect(aridBelt({ kind: "terrestrial", tempC: 0 })).toBeNull();
    expect(aridBelt({ kind: "ocean", tempC: 25 })).toBeNull();
    const mild = aridBelt({ kind: "terrestrial", tempC: 15 })!;
    const hot = aridBelt({ kind: "terrestrial", tempC: 40 })!;
    expect(hot.hi - hot.lo).toBeGreaterThan(mild.hi - mild.lo);
    const warm = banded.find((b) => aridBelt(b));
    if (warm) {
      const zones = Array.from({ length: warm.regions }, (_, r) => Array.from(world.region(warm.id, r).zones ?? [])).flat();
      expect(zones).toContain(Zone.arid);
    }
  });

  it("plants and animals live in their own zone's climate, where that zone is", () => {
    let plants = 0;
    let animals = 0;
    let animalsAll = 0;
    for (const b of banded.filter((x) => x.life)) {
      const surface = world.surface(b.id);
      for (let r = 0; r < Math.min(b.regions, 8); r++) {
        const map = world.region(b.id, r);
        for (const f of map.flora) {
          if (f.zone === undefined || f.id >= 100) continue; // sea life is the world's own
          expect(climateSpecies(SEED, b, zoneClimate(b, f.zone))).toContain(f.species);
          expect(FLORA_BY_NAME.get(f.species)!.climates).toContain(zoneClimate(b, f.zone));
          plants++;
        }
        for (const c of surface.creatures(r)) {
          const entry = CREATURES_BY_ID.get(c.species)!;
          if (entry.aquatic) continue;
          const local = surface.toLocal(c.x, c.y)!;
          const zone = map.zones![local.y * 48 + local.x] as Zone;
          // Placement keeps to the zone except when a region has nowhere left there (then it falls back).
          animalsAll++;
          if (entry.climates.includes(zoneClimate(b, zone))) animals++;
        }
      }
    }
    expect(plants).toBeGreaterThan(0);
    expect(animals).toBeGreaterThan(0);
    expect(animals / animalsAll).toBeGreaterThan(0.8);
  });
});
