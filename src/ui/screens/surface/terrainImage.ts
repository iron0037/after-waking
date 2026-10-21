/** Renders a region's terrain once into an offscreen canvas: flat tile colors with hillshaded relief. */
import type { BodyKind, RegionMap } from "../../../sim";
import { Terrain } from "../../../sim";
import { TERRAIN_COLORS } from "../../palette";

/** Pixels per tile in the offscreen image; relief shading is smooth at this resolution. */
export const SUB = 4;

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function buildTerrainImage(map: RegionMap, kind: BodyKind): HTMLCanvasElement {
  const { width, height } = map;
  const canvas = document.createElement("canvas");
  canvas.width = width * SUB;
  canvas.height = height * SUB;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const palette = TERRAIN_COLORS[kind].map(parseHex);
  const image = ctx.createImageData(canvas.width, canvas.height);

  const tileElev = (x: number, y: number): number =>
    map.elevation[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))] as number;
  // Bilinear elevation at fractional tile coordinates (tile centers are integers).
  const elev = (u: number, v: number): number => {
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const fx = u - x0;
    const fy = v - y0;
    const a = tileElev(x0, y0);
    const b = tileElev(x0 + 1, y0);
    const c = tileElev(x0, y0 + 1);
    const d = tileElev(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };

  for (let py = 0; py < canvas.height; py++) {
    for (let px = 0; px < canvas.width; px++) {
      const tx = Math.floor(px / SUB);
      const ty = Math.floor(py / SUB);
      const t = map.terrain[ty * width + tx] as Terrain;
      const u = (px + 0.5) / SUB - 0.5;
      const v = (py + 0.5) / SUB - 0.5;
      const e = elev(u, v);
      const flat = t === Terrain.liquid || t === Terrain.lava ? 0.25 : 1;
      // Light from the north-west: slopes that rise away from it catch more light.
      const slope = elev(u + 0.5, v) - elev(u - 0.5, v) + (elev(u, v + 0.5) - elev(u, v - 0.5));
      const shade = Math.min(1.25, Math.max(0.68, 0.72 + 0.5 * e + slope * 3 * flat));
      const [r, g, b] = palette[t] as [number, number, number];
      const o = (py * canvas.width + px) * 4;
      image.data[o] = Math.min(255, r * shade);
      image.data[o + 1] = Math.min(255, g * shade);
      image.data[o + 2] = Math.min(255, b * shade);
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
