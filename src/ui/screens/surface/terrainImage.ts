/**
 * Renders each region's terrain once into offscreen canvases: every hex filled with its terrain colour and
 * hillshaded relief. The images are drawn at a fixed hex size (`HEX`) and scaled to the screen when blitted.
 *
 * Images live in planet-wide "HEX pixel" space (hexToPixel(gx, gy, HEX)). Each one covers its region plus a
 * one-tile margin borrowed from the neighbours, and sits on whole-pixel offsets of that shared space, so
 * neighbouring images overlap pixel for pixel and the seams between regions don't show.
 */
import type { BodyKind, BodySurface } from "../../../sim";
import { hexCorners, hexToPixel, REGION_SIZE, Terrain } from "../../../sim";
import { TERRAIN_COLORS } from "../../palette";
import {
  DEPTH_STEPS,
  depthGradient,
  liquidRule,
  loadTextures,
  lushRule,
  lushTexture,
  TEX,
  TEX_SCALE,
  texturesReady,
  tintedTexture,
  waterDetail,
} from "./terrainTextures";

loadTextures();

/** Hex circumradius, in pixels, of the offscreen images. */
export const HEX = 14;

const SQRT3 = Math.sqrt(3);
/** Vertical spacing of hex rows in unit-width "world" space. */
const ROW_H = SQRT3 / 2;
/** Tiles of neighbouring regions painted around each region image (so the images overlap at the seams). */
const MARGIN = 1;
/** Extra elevation samples beyond the margin that the hillshade's slope reads. */
const ELEV_PAD = MARGIN + 2;
/** Wavelength, in HEX pixels, of the slow brightness drift laid over textures so their repeat doesn't show. */
const DRIFT = 53;

/** Deterministic lattice value in [0, 1) for the slow drift. */
function latticeValue(i: number, j: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Spacing, in tiles, of the lattice the local sea level is measured on. */
const SEA_NODE = 16;
/** Tiles around a lattice node that are searched for shores (twice that if none is found). */
const SEA_REACH = 24;
const seaNodes = new WeakMap<BodySurface, Map<number, number>>();

/**
 * Sea level read off the map itself: the sim's liquid line drifts by up to +-0.15 across a planet, so the elevation
 * where land meets liquid is measured (at each shore, midway between the liquid tile and its land neighbour) and
 * averaged around a lattice node. NaN where there are no shores in reach. Depends only on the surface, never on the
 * region being drawn, so neighbouring images agree.
 */
function seaNode(surface: BodySurface, ni: number, nj: number): number {
  let cache = seaNodes.get(surface);
  if (!cache) seaNodes.set(surface, (cache = new Map()));
  const key = (nj + 4096) * 8192 + (ni + 4096);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const cx = ni * SEA_NODE;
  const cy = nj * SEA_NODE;
  let value = Number.NaN;
  for (let pass = 0; pass < 2 && Number.isNaN(value); pass++) {
    const reach = SEA_REACH * (pass + 1);
    const step = pass + 1;
    let sum = 0;
    let n = 0;
    for (let y = cy - reach; y <= cy + reach; y += step) {
      for (let x = cx - reach; x <= cx + reach; x += step) {
        if (surface.terrainAt(x, y) !== Terrain.liquid) continue;
        for (const [dx, dy] of NEAR) {
          const t = surface.terrainAt(x + dx, y + dy);
          if (t === null || t === Terrain.liquid) continue;
          const e = surface.elevationAt(x, y);
          const land = surface.elevationAt(x + dx, y + dy);
          if (e === null || land === null) continue;
          sum += (e + land) / 2;
          n++;
          break;
        }
      }
    }
    if (n >= 3) value = sum / n;
  }
  cache.set(key, value);
  return value;
}
const NEAR: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Local sea level at a tile: the shore-measured level, blended between lattice nodes (`fallback` where none is known). */
function seaLevelAt(surface: BodySurface, gx: number, gy: number, fallback: number): number {
  const fx = gx / SEA_NODE;
  const fy = gy / SEA_NODE;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const ax = fx - i;
  const ay = fy - j;
  const node = (a: number, b: number): number => {
    const v = seaNode(surface, a, b);
    return Number.isNaN(v) ? fallback : v;
  };
  const top = node(i, j) * (1 - ax) + node(i + 1, j) * ax;
  const bot = node(i, j + 1) * (1 - ax) + node(i + 1, j + 1) * ax;
  return top * (1 - ay) + bot * ay;
}

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

/** An offscreen image of one region; (x, y) is its top-left corner in planet-wide HEX pixel space (whole pixels). */
export interface RegionImage {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  region: number;
}

/** The planet-wide tile range an image of `region` covers (region plus margin, clipped to the surface). */
function tileRange(surface: BodySurface, region: number): { x0: number; y0: number; x1: number; y1: number } {
  const o = surface.origin(region);
  return {
    x0: Math.max(0, o.x - MARGIN),
    y0: Math.max(0, o.y - MARGIN),
    x1: Math.min(surface.width - 1, o.x + REGION_SIZE - 1 + MARGIN),
    y1: Math.min(surface.height - 1, o.y + REGION_SIZE - 1 + MARGIN),
  };
}

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  return canvas;
}

