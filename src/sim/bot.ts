/**
 * A headless captain that plays the core loop: fold out, prospect, drill, haul, fold home,
 * sell, upgrade. Used by tests to prove the loop works end to end, and by balance sims to
 * measure how fast money and time flow.
 */
import { COMMODITIES, type CommodityId } from "../data/commodities";
import { UPGRADES_BY_ID } from "../data/ship";
import {
  buyFuel,
  buyFuelOnCredit,
  buyUpgrade,
  deployRover,
  drill,
  drillRate,
  flyTo,
  fold,
  foldPlan,
  knowledge,
  land,
  launch,
  moveRoverTo,
  prospect,
  remainingTonnes,
  scanBody,
  sellAll,
  shipTile,
  sensorTierFor,
  surveyBody,
  stowRover,
  recallRover,
  wait,
  type Result,
} from "./actions";
import type { Body } from "./bodies";
import type { Deposit } from "./surface";
import { landingAccess } from "./environment";
import { findPath } from "./pathfinding";
import { Rng } from "./rng";
import { cargoTonnes, shipStats } from "./ship";
import { newGame, type GameState } from "./state";
import { REGION_SIZE, regionKey, regionSignal } from "./surface";
import { DAY } from "./units";
import { World } from "./world";

export interface BotReport {
  state: GameState;
  tripsCompleted: number;
  /** Unexpected action failures: these indicate bugs or dead ends in the loop. */
  errors: string[];
  tripSummaries: { system: string; days: number; tonnes: number; revenue: number; net: number }[];
}

export interface BotOptions {
  /** Fly a detailed orbital survey of each world before landing. */
  survey?: boolean;
  /** Upgrades to buy, in order, whenever there's a comfortable cushion. Empty = never upgrade. */
  upgrades?: readonly string[];
  /** Keep at least this many credits after buying an upgrade. */
  reserve?: number;
}

export const DEFAULT_UPGRADES = ["deepDrill", "roverSled", "expandedHold", "roverCells", "surveyArray", "auxTanks", "landingStruts"];

export function runBot(seed: number, trips: number, options: BotOptions = {}): BotReport {
  const { survey = true, upgrades = DEFAULT_UPGRADES, reserve = 12_000 } = options;
  const world = new World(seed);
  const state = newGame({ seed });
  const rng = new Rng(seed ^ 0xb07);
  const errors: string[] = [];
  const tripSummaries: BotReport["tripSummaries"] = [];

  const must = <T>(label: string, r: Result<T>): T | null => {
    if (!r.ok) {
      errors.push(`${label}: ${r.reason}`);
      return null;
    }
    return r.value;
  };

  let tripsCompleted = 0;
  for (let trip = 0; trip < trips && errors.length < 20; trip++) {
    // Refit at the Intrepid. Upgrades are investments, so they're outside the trip's profit.
    for (const id of upgrades) {
      const upgrade = UPGRADES_BY_ID.get(id);
      if (upgrade && !state.ship.upgrades.includes(id) && state.credits - upgrade.price > reserve) buyUpgrade(state, id);
    }
    const start = state.time;
    const creditsBefore = state.credits;
    const loanPaidBefore = state.stats.loanPaid ?? 0;
    buyFuel(state, 999);
    if (state.ship.fuel < shipStats(state.ship).fuelCapacity * 0.6) buyFuelOnCredit(state, 999);

    const target = chooseSystem(state, world);
    if (!target) {
      errors.push(`trip ${trip}: no reachable system with landable worlds`);
      break;
    }
    if (state.time < state.foldReadyAt) wait(state, state.foldReadyAt - state.time);
    if (must("fold out", fold(state, world, target)) === null) break;

    const tonnesBefore = state.stats.tonnesMined;
    mineSystem(state, world, target, rng, must, survey);

    if (must("fly to edge", flyTo(state, world, { edge: true })) === null) break;
    if (state.time < state.foldReadyAt) wait(state, state.foldReadyAt - state.time);
    if (must("fold home", fold(state, world, "intrepid")) === null) break;

    const sold = sellAll(state);
    tripsCompleted++;
    tripSummaries.push({
      system: world.system(target).system.name,
      days: Math.round((state.time - start) / DAY),
      tonnes: Math.round(state.stats.tonnesMined - tonnesBefore),
      revenue: sold.ok ? sold.value : 0,
      // Fuel bought before departure is a trip cost; fuel left in the tanks carries over.
      net: state.credits - creditsBefore + ((state.stats.loanPaid ?? 0) - loanPaidBefore),
    });
  }

  return { state, tripsCompleted, errors, tripSummaries };
}

