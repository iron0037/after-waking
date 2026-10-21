/** The navigator's chart of the Verge: pick a star, read the plan, fold. */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  clamp,
  currentSystemId,
  distanceLy,
  fold,
  foldPlan,
  formatDuration,
  INTREPID_POS,
  KIND_LABEL,
  landableBodies,
  positionOf,
  shipStats,
  SPECTRAL,
  type Body,
  type StarSystem,
  type Vec2,
} from "../../sim";
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

const INTREPID_HIT = 16;

/** Star dot radius in pixels: luminosity on a log scale, in a small range. */
function starRadius(s: StarSystem): number {
  const t = (Math.log10(s.luminosity) + 2.7) / 4;
  return 2.5 + clamp(t, 0, 1) * 3.5;
}

export function StarMap({ session }: { session: GameSession }) {
  useSession(session);
  const { state, world } = session;
  const fromId = currentSystemId(state);
  const docked = state.location.kind === "intrepid";

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

  const stats = shipStats(state.ship);
  const here = positionOf(world.galaxy, fromId);
  const target = selected ? (byId.get(selected) ?? null) : null;
  const plan = target ? foldPlan(state, world, target.id) : null;

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
    setSelected(hitTest(x, y));
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

  const doFold = () => {
    if (!target || session.busy || !plan || plan.blockers.length > 0) return;
    const id = target.id;
    flash.current = performance.now();
    session.setBusy(true);
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      flash.current = 0;
      const result = session.act((s, w) => fold(s, w, id));
      session.setBusy(false);
      if (result.ok) session.go(session.state.location.kind === "intrepid" ? "hub" : "system");
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

    // stars
    for (const n of nodes) {
      if (n.star) drawStar(ctx, n, w);
    }
    drawIntrepid(ctx);

    // you are here
    const base = fromId === "intrepid" ? 24 : starRadius(byId.get(fromId)?.star as StarSystem) + 9;
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
      const len = 6;
      ctx.save();
      ctx.strokeStyle = UI.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        ctx.moveTo(x + sx * half, y + sy * (half - len));
        ctx.lineTo(x + sx * half, y + sy * half);
        ctx.lineTo(x + sx * (half - len), y + sy * half);
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

    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4.5);
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
    ctx.fillText(n.name, flip ? x - r - 7 : x + r + 7, y + 4);
  };

  const drawIntrepid = (ctx: CanvasRenderingContext2D) => {
    const [x, y] = toScreen(INTREPID_POS);
    const isHover = hovered === "intrepid";
    ctx.save();
    ctx.translate(x, y);
    // engine glow
    const glow = ctx.createRadialGradient(-13, 0, 0, -13, 0, 14);
    glow.addColorStop(0, "rgba(95, 212, 255, 0.55)");
    glow.addColorStop(1, "rgba(95, 212, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-28, -14, 30, 28);
    // hull: a long spindle with a blunt nose
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
    // spine lights
    ctx.fillStyle = UI.intrepid;
    for (let i = -9; i <= 5; i += 4) ctx.fillRect(i, -0.5, 2, 1);
    ctx.restore();
    ctx.font = `${isHover ? "bold " : ""}11px ${FONT}`;
    ctx.fillStyle = UI.intrepid;
    ctx.textAlign = "center";
    ctx.fillText("INTREPID", x, y + 20);
  };

  const drawTooltip = (ctx: CanvasRenderingContext2D, n: Node, w: number, h: number) => {
    const [x, y] = toScreen(n.pos);
    const d = n.id === fromId ? "you are here" : `${distanceLy(world.galaxy, fromId, n.id).toFixed(1)} ly`;
    const lines = [n.name, n.star ? `${SPECTRAL[n.star.spectral].label} · ${d}` : d];
    ctx.save();
    ctx.font = `11px ${FONT}`;
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14;
    const bh = 36;
    const bx = clamp(x + 16, 6, w - bw - 6);
    const by = clamp(y + 14, 6, h - bh - 6);
    ctx.fillStyle = "rgba(17, 24, 41, 0.92)";
    ctx.strokeStyle = "#36507a";
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = UI.text;
    ctx.fillText(lines[0] as string, bx + 7, by + 14);
    ctx.fillStyle = UI.muted;
    ctx.fillText(lines[1] as string, bx + 7, by + 28);
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
        <div class="viewport-hint">
          Wheel: zoom · Drag: pan · Click: select · Esc: clear · <span class="good">◆</span> visited
        </div>
      </div>

      <aside class="side">
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

            {plan && target.id !== fromId && (
              <section class="panel">
                <h3>Fold plan</h3>
                <dl class="kv">
                  <dt>Fuel</dt>
                  <dd class={plan.fuel > state.ship.fuel ? "danger" : ""}>
                    {plan.fuel} of {state.ship.fuel.toFixed(1)}
                  </dd>
                  <dt>Drive recharge</dt>
                  <dd>{formatDuration(plan.rechargeMinutes)}</dd>
                  <dt>Range</dt>
                  <dd class={plan.ly > stats.foldRangeLy ? "danger" : ""}>
                    {plan.ly.toFixed(1)} / {stats.foldRangeLy} ly
                  </dd>
                </dl>
                {plan.blockers.length > 0 && (
                  <ul class="blockers sm-blockers">
                    {plan.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
                <div class="btn-row sm-fold">
                  <button class="btn primary big" disabled={plan.blockers.length > 0 || session.busy} onClick={doFold}>
                    Fold to {target.name}
                  </button>
                </div>
              </section>
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
                    {state.visitedSystems.includes(n.id) && <span class="good"> ◆</span>}
                  </td>
                  <td class="muted">{n.star ? n.star.spectral : "ship"}</td>
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

function LandableSummary({ session, systemId }: { session: GameSession; systemId: string }) {
  const n = landableBodies(session.state, session.world, systemId).length;
  return n > 0 ? (
    <div class="good small">
      {n} world{n === 1 ? "" : "s"} your ship can land on and mine (marked ▼)
    </div>
  ) : (
    <div class="danger small">No worlds here your ship can land on yet. Check gravity, heat and radiation ratings in the shipyard.</div>
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
            {landable.has(body.id) && <span class="good" title="Landable with your current ship"> ▼</span>}
          </span>
          <span class="muted">{KIND_LABEL[body.kind]}</span>
        </li>
      ))}
    </ul>
  );
}
