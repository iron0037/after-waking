/** Rover routing on a hex region map: cheapest path by travel time (Dijkstra over six neighbours). */
import { neighbors } from "./hex";
import { TERRAIN_INFO, type RegionMap, type Terrain } from "./surface";
import type { Vec2 } from "./units";

export interface PathStep extends Vec2 {
  minutes: number;
  energy: number;
}

export function canEnter(map: RegionMap, x: number, y: number, canClimb: boolean): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const passable = TERRAIN_INFO[map.terrain[y * map.width + x] as Terrain].passable;
  return passable === "yes" || (passable === "climb" && canClimb);
}

export function stepCost(map: RegionMap, x: number, y: number): { minutes: number; energy: number } {
  const info = TERRAIN_INFO[map.terrain[y * map.width + x] as Terrain];
  return { minutes: info.minutes, energy: info.energy };
}

/** Path from `from` (exclusive) to `to` (inclusive), or null if unreachable. */
export function findPath(map: RegionMap, from: Vec2, to: Vec2, canClimb: boolean): PathStep[] | null {
  if (!canEnter(map, to.x, to.y, canClimb)) return null;
  const w = map.width;
  const n = w * map.height;
  const cost = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const start = from.y * w + from.x;
  const goal = to.y * w + to.x;
  cost[start] = 0;
  const heap = new MinHeap();
  heap.push(start, 0);

  while (heap.size > 0) {
    const [node, c] = heap.pop();
    if (node === goal) break;
    if (c > (cost[node] as number)) continue;
    const x = node % w;
    const y = (node - x) / w;
    for (const { x: nx, y: ny } of neighbors(x, y)) {
      if (!canEnter(map, nx, ny, canClimb)) continue;
      const next = ny * w + nx;
      const nc = c + stepCost(map, nx, ny).minutes;
      if (nc < (cost[next] as number)) {
        cost[next] = nc;
        prev[next] = node;
        heap.push(next, nc);
      }
    }
  }

  if (goal !== start && prev[goal] === -1) return null;
  const steps: PathStep[] = [];
  for (let node = goal; node !== start; node = prev[node] as number) {
    const x = node % w;
    const y = (node - x) / w;
    steps.push({ x, y, ...stepCost(map, x, y) });
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
