/**
 * Planet surface: a survey map over the whole world (one continuous hex map in planet-wide coordinates, drawn
 * region by region as the camera follows the rover), and the prospect → drill → haul loop.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { COMMODITIES } from "../../data/commodities";
import {
  activeRegion,
  autoWorkVehicleBlocker,
  boardBoat,
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
  drillRate,
  emptyKnowledge,
  exploredFraction,
  formatDuration,
  formatPressure,
  hasBoat,
  hexDistance,
  hexToPixel,
  HOP_MINUTES,
  hopFuel,
  hopFuelTo,
  HOUR,
  KEY_TO_DIR,
  KIND_LABEL,
  launch,
  launchBoat,
  launchBoatBlockers,
  mapPixelSize,
  moveRoverTo,
  neighbors,
  isExplored,
  normalizeKnowledge,
  PROSPECT_ENERGY,
  PROSPECT_MINUTES,
  prospect,
  putRoverAshore,
  RECALL_FUEL,
  recallRover,
  rechargeRover,
  REGION_SIZE,
  regionKey,
  relocateShip,
  remainingTonnes,
  roverChargePerHour,
  roverMobility,
  siteOnWater,
  roverSpecimenSlots,
  routeEnergyMult,
  hasPerk,
  effectiveStats,
  orbitalSensorTier,
  prospectRange,
  SAMPLE_ENERGY,
  SAMPLE_MINUTES,
  sensorRadius,
  surfaceBurnFuel,
  sensorSweep,
  detectsDeposit,
  detectsFlora,
  shipSpecimenSlots,
  shipTile,
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
  type World,
  type Vehicle,
  vehicleCargoT,
  vehicleEnergyMax,
  vehicleHome,
  vehicleMinutesMult,
  vehicleMismatch,
  vehicleMobility,
  vehicleOf,
  workDeposit,
} from "../../sim";
import { cargoList, pct, tonnes } from "../format";
import { TERRAIN_COLORS, UI } from "../palette";
import { useSession, type GameSession } from "../session";
import { RescuePanel } from "../Rescue";
import { Canvas } from "../Canvas";
import {
  cameraLayout,
  drawBase,
  drawBlockedTile,
  drawBoat,
  drawDeposits,
  drawEnergyBar,
  drawFlora,
  drawUnknowns,
  type UnknownMark,
  drawHoverTile,
  drawRegionBorders,
  drawRoute,
  drawRover,
  drawSensorRange,
  drawShip,
  drawShoreTargets,
  drawTooltip,
  fitSize,
  tileAt,
  tileCenter,
  viewCenter,
  visibleRegions,
  type DepositMark,
  type EnergyPreview,
  type FloraMark,
  type Layout,
  type Reveal,
  type TipLine,
} from "./surface/mapDraw";
import { affordablePrefix, energyHome, evaluate, planPath, type Mover, type RoutePlan } from "./surface/routing";
import { Section } from "../Section";
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
function workBlockers(state: GameState, world: World, know: RegionKnowledge, dep: Deposit): string[] {
  const stats = effectiveStats(state);
  const out: string[] = [];
  if (!know.discovered.includes(dep.id)) out.push("This deposit hasn't been discovered yet.");
  else if (depositStatus(know, dep) === "depleted") out.push("This deposit is worked out.");
  else if (dep.depthM > stats.drillMaxDepthM) {
    out.push(`The seam is ${dep.depthM} m down and the drill only reaches ${stats.drillMaxDepthM} m. A better drill would get it.`);
  }
  if (out.length === 0 && stats.cargoCapacityT - cargoTonnes(state.ship.cargo) <= 0.5) out.push("The ship's hold is full.");
  // Seabed seams need the boat, land seams the rover (and the other one stowed).
  const vehicle = out.length === 0 ? autoWorkVehicleBlocker(state, world, dep) : null;
  if (vehicle) out.push(vehicle);
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

/** Sites the sensors flagged but haven't identified yet, in `regions`. */
function sensedSites(state: GameState, surface: BodySurface, bodyId: string, regions: readonly number[]): (UnknownMark & { key: string })[] {
  const out: (UnknownMark & { key: string })[] = [];
  for (const r of regions) {
    const know = peekKnowledge(state, bodyId, r);
    if (!know) continue;
    if (know.sensed?.length) {
      for (const d of surface.deposits(r)) if (know.sensed.includes(d.id) && !know.discovered.includes(d.id)) out.push({ x: d.x, y: d.y, kind: "deposit", key: d.key });
    }
    if (know.floraSensed?.length) {
      for (const f of surface.flora(r)) if (know.floraSensed.includes(f.id) && !know.floraFound.includes(f.id)) out.push({ x: f.x, y: f.y, kind: "flora", key: f.key });
    }
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
  const stats = effectiveStats(state);
  // The vehicle being driven: the rover, or (AW-17) the survey boat. `loc.parkedBoat` waits offshore while the
  // rover is ashore; `loc.roverAboard` rides the boat's deck.
  const rover = loc.rover;
  const vehicle: Vehicle | null = rover ? vehicleOf(rover) : null;
  const isBoat = vehicle === "boat";
  const noun = isBoat ? "boat" : "rover";
  const parkedBoat = loc.parkedBoat ?? null;
  const roverAboard = loc.roverAboard ?? null;
  const energyMax = vehicle ? vehicleEnergyMax(state, vehicle) : stats.roverEnergy;
  const cargoMax = vehicle ? vehicleCargoT(state, vehicle) : stats.roverCargoT;
  const busy = session.busy;
  const mover: Mover = { mobility: vehicleMobility(state), energyMult: routeEnergyMult(state), minutesMult: vehicleMinutesMult(state) };
  const canClimb = mover.mobility.canClimb;

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
  // "Put rover ashore" targeting mode (boat out with the rover aboard): pick a shore hex beside the boat.
  const [ashoreMode, setAshoreModeRaw] = useState(false);
  const setAshoreMode = (on: boolean): void => {
    setAshoreModeRaw(on);
    if (on) setMoveMode(false);
  };
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
  // Boat out with the rover on deck: the land hexes beside the boat where it can be put ashore.
  const ashoreOn = ashoreMode && isBoat && roverAboard !== null;
  const shoreTargets: Vec2[] =
    isBoat && roverAboard && rover ? neighbors(rover.x, rover.y).filter((n) => canEnter(surface, n.x, n.y, roverMobility(state))) : [];
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

  // Where the vehicle heads to go home: the boat to the water beside the ship, a rover to its moored boat's shore.
  const homeSpot = vehicleHome(state, world);
  const homeName = !isBoat && parkedBoat ? "the boat" : "the ship";
  const homeEnergy = rover ? energyHome(surface, rover, homeSpot, mover) : null;
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
      session.notify(`${isBoat ? "Boat" : "Rover"} energy is too low to move.`, "error");
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
    let result: ReturnType<typeof moveRoverTo>;
    try {
      result = session.act((s, w) => moveRoverTo(s, w, last.x, last.y), { timelapse: false });
    } finally {
      session.setBusy(false);
    }
    if (!result.ok) return false;
    const cut = result.value.stopped !== null || steps.length < path.length;
    if (cut) {
      session.notify(`${isBoat ? "Boat" : "Rover"} energy ran out before it reached the target.`, "error");
      return false;
    }
    const now = session.state.location;
    if (!quiet && !startedNearShip && now.kind === "surface" && now.rover) {
      if (hexDistance(now.rover, ship) <= 1 && now.rover.energy < energyMax * RECHARGE_HINT_BELOW) setRechargeHint(true);
    }
    return true;
  };

  /** True when the rover is already at the site: on its tile, or beside it if the tile can't be entered. */
  const atSite = (site: Vec2): boolean =>
    rover !== null &&
    ((rover.x === site.x && rover.y === site.y) || (!canEnter(surface, site.x, site.y, mover.mobility) && hexDistance(rover, site) <= 1));

  /**
   * Drive to a tile. With `approach` (deposits and plants) the rover goes onto the site itself, even when
   * it is already beside it; it settles for the nearest open neighbour only if the site can't be entered.
   * Resolves true once the rover is there.
   */
  const driveTo = async (target: Vec2, approach: boolean, quiet = false): Promise<boolean> => {
    if (!rover || session.busy) return false;
    if (rover.x === target.x && rover.y === target.y) return true;
    if (approach && atSite(target)) return true;
    const path = planPath(surface, rover, target, mover, approach);
    if (!path) {
      session.notify(isBoat ? "No open water route there." : "No route there for this rover.", "error");
      return false;
    }
    return drive(path, quiet);
  };

  // --- ship hop --------------------------------------------------------------------------

  const hopBase = hopFuel(state, world);
  const burnFuel = surfaceBurnFuel(state, body);
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
    const key = `${vehicle},${rover.x},${rover.y},${tile.x},${tile.y},${rover.energy},${homeSpot.x},${homeSpot.y}`;
    if (routeRef.current.key === key) return routeRef.current.plan;
    const site = depositAt(tile) !== undefined || floraAt(tile) !== undefined;
    const inRange = site ? atSite(tile) : rover.x === tile.x && rover.y === tile.y;
    const path = inRange ? null : planPath(surface, rover, tile, mover, site);
    const plan = path && path.length > 0 ? evaluate(surface, path, rover, homeSpot, mover) : null;
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
    // The sim's own sweep rules, so the preview never shows a site the sensors won't actually find.
    const sensors = sensorSweep(state, loc.bodyId);
    const sweep = sensors.radius;
    const depositSweep = sensors.depositRange;
    const floraSweep = sensors.floraRange;
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
        for (const r of surface.regionsNear(p, Math.max(sweep, depositSweep, floraSweep))) {
          const k = know(r) ?? NO_KNOWLEDGE;
          for (const d of surface.deposits(r)) if (!k.discovered.includes(d.id) && detectsDeposit(sensors, p, d)) rc.deposits.add(d.key);
          for (const f of surface.flora(r)) if (!k.floraFound.includes(f.id) && detectsFlora(sensors, p, f)) rc.flora.add(f.key);
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
    // Flagged but unidentified: a "?" until the sensors get close (the sweep in progress identifies some).
    const unknowns = sensedSites(state, surface, loc.bodyId, inView).filter((u) => !rc || (!rc.deposits.has(u.key) && !rc.flora.has(u.key)));
    drawUnknowns(ctx, L, unknowns, t);
    drawFlora(ctx, L, floraMarks, selectedFlora?.f.key ?? null, t);
    drawDeposits(ctx, L, depMarks, selected?.d.key ?? null, t, stats.drillMaxDepthM);

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
    if (ashoreOn) drawShoreTargets(ctx, L, shoreTargets, hover?.tile ?? null, t);
    if (hover && hopping && hopBlocker(hover.tile) !== null && !isShipTile(hover.tile)) {
      drawBlockedTile(ctx, L, hover.tile);
    } else if (hover && hopping && !isShipTile(hover.tile)) {
      // Ghost ship where it would set down.
      ctx.globalAlpha = 0.55;
      drawShip(ctx, L, hover.tile);
      ctx.globalAlpha = 1;
      drawHoverTile(ctx, L, hover.tile);
    } else if (hover) drawHoverTile(ctx, L, hover.tile);

    // The boat waiting offshore while the rover is ashore.
    if (parkedBoat) drawBoat(ctx, L, tileCenter(L, parkedBoat), t, 0, { moored: true });
    if (pos && tile && rover) {
      if (isBoat) {
        drawBoat(ctx, L, pos, t, hd.cur, { moving: anim !== null, roverAboard: roverAboard !== null });
        drawEnergyBar(ctx, L, pos, false, Math.max(0, rover.energy - spent), energyMax, preview);
      } else {
        const onPad = tile.x === ship.x && tile.y === ship.y;
        drawRover(ctx, L, pos, t, onPad, facingRef.current, hd.cur);
        drawEnergyBar(ctx, L, pos, onPad, Math.max(0, rover.energy - spent), energyMax, preview);
      }
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
      if (terrain === Terrain.liquid) lines.push({ text: "Seabed deposit (dredge with the boat)", color: UI.cyan });
    }
    if (flora && terrain === Terrain.liquid) lines.push({ text: "Sea life (sample from the boat)", color: UI.cyan });
    if (dep && flora) lines.push({ text: "Click again to switch between them", color: UI.muted });
    if (!dep && !flora && local && tileKnow) {
      const sensedDep = tileKnow.sensed?.length && surface.deposits(local.region).some((d) => d.x === tile.x && d.y === tile.y && tileKnow.sensed!.includes(d.id) && !tileKnow.discovered.includes(d.id));
      const sensedFlora = tileKnow.floraSensed?.length && surface.flora(local.region).some((f) => f.x === tile.x && f.y === tile.y && tileKnow.floraSensed!.includes(f.id) && !tileKnow.floraFound.includes(f.id));
      if (sensedDep) lines.push({ text: "Unidentified deposit reading: drive closer to identify", color: UI.text });
      if (sensedFlora) lines.push({ text: "Unidentified plant reading: drive closer to identify", color: UI.good });
    }
    const site = dep !== undefined || flora !== undefined;
    const sea = terrain === Terrain.liquid;
    if (ashoreOn) {
      const ok = shoreTargets.some((n) => n.x === tile.x && n.y === tile.y);
      lines.push(ok ? { text: "Click to put the rover ashore here", color: UI.good } : { text: "Pick a lit shore hex beside the boat", color: UI.muted });
    } else if (isBoat && !sea && !site) {
      lines.push({ text: "Dry land: the boat sails open water only", color: UI.muted });
    } else if (!isBoat && sea && !site) {
      lines.push({ text: hasBoat(state) ? "Open water: take the boat out to sail it" : "Impassable", color: UI.muted });
    } else if (!sea && info.passable === "no") {
      lines.push({ text: "Impassable", color: UI.muted });
    } else if (!isBoat && needsClimber) {
      lines.push({ text: "Rover can't climb this", color: UI.muted });
    } else if (!rover) {
      lines.push({ text: sea && hasBoat(state) ? "Launch the boat to sail" : "Deploy the rover to drive", color: UI.muted });
    } else {
      const plan = hoverPlan(tile);
      if (plan) {
        const bad = plan.energy > rover.energy;
        const strands = plan.back === null || plan.energy + plan.back > rover.energy;
        lines.push({
          text: `${isBoat ? "Sail" : "Drive"} ${formatDuration(plan.minutes * SHIFT_FACTOR)} · ${plan.energy.toFixed(1)} energy`,
          color: bad || strands ? UI.danger : UI.good,
        });
        if (bad) lines.push({ text: "Not enough energy", color: UI.danger });
        else if (strands) lines.push({ text: `Too far to return to ${homeName}`, color: UI.danger });
      } else if (site && atSite(tile)) {
        lines.push({ text: `${isBoat ? "Boat" : "Rover"} is in range`, color: UI.good });
      } else if (!(rover.x === tile.x && rover.y === tile.y)) {
        lines.push({ text: "No route", color: UI.danger });
      }
      const wrong = dep ? vehicleMismatch(vehicle, sea, "deposit") : flora ? vehicleMismatch(vehicle, sea, "plants") : null;
      if (wrong) lines.push({ text: wrong, color: UI.muted });
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
    if (ashoreOn) {
      if (!shoreTargets.some((n) => n.x === tile.x && n.y === tile.y)) {
        session.notify("Pick one of the lit shore hexes right beside the boat.", "error");
        return;
      }
      const r = session.act((s, w) => putRoverAshore(s, w, tile.x, tile.y));
      if (r.ok) {
        setAshoreMode(false);
        setFollowing(true);
        session.notify("The rover is ashore. The boat waits, moored offshore: drive back beside it and board to sail on.");
      }
      return;
    }
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
    // A deposit and a plant site can share a hex: repeated clicks alternate between them.
    if (dep && flora) {
      if (selected?.d.key === dep.d.key) setFloraKey(flora.f.key);
      else setSelectedKey(dep.d.key);
    } else if (dep) setSelectedKey(dep.d.key);
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

  const launchBlock = launchBoatBlockers(state, world)[0] ?? null;
  const doLaunch = (withRover: boolean): void => {
    const r = session.act((s, w) => launchBoat(s, w, withRover));
    if (!r.ok) return;
    setMoveMode(false);
    setAshoreMode(false);
    setFollowing(true);
    if (r.value.chargedHours >= 0.5) {
      session.notify(`Charged the ${withRover ? "boat's and rover's cells" : "boat's cells"} for ${formatDuration(r.value.chargedHours * HOUR)} before launching.`);
    }
  };

  const doBoard = (): void => {
    const r = session.act((s, w) => boardBoat(s, w));
    if (!r.ok) return;
    setFollowing(true);
    session.notify("The rover is back aboard the boat. Sail on, or put it ashore elsewhere.");
  };

  const doStow = (): void => {
    const r = session.act((s, w) => stowRover(s, w));
    if (!r.ok) return;
    setRechargeHint(false);
    setAshoreMode(false);
    setSelectedKey(null);
    setFloraKey(null);
    const { unloaded, jettisoned } = r.value;
    session.notify(`Unloaded ${tonnes(unloaded)} into the hold.${jettisoned > 0.05 ? ` ${tonnes(jettisoned)} left behind: hold full.` : ""}`);
  };

  const doRecharge = (): void => {
    const r = session.act((s, w) => rechargeRover(s, w));
    setRechargeHint(false);
    if (r.ok) session.notify(`Recharged the ${noun}'s cells in ${formatDuration(r.value.hours * HOUR)}.`);
  };

  const doWork = async (mark: DepositMark): Promise<void> => {
    const dep = mark.d;
    const blockers = workBlockers(state, world, mark.know, dep);
    if (blockers[0]) {
      session.notify(blockers[0], "error");
      return;
    }
    // A vehicle already beside the deposit moves onto it first, where you can see it.
    const rightVehicle = rover !== null && vehicleMismatch(vehicle, siteOnWater(world, loc.bodyId, dep), "deposit") === null;
    if (rightVehicle && rover && hexDistance(rover, dep) <= 1 && !(await driveTo(dep, true, true))) return;
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
    if (!canEnter(surface, to.x, to.y, mover.mobility)) {
      if (!repeat) session.notify(isBoat ? "The boat sails open water only." : "The rover can't go that way.", "error");
      return;
    }
    const path = planPath(surface, rover, to, mover, false);
    if (!path) return;
    if (!camRef.current.follow) setFollowing(true);
    void drive(path);
  };

  const rechargeHours = rover ? Math.max(0, energyMax - rover.energy) / roverChargePerHour(state) : 0;
  const canRecharge = rover !== null && nearShip && energyMax - rover.energy >= 0.5;

  keyRef.current = (ev: KeyboardEvent): void => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const el = ev.target;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
    const key = ev.key.toLowerCase();
    if (key === "escape") {
      if (moveMode) setMoveMode(false);
      if (ashoreMode) setAshoreMode(false);
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
      else if (parkedBoat) session.notify("The boat is still moored offshore: board it and sail it back first.", "error");
      else if (nearShip) doStow();
      else session.notify(isBoat ? "Sail the boat back to the ship first." : "Drive the rover back to the ship first.", "error");
    } else if (key === "b") {
      if (!rover && hasBoat(state)) {
        if (launchBlock) session.notify(launchBlock, "error");
        else doLaunch(false);
      }
    } else if (key === "f") {
      if (selected) void doWork(selected);
      else session.notify("Select a deposit first.", "error");
    }
  };

  const activeMap = currentRegion(state, world);
  const present = activeMap ? ([...new Set(activeMap.terrain)] as Terrain[]).sort((a, b) => a - b) : [];
  const subject = rover ? noun : "ship";
  // What has to come back before the ship can move or lift off.
  const outText = isBoat ? (roverAboard ? "Bring the boat in and stow it and the rover" : "Bring the boat in and stow it") : parkedBoat ? "Stow the rover and the moored boat" : "Stow the rover";

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
          <button class="btn" onClick={resetView} title={`Reset zoom and follow the ${subject}`}>
            Reset view
          </button>
        </div>
        <div class="surface-footer">
          <div class="viewport-hint">
            {ashoreOn
              ? "Click a lit shore hex beside the boat to put the rover ashore · Esc to cancel · drag to pan, scroll to zoom"
              : moveMode && !rover
                ? "Click a clear tile to set the ship down · Esc to cancel · drag to pan, scroll to zoom"
                : isBoat
                  ? "Click or Q/E/A/D/Z/C to sail · R stow at ship · F work selected seabed deposit · drag to pan, scroll to zoom"
                  : rover
                    ? `Click or Q/E/A/D/Z/C to drive · R stow at ship · F work selected deposit${parkedBoat ? " · the boat waits offshore" : ""} · drag to pan, scroll to zoom`
                    : `R deploy rover${hasBoat(state) ? " · B launch boat" : ""} · Hover for terrain · drag to pan, scroll to zoom`}
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
              {isBoat ? "Boat" : "Rover"} is beside the ship at {Math.round(pct(rover.energy, energyMax))}% energy. Top up the cells (
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
        <RescuePanel session={session} busy={busy} />
        <div class="action-bar">
          <div class="ab-group">
            <span class="ab-label">{isBoat ? "Boat" : "Rover"}</span>
            {!rover && (
              <>
                <button class="btn" disabled={busy} title="Charge the cells and roll the rover out (R)" onClick={doDeploy}>
                  Deploy rover
                </button>
                {hasBoat(state) && (
                  <>
                    <button
                      class="btn"
                      disabled={busy || launchBlock !== null}
                      title={launchBlock ?? "Charge the cells and lower the survey boat into the water beside the ship (B)"}
                      onClick={() => doLaunch(false)}
                    >
                      Launch boat
                    </button>
                    <button
                      class="btn"
                      disabled={busy || launchBlock !== null}
                      title={launchBlock ?? "Launch the boat with the rover lashed to its deck, to put it ashore on another coast"}
                      onClick={() => doLaunch(true)}
                    >
                      Launch boat with rover
                    </button>
                    {launchBlock && <p class="muted small ab-hint">{launchBlock}</p>}
                  </>
                )}
              </>
            )}
            {rover && (
              <>
                <button
                  class="btn"
                  disabled={busy || (isBoat ? nearShip : rover.x === ship.x && rover.y === ship.y)}
                  title={isBoat ? "Sail back to the water beside the ship" : "Drive back to the ship"}
                  onClick={() => void driveTo(isBoat ? homeSpot : ship, false)}
                >
                  Return to ship
                </button>
                <button
                  class="btn"
                  disabled={busy || !nearShip || parkedBoat !== null}
                  title={
                    parkedBoat
                      ? "The boat is still moored offshore: board it and sail it back first"
                      : !nearShip
                        ? `${isBoat ? "Sail the boat" : "Drive the rover"} back to the ship first`
                        : `Unloads the ${isBoat ? "hold" : "cargo bed"}${roverAboard ? " (and the rover on deck)" : ""} and recharges, 30 min (R)`
                  }
                  onClick={doStow}
                >
                  Stow &amp; unload
                </button>
                <button
                  class="btn"
                  disabled={busy || !canRecharge}
                  title={
                    !nearShip
                      ? `${isBoat ? "Sail the boat" : "Drive the rover"} back to the ship to recharge`
                      : !canRecharge
                        ? `The ${noun}'s cells are already full`
                        : `Top up the cells from the ship's reactor without stowing: ${formatDuration(rechargeHours * HOUR)}`
                  }
                  onClick={doRecharge}
                >
                  Recharge
                </button>
              </>
            )}
            {isBoat && roverAboard && (
              <button
                class={`btn ${ashoreOn ? "active" : ""}`}
                disabled={busy}
                title={
                  ashoreOn
                    ? "Cancel (Esc)"
                    : shoreTargets.length === 0
                      ? "No drivable shore beside the boat: sail up to a coast first"
                      : "Pick a shore hex next to the boat and drive the rover off. The boat waits, moored. 20 min"
                }
                onClick={() => setAshoreMode(!ashoreOn)}
              >
                {ashoreOn ? "Cancel" : "Put rover ashore"}
              </button>
            )}
            {!isBoat && parkedBoat && rover && (
              <button
                class="btn"
                disabled={busy || hexDistance(rover, parkedBoat) > 1}
                title={hexDistance(rover, parkedBoat) > 1 ? "Drive to the shore beside the boat" : "Drive the rover back aboard the boat. 20 min"}
                onClick={doBoard}
              >
                Board the boat
              </button>
            )}
            {stranded && (
              <button
                class="btn danger"
                disabled={busy || state.ship.fuel < RECALL_FUEL}
                title={`The ${noun} can't get home on its remaining energy. The ship hops over and winches ${isBoat || parkedBoat ? "everything" : "it"} aboard: ${RECALL_FUEL} fuel and 3 h`}
                onClick={() => session.act((s, w) => recallRover(s, w))}
              >
                Recall {noun}
              </button>
            )}
            {parkedBoat && !isBoat && <p class="muted small ab-hint">The boat is moored offshore. Board it before you stow.</p>}
          </div>
          <div class="ab-group ship">
            <span class="ab-label">Ship</span>
            <button
              class={`btn ${moveMode && !rover ? "active" : ""}`}
              disabled={busy || rover !== null || (!moveMode && hopBase > state.ship.fuel)}
              title={
                rover
                  ? `${outText} before moving the ship`
                  : hopBase > state.ship.fuel
                    ? `A hop needs at least ${hopBase.toFixed(1)} fuel`
                    : `Hop the ship to another open tile, anywhere on the planet: from ${hopBase.toFixed(1)} fuel (more the farther it goes), ${formatDuration(HOP_MINUTES)}. A hop is cheaper than lifting off and landing again (${burnFuel.toFixed(1)} fuel each way): it costs about half a burn plus distance, so a region over is roughly one burn versus two.`
              }
              onClick={toggleMoveMode}
            >
              {moveMode && !rover ? "Cancel move" : "Move ship"}
            </button>
            <button
              class="btn liftoff"
              disabled={busy || rover !== null}
              title={
                rover
                  ? `Take the ship back to orbit (${outText.charAt(0).toLowerCase()}${outText.slice(1)} first)`
                  : state.ship.fuel < burnFuel
                    ? `Ascent needs ${burnFuel.toFixed(1)} fuel and you have ${state.ship.fuel.toFixed(1)}`
                    : `Take the ship back to orbit. Ascent burns ${burnFuel.toFixed(1)} fuel (landing again costs the same).`
              }
              onClick={doLiftOff}
            >
              Lift off ({burnFuel.toFixed(1)} fuel)
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

        <RoverPanel
          rover={rover}
          parkedBoat={parkedBoat}
          roverAboard={roverAboard}
          energyMax={energyMax}
          cargoMax={cargoMax}
          homeName={homeName}
          state={state}
          homeEnergy={homeEnergy}
          stranded={stranded}
        />
        <ShipPanel vehicles={[rover, roverAboard, parkedBoat].filter((v): v is RoverState => v !== null)} stats={stats} state={state} bodyId={loc.bodyId} />

        {(() => {
          // The other site on the same hex, if any, so it can be reached from here too.
          const twinDep = selectedFlora ? depositAt(selectedFlora.f) : undefined;
          const twinFlora = !selectedFlora && selected ? floraAt(selected.d) : undefined;
          if (!twinDep && !twinFlora) return null;
          return (
            <div class="panel small twin-note">
              Also on this hex:{" "}
              {twinDep ? (
                <button class="btn" onClick={() => setSelectedKey(twinDep.d.key)}>
                  {COMMODITIES[twinDep.d.commodity].name} deposit
                </button>
              ) : (
                twinFlora && (
                  <button class="btn" onClick={() => setFloraKey(twinFlora.f.key)}>
                    {twinFlora.f.species}
                  </button>
                )
              )}
            </div>
          );
        })()}
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
                ? `No deposits detected nearby yet. ${isBoat ? "Sail the boat" : "Drive the rover"} around to sweep with its sensors.`
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
                          {siteOnWater(world, loc.bodyId, f) && <span class="tag sea" title="Sea life: sample it from the boat"> sea</span>}
                        </td>
                        <td class="num">{dist}</td>
                        <td>{sampled ? <span class="muted">sampled ✓</span> : <span class="tag new">new</span>}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <div class="muted small tbl-note">
              In this region and the ones around it. Distance in tiles from {rover ? `the ${noun}` : "the ship"}.
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
                          {siteOnWater(world, loc.bodyId, d) && <span class="tag sea" title="Seabed deposit: dredge it from the boat"> seabed</span>}
                        </td>
                        <td class="num">{dist}</td>
                        <td>
                          {status === "new" && <span class="tag new">new</span>}
                          {status === "prospected" && <span class="tag">{Math.round(d.grade * 100)}%</span>}
                          {status === "depleted" && <span class="muted">depleted</span>}
                          {status !== "depleted" && d.depthM > stats.drillMaxDepthM && (
                            <span class="danger small" title={`${d.depthM} m down; the drill reaches ${stats.drillMaxDepthM} m`}>
                              {" "}
                              too deep
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <div class="muted small tbl-note">
              In this region and the ones around it. Distance in tiles from {rover ? `the ${noun}` : "the ship"}.
            </div>
          </Section>
        )}
      </aside>
    </>
  );
}

function RoverPanel({
  rover,
  parkedBoat,
  roverAboard,
  energyMax,
  cargoMax,
  homeName,
  state,
  homeEnergy,
  stranded,
}: {
  rover: RoverState | null;
  /** The boat moored offshore while the rover is ashore. */
  parkedBoat: RoverState | null;
  /** The rover riding the boat's deck. */
  roverAboard: RoverState | null;
  /** Cell and hold capacity of the vehicle being driven. */
  energyMax: number;
  cargoMax: number;
  homeName: string;
  state: GameState;
  homeEnergy: number | null;
  stranded: boolean;
}) {
  const boat = rover !== null && vehicleOf(rover) === "boat";
  const noun = boat ? "boat" : "rover";
  const energyLow = rover !== null && (stranded || rover.energy < energyMax * 0.3);
  const tight = rover !== null && !stranded && homeEnergy !== null && rover.energy < homeEnergy * 1.3;
  const bedT = rover ? cargoTonnes(rover.cargo) : 0;
  const roverSamples = specimenCount(rover?.specimens);
  const slots = roverSpecimenSlots(state);
  const title = boat ? "Boat" : "Rover";
  const other = boat ? roverAboard : parkedBoat;
  const otherName = boat ? "Rover (on deck)" : "Boat (moored offshore)";
  return (
    <Section id="rover" title={title} summary={rover ? `energy ${Math.round(rover.energy)} / ${energyMax}` : "stowed"}>
      {rover ? (
        <>
          <dl class="kv">
            <dt>Energy</dt>
            <dd>
              {Math.round(rover.energy)} / {energyMax}
            </dd>
          </dl>
          <div class={`bar ${energyLow || tight ? "warn" : ""}`}>
            <span style={{ width: `${pct(rover.energy, energyMax)}%` }} />
          </div>
          {stranded ? (
            <p class="danger small act-note">
              {homeEnergy === null
                ? `No route back to ${homeName} for this ${noun}.`
                : `Not enough energy to get home (needs ${homeEnergy.toFixed(1)}).`}
            </p>
          ) : (
            tight &&
            homeEnergy !== null && (
              <p class="accent small act-note">Energy is getting tight: the trip home takes {homeEnergy.toFixed(1)}.</p>
            )
          )}
          <dl class="kv spaced">
            <dt>{boat ? "Hold" : "Cargo bed"}</dt>
            <dd>
              {tonnes(bedT)} / {tonnes(cargoMax)}
            </dd>
          </dl>
          <div class="bar">
            <span style={{ width: `${pct(bedT, cargoMax)}%` }} />
          </div>
          <CargoChips cargo={rover.cargo} />
          <dl class="kv spaced">
            <dt>Sample cases</dt>
            <dd class={roverSamples >= slots ? "accent" : ""}>
              {roverSamples} / {slots}
            </dd>
          </dl>
          <div class={`bar ${roverSamples >= slots ? "warn" : ""}`}>
            <span style={{ width: `${pct(roverSamples, slots)}%` }} />
          </div>
          <SpecimenChips specimens={rover.specimens} />
          {other && (
            <div class="other-vehicle small">
              <div class="muted">{otherName}</div>
              <div>
                Energy {Math.round(other.energy)} / {vehicleEnergyMax(state, vehicleOf(other))}
                {cargoTonnes(other.cargo) > 0.05 && <span class="muted"> · hold {tonnes(cargoTonnes(other.cargo))}</span>}
                {specimenCount(other.specimens) > 0 && <span class="muted"> · {specimenCount(other.specimens)} samples</span>}
              </div>
            </div>
          )}
        </>
      ) : (
        <p class="muted small">Stowed aboard.</p>
      )}
    </Section>
  );
}

function ShipPanel({
  vehicles,
  stats,
  state,
  bodyId,
}: {
  /** Every vehicle that's out (the one being driven, the rover on deck, the moored boat). */
  vehicles: RoverState[];
  stats: ReturnType<typeof effectiveStats>;
  state: GameState;
  bodyId: string;
}) {
  const hold = cargoTonnes(state.ship.cargo);
  const fuelPct = pct(state.ship.fuel, stats.fuelCapacity);
  const roverSamples = vehicles.reduce((n, v) => n + specimenCount(v.specimens), 0);
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
              {shipSamples} / {shipSpecimenSlots(state)}
            </dd>
          </dl>
          <div class="bar">
            <span style={{ width: `${pct(shipSamples, shipSpecimenSlots(state))}%` }} />
          </div>
          <SpecimenChips specimens={state.ship.specimens} />
        </>
      )}
      {jobs.map((c) => {
        const inRover = vehicles.reduce((n, v) => n + specimensFrom(v.specimens, bodyId), 0);
        const aboard = specimensFrom(state.ship.specimens, bodyId);
        const need = c.count ?? 0;
        const have = inRover + aboard;
        return (
          <div key={c.id} class="contract-note small" title={c.text}>
            <span class="accent">◆</span> {c.title}: {have} / {need} samples{" "}
            <span class="muted">
              ({inRover} in the field, {aboard} aboard)
            </span>
            {have >= need && <div class="good">Enough collected. Stow everything, lift off, and hand it in at the Intrepid.</div>}
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
  const loc = session.state.location;
  const wet = siteOnWater(session.world, loc.kind === "surface" ? loc.bodyId : "", site);
  const vehicle = rover ? vehicleOf(rover) : null;
  const noun = vehicle === "boat" ? "boat" : "rover";
  const wrong = vehicleMismatch(vehicle, wet, "plants");
  const blockers: string[] = [];
  if (sampled) blockers.push("Already sampled here.");
  if (wrong) blockers.push(wrong);
  else if (rover) {
    if (!near && !sampled) blockers.push(`The ${noun} is ${dist} tiles away: ${vehicle === "boat" ? "sail" : "drive"} it next to the ${wet ? "sea life" : "plants"}.`);
    if (specimenCount(rover.specimens) >= roverSpecimenSlots(session.state)) {
      blockers.push(`The ${noun}'s sample cases are full. ${vehicle === "boat" ? "Sail" : "Drive"} back to the ship and stow.`);
    }
    if (rover.energy < SAMPLE_ENERGY) blockers.push(`The sample kit needs ${SAMPLE_ENERGY} ${noun} energy.`);
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
        {wet && <span class="tag sea">sea life</span>}
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
        {rover && !wrong && !atSite && !sampled && (
          <button class="btn" disabled={busy} onClick={drive}>
            {vehicle === "boat" ? "Sail there" : "Drive there"}
          </button>
        )}
        <button class="btn primary" disabled={busy || blockers.length > 0} onClick={() => void collect()}>
          Collect sample ({formatDuration(SAMPLE_MINUTES * SHIFT_FACTOR)})
        </button>
      </div>
      {blockers.length === 0 && (
        <p class="muted small act-note">
          Uses {SAMPLE_ENERGY} {noun} energy. Samples ride in the {noun}'s cases until you stow it.
        </p>
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
  const stats = effectiveStats(session.state);
  const commodity = COMMODITIES[dep.commodity];
  const status = depositStatus(know, dep);
  const prospected = know.prospected.includes(dep.id);
  const isSite = know.drillSites.includes(dep.id);
  const dist = rover ? hexDistance(rover, dep) : null;
  const near = dist !== null && dist <= 1;
  const remaining = remainingTonnes(know, dep);
  const tooDeep = dep.depthM > stats.drillMaxDepthM;
  const rate = drillRate(session.state, dep);
  // Seabed seams are dredged from the boat (AW-17); everything else is the rover's.
  const loc = session.state.location;
  const wet = siteOnWater(session.world, loc.kind === "surface" ? loc.bodyId : "", dep);
  const vehicle = rover ? vehicleOf(rover) : null;
  const noun = vehicle === "boat" ? "boat" : "rover";
  const go = vehicle === "boat" ? "sail" : "drive";
  const wrong = vehicleMismatch(vehicle, wet, "deposit");
  const bedName = vehicle === "boat" ? "hold" : "cargo bed";
  const room = rover ? vehicleCargoT(session.state, vehicle as Vehicle) - cargoTonnes(rover.cargo) : 0;
  const dredge = wet ? "Dredge" : "Drill";

  const workBlock = workBlockers(session.state, session.world, know, dep);

  const placement: string[] = [];
  if (wrong) placement.push(wrong);
  else if (!near) placement.push(`The ${noun} is ${dist} tiles away: ${go} it next to the deposit.`);

  // Assayer (science): prospecting works from two hexes out, in half the time. Drilling still needs the vehicle beside the seam.
  const pRange = prospectRange(session.state);
  const prospectBlockers: string[] = [];
  if (wrong) prospectBlockers.push(wrong);
  else if (dist !== null && dist > pRange) {
    prospectBlockers.push(`The ${noun} is ${dist} tiles away: ${go} it ${pRange > 1 ? `within ${pRange} tiles of` : "next to"} the deposit.`);
  }
  const prospectMinutes = PROSPECT_MINUTES * SHIFT_FACTOR * (hasPerk(session.state, "assayer") ? 0.5 : 1);
  if (rover && !wrong && rover.energy < PROSPECT_ENERGY) prospectBlockers.push(`Core samples need ${PROSPECT_ENERGY} ${noun} energy.`);

  const drillBlockers = [...placement];
  if (status === "depleted") drillBlockers.push("This deposit is worked out.");
  if (tooDeep) drillBlockers.push(`The seam is ${dep.depthM} m down and the drill only reaches ${stats.drillMaxDepthM} m. A better drill would get it.`);
  if (rover && !wrong && room <= 0.05) drillBlockers.push(`The ${noun}'s ${bedName} is full. ${go === "sail" ? "Sail" : "Drive"} back to the ship and unload.`);
  const setupEnergy = isSite ? 0 : DRILL_SETUP_ENERGY;
  if (rover && !wrong && rover.energy < setupEnergy + 0.5) drillBlockers.push(`Not enough ${noun} energy to run the ${wet ? "dredge" : "drill"}.`);

  const hoursFull = rover && !wrong
    ? Math.max(0, Math.min(remaining / rate, room / rate, (rover.energy - setupEnergy) / DRILL_ENERGY_PER_HOUR))
    : 0;
  const hours4 = Math.min(4, hoursFull);
  const setupMin = isSite ? 0 : DRILL_SETUP_MINUTES;

  const runProspect = async (): Promise<void> => {
    if (!(dist !== null && dist <= pRange) && !(await goTo())) return;
    session.act((s, w) => prospect(s, w, dep.key));
  };

  const runDrill = async (maxHours: number): Promise<void> => {
    if (!(await goTo())) return;
    const r = session.act((s, w) => drill(s, w, dep.key, maxHours));
    if (!r.ok) return;
    const { tonnes: got, hours, depleted, roverFull, incident } = r.value;
    const why = incident ? "interrupted" : depleted ? "deposit worked out" : roverFull ? `${bedName} full` : hours < maxHours - 0.01 ? `${noun} energy low` : "";
    session.notify(`${wet ? "Dredged" : "Drilled"} ${tonnes(got)} of ${commodity.name.toLowerCase()} in ${formatDuration(hours * HOUR * SHIFT_FACTOR)}${why ? ` (${why})` : ""}.`);
    if (incident) session.notify(incident, "error");
  };

  return (
    <Section id="deposit" title="Selected deposit" class="deposit-panel" revealKey={dep.key}>
      <div class="dep-title" title={commodity.blurb}>
        <i class="swatch big" style={{ background: status === "depleted" ? "#5b6472" : commodity.color }} />
        <span>{commodity.name}</span>
        <span class={`tag ${status}`}>{status === "new" ? "unsurveyed" : status}</span>
        {wet && <span class="tag sea">seabed</span>}
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
            {wet
              ? "The crew launches the boat, prospects, dredges and hauls loads home until the deposit is worked out or the hold is full."
              : "The crew deploys the rover, prospects, drills and hauls loads home until the deposit is worked out or the hold is full."}
          </p>
        )}
      </div>
      <div class="manual-label">Or do it by hand</div>

      {!prospected ? (
        <>
          <ul class="blockers">{prospectBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
          <div class="btn-row dep-actions">
            {rover && !wrong && !atSite && (
              <button class="btn" disabled={busy} onClick={drive}>
                {vehicle === "boat" ? "Sail there" : "Drive there"}
              </button>
            )}
            <button
              class="btn"
              disabled={busy || prospectBlockers.length > 0}
              onClick={() => void runProspect()}
            >
              Prospect ({formatDuration(prospectMinutes)})
            </button>
          </div>
        </>
      ) : (
        <>
          <ul class="blockers">{drillBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
          <div class="btn-row dep-actions">
            {rover && !wrong && !atSite && (
              <button class="btn" disabled={busy} onClick={drive}>
                {vehicle === "boat" ? "Sail there" : "Drive there"}
              </button>
            )}
            <button class="btn" disabled={busy || drillBlockers.length > 0} onClick={() => void runDrill(Infinity)}>
              {dredge} until full
            </button>
            <button class="btn" disabled={busy || drillBlockers.length > 0} onClick={() => void runDrill(4)}>
              {dredge} 4 h
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
