/**
 * In-system burn paths. A straight line unless it would pass too close to the star; then the
 * ship swings around it: a tangent line in, an arc at a safe distance, a tangent line out.
 * The star sits at the origin. Distances are in AU.
 */
import type { Vec2 } from "./units";

/** How close a burn may pass to the star: 0.12 AU, or less when a world orbits closer than that. */
export function starKeepOut(from: Vec2, to: Vec2): number {
  return Math.min(0.12, 0.6 * Math.min(Math.hypot(from.x, from.y), Math.hypot(to.x, to.y)));
}

export interface BurnPath {
  /** Length of the path in AU. */
  length: number;
  /** True when the path bends around the star. */
  bends: boolean;
  /** The point a fraction `p` (0..1) of the way along the path. */
  at(p: number): Vec2;
}

const TAU = Math.PI * 2;

export function burnPath(from: Vec2, to: Vec2): BurnPath {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const straight = Math.hypot(dx, dy);
  const line: BurnPath = { length: straight, bends: false, at: (p) => ({ x: from.x + dx * p, y: from.y + dy * p }) };
  const r = starKeepOut(from, to);
  if (straight < 1e-9 || r <= 0) return line;

  // Closest approach of the straight segment to the star.
  const t = Math.max(0, Math.min(1, -(from.x * dx + from.y * dy) / (straight * straight)));
  if (Math.hypot(from.x + dx * t, from.y + dy * t) >= r) return line;

  const dA = Math.hypot(from.x, from.y);
  const dB = Math.hypot(to.x, to.y);
  const thA = Math.atan2(from.y, from.x);
  const thB = Math.atan2(to.y, to.x);
  const aA = Math.acos(r / dA);
  const aB = Math.acos(r / dB);
  // Go around the side the target lies toward (counterclockwise when it's ahead that way).
  const s = from.x * to.y - from.y * to.x >= 0 ? 1 : -1;
  const t1 = thA + s * aA;
  const t2 = thB - s * aB;
  let sweep = s * (t2 - t1);
  sweep = ((sweep % TAU) + TAU) % TAU;
  const inLen = Math.sqrt(Math.max(0, dA * dA - r * r));
  const arcLen = r * sweep;
  const outLen = Math.sqrt(Math.max(0, dB * dB - r * r));
  const length = inLen + arcLen + outLen;
  const p1 = { x: r * Math.cos(t1), y: r * Math.sin(t1) };
  const p2 = { x: r * Math.cos(t2), y: r * Math.sin(t2) };

  return {
    length,
    bends: true,
    at(p) {
      const d = Math.max(0, Math.min(1, p)) * length;
      if (d <= inLen) {
        const k = inLen > 0 ? d / inLen : 1;
        return { x: from.x + (p1.x - from.x) * k, y: from.y + (p1.y - from.y) * k };
      }
      if (d <= inLen + arcLen) {
        const th = t1 + s * ((d - inLen) / r);
        return { x: r * Math.cos(th), y: r * Math.sin(th) };
      }
      const k = outLen > 0 ? (d - inLen - arcLen) / outLen : 1;
      return { x: p2.x + (to.x - p2.x) * k, y: p2.y + (to.y - p2.y) * k };
    },
  };
}
