/** Planet surface: a survey map of one region, the rover, and the prospect → drill → haul loop. */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { COMMODITIES } from "../../data/commodities";
import {
  canEnter,
  cargoTonnes,
  collectSample,
  currentRegion,
  deployRover,
  dirBetween,
  DIR_ANGLE,
  disk,
  DRILL_ENERGY_PER_HOUR,
  DRILL_SETUP_ENERGY,
  DRILL_SETUP_MINUTES,
  drill,
  exploredFraction,
  formatDuration,
  formatPressure,
  hexDistance,
  HOP_MINUTES,
  hopFuel,
  HOUR,
  KEY_TO_DIR,
  KIND_LABEL,
  knowledge,
  launch,
  moveRoverTo,
  isExplored,
  PROSPECT_ENERGY,
  PROSPECT_MINUTES,
  prospect,
  RECALL_FUEL,
  recallRover,
  rechargeRover,
  relocateShip,
  remainingTonnes,
  ROVER_CHARGE_PER_HOUR,
  ROVER_SPECIMEN_SLOTS,
  SAMPLE_ENERGY,
  SAMPLE_MINUTES,
  sensorTierFor,
  shipStats,
  shipTile,
  SHIP_SPECIMEN_SLOTS,
  SHIFT_FACTOR,
  specimenCount,
  specimensFrom,
  step,
  stowRover,
  Terrain,
  TERRAIN_INFO,
  type Deposit,
  type FloraSite,
  type GameState,
  type HexDir,
  type Location,
  type PathStep,
  type RegionKnowledge,
  type RegionMap,
  type RoverState,
  type Vec2,
  workDeposit,
} from "../../sim";
import { cargoList, pct, tonnes } from "../format";
import { TERRAIN_COLORS, UI } from "../palette";
import { useSession, type GameSession } from "../session";
import { Canvas } from "../Canvas";
import {
  computeLayout,
  drawBase,
  drawBlockedTile,
  drawDeposits,
  drawEnergyBar,
  drawFlora,
  drawHoverTile,
  drawRoute,
  drawRover,
  drawSensorRange,
  drawShip,
  drawTooltip,
  tileAt,
  tileCenter,
  type EnergyPreview,
  type Layout,
  type Reveal,
  type TipLine,
} from "./surface/mapDraw";
import { affordablePrefix, energyHome, evaluate, planPath, type RoutePlan } from "./surface/routing";
import { Section } from "./surface/Section";
import { buildFoggedImage, buildTerrainImage, composePainted } from "./surface/terrainImage";
import "./surface.css";

type SurfaceLoc = Extract<Location, { kind: "surface" }>;

/** Milliseconds of animation per tile driven. */
const STEP_MS = 70;

interface Anim {
  pts: Vec2[];
  /** Cumulative energy spent on arrival at each point in `pts`. */
  cum: number[];
  t0: number;
}

/** Degrees per second the rover sprite turns at. */
const TURN_DEG_PER_S = 900;
/** Below this share of full charge, a rover that pulls up beside the ship is offered a recharge. */
const RECHARGE_HINT_BELOW = 0.6;

/** Compass heading (0 = north, clockwise) of a single hex step; null if the tiles aren't adjacent. */
function headingOf(from: Vec2, to: Vec2): number | null {
  const dir = dirBetween(from, to);
  // DIR_ANGLE is 0 = east, clockwise; the sprite's nose points north.
  return dir ? (DIR_ANGLE[dir] + 90) % 360 : null;
}

interface Hover {
  tile: Vec2;
  px: number;
  py: number;
}

/** Keyboard driving, one hex per press: Q/E/A/D/Z/C (nw/ne/w/e/sw/se), plus Left/Right arrows for w/e. */
const KEY_DIRS: Record<string, HexDir> = { ...KEY_TO_DIR, arrowleft: "w", arrowright: "e" };

export function SurfaceView({ session }: { session: GameSession }) {
  useSession(session);
  const loc = session.state.location;
  if (loc.kind !== "surface") return <div class="full panel muted">Not on a surface.</div>;
  return <Surface session={session} loc={loc} />;
}

function depositStatus(know: RegionKnowledge, d: Deposit): "depleted" | "prospected" | "new" {
  if (remainingTonnes(know, d) <= 0.05) return "depleted";
  return know.prospected.includes(d.id) ? "prospected" : "new";
}

function floraStatus(know: RegionKnowledge, f: FloraSite): "sampled" | "unsampled" {
  return know.floraSampled.includes(f.id) ? "sampled" : "unsampled";
}

/** Why the crew can't work this deposit right now (empty when they can). */
function workBlockers(state: GameState, know: RegionKnowledge, dep: Deposit): string[] {
  const stats = shipStats(state.ship);
  const out: string[] = [];
  if (!know.discovered.includes(dep.id)) out.push("This deposit hasn't been discovered yet.");
  else if (depositStatus(know, dep) === "depleted") out.push("This deposit is worked out.");
  else if (dep.depthM > stats.drillMaxDepthM) {
    out.push(`The seam is ${dep.depthM} m down and the drill only reaches ${stats.drillMaxDepthM} m. A better drill would get it.`);
  }
  if (out.length === 0 && stats.cargoCapacityT - cargoTonnes(state.ship.cargo) <= 0.5) out.push("The ship's hold is full.");
  return out;
}

