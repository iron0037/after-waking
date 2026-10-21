/**
 * Deterministic randomness.
 *
 * World generation never stores random state: every star, planet and surface region is
 * regenerated from `hashSeed(galaxySeed, ...path)`, so the same seed always yields the same
 * universe. Gameplay randomness (market drift, events) uses an Rng whose state lives in the
 * save file.
 */

/** Hash any mix of strings and numbers into a well-mixed 32-bit seed (FNV-1a + avalanche). */
export function hashSeed(...parts: readonly (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x1f; // separator, so ("ab","c") != ("a","bc")
    h = Math.imul(h, 0x01000193);
  }
  return avalanche(h);
}

function avalanche(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** mulberry32: small, fast, and good enough for games. */
export class Rng {
  state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick on empty array");
    return items[Math.floor(this.next() * items.length)] as T;
  }

  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
    if (total <= 0) throw new Error("Rng.weighted with no positive weights");
    let roll = this.next() * total;
    for (const [value, w] of entries) {
      roll -= Math.max(0, w);
      if (roll < 0) return value;
    }
    return entries[entries.length - 1]![0];
  }

  /** Normal distribution via Box-Muller. */
  gaussian(mean = 0, sd = 1): number {
    const u = 1 - this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

/** A fresh generator for a stable world-generation path, e.g. rngFor(seed, "system", id). */
export function rngFor(...parts: readonly (string | number)[]): Rng {
  return new Rng(hashSeed(...parts));
}
