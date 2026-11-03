/**
 * What the rover and boat carry against creatures (AW-217). The stock stun prod comes with every rover;
 * the rest are fitted in the yard (src/data/ship.ts). Stun weapons and lasers wear a creature down (it's always
 * taken alive); nets take it outright, but hold a hunter only once it's worn down.
 */
export interface VehicleWeapon {
  id: string;
  name: string;
  kind: "stun" | "laser" | "net";
  /** Hexes. */
  range: number;
  /** Stunning per hit (nets: none). */
  damage: number;
  /** Rover energy per shot. */
  energy: number;
  /** Chance to hit (stun and laser) or to hold a small creature (nets). */
  hit: number;
}

export const VEHICLE_WEAPONS: Record<string, VehicleWeapon> = {
  "stun-prod": { id: "stun-prod", name: "stun prod", kind: "stun", range: 1, damage: 4, energy: 0.6, hit: 0.75 },
  "stun-gun": { id: "stun-gun", name: "stun gun", kind: "stun", range: 3, damage: 8, energy: 1, hit: 0.7 },
  "rover-laser": { id: "rover-laser", name: "laser", kind: "laser", range: 4, damage: 14, energy: 2.2, hit: 0.75 },
  "net-launcher": { id: "net-launcher", name: "net launcher", kind: "net", range: 2, damage: 0, energy: 0.4, hit: 0.55 },
  "tangle-cannon": { id: "tangle-cannon", name: "tangle cannon", kind: "net", range: 3, damage: 0, energy: 0.6, hit: 0.8 },
};
