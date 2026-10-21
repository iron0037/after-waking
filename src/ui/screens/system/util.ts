/** Small formatting and color helpers for the system screen. */
import { KIND_LABEL, type BodyKind, type BodyProgress, type Contract, type GameState, contractTargetsByBody } from "../../../sim";

export const FONT = (px: number, weight = "normal") =>
  `${weight} ${px}px "Cascadia Mono", "JetBrains Mono", Consolas, "Courier New", monospace`;

export function fmtAU(au: number): string {
  if (au < 0.1) return au.toFixed(3);
  if (au < 10) return au.toFixed(2);
  if (au < 100) return au.toFixed(1);
  return Math.round(au).toString();
}

/** "Terrestrial" rather than "Terrestrial world", for tight spaces. */
export function shortKind(kind: BodyKind): string {
  return KIND_LABEL[kind].replace(" world", "");
}

/** Two significant figures: estimates shouldn't look more exact than they are. */
export function roughCredits(n: number): string {
  if (n < 100) return Math.round(n).toLocaleString();
  const digits = Math.floor(Math.log10(n)) + 1;
  const f = 10 ** (digits - 2);
  return (Math.round(n / f) * f).toLocaleString();
}

function parse(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parse(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const f = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${f(ar, br)},${f(ag, bg)},${f(ab, bb)})`;
}

/** Lighten (amt > 0) or darken (amt < 0) a hex color. */
export function shade(hex: string, amt: number): string {
  return amt >= 0 ? mix(hex, "#ffffff", amt) : mix(hex, "#000000", -amt);
}

/** Active contracts that still have work at each body: specimen jobs name one world, survey jobs name several. */
export function contractTargets(state: GameState): Map<string, Contract[]> {
  return contractTargetsByBody(state);
}

/** "3/26 · 12%" for a world with a surface, "—" otherwise. */
export function progressLabel(p: BodyProgress): string {
  if (p.regions === 0) return "—";
  return `${p.regionsVisited}/${p.regions} · ${Math.round(p.explored * 100)}%`;
}
