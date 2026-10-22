/**
 * Landing-region chart: the body's surface unrolled into an equirectangular map, divided into the
 * same grid of regions the rover drives across. Terrain tint comes from the same
 * noise as the planet art; the orbital scan's signal is the amber glow over each region.
 */
import { useMemo, useRef, useState } from "preact/hooks";
import { COMMODITIES } from "../../../data/commodities";
import {
  exploredFraction,
  knownDeposits,
  regionKey,
  regionRecap,
  regionSignal,
  surfaceLayout,
  type Body,
  type GameState,
  type KnownDeposit,
  type World,
} from "../../../sim";
import { Canvas } from "../../Canvas";
import { UI } from "../../palette";
import { surfaceMap } from "./planetArt";
import { rgba, roughCredits } from "./util";

export interface RegionPickerProps {
  body: Body;
  state: GameState;
  world: World;
  sensorTier: number;
  /** Drill reach in metres: tier 2+ sensors count only seams within it. */
  reachM: number;
  selected: number;
  /** False when the ship can't set down: the chart stays readable and selectable, just framed as intel. */
  landable?: boolean;
  onSelect: (region: number) => void;
}

// --- layout ------------------------------------------------------------------------------

/** A region's rectangle on the map, in 0..1 of the map's width and height. */
interface Cell {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

interface Layout {
  cols: number;
  rows: number;
  /** One per region, in region order. Cells past the last region (end of the last row) stay empty. */
  cells: Cell[];
}

/**
 * The same cols × rows grid the rover drives across (sim surfaceLayout), so a region's
 * neighbours on this chart are the ones the rover reaches by driving over the border.
 */
export function regionLayout(body: Body): Layout {
  const { cols, rows, regions } = surfaceLayout(body);
  const cells: Cell[] = [];
  for (let r = 0; r < regions; r++) {
    const c = r % cols;
    const row = Math.floor(r / cols);
    cells.push({ x0: c / cols, x1: (c + 1) / cols, y0: row / rows, y1: (row + 1) / rows });
  }
  return { cols, rows, cells };
}

/** Region under a point given in 0..1 map coordinates (clamped to the last region in the empty corner). */
function regionAt(layout: Layout, u: number, v: number): number {
  const c = Math.min(layout.cols - 1, Math.max(0, Math.floor(u * layout.cols)));
  const row = Math.min(layout.rows - 1, Math.max(0, Math.floor(v * layout.rows)));
  return Math.min(layout.cells.length - 1, row * layout.cols + c);
}

// --- component ---------------------------------------------------------------------------

export function RegionPicker({ body, state, world, sensorTier, reachM, selected, landable = true, onSelect }: RegionPickerProps) {
  const [hover, setHover] = useState<number | null>(null);
  const sizeRef = useRef({ w: 1, h: 1 });
  const seed = state.seed;

  const signals = useMemo(
    () => Array.from({ length: body.regions }, (_, r) => regionSignal(seed, body, r, sensorTier, reachM)),
    [seed, body, sensorTier, reachM],
  );
  const layout = useMemo(() => regionLayout(body), [body]);
  const known = knownDeposits(state, world, body.id);
  const max = Math.max(...signals, 0);
  const min = Math.min(...signals);
  const norm = (s: number) => (max - min < 1e-6 ? 0 : (s - min) / (max - min));

  const describe = (r: number) => {
    const s = signals[r] ?? 0;
    const t = norm(s);
    const strength = s <= 0 ? "none" : t > 0.66 ? "strong" : t > 0.33 ? "moderate" : "faint";
    const know = state.regions[regionKey(body.id, r)];
    const visits = know?.visits ?? 0;
    const est = s > 0 ? ` (~${roughCredits(s)} cr est.)` : "";
    const seen = visits > 0 ? ` · visited, ${Math.round(exploredFraction(know) * 100)}% explored` : "";
    return `Region ${r + 1} · signal ${strength}${est}${seen}`;
  };

  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    sizeRef.current = { w, h };
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(surfaceMap(seed, body, 192, 96), 0, 0, w, h);
    ctx.restore();

    // The end of the last row holds no regions: uncharted.
    const last = layout.cells[layout.cells.length - 1];
    if (last && last.x1 < 0.9999) {
      ctx.fillStyle = rgba("#05070f", 0.85);
      ctx.fillRect(last.x1 * w, last.y0 * h, w - last.x1 * w, (last.y1 - last.y0) * h);
    }

    layout.cells.forEach((cell, r) => {
      const x = cell.x0 * w;
      const y = cell.y0 * h;
      const cw = (cell.x1 - cell.x0) * w;
      const ch = (cell.y1 - cell.y0) * h;
      const s = signals[r] ?? 0;
      const t = s <= 0 ? 0 : Math.pow(norm(s), 0.8);

      // Weak regions sink into shadow; strong ones take a warm tint.
      ctx.fillStyle = rgba("#05070f", s <= 0 ? 0.72 : 0.5 * (1 - t));
      ctx.fillRect(x, y, cw, ch);
      if (t > 0) {
        ctx.fillStyle = rgba(UI.accent, 0.55 * t);
        ctx.fillRect(x, y, cw, ch);
        if (t > 0.33) {
          ctx.strokeStyle = rgba(UI.accent, t > 0.66 ? 0.95 : 0.5);
          ctx.lineWidth = t > 0.66 ? 2 : 1;
          ctx.strokeRect(x + 1.5, y + 1.5, cw - 3, ch - 3);
        }
      }

      ctx.strokeStyle = rgba("#05070f", 0.6);
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);

      const know = state.regions[regionKey(body.id, r)];
      if ((know?.visits ?? 0) > 0) {
        const explored = exploredFraction(know);
        ctx.strokeStyle = UI.cyan;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 2.5, y + 2.5, cw - 5, ch - 5);
        const barH = 3;
        ctx.fillStyle = rgba("#05070f", 0.7);
        ctx.fillRect(x + 3, y + ch - 3 - barH, cw - 6, barH);
        ctx.fillStyle = UI.cyan;
        ctx.fillRect(x + 3, y + ch - 3 - barH, (cw - 6) * Math.max(0.08, explored), barH);
      }
    });

    // Known, untapped deposits: a row of commodity-coloured dots along the top of their region.
    const byRegion = new Map<number, KnownDeposit[]>();
    for (const k of known) byRegion.set(k.region, [...(byRegion.get(k.region) ?? []), k]);
    for (const [r, list] of byRegion) {
      const cell = layout.cells[r];
      if (!cell) continue;
      const dot = Math.max(2, Math.min(4, ((cell.x1 - cell.x0) * w) / 14));
      list.slice(0, 5).forEach((k, i) => {
        const x = cell.x0 * w + 5 + dot + i * (dot * 2 + 2);
        const y = cell.y0 * h + 5 + dot;
        ctx.beginPath();
        ctx.arc(x, y, dot, 0, Math.PI * 2);
        ctx.fillStyle = COMMODITIES[k.commodity].color;
        ctx.globalAlpha = k.reachable ? 1 : 0.45;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        ctx.strokeStyle = "#05070f";
        ctx.stroke();
      });
    }

    const hc = hover !== null && hover !== selected ? layout.cells[hover] : undefined;
    if (hc) {
      ctx.strokeStyle = UI.text;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(hc.x0 * w + 1, hc.y0 * h + 1, (hc.x1 - hc.x0) * w - 2, (hc.y1 - hc.y0) * h - 2);
    }

    // Reticle: a solid frame, corner brackets that stand proud of the cell, and a center mark.
    const sc = layout.cells[selected];
    if (sc) {
      const x = sc.x0 * w;
      const y = sc.y0 * h;
      const cw = (sc.x1 - sc.x0) * w;
      const ch = (sc.y1 - sc.y0) * h;
      ctx.save();
      ctx.strokeStyle = UI.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, cw - 2, ch - 2);
      const len = Math.min(9, cw / 3, ch / 3);
      const o = 3;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const corners: [number, number, number, number][] = [
        [x - o, y - o, 1, 1],
        [x + cw + o, y - o, -1, 1],
        [x - o, y + ch + o, 1, -1],
        [x + cw + o, y + ch + o, -1, -1],
      ];
      for (const [cx, cy, dx, dy] of corners) {
        ctx.moveTo(cx + dx * len, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + dy * len);
      }
      ctx.stroke();
      const mx = x + cw / 2;
      const my = y + ch / 2;
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = rgba(UI.accent, 0.9);
      ctx.beginPath();
      ctx.arc(mx, my, Math.max(1.5, Math.min(4, cw / 5, ch / 5)), 0, Math.PI * 2);
      ctx.moveTo(mx - 7, my);
      ctx.lineTo(mx - 3, my);
      ctx.moveTo(mx + 3, my);
      ctx.lineTo(mx + 7, my);
      ctx.moveTo(mx, my - 7);
      ctx.lineTo(mx, my - 3);
      ctx.moveTo(mx, my + 3);
      ctx.lineTo(mx, my + 7);
      ctx.stroke();
      ctx.restore();
    }
  };

  const regionFor = (x: number, y: number): number => {
    const { w, h } = sizeRef.current;
    return regionAt(layout, Math.min(0.9999, Math.max(0, x / w)), Math.min(0.9999, Math.max(0, y / h)));
  };

  const onKey = (ev: KeyboardEvent) => {
    let next: number | undefined;
    if (ev.key === "ArrowLeft") next = Math.max(0, selected - 1);
    else if (ev.key === "ArrowRight") next = Math.min(body.regions - 1, selected + 1);
    else if (ev.key === "ArrowUp") next = selected - layout.cols >= 0 ? selected - layout.cols : selected;
    else if (ev.key === "ArrowDown") next = selected + layout.cols < body.regions ? selected + layout.cols : selected;
    if (next === undefined) return;
    ev.preventDefault();
    onSelect(next);
  };

  return (
    <div class="sys-regions">
      <h3 class="sys-region-title">{landable ? "Choose a landing region" : "Surface regions"}</h3>
      <div class="muted small">
        {landable
          ? "Click the map to pick where to set down. Amber marks stronger mineral signals; cyan outlines are places you've been."
          : "This ship can't land here, but a detailed survey still sharpens these readings. Amber marks stronger signals."}
      </div>
      <div
        class="sys-map"
        tabIndex={0}
        role="group"
        aria-label={`Surface map of ${body.name}, ${body.regions} regions. Arrow keys change the selected region.`}
        onKeyDown={onKey}
      >
        <Canvas
          draw={draw}
          class="sys-map-canvas"
          onClick={(x, y) => onSelect(regionFor(x, y))}
          onMove={(x, y) => {
            const r = regionFor(x, y);
            if (r !== hover) setHover(r);
          }}
          onLeave={() => setHover(null)}
        />
        <span class="sys-map-pole sys-map-n">N</span>
        <span class="sys-map-pole sys-map-s">S</span>
      </div>
      <div class="sys-region-readout small" aria-live="polite">
        {describe(hover ?? selected)}
      </div>
      <div class="sys-region-legend small muted">
        <span>faint</span>
        <span class="sys-region-ramp" />
        <span>strong</span>
        <span class="sys-region-key">
          <span class="sys-region-swatch" /> visited
        </span>
      </div>
      <RegionRecapBox state={state} world={world} bodyId={body.id} region={selected} />
      <KnownDepositsBox known={known} selected={selected} onSelect={onSelect} />
    </div>
  );
}

