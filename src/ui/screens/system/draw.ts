/** Canvas rendering for the system orrery. Pure drawing: no state, no side effects but the hit list. */
import {
  bodyPosition,
  dist,
  formatDate,
  foldEdgeFraction,
  formatDuration,
  SPECTRAL,
  type Body,
  type BodyProgress,
  type Contract,
  type FlightPlan,
  type FlightTarget,
  type GameState,
  type SystemDetail,
  type Vec2,
  type World,
} from "../../../sim";
import { BODY_COLOR, UI } from "../../palette";
import { bodySprite, SPRITE_MIN_RADIUS, spriteSize } from "./planetArt";
import { discRadius, makeProjection, moonOrbitPx, type Projection, type ViewState } from "./projection";
import { FONT, fmtAU, rgba, shade, shortKind } from "./util";

/** A planned (or in-progress) burn from where the ship was to where it will arrive. */
export interface Route {
  target: FlightTarget;
  plan: FlightPlan;
  startReal: Vec2;
  startBodyId: string | null;
  startTime: number;
}

export interface FlightOverlay {
  /** Eased 0..1 progress along the route. */
  progress: number;
  /** Linear 0..1 progress, for the progress bar. */
  raw: number;
  /** Game seconds per real second right now. */
  rate: number;
  label: string;
}

export interface Scene {
  state: GameState;
  world: World;
  detail: SystemDetail;
  view: ViewState;
  /** Game time to draw the bodies at. */
  time: number;
  timeMs: number;
  selectedId: string | null;
  hoverId: string | null;
  shipReal: Vec2;
  route: Route | null;
  flight: FlightOverlay | null;
  heading: number;
  /** Exploration progress per body, and active contracts that still have work there. */
  progress: Map<string, BodyProgress>;
  targets: Map<string, Contract[]>;
}

export interface HitTarget {
  id: string;
  x: number;
  y: number;
  r: number;
}

export interface DrawResult {
  hits: HitTarget[];
  heading: number;
}

const ZERO: Vec2 = { x: 0, y: 0 };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// A fixed starfield, so the backdrop doesn't shimmer between frames.
const STARFIELD = (() => {
  let s = 20260101;
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: 170 }, () => ({ x: next(), y: next(), size: next() < 0.12 ? 1.6 : 1, alpha: 0.12 + next() * 0.4 }));
})();

export function drawOrrery(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene): DrawResult {
  const { detail, state } = scene;
  const proj = makeProjection(w, h, scene.view, detail);
  const hits: HitTarget[] = [];

  drawBackdrop(ctx, w, h, scene.view);
  drawScaleRings(ctx, proj, detail, w, h);
  drawOrbits(ctx, proj, scene);
  drawFoldLimit(ctx, proj, detail, foldEdgeFraction(state));
  drawStar(ctx, proj, detail);

  // Bodies: planets first, then moons on top of their parents' orbit lines.
  const pos = new Map<string, Vec2>();
  for (const b of detail.bodies) pos.set(b.id, proj.bodyPos(b, scene.time));
  const ordered = [...detail.bodies.filter((b) => !b.parentId), ...detail.bodies.filter((b) => b.parentId)];
  for (const b of ordered) {
    const p = pos.get(b.id) as Vec2;
    const r = discRadius(b, proj.zoom);
    drawBodyDisc(ctx, b, p, r, proj, state.seed, state.scannedBodies.includes(b.id));
    const prog = scene.progress.get(b.id);
    if (prog && prog.regionsVisited > 0) drawProgressRing(ctx, p, r, prog.explored);
    if (scene.targets.has(b.id)) drawContractMark(ctx, p, r);
    // Moons are small and crowd their parent, so give them a generous click target.
    hits.push({ id: b.id, x: p.x, y: p.y, r: b.parentId ? Math.max(r + 5, 13) : Math.max(r, 6) });
  }

  // Route, then ship, then labels and highlights on top.
  const leg = scene.route ? makeLeg(proj, scene) : null;
  let heading = scene.heading;
  if (scene.route && leg) heading = drawRoute(ctx, proj, scene, leg, w, h) ?? heading;

  drawShip(ctx, proj, scene, pos, leg, heading);
  drawLabels(ctx, scene, pos, proj, w);
  drawHighlights(ctx, scene, pos, proj, w);
  if (scene.flight) drawFlightClock(ctx, scene, w);
  return { hits, heading };
}

