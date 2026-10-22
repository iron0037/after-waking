import { describe, expect, it } from "vitest";
import { dirBetween, disk, hexDistance, hexToPixel, neighbors, pixelToHex, ring, step, toCube, fromCube } from "../src/sim/hex";

describe("hex geometry (odd-r, pointy-top)", () => {
  it("has six neighbors, each one step away, from even and odd rows", () => {
    for (const c of [{ x: 5, y: 4 }, { x: 5, y: 5 }]) {
      const ns = neighbors(c.x, c.y);
      expect(ns).toHaveLength(6);
      expect(new Set(ns.map((n) => `${n.x},${n.y}`)).size).toBe(6);
      for (const n of ns) expect(hexDistance(c, n)).toBe(1);
    }
  });

  it("round-trips offset <-> cube coordinates", () => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(fromCube(toCube(x, y))).toEqual({ x, y });
  });

  it("disks and rings have the right sizes", () => {
    const c = { x: 10, y: 7 };
    expect(disk(c, 0)).toHaveLength(1);
    expect(disk(c, 1)).toHaveLength(7);
    expect(disk(c, 2)).toHaveLength(19);
    expect(ring(c, 3)).toHaveLength(18);
    for (const t of disk(c, 3)) expect(hexDistance(c, t)).toBeLessThanOrEqual(3);
  });

  it("picks the right hex from its own pixel center and nearby points", () => {
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        const p = hexToPixel(x, y, 10);
        expect(pixelToHex(p.x, p.y, 10)).toEqual({ x, y });
        expect(pixelToHex(p.x + 4, p.y - 3, 10)).toEqual({ x, y });
      }
    }
  });

  it("knows the direction between neighbors", () => {
    expect(dirBetween({ x: 3, y: 3 }, step(3, 3, "ne"))).toBe("ne");
    expect(dirBetween({ x: 3, y: 4 }, step(3, 4, "sw"))).toBe("sw");
    expect(dirBetween({ x: 3, y: 4 }, { x: 9, y: 9 })).toBeNull();
  });
});
