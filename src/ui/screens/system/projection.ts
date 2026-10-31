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
export const MAX_ZOOM = 64;

/** Knee of the log scale, in AU. Smaller packs the inner system tighter. */
const A0 = 0.15;
/** Fraction of the half-viewport the fold-limit circle fills at zoom 1. */
const FILL = 0.84;

/**
 * How much the world around a body grows with zoom: discs, moon orbits and moon discs all share
 * it, so zooming in magnifies a planet and pushes its moons out together. Capped so a gas giant
 * stays inside the viewport at full zoom.
 */
export function bodyScale(zoom: number): number {
  return Math.min(MAX_BODY_SCALE, Math.pow(zoom, 0.6));
}

/** Ceiling on bodyScale: the biggest gas giant (~19 px at zoom 1) then fills about a third of a typical viewport. */
const MAX_BODY_SCALE = 10;

/** Smallest a moon is ever drawn (px radius at zoom 1): clearly a disc, and easy to click. */
const MOON_MIN_R = 4.5;

/** Moon orbits at zoom 1: gap between the parent's edge and the first moon, and the step to each next one (px). */
const MOON_GAP = 13;
const MOON_STEP = 10;

/**
 * Radius in px before zoom scaling. Square-root of the real radius keeps the order (moon < rocky
 * planet < giant) while compressing the range: roughly moons 4.5-7, rocky worlds 6-10, ice giants
 * 11-13, gas giants 14-19.
 */
function baseRadius(body: Body): number {
  if (body.parentId) return Math.max(MOON_MIN_R, 3 + 4 * Math.sqrt(body.radiusEarth));
  return 4 + 4.4 * Math.sqrt(body.radiusEarth);
}

/** On-screen disc radius in px: compressed so a gas giant is big, an asteroid still visible. */
export function discRadius(body: Body, zoom: number): number {
  const scale = bodyScale(zoom);
  // Moons grow a little more slowly than planets so they never swallow their parent.
  return baseRadius(body) * (body.parentId ? Math.pow(scale, 0.8) : scale);
}

/** Distance in px from a parent to its index-th moon. */
export function moonOrbitPx(parent: Body, index: number, zoom: number): number {
  return discRadius(parent, zoom) + (MOON_GAP + index * MOON_STEP) * bodyScale(zoom);
}

/**
 * A view with `body` dead center at `zoom`. The planet's screen offset from the star is linear in
 * zoom, so evaluating at pan 0 and negating gives the pan directly.
 */
export function focusView(w: number, h: number, detail: SystemDetail, body: Body, t: number, zoom: number, fitDim?: number): ViewState {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const p = makeProjection(w, h, { zoom: z, panX: 0, panY: 0 }, detail, fitDim).bodyPos(body, t);
  const limit = (Math.min(w, h) / 2) * z;
  const clampPan = (v: number) => Math.max(-limit, Math.min(limit, v));
  return { zoom: z, panX: clampPan(w / 2 - p.x), panY: clampPan(h / 2 - p.y) };
}

/** The zoom at which `body` fills about `targetPx` of radius, leaving room for all of its family's moons. */
export function zoomForBody(w: number, h: number, detail: SystemDetail, body: Body): number {
  const root = body.parentId ? findBody(detail, body.parentId) : body;
  const half = Math.min(w, h) / 2;
  let scale = Math.min(MAX_BODY_SCALE, 70 / baseRadius(body));
  if (root.moonIds.length > 0) {
    // Outermost moon orbit (parent radius + gap) must fit inside ~80% of the half-viewport.
    const reach = baseRadius(root) + MOON_GAP + (root.moonIds.length - 1) * MOON_STEP;
    scale = Math.min(scale, (half * 0.8) / reach);
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.pow(Math.max(1, scale), 1 / 0.6)));
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

/**
 * `fitDim` is the viewport dimension the orrery is scaled to (default: the smaller side). The screen holds it
 * steady while the canvas changes height (the Archive strip appearing), so the system doesn't jump in size.
 */
export function makeProjection(w: number, h: number, view: ViewState, detail: SystemDetail, fitDim = Math.min(w, h)): Projection {
  const cx = w / 2 + view.panX;
  const cy = h / 2 + view.panY;
  const k = (fitDim / 2) * FILL / Math.log(1 + detail.edgeAU / A0);
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

/**
 * Pan is a screen offset from the star, but bodies orbit: after any time passes (a 12-hour survey,
 * a scan, a wait) a zoomed view's pan points at empty space. A ViewAnchor ties the view to a body:
 * `view` was set at game time `t`, and the camera since then rides along with the body's motion.
 * `follow` anchors (Zoom to body) track the body continuously, even through a flight animation;
 * other anchors only absorb time that passes outside flights (the caller rebases them after one).
 */
export interface ViewAnchor {
  bodyId: string;
  t: number;
  follow: boolean;
}

/** The view to draw at game time `t`: `view` carried along with its anchor body's motion since `anchor.t`. */
export function resolveView(w: number, h: number, detail: SystemDetail, view: ViewState, anchor: ViewAnchor | null, t: number, fitDim?: number): ViewState {
  if (!anchor || t === anchor.t) return view;
  const body = detail.bodies.find((b) => b.id === anchor.bodyId);
  if (!body) return view;
  // At pan 0 the body's screen position is linear in zoom, so the difference is its drift since anchor.t.
  const p0 = makeProjection(w, h, { zoom: view.zoom, panX: 0, panY: 0 }, detail, fitDim);
  const now = p0.bodyPos(body, t);
  const then = p0.bodyPos(body, anchor.t);
  return { zoom: view.zoom, panX: view.panX - (now.x - then.x), panY: view.panY - (now.y - then.y) };
}

/** The body drawn nearest the viewport center, if one is reasonably close; the natural thing to hold the view to. */
export function nearestBodyId(w: number, h: number, detail: SystemDetail, view: ViewState, t: number, fitDim?: number): string | null {
  const proj = makeProjection(w, h, view, detail, fitDim);
  let best: string | null = null;
  let bestD = Math.min(w, h) * 0.5;
  for (const b of detail.bodies) {
    const p = proj.bodyPos(b, t);
    const d = Math.hypot(p.x - w / 2, p.y - h / 2);
    if (d < bestD) [best, bestD] = [b.id, d];
  }
  return best;
}

export function isHomeView(view: ViewState): boolean {
  return view.zoom <= MIN_ZOOM && view.panX === 0 && view.panY === 0;
}

/** Shift the view by a screen-space drag, keeping it within the same bounds zoomAt uses. */
export function panView(view: ViewState, w: number, h: number, dx: number, dy: number): ViewState {
  const limit = (Math.min(w, h) / 2) * view.zoom;
  const clampPan = (v: number) => Math.max(-limit, Math.min(limit, v));
  return { zoom: view.zoom, panX: clampPan(view.panX + dx), panY: clampPan(view.panY + dy) };
}
