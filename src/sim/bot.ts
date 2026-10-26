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
  landingBlockers,
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
  roverMobility,
  routeEnergy,
  scanBody,
  sellAll,
  shipTile,
  orbitalSensorTier,
  surveyBody,
  stowRover,
  recallRover,
  wait,
  callForRescue,
  departureReadyAt,
  isWaitBlocker,
  rescueQuote,
  type Result,
} from "./actions";
import type { Body } from "./bodies";
import { answerHail } from "./combat";
import type { Deposit } from "./surface";
import { landingAccess } from "./environment";
import { findPath } from "./pathfinding";
import { Rng } from "./rng";
import { OFFICER_STATIONS } from "../data/crew";
import { hireRecruit, levelForXp, officerAt, signingFee } from "./crew";
import { autoSpendCrew, effectiveStats } from "./perks";
import { cargoTonnes } from "./ship";
import { newGame, type GameState } from "./state";
import { frontierTonnage, REGION_SIZE, regionKey, regionSignal, scoutedShare } from "./surface";
import { DAY } from "./units";
import { World } from "./world";

export interface BotReport {
  state: GameState;
  tripsCompleted: number;
  /** Unexpected action failures: these indicate bugs or dead ends in the loop. */
  errors: string[];
  /** Raiders who hailed on the way home (the bot pays them). */
  raids: number;
  tripSummaries: {
    system: string;
    days: number;
    tonnes: number;
    revenue: number;
    net: number;
    /** After the trip. */
    credits: number;
    loan: number;
    crewLevel: number;
    rescues: number;
    /** Officers who have left so far, and the crew's average happiness and loyalty after the trip. */
    quits: number;
    happiness: number;
    loyalty: number;
  }[];
}

export interface BotOptions {
  /** Fly a detailed orbital survey of each world before landing. */
  survey?: boolean;
  /** Upgrades to buy, in order, whenever there's a comfortable cushion. Empty = never upgrade. */
  upgrades?: readonly string[];
  /** Keep at least this many credits after buying an upgrade. */
  reserve?: number;
  /** Play like a new captain: picks systems at random, takes the chart's default region, never surveys, calls for rescue when stranded. */
  novice?: boolean;
  /** Share of each sale paid to the crew as bonuses (0–0.2). */
  crewShare?: number;
}

export const DEFAULT_UPGRADES = ["deepDrill", "roverSled", "expandedHold", "roverCells", "surveyArray", "auxTanks", "landingStruts"];

export function runBot(seed: number, trips: number, options: BotOptions = {}): BotReport {
  const { survey = true, upgrades = DEFAULT_UPGRADES, reserve = 12_000, novice = false, crewShare = 0 } = options;
  let rescues = 0;
  let raids = 0;
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
    // Fill any empty post from the hiring hall (cheapest recruit for it).
    state.crewShare = crewShare;
    for (const station of OFFICER_STATIONS) {
      if (officerAt(state, station)) continue;
      const pick = (state.recruits ?? []).filter((r) => r.station === station).sort((a, b) => signingFee(state, a) - signingFee(state, b))[0];
      if (pick && state.credits > signingFee(state, pick)) hireRecruit(state, pick.id);
    }
    buyFuel(state, 999);
    if (state.ship.fuel < effectiveStats(state).fuelCapacity * 0.6) buyFuelOnCredit(state, 999);
    // The bot's crew spend their perk points the way recruits do.
    autoSpendCrew(state, rng);

    const target = chooseSystem(state, world, novice ? rng : null);
    if (!target) {
      errors.push(`trip ${trip}: no reachable system with landable worlds`);
      break;
    }
    if (state.time < departureReadyAt(state)) wait(state, departureReadyAt(state) - state.time);
    if (must("fold out", fold(state, world, target)) === null) break;

    const tonnesBefore = state.stats.tonnesMined;
    mineSystem(state, world, target, rng, must, survey, novice);

    // Stranded (it happens to new captains): call the Exchange for a tender.
    if (rescueQuote(state, world) && callForRescue(state, world).ok) rescues++;
    if (must("fly to edge", flyTo(state, world, { edge: true })) === null) break;
    if (state.time < state.foldReadyAt) wait(state, state.foldReadyAt - state.time);
    // Combat v1: a raider may hail as the drive spools up. The bot pays and goes (the honest
    // freighter's choice), so the career report measures what piracy costs.
    let home = fold(state, world, "intrepid");
    if (!home.ok && state.encounter) {
      raids++;
      answerHail(state, "pay");
      home = fold(state, world, "intrepid");
    }
    if (must("fold home", home) === null) break;

    const sold = sellAll(state);
    tripsCompleted++;
    tripSummaries.push({
      system: world.system(target).system.name,
      days: Math.round((state.time - start) / DAY),
      tonnes: Math.round(state.stats.tonnesMined - tonnesBefore),
      revenue: sold.ok ? sold.value : 0,
      // Fuel bought before departure is a trip cost; fuel left in the tanks carries over.
      net: state.credits - creditsBefore + ((state.stats.loanPaid ?? 0) - loanPaidBefore),
      credits: state.credits,
      loan: state.loan.balance,
      crewLevel: (state.crew ?? []).reduce((s, m) => s + levelForXp(m.xp), 0) / Math.max(1, (state.crew ?? []).length),
      rescues,
      quits: state.journal.filter((j) => j.text.includes("left the ship")).length,
      happiness: avgOf(state.crew ?? [], (m) => m.happiness ?? 0),
      loyalty: avgOf(state.crew ?? [], (m) => m.loyalty ?? 0),
    });
  }

  return { state, tripsCompleted, errors, tripSummaries, raids };
}

