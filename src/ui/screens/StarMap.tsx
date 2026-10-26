/** The navigator's chart of the Verge: pick a star, read the plan, fold. */
import { bodyNickname, researchWants } from "../../sim";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  prepareFold,
  clamp,
  currentSystemId,
  orbitalSensorTier,
  bodyValueEstimate,
  isWaitBlocker,
  departureReadyAt,
  yardReadyAt,
  distanceLy,
  flightPlan,
  fold,
  foldPlan,
  type FoldPlan,
  formatDuration,
  INTREPID_POS,
  KIND_LABEL,
  landableBodies,
  contractTargetsBySystem,
  explorationScore,
  effectiveStats,
  hasPerk,
  positionOf,
  SPECTRAL,
  systemMinerals,
  systemProgress,
  type SystemMineral,
  type Body,
  type Contract,
  type StarSystem,
  type SystemProgress,
  type Vec2,
} from "../../sim";
import { CLAN_NAMES } from "../../data/ship";
import { COMMODITIES } from "../../data/commodities";
import { tonnes } from "../format";
import { Canvas } from "../Canvas";
import { BODY_COLOR, UI } from "../palette";
import { useSession, type GameSession } from "../session";
import "./starmap.css";

const FONT = '"Cascadia Mono", "JetBrains Mono", Consolas, monospace';
const FLASH_MS = 600;
const PAD = 70;

/** A selectable point on the chart: a star or the Intrepid. */
interface Node {
  id: string;
  name: string;
  pos: Vec2;
  star: StarSystem | null;
}

interface ViewState {
  /** Pixels per light-year. */
  scale: number;
  /** Chart coordinates at the center of the canvas. */
  cx: number;
  cy: number;
  fit: number;
  /** False while the view should keep auto-fitting (initially and after "Fit all"). */
  userMoved: boolean;
}

const INTREPID_HIT = 22;
/** Drawn width of the Intrepid sprite on the chart, in pixels (sprite is 307x41). */
const INTREPID_W = 78;

/** Blockers a one-click departure can resolve itself (fly to the edge, wait out the refit or yard work). */
const isSoftBlocker = (b: string): boolean => isWaitBlocker(b) || b.startsWith("Folds can't start inside");

const intrepidImg = typeof Image === "undefined" ? null : new Image();
if (intrepidImg) intrepidImg.src = "./assets/intrepid.png";

/** Star dot radius in pixels: luminosity on a log scale, in a small range. */
function starRadius(s: StarSystem): number {
  const t = (Math.log10(s.luminosity) + 2.7) / 4;
  return 2.5 + clamp(t, 0, 1) * 3.5;
}

/**
 * Blended exploration score for a system, 0..1: how much of it has been scanned, landed on and
 * walked. Regions visited alone is usually tiny, so it counts for less.
 */
interface Paint {
  progress: SystemProgress;
  score: number;
}

/** System ids that hold a target of an active contract, with the contracts pointing there. */
function contractTargets(session: GameSession): Map<string, Contract[]> {
  return contractTargetsBySystem(session.state);
}

