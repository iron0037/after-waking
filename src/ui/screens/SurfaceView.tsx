/**
 * Planet surface: a survey map over the whole world (one continuous hex map in planet-wide coordinates, drawn
 * region by region as the camera follows the rover), and the prospect → drill → haul loop.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { COMMODITIES } from "../../data/commodities";
import {
  activeRegion,
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
  emptyKnowledge,
  exploredFraction,
  formatDuration,
  formatPressure,
  hexDistance,
  hexToPixel,
  HOP_MINUTES,
  hopFuel,
  hopFuelTo,
  HOUR,
  KEY_TO_DIR,
  KIND_LABEL,
  launch,
  mapPixelSize,
  moveRoverTo,
  isExplored,
  normalizeKnowledge,
  PROSPECT_ENERGY,
  PROSPECT_MINUTES,
  prospect,
  RECALL_FUEL,
  recallRover,
  rechargeRover,
  REGION_SIZE,
  regionKey,
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
  surfaceDeposit,
  surfaceFlora,
  Terrain,
  TERRAIN_INFO,
  type BodySurface,
  type Deposit,
  type FloraSite,
  type GameState,
  type HexDir,
  type Location,
  type PathStep,
  type RegionKnowledge,
  type RoverState,
  type SurfaceDeposit,
  type SurfaceFlora,
  type Vec2,
  workDeposit,
} from "../../sim";
import { cargoList, pct, tonnes } from "../format";
import { TERRAIN_COLORS, UI } from "../palette";
import { useSession, type GameSession } from "../session";
import { Canvas } from "../Canvas";
import {
  cameraLayout,
  drawBase,
  drawBlockedTile,
  drawDeposits,
  drawEnergyBar,
  drawFlora,
  drawHoverTile,
  drawRegionBorders,
  drawRoute,
  drawRover,
  drawSensorRange,
  drawShip,
  drawTooltip,
  fitSize,
  tileAt,
  viewCenter,
  visibleRegions,
  type DepositMark,
  type EnergyPreview,
  type FloraMark,
  type Layout,
  type Reveal,
  type TipLine,
} from "./surface/mapDraw";
import { affordablePrefix, energyHome, evaluate, planPath, type RoutePlan } from "./surface/routing";
import { Section } from "./surface/Section";
import { terrainCache, type RegionImage } from "./surface/terrainImage";
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

/** Zoom limits, as multiples of the hex size at which one region fills the view. */
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.6;
/** Smallest hex ever drawn, px. */
const MIN_HEX_PX = 2.5;
/** Time constant (ms) of the camera easing toward the rover while following. */
const FOLLOW_MS = 90;
/** While not following, a drive that takes the rover this close to the view's edge (px) re-centres the camera. */
const EDGE_PX = 48;

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

/**
 * The map camera. `center` is in unit hex-pixel space (hexToPixel(x, y, 1)); `zoom` multiplies the size at
 * which one region fills the view. While `follow` is on, the centre eases toward the rover (or the ship).
 */
interface Camera {
  center: Vec2;
  zoom: number;
  follow: boolean;
  /** False until the first frame has placed the camera. */
  placed: boolean;
}

/** Keyboard driving, one hex per press: Q/E/A/D/Z/C (nw/ne/w/e/sw/se), plus Left/Right arrows for w/e. */
const KEY_DIRS: Record<string, HexDir> = { ...KEY_TO_DIR, arrowleft: "w", arrowright: "e" };

/** Stand-in knowledge for regions the crew hasn't been to (never mutated). */
const NO_KNOWLEDGE: RegionKnowledge = emptyKnowledge();

/** What the crew knows about a region, without creating an entry in the save for regions never visited. */
function peekKnowledge(state: GameState, bodyId: string, region: number): RegionKnowledge | null {
  const k = state.regions[regionKey(bodyId, region)];
  return k ? normalizeKnowledge(k) : null;
}