function visitsTo(state: GameState, systemId: string): number {
  return Object.entries(state.regions)
    .filter(([key]) => key.startsWith(`${systemId}.`))
    .reduce((sum, [, k]) => sum + k.visits, 0);
}

function landable(state: GameState, body: Body): boolean {
  return landingAccess(body, shipStats(state.ship).ratings).ok && Object.keys(body.resources).length > 0 && body.regions > 0;
}

function bodyScore(body: Body): number {
  return (Object.entries(body.resources) as [CommodityId, number][]).reduce(
    (sum, [id, a]) => sum + a * Math.sqrt(COMMODITIES[id].basePrice),
    0,
  );
}

/** Best system we can reach and still fold home from. */
function chooseSystem(state: GameState, world: World): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const sys of world.galaxy.systems) {
    const out = foldPlan(state, world, sys.id);
    const blockers = out.blockers.filter((b) => !b.startsWith("Fold drive recharging"));
    if (blockers.length > 0) continue;
    if (out.fuel * 2 + 4 > state.ship.fuel) continue; // round trip plus margin
    const bodies = world.system(sys.id).bodies.filter((b) => landable(state, b));
    if (bodies.length === 0) continue;
    const priorVisits = visitsTo(state, sys.id);
    const score = bodies.reduce((s, b) => s + bodyScore(b), 0) / (1 + out.ly * 0.1) / (1 + priorVisits * 0.6);
    if (score > bestScore) {
      bestScore = score;
      best = sys.id;
    }
  }
  return best;
}

function mineSystem(
  state: GameState,
  world: World,
  systemId: string,
  rng: Rng,
  must: <T>(label: string, r: Result<T>) => T | null,
  survey: boolean,
): void {
  const detail = world.system(systemId);
  const stats = () => shipStats(state.ship);
  const holdFull = () => cargoTonnes(state.ship.cargo) >= stats().cargoCapacityT * 0.85;
  const arrived = state.time;
  const bodyVisits = (b: Body) =>
    Object.entries(state.regions).filter(([key]) => key.startsWith(`${b.id}#`)).reduce((s, [, k]) => s + k.visits, 0);
  const targets = detail.bodies
    .filter((b) => landable(state, b))
    .sort((a, b) => bodyScore(b) / (1 + bodyVisits(b) / b.regions) - bodyScore(a) / (1 + bodyVisits(a) / a.regions))
    .slice(0, 3);

  for (const body of targets) {
    if (holdFull() || state.time - arrived > 60 * DAY) return;
    if (must(`fly to ${body.name}`, flyTo(state, world, { bodyId: body.id })) === null) return;
    must(`scan ${body.name}`, scanBody(state, world));
    if (survey && !state.surveyedBodies.includes(body.id)) must(`survey ${body.name}`, surveyBody(state, world));

    const regionCount = Math.min(body.regions, 12);
    // Fresh ground first: a region we've already worked is worth a fraction of its signal.
    const regionValue = (r: number) =>
      regionSignal(state.seed, body, r, sensorTierFor(state, body.id), stats().drillMaxDepthM) /
      (1 + 3 * (state.regions[regionKey(body.id, r)]?.visits ?? 0));
    const regions = Array.from({ length: regionCount }, (_, i) => i).sort((a, b) => regionValue(b) - regionValue(a));
    for (const region of regions.slice(0, 2)) {
      if (holdFull()) break;
      if (must(`land on ${body.name}`, land(state, world, region)) === null) break;
      workRegion(state, world, body, region, rng, must);
      if (must(`launch from ${body.name}`, launch(state, world)) === null) return;
    }
  }
}