export function StarMap({ session }: { session: GameSession }) {
  useSession(session);
  const { state, world } = session;
  const fromId = currentSystemId(state);
  const docked = state.location.kind === "intrepid";
  const targets = contractTargets(session);
  const paint = new Map<string, Paint>();
  for (const s of world.galaxy.systems) {
    if (!s.charted && !state.visitedSystems.includes(s.id)) continue;
    const progress = systemProgress(state, world, s.id);
    paint.set(s.id, { progress, score: explorationScore(state, world, s.id) });
  }

  const nodes = useMemo<Node[]>(
    () => [
      { id: "intrepid", name: "The Intrepid", pos: INTREPID_POS, star: null },
      ...world.galaxy.systems.map((s): Node => ({ id: s.id, name: s.name, pos: s.pos, star: s })),
    ],
    [world],
  );
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const [selected, setSelected] = useState<string | null>(() => {
    const here = positionOf(world.galaxy, currentSystemId(state));
    let best: Node | null = null;
    let bestD = Infinity;
    for (const n of nodes) {
      if (!n.star?.charted || state.visitedSystems.includes(n.id) || n.id === currentSystemId(state)) continue;
      if (landableBodies(state, world, n.id).length === 0) continue; // don't suggest dead ends
      const d = Math.hypot(n.pos.x - here.x, n.pos.y - here.y);
      if (d < bestD) [best, bestD] = [n, d];
    }
    return best?.id ?? null;
  });
  const [hovered, setHovered] = useState<string | null>(null);

  const view = useRef<ViewState>({ scale: 1, cx: 0, cy: 0, fit: 0, userMoved: false });
  const size = useRef({ w: 0, h: 0 });
  const flash = useRef(0);
  const timer = useRef(0);
  const drag = useRef<{ sx: number; sy: number; lx: number; ly: number; moved: boolean } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const stopDrag = useRef<(() => void) | null>(null);

  const stats = effectiveStats(state);
  const here = positionOf(world.galaxy, fromId);
  // Fold Plotter (navigator): fuel and refit time for every star within the drive's range, cheap enough to recompute on each render.
  const plotter = hasPerk(state, "fold-plotter");
  const plots = new Map<string, FoldPlan>();
  if (plotter) {
    for (const n of nodes) {
      if (!n.star || n.id === fromId || distanceLy(world.galaxy, fromId, n.id) > stats.foldRangeLy) continue;
      plots.set(n.id, foldPlan(state, world, n.id));
    }
  }
  /** Stars whose Fold Plotter label fits without covering another label; the hovered and selected stars always get one. */
  const plotLabels = new Set<string>();
  const target = selected ? (byId.get(selected) ?? null) : null;
  const plan = target ? foldPlan(state, world, target.id) : null;

  // Departure: what a one-click "fold when ready" would do, and whether it can.
  const hardBlockers = plan ? plan.blockers.filter((b) => !isSoftBlocker(b)) : [];
  const softBlockers = plan ? plan.blockers.filter(isSoftBlocker) : [];
  const needsEdge = softBlockers.some((b) => b.startsWith("Folds can't start inside"));
  const refitLeft = Math.max(0, state.foldReadyAt - state.time);
  // Docked at the Intrepid, yard work (installs, Lyceum courses) also holds the ship; a one-click departure waits for the longest.
  const yardLeft = docked ? Math.max(0, yardReadyAt(state) - state.time) : 0;
  const departLeft = Math.max(0, departureReadyAt(state) - state.time);
  const edgeFlight = needsEdge ? flightPlan(state, world, { edge: true }) : null;
  const flightMinutes = edgeFlight?.ok ? edgeFlight.value.minutes : 0;
  const flightFuel = edgeFlight?.ok ? edgeFlight.value.fuel : 0;
  const waitMinutes = Math.max(0, departLeft - flightMinutes);
  const edgeProblem =
    edgeFlight && !edgeFlight.ok
      ? edgeFlight.reason
      : plan && needsEdge && flightFuel + plan.fuel > state.ship.fuel
        ? `Not enough fuel to reach the edge (${flightFuel}) and fold (${plan.fuel}); tanks hold ${state.ship.fuel.toFixed(1)}.`
        : null;
  const canDepart = !!plan && hardBlockers.length === 0 && !edgeProblem && target?.id !== fromId;
  const autoLabel = (() => {
    const steps: string[] = [];
    if (needsEdge) steps.push("flies to edge");
    if (waitMinutes > 0) steps.push(`waits ${formatDuration(waitMinutes)}`);
    return steps.join(" · ");
  })();

  const known = (n: Node): boolean => n.id === "intrepid" || !!n.star?.charted || state.visitedSystems.includes(n.id);

  // --- chart geometry ---------------------------------------------------------------------

  const toScreen = (p: Vec2): [number, number] => {
    const v = view.current;
    return [size.current.w / 2 + (p.x - v.cx) * v.scale, size.current.h / 2 + (p.y - v.cy) * v.scale];
  };

  const fitView = (w: number, h: number) => {
    const v = view.current;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.pos.x);
      maxX = Math.max(maxX, n.pos.x);
      minY = Math.min(minY, n.pos.y);
      maxY = Math.max(maxY, n.pos.y);
    }
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    v.fit = Math.max(1, Math.min((w - PAD * 2) / spanX, (h - PAD * 2) / spanY));
    if (!v.userMoved) {
      v.scale = v.fit;
      v.cx = (minX + maxX) / 2;
      v.cy = (minY + maxY) / 2;
    }
  };

  const hitTest = (x: number, y: number): string | null => {
    let best: string | null = null;
    let bestD = Infinity;
    for (const n of nodes) {
      const [sx, sy] = toScreen(n.pos);
      const reach = n.star ? Math.max(11, starRadius(n.star) + 6) : INTREPID_HIT;
      const d = Math.hypot(sx - x, sy - y);
      if (d <= reach && d < bestD) [best, bestD] = [n.id, d];
    }
    return best;
  };

  // --- input ------------------------------------------------------------------------------

  const onMouseDown = (ev: MouseEvent) => {
    if (ev.button !== 0 || !(ev.target instanceof HTMLCanvasElement)) return;
    const d = { sx: ev.clientX, sy: ev.clientY, lx: ev.clientX, ly: ev.clientY, moved: false };
    drag.current = d;
    const move = (e: MouseEvent) => {
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
      if (!d.moved) wrap.current?.classList.add("dragging");
      d.moved = true;
      const v = view.current;
      v.cx -= (e.clientX - d.lx) / v.scale;
      v.cy -= (e.clientY - d.ly) / v.scale;
      v.userMoved = true;
      d.lx = e.clientX;
      d.ly = e.clientY;
    };
    const up = () => {
      stop();
      // the click event fires right after mouseup; let it see `moved` before clearing
      setTimeout(() => {
        if (drag.current === d) drag.current = null;
      }, 0);
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      wrap.current?.classList.remove("dragging");
      stopDrag.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    stopDrag.current = stop;
  };

  const onWheel = (deltaY: number, x: number, y: number) => {
    const v = view.current;
    if (!v.fit) return;
    const { w, h } = size.current;
    const next = clamp(v.scale * Math.exp(-deltaY * 0.0015), v.fit * 0.6, v.fit * 12);
    const wx = v.cx + (x - w / 2) / v.scale;
    const wy = v.cy + (y - h / 2) / v.scale;
    v.scale = next;
    v.cx = wx - (x - w / 2) / next;
    v.cy = wy - (y - h / 2) / next;
    v.userMoved = true;
  };

  const onMove = (x: number, y: number) => {
    if (drag.current?.moved) return;
    setHovered(hitTest(x, y));
  };

  const onClick = (x: number, y: number) => {
    if (drag.current?.moved || session.busy) return;
    const hit = hitTest(x, y);
    // Clicking where you already are goes back there (the system view, or the Intrepid's hub).
    if (hit !== null && hit === fromId) {
      back();
      return;
    }
    setSelected(hit);
  };

  const centerOnShip = () => {
    const v = view.current;
    v.scale = v.fit * 2.5;
    v.cx = here.x;
    v.cy = here.y;
    v.userMoved = true;
  };

  const fitAll = () => {
    view.current.userMoved = false;
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stopDrag.current?.();
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = 0;
        flash.current = 0;
        if (session.busy) session.setBusy(false);
      }
    };
  }, [session]);

  // --- actions ----------------------------------------------------------------------------

  const back = () => session.go(docked ? "hub" : "system");

  const doFold = (auto: boolean) => {
    if (!target || session.busy || !plan || !canDepart || (!auto && plan.blockers.length > 0)) return;
    const id = target.id;
    flash.current = performance.now();
    session.setBusy(true);
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      flash.current = 0;
      // Waiting out the refit plays the clock first; the fold (and the destination) come after it.
      const prepared = auto ? session.act((s, w) => prepareFold(s, w, id)) : null;
      session.setBusy(false);
      if (prepared && !prepared.ok) return;
      session.whenIdle(() => {
        const result = session.act((s, w) => fold(s, w, id));
        // A raider hailed as the drive spooled up: remember where we were going, for the debrief.
        if (!result.ok && session.state.encounter) session.pendingFold = id;
        if (result.ok) session.go(session.state.location.kind === "intrepid" ? "hub" : "system");
      });
    }, FLASH_MS);
  };

  // --- drawing ----------------------------------------------------------------------------

  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => {
    if (w < 10 || h < 10) return;
    size.current = { w, h };
    fitView(w, h);
    const v = view.current;

    ctx.fillStyle = UI.space;
    ctx.fillRect(0, 0, w, h);
    const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
    vignette.addColorStop(0, "#0b1426");
    vignette.addColorStop(1, UI.space);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    drawGrid(ctx, w, h, v);

    const [hx, hy] = toScreen(here);

    // fold range
    const rangePx = stats.foldRangeLy * v.scale;
    ctx.save();
    ctx.beginPath();
    ctx.arc(hx, hy, rangePx, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(95, 212, 255, 0.035)";
    ctx.fill();
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = "rgba(95, 212, 255, 0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = "rgba(95, 212, 255, 0.7)";
    ctx.textAlign = "center";
    ctx.fillText(`fold range ${stats.foldRangeLy} ly`, hx, clamp(hy - rangePx - 6, 14, h - 8));
    ctx.restore();

    // course line
    if (target && plan && target.id !== fromId) {
      const [tx, ty] = toScreen(target.pos);
      const ok = plan.blockers.length === 0;
      ctx.save();
      ctx.strokeStyle = ok ? UI.good : UI.danger;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = `11px ${FONT}`;
      ctx.fillStyle = ok ? UI.good : UI.danger;
      ctx.textAlign = "center";
      ctx.fillText(`${plan.ly.toFixed(1)} ly`, (hx + tx) / 2, (hy + ty) / 2 - 8);
      ctx.restore();
    }

    // Fold Plotter labels: nearest stars first, each only if it clears the other stars' names and the labels already placed.
    if (plots.size > 0) {
      type Box = { x0: number; x1: number; y0: number; y1: number };
      const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
      const boxFor = (n: Node, withPlot: boolean): Box => {
        const [x, y] = toScreen(n.pos);
        const r = starRadius(n.star as StarSystem);
        ctx.font = `12px ${FONT}`;
        let wd = ctx.measureText(n.star?.home ? `${n.name} ⌂` : n.name).width;
        if (withPlot) {
          const fp = plots.get(n.id) as FoldPlan;
          ctx.font = `10px ${FONT}`;
          wd = Math.max(wd, ctx.measureText(`fuel ${fp.fuel} · ${formatDuration(fp.refitMinutes)}`).width);
        }
        const flip = x + 140 > w;
        const x0 = flip ? x - r - 12 - wd : x + r + 12;
        return { x0, x1: x0 + wd, y0: y - 9, y1: withPlot ? y + 20 : y + 6 };
      };
      const names = nodes.filter((n) => n.star).map((n) => ({ id: n.id, box: boxFor(n, false) }));
      const placed: Box[] = [];
      const order = [...plots.keys()].sort((a, b) => (a === selected || a === hovered ? -1 : b === selected || b === hovered ? 1 : distanceLy(world.galaxy, fromId, a) - distanceLy(world.galaxy, fromId, b)));
      for (const id of order) {
        const n = byId.get(id) as Node;
        if (!known(n)) continue;
        const box = boxFor(n, true);
        const forced = id === selected || id === hovered;
        const clear = !names.some((o) => o.id !== id && hit(box, o.box)) && !placed.some((p) => hit(box, p));
        if (forced || clear) {
          plotLabels.add(id);
          placed.push(box);
        }
      }
    }

    // stars
    for (const n of nodes) {
      if (n.star) drawStar(ctx, n, w);
    }
    drawIntrepid(ctx);

    // you are here
    const base = fromId === "intrepid" ? INTREPID_W / 2 + 6 : starRadius(byId.get(fromId)?.star as StarSystem) + 9;
    const phase = (t / 1700) % 1;
    ctx.save();
    ctx.strokeStyle = UI.ship;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hx, hy, base, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = (1 - phase) * 0.8;
    ctx.beginPath();
    ctx.arc(hx, hy, base + phase * 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // hover and selection
    const hoverNode = hovered ? byId.get(hovered) : undefined;
    if (hoverNode && hoverNode.id !== selected) {
      const [x, y] = toScreen(hoverNode.pos);
      ctx.save();
      ctx.strokeStyle = UI.text;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, nodeRadius(hoverNode) + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (hoverNode) drawTooltip(ctx, hoverNode, w, h);
    if (target) {
      const [x, y] = toScreen(target.pos);
      const half = target.star ? starRadius(target.star) + 10 : 20;
      const halfW = target.star ? half : INTREPID_W / 2 + 6;
      const len = 6;
      ctx.save();
      ctx.strokeStyle = UI.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        ctx.moveTo(x + sx * halfW, y + sy * (half - len));
        ctx.lineTo(x + sx * halfW, y + sy * half);
        ctx.lineTo(x + sx * (halfW - len), y + sy * half);
      }
      ctx.stroke();
      ctx.restore();
    }

    // fold flash
    if (flash.current) {
      const p = clamp((t - flash.current) / FLASH_MS, 0, 1);
      ctx.fillStyle = `rgba(255, 255, 255, ${(p * p).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }
  };

  const nodeRadius = (n: Node): number => (n.star ? starRadius(n.star) : INTREPID_HIT);

  const drawGrid = (ctx: CanvasRenderingContext2D, w: number, h: number, v: ViewState) => {
    const step = 5;
    const minX = v.cx - w / 2 / v.scale;
    const maxX = v.cx + w / 2 / v.scale;
    const minY = v.cy - h / 2 / v.scale;
    const maxY = v.cy + h / 2 / v.scale;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = UI.muted;
    ctx.globalAlpha = 0.9;
    for (let gx = Math.ceil(minX / step) * step; gx <= maxX; gx += step) {
      const [sx] = toScreen({ x: gx, y: 0 });
      const px = Math.round(sx) + 0.5;
      ctx.strokeStyle = gx === 0 ? UI.gridBright : UI.grid;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
      if (gx % 10 === 0 && sx > 150 && sx < w - 30) {
        ctx.textAlign = "center";
        ctx.fillText(`${gx}`, sx, 12);
      }
    }
    for (let gy = Math.ceil(minY / step) * step; gy <= maxY; gy += step) {
      const [, sy] = toScreen({ x: 0, y: gy });
      const py = Math.round(sy) + 0.5;
      ctx.strokeStyle = gy === 0 ? UI.gridBright : UI.grid;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
      if (gy % 10 === 0 && sy > 50 && sy < h - 40) {
        ctx.textAlign = "right";
        ctx.fillText(`${gy}`, w - 6, sy - 3);
      }
    }
    ctx.restore();
  };

  const drawStar = (ctx: CanvasRenderingContext2D, n: Node, w: number) => {
    const s = n.star as StarSystem;
    const [x, y] = toScreen(n.pos);
    const r = starRadius(s);
    const color = SPECTRAL[s.spectral].color;
    const isHover = hovered === n.id;
    const pt = paint.get(n.id);

    if (s.home) {
      const hr = r * 8;
      const halo = ctx.createRadialGradient(x, y, r, x, y, hr);
      halo.addColorStop(0, "rgba(126, 231, 135, 0.16)");
      halo.addColorStop(1, "rgba(126, 231, 135, 0)");
      ctx.fillStyle = halo;
      ctx.fillRect(x - hr, y - hr, hr * 2, hr * 2);
    }

    const glow =ctx.createRadialGradient(x, y, 0, x, y, r * 4.5);
    glow.addColorStop(0, `${color}aa`);
    glow.addColorStop(0.3, `${color}33`);
    glow.addColorStop(1, `${color}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(x - r * 4.5, y - r * 4.5, r * 9, r * 9);

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fill();

    // exploration "paint": a thin ring that fills in as the system is scanned, landed on and walked
    if (pt && (pt.score > 0 || pt.progress.visited)) {
      const ringR = r + 9;
      const full = pt.score >= 0.995;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = UI.cyan;
      ctx.globalAlpha = 0.14;
      ctx.beginPath();
      ctx.arc(x, y, ringR, 0, Math.PI * 2);
      ctx.stroke();
      if (full) {
        ctx.fillStyle = UI.good;
        ctx.globalAlpha = 0.06;
        ctx.fill();
      }
      if (pt.score > 0) {
        ctx.strokeStyle = full ? UI.good : UI.cyan;
        ctx.globalAlpha = full ? 0.75 : 0.45;
        ctx.lineWidth = full ? 2 : 1.5;
        ctx.beginPath();
        ctx.arc(x, y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pt.score);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (targets.has(n.id)) {
      // Amber "!" badge: this system has contract work outstanding.
      const mx = x - r - 9;
      const my = y - r - 9;
      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, my, 8, 0, Math.PI * 2);
      ctx.fillStyle = UI.accent;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = UI.space;
      ctx.stroke();
      ctx.fillStyle = UI.space;
      ctx.font = `bold 12px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", mx, my + 0.5);
      ctx.restore();
    }

    if (state.visitedSystems.includes(n.id)) {
      const mx = x + r + 4;
      const my = y - r - 4;
      ctx.beginPath();
      ctx.moveTo(mx, my - 3.5);
      ctx.lineTo(mx + 3.5, my);
      ctx.lineTo(mx, my + 3.5);
      ctx.lineTo(mx - 3.5, my);
      ctx.closePath();
      ctx.fillStyle = UI.good;
      ctx.fill();
    }

    ctx.font = `${isHover ? "bold " : ""}12px ${FONT}`;
    ctx.fillStyle = s.charted ? UI.text : UI.muted;
    const flip = x + 140 > w;
    ctx.textAlign = flip ? "right" : "left";
    ctx.fillText(s.home ? `${n.name} ⌂` : n.name, flip ? x - r - 12 : x + r + 12, y + 4);

    const fp = plots.get(n.id);
    if (fp && plotLabels.has(n.id)) {
      ctx.font = `10px ${FONT}`;
      ctx.fillStyle = fp.fuel > state.ship.fuel ? UI.danger : UI.cyan;
      ctx.fillText(`fuel ${fp.fuel} · ${formatDuration(fp.refitMinutes)}`, flip ? x - r - 12 : x + r + 12, y + 17);
    }
  };

  const drawIntrepid = (ctx: CanvasRenderingContext2D) => {
    const [x, y] = toScreen(INTREPID_POS);
    const isHover = hovered === "intrepid";
    ctx.save();
    ctx.translate(x, y);
    const img = intrepidImg && intrepidImg.complete && intrepidImg.naturalWidth > 0 ? intrepidImg : null;
    if (img) {
      const w = INTREPID_W;
      const h = (img.naturalHeight / img.naturalWidth) * w;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      if (isHover) {
        ctx.strokeStyle = UI.intrepid;
        ctx.lineWidth = 1;
        ctx.strokeRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
      }
    } else {
      // fallback until the sprite loads: a long spindle with a blunt nose
      ctx.beginPath();
      ctx.moveTo(-13, -3.5);
      ctx.lineTo(8, -3.5);
      ctx.lineTo(15, 0);
      ctx.lineTo(8, 3.5);
      ctx.lineTo(-13, 3.5);
      ctx.closePath();
      ctx.fillStyle = "#12303f";
      ctx.fill();
      ctx.strokeStyle = UI.intrepid;
      ctx.lineWidth = isHover ? 2 : 1.25;
      ctx.stroke();
    }
    ctx.restore();
    ctx.font = `${isHover ? "bold " : ""}11px ${FONT}`;
    ctx.fillStyle = UI.intrepid;
    ctx.textAlign = "center";
    ctx.fillText("INTREPID", x, y + 20);
  };

  const drawTooltip = (ctx: CanvasRenderingContext2D, n: Node, w: number, h: number) => {
    const [x, y] = toScreen(n.pos);
    const d = n.id === fromId ? "you are here" : `${distanceLy(world.galaxy, fromId, n.id).toFixed(1)} ly`;
    const fp = plots.get(n.id);
    const lines: { text: string; color: string }[] = [
      { text: n.name, color: UI.text },
      { text: n.star ? `${SPECTRAL[n.star.spectral].label} · ${d}` : d, color: UI.muted },
    ];
    if (fp) lines.push({ text: `fold: ${fp.fuel} fuel, refit ${formatDuration(fp.refitMinutes)}`, color: UI.cyan });
    const jobs = targets.get(n.id) ?? [];
    for (const job of jobs.slice(0, 3)) lines.push({ text: `! ${job.title}`, color: UI.accent });
    if (jobs.length > 3) lines.push({ text: `! +${jobs.length - 3} more jobs here`, color: UI.accent });
    ctx.save();
    ctx.font = `11px ${FONT}`;
    const bw = Math.max(...lines.map((l) => ctx.measureText(l.text).width)) + 14;
    const bh = 8 + lines.length * 14;
    const bx = clamp(x + 16, 6, w - bw - 6);
    const by = clamp(y + 14, 6, h - bh - 6);
    ctx.fillStyle = "rgba(17, 24, 41, 0.92)";
    ctx.strokeStyle = "#36507a";
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "left";
    lines.forEach((l, i) => {
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, bx + 7, by + 14 + i * 14);
    });
    ctx.restore();
  };

  // --- side panel -------------------------------------------------------------------------

  const list = nodes
    .filter((n) => n.id !== fromId)
    .map((n) => ({ n, ly: distanceLy(world.galaxy, fromId, n.id) }))
    .sort((a, b) => a.ly - b.ly);

  return (
    <>
      <div class="viewport starmap" ref={wrap} onMouseDown={onMouseDown}>
        <Canvas
          draw={draw}
          animate
          onClick={onClick}
          onMove={onMove}
          onLeave={() => setHovered(null)}
          onWheel={onWheel}
          class={hovered ? "pointer" : ""}
        />
        <div class="viewport-tools">
          <button class="btn" onClick={fitAll}>
            Fit all
          </button>
          <button class="btn" onClick={centerOnShip}>
            Center on ship
          </button>
        </div>
        <div class="sm-legend">
          <div>
            <span class="good">◆</span> visited · <span class="sm-bang">!</span> contract work outstanding
          </div>
          <div>
            <span class="sm-ring">◯</span> ring: how thoroughly explored (full ring = painted)
          </div>
          <div>
            <span class="good">⌂</span> home systems: calm, surveyed by the first scouts
          </div>
        </div>
        <div class="viewport-hint">Wheel: zoom · Drag: pan · Click: select · Esc: clear</div>
      </div>

      <aside class="side">
        {target && plan && target.id !== fromId && (
          <section class="panel sm-depart">
            <h3>Fold plan: {target.name}</h3>
            <dl class="kv">
              <dt>Distance</dt>
              <dd class={plan.ly > stats.foldRangeLy ? "danger" : ""}>
                {plan.ly.toFixed(1)} / {stats.foldRangeLy} ly range
              </dd>
              <dt>Fuel</dt>
              <dd class={plan.fuel > state.ship.fuel ? "danger" : ""}>
                {plan.fuel} of {state.ship.fuel.toFixed(1)}
              </dd>
              <dt>Refit after</dt>
              <dd>{formatDuration(plan.refitMinutes)}</dd>
              <dt>Drive now</dt>
              <dd class={refitLeft > 0 ? "accent" : "good"}>{refitLeft > 0 ? `Refit, ${formatDuration(refitLeft)} left` : "Ready"}</dd>
              {yardLeft > 0 && (
                <>
                  <dt>Yard work</dt>
                  <dd class="accent">Done in {formatDuration(yardLeft)}</dd>
                </>
              )}
            </dl>
            {(hardBlockers.length > 0 || edgeProblem) && (
              <ul class="blockers sm-blockers">
                {hardBlockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
                {edgeProblem && hardBlockers.length === 0 && <li>{edgeProblem}</li>}
              </ul>
            )}
            <div class="btn-row sm-fold">
              {plan.blockers.length === 0 ? (
                <button class="btn primary big" disabled={session.busy} onClick={() => doFold(false)}>
                  Fold now
                </button>
              ) : canDepart ? (
                <button class="btn primary big" disabled={session.busy} onClick={() => doFold(true)}>
                  Fold when ready{autoLabel ? ` (${autoLabel})` : ""}
                </button>
              ) : (
                <button class="btn primary big" disabled>
                  Can't fold yet
                </button>
              )}
            </div>
            {softBlockers.length > 0 && canDepart && (
              <p class="muted small sm-auto-note">
                {needsEdge ? "Folds start at the system edge, so the ship flies out first. " : ""}
                {waitMinutes > 0 ? (docked ? "Then it waits aboard until the refit and the yard are done. " : "Then it holds position until the drive's refit is done. ") : ""}
                Same time and fuel as doing it by hand.
              </p>
            )}
          </section>
        )}

        <div class="btn-row sm-top">
          <button class="btn" onClick={back} disabled={session.busy}>
            ◂ Back to {docked ? "the Intrepid" : "the system"}
          </button>
        </div>

        {target ? (
          <>
            <section class="panel">
              <h2>{target.name}</h2>
              <dl class="kv">
                <dt>Type</dt>
                <dd>{target.star ? SPECTRAL[target.star.spectral].label : "Generation ship"}</dd>
                {target.star && (
                  <>
                    <dt>Mass</dt>
                    <dd>{target.star.mass.toFixed(2)} M☉</dd>
                    <dt>Luminosity</dt>
                    <dd>{target.star.luminosity.toFixed(2)} L☉</dd>
                  </>
                )}
                <dt>Distance</dt>
                <dd>{target.id === fromId ? "You are here" : `${distanceLy(world.galaxy, fromId, target.id).toFixed(1)} ly`}</dd>
                <dt>Status</dt>
                <dd>
                  {target.star ? (
                    <>
                      <span class={`tag ${target.star.charted ? "" : "sm-uncharted"}`}>{target.star.charted ? "Charted" : "Uncharted"}</span>{" "}
                      {state.visitedSystems.includes(target.id) && <span class="tag good">Visited</span>}
                    </>
                  ) : (
                    <span class="tag good">Home</span>
                  )}
                </dd>
              </dl>
            </section>

            {target.star && (
              <ExplorationBlock
                star={target.star}
                paint={paint.get(target.id)}
                contracts={targets.get(target.id) ?? []}
              />
            )}

            {target.star && (
              <section class="panel">
                <h3>Known bodies</h3>
                {known(target) ? (
                  <>
                    <LandableSummary session={session} systemId={target.id} />
                    <BodyList session={session} systemId={target.id} />
                  </>
                ) : (
                  <div class="muted">Uncharted: no survey data.</div>
                )}
              </section>
            )}

            {target.star && known(target) && (
              <section class="panel">
                <h3>Minerals</h3>
                <MineralList session={session} systemId={target.id} />
              </section>
            )}
          </>
        ) : (
          <section class="panel">
            <h2>Navigation</h2>
            <p class="muted">
              Pick a star on the chart or from the list below. The dashed circle is how far the fold drive can reach from where you
              are.
            </p>
          </section>
        )}

        <section class="panel">
          <h3>All systems by distance</h3>
          <table class="data sm-list">
            <tbody>
              {list.map(({ n, ly }) => (
                <tr
                  key={n.id}
                  tabIndex={0}
                  class={`${selected === n.id ? "sel" : ""} ${hovered === n.id ? "hov" : ""}`}
                  onClick={() => !session.busy && setSelected(n.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      if (!session.busy) setSelected(n.id);
                    }
                  }}
                  onMouseEnter={() => setHovered(n.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <td class={n.star && !n.star.charted ? "muted" : ""}>
                    {n.name}
                    {n.star?.home && <span class="good" title="Home system"> ⌂</span>}
                    {state.visitedSystems.includes(n.id) && <span class="good" title="Visited"> ◆</span>}
                    {targets.has(n.id) && (
                      <span class="sm-bang" title={`Contract work here: ${(targets.get(n.id) ?? []).map((c) => c.title).join("; ")}`}>
                        !
                      </span>
                    )}
                  </td>
                  <td class="muted">{n.star ? n.star.spectral : "ship"}</td>
                  <td class="sm-prog">
                    {paint.get(n.id) && (
                      <span class="sm-minibar" title={`${Math.round((paint.get(n.id)?.score ?? 0) * 100)}% explored`}>
                        <span style={{ width: `${Math.round((paint.get(n.id)?.score ?? 0) * 100)}%` }} />
                      </span>
                    )}
                  </td>
                  <td class={`num ${ly > stats.foldRangeLy ? "danger" : ""}`}>{ly.toFixed(1)} ly</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </aside>
    </>
  );
}

function ExplorationBlock({ star, paint, contracts }: { star: StarSystem; paint: Paint | undefined; contracts: Contract[] }) {
  const p = paint?.progress;
  return (
    <section class="panel">
      <h3>Exploration</h3>
      {star.home && (
        <div class="good small sm-gap">⌂ Home system: calm, surveyed by the first scouts. A gentle place to learn the work.</div>
      )}
      {p ? (
        <dl class="kv">
          <dt>Explored</dt>
          <dd>
            <span class="sm-minibar wide">
              <span style={{ width: `${Math.round((paint?.score ?? 0) * 100)}%` }} />
            </span>{" "}
            {Math.round((paint?.score ?? 0) * 100)}%
          </dd>
          <dt>Bodies scanned</dt>
          <dd>
            {p.scanned} / {p.bodies}
          </dd>
          <dt>Bodies surveyed</dt>
          <dd>
            {p.surveyed} / {p.bodies}
          </dd>
          <dt>Worlds landed on</dt>
          <dd>{p.landed}</dd>
          <dt>Regions visited</dt>
          <dd>
            {p.regionsVisited} / {p.regionsTotal}
          </dd>
        </dl>
      ) : (
        <div class="muted small">Uncharted: nothing on record.</div>
      )}
      {contracts.length > 0 && (
        <div class="sm-contracts">
          <h3 class="accent">! Contracts pointing here</h3>
          <ul>
            {contracts.map((c) => (
              <li key={c.id}>
                <strong>{c.title}</strong> <span class="muted">({CLAN_NAMES[c.clan]})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Estimated worth of a world's richest region, cached per sensor tier and drill reach (it's not cheap). */
const valueCache = new Map<string, { best: number; average: number } | null>();
function worldValue(session: GameSession, body: Body): { best: number; average: number } | null {
  const { state } = session;
  const key = `${state.seed}|${body.id}|${orbitalSensorTier(state, body.id)}|${effectiveStats(state).drillMaxDepthM}|${state.scannedBodies.includes(body.id)}`;
  if (!valueCache.has(key)) valueCache.set(key, bodyValueEstimate(state, body));
  return valueCache.get(key) ?? null;
}

const kcr = (v: number): string => (v >= 1000 ? `~${Math.round(v / 1000).toLocaleString()}k cr` : `~${Math.round(v / 100) * 100} cr`);

function LandableSummary({ session, systemId }: { session: GameSession; systemId: string }) {
  const bodies = landableBodies(session.state, session.world, systemId);
  const n = bodies.length;
  const best = Math.max(0, ...bodies.map((b) => worldValue(session, b)?.best ?? 0));
  return n > 0 ? (
    <div class="good small">
      {n} world{n === 1 ? "" : "s"} your ship can land on and mine (marked ▼)
      {best > 0 && (
        <span class="muted" title="Estimated ore value of the richest region on any world you can land on here, as your sensors read it">
          {" "}
          · richest landing {kcr(best)}
        </span>
      )}
    </div>
  ) : (
    <div class="danger small">No worlds here your ship can land on yet. Check gravity, heat and radiation ratings in the shipyard.</div>
  );
}

const MINERAL_BODIES_SHOWN = 3;

/** Known minerals in a system (orbital scans plus deposits the rover has found), flagging what active delivery jobs need. */
function MineralList({ session, systemId }: { session: GameSession; systemId: string }) {
  const { state, world } = session;
  const minerals: SystemMineral[] = systemMinerals(state, world, systemId);
  if (minerals.length === 0) return <div class="muted small">No scans on record here yet. Scan the worlds to see what they hold.</div>;
  const wanted = new Map<string, number>();
  for (const c of state.contracts ?? []) {
    if (c.status === "active" && c.kind === "deliver" && c.commodity) wanted.set(c.commodity, (wanted.get(c.commodity) ?? 0) + (c.tonnes ?? 0));
  }
  const research = researchWants(state);
  return (
    <ul class="sm-minerals">
      {minerals.map((m) => {
        const need = wanted.get(m.commodity);
        const forResearch = research.get(m.commodity);
        const shown = m.bodies.slice(0, MINERAL_BODIES_SHOWN);
        const rest = m.bodies.slice(MINERAL_BODIES_SHOWN);
        return (
          <li key={m.commodity} class={need !== undefined || forResearch !== undefined ? "wanted" : ""}>
            <div class="sm-mineral-head">
              <span class="sm-dot" style={{ background: COMMODITIES[m.commodity].color }} />
              <span class="sm-mineral-name">{COMMODITIES[m.commodity].name}</span>
              {need !== undefined && (
                <span class="tag accent-tag" title="An active delivery contract needs this commodity">
                  ◆ contract: {tonnes(need)}
                </span>
              )}
              {forResearch !== undefined && (
                <span class="tag accent-tag" title="A research project you're tracking needs this">
                  ◇ research: {tonnes(forResearch)}
                </span>
              )}
            </div>
            <div class="sm-mineral-bodies small">
              {shown.map((b, i) => (
                <span key={b.bodyId}>
                  {i > 0 && ", "}
                  {b.landable ? (
                    <span title="Landable with your current ship">
                      {b.name} <span class="good">▼</span>
                    </span>
                  ) : (
                    <span class="danger" title="can't land with the current ship">
                      {b.name}
                    </span>
                  )}
                </span>
              ))}
              {rest.length > 0 && (
                <span class="muted" title={rest.map((b) => `${b.name}${b.landable ? " ▼" : " (can't land with the current ship)"}`).join(", ")}>
                  {" "}
                  +{rest.length} more
                </span>
              )}
            </div>
            {m.found.count > 0 && (
              <div class="small accent" title="Deposits the rover has found and not yet worked out; reachable means within your drill's depth on a world you can land on">
                found: {tonnes(m.found.tonnes)}, {tonnes(m.found.reachableTonnes)} reachable
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function BodyList({ session, systemId }: { session: GameSession; systemId: string }) {
  const { bodies } = session.world.system(systemId);
  const landable = new Set(landableBodies(session.state, session.world, systemId).map((b) => b.id));
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const rows: { body: Body; moon: boolean }[] = [];
  const tops = bodies.filter((b) => b.parentId === null).sort((a, b) => a.orbitAU - b.orbitAU);
  for (const b of tops) {
    rows.push({ body: b, moon: false });
    for (const id of b.moonIds) {
      const m = byId.get(id);
      if (m) rows.push({ body: m, moon: true });
    }
  }
  if (rows.length === 0) return <div class="muted">No bodies on record.</div>;
  return (
    <ul class="sm-bodies">
      {rows.map(({ body, moon }) => (
        <li key={body.id} class={moon ? "moon" : ""}>
          <span class="sm-dot" style={{ background: BODY_COLOR[body.kind] }} />
          <span class="sm-body-name">
            {body.name}
            {bodyNickname(session.state, body) && <span class="muted"> · {bodyNickname(session.state, body)}</span>}
            {body.easy && (
              <>
                {" "}
                <span class="tag good" title="A calm world: mild hazards and shallow seams, good for new captains.">
                  calm
                </span>
              </>
            )}
            {landable.has(body.id) && <span class="good" title="Landable with your current ship"> ▼</span>}
          </span>
          {landable.has(body.id) && worldValue(session, body) ? (
            <span
              class="accent small"
              title={`Estimated ore value of the richest region (average region ${kcr(worldValue(session, body)!.average)}), as your sensors read it`}
            >
              {kcr(worldValue(session, body)!.best)}
            </span>
          ) : (
            <span class="muted">{KIND_LABEL[body.kind]}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
