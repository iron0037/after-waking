/**
 * Renders a region's terrain once into an offscreen canvas: every hex filled with its terrain colour and
 * hillshaded relief. The images are drawn at a fixed hex size (`HEX`) and scaled to the screen when blitted.
 */
import type { BodyKind, RegionKnowledge, RegionMap } from "../../../sim";
import { hexCorners, hexToPixel, isExplored, mapPixelSize, Terrain } from "../../../sim";
import { TERRAIN_COLORS } from "../../palette";

/** Hex circumradius, in pixels, of the offscreen images. */
export const HEX = 14;

const SQRT3 = Math.sqrt(3);
/** Vertical spacing of hex rows in unit-width "world" space. */
const ROW_H = SQRT3 / 2;

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Adds one closed hexagon to the current path. */
export function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const pts = hexCorners(x, y, size);
  const first = pts[0] as { x: number; y: number };
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < 6; i++) ctx.lineTo((pts[i] as { x: number }).x, (pts[i] as { y: number }).y);
  ctx.closePath();
}

export function buildTerrainImage(map: RegionMap, kind: BodyKind): HTMLCanvasElement {
  const { width, height } = map;
  const size = mapPixelSize(width, height, HEX);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(size.w);
  canvas.height = Math.ceil(size.h);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const palette = TERRAIN_COLORS[kind].map(parseHex);
  const image = ctx.createImageData(canvas.width, canvas.height);
  const hexW = SQRT3 * HEX;

  const tileElev = (x: number, y: number): number =>
    map.elevation[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))] as number;
  // Smooth elevation at a point in unit-spacing world space (tile (x, y) sits at x + half a tile on odd rows,
  // and y * sqrt(3)/2): linear along each of the two nearest rows, then linear between them.
  const rowElev = (u: number, row: number): number => {
    const r = Math.min(height - 1, Math.max(0, row));
    const fx = u - 0.5 * (r & 1);
    const x0 = Math.floor(fx);
    const f = fx - x0;
    const a = tileElev(x0, r);
    return a + (tileElev(x0 + 1, r) - a) * f;
  };
  const elev = (u: number, v: number): number => {
    const rf = v / ROW_H;
    const r0 = Math.floor(rf);
    const a = rowElev(u, r0);
    return a + (rowElev(u, r0 + 1) - a) * (rf - r0);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = map.terrain[y * width + x] as Terrain;
      const flat = t === Terrain.liquid || t === Terrain.lava ? 0.25 : 1;
      const [r, g, b] = palette[t] as [number, number, number];
      const c = hexToPixel(x, y, HEX);
      const x0 = Math.max(0, Math.floor(c.x - hexW / 2));
      const x1 = Math.min(canvas.width - 1, Math.ceil(c.x + hexW / 2));
      const y0 = Math.max(0, Math.floor(c.y - HEX));
      const y1 = Math.min(canvas.height - 1, Math.ceil(c.y + HEX));
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const dx = Math.abs(px + 0.5 - c.x);
          const dy = Math.abs(py + 0.5 - c.y);
          if (dx > hexW / 2 || dy + dx / SQRT3 > HEX) continue;
          const u = (px + 0.5 - hexW / 2) / hexW;
          const v = (py + 0.5 - HEX) / hexW;
          const e = elev(u, v);
          // Light from the north-west: slopes that rise away from it catch more light.
          const slope = elev(u + 0.5, v) - elev(u - 0.5, v) + (elev(u, v + 0.5) - elev(u, v - 0.5));
          const shade = Math.min(1.25, Math.max(0.68, 0.72 + 0.5 * e + slope * 3 * flat));
          const o = (py * canvas.width + px) * 4;
          image.data[o] = Math.min(255, r * shade);
          image.data[o + 1] = Math.min(255, g * shade);
          image.data[o + 2] = Math.min(255, b * shade);
          image.data[o + 3] = 255;
        }
      }
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
    if (d[i + 3] === 0) continue; // outside the hex map
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
  // All swept hexes as one clip (a hair oversized so neighbours leave no seams), then the colour image through it.
  ctx.beginPath();
  let any = false;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isExplored(know, x, y)) continue;
      const c = hexToPixel(x, y, HEX);
      hexPath(ctx, c.x, c.y, HEX + 0.6);
      any = true;
    }
  }
  if (any) {
    ctx.clip();
    ctx.drawImage(terrain, 0, 0);
  }
  return canvas;
}
