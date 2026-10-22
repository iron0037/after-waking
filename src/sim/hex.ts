/**
 * Hex geometry for planet surfaces. Pointy-top hexes in "odd-r" offset layout: tiles are
 * stored as (x, y) in a width × height array like before, and every odd row is shifted half a
 * hex to the right. All grid geometry (neighbors, distance, rings, pixel layout) lives here, so
 * nothing else needs to know the grid isn't square.
 *
 * Keyboard scheme (standard for pointy-top): Q = up-left, E = up-right, A = left, D = right,
 * Z = down-left, C = down-right.
 */
import type { Vec2 } from "./units";

export type HexDir = "nw" | "ne" | "w" | "e" | "sw" | "se";

export const HEX_DIRS: readonly HexDir[] = ["e", "ne", "nw", "w", "sw", "se"];

/** Offsets for even and odd rows (odd-r layout). */
const NEIGHBOR_OFFSETS: Record<HexDir, readonly [readonly [number, number], readonly [number, number]]> = {
  //       even row      odd row
  e: [[1, 0], [1, 0]],
  w: [[-1, 0], [-1, 0]],
  ne: [[0, -1], [1, -1]],
  nw: [[-1, -1], [0, -1]],
  se: [[0, 1], [1, 1]],
  sw: [[-1, 1], [0, 1]],
};

export const KEY_TO_DIR: Readonly<Record<string, HexDir>> = {
  q: "nw",
  e: "ne",
  a: "w",
  d: "e",
  z: "sw",
  c: "se",
};

/** The tile one step from (x, y) in direction `dir` (may be off the map). */
export function step(x: number, y: number, dir: HexDir): Vec2 {
  const [dx, dy] = NEIGHBOR_OFFSETS[dir][y & 1] as readonly [number, number];
  return { x: x + dx, y: y + dy };
}

/** The six neighbors of (x, y), possibly off the map. */
export function neighbors(x: number, y: number): Vec2[] {
  return HEX_DIRS.map((d) => step(x, y, d));
}

interface Cube {
  q: number;
  r: number;
  s: number;
}

export function toCube(x: number, y: number): Cube {
  const q = x - (y - (y & 1)) / 2;
  return { q, r: y, s: -q - y };
}

export function fromCube(c: Cube): Vec2 {
  // "+ 0" normalizes -0 (from Math.round) to 0.
  return { x: c.q + (c.r - (c.r & 1)) / 2 + 0, y: c.r + 0 };
}

/** Steps between two tiles (hex distance). */
export function hexDistance(a: Vec2, b: Vec2): number {
  const ca = toCube(a.x, a.y);
  const cb = toCube(b.x, b.y);
  return Math.max(Math.abs(ca.q - cb.q), Math.abs(ca.r - cb.r), Math.abs(ca.s - cb.s));
}

/** Every tile within `radius` steps of the center (a hex disk), possibly off the map. */
export function disk(center: Vec2, radius: number): Vec2[] {
  const c = toCube(center.x, center.y);
  const out: Vec2[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      out.push(fromCube({ q: c.q + dq, r: c.r + dr, s: c.s - dq - dr }));
    }
  }
  return out;
}

/** Tiles at exactly `radius` steps, in order around the ring (radius 0 is the center). */
export function ring(center: Vec2, radius: number): Vec2[] {
  if (radius === 0) return [{ ...center }];
  return disk(center, radius).filter((t) => hexDistance(t, center) === radius);
}

/** The direction of a single step from `from` to an adjacent `to`, or null if not adjacent. */
export function dirBetween(from: Vec2, to: Vec2): HexDir | null {
  for (const d of HEX_DIRS) {
    const n = step(from.x, from.y, d);
    if (n.x === to.x && n.y === to.y) return d;
  }
  return null;
}

/** Facing angle in degrees (0 = east, counter-clockwise positive is avoided: screen y grows down). */
export const DIR_ANGLE: Record<HexDir, number> = { e: 0, se: 60, sw: 120, w: 180, nw: 240, ne: 300 };

// --- layout (pure math, used by the UI to draw and pick hexes) ----------------------------

const SQRT3 = Math.sqrt(3);

/** Width and height of one pointy-top hex whose circumradius is `size`. */
export function hexExtent(size: number): { w: number; h: number } {
  return { w: SQRT3 * size, h: 2 * size };
}

/** Pixel center of tile (x, y) for hex circumradius `size`, with tile (0,0)'s center at (w/2, size). */
export function hexToPixel(x: number, y: number, size: number): Vec2 {
  const w = SQRT3 * size;
  return { x: w * (x + 0.5 * (y & 1)) + w / 2, y: 1.5 * size * y + size };
}

/** Total pixel size of a cols × rows map. */
export function mapPixelSize(cols: number, rows: number, size: number): { w: number; h: number } {
  const w = SQRT3 * size;
  return { w: w * cols + w / 2, h: 1.5 * size * (rows - 1) + 2 * size };
}

/** The tile under pixel (px, py), inverse of hexToPixel (may be off the map). */
export function pixelToHex(px: number, py: number, size: number): Vec2 {
  const w = SQRT3 * size;
  const x = px - w / 2;
  const y = py - size;
  // Axial (pointy-top) fractional coordinates, then cube rounding.
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(-q - r);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - (-q - r));
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return fromCube({ q: rq, r: rr, s: -rq - rr });
}

/** The six corner points of the hex at pixel center (cx, cy), for drawing. */
export function hexCorners(cx: number, cy: number, size: number): Vec2[] {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return { x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) };
  });
}

/** Where a tile sits in continuous space (unit spacing), for sampling noise without row skew. */
export function hexWorldPos(x: number, y: number): Vec2 {
  return { x: x + 0.5 * (y & 1), y: y * (SQRT3 / 2) };
}
