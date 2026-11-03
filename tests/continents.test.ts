/** AW-210: continental terrestrial worlds (world generation 5). */
import { describe, expect, it } from "vitest";
import { continentalLevel, regionLandShare, regionOrigin, surfaceLayout, World, WORLD_GEN_LATEST } from "../src/sim";
import { Terrain } from "../src/sim/surface";

function seaShare(w: World, bodyId: string, regions: number): number {
  let wet = 0;
  let all = 0;
  for (let r = 0; r < regions; r++) {
    for (const t of w.region(bodyId, r).terrain) {
      all++;
      if (t === Terrain.liquid || t === Terrain.ice) wet++;
    }
  }
  return wet / all;
}

describe("continents (AW-210)", () => {
  it("new games' terrestrial worlds pick a sea share, from dry to mostly ocean; older generations are untouched", () => {
    expect(WORLD_GEN_LATEST).toBeGreaterThanOrEqual(5);
    const shares: number[] = [];
    for (const seed of [42, 7, 99, 3, 11, 2026, 5, 8]) {
      const w = new World(seed);
      for (const sys of w.galaxy.systems) for (const b of w.system(sys.id).bodies) if (b.waterShare !== undefined) shares.push(b.waterShare);
      const old = new World(seed, 4);
      for (const sys of old.galaxy.systems) for (const b of old.system(sys.id).bodies) expect(b.waterShare).toBeUndefined();
    }
    expect(shares.length).toBeGreaterThan(8);
    expect(Math.min(...shares)).toBeLessThan(0.35);
    expect(shares.some((s) => s >= 0.35 && s <= 0.6)).toBe(true);
    expect(Math.max(...shares)).toBeGreaterThan(0.6);
  });

  it("the surface follows the chosen share", () => {
    const w = new World(42);
    let checked = 0;
    for (const sys of w.galaxy.systems) {
      for (const b of w.system(sys.id).bodies) {
        if (b.waterShare === undefined || b.regions < 20 || b.tempC < -10) continue;
        expect(Math.abs(seaShare(w, b.id, 20) - b.waterShare)).toBeLessThan(0.2);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("the map's cheap land check agrees with the real terrain", () => {
    const w = new World(42);
    let checked = 0;
    for (const sys of w.galaxy.systems) {
      for (const b of w.system(sys.id).bodies) {
        if (b.waterShare === undefined || b.tempC < -10) continue;
        for (let r = 0; r < Math.min(b.regions, 6); r++) {
          const map = w.region(b.id, r);
          const o = regionOrigin(surfaceLayout(b), r);
          let agree = 0;
          for (let k = 0; k < 40; k++) {
            const x = (k * 7) % 48;
            const y = (k * 13) % 48;
            const sea = map.terrain[y * 48 + x] === Terrain.liquid;
            if ((continentalLevel(42, b, o.x + x, o.y + y)! < 0) === sea) agree++;
          }
          expect(agree).toBeGreaterThanOrEqual(38);
          const land = 1 - map.terrain.filter((t) => t === Terrain.liquid).length / map.terrain.length;
          expect(Math.abs(regionLandShare(42, b, r) - land)).toBeLessThan(0.25);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(5);
  });
});
