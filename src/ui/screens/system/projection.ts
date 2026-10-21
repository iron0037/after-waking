/**
 * Orrery geometry. Real orbits span ~0.05 to ~60 AU, so radial distance is compressed with
 * r_px = k * ln(1 + a / A0). Angles are untouched, so planets still sit where they really are.
 * Moon orbits (~0.003 AU in reality) are drawn at an exaggerated offset around their parent.
 */
import { bodyPosition, DAY, findBody, type Body, type SystemDetail, type Vec2 } from "../../../sim";

export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

export const HOME_VIEW: ViewState = { zoom: 1, panX: 0, panY: 0 };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 16;

/** Knee of the log scale, in AU. Smaller packs the inner system tighter. */
const A0 = 0.15;
/** Fraction of the half-viewport the fold-limit circle fills at zoom 1. */
const FILL = 0.84;

/** On-screen disc radius in px: compressed so a gas giant is big, an asteroid still visible. */
export function discRadius(body: Body, zoom: number): number {
  return (2 + 3 * Math.sqrt(body.radiusEarth)) * Math.min(2.2, Math.pow(zoom, 0.3));
}

/** Distance in px from a parent to its index-th moon. */
export function moonOrbitPx(parent: Body, index: number, zoom: number): number {
  return discRadius(parent, zoom) + 11 + index * 7;
}

export interface Projection {
  cx: number;
  cy: number;
  zoom: number;
  /** Screen radius of a circle of `au` around the star. */
  radiusPx(au: number): number;
  /** Real position (AU, star at origin) to screen. */
  toScreen(real: Vec2): Vec2;
  /** Screen position of a body at game time t, with moons at their exaggerated offset. */
  bodyPos(body: Body, t: number): Vec2;
  /** How far the drawn position differs from toScreen(real position). Zero for planets. */
  bodyOffset(body: Body, t: number): Vec2;
}

export function makeProjection(w: number, h: number, view: ViewState, detail: SystemDetail): Projection {
  const cx = w / 2 + view.panX;
  const cy = h / 2 + view.panY;
  const k = (Math.min(w, h) / 2) * FILL / Math.log(1 + detail.edgeAU / A0);
  const radiusPx = (au: number) => k * view.zoom * Math.log(1 + au / A0);

  const toScreen = (v: Vec2): Vec2 => {
    const r = Math.hypot(v.x, v.y);
    if (r < 1e-9) return { x: cx, y: cy };
    const m = radiusPx(r) / r;
    return { x: cx + v.x * m, y: cy + v.y * m };
  };

  const bodyPos = (body: Body, t: number): Vec2 => {
    if (body.parentId === null) return toScreen(bodyPosition(detail, body, t));
    const parent = findBody(detail, body.parentId);
    const p = bodyPos(parent, t);
    const index = Math.max(0, parent.moonIds.indexOf(body.id));
    const r = moonOrbitPx(parent, index, view.zoom);
    const angle = body.phase + (2 * Math.PI * (t / DAY)) / body.periodDays;
    return { x: p.x + Math.cos(angle) * r, y: p.y + Math.sin(angle) * r };
  };

  const bodyOffset = (body: Body, t: number): Vec2 => {
    if (body.parentId === null) return { x: 0, y: 0 };
    const drawn = bodyPos(body, t);
    const real = toScreen(bodyPosition(detail, body, t));
    return { x: drawn.x - real.x, y: drawn.y - real.y };
  };

  return { cx, cy, zoom: view.zoom, radiusPx, toScreen, bodyPos, bodyOffset };
}

/** Zoom by `factor` keeping the point under (mx, my) fixed. */
export function zoomAt(view: ViewState, w: number, h: number, mx: number, my: number, factor: number): ViewState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  if (zoom <= MIN_ZOOM + 1e-6) return HOME_VIEW;
  const ratio = zoom / view.zoom;
  const dx = mx - w / 2;
  const dy = my - h / 2;
  const limit = (Math.min(w, h) / 2) * zoom;
  const clampPan = (v: number) => Math.max(-limit, Math.min(limit, v));
  return {
    zoom,
    panX: clampPan(dx - (dx - view.panX) * ratio),
    panY: clampPan(dy - (dy - view.panY) * ratio),
  };
}