// --- backdrop and guides -----------------------------------------------------------------

function drawBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, view: ViewState): void {
  ctx.fillStyle = UI.space;
  ctx.fillRect(0, 0, w, h);
  const vignette = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
  vignette.addColorStop(0, "#0d1426");
  vignette.addColorStop(1, UI.space);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
  for (const s of STARFIELD) {
    ctx.fillStyle = `rgba(215,227,244,${s.alpha})`;
    const x = (((s.x * w + view.panX * 0.04) % w) + w) % w;
    const y = (((s.y * h + view.panY * 0.04) % h) + h) % h;
    ctx.fillRect(x, y, s.size, s.size);
  }
}

const SCALE_AU = [0.1, 0.3, 1, 3, 10, 30, 100];

function drawScaleRings(ctx: CanvasRenderingContext2D, proj: Projection, detail: SystemDetail, w: number, h: number): void {
  const edgeR = proj.radiusPx(detail.edgeAU);
  ctx.save();
  ctx.font = FONT(10);
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.setLineDash([2, 7]);
  ctx.lineWidth = 1;
  for (const au of SCALE_AU) {
    if (au > detail.edgeAU * 0.9) continue;
    const r = proj.radiusPx(au);
    if (r < 16 || r > edgeR - 18) continue;
    if (r > Math.hypot(w, h)) continue;
    ctx.strokeStyle = rgba(UI.gridBright, 0.45);
    ctx.beginPath();
    ctx.arc(proj.cx, proj.cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = rgba(UI.muted, 0.55);
    ctx.fillText(`${au} AU`, proj.cx + 5, proj.cy - r - 2);
  }
  ctx.restore();
}

function drawOrbits(ctx: CanvasRenderingContext2D, proj: Projection, scene: Scene): void {
  const { detail } = scene;
  ctx.save();
  ctx.lineWidth = 1;
  for (const b of detail.bodies) {
    const active = b.id === scene.selectedId || b.id === scene.hoverId;
    ctx.setLineDash(b.kind === "asteroid" ? [1, 5] : []);
    ctx.strokeStyle = active ? rgba(UI.cyan, 0.55) : b.kind === "asteroid" ? rgba(UI.muted, 0.35) : rgba(UI.gridBright, 0.8);
    ctx.beginPath();
    if (b.parentId === null) {
      ctx.arc(proj.cx, proj.cy, proj.radiusPx(b.orbitAU), 0, Math.PI * 2);
    } else {
      const parent = detail.bodies.find((p) => p.id === b.parentId) as Body;
      const pp = proj.bodyPos(parent, scene.time);
      ctx.arc(pp.x, pp.y, moonOrbitPx(parent, parent.moonIds.indexOf(b.id), proj.zoom), 0, Math.PI * 2);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawFoldLimit(ctx: CanvasRenderingContext2D, proj: Projection, detail: SystemDetail, edgeFraction: number): void {
  const r = proj.radiusPx(detail.edgeAU);
  // Fold Calibration lets a fold start well inside the system edge: mark where.
  if (edgeFraction < 0.9) {
    const inner = proj.radiusPx(detail.edgeAU * edgeFraction);
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 6]);
    ctx.strokeStyle = rgba(UI.good, 0.65);
    ctx.beginPath();
    ctx.arc(proj.cx, proj.cy, inner, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = FONT(11);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = rgba(UI.good, 0.85);
    ctx.fillText(`CLEAR TO FOLD BEYOND · ${fmtAU(detail.edgeAU * edgeFraction)} AU`, proj.cx, proj.cy - inner + 6);
    ctx.restore();
  }
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.setLineDash([9, 7]);
  ctx.strokeStyle = rgba(UI.cyan, 0.6);
  ctx.beginPath();
  ctx.arc(proj.cx, proj.cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = FONT(11);
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = rgba(UI.cyan, 0.85);
  ctx.fillText(`${edgeFraction < 0.9 ? "SYSTEM EDGE" : "FOLD LIMIT"} · ${fmtAU(detail.edgeAU)} AU`, proj.cx, proj.cy - r - 6);
  ctx.restore();
}

function drawStar(ctx: CanvasRenderingContext2D, proj: Projection, detail: SystemDetail): void {
  const sys = detail.system;
  const color = SPECTRAL[sys.spectral].color;
  const r = (8 + 6 * Math.log10(1 + sys.luminosity * 4)) * Math.min(1.8, Math.pow(proj.zoom, 0.25));
  const glow = ctx.createRadialGradient(proj.cx, proj.cy, r * 0.5, proj.cx, proj.cy, r * 6);
  glow.addColorStop(0, rgba(color, 0.5));
  glow.addColorStop(0.25, rgba(color, 0.16));
  glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(proj.cx, proj.cy, r * 6, 0, Math.PI * 2);
  ctx.fill();
  const core = ctx.createRadialGradient(proj.cx, proj.cy, 0, proj.cx, proj.cy, r);
  core.addColorStop(0, "#ffffff");
  core.addColorStop(0.55, color);
  core.addColorStop(1, shade(color, -0.25));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(proj.cx, proj.cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = FONT(11);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = rgba(color, 0.8);
  ctx.fillText(sys.name, proj.cx, proj.cy + r + 5);
}

// --- bodies ------------------------------------------------------------------------------

function drawBodyDisc(
  ctx: CanvasRenderingContext2D,
  body: Body,
  p: Vec2,
  r: number,
  proj: Projection,
  seed: number,
  scanned: boolean,
): void {
  const base = BODY_COLOR[body.kind];
  // Light from the star: toward the center of the orrery.
  const dx = proj.cx - p.x;
  const dy = proj.cy - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;

  if (r >= SPRITE_MIN_RADIUS) {
    drawSphere(ctx, body, p, r, ux, uy, seed);
  } else {
    const g = ctx.createRadialGradient(p.x + ux * r * 0.45, p.y + uy * r * 0.45, r * 0.08, p.x, p.y, r * 1.1);
    g.addColorStop(0, shade(base, 0.5));
    g.addColorStop(0.5, base);
    g.addColorStop(1, shade(base, -0.65));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();

    if (body.kind === "gasGiant" || body.kind === "iceGiant") {
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.clip();
      for (let i = -2; i <= 2; i++) {
        ctx.fillStyle = i % 2 === 0 ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.09)";
        ctx.fillRect(p.x - r, p.y + i * r * 0.36 - r * 0.09, r * 2, r * 0.2);
      }
      ctx.restore();
    }
  }
  if (scanned) {
    ctx.fillStyle = UI.cyan;
    ctx.beginPath();
    ctx.arc(p.x + r * 0.78, p.y - r * 0.78, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A textured globe (cached sprite) with the star-facing terminator laid over it. */
function drawSphere(ctx: CanvasRenderingContext2D, body: Body, p: Vec2, r: number, ux: number, uy: number, seed: number): void {
  const sprite = bodySprite(seed, body, spriteSize(r));
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);

  // Day side fades smoothly into night; a hint of limb darkening comes with the same gradient.
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.clip();
  const cx = p.x + ux * r * 0.4;
  const cy = p.y + uy * r * 0.4;
  const shadow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.7);
  shadow.addColorStop(0, "rgba(3,5,12,0)");
  shadow.addColorStop(0.5, "rgba(3,5,12,0.35)");
  shadow.addColorStop(0.8, "rgba(3,5,12,0.82)");
  shadow.addColorStop(1, "rgba(3,5,12,0.92)");
  ctx.fillStyle = shadow;
  ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  ctx.restore();

  // Thin atmosphere on the lit limb.
  if (body.pressureAtm > 0.05 || body.kind === "gasGiant" || body.kind === "iceGiant") {
    ctx.save();
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.strokeStyle = rgba(shade(BODY_COLOR[body.kind], 0.45), 0.35);
    ctx.beginPath();
    const a = Math.atan2(uy, ux);
    ctx.arc(p.x, p.y, r - ctx.lineWidth / 2, a - 1.0, a + 1.0);
    ctx.stroke();
    ctx.restore();
  }
}

/** A thin painted ring around a world the player has landed on: the arc is how much surface is mapped. */
function drawProgressRing(ctx: CanvasRenderingContext2D, p: Vec2, r: number, explored: number): void {
  const ringR = r + 3.5;
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = rgba(UI.cyan, 0.2);
  ctx.beginPath();
  ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = rgba(UI.cyan, 0.9);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(p.x, p.y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, Math.max(0.07, explored)));
  ctx.stroke();
  ctx.restore();
}

/** Small accent diamond up and to the left of a world that an active contract points at. */
function drawContractMark(ctx: CanvasRenderingContext2D, p: Vec2, r: number): void {
  const x = p.x - r * 0.75 - 5;
  const y = p.y - r * 0.75 - 5;
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x, y - 4.5);
  ctx.lineTo(x + 4.5, y);
  ctx.lineTo(x, y + 4.5);
  ctx.lineTo(x - 4.5, y);
  ctx.closePath();
  ctx.fillStyle = UI.accent;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = UI.space;
  ctx.stroke();
  ctx.restore();
}

function drawLabels(ctx: CanvasRenderingContext2D, scene: Scene, pos: Map<string, Vec2>, proj: Projection, w: number): void {
  const { state, detail } = scene;
  const orbitingId = state.location.kind === "space" ? state.location.orbiting : null;
  ctx.save();
  ctx.font = FONT(11);
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  for (const b of detail.bodies) {
    const focus = b.id === scene.selectedId || b.id === scene.hoverId || b.id === orbitingId;
    // Moons announce themselves once you zoom in, or whenever their parent is in focus.
    const parentFocus = b.parentId !== null && (b.parentId === scene.selectedId || b.parentId === scene.hoverId || b.parentId === orbitingId);
    const quiet = b.kind === "asteroid" || (b.parentId !== null && !parentFocus);
    if (quiet && !focus && proj.zoom < 1.6) continue;
    const p = pos.get(b.id) as Vec2;
    const r = discRadius(b, proj.zoom);
    const flip = p.x + r + 8 + b.name.length * 6.6 > w - 6;
    ctx.textAlign = flip ? "right" : "left";
    const x = flip ? p.x - r - 6 : p.x + r + 6;
    const y = p.y + (b.parentId ? -r - 2 : 3);
    ctx.lineWidth = 3;
    ctx.strokeStyle = rgba(UI.space, 0.85);
    ctx.strokeText(b.name, x, y);
    ctx.fillStyle = focus ? UI.text : state.scannedBodies.includes(b.id) ? rgba(UI.text, 0.85) : rgba(UI.muted, 0.95);
    ctx.fillText(b.name, x, y);
  }
  ctx.restore();
}

function drawHighlights(ctx: CanvasRenderingContext2D, scene: Scene, pos: Map<string, Vec2>, proj: Projection, w: number): void {
  ctx.save();
  const hover = scene.hoverId ? scene.detail.bodies.find((b) => b.id === scene.hoverId) : undefined;
  if (hover && hover.id !== scene.selectedId) {
    const p = pos.get(hover.id) as Vec2;
    ctx.strokeStyle = rgba(UI.text, 0.7);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, discRadius(hover, proj.zoom) + 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  const sel = scene.selectedId ? scene.detail.bodies.find((b) => b.id === scene.selectedId) : undefined;
  if (sel) {
    const p = pos.get(sel.id) as Vec2;
    const r = discRadius(sel, proj.zoom) + 8;
    const spin = scene.timeMs * 0.0006;
    ctx.setLineDash([]);
    ctx.strokeStyle = UI.accent;
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {
      const a = spin + (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, a - 0.28, a + 0.28);
      ctx.stroke();
    }
  }

  if (hover) drawTooltip(ctx, scene, hover, pos.get(hover.id) as Vec2, proj, w);
  ctx.restore();
}

function drawTooltip(ctx: CanvasRenderingContext2D, scene: Scene, body: Body, p: Vec2, proj: Projection, w: number): void {
  const loc = scene.state.location;
  const here = loc.kind === "space" && loc.orbiting === body.id;
  const d = dist(scene.shipReal, bodyPosition(scene.detail, body, scene.time));
  const lines = [body.name, `${shortKind(body.kind)} · ${here ? "in orbit" : `${fmtAU(d)} AU away`}`];
  const prog = scene.progress.get(body.id);
  if (prog && prog.regionsVisited > 0) {
    lines.push(`landed ${prog.regionsVisited}/${prog.regions} regions · ${Math.round(prog.explored * 100)}% mapped`);
  }
  const jobs = scene.targets.get(body.id) ?? [];
  const first = jobs[0];
  if (first) lines.push(`◆ ${first.title}`);
  ctx.font = FONT(11);
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  const height = 8 + lines.length * 15;
  const r = discRadius(body, proj.zoom);
  let x = p.x + r + 12;
  if (x + width > w - 6) x = p.x - r - 12 - width;
  const y = Math.max(6, p.y - height - r - 4);
  ctx.setLineDash([]);
  ctx.fillStyle = rgba("#0a0e1a", 0.92);
  ctx.strokeStyle = UI.gridBright;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 4);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    ctx.fillStyle = i === 0 ? UI.text : line.startsWith("◆") ? UI.accent : UI.muted;
    ctx.fillText(line, x + 8, y + 12 + i * 15);
  });
}

// --- route and ship ----------------------------------------------------------------------

interface Leg {
  startReal: Vec2;
  endReal: Vec2;
  startOff: Vec2;
  endOff: Vec2;
}

function makeLeg(proj: Projection, scene: Scene): Leg {
  const route = scene.route as Route;
  const find = (id: string) => scene.detail.bodies.find((b) => b.id === id) as Body;
  const startOff = route.startBodyId ? proj.bodyOffset(find(route.startBodyId), route.startTime) : ZERO;
  const endOff = "bodyId" in route.target ? proj.bodyOffset(find(route.target.bodyId), route.startTime + route.plan.minutes) : ZERO;
  return { startReal: route.startReal, endReal: route.plan.arrival, startOff, endOff };
}

function legPoint(proj: Projection, leg: Leg, p: number): Vec2 {
  const s = proj.toScreen({ x: lerp(leg.startReal.x, leg.endReal.x, p), y: lerp(leg.startReal.y, leg.endReal.y, p) });
  return { x: s.x + lerp(leg.startOff.x, leg.endOff.x, p), y: s.y + lerp(leg.startOff.y, leg.endOff.y, p) };
}

/** Draws the burn path and arrival marker; returns the heading at the ship's current progress. */
function drawRoute(ctx: CanvasRenderingContext2D, proj: Projection, scene: Scene, leg: Leg, w: number, h: number): number | null {
  const route = scene.route as Route;
  const progress = scene.flight ? scene.flight.progress : 0;
  const steps = 56;
  const trace = (from: number, to: number) => {
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const q = legPoint(proj, leg, lerp(from, to, i / steps));
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  };

  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = rgba(UI.ship, scene.flight ? 0.4 : 0.7);
  trace(progress, 1);
  if (scene.flight && progress > 0.001) {
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(UI.ship, 0.85);
    trace(0, progress);
  }

  // Arrival marker: hollow diamond with an ETA tag.
  const end = legPoint(proj, leg, 1);
  ctx.setLineDash([]);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = UI.accent;
  ctx.beginPath();
  ctx.moveTo(end.x, end.y - 6);
  ctx.lineTo(end.x + 6, end.y);
  ctx.lineTo(end.x, end.y + 6);
  ctx.lineTo(end.x - 6, end.y);
  ctx.closePath();
  ctx.stroke();
  const text = `${formatDuration(route.plan.minutes)} · ${fmtAU(route.plan.distanceAU)} AU`;
  ctx.font = FONT(11);
  ctx.textBaseline = "middle";
  const flip = end.x + 14 + ctx.measureText(text).width > w - 6;
  ctx.textAlign = flip ? "right" : "left";
  const tx = flip ? end.x - 11 : end.x + 11;
  const ty = Math.min(h - 10, Math.max(10, end.y + 16));
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.strokeStyle = rgba(UI.space, 0.85);
  ctx.strokeText(text, tx, ty);
  ctx.fillStyle = UI.accent;
  ctx.fillText(text, tx, ty);
  ctx.restore();

  const a = legPoint(proj, leg, Math.min(progress, 0.98));
  const b = legPoint(proj, leg, Math.min(progress + 0.02, 1));
  return Math.hypot(b.x - a.x, b.y - a.y) > 0.01 ? Math.atan2(b.y - a.y, b.x - a.x) : null;
}

function drawShip(
  ctx: CanvasRenderingContext2D,
  proj: Projection,
  scene: Scene,
  pos: Map<string, Vec2>,
  leg: Leg | null,
  heading: number,
): void {
  const loc = scene.state.location;
  if (loc.kind !== "space") return;
  let p: Vec2;
  let angle = heading;
  if (scene.flight && leg) {
    p = legPoint(proj, leg, scene.flight.progress);
  } else if (loc.orbiting) {
    const body = scene.detail.bodies.find((b) => b.id === loc.orbiting) as Body;
    const c = pos.get(body.id) as Vec2;
    const r = discRadius(body, proj.zoom) + 7;
    ctx.save();
    ctx.strokeStyle = rgba(UI.ship, 0.45);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    const a = -Math.PI / 4;
    p = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
    angle = a + Math.PI / 2; // tangent, prograde
  } else {
    p = proj.toScreen(loc.pos);
  }

  const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 16);
  glow.addColorStop(0, rgba(UI.ship, 0.5));
  glow.addColorStop(1, rgba(UI.ship, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  ctx.fillStyle = UI.ship;
  ctx.strokeStyle = UI.space;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-5, 4.8);
  ctx.lineTo(-2.5, 0);
  ctx.lineTo(-5, -4.8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// --- flight overlay ----------------------------------------------------------------------

function drawFlightClock(ctx: CanvasRenderingContext2D, scene: Scene, w: number): void {
  const f = scene.flight as FlightOverlay;
  const bw = 300;
  const x = w / 2 - bw / 2;
  const y = 16;
  ctx.save();
  ctx.fillStyle = rgba("#0a0e1a", 0.88);
  ctx.strokeStyle = UI.gridBright;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, bw, 74, 5);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = FONT(16, "600");
  ctx.fillStyle = UI.text;
  ctx.fillText(formatDate(scene.time), w / 2, y + 20);
  ctx.font = FONT(12);
  ctx.fillStyle = UI.accent;
  ctx.fillText(`time ×${Math.max(1, Math.round(f.rate)).toLocaleString()}`, w / 2, y + 40);
  ctx.fillStyle = UI.muted;
  ctx.font = FONT(11);
  ctx.fillText(`en route to ${f.label}`, w / 2, y + 56);

  ctx.fillStyle = UI.space;
  ctx.fillRect(x + 8, y + 66, bw - 16, 3);
  ctx.fillStyle = UI.ship;
  ctx.fillRect(x + 8, y + 66, (bw - 16) * f.raw, 3);
  ctx.restore();
}