function workRegion(
  state: GameState,
  world: World,
  body: Body,
  region: number,
  rng: Rng,
  must: <T>(label: string, r: Result<T>) => T | null,
): void {
  const surface = world.surface(body.id);
  const origin = surface.origin(region);
  const know = knowledge(state, body.id, region);
  const stats = shipStats(state.ship);
  const holdRoom = () => stats.cargoCapacityT - cargoTonnes(state.ship.cargo);
  let explores = 0;

  must("deploy rover", deployRover(state, world));
  for (let guard = 0; guard < 60; guard++) {
    const loc = state.location;
    if (loc.kind !== "surface" || !loc.rover) return;
    const rover = loc.rover;
    if (holdRoom() - cargoTonnes(rover.cargo) <= 1) break;

    // Rank by credits per hour of work: drilling time at this grade plus the drive there.
    const valuePerHour = (d: Deposit, steps: number) => {
      const rate = drillRate(state, d);
      const tonnes = Math.min(remainingTonnes(know, d), stats.roverCargoT);
      return (COMMODITIES[d.commodity].basePrice * tonnes) / (tonnes / rate + steps * 0.3 + 4);
    };
    const candidates = surface
      .deposits(region)
      .filter((d) => know.discovered.includes(d.id) && remainingTonnes(know, d) > 0.5 && d.depthM <= stats.drillMaxDepthM)
      .map((d) => ({ d, path: findPath(surface, rover, d, stats.roverCanClimb) }))
      .filter((c) => c.path !== null)
      .map((c) => ({ ...c, score: valuePerHour(c.d, c.path!.length) }))
      // Not worth the crew's wages (25 cr/h for six on shift) unless the bed is nearly full anyway.
      .filter((c) => c.score >= 60 || cargoTonnes(rover.cargo) > stats.roverCargoT * 0.7)
      .sort((a, b) => b.score - a.score);

    const homeCost = (from: { x: number; y: number }) =>
      (findPath(surface, from, shipTile(state, world), stats.roverCanClimb) ?? []).reduce((s, p) => s + p.energy, 0);

    const next = candidates[0];
    if (next) {
      const go = next.path!.reduce((s, p) => s + p.energy, 0);
      if (rover.energy - go - homeCost(next.d) < 20 || cargoTonnes(rover.cargo) >= stats.roverCargoT - 0.5) {
        if (!returnAndUnload(state, world, must)) return;
        must("redeploy rover", deployRover(state, world));
        continue;
      }
      must("drive to deposit", moveRoverTo(state, world, next.d.x, next.d.y));
      must("prospect", prospect(state, world, next.d.key));
      const budget = (rover.energy - homeCost(rover) - 15) / 1.5;
      if (budget > 0.5) must("drill", drill(state, world, next.d.key, budget));
      continue;
    }

    if (explores >= 8) break;
    explores++;
    // Explore within the landing region (its deposits are the ones the bot ranks).
    const tx = origin.x + clampTo(rover.x - origin.x + rng.int(-12, 12), REGION_SIZE);
    const ty = origin.y + clampTo(rover.y - origin.y + rng.int(-12, 12), REGION_SIZE);
    const path = findPath(surface, rover, { x: tx, y: ty }, stats.roverCanClimb);
    if (!path) continue;
    const go = path.reduce((s, p) => s + p.energy, 0);
    if (rover.energy - go - homeCost({ x: tx, y: ty }) < 15) {
      if (!returnAndUnload(state, world, must)) return;
      must("redeploy rover", deployRover(state, world));
      continue;
    }
    must("explore", moveRoverTo(state, world, tx, ty));
  }
  returnAndUnload(state, world, must);
}

function returnAndUnload(state: GameState, world: World, must: <T>(label: string, r: Result<T>) => T | null): boolean {
  const loc = state.location;
  if (loc.kind !== "surface" || !loc.rover) return true;
  const home = shipTile(state, world);
  const moved = must("return to ship", moveRoverTo(state, world, home.x, home.y));
  if (!moved || moved.stopped) must("recall rover", recallRover(state, world));
  return must("stow rover", stowRover(state, world)) !== null;
}

function clampTo(v: number, size: number): number {
  return Math.max(1, Math.min(size - 2, v));
}
