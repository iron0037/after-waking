/**
 * The pixel work behind the surface map's terrain images: every hex filled with its terrain colour and hillshaded
 * relief, in planet-wide "HEX pixel" space (hexToPixel(gx, gy, HEX)). DOM-free, so it runs on the main thread (the
 * synchronous fallback) or inside the terrain worker (terrainWorker.ts) with identical results.
 *
 * Each image covers its region plus a one-tile margin borrowed from the neighbours, and sits on whole-pixel offsets
 * of that shared space, so neighbouring images overlap pixel for pixel and the seams between regions don't show.
 */
import type { BodyKind, BodySurface } from "../../../sim";
import { hexToPixel, REGION_SIZE, Terrain } from "../../../sim";
import { TERRAIN_COLORS } from "../../palette";
import {
  DEPTH_STEPS,
  depthGradient,
  liquidRule,
  lushRule,
  lushTexture,
  TEX,
  TEX_SCALE,
  tintedTexture,
  waterDetail,
} from "./terrainTextures";

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

/** The planet-wide tile range an image of `region` covers (region plus margin, clipped to the surface). */
export function tileRange(surface: BodySurface, region: number): { x0: number; y0: number; x1: number; y1: number } {
  const o = surface.origin(region);
  return {
    x0: Math.max(0, o.x - MARGIN),
    y0: Math.max(0, o.y - MARGIN),
    x1: Math.min(surface.width - 1, o.x + REGION_SIZE - 1 + MARGIN),
    y1: Math.min(surface.height - 1, o.y + REGION_SIZE - 1 + MARGIN),
  };
}