function Surface({ session, loc }: { session: GameSession; loc: SurfaceLoc }) {
  const { state, world } = session;
  const { body } = world.body(loc.bodyId);
  const map = currentRegion(state, world) as RegionMap;
  const know = knowledge(state, loc.bodyId, loc.region);
  const stats = shipStats(state.ship);
  const rover = loc.rover;
  const busy = session.busy;
  const canClimb = stats.roverCanClimb;

  const [selectedId, setSelectedIdRaw] = useState<number | null>(null);
  const [floraId, setFloraIdRaw] = useState<number | null>(null);
  // One selection at a time: a deposit or a flora site.
  const setSelectedId = (id: number | null): void => {
    setSelectedIdRaw(id);
    if (id !== null) setFloraIdRaw(null);
  };
  const setFloraId = (id: number | null): void => {
    setFloraIdRaw(id);
    if (id !== null) setSelectedIdRaw(null);
  };
  const animRef = useRef<Anim | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const facingRef = useRef(1);
  const headingRef = useRef({ cur: 0, target: 0, lastT: 0 });
  const routeRef = useRef<{ key: string; plan: RoutePlan | null }>({ key: "", plan: null });
  // Tiles swept so far on the current drive, grown incrementally as the rover passes points.
  const revealRef = useRef<{ anim: Anim; n: number; seen: Set<number>; tiles: Vec2[] } | null>(null);
  const aliveRef = useRef(true);
  // "Move ship" targeting mode (only while the rover is stowed).
  const [moveMode, setMoveMode] = useState(false);
  // Offer a recharge after a drive ends beside the ship with low cells.
  const [rechargeHint, setRechargeHint] = useState(false);
  const keyRef = useRef<(ev: KeyboardEvent) => void>(() => {});

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (animRef.current) {
        animRef.current = null;
        session.setBusy(false);
      }
    };
  }, [session]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => keyRef.current(ev);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const terrainImg = useMemo(() => buildTerrainImage(map, body.kind), [map, body.kind]);
  const foggedImg = useMemo(() => buildFoggedImage(terrainImg), [terrainImg]);
  // The painted map is rebuilt only when the rover's sweep changes, not every frame.
  const exploredKey = know.explored.join(",");
  const paintedImg = useMemo(() => composePainted(terrainImg, foggedImg, map, know), [terrainImg, foggedImg, map, exploredKey]);
  const exploredPct = Math.round(exploredFraction(know) * 100);

  const discovered = map.deposits.filter((d) => know.discovered.includes(d.id));
  const selected = discovered.find((d) => d.id === selectedId) ?? null;
  const depositAt = (t: Vec2): Deposit | undefined => discovered.find((d) => d.x === t.x && d.y === t.y);
  const floraFound = map.flora.filter((f) => know.floraFound.includes(f.id));
  const selectedFlora = floraFound.find((f) => f.id === floraId) ?? null;
  const floraAt = (t: Vec2): FloraSite | undefined => floraFound.find((f) => f.x === t.x && f.y === t.y);

  const ship = shipTile(state, map);
  const homeEnergy = rover ? energyHome(map, rover, ship, canClimb) : null;
  const stranded = rover !== null && (homeEnergy === null || homeEnergy > rover.energy);

  // --- driving ---------------------------------------------------------------------------

  const drive = async (path: PathStep[], quiet = false): Promise<boolean> => {
    if (!rover || session.busy || path.length === 0) return false;
    const steps = affordablePrefix(path, rover.energy);
    if (steps.length === 0) {
      session.notify("Rover energy is too low to move.", "error");
      return false;
    }
    const startedNearShip = hexDistance(rover, ship) <= 1;
    const pts: Vec2[] = [{ x: rover.x, y: rover.y }, ...steps];
    const cum = [0];
    for (const step of steps) cum.push((cum[cum.length - 1] as number) + step.energy);
    animRef.current = { pts, cum, t0: performance.now() };
    hoverRef.current = null;
    setRechargeHint(false);
    session.setBusy(true);
    await new Promise<void>((resolve) => setTimeout(resolve, steps.length * STEP_MS + 40));
    if (!aliveRef.current) return false;
    animRef.current = null;
    const last = pts[pts.length - 1] as Vec2;
    // The drive is already animated, so no time-lapse clock on top of it.
    const result = session.act((s, w) => moveRoverTo(s, w, last.x, last.y), { timelapse: false });
    session.setBusy(false);
    if (!result.ok) return false;
    const cut = result.value.stopped !== null || steps.length < path.length;
    if (cut) {
      session.notify("Rover energy ran out before it reached the target.", "error");
      return false;
    }
    const now = session.state.location;
    if (!quiet && !startedNearShip && now.kind === "surface" && now.rover) {
      if (hexDistance(now.rover, ship) <= 1 && now.rover.energy < stats.roverEnergy * RECHARGE_HINT_BELOW) setRechargeHint(true);
    }
    return true;
  };

  /** True when the rover is already at the site: on its tile, or beside it if the tile can't be entered. */
  const atSite = (site: Vec2): boolean =>
    rover !== null &&
    ((rover.x === site.x && rover.y === site.y) || (!canEnter(map, site.x, site.y, canClimb) && hexDistance(rover, site) <= 1));

  /**
   * Drive to a tile. With `approach` (deposits and plants) the rover goes onto the site itself, even when
   * it is already beside it; it settles for the nearest open neighbour only if the site can't be entered.
   * Resolves true once the rover is there.
   */
  const driveTo = async (target: Vec2, approach: boolean, quiet = false): Promise<boolean> => {
    if (!rover || session.busy) return false;
    if (rover.x === target.x && rover.y === target.y) return true;
    if (approach && atSite(target)) return true;
    const path = planPath(map, rover, target, canClimb, approach);
    if (!path) {
      session.notify("No route there for this rover.", "error");
      return false;
    }
    return drive(path, quiet);
  };

  // --- ship hop --------------------------------------------------------------------------

  const hopCost = hopFuel(state, world);
  const hopBlocker = (tile: Vec2): string | null => {
    if (!canEnter(map, tile.x, tile.y, false)) return "The ship needs open, level ground to set down.";
    if (tile.x === ship.x && tile.y === ship.y) return "The ship is already there.";
    if (hopCost > state.ship.fuel) return `A hop needs ${hopCost.toFixed(1)} fuel.`;
    return null;
  };

  // --- map -------------------------------------------------------------------------------

  const hoverPlan = (tile: Vec2): RoutePlan | null => {
    if (!rover) return null;
    const key = `${rover.x},${rover.y},${tile.x},${tile.y},${rover.energy}`;
    if (routeRef.current.key === key) return routeRef.current.plan;
    const site = depositAt(tile) !== undefined || floraAt(tile) !== undefined;
    const inRange = site ? atSite(tile) : rover.x === tile.x && rover.y === tile.y;
    const path = inRange ? null : planPath(map, rover, tile, canClimb, site);
    const plan = path && path.length > 0 ? evaluate(map, path, rover, ship, canClimb) : null;
    routeRef.current = { key, plan };
    return plan;
  };

  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void => {
    const L = computeLayout(w, h, map.width, map.height);
    layoutRef.current = L;

    // Mid-drive, the sensors sweep ahead of the sim: paint tiles in (and show finds) as the rover passes.
    const anim = animRef.current;
    const sweep = 2 + sensorTierFor(state, loc.bodyId);
    let reveal: Reveal | null = null;
    let seen = know;
    if (anim) {
      const n = Math.min(anim.pts.length - 1, Math.max(0, Math.round((t - anim.t0) / STEP_MS))) + 1;
      let rc = revealRef.current;
      if (!rc || rc.anim !== anim) rc = revealRef.current = { anim, n: 0, seen: new Set(), tiles: [] };
      for (; rc.n < n; rc.n++) {
        for (const tile of disk(anim.pts[rc.n] as Vec2, sweep)) {
          if (tile.x < 0 || tile.y < 0 || tile.x >= map.width || tile.y >= map.height) continue;
          const i = tile.y * map.width + tile.x;
          if (rc.seen.has(i)) continue;
          rc.seen.add(i);
          rc.tiles.push(tile);
        }
      }
      reveal = { terrain: terrainImg, tiles: rc.tiles };
      const passed = anim.pts.slice(0, n);
      const near = (o: Vec2): boolean => passed.some((p) => hexDistance(p, o) <= sweep);
      const deps = map.deposits.filter((d) => !know.discovered.includes(d.id) && near(d)).map((d) => d.id);
      const flora = map.flora.filter((f) => !know.floraFound.includes(f.id) && near(f)).map((f) => f.id);
      if (deps.length > 0 || flora.length > 0) {
        seen = { ...know, discovered: [...know.discovered, ...deps], floraFound: [...know.floraFound, ...flora] };
      }
    } else revealRef.current = null;
    drawBase(ctx, w, h, L, paintedImg, reveal);

    // Where the rover is drawn (canvas pixels): mid-drive it slides between hex centres along the path.
    let tile: Vec2 | null = rover ? { x: rover.x, y: rover.y } : null;
    let pos: Vec2 | null = tile ? tileCenter(L, tile) : null;
    let spent = 0;
    const hd = headingRef.current;
    if (anim) {
      const p = Math.min(anim.pts.length - 1, Math.max(0, (t - anim.t0) / STEP_MS));
      const i = Math.floor(p);
      const f = p - i;
      const a = anim.pts[i] as Vec2;
      const b = anim.pts[Math.min(anim.pts.length - 1, i + 1)] as Vec2;
      const ca = tileCenter(L, a);
      const cb = tileCenter(L, b);
      if (Math.abs(cb.x - ca.x) > 0.01) facingRef.current = cb.x > ca.x ? 1 : -1;
      const heading = headingOf(a, b);
      if (heading !== null) hd.target = heading;
      const e0 = anim.cum[i] ?? 0;
      spent = e0 + ((anim.cum[Math.min(anim.cum.length - 1, i + 1)] ?? e0) - e0) * f;
      pos = { x: ca.x + (cb.x - ca.x) * f, y: ca.y + (cb.y - ca.y) * f };
      tile = f < 0.5 ? a : b;
    }

    // Turn the (top-down) sprite smoothly toward the direction of travel.
    const dt = hd.lastT > 0 ? Math.min(100, Math.max(0, t - hd.lastT)) : 0;
    hd.lastT = t;
    const diff = ((hd.target - hd.cur + 540) % 360) - 180;
    const turn = (TURN_DEG_PER_S * dt) / 1000;
    hd.cur = Math.abs(diff) <= turn ? hd.target : (hd.cur + Math.sign(diff) * turn + 360) % 360;

    if (tile) drawSensorRange(ctx, L, tile, sweep);
    drawShip(ctx, L, ship);
    drawFlora(ctx, L, map, seen, selectedFlora?.id ?? null, t);
    drawDeposits(ctx, L, map, seen, selected?.id ?? null, t);

    // hover: route preview and tooltip
    const hover = anim ? null : hoverRef.current;
    const hopping = moveMode && !rover;
    let preview: EnergyPreview | null = null;
    if (hover && rover) {
      const plan = hoverPlan(hover.tile);
      if (plan) {
        preview = { cost: plan.energy, back: plan.back };
        const short = plan.energy > rover.energy;
        const strands = plan.back === null || plan.energy + plan.back > rover.energy;
        drawRoute(ctx, L, rover, plan.path, short || strands ? UI.danger : UI.good, null);
      }
    }
    if (anim) {
      const rest = anim.pts.slice(1).map((p) => ({ ...p, minutes: 0, energy: 0 }));
      drawRoute(ctx, L, anim.pts[0] as Vec2, rest, "rgba(95, 212, 255, 0.8)", null);
    }
    if (hover && hopping && hopBlocker(hover.tile) !== null && !isShipTile(hover.tile)) {
      drawBlockedTile(ctx, L, hover.tile);
    } else if (hover && hopping && !isShipTile(hover.tile)) {
      // Ghost ship where it would set down.
      ctx.globalAlpha = 0.55;
      drawShip(ctx, L, hover.tile);
      ctx.globalAlpha = 1;
      drawHoverTile(ctx, L, hover.tile);
    } else if (hover) drawHoverTile(ctx, L, hover.tile);

    if (pos && tile && rover) {
      const onPad = tile.x === ship.x && tile.y === ship.y;
      drawRover(ctx, L, pos, t, onPad, facingRef.current, hd.cur);
      drawEnergyBar(ctx, L, pos, onPad, Math.max(0, rover.energy - spent), stats.roverEnergy, preview);
    }

    if (hover) drawTooltip(ctx, w, h, hover.px, hover.py, hopping ? hopTooltip(hover.tile) : tooltipLines(hover.tile));
  };

  const isShipTile = (tile: Vec2): boolean => tile.x === ship.x && tile.y === ship.y;

  const hopTooltip = (tile: Vec2): TipLine[] => {
    const info = TERRAIN_INFO[map.terrain[tile.y * map.width + tile.x] as Terrain];
    const lines: TipLine[] = [{ text: isShipTile(tile) ? `${info.name} · ship` : info.name, color: UI.text }];
    const blocker = hopBlocker(tile);
    if (blocker === null) {
      lines.push({ text: `Hop: ${hopCost.toFixed(1)} fuel · ${formatDuration(HOP_MINUTES)}`, color: UI.good });
    } else {
      lines.push({ text: blocker, color: UI.danger });
    }
    return lines;
  };

  const tooltipLines = (tile: Vec2): TipLine[] => {
    const lines: TipLine[] = [];
    const terrain = map.terrain[tile.y * map.width + tile.x] as Terrain;
    const info = TERRAIN_INFO[terrain];
    const isShip = tile.x === ship.x && tile.y === ship.y;
    const needsClimber = info.passable === "climb" && !canClimb;
    lines.push({ text: isShip ? `${info.name} · ship` : info.name, color: UI.text });
    const dep = depositAt(tile);
    const flora = floraAt(tile);
    if (flora) {
      lines.push({ text: `${flora.species} · ${floraStatus(know, flora)}`, color: UI.good });
    }
    if (!isExplored(know, tile.x, tile.y)) lines.push({ text: "Not yet swept by sensors", color: UI.muted });
    if (dep) {
      const status = depositStatus(know, dep);
      lines.push({
        text: `${COMMODITIES[dep.commodity].name} · ${status === "new" ? "unsurveyed" : status === "depleted" ? "worked out" : `${Math.round(dep.grade * 100)}%`}`,
        color: COMMODITIES[dep.commodity].color,
      });
    }
    if (info.passable === "no") {
      lines.push({ text: "Impassable", color: UI.muted });
    } else if (needsClimber) {
      lines.push({ text: "Rover can't climb this", color: UI.muted });
    } else if (!rover) {
      lines.push({ text: "Deploy the rover to drive", color: UI.muted });
    } else {
      const plan = hoverPlan(tile);
      if (plan) {
        const bad = plan.energy > rover.energy;
        const strands = plan.back === null || plan.energy + plan.back > rover.energy;
        lines.push({
          text: `Drive ${formatDuration(plan.minutes * SHIFT_FACTOR)} · ${plan.energy.toFixed(1)} energy`,
          color: bad || strands ? UI.danger : UI.good,
        });
        if (bad) lines.push({ text: "Not enough energy", color: UI.danger });
        else if (strands) lines.push({ text: "Too far to return to ship", color: UI.danger });
      } else if ((dep || flora) && atSite(tile)) {
        lines.push({ text: "Rover is in range", color: UI.good });
      } else if (!(rover.x === tile.x && rover.y === tile.y)) {
        lines.push({ text: "No route", color: UI.danger });
      }
    }
    return lines;
  };

  const onMove = (px: number, py: number): void => {
    const L = layoutRef.current;
    const tile = L ? tileAt(L, px, py) : null;
    hoverRef.current = tile ? { tile, px, py } : null;
  };

  const onClick = (px: number, py: number): void => {
    const L = layoutRef.current;
    const tile = L ? tileAt(L, px, py) : null;
    if (!tile || session.busy) return;
    if (moveMode && !rover) {
      const blocker = hopBlocker(tile);
      if (blocker) {
        session.notify(blocker, "error");
        return;
      }
      const r = session.act((s, w) => relocateShip(s, w, tile.x, tile.y));
      if (r.ok) {
        setMoveMode(false);
        session.notify(`The ship set down at ${tile.x}, ${tile.y}.`);
      }
      return;
    }
    const dep = depositAt(tile);
    const flora = floraAt(tile);
    if (dep) setSelectedId(dep.id);
    else if (flora) setFloraId(flora.id);
    void driveTo(tile, dep !== undefined || flora !== undefined);
  };

  // --- rover and ship actions (buttons and hotkeys share these) ------------------------------------

  const nearShip = rover !== null && hexDistance(rover, ship) <= 1;

  const doDeploy = (): void => {
    const r = session.act((s, w) => deployRover(s, w));
    if (!r.ok) return;
    setMoveMode(false);
    if (r.value.chargedHours >= 0.5) {
      session.notify(`Charged the rover's cells for ${formatDuration(r.value.chargedHours * HOUR)} before rolling out.`);
    }
  };

  const doStow = (): void => {
    const r = session.act((s, w) => stowRover(s, w));
    if (!r.ok) return;
    setRechargeHint(false);
    setSelectedId(null);
    setFloraId(null);
    const { unloaded, jettisoned } = r.value;
    session.notify(`Unloaded ${tonnes(unloaded)} into the hold.${jettisoned > 0.05 ? ` ${tonnes(jettisoned)} left behind: hold full.` : ""}`);
  };

  const doRecharge = (): void => {
    const r = session.act((s, w) => rechargeRover(s, w));
    setRechargeHint(false);
    if (r.ok) session.notify(`Recharged the rover's cells in ${formatDuration(r.value.hours * HOUR)}.`);
  };

  const doWork = async (dep: Deposit): Promise<void> => {
    const blockers = workBlockers(state, know, dep);
    if (blockers[0]) {
      session.notify(blockers[0], "error");
      return;
    }
    // A rover already beside the deposit rolls onto it first, where you can see it.
    if (rover && hexDistance(rover, dep) <= 1 && !(await driveTo(dep, true, true))) return;
    const name = COMMODITIES[dep.commodity].name.toLowerCase();
    const r = session.act((s, w) => workDeposit(s, w, dep.id));
    if (!r.ok) return;
    const rep = r.value;
    const done = rep.stop === "deposit depleted";
    const loads = `${rep.loads} load${rep.loads === 1 ? "" : "s"}`;
    const head =
      rep.tonnes > 0 || rep.loads > 0
        ? `Crew hauled ${tonnes(rep.tonnes)} of ${name} in ${loads} over ${formatDuration(rep.minutes)}`
        : `Crew spent ${formatDuration(rep.minutes)} on the ${name} deposit and hauled nothing`;
    session.notify(`${head} — ${done ? "deposit worked out." : rep.detail}`, done || rep.stop === "hold full" ? "info" : "error");
    if (rep.incidents.length > 0) session.notify(`Along the way: ${rep.incidents.join(" ")}`, "error");
  };

  const doLiftOff = (): void => {
    session.act((s, w) => launch(s, w));
  };

  const toggleMoveMode = (): void => {
    if (rover) return;
    setMoveMode((m) => !m);
  };

  const stepRover = (dir: HexDir, repeat: boolean): void => {
    if (!rover) return;
    const to = step(rover.x, rover.y, dir);
    if (!canEnter(map, to.x, to.y, canClimb)) {
      if (!repeat) session.notify("The rover can't go that way.", "error");
      return;
    }
    const path = planPath(map, rover, to, canClimb, false);
    if (path) void drive(path);
  };

  const rechargeHours = rover ? Math.max(0, stats.roverEnergy - rover.energy) / ROVER_CHARGE_PER_HOUR : 0;
  const canRecharge = rover !== null && nearShip && stats.roverEnergy - rover.energy >= 0.5;

  keyRef.current = (ev: KeyboardEvent): void => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const el = ev.target;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
    const key = ev.key.toLowerCase();
    if (key === "escape") {
      if (moveMode) setMoveMode(false);
      return;
    }
    if (session.busy) return;
    const dir = KEY_DIRS[key];
    if (dir) {
      if (!rover) return;
      ev.preventDefault();
      stepRover(dir, ev.repeat);
    } else if (key === "r") {
      if (!rover) doDeploy();
      else if (nearShip) doStow();
      else session.notify("Drive the rover back to the ship first.", "error");
    } else if (key === "f") {
      if (selected) void doWork(selected);
      else session.notify("Select a deposit first.", "error");
    }
  };

  const present = ([...new Set(map.terrain)] as Terrain[]).sort((a, b) => a - b);

  return (
    <>
      <div class="viewport">
        <Canvas draw={draw} onClick={onClick} onMove={onMove} onLeave={() => (hoverRef.current = null)} animate />
        <div class="surface-footer">
          <div class="viewport-hint">
            {moveMode && !rover
              ? "Click a clear tile to set the ship down · Esc to cancel"
              : rover
                ? "Click or Q/E/A/D/Z/C to drive · R stow at ship · F work selected deposit"
                : "R deploy rover · Hover for terrain"}
          </div>
          <div class="surface-legend">
            {present.map((t) => (
              <span key={t} class="legend-item">
                <i style={{ background: TERRAIN_COLORS[body.kind][t] }} />
                {TERRAIN_INFO[t].name}
                {TERRAIN_INFO[t].passable === "climb" && !canClimb ? " ✕" : ""}
              </span>
            ))}
          </div>
        </div>
        {rechargeHint && rover && nearShip && canRecharge && !busy && (
          <div class="recharge-hint" role="status">
            <span>
              Rover is beside the ship at {Math.round(pct(rover.energy, stats.roverEnergy))}% energy. Top up the cells (
              {formatDuration(rechargeHours * HOUR)})?
            </span>
            <button class="btn primary" onClick={doRecharge}>
              Recharge
            </button>
            <button class="btn" title="Dismiss" onClick={() => setRechargeHint(false)}>
              Not now
            </button>
          </div>
        )}
      </div>
      <aside class="side surface-side">
        <div class="action-bar">
          <div class="ab-group">
            <span class="ab-label">Rover</span>
            {!rover && (
              <button class="btn" disabled={busy} title="Charge the cells and roll the rover out (R)" onClick={doDeploy}>
                Deploy rover
              </button>
            )}
            {rover && (
              <>
                <button
                  class="btn"
                  disabled={busy || (rover.x === ship.x && rover.y === ship.y)}
                  title="Drive back to the ship"
                  onClick={() => void driveTo(ship, false)}
                >
                  Return to ship
                </button>
                <button
                  class="btn"
                  disabled={busy || !nearShip}
                  title={!nearShip ? "Drive the rover back to the ship first" : "Unloads the cargo bed and recharges, 30 min (R)"}
                  onClick={doStow}
                >
                  Stow &amp; unload
                </button>
                <button
                  class="btn"
                  disabled={busy || !canRecharge}
                  title={
                    !nearShip
                      ? "Drive the rover back to the ship to recharge"
                      : !canRecharge
                        ? "The rover's cells are already full"
                        : `Top up the cells from the ship's reactor without stowing: ${formatDuration(rechargeHours * HOUR)}`
                  }
                  onClick={doRecharge}
                >
                  Recharge
                </button>
              </>
            )}
            {stranded && (
              <button
                class="btn danger"
                disabled={busy || state.ship.fuel < RECALL_FUEL}
                title={`The rover can't drive home on its remaining energy. The ship hops over and winches it aboard: ${RECALL_FUEL} fuel and 3 h`}
                onClick={() => session.act((s, w) => recallRover(s, w))}
              >
                Recall rover
              </button>
            )}
          </div>
          <div class="ab-group ship">
            <span class="ab-label">Ship</span>
            <button
              class={`btn ${moveMode && !rover ? "active" : ""}`}
              disabled={busy || rover !== null || (!moveMode && hopCost > state.ship.fuel)}
              title={
                rover
                  ? "Stow the rover before moving the ship"
                  : hopCost > state.ship.fuel
                    ? `A hop needs ${hopCost.toFixed(1)} fuel`
                    : `Hop the ship to another open tile: ${hopCost.toFixed(1)} fuel, ${formatDuration(HOP_MINUTES)}`
              }
              onClick={toggleMoveMode}
            >
              {moveMode && !rover ? "Cancel move" : "Move ship"}
            </button>
            <button
              class="btn liftoff"
              disabled={busy || rover !== null}
              title={rover ? "Take the ship back to orbit (stow the rover first)" : "Take the ship back to orbit"}
              onClick={doLiftOff}
            >
              Lift off (ship)
            </button>
          </div>
        </div>

        <Section id="planet" level={2} title={body.name} summary={`explored ${exploredPct}%`}>
          <div class="muted small">
            Region {loc.region + 1} of {body.regions} · {KIND_LABEL[body.kind]}
          </div>
          <div class="small">
            {Math.round(body.tempC)} °C · {body.gravityG.toFixed(2)} g · {formatPressure(body.pressureAtm)}
          </div>
          <div class="explored-line small">Region explored: {exploredPct}%</div>
          <div class="bar explored-bar" title="Share of this region swept by rover sensors">
            <span style={{ width: `${exploredPct}%` }} />
          </div>
        </Section>

        <RoverPanel rover={rover} stats={stats} homeEnergy={homeEnergy} stranded={stranded} />
        <ShipPanel rover={rover} stats={stats} state={state} bodyId={loc.bodyId} />

        {selectedFlora ? (
          <FloraPanel
            session={session}
            site={selectedFlora}
            know={know}
            rover={rover}
            atSite={atSite(selectedFlora)}
            goTo={() => driveTo(selectedFlora, true, true)}
            drive={() => void driveTo(selectedFlora, true)}
            busy={busy}
          />
        ) : selected ? (
          <DepositPanel
            session={session}
            dep={selected}
            know={know}
            rover={rover}
            atSite={atSite(selected)}
            goTo={() => driveTo(selected, true, true)}
            drive={() => void driveTo(selected, true)}
            work={() => void doWork(selected)}
            busy={busy}
          />
        ) : (
          <div class="panel muted small">
            {discovered.length > 0 || floraFound.length > 0
              ? "Select a deposit or plant site on the map or in the list."
              : rover
                ? "No deposits detected yet. Drive the rover around the region to sweep with its sensors."
                : "Deploy the rover to start surveying."}
          </div>
        )}

        {floraFound.length > 0 && (
          <Section id="flora" title="Flora" summary={`${floraFound.length} found`}>
            <table class="data deposit-table">
              <thead>
                <tr>
                  <th>Species</th>
                  <th class="num">Dist</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {floraFound
                  .map((f) => ({ f, dist: hexDistance(rover ?? ship, f) }))
                  .sort((a, b) => a.dist - b.dist)
                  .map(({ f, dist }) => {
                    const sampled = floraStatus(know, f) === "sampled";
                    return (
                      <tr key={f.id} class={`${f.id === selectedFlora?.id ? "sel" : ""} ${sampled ? "dim" : ""}`} onClick={() => setFloraId(f.id)}>
                        <td>
                          <i class="leaf-mark" />
                          {f.species}
                        </td>
                        <td class="num">{dist}</td>
                        <td>{sampled ? <span class="muted">sampled ✓</span> : <span class="tag new">new</span>}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <div class="muted small tbl-note">Distance in tiles from {rover ? "the rover" : "the ship"}.</div>
          </Section>
        )}

        {discovered.length > 0 && (
          <Section id="deposits" title="Deposits found" summary={`${discovered.length} found`}>
            <table class="data deposit-table">
              <thead>
                <tr>
                  <th>Commodity</th>
                  <th class="num">Dist</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {discovered
                  .map((d) => ({ d, dist: hexDistance(rover ?? ship, d) }))
                  .sort((a, b) => a.dist - b.dist)
                  .map(({ d, dist }) => {
                    const status = depositStatus(know, d);
                    return (
                      <tr
                        key={d.id}
                        class={`${d.id === selected?.id ? "sel" : ""} ${status === "depleted" ? "dim" : ""}`}
                        onClick={() => setSelectedId(d.id)}
                      >
                        <td>
                          <i class="swatch" style={{ background: status === "depleted" ? "#5b6472" : COMMODITIES[d.commodity].color }} />
                          {COMMODITIES[d.commodity].name}
                        </td>
                        <td class="num">{dist}</td>
                        <td>
                          {status === "new" && <span class="tag new">new</span>}
                          {status === "prospected" && <span class="tag">{Math.round(d.grade * 100)}%</span>}
                          {status === "depleted" && <span class="muted">depleted</span>}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <div class="muted small tbl-note">Distance in tiles from {rover ? "the rover" : "the ship"}.</div>
          </Section>
        )}

      </aside>
    </>
  );
}

function RoverPanel({
  rover,
  stats,
  homeEnergy,
  stranded,
}: {
  rover: RoverState | null;
  stats: ReturnType<typeof shipStats>;
  homeEnergy: number | null;
  stranded: boolean;
}) {
  const energyLow = rover !== null && (stranded || rover.energy < stats.roverEnergy * 0.3);
  const tight = rover !== null && !stranded && homeEnergy !== null && rover.energy < homeEnergy * 1.3;
  const bedT = rover ? cargoTonnes(rover.cargo) : 0;
  const roverSamples = specimenCount(rover?.specimens);
  return (
    <Section id="rover" title="Rover" summary={rover ? `energy ${Math.round(rover.energy)} / ${stats.roverEnergy}` : "stowed"}>
      {rover ? (
        <>
          <dl class="kv">
            <dt>Energy</dt>
            <dd>
              {Math.round(rover.energy)} / {stats.roverEnergy}
            </dd>
          </dl>
          <div class={`bar ${energyLow || tight ? "warn" : ""}`}>
            <span style={{ width: `${pct(rover.energy, stats.roverEnergy)}%` }} />
          </div>
          {stranded ? (
            <p class="danger small act-note">
              {homeEnergy === null
                ? "No route back to the ship for this rover."
                : `Not enough energy to drive home (needs ${homeEnergy.toFixed(1)}).`}
            </p>
          ) : (
            tight &&
            homeEnergy !== null && (
              <p class="accent small act-note">Energy is getting tight: the trip home takes {homeEnergy.toFixed(1)}.</p>
            )
          )}
          <dl class="kv spaced">
            <dt>Cargo bed</dt>
            <dd>
              {tonnes(bedT)} / {tonnes(stats.roverCargoT)}
            </dd>
          </dl>
          <div class="bar">
            <span style={{ width: `${pct(bedT, stats.roverCargoT)}%` }} />
          </div>
          <CargoChips cargo={rover.cargo} />
          <dl class="kv spaced">
            <dt>Sample cases</dt>
            <dd class={roverSamples >= ROVER_SPECIMEN_SLOTS ? "accent" : ""}>
              {roverSamples} / {ROVER_SPECIMEN_SLOTS}
            </dd>
          </dl>
          <div class={`bar ${roverSamples >= ROVER_SPECIMEN_SLOTS ? "warn" : ""}`}>
            <span style={{ width: `${pct(roverSamples, ROVER_SPECIMEN_SLOTS)}%` }} />
          </div>
          <SpecimenChips specimens={rover.specimens} />
        </>
      ) : (
        <p class="muted small">Stowed aboard.</p>
      )}
    </Section>
  );
}

function ShipPanel({
  rover,
  stats,
  state,
  bodyId,
}: {
  rover: RoverState | null;
  stats: ReturnType<typeof shipStats>;
  state: GameState;
  bodyId: string;
}) {
  const hold = cargoTonnes(state.ship.cargo);
  const fuelPct = pct(state.ship.fuel, stats.fuelCapacity);
  const roverSamples = specimenCount(rover?.specimens);
  const shipSamples = specimenCount(state.ship.specimens);
  const jobs = (state.contracts ?? []).filter((c) => c.status === "active" && c.kind === "specimens" && c.bodyId === bodyId);
  return (
    <Section id="ship" title="Ship hold" summary={`${tonnes(hold)} / ${tonnes(stats.cargoCapacityT)}`}>
      <dl class="kv">
        <dt>Hold</dt>
        <dd>
          {tonnes(hold)} / {tonnes(stats.cargoCapacityT)}
        </dd>
      </dl>
      <div class="bar">
        <span style={{ width: `${pct(hold, stats.cargoCapacityT)}%` }} />
      </div>
      <CargoChips cargo={state.ship.cargo} />
      {(shipSamples > 0 || roverSamples > 0) && (
        <>
          <dl class="kv spaced">
            <dt>Ship racks</dt>
            <dd>
              {shipSamples} / {SHIP_SPECIMEN_SLOTS}
            </dd>
          </dl>
          <div class="bar">
            <span style={{ width: `${pct(shipSamples, SHIP_SPECIMEN_SLOTS)}%` }} />
          </div>
          <SpecimenChips specimens={state.ship.specimens} />
        </>
      )}
      {jobs.map((c) => {
        const inRover = specimensFrom(rover?.specimens, bodyId);
        const aboard = specimensFrom(state.ship.specimens, bodyId);
        const need = c.count ?? 0;
        const have = inRover + aboard;
        return (
          <div key={c.id} class="contract-note small" title={c.text}>
            <span class="accent">◆</span> {c.title}: {have} / {need} samples{" "}
            <span class="muted">
              ({inRover} in the rover, {aboard} aboard)
            </span>
            {have >= need && <div class="good">Enough collected. Stow the rover, lift off, and hand it in at the Intrepid.</div>}
          </div>
        );
      })}
      <dl class="kv spaced">
        <dt>Fuel</dt>
        <dd>
          {state.ship.fuel.toFixed(1)} / {stats.fuelCapacity}
        </dd>
      </dl>
      <div class={`bar ${fuelPct < 20 ? "warn" : ""}`}>
        <span style={{ width: `${fuelPct}%` }} />
      </div>
    </Section>
  );
}

function SpecimenChips({ specimens }: { specimens: Record<string, number> | undefined }) {
  const list = Object.entries(specimens ?? {}).filter(([, n]) => n > 0);
  if (list.length === 0) return null;
  return (
    <div class="cargo-chips">
      {list.map(([key, n]) => (
        <span key={key} class="cargo-chip">
          <i class="leaf-mark" />
          {key.split("|")[1] ?? key} ×{n}
        </span>
      ))}
    </div>
  );
}

function CargoChips({ cargo }: { cargo: Parameters<typeof cargoList>[0] }) {
  const list = cargoList(cargo);
  if (list.length === 0) return null;
  return (
    <div class="cargo-chips">
      {list.map((c) => (
        <span key={c.id} class="cargo-chip">
          <i class="swatch" style={{ background: COMMODITIES[c.id].color }} />
          {c.name} {tonnes(c.tonnes)}
        </span>
      ))}
    </div>
  );
}

function FloraPanel({
  session,
  site,
  know,
  rover,
  atSite,
  goTo,
  drive,
  busy,
}: {
  session: GameSession;
  site: FloraSite;
  know: RegionKnowledge;
  rover: RoverState | null;
  atSite: boolean;
  /** Drives the rover onto the site (if it isn't there yet); resolves true once it is. */
  goTo: () => Promise<boolean>;
  drive: () => void;
  busy: boolean;
}) {
  const sampled = floraStatus(know, site) === "sampled";
  const dist = rover ? hexDistance(rover, site) : null;
  const near = dist !== null && dist <= 1;
  const blockers: string[] = [];
  if (sampled) blockers.push("Already sampled here.");
  if (!rover) blockers.push("Deploy the rover first.");
  else {
    if (!near && !sampled) blockers.push(`The rover is ${dist} tiles away: drive it next to the plants.`);
    if (specimenCount(rover.specimens) >= ROVER_SPECIMEN_SLOTS) {
      blockers.push("The rover's sample cases are full. Drive back to the ship and stow.");
    }
    if (rover.energy < SAMPLE_ENERGY) blockers.push(`The sample kit needs ${SAMPLE_ENERGY} rover energy.`);
  }
  const collect = async (): Promise<void> => {
    if (!(await goTo())) return;
    const r = session.act((s, w) => collectSample(s, w, site.id));
    if (r.ok) session.notify(`Collected a living sample of ${site.species}.`);
  };
  return (
    <Section id="plants" title="Selected plants" class="deposit-panel" revealKey={site.id}>
      <div class="dep-title">
        <i class="leaf-mark big" />
        <span>{site.species}</span>
        <span class={`tag ${sampled ? "" : "new"}`}>{sampled ? "sampled" : "unsampled"}</span>
      </div>
      <dl class="kv">
        <dt>Position</dt>
        <dd>
          {site.x}, {site.y}
          {dist !== null && <span class="muted"> · {dist} tiles</span>}
        </dd>
      </dl>
      {blockers.length > 0 && (
        <ul class="blockers">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      <div class="btn-row dep-actions">
        {rover && !atSite && !sampled && (
          <button class="btn" disabled={busy} onClick={drive}>
            Drive there
          </button>
        )}
        <button class="btn primary" disabled={busy || blockers.length > 0} onClick={() => void collect()}>
          Collect sample ({formatDuration(SAMPLE_MINUTES * SHIFT_FACTOR)})
        </button>
      </div>
      {blockers.length === 0 && (
        <p class="muted small act-note">Uses {SAMPLE_ENERGY} rover energy. Samples ride in the rover's cases until you stow it.</p>
      )}
    </Section>
  );
}

function DepositPanel({
  session,
  dep,
  know,
  rover,
  atSite,
  goTo,
  drive,
  work,
  busy,
}: {
  session: GameSession;
  dep: Deposit;
  know: RegionKnowledge;
  rover: RoverState | null;
  atSite: boolean;
  /** Drives the rover onto the deposit (if it isn't there yet); resolves true once it is. */
  goTo: () => Promise<boolean>;
  drive: () => void;
  work: () => void;
  busy: boolean;
}) {
  const stats = shipStats(session.state.ship);
  const commodity = COMMODITIES[dep.commodity];
  const status = depositStatus(know, dep);
  const prospected = know.prospected.includes(dep.id);
  const isSite = know.drillSites.includes(dep.id);
  const dist = rover ? hexDistance(rover, dep) : null;
  const near = dist !== null && dist <= 1;
  const remaining = remainingTonnes(know, dep);
  const tooDeep = dep.depthM > stats.drillMaxDepthM;
  const rate = stats.drillRateTph * (0.4 + dep.grade);
  const room = rover ? stats.roverCargoT - cargoTonnes(rover.cargo) : 0;

  const workBlock = workBlockers(session.state, know, dep);

  const placement: string[] = [];
  if (!rover) placement.push("Deploy the rover first.");
  else if (!near) placement.push(`The rover is ${dist} tiles away: drive it next to the deposit.`);

  const prospectBlockers = [...placement];
  if (rover && rover.energy < PROSPECT_ENERGY) prospectBlockers.push(`Core samples need ${PROSPECT_ENERGY} rover energy.`);

  const drillBlockers = [...placement];
  if (status === "depleted") drillBlockers.push("This deposit is worked out.");
  if (tooDeep) drillBlockers.push(`The seam is ${dep.depthM} m down and the drill only reaches ${stats.drillMaxDepthM} m. A better drill would get it.`);
  if (rover && room <= 0.05) drillBlockers.push("The rover's cargo bed is full. Drive back to the ship and unload.");
  const setupEnergy = isSite ? 0 : DRILL_SETUP_ENERGY;
  if (rover && rover.energy < setupEnergy + 0.5) drillBlockers.push("Not enough rover energy to run the drill.");

  const hoursFull = rover
    ? Math.max(0, Math.min(remaining / rate, room / rate, (rover.energy - setupEnergy) / DRILL_ENERGY_PER_HOUR))
    : 0;
  const hours4 = Math.min(4, hoursFull);
  const setupMin = isSite ? 0 : DRILL_SETUP_MINUTES;

  const runProspect = async (): Promise<void> => {
    if (!(await goTo())) return;
    session.act((s, w) => prospect(s, w, dep.id));
  };

  const runDrill = async (maxHours: number): Promise<void> => {
    if (!(await goTo())) return;
    const r = session.act((s, w) => drill(s, w, dep.id, maxHours));
    if (!r.ok) return;
    const { tonnes: got, hours, depleted, roverFull, incident } = r.value;
    const why = incident ? "interrupted" : depleted ? "deposit worked out" : roverFull ? "cargo bed full" : hours < maxHours - 0.01 ? "rover energy low" : "";
    session.notify(`Drilled ${tonnes(got)} of ${commodity.name.toLowerCase()} in ${formatDuration(hours * HOUR * SHIFT_FACTOR)}${why ? ` (${why})` : ""}.`);
    if (incident) session.notify(incident, "error");
  };

  return (
    <Section id="deposit" title="Selected deposit" class="deposit-panel" revealKey={dep.id}>
      <div class="dep-title" title={commodity.blurb}>
        <i class="swatch big" style={{ background: status === "depleted" ? "#5b6472" : commodity.color }} />
        <span>{commodity.name}</span>
        <span class={`tag ${status}`}>{status === "new" ? "unsurveyed" : status}</span>
      </div>
      <p class="muted small blurb">{commodity.blurb}</p>
      <dl class="kv">
        <dt>Position</dt>
        <dd>
          {dep.x}, {dep.y}
          {dist !== null && <span class="muted"> · {dist} tiles</span>}
        </dd>
        {prospected ? (
          <>
            <dt>Grade</dt>
            <dd>{Math.round(dep.grade * 100)}%</dd>
            <dt>Depth</dt>
            <dd class={tooDeep ? "danger" : ""}>
              {dep.depthM} m{tooDeep ? ` (drill max ${stats.drillMaxDepthM} m)` : ""}
            </dd>
            <dt>Remaining</dt>
            <dd>{tonnes(remaining)}</dd>
            <dt>Drill rate</dt>
            <dd>{rate.toFixed(2)} t/h</dd>
            {isSite && (
              <>
                <dt>Drill rig</dt>
                <dd class="accent">set up</dd>
              </>
            )}
          </>
        ) : (
          <>
            <dt>Seam</dt>
            <dd class="muted">grade, depth and size unknown</dd>
          </>
        )}
      </dl>

      <div class="work-block">
        <button
          class="btn primary big work-btn"
          disabled={busy || workBlock.length > 0}
          title={workBlock[0] ?? "Crew prospects, drills and hauls loads home until the deposit is worked out or the hold is full (F)"}
          onClick={work}
        >
          Work this deposit
        </button>
        {workBlock.length > 0 ? (
          <p class="danger small act-note">{workBlock[0]}</p>
        ) : (
          <p class="muted small act-note">
            The crew deploys the rover, prospects, drills and hauls loads home until the deposit is worked out or the hold is full.
          </p>
        )}
      </div>
      <div class="manual-label">Or do it by hand</div>

      {!prospected ? (
        <>
          <ul class="blockers">{prospectBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
          <div class="btn-row dep-actions">
            {rover && !atSite && (
              <button class="btn" disabled={busy} onClick={drive}>
                Drive there
              </button>
            )}
            <button
              class="btn"
              disabled={busy || prospectBlockers.length > 0}
              onClick={() => void runProspect()}
            >
              Prospect ({formatDuration(PROSPECT_MINUTES * SHIFT_FACTOR)})
            </button>
          </div>
        </>
      ) : (
        <>
          <ul class="blockers">{drillBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
          <div class="btn-row dep-actions">
            {rover && !atSite && (
              <button class="btn" disabled={busy} onClick={drive}>
                Drive there
              </button>
            )}
            <button class="btn" disabled={busy || drillBlockers.length > 0} onClick={() => void runDrill(Infinity)}>
              Drill until full
            </button>
            <button class="btn" disabled={busy || drillBlockers.length > 0} onClick={() => void runDrill(4)}>
              Drill 4 h
            </button>
          </div>
          {drillBlockers.length === 0 && (
            <p class="muted small act-note">
              Full run: about {tonnes(rate * hoursFull)} in {formatDuration((hoursFull * HOUR + setupMin) * SHIFT_FACTOR)}. 4 h
              of drilling: about {tonnes(rate * hours4)} in {formatDuration((hours4 * HOUR + setupMin) * SHIFT_FACTOR)}.
              {!isSite && ` Includes ${formatDuration(DRILL_SETUP_MINUTES * SHIFT_FACTOR)} rig setup, once per site.`} Times
              include crew rest between shifts.
            </p>
          )}
        </>
      )}
    </Section>
  );
}
