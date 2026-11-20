/**
 * Creature calls on the surface (AW-31): now and then, a creature near the rover calls out. The calls are
 * Stable Audio Open renders (tools/audio/sfx.py, mastered by tools/audio/master_sfx.py), one per kind of
 * creature. Pure, so it's tested without a browser; SurfaceView plays what it picks.
 */
import type { CreatureEntry } from "../../data/creatures";

export type CreatureCall = "creature-chirp" | "creature-bellow" | "creature-growl" | "creature-clicks" | "creature-sea";

/** Which call a species makes: sea life moans, hunters growl, big grazers bellow, skittish things click, the rest chirp. */
export function creatureCall(entry: Pick<CreatureEntry, "aquatic" | "temperament" | "size">): CreatureCall {
  if (entry.aquatic) return "creature-sea";
  if (entry.temperament === "hostile") return "creature-growl";
  if (entry.size === 2) return "creature-bellow";
  if (entry.temperament === "skittish") return "creature-clicks";
  return "creature-chirp";
}

/** Calls carry this far (hexes); nearer is louder. */
export const CALL_RANGE = 9;

export interface CallPick {
  call: CreatureCall;
  /** 0-1, by distance. */
  gain: number;
  /** -1 (left) to 1 (right), by where it is on the map. */
  pan: number;
}

/**
 * One call from the creatures in earshot of the listener (the rover, or the ship), or null if none is.
 * Nearer creatures are likelier to be heard. `distance` is the map's hex distance; `rand` returns 0-1.
 */
export function pickCreatureCall<C extends { x: number; y: number; down: boolean; entry: Pick<CreatureEntry, "aquatic" | "temperament" | "size"> }>(
  creatures: readonly C[],
  listener: { x: number; y: number },
  distance: (a: { x: number; y: number }, b: { x: number; y: number }) => number,
  rand: () => number,
): CallPick | null {
  const near = creatures
    .filter((c) => !c.down)
    .map((c) => ({ c, d: distance(c, listener) }))
    .filter(({ d }) => d <= CALL_RANGE);
  if (near.length === 0) return null;
  const weights = near.map(({ d }) => CALL_RANGE + 1 - d);
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  let i = 0;
  while (i < near.length - 1 && r >= (weights[i] as number)) r -= weights[i++] as number;
  const { c, d } = near[i] as (typeof near)[number];
  return {
    call: creatureCall(c.entry),
    gain: Math.max(0.2, 1 - Math.max(0, d - 1) / CALL_RANGE),
    pan: Math.max(-1, Math.min(1, (c.x - listener.x) / 8)),
  };
}