/** One region's pixels (RGBA, row-major); (x, y) is the top-left corner in planet-wide HEX pixel space (whole pixels). */
export interface RegionPixels {
  x: number;
  y: number;
  region: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function computeTerrainPixels(surface: BodySurface, region: number, kind: BodyKind): RegionPixels {
  const map = surface.region(region);
  const o = surface.origin(region);
  const { x0: tx0, y0: ty0, x1: tx1, y1: ty1 } = tileRange(surface, region);
  const hexW = SQRT3 * HEX;
  // Pixel bounds of the covered tiles in planet-wide HEX space, snapped outward to whole pixels.
  const px0 = Math.floor(hexW * tx0);
  const py0 = Math.floor(1.5 * HEX * ty0);
  const px1 = Math.ceil(hexW * (tx1 + 1.5));
  const py1 = Math.ceil(1.5 * HEX * ty1 + 2 * HEX);
  const width = Math.max(1, px1 - px0);
  const height = Math.max(1, py1 - py0);
  const data = new Uint8ClampedArray(width * height * 4);
  const out: RegionPixels = { x: px0, y: py0, region, width, height, data };
  const palette = TERRAIN_COLORS[kind].map(parseHex);
  const textures = [0, 1, 2, 3, 4, 5].map((t) => tintedTexture(kind, t));
  // Verdant plains (steppe blends to lush meadow near the water) and liquid shaded by depth.
  const lush = lushRule({ kind, life: surface.body.life, tempC: surface.body.tempC });
  const lushTex = lush ? lushTexture(kind) : null;
  const water = liquidRule(kind);
  const depthColors = depthGradient(kind);
  const waterTex = waterDetail();
  const hasSea = kind === "terrestrial" || kind === "ocean";
  const image = { data };

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
  // Sample a per-tile grid as a smooth field, once per pixel (with a pad of half a tile for the slope), on a grid
  // `STEP` pixels apart filled in bilinearly: the field is smooth, and this is the slow part. Tile (x, y) sits at
  // x + half a tile on odd rows, and y * sqrt(3)/2, in unit-spacing world space: linear along each of the two
  // nearest rows, then linear between them.
  const D = Math.round(hexW / 2);
  const bw = px1 - px0 + 2 * D;
  const bh = py1 - py0 + 2 * D;
  const STEP = 2;
  const cw = Math.ceil(bw / STEP) + 2;
  const ch = Math.ceil(bh / STEP) + 2;
  const smoothField = (grid: Float32Array): Float32Array => {
    const tile = (gx: number, gy: number): number =>
      grid[Math.min(span - 1, Math.max(0, gy - ey0)) * span + Math.min(span - 1, Math.max(0, gx - ex0))] as number;
    const rowVal = (u: number, row: number): number => {
      const fx = u - 0.5 * (row & 1);
      const x0 = Math.floor(fx);
      const f = fx - x0;
      const a = tile(x0, row);
      return a + (tile(x0 + 1, row) - a) * f;
    };
    const at2 = (u: number, v: number): number => {
      const rf = v / ROW_H;
      const r0 = Math.floor(rf);
      const a = rowVal(u, r0);
      return a + (rowVal(u, r0 + 1) - a) * (rf - r0);
    };
    const coarse = new Float32Array(cw * ch);
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        const px = px0 - D + i * STEP;
        const py = py0 - D + j * STEP;
        coarse[j * cw + i] = at2((px + 0.5 - hexW / 2) / hexW, (py + 0.5 - HEX) / hexW);
      }
    }
    const F = new Float32Array(bw * bh);
    for (let y = 0; y < bh; y++) {
      const j = Math.floor(y / STEP);
      const fy = (y - j * STEP) / STEP;
      for (let x = 0; x < bw; x++) {
        const i = Math.floor(x / STEP);
        const fx = (x - i * STEP) / STEP;
        const k = j * cw + i;
        const top = (coarse[k] as number) + ((coarse[k + 1] as number) - (coarse[k] as number)) * fx;
        const bot = (coarse[k + cw] as number) + ((coarse[k + cw + 1] as number) - (coarse[k + cw] as number)) * fx;
        F[y * bw + x] = top + (bot - top) * fy;
      }
    }
    return F;
  };
  const E = smoothField(elevGrid);
  // On ice worlds the rocky ground is a second and third smooth field (1 on rough or mountain tiles, 0 elsewhere),
  // so rocks and ranges fade out of the ice instead of stopping at a hex edge.
  let RF: Float32Array | null = null;
  let MF: Float32Array | null = null;
  if (kind === "ice") {
    const rockGrid = new Float32Array(span * span);
    const mountGrid = new Float32Array(span * span);
    for (let j = 0; j < span; j++) {
      for (let i = 0; i < span; i++) {
        const t = surface.terrainAt(Math.min(surface.width - 1, Math.max(0, ex0 + i)), Math.min(surface.height - 1, Math.max(0, ey0 + j)));
        if (t === Terrain.rough || t === Terrain.mountain) rockGrid[j * span + i] = 1;
        if (t === Terrain.mountain) mountGrid[j * span + i] = 1;
      }
    }
    RF = smoothField(rockGrid);
    MF = smoothField(mountGrid);
  }
  /** Slope over one tile width centred on the pixel, toward the south-east. */
  const slopeScale = hexW / (2 * D);
  const at = (px: number, py: number): number => E[(py - py0 + D) * bw + (px - px0 + D)] as number;

  // Texture lookups: texel column/row per image pixel, and the slow drift's lattice (looked up, not hashed, per pixel).
  const texCol = new Int32Array(width);
  const texRow = new Int32Array(height);
  const wrap = (v: number): number => ((Math.floor(v / TEX_SCALE) % TEX) + TEX) % TEX;
  for (let x = 0; x < width; x++) texCol[x] = wrap(px0 + x);
  for (let y = 0; y < height; y++) texRow[y] = wrap(py0 + y) * TEX;
  const dx0 = Math.floor(px0 / DRIFT);
  const dy0 = Math.floor(py0 / DRIFT);
  const dw = Math.ceil(width / DRIFT) + 2;
  const dh = Math.ceil(height / DRIFT) + 2;
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

  /** Short-wave value noise in [0, 1) (about 14 and 7 pixels, or 8 and 4 for the fine grain), to rough up the edge where rock fades into ice. */
  const edgeNoise = (px: number, py: number, salt: number, wave = 8): number => {
    let sum = 0;
    for (let o = 0; o < 2; o++) {
      const f = o === 0 ? 1 / wave : 2 / wave;
      const fx = px * f + salt * 17.3;
      const fy = py * f + salt * 9.1;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const ax = fx - ix;
      const ay = fy - iy;
      const sx = ax * ax * (3 - 2 * ax);
      const sy = ay * ay * (3 - 2 * ay);
      const a = latticeValue(ix + salt * 101, iy);
      const b = latticeValue(ix + 1 + salt * 101, iy);
      const c = latticeValue(ix + salt * 101, iy + 1);
      const d = latticeValue(ix + 1 + salt * 101, iy + 1);
      const v = a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sy;
      sum += o === 0 ? v * 0.65 : v * 0.35;
    }
    return sum;
  };
  /** Rock's share (0..1) of a pixel, from the smooth rock field `f`: a ragged edge some 15 pixels wide. */
  const rockShare = (field: Float32Array, fi: number, px: number, py: number, salt: number): number => {
    const f = field[fi] as number;
    if (f <= 0 || f >= 1) return f;
    // Look up the field a little to one side (a different way for each pixel, drifting smoothly), so the edge wanders
    // instead of following the hex outlines; then fade over a stretch of pixels with a bit of grain.
    const wx = Math.round((edgeNoise(px, py, salt + 4, 14) - 0.5) * 16);
    const wy = Math.round((edgeNoise(px, py, salt + 7, 14) - 0.5) * 16);
    const warped = field[Math.min(bw * bh - 1, Math.max(0, fi + wy * bw + wx))] as number;
    const g = (f + warped) / 2;
    const u = Math.min(1, Math.max(0, (g + (edgeNoise(px, py, salt) - 0.5) * 0.3 - 0.22) / 0.5));
    return u * u * (3 - 2 * u);
  };
  const iceTex = textures[Terrain.ice] ?? null;
  const screeTex = textures[Terrain.rough] ?? null;
  const peakTex = textures[Terrain.mountain] ?? null;
  const iceWorld = RF !== null && MF !== null && iceTex !== null && screeTex !== null && peakTex !== null;

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
          const i = ((py - py0) * width + (px - px0)) * 4;
          if (iceWorld && RF && MF && iceTex && screeTex && peakTex && (t === Terrain.ice || t === Terrain.rough || t === Terrain.mountain)) {
            // Ice world: sheets, scree and ranges blended by smooth fields. Rock keeps full relief (mountains extra, so
            // ridges read); the sheets stay calm.
            const fi = (py - py0 + D) * bw + (px - px0 + D);
            const w = rockShare(RF, fi, px, py, 1);
            const wm = w > 0 ? rockShare(MF, fi, px, py, 2) : 0;
            const relief = (0.6 + (0.4 + 1.5 * wm) * w) * 3;
            const lo = 0.68 - 0.08 * wm * w;
            const hi = 1.25 + 0.18 * wm * w;
            let sh = Math.min(hi, Math.max(lo, 0.72 + 0.5 * e + slope * relief));
            sh = 1 + (sh - 1) * (0.6 + 0.4 * w);
            const s = (1 + (drift(px, py) - 1) * (0.5 + 0.5 * w)) * sh;
            const ti = ((texRow[py - py0] as number) + (texCol[px - px0] as number)) * 3;
            for (let c = 0; c < 3; c++) {
              const ice = iceTex[ti + c] as number;
              let v = ice;
              if (w > 0) {
                const sc = screeTex[ti + c] as number;
                const pk = peakTex[ti + c] as number;
                v = ice + (sc + (pk - sc) * wm - ice) * w;
              }
              image.data[i + c] = Math.min(255, v * s);
            }
            image.data[i + 3] = 255;
            continue;
          }
          let shade = Math.min(1.25, Math.max(0.68, 0.72 + 0.5 * e + slope * 3 * flat));
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
  return out;
}

/**
 * The same terrain as faint "orbital imagery": darkened, desaturated and cooled. Unswept ground is
 * shown with this until the rover's sensors paint it in.
 */
export function computeFoggedPixels(terrain: RegionPixels): RegionPixels {
  const d = new Uint8ClampedArray(terrain.data);
  const out: RegionPixels = { ...terrain, data: d };
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
  return out;
}