export function buildTerrainImage(surface: BodySurface, region: number, kind: BodyKind): RegionImage {
  const map = surface.region(region);
  const o = surface.origin(region);
  const { x0: tx0, y0: ty0, x1: tx1, y1: ty1 } = tileRange(surface, region);
  const hexW = SQRT3 * HEX;
  // Pixel bounds of the covered tiles in planet-wide HEX space, snapped outward to whole pixels.
  const px0 = Math.floor(hexW * tx0);
  const py0 = Math.floor(1.5 * HEX * ty0);
  const px1 = Math.ceil(hexW * (tx1 + 1.5));
  const py1 = Math.ceil(1.5 * HEX * ty1 + 2 * HEX);
  const canvas = newCanvas(px1 - px0, py1 - py0);
  const out: RegionImage = { canvas, x: px0, y: py0, region };
  const ctx = canvas.getContext("2d");
  if (!ctx) return out;
  const palette = TERRAIN_COLORS[kind].map(parseHex);
  const textures = [0, 1, 2, 3, 4, 5].map((t) => tintedTexture(kind, t));
  // Verdant plains (steppe blends to lush meadow near the water) and liquid shaded by depth.
  const lush = lushRule({ kind, life: surface.body.life, tempC: surface.body.tempC });
  const lushTex = lush ? lushTexture(kind) : null;
  const water = liquidRule(kind);
  const depthColors = depthGradient(kind);
  const waterTex = waterDetail();
  const hasSea = kind === "terrestrial" || kind === "ocean";
  const image = ctx.createImageData(canvas.width, canvas.height);

  // Elevation around the region (with a pad from the neighbours, so the hillshade runs on across the seams).
  const span = REGION_SIZE + 2 * ELEV_PAD;
  const ex0 = o.x - ELEV_PAD;
  const ey0 = o.y - ELEV_PAD;
  const elevGrid = new Float32Array(span * span);
  for (let j = 0; j < span; j++) {
    for (let i = 0; i < span; i++) {
      const gx = Math.min(surface.width - 1, Math.max(0, ex0 + i));
      const gy = Math.min(surface.height - 1, Math.max(0, ey0 + j));
      const lx = Math.min(REGION_SIZE - 1, Math.max(0, gx - o.x));
      const ly = Math.min(REGION_SIZE - 1, Math.max(0, gy - o.y));
      elevGrid[j * span + i] = surface.elevationAt(gx, gy) ?? (map.elevation[ly * REGION_SIZE + lx] as number);
    }
  }
  const tileElev = (gx: number, gy: number): number =>
    elevGrid[Math.min(span - 1, Math.max(0, gy - ey0)) * span + Math.min(span - 1, Math.max(0, gx - ex0))] as number;
  // Smooth elevation at a point in unit-spacing world space (tile (x, y) sits at x + half a tile on odd rows,
  // and y * sqrt(3)/2): linear along each of the two nearest rows, then linear between them.
  const rowElev = (u: number, row: number): number => {
    const fx = u - 0.5 * (row & 1);
    const x0 = Math.floor(fx);
    const f = fx - x0;
    const a = tileElev(x0, row);
    return a + (tileElev(x0 + 1, row) - a) * f;
  };
  const elev = (u: number, v: number): number => {
    const rf = v / ROW_H;
    const r0 = Math.floor(rf);
    const a = rowElev(u, r0);
    return a + (rowElev(u, r0 + 1) - a) * (rf - r0);
  };

  // Sample the smooth elevation once per pixel (with a pad of half a tile for the slope), on a grid
  // `STEP` pixels apart filled in bilinearly: the field is smooth, and this is the slow part.
  const D = Math.round(hexW / 2);
  const bw = px1 - px0 + 2 * D;
  const bh = py1 - py0 + 2 * D;
  const STEP = 2;
  const cw = Math.ceil(bw / STEP) + 2;
  const ch = Math.ceil(bh / STEP) + 2;
  const coarse = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      const px = px0 - D + i * STEP;
      const py = py0 - D + j * STEP;
      coarse[j * cw + i] = elev((px + 0.5 - hexW / 2) / hexW, (py + 0.5 - HEX) / hexW);
    }
  }
  const E = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    const j = Math.floor(y / STEP);
    const fy = (y - j * STEP) / STEP;
    for (let x = 0; x < bw; x++) {
      const i = Math.floor(x / STEP);
      const fx = (x - i * STEP) / STEP;
      const k = j * cw + i;
      const top = (coarse[k] as number) + ((coarse[k + 1] as number) - (coarse[k] as number)) * fx;
      const bot = (coarse[k + cw] as number) + ((coarse[k + cw + 1] as number) - (coarse[k + cw] as number)) * fx;
      E[y * bw + x] = top + (bot - top) * fy;
    }
  }
  /** Slope over one tile width centred on the pixel, toward the south-east. */
  const slopeScale = hexW / (2 * D);
  const at = (px: number, py: number): number => E[(py - py0 + D) * bw + (px - px0 + D)] as number;

  // Texture lookups: texel column/row per image pixel, and the slow drift's lattice (looked up, not hashed, per pixel).
  const texCol = new Int32Array(canvas.width);
  const texRow = new Int32Array(canvas.height);
  const wrap = (v: number): number => ((Math.floor(v / TEX_SCALE) % TEX) + TEX) % TEX;
  for (let x = 0; x < canvas.width; x++) texCol[x] = wrap(px0 + x);
  for (let y = 0; y < canvas.height; y++) texRow[y] = wrap(py0 + y) * TEX;
  const dx0 = Math.floor(px0 / DRIFT);
  const dy0 = Math.floor(py0 / DRIFT);
  const dw = Math.ceil(canvas.width / DRIFT) + 2;
  const dh = Math.ceil(canvas.height / DRIFT) + 2;
  const lattice = new Float32Array(dw * dh);
  for (let j = 0; j < dh; j++) for (let i = 0; i < dw; i++) lattice[j * dw + i] = latticeValue(dx0 + i, dy0 + j);
  /** Slow brightness drift (about +-9%), value noise in planet-wide pixels. */
  const drift = (px: number, py: number): number => {
    const fx = px / DRIFT - dx0;
    const fy = py / DRIFT - dy0;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const ax = fx - ix;
    const ay = fy - iy;
    const sx = ax * ax * (3 - 2 * ax);
    const sy = ay * ay * (3 - 2 * ay);
    const k = iy * dw + ix;
    const top = (lattice[k] as number) + ((lattice[k + 1] as number) - (lattice[k] as number)) * sx;
    const bot = (lattice[k + dw] as number) + ((lattice[k + dw + 1] as number) - (lattice[k + dw] as number)) * sx;
    return 0.91 + 0.18 * (top + (bot - top) * sy);
  };

  for (let gy = ty0; gy <= ty1; gy++) {
    for (let gx = tx0; gx <= tx1; gx++) {
      const t = surface.terrainAt(gx, gy);
      if (t === null) continue; // a gap in a partly empty last row of regions
      const flat = t === Terrain.liquid || t === Terrain.lava ? 0.25 : t === Terrain.ice ? 0.6 : 1;
      const [r, g, b] = palette[t] as [number, number, number];
      const tex = textures[t] ?? null;
      // Local sea level, for depth and for how far above the water the ground lies.
      const sea = hasSea && (t === Terrain.liquid || (t === Terrain.plain && lush)) ? seaLevelAt(surface, gx, gy, water.level) : water.level;
      const c = hexToPixel(gx, gy, HEX);
      const x0 = Math.max(px0, Math.floor(c.x - hexW / 2));
      const x1 = Math.min(px1 - 1, Math.ceil(c.x + hexW / 2));
      const y0 = Math.max(py0, Math.floor(c.y - HEX));
      const y1 = Math.min(py1 - 1, Math.ceil(c.y + HEX));
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const dx = Math.abs(px + 0.5 - c.x);
          const dy = Math.abs(py + 0.5 - c.y);
          if (dx > hexW / 2 || dy + dx / SQRT3 > HEX) continue;
          const e = at(px, py);
          // Light from the north-west: slopes that rise away from it catch more light.
          const slope = (at(px + D, py) - at(px - D, py) + (at(px, py + D) - at(px, py - D))) * slopeScale;
          let shade = Math.min(1.25, Math.max(0.68, 0.72 + 0.5 * e + slope * 3 * flat));
          const i = ((py - py0) * canvas.width + (px - px0)) * 4;
          if (tex && t === Terrain.liquid && waterTex) {
            // Depth: how far the smooth elevation lies below the liquid line, from pale shallows to a dark deep. The
            // water is lit only a little by the relief, so the depth tone is what shows.
            const depth = Math.min(1, Math.max(0, (sea - e) / water.range));
            const k = Math.round(depth * (DEPTH_STEPS - 1)) * 3;
            const ti = (texRow[py - py0] as number) + (texCol[px - px0] as number);
            const s = (1 + (drift(px, py) - 1) * 0.3) * (waterTex[ti] as number) * (0.95 + 0.05 * shade);
            image.data[i] = Math.min(255, (depthColors[k] as number) * s);
            image.data[i + 1] = Math.min(255, (depthColors[k + 1] as number) * s);
            image.data[i + 2] = Math.min(255, (depthColors[k + 2] as number) * s);
          } else if (tex) {
            // Texture sampled in planet-wide pixel space (so it runs on across hexes, regions and seams), under
            // the relief shading and a slow drift that hides the repeat.
            const ti = ((texRow[py - py0] as number) + (texCol[px - px0] as number)) * 3;
            let s = drift(px, py);
            // Ice and snow: calmer relief and drift, so extended sheets stay clean and markers stand out.
            if (t === Terrain.ice) {
              s = 1 + (s - 1) * 0.5;
              shade = 1 + (shade - 1) * 0.6;
            }
            s *= shade;
            let r0 = tex[ti] as number;
            let g0 = tex[ti + 1] as number;
            let b0 = tex[ti + 2] as number;
            if (lushTex && lush && t === Terrain.plain) {
              // Plains near the water are lush meadow, easing into steppe as the ground rises.
              const w = Math.min(1, Math.max(0, (lush.to - (e - sea)) / (lush.to - lush.from)));
              if (w > 0) {
                r0 += ((lushTex[ti] as number) - r0) * w;
                g0 += ((lushTex[ti + 1] as number) - g0) * w;
                b0 += ((lushTex[ti + 2] as number) - b0) * w;
              }
            }
            image.data[i] = Math.min(255, r0 * s);
            image.data[i + 1] = Math.min(255, g0 * s);
            image.data[i + 2] = Math.min(255, b0 * s);
          } else {
            image.data[i] = Math.min(255, r * shade);
            image.data[i + 1] = Math.min(255, g * shade);
            image.data[i + 2] = Math.min(255, b * shade);
          }
          image.data[i + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

/**
 * The same terrain as faint "orbital imagery": darkened, desaturated and cooled. Unswept ground is
 * shown with this until the rover's sensors paint it in.
 */
export function buildFoggedImage(terrain: RegionImage): RegionImage {
  const canvas = newCanvas(terrain.canvas.width, terrain.canvas.height);
  const out: RegionImage = { ...terrain, canvas };
  const ctx = canvas.getContext("2d");
  if (!ctx) return out;
  ctx.drawImage(terrain.canvas, 0, 0);
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
  return out;
}

/** Full-color terrain where the rover has swept (`explored`, planet-wide tiles), fogged imagery everywhere else. */
export function composePainted(
  terrain: RegionImage,
  fogged: RegionImage,
  surface: BodySurface,
  explored: (gx: number, gy: number) => boolean,
): RegionImage {
  const canvas = newCanvas(terrain.canvas.width, terrain.canvas.height);
  const out: RegionImage = { ...terrain, canvas };
  const ctx = canvas.getContext("2d");
  if (!ctx) return out;
  ctx.drawImage(fogged.canvas, 0, 0);
  // All swept hexes as one clip (a hair oversized so neighbours leave no seams), then the colour image through it.
  const { x0, y0, x1, y1 } = tileRange(surface, terrain.region);
  ctx.beginPath();
  let any = false;
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      if (!explored(gx, gy)) continue;
      const c = hexToPixel(gx, gy, HEX);
      hexPath(ctx, c.x - terrain.x, c.y - terrain.y, HEX + 0.6);
      any = true;
    }
  }
  if (any) {
    ctx.clip();
    ctx.drawImage(terrain.canvas, 0, 0);
  }
  return out;
}

interface CacheEntry {
  terrain: RegionImage;
  fogged: RegionImage;
  painted: RegionImage | null;
  /** The fog state `painted` was composed for. */
  paintedSig: string;
  /** Whether the terrain image was drawn with textures (it is rebuilt if they finish loading later). */
  textured: boolean;
}

/** Most region images kept at once (three canvases each, a few MB apiece). */
const CACHE_LIMIT = 16;

/**
 * Region images for one world's surface, built on demand and kept (least recently used dropped first).
 * Building a region is slow-ish, so callers get a per-frame budget: regions past it come back null and
 * are built on a later frame.
 */
export class TerrainCache {
  private readonly entries = new Map<number, CacheEntry>();
  private budget = 0;

  constructor(
    readonly surface: BodySurface,
    readonly kind: BodyKind,
  ) {}

  /** Call once per frame: allows `builds` new regions to be rendered this frame. */
  beginFrame(builds = 1): void {
    this.budget = builds;
  }

  private entry(region: number, force: boolean): CacheEntry | null {
    let e = this.entries.get(region);
    if (e && !e.textured && texturesReady() && (force || this.budget > 0)) {
      this.entries.delete(region); // built before the textures arrived: draw it again with them
      e = undefined;
    }
    if (e) {
      // Refresh its place in the LRU order.
      this.entries.delete(region);
      this.entries.set(region, e);
      return e;
    }
    if (!force && this.budget <= 0) return null;
    this.budget--;
    const terrain = buildTerrainImage(this.surface, region, this.kind);
    e = { terrain, fogged: buildFoggedImage(terrain), painted: null, paintedSig: "", textured: texturesReady() };
    this.entries.set(region, e);
    while (this.entries.size > CACHE_LIMIT) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return e;
  }

  /** Full-colour terrain of a region (null if it isn't built yet and the frame's budget is spent). */
  terrain(region: number, force = false): RegionImage | null {
    return this.entry(region, force)?.terrain ?? null;
  }

  /** The fogged/painted map of a region for the fog state `sig` (recomposed only when `sig` changes). */
  painted(region: number, sig: string, explored: (gx: number, gy: number) => boolean, force = false): RegionImage | null {
    const e = this.entry(region, force);
    if (!e) return null;
    if (!e.painted || e.paintedSig !== sig) {
      e.painted = composePainted(e.terrain, e.fogged, this.surface, explored);
      e.paintedSig = sig;
    }
    return e.painted;
  }
}

let shared: TerrainCache | null = null;

/** The cache for this surface (a new world or body starts a fresh one). */
export function terrainCache(surface: BodySurface, kind: BodyKind): TerrainCache {
  if (!shared || shared.surface !== surface || shared.kind !== kind) shared = new TerrainCache(surface, kind);
  return shared;
}
