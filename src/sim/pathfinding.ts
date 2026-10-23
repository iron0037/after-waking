/**
 * Rover routing on hex terrain: cheapest path by travel time (A* over six neighbours). Works on
 * any TileSource, so routes run across region borders on the planet-wide surface.
 */
import type { TileSource } from "./bodysurface";
import { hexDistance, neighbors } from "./hex";
import { Terrain, TERRAIN_INFO, type RegionMap } from "./surface";
import type { Vec2 } from "./units";

/** What the rover can cross: climbing gear for mountains, and (Ground Navigator) rough ground at plain-ground cost. */
export interface Mobility {
  canClimb: boolean;
  roughAsPlain?: boolean;
}

function mobilityOf(m: boolean | Mobility): Mobility {
  return typeof m === "boolean" ? { canClimb: m } : m;
}

export interface PathStep extends Vec2 {
  minutes: number;
  energy: number;
}

/** Cheapest possible step (plain ground), for an admissible A* heuristic. */
const MIN_STEP_MINUTES = Math.min(...Object.values(TERRAIN_INFO).filter((t) => t.minutes > 0).map((t) => t.minutes));
/** Stop searching after this many expansions: far beyond any rover's range. */
const MAX_EXPANSIONS = 60_000;

/** A single region's map as a tile source (its own local coordinates). */
export function regionSource(map: RegionMap): TileSource {
  return {
    width: map.width,
    height: map.height,
    terrainAt: (x, y) => (x < 0 || y < 0 || x >= map.width || y >= map.height ? null : (map.terrain[y * map.width + x] as Terrain)),
  };
}

function source(tiles: TileSource | RegionMap): TileSource {
  return "terrainAt" in tiles ? tiles : regionSource(tiles);
}

export function canEnter(tiles: TileSource | RegionMap, x: number, y: number, mobility: boolean | Mobility): boolean {
  const t = source(tiles).terrainAt(x, y);
  if (t === null) return false;
  const passable = TERRAIN_INFO[t].passable;
  return passable === "yes" || (passable === "climb" && mobilityOf(mobility).canClimb);
}

export function stepCost(tiles: TileSource | RegionMap, x: number, y: number, mobility: boolean | Mobility = false): { minutes: number; energy: number } {
  let t = (source(tiles).terrainAt(x, y) ?? 0) as Terrain;
  if (t === Terrain.rough && mobilityOf(mobility).roughAsPlain) t = Terrain.plain;
  const info = TERRAIN_INFO[t];
  return { minutes: info.minutes, energy: info.energy };
}

/** Path from `from` (exclusive) to `to` (inclusive), or null if unreachable. */
export function findPath(tiles: TileSource | RegionMap, from: Vec2, to: Vec2, mobility: boolean | Mobility): PathStep[] | null {
  const canClimb = mobility;
  const src = source(tiles);
  if (!canEnter(src, to.x, to.y, canClimb)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  const w = src.width;
  const keyOf = (x: number, y: number) => y * w + x;
  const start = keyOf(from.x, from.y);
  const goal = keyOf(to.x, to.y);
  const cost = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, number>();
  const heap = new MinHeap();
  heap.push(start, hexDistance(from, to) * MIN_STEP_MINUTES);

  let expansions = 0;
  while (heap.size > 0 && expansions++ < MAX_EXPANSIONS) {
    const [node] = heap.pop();
    if (node === goal) break;
    const c = cost.get(node) as number;
    const x = node % w;
    const y = (node - x) / w;
    for (const n of neighbors(x, y)) {
      if (!canEnter(src, n.x, n.y, canClimb)) continue;
      const next = keyOf(n.x, n.y);
      const nc = c + stepCost(src, n.x, n.y, mobility).minutes;
      if (nc < (cost.get(next) ?? Infinity)) {
        cost.set(next, nc);
        prev.set(next, node);
        heap.push(next, nc + hexDistance(n, to) * MIN_STEP_MINUTES);
      }
    }
  }

  if (!prev.has(goal)) return null;
  const steps: PathStep[] = [];
  for (let node = goal; node !== start; node = prev.get(node) as number) {
    const x = node % w;
    const y = (node - x) / w;
    steps.push({ x, y, ...stepCost(src, x, y, mobility) });
  }
  return steps.reverse();
}

class MinHeap {
  private nodes: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, key: number): void {
    this.nodes.push(node);
    this.keys.push(key);
    let i = this.nodes.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.keys[parent] as number) <= key) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.nodes[0] as number, this.keys[0] as number];
    const lastNode = this.nodes.pop() as number;
    const lastKey = this.keys.pop() as number;
    if (this.nodes.length > 0) {
      this.nodes[0] = lastNode;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.nodes.length && (this.keys[l] as number) < (this.keys[m] as number)) m = l;
        if (r < this.nodes.length && (this.keys[r] as number) < (this.keys[m] as number)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.nodes[a], this.nodes[b]] = [this.nodes[b] as number, this.nodes[a] as number];
    [this.keys[a], this.keys[b]] = [this.keys[b] as number, this.keys[a] as number];
  }
}