function avgOf<T>(xs: readonly T[], f: (x: T) => number): number {
  return xs.length ? xs.reduce((s, x) => s + f(x), 0) / xs.length : 0;
}

function visitsTo(state: GameState, systemId: string): number {
  return Object.entries(state.regions)
    .filter(([key]) => key.startsWith(`${systemId}.`))
    .reduce((sum, [, k]) => sum + k.visits, 0);
}

function landable(state: GameState, body: Body): boolean {
  return landingAccess(body, effectiveStats(state).ratings).ok && Object.keys(body.resources).length > 0 && body.regions > 0;
}

function bodyScore(body: Body): number {
  return (Object.entries(body.resources) as [CommodityId, number][]).reduce(
    (sum, [id, a]) => sum + a * Math.sqrt(COMMODITIES[id].basePrice),
    0,
  );
}

/** Best system we can reach and still fold home from. */
function chooseSystem(state: GameState, world: World, randomly: Rng | null = null): string | null {
  let best: string | null = null;
  let bestScore = 0;
  const options: string[] = [];
  for (const sys of world.galaxy.systems) {
    const out = foldPlan(state, world, sys.id);
    const blockers = out.blockers.filter((b) => !isWaitBlocker(b));
    if (blockers.length > 0) continue;
    if (out.fuel * 2 + 4 > state.ship.fuel) continue; // round trip plus margin
    const bodies = world.system(sys.id).bodies.filter((b) => landable(state, b));
    if (bodies.length === 0) continue;
    const priorVisits = visitsTo(state, sys.id);
    // Like a player reading the star map's estimates: picked-over home stars are worth less, the frontier more.
    const first = bodies[0] as Body;
    const seams = frontierTonnage(state.seed, first) * (1 - scoutedShare(state.seed, first));
    const score = (bodies.reduce((s, b) => s + bodyScore(b), 0) * seams) / (1 + out.ly * 0.1) / (1 + priorVisits * 0.6);
    options.push(sys.id);
    if (score > bestScore) {
      bestScore = score;
      best = sys.id;
    }
  }
  if (randomly && options.length > 0) return randomly.pick(options);
  return best;
}

function mineSystem(
  state: GameState,
  world: World,
  systemId: string,
  rng: Rng,
  must: <T>(label: string, r: Result<T>) => T | null,
  survey: boolean,
  novice = false,
): void {
  const detail = world.system(systemId);
  const stats = () => effectiveStats(state);
  const holdFull = () => cargoTonnes(state.ship.cargo) >= stats().cargoCapacityT * 0.85;
  const arrived = state.time;
  const bodyVisits = (b: Body) =>
    Object.entries(state.regions).filter(([key]) => key.startsWith(`${b.id}#`)).reduce((s, [, k]) => s + k.visits, 0);
  const targets = detail.bodies
    .filter((b) => landable(state, b))
    .sort((a, b) => bodyScore(b) / (1 + bodyVisits(b) / b.regions) - bodyScore(a) / (1 + bodyVisits(a) / a.regions))
    .slice(0, 3);

  for (const body of targets) {
    if (holdFull() || state.time - arrived > 120 * DAY) return;
    if (must(`fly to ${body.name}`, flyTo(state, world, { bodyId: body.id })) === null) return;
    must(`scan ${body.name}`, scanBody(state, world));
    if (survey && !novice && !state.surveyedBodies.includes(body.id)) must(`survey ${body.name}`, surveyBody(state, world));

    const regionCount = Math.min(body.regions, 12);
    // Fresh ground first: a region we've already worked is worth a fraction of its signal.
    const regionValue = (r: number) =>
      regionSignal(state.seed, body, r, orbitalSensorTier(state, body.id), stats().drillMaxDepthM) /
      (1 + 3 * (state.regions[regionKey(body.id, r)]?.visits ?? 0));
    // Ocean worlds (AW-17): only regions with an island to set down on.
    const dry = (r: number) => !landingBlockers(state, world, r).some((b) => b.startsWith("No dry land"));
    const regions = Array.from({ length: regionCount }, (_, i) => i)
      .filter(dry)
      .sort((a, b) => regionValue(b) - regionValue(a));
    // A new captain takes the region the chart pre-selects (strongest signal at their sensor tier), so no shuffle.
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
  const stats = effectiveStats(state);
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
      .map((d) => ({ d, path: findPath(surface, rover, d, roverMobility(state)) }))
      .filter((c) => c.path !== null)
      .map((c) => ({ ...c, score: valuePerHour(c.d, c.path!.length) }))
      // Not worth the crew's wages (about 12 cr/h for six on shift, after AW-142) unless the bed is nearly full anyway.
      .filter((c) => c.score >= 30 || cargoTonnes(rover.cargo) > stats.roverCargoT * 0.7)
      .sort((a, b) => b.score - a.score);

    const homeCost = (from: { x: number; y: number }) =>
      routeEnergy(state, findPath(surface, from, shipTile(state, world), roverMobility(state)));

    const next = candidates[0];
    if (next) {
      const go = routeEnergy(state, next.path);
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
    const path = findPath(surface, rover, { x: tx, y: ty }, roverMobility(state));
    if (!path) continue;
    const go = routeEnergy(state, path);
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