/** "You've been here before": what's already known about the selected region. */
function RegionRecapBox({ state, world, bodyId, region }: { state: GameState; world: World; bodyId: string; region: number }) {
  const recap = regionRecap(state, world, bodyId, region);
  if (!recap) return null;
  const worked = recap.reachableTonnes <= 0 && recap.floraUnsampled === 0 && recap.explored > 0.5;
  return (
    <div class="sys-recap small">
      You've been here before ({recap.visits}×): {Math.round(recap.explored * 100)}% explored · {recap.depositsKnown}{" "}
      {recap.depositsKnown === 1 ? "deposit" : "deposits"} known · {Math.round(recap.reachableTonnes).toLocaleString()} t reachable left
      {recap.floraUnsampled > 0 && (
        <>
          {" "}
          · {recap.floraUnsampled} flora {recap.floraUnsampled === 1 ? "site" : "sites"} unsampled
        </>
      )}
      {worked && <div class="accent sys-recap-warn">Looks worked out — try a fresh region.</div>}
    </div>
  );
}

/** Untapped deposits found on earlier landings, anywhere on this world: pick one to land near it. */
function KnownDepositsBox({ known, selected, onSelect }: { known: KnownDeposit[]; selected: number; onSelect: (region: number) => void }) {
  if (known.length === 0) return null;
  return (
    <div class="sys-known">
      <h3>Known deposits</h3>
      <table class="data sys-known-table">
        <thead>
          <tr>
            <th>Commodity</th>
            <th class="num">Left</th>
            <th class="num">Region</th>
          </tr>
        </thead>
        <tbody>
          {known.map((k) => (
            <tr
              key={k.key}
              class={`${k.region === selected ? "sel" : ""} ${k.reachable ? "" : "dim"}`}
              onClick={() => onSelect(k.region)}
              title={`${k.depthM} m down${k.reachable ? "" : " (beyond your drill)"}${k.prospected ? `, grade ${Math.round(k.grade * 100)}%` : ", not yet prospected"}. Click to pick region ${k.region + 1}.`}
            >
              <td>
                <i class="swatch" style={{ background: COMMODITIES[k.commodity].color }} />
                {COMMODITIES[k.commodity].name}
                {!k.reachable && <span class="danger small"> too deep</span>}
              </td>
              <td class="num">{Math.round(k.remainingT).toLocaleString()} t</td>
              <td class="num">{k.region + 1}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="muted small">Found by your rover on earlier landings. Dots on the chart mark where they are.</div>
    </div>
  );
}

/** Index of the strongest-signal region, preferring ones not yet visited. */
export function bestRegion(state: GameState, body: Body, sensorTier: number, reachM: number): number {
  let best = 0;
  let bestScore = -1;
  for (let r = 0; r < body.regions; r++) {
    const visited = (state.regions[regionKey(body.id, r)]?.visits ?? 0) > 0;
    const score = regionSignal(state.seed, body, r, sensorTier, reachM) * (visited ? 0.5 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}
