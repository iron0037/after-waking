/** Physical constants and game-time units. Game time is measured in minutes. */

export const C_KM_S = 299_792.458;
export const AU_KM = 149_597_870.7;
/** Light travel time across 1 AU, in minutes (~8.32). */
export const AU_LIGHT_MINUTES = AU_KM / C_KM_S / 60;

export const MINUTE = 1;
export const HOUR = 60;
export const DAY = 24 * HOUR;
export const YEAR = 365 * DAY;

/** Minutes to cross `distanceAU` at `speedC` (fraction of light speed). */
export function travelMinutes(distanceAU: number, speedC: number): number {
  if (speedC <= 0) throw new Error("speed must be positive");
  return (distanceAU * AU_LIGHT_MINUTES) / speedC;
}

export interface Vec2 {
  x: number;
  y: number;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function round(v: number, places = 0): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}