/** Hex-pixel position of a tile at unit hex size (the camera's coordinate space). */
function unitPos(t: Vec2): Vec2 {
  return hexToPixel(t.x, t.y, 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

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

/** Why the crew can't work this deposit right now (empty when they can). `know` is the deposit's own region's. */
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

/** Discovered deposits in `regions`, each with its region's knowledge. */
function knownDeposits(state: GameState, surface: BodySurface, bodyId: string, regions: readonly number[]): DepositMark[] {
  const out: DepositMark[] = [];
  for (const r of regions) {
    const know = peekKnowledge(state, bodyId, r);
    if (!know || know.discovered.length === 0) continue;
    for (const d of surface.deposits(r)) if (know.discovered.includes(d.id)) out.push({ d, know });
  }
  return out;
}

/** Spotted flora sites in `regions`, each with its region's knowledge. */
function knownFlora(state: GameState, surface: BodySurface, bodyId: string, regions: readonly number[]): FloraMark[] {
  const out: FloraMark[] = [];
  for (const r of regions) {
    const know = peekKnowledge(state, bodyId, r);
    if (!know || know.floraFound.length === 0) continue;
    for (const f of surface.flora(r)) if (know.floraFound.includes(f.id)) out.push({ f, know });
  }
  return out;
}

/** A region and its (up to eight) neighbours on the surface grid. */
function regionAndNeighbours(surface: BodySurface, region: number): number[] {
  const o = surface.origin(region);
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const r = surface.regionAt(o.x + dx * REGION_SIZE, o.y + dy * REGION_SIZE);
      if (r !== null) out.push(r);
    }
  }
  return out;
}

