/** Renders a region's terrain once into an offscreen canvas: flat tile colors with hillshaded relief. */
import type { BodyKind, RegionKnowledge, RegionMap } from "../../../sim";
import { isExplored, Terrain } from "../../../sim";
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

/**
 * The same terrain as faint "orbital imagery": darkened, desaturated and cooled. Unswept ground is
 * shown with this until the rover's sensors paint it in.
 */
export function buildFoggedImage(terrain: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = terrain.width;
  canvas.height = terrain.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.drawImage(terrain, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] as number;
    const g = d[i + 1] as number;
    const b = d[i + 2] as number;
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    const dim = 0.36;
    d[i] = (lum + (r - lum) * 0.4) * dim * 0.85;
    d[i + 1] = (lum + (g - lum) * 0.4) * dim * 0.97 + 3;
    d[i + 2] = (lum + (b - lum) * 0.4) * dim * 1.18 + 12;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Full-color terrain where the rover has swept, fogged imagery everywhere else. */
export function composePainted(
  terrain: HTMLCanvasElement,
  fogged: HTMLCanvasElement,
  map: RegionMap,
  know: RegionKnowledge,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = terrain.width;
  canvas.height = terrain.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.drawImage(fogged, 0, 0);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (isExplored(know, x, y)) ctx.drawImage(terrain, x * SUB, y * SUB, SUB, SUB, x * SUB, y * SUB, SUB, SUB);
    }
  }
  return canvas;
}