function Surface({ session, loc }: { session: GameSession; loc: SurfaceLoc }) {
  const { state, world } = session;
  const { body } = world.body(loc.bodyId);
  const surface = world.surface(loc.bodyId);
  const active = activeRegion(state, world);
  const activeKnow = peekKnowledge(state, loc.bodyId, active);
  const stats = shipStats(state.ship);
  const rover = loc.rover;
  const busy = session.busy;
  const canClimb = stats.roverCanClimb;

  const [selectedKey, setSelectedKeyRaw] = useState<string | null>(null);
  const [floraKey, setFloraKeyRaw] = useState<string | null>(null);
  // One selection at a time: a deposit or a flora site.
  const setSelectedKey = (key: string | null): void => {
    setSelectedKeyRaw(key);
    if (key !== null) setFloraKeyRaw(null);
  };
  const setFloraKey = (key: string | null): void => {
    setFloraKeyRaw(key);
    if (key !== null) setSelectedKeyRaw(null);
  };
  const animRef = useRef<Anim | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const facingRef = useRef(1);
  const headingRef = useRef({ cur: 0, target: 0, lastT: 0 });
  const routeRef = useRef<{ key: string; plan: RoutePlan | null }>({ key: "", plan: null });
  // Tiles swept so far on the current drive (planet-wide), grown incrementally as the rover passes points,
  // plus the regions they fall in and the sites the sweep has picked up ahead of the sim.
  const revealRef = useRef<{
    anim: Anim;
    n: number;
    seen: Set<number>;
    tiles: Vec2[];
    regions: Set<number>;
    deposits: Set<string>;
    flora: Set<string>;
  } | null>(null);
  const aliveRef = useRef(true);
  const camRef = useRef<Camera>({ center: { x: 0, y: 0 }, zoom: 1, follow: true, placed: false });
  const [following, setFollowingState] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; lx: number; ly: number; moved: boolean } | null>(null);
  const stopDragRef = useRef<(() => void) | null>(null);
  // "Move ship" targeting mode (only while the rover is stowed).
  const [moveMode, setMoveMode] = useState(false);
  // Offer a recharge after a drive ends beside the ship with low cells.
  const [rechargeHint, setRechargeHint] = useState(false);
  const keyRef = useRef<(ev: KeyboardEvent) => void>(() => {});

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopDragRef.current?.();
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

  const exploredPct = Math.round(exploredFraction(activeKnow ?? undefined) * 100);

  const ship = shipTile(state, world);
  const home = rover ?? ship;
  // The side panel lists sites in the active region and the regions around it.
  const nearRegions = regionAndNeighbours(surface, active);
  const discovered = knownDeposits(state, surface, loc.bodyId, nearRegions);
  const floraFound = knownFlora(state, surface, loc.bodyId, nearRegions);
  const selectedFound = selectedKey ? surfaceDeposit(state, world, selectedKey) : null;
  const selected: DepositMark | null = selectedFound ? { d: selectedFound.deposit, know: selectedFound.know } : null;
  const floraFoundSel = floraKey ? surfaceFlora(state, world, floraKey) : null;
  const selectedFlora: FloraMark | null = floraFoundSel ? { f: floraFoundSel.site, know: floraFoundSel.know } : null;

  /** The known deposit on a tile, if any (looked up in that tile's region). */
  const depositAt = (t: Vec2): DepositMark | undefined => {
    const r = surface.regionAt(t.x, t.y);
    if (r === null) return undefined;
    return knownDeposits(state, surface, loc.bodyId, [r]).find(({ d }) => d.x === t.x && d.y === t.y);
  };
  const floraAt = (t: Vec2): FloraMark | undefined => {
    const r = surface.regionAt(t.x, t.y);
    if (r === null) return undefined;
    return knownFlora(state, surface, loc.bodyId, [r]).find(({ f }) => f.x === t.x && f.y === t.y);
  };

  const homeEnergy = rover ? energyHome(surface, rover, ship, canClimb) : null;
  const stranded = rover !== null && (homeEnergy === null || homeEnergy > rover.energy);

  // --- camera ----------------------------------------------------------------------------

  const setFollowing = (on: boolean): void => {
    camRef.current.follow = on;
    setFollowingState(on);
  };

  /** Zoom by `factor`; about the cursor at (px, py) when free, about the rover while following. */
  const zoomBy = (factor: number, px?: number, py?: number): void => {
    const cam = camRef.current;
    const L = layoutRef.current;
    const zoom = clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (L && !cam.follow && px !== undefined && py !== undefined) {
      // Keep the point under the cursor where it is.
      const size = Math.max(MIN_HEX_PX, fitSize(L.w, L.h) * zoom);
      const p = { x: (px - L.ox) / L.size, y: (py - L.oy) / L.size };
      const c = viewCenter(L.w, L.h);
      cam.center = { x: p.x - (px - c.x) / size, y: p.y - (py - c.y) / size };
    }
    cam.zoom = zoom;
  };

  const resetView = (): void => {
    camRef.current.zoom = 1;
    setFollowing(true);
  };

  // Left or middle button drag pans; a press that barely moves is still a click.
  const onMouseDown = (ev: MouseEvent): void => {
    if ((ev.button !== 0 && ev.button !== 1) || !(ev.target instanceof HTMLCanvasElement)) return;
    if (ev.button === 1) ev.preventDefault(); // no browser autoscroll
    const d = { sx: ev.clientX, sy: ev.clientY, lx: ev.clientX, ly: ev.clientY, moved: false };
    dragRef.current = d;
    const move = (e: MouseEvent): void => {
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
      if (!d.moved) {
        wrapRef.current?.classList.add("dragging");
        hoverRef.current = null;
        if (camRef.current.follow) setFollowing(false);
      }
      d.moved = true;
      const cam = camRef.current;
      const size = layoutRef.current?.size ?? 1;
      cam.center = { x: cam.center.x - (e.clientX - d.lx) / size, y: cam.center.y - (e.clientY - d.ly) / size };
      d.lx = e.clientX;
      d.ly = e.clientY;
    };
    const stop = (): void => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      wrapRef.current?.classList.remove("dragging");
      stopDragRef.current = null;
    };
    const up = (): void => {
      stop();
      // the click event fires right after mouseup; let it see `moved` before clearing
      setTimeout(() => {
        if (dragRef.current === d) dragRef.current = null;
      }, 0);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    stopDragRef.current = stop;
  };

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
    ((rover.x === site.x && rover.y === site.y) || (!canEnter(surface, site.x, site.y, canClimb) && hexDistance(rover, site) <= 1));

  /**
   * Drive to a tile. With `approach` (deposits and plants) the rover goes onto the site itself, even when
   * it is already beside it; it settles for the nearest open neighbour only if the site can't be entered.
   * Resolves true once the rover is there.
   */
  const driveTo = async (target: Vec2, approach: boolean, quiet = false): Promise<boolean> => {
    if (!rover || session.busy) return false;
    if (rover.x === target.x && rover.y === target.y) return true;
    if (approach && atSite(target)) return true;
    const path = planPath(surface, rover, target, canClimb, approach);
    if (!path) {
      session.notify("No route there for this rover.", "error");
      return false;
    }
    return drive(path, quiet);
  };

  // --- ship hop --------------------------------------------------------------------------

  const hopBase = hopFuel(state, world);
  const hopBlocker = (tile: Vec2): string | null => {
    if (!canEnter(surface, tile.x, tile.y, false)) return "The ship needs open, level ground to set down.";
    if (tile.x === ship.x && tile.y === ship.y) return "The ship is already there.";
    const fuel = hopFuelTo(state, world, tile.x, tile.y);
    if (fuel > state.ship.fuel) return `That hop needs ${fuel.toFixed(1)} fuel.`;
    return null;
  };

  // --- map -------------------------------------------------------------------------------

  const hoverPlan = (tile: Vec2): RoutePlan | null => {
    if (!rover) return null;
    const key = `${rover.x},${rover.y},${tile.x},${tile.y},${rover.energy}`;
    if (routeRef.current.key === key) return routeRef.current.plan;
    const site = depositAt(tile) !== undefined || floraAt(tile) !== undefined;
    const inRange = site ? atSite(tile) : rover.x === tile.x && rover.y === tile.y;
    const path = inRange ? null : planPath(surface, rover, tile, canClimb, site);
    const plan = path && path.length > 0 ? evaluate(surface, path, rover, ship, canClimb) : null;
    routeRef.current = { key, plan };
    return plan;
  };

  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void => {
    const anim = animRef.current;
    const hd = headingRef.current;
    const cam = camRef.current;

    // Where the rover is (unit hex-pixel space): mid-drive it slides between hex centres along the path.
    let tile: Vec2 | null = rover ? { x: rover.x, y: rover.y } : null;
    let roverUnit: Vec2 | null = tile ? unitPos(tile) : null;
    let spent = 0;
    if (anim) {
      const p = Math.min(anim.pts.length - 1, Math.max(0, (t - anim.t0) / STEP_MS));
      const i = Math.floor(p);
      const f = p - i;
      const a = anim.pts[i] as Vec2;
      const b = anim.pts[Math.min(anim.pts.length - 1, i + 1)] as Vec2;
      const ua = unitPos(a);
      const ub = unitPos(b);
      if (Math.abs(ub.x - ua.x) > 0.001) facingRef.current = ub.x > ua.x ? 1 : -1;
      const heading = headingOf(a, b);
      if (heading !== null) hd.target = heading;
      const e0 = anim.cum[i] ?? 0;
      spent = e0 + ((anim.cum[Math.min(anim.cum.length - 1, i + 1)] ?? e0) - e0) * f;
      roverUnit = { x: ua.x + (ub.x - ua.x) * f, y: ua.y + (ub.y - ua.y) * f };
      tile = f < 0.5 ? a : b;
    }

    // Turn the (top-down) sprite smoothly toward the direction of travel.
    const dt = hd.lastT > 0 ? Math.min(100, Math.max(0, t - hd.lastT)) : 0;
    hd.lastT = t;
    const diff = ((hd.target - hd.cur + 540) % 360) - 180;
    const turn = (TURN_DEG_PER_S * dt) / 1000;
    hd.cur = Math.abs(diff) <= turn ? hd.target : (hd.cur + Math.sign(diff) * turn + 360) % 360;

    // Camera: ease toward the rover (or the ship) while following; stay on the planet either way.
    const target = roverUnit ?? unitPos(ship);
    if (!cam.placed) {
      cam.center = { ...target };
      cam.placed = true;
    } else if (cam.follow) {
      const ease = dt > 0 ? 1 - Math.exp(-dt / FOLLOW_MS) : 1;
      cam.center = { x: cam.center.x + (target.x - cam.center.x) * ease, y: cam.center.y + (target.y - cam.center.y) * ease };
    }
    const extent = mapPixelSize(surface.width, surface.height, 1);
    cam.center = { x: clamp(cam.center.x, 0, extent.w), y: clamp(cam.center.y, 0, extent.h) };
    const size = Math.max(MIN_HEX_PX, fitSize(w, h) * cam.zoom);
    const L = cameraLayout(w, h, surface.width, surface.height, size, cam.center);
    layoutRef.current = L;
    const pos: Vec2 | null = roverUnit ? { x: L.ox + roverUnit.x * size, y: L.oy + roverUnit.y * size } : null;
    // A free camera picks the rover back up if a drive carries it toward the edge of the view.
    if (anim && !cam.follow && pos && (pos.x < EDGE_PX || pos.y < EDGE_PX || pos.x > w - EDGE_PX || pos.y > h - EDGE_PX - 42)) {
      setFollowing(true);
    }

    // Terrain: each region in view, fogged where the sensors haven't swept (fog comes from each region's knowledge).
    const regions = visibleRegions(L, surface.layout);
    const cache = terrainCache(surface, body.kind);
    cache.beginFrame(1);
    const knowMemo = new Map<number, RegionKnowledge | null>();
    const know = (r: number): RegionKnowledge | null => {
      if (!knowMemo.has(r)) knowMemo.set(r, peekKnowledge(state, loc.bodyId, r));
      return knowMemo.get(r) ?? null;
    };
    const sigMemo = new Map<number, string>();
    const sigOf = (r: number): string => {
      let s = sigMemo.get(r);
      if (s === undefined) {
        s = know(r)?.explored.join(",") ?? "";
        sigMemo.set(r, s);
      }
      return s;
    };
    const explored = (gx: number, gy: number): boolean => {
      const l = surface.toLocal(gx, gy);
      const k = l ? know(l.region) : null;
      return l !== null && k !== null && isExplored(k, l.x, l.y);
    };
    const painted: RegionImage[] = [];
    // The active region first, so it is never the one left waiting for the build budget.
    const order = [...regions].sort((a, b) => (a.region === active ? -1 : b.region === active ? 1 : 0));
    for (const r of order) {
      // Each image borrows a tile of fog from its neighbours, so their sweeps are part of its signature.
      const sig = regionAndNeighbours(surface, r.region)
        .map((n) => `${n}:${sigOf(n)}`)
        .join("|");
      const img = cache.painted(r.region, sig, explored, r.region === active);
      if (img) painted.push(img);
    }

    // Mid-drive, the sensors sweep ahead of the sim: paint tiles in (and show finds) as the rover passes.
    const sweep = 2 + sensorTierFor(state, loc.bodyId);
    let reveal: Reveal | null = null;
    let rc = revealRef.current;
    if (anim) {
      const n = Math.min(anim.pts.length - 1, Math.max(0, Math.round((t - anim.t0) / STEP_MS))) + 1;
      if (!rc || rc.anim !== anim) {
        rc = revealRef.current = { anim, n: 0, seen: new Set(), tiles: [], regions: new Set(), deposits: new Set(), flora: new Set() };
      }
      for (; rc.n < n; rc.n++) {
        const p = anim.pts[rc.n] as Vec2;
        for (const tile of disk(p, sweep)) {
          const region = surface.regionAt(tile.x, tile.y);
          if (region === null) continue;
          const i = tile.y * surface.width + tile.x;
          if (rc.seen.has(i)) continue;
          rc.seen.add(i);
          rc.tiles.push(tile);
          rc.regions.add(region);
        }
        for (const r of surface.regionsNear(p, sweep)) {
          const k = know(r) ?? NO_KNOWLEDGE;
          for (const d of surface.deposits(r)) if (!k.discovered.includes(d.id) && hexDistance(p, d) <= sweep) rc.deposits.add(d.key);
          for (const f of surface.flora(r)) if (!k.floraFound.includes(f.id) && hexDistance(p, f) <= sweep) rc.flora.add(f.key);
        }
      }
      const terrain: RegionImage[] = [];
      for (const r of rc.regions) {
        const img = cache.terrain(r, true);
        if (img) terrain.push(img);
      }
      reveal = { terrain, tiles: rc.tiles };
    } else {
      revealRef.current = rc = null;
    }
    drawBase(ctx, L, painted, regions, reveal);
    drawRegionBorders(ctx, L, regions, active);

    // Sites known in the regions in view, plus any the sweep has just picked up.
    const inView = regions.map((r) => r.region);
    const depMarks = knownDeposits(state, surface, loc.bodyId, inView);
    const floraMarks = knownFlora(state, surface, loc.bodyId, inView);
    if (rc) {
      for (const key of rc.deposits) {
        const d = surface.deposit(key);
        if (d) depMarks.push({ d, know: know(d.region) ?? NO_KNOWLEDGE });
      }
      for (const key of rc.flora) {
        const f = surface.floraSite(key);
        if (f) floraMarks.push({ f, know: know(f.region) ?? NO_KNOWLEDGE });
      }
    }

    if (tile) drawSensorRange(ctx, L, tile, sweep);
    drawShip(ctx, L, ship);
    drawFlora(ctx, L, floraMarks, selectedFlora?.f.key ?? null, t);
    drawDeposits(ctx, L, depMarks, selected?.d.key ?? null, t);

    // hover: route preview and tooltip
    const hover = anim || dragRef.current?.moved ? null : hoverRef.current;
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

  /** Terrain name, with the region when it isn't the one the rover (or ship) is in. */
  const tileName = (tile: Vec2): string => {
    const info = TERRAIN_INFO[(surface.terrainAt(tile.x, tile.y) ?? Terrain.plain) as Terrain];
    const r = surface.regionAt(tile.x, tile.y);
    const where = r !== null && r !== active ? ` · region ${r + 1}` : "";
    return `${info.name}${isShipTile(tile) ? " · ship" : ""}${where}`;
  };

  const hopTooltip = (tile: Vec2): TipLine[] => {
    const lines: TipLine[] = [{ text: tileName(tile), color: UI.text }];
    const blocker = hopBlocker(tile);
    if (blocker === null) {
      lines.push({ text: `Hop: ${hopFuelTo(state, world, tile.x, tile.y).toFixed(1)} fuel · ${formatDuration(HOP_MINUTES)}`, color: UI.good });
    } else {
      lines.push({ text: blocker, color: UI.danger });
    }
    return lines;
  };

  const tooltipLines = (tile: Vec2): TipLine[] => {
    const lines: TipLine[] = [];
    const terrain = surface.terrainAt(tile.x, tile.y);
    if (terrain === null) return lines;
    const info = TERRAIN_INFO[terrain];
    const needsClimber = info.passable === "climb" && !canClimb;
    lines.push({ text: tileName(tile), color: UI.text });
    const dep = depositAt(tile);
    const flora = floraAt(tile);
    if (flora) {
      lines.push({ text: `${flora.f.species} · ${floraStatus(flora.know, flora.f)}`, color: UI.good });
    }
    const local = surface.toLocal(tile.x, tile.y);
    const tileKnow = local ? peekKnowledge(state, loc.bodyId, local.region) : null;
    if (!local || !tileKnow || !isExplored(tileKnow, local.x, local.y)) lines.push({ text: "Not yet swept by sensors", color: UI.muted });
    if (dep) {
      const status = depositStatus(dep.know, dep.d);
      lines.push({
        text: `${COMMODITIES[dep.d.commodity].name} · ${status === "new" ? "unsurveyed" : status === "depleted" ? "worked out" : `${Math.round(dep.d.grade * 100)}%`}`,
        color: COMMODITIES[dep.d.commodity].color,
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

  /** The surface tile under a canvas pixel (null off the planet or in a gap of the region grid). */
  const surfaceTileAt = (px: number, py: number): Vec2 | null => {
    const L = layoutRef.current;
    const tile = L ? tileAt(L, px, py) : null;
    return tile && surface.regionAt(tile.x, tile.y) !== null ? tile : null;
  };

  const onMove = (px: number, py: number): void => {
    if (dragRef.current?.moved) return;
    const tile = surfaceTileAt(px, py);
    hoverRef.current = tile ? { tile, px, py } : null;
  };

  const onClick = (px: number, py: number): void => {
    if (dragRef.current?.moved) return;
    const tile = surfaceTileAt(px, py);
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
        setFollowing(true);
        const region = surface.regionAt(tile.x, tile.y);
        session.notify(`The ship set down at ${tile.x}, ${tile.y}${region !== null ? ` (region ${region + 1})` : ""}.`);
      }
      return;
    }
    const dep = depositAt(tile);
    const flora = floraAt(tile);
    if (dep) setSelectedKey(dep.d.key);
    else if (flora) setFloraKey(flora.f.key);
    void driveTo(tile, dep !== undefined || flora !== undefined);
  };

  // --- rover and ship actions (buttons and hotkeys share these) ------------------------------------

  const nearShip = rover !== null && hexDistance(rover, ship) <= 1;

  const doDeploy = (): void => {
    const r = session.act((s, w) => deployRover(s, w));
    if (!r.ok) return;
    setMoveMode(false);
    setFollowing(true);
    if (r.value.chargedHours >= 0.5) {
      session.notify(`Charged the rover's cells for ${formatDuration(r.value.chargedHours * HOUR)} before rolling out.`);
    }
  };

  const doStow = (): void => {
    const r = session.act((s, w) => stowRover(s, w));
    if (!r.ok) return;
    setRechargeHint(false);
    setSelectedKey(null);
    setFloraKey(null);
    const { unloaded, jettisoned } = r.value;
    session.notify(`Unloaded ${tonnes(unloaded)} into the hold.${jettisoned > 0.05 ? ` ${tonnes(jettisoned)} left behind: hold full.` : ""}`);
  };

  const doRecharge = (): void => {
    const r = session.act((s, w) => rechargeRover(s, w));
    setRechargeHint(false);
    if (r.ok) session.notify(`Recharged the rover's cells in ${formatDuration(r.value.hours * HOUR)}.`);
  };

  const doWork = async (mark: DepositMark): Promise<void> => {
    const dep = mark.d;
    const blockers = workBlockers(state, mark.know, dep);
    if (blockers[0]) {
      session.notify(blockers[0], "error");
      return;
    }
    // A rover already beside the deposit rolls onto it first, where you can see it.
    if (rover && hexDistance(rover, dep) <= 1 && !(await driveTo(dep, true, true))) return;
    const name = COMMODITIES[dep.commodity].name.toLowerCase();
    const r = session.act((s, w) => workDeposit(s, w, dep.key));
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
    if (!canEnter(surface, to.x, to.y, canClimb)) {
      if (!repeat) session.notify("The rover can't go that way.", "error");
      return;
    }
    const path = planPath(surface, rover, to, canClimb, false);
    if (!path) return;
    if (!camRef.current.follow) setFollowing(true);
    void drive(path);
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
    if (key === "+" || key === "=") {
      zoomBy(ZOOM_STEP);
      return;
    }
    if (key === "-" || key === "_") {
      zoomBy(1 / ZOOM_STEP);
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

  const activeMap = currentRegion(state, world);
  const present = activeMap ? ([...new Set(activeMap.terrain)] as Terrain[]).sort((a, b) => a - b) : [];
  const subject = rover ? "rover" : "ship";

  return (
    <>
      <div class="viewport surface-viewport" ref={wrapRef} onMouseDown={onMouseDown}>
        <Canvas
          draw={draw}
          onClick={onClick}
          onMove={onMove}
          onLeave={() => (hoverRef.current = null)}
          onWheel={(dy, x, y) => zoomBy(Math.exp(-dy * 0.0016), x, y)}
          animate
        />
        <div class="viewport-tools">
          <button class="btn" onClick={() => zoomBy(ZOOM_STEP)} title="Zoom in (+)">
            +
          </button>
          <button class="btn" onClick={() => zoomBy(1 / ZOOM_STEP)} title="Zoom out (−)">
            −
          </button>
          <button class="btn" onClick={() => setFollowing(true)} disabled={following} title={`Center the map on the ${subject} and follow it`}>
            Follow {subject}
          </button>
          <button class="btn" onClick={resetView} title="Reset zoom and follow the rover">
            Reset view
          </button>
        </div>
        <div class="surface-footer">
          <div class="viewport-hint">
            {moveMode && !rover
              ? "Click a clear tile to set the ship down · Esc to cancel · drag to pan, scroll to zoom"
              : rover
                ? "Click or Q/E/A/D/Z/C to drive · R stow at ship · F work selected deposit · drag to pan, scroll to zoom"
                : "R deploy rover · Hover for terrain · drag to pan, scroll to zoom"}
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
              disabled={busy || rover !== null || (!moveMode && hopBase > state.ship.fuel)}
              title={
                rover
                  ? "Stow the rover before moving the ship"
                  : hopBase > state.ship.fuel
                    ? `A hop needs at least ${hopBase.toFixed(1)} fuel`
                    : `Hop the ship to another open tile, anywhere on the planet: from ${hopBase.toFixed(1)} fuel (more the farther it goes), ${formatDuration(HOP_MINUTES)}`
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

        <Section id="planet" level={2} title={body.name} summary={`region ${active + 1} · explored ${exploredPct}%`}>
          <div class="muted small">
            Region {active + 1} of {body.regions} · {KIND_LABEL[body.kind]}
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
            site={selectedFlora.f}
            know={selectedFlora.know}
            rover={rover}
            atSite={atSite(selectedFlora.f)}
            goTo={() => driveTo(selectedFlora.f, true, true)}
            drive={() => void driveTo(selectedFlora.f, true)}
            busy={busy}
          />
        ) : selected ? (
          <DepositPanel
            session={session}
            dep={selected.d}
            know={selected.know}
            rover={rover}
            atSite={atSite(selected.d)}
            goTo={() => driveTo(selected.d, true, true)}
            drive={() => void driveTo(selected.d, true)}
            work={() => void doWork(selected)}
            busy={busy}
          />
        ) : (
          <div class="panel muted small">
            {discovered.length > 0 || floraFound.length > 0
              ? "Select a deposit or plant site on the map or in the list."
              : rover
                ? "No deposits detected nearby yet. Drive the rover around to sweep with its sensors."
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
                  .map((m) => ({ m, dist: hexDistance(home, m.f) }))
                  .sort((a, b) => a.dist - b.dist)
                  .map(({ m, dist }) => {
                    const { f } = m;
                    const sampled = floraStatus(m.know, f) === "sampled";
                    return (
                      <tr
                        key={f.key}
                        class={`${f.key === selectedFlora?.f.key ? "sel" : ""} ${sampled ? "dim" : ""}`}
                        title={f.region !== active ? `In region ${f.region + 1}` : undefined}
                        onClick={() => setFloraKey(f.key)}
                      >
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
            <div class="muted small tbl-note">
              In this region and the ones around it. Distance in tiles from {rover ? "the rover" : "the ship"}.
            </div>
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
                  .map((m) => ({ m, dist: hexDistance(home, m.d) }))
                  .sort((a, b) => a.dist - b.dist)
                  .map(({ m, dist }) => {
                    const { d } = m;
                    const status = depositStatus(m.know, d);
                    return (
                      <tr
                        key={d.key}
                        class={`${d.key === selected?.d.key ? "sel" : ""} ${status === "depleted" ? "dim" : ""}`}
                        title={d.region !== active ? `In region ${d.region + 1}` : undefined}
                        onClick={() => setSelectedKey(d.key)}
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
            <div class="muted small tbl-note">
              In this region and the ones around it. Distance in tiles from {rover ? "the rover" : "the ship"}.
            </div>
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
  site: SurfaceFlora;
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
    const r = session.act((s, w) => collectSample(s, w, site.key));
    if (r.ok) session.notify(`Collected a living sample of ${site.species}.`);
  };
  return (
    <Section id="plants" title="Selected plants" class="deposit-panel" revealKey={site.key}>
      <div class="dep-title">
        <i class="leaf-mark big" />
        <span>{site.species}</span>
        <span class={`tag ${sampled ? "" : "new"}`}>{sampled ? "sampled" : "unsampled"}</span>
      </div>
      <dl class="kv">
        <dt>Position</dt>
        <dd>
          {site.x}, {site.y} <span class="muted">(region {site.region + 1})</span>
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
  dep: SurfaceDeposit;
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
    session.act((s, w) => prospect(s, w, dep.key));
  };

  const runDrill = async (maxHours: number): Promise<void> => {
    if (!(await goTo())) return;
    const r = session.act((s, w) => drill(s, w, dep.key, maxHours));
    if (!r.ok) return;
    const { tonnes: got, hours, depleted, roverFull, incident } = r.value;
    const why = incident ? "interrupted" : depleted ? "deposit worked out" : roverFull ? "cargo bed full" : hours < maxHours - 0.01 ? "rover energy low" : "";
    session.notify(`Drilled ${tonnes(got)} of ${commodity.name.toLowerCase()} in ${formatDuration(hours * HOUR * SHIFT_FACTOR)}${why ? ` (${why})` : ""}.`);
    if (incident) session.notify(incident, "error");
  };

  return (
    <Section id="deposit" title="Selected deposit" class="deposit-panel" revealKey={dep.key}>
      <div class="dep-title" title={commodity.blurb}>
        <i class="swatch big" style={{ background: status === "depleted" ? "#5b6472" : commodity.color }} />
        <span>{commodity.name}</span>
        <span class={`tag ${status}`}>{status === "new" ? "unsurveyed" : status}</span>
      </div>
      <p class="muted small blurb">{commodity.blurb}</p>
      <dl class="kv">
        <dt>Position</dt>
        <dd>
          {dep.x}, {dep.y} <span class="muted">(region {dep.region + 1})</span>
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
