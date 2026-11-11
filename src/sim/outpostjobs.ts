/**
 * Work for the outposts (AW-23). Two kinds:
 * - Passenger runs, posted at the Intrepid: take a party out to a clan's outpost. Passengers ride in the
 *   hold, about a tonne apiece with their kit, and the job is offered only if your ship can land there.
 * - Each outpost's own board: one or two harder, better-paid jobs, signed and handed in at the outpost.
 *   Supply runs, surveys of the stars nearby, specimens for a research station, and pirate hunts from a
 *   Helm patrol station.
 */
import { COMMODITIES, type CommodityId } from "../data/commodities";
import { CLAN_NAMES, type ClanId } from "../data/ship";
import { type Contract, HAULAGE_PER_T, worldFor } from "./contracts";
import { fail, ok, type Result } from "./result";
import { landingAccess } from "./environment";
import { distanceLy } from "./galaxy";
import { knownOutposts, outpostById, type Outpost } from "./outposts";
import { currentOutpost } from "./outpostservices";
import { effectiveStats } from "./perks";
import { clanRefuses, tierOf } from "./reputation";
import type { Rng } from "./rng";
import { rngFor } from "./rng";
import { specimenJob } from "./specimenjobs";
import type { GameState } from "./state";
import { DAY } from "./units";
import type { World } from "./world";

/** Hold space a passenger and their kit take, in tonnes. */
export const PASSENGER_T = 1;
/** An outpost posts new work this often, at most, and keeps this much on its board. */
const BOARD_REFRESH_DAYS = 60;
/** Outpost work pays this much over the Intrepid's for the same goods: bigger loads, shorter deadlines, farther out. */
export const OUTPOST_PAY = 1.4;
const BOARD_SIZE = 2;

/** Passengers aboard now: they board when the run is signed, and take hold space until they're set down. */
export function passengersAboard(state: Pick<GameState, "contracts">): number {
  return (state.contracts ?? []).reduce((n, c) => n + (c.kind === "passengers" && c.status === "active" ? (c.passengers ?? 0) : 0), 0);
}

/** Can the ship as fitted set down at this outpost? (Jobs there aren't offered otherwise.) */
function reachable(state: GameState, world: World, o: Outpost): boolean {
  if (!landingAccess(world.body(o.bodyId).body, effectiveStats(state).ratings).ok) return false;
  // A den you couldn't count on landing at isn't a fair destination.
  if (o.clan === "freebooters") {
    const tier = tierOf(state, "freebooters");
    return tier === "friendly" || tier === "trusted";
  }
  return true;
}

function where(world: World, o: Outpost): string {
  const { body, detail } = world.body(o.bodyId);
  return `${o.name}, the ${CLAN_NAMES[o.clan]} ${o.kind} on ${body.name} in ${detail.system.name}`;
}

/** A party for an outpost, posted at the Intrepid; null if no outpost is in reach. */
export function passengerJob(state: GameState, world: World, rng: Rng, serial: number): Contract | null {
  const options = knownOutposts(state, world).filter((o) => reachable(state, world, o) && !clanRefuses(state, o.clan));
  if (options.length === 0) return null;
  const o = rng.pick(options);
  const hold = effectiveStats(state).cargoCapacityT;
  const most = Math.max(6, Math.min(40, Math.floor((hold * 0.3) / PASSENGER_T)));
  const count = rng.int(Math.min(6, most), most);
  const ly = distanceLy(world.galaxy, "intrepid", o.systemId);
  return {
    id: `passengers-${serial}`,
    clan: o.clan,
    kind: "passengers",
    title: `${CLAN_NAMES[o.clan]}: ${count} passengers to ${o.name}`,
    text: `${count} passengers bound for ${where(world, o)}. They and their kit take ${PASSENGER_T} t of hold apiece, and board when you sign.`,
    passengers: count,
    turnInAt: o.id,
    bodyId: o.bodyId,
    reward: Math.round((count * 140 + 350 * ly + 1_500) / 50) * 50,
    durationDays: rng.int(150, 240),
    deadline: null,
    status: "offered",
  };
}

/** What each clan's outpost wants delivered. */
const SUPPLIES: Record<ClanId, CommodityId[]> = {
  lyceum: ["rareEarths", "waterIce"],
  freebooters: ["platinum", "uranium"],
  diggers: ["copper", "titanium"],
  exchange: ["platinum", "rareEarths"],
  covenant: ["copper", "rareEarths"],
  midshipmen: ["titanium", "ironNickel"],
  helm: ["waterIce", "ironNickel"],
};

const SUPPLY_FLAVOR: Record<ClanId, string> = {
  lyceum: "The station's labs are running short and the Intrepid is a long way off.",
  freebooters: "The den pays well and asks nothing about where it came from.",
  diggers: "The refinery needs feedstock to keep its smelters hot.",
  exchange: "The trading post has a buyer waiting and will pay over the odds.",
  covenant: "The array needs material for new antennas. They won't say what for.",
  midshipmen: "The drydock has a hull on the slip and nothing to finish her with.",
  helm: "The patrol station is restocking, and the next convoy is months away.",
};

function supplyJob(world: World, o: Outpost, rng: Rng, serial: number): Contract {
  const commodity = rng.pick(SUPPLIES[o.clan]);
  const price = COMMODITIES[commodity].basePrice;
  const tonnes = Math.max(10, Math.round(Math.min(200, rng.range(9_000, 18_000) / price) / 10) * 10);
  return {
    id: `outpost-${serial}`,
    clan: o.clan,
    kind: "deliver",
    title: `${o.name}: ${tonnes} t of ${COMMODITIES[commodity].name.toLowerCase()}`,
    text: `${SUPPLY_FLAVOR[o.clan]} Deliver to ${where(world, o)}.`,
    commodity,
    tonnes,
    reward: Math.round(((tonnes * (price * rng.range(1.3, 1.6) + HAULAGE_PER_T) + 1_000) * OUTPOST_PAY) / 50) * 50,
    durationDays: rng.int(100, 180),
    deadline: null,
    status: "offered",
    postedAt: o.id,
    turnInAt: o.id,
    bodyId: o.bodyId,
  };
}

/** Surveys of worlds in the outpost's own system and its neighbors. */
function surveyJob(state: GameState, world: World, o: Outpost, rng: Rng, serial: number): Contract | null {
  const surveyed = new Set(state.surveyedBodies ?? []);
  const claimed = new Set((state.contracts ?? []).filter((c) => c.status === "active" || c.status === "offered").flatMap((c) => c.surveyBodyIds ?? []));
  const near = world.galaxy.systems
    .map((s) => ({ s, ly: distanceLy(world.galaxy, o.systemId, s.id) }))
    .filter((x) => x.ly <= 6)
    .sort((a, b) => a.ly - b.ly);
  for (const { s } of near) {
    const bodies = world.system(s.id).bodies.filter((b) => b.regions > 0 && !surveyed.has(b.id) && !claimed.has(b.id));
    if (bodies.length < 3) continue;
    const targets = bodies.slice(0, 3);
    return {
      id: `outpost-${serial}`,
      clan: o.clan,
      kind: "survey",
      title: `${o.name}: chart ${s.name}`,
      text: `${o.name} wants detailed orbital surveys of ${targets.map((b) => b.name).join(", ")}. Bring the charts back to ${where(world, o)}.`,
      surveyBodyIds: targets.map((b) => b.id),
      reward: Math.round((4_500 + rng.range(0, 1_500)) / 50) * 50,
      durationDays: rng.int(120, 200),
      deadline: null,
      status: "offered",
      postedAt: o.id,
      turnInAt: o.id,
    };
  }
  return null;
}

/** A Helm patrol station's bounty: beat raiders, wherever you meet them. */
function huntJob(world: World, o: Outpost, rng: Rng, serial: number): Contract {
  const count = rng.int(1, 2);
  return {
    id: `outpost-${serial}`,
    clan: o.clan,
    kind: "hunt",
    title: `${o.name}: take ${count === 1 ? "a raider" : `${count} raiders`}`,
    text: `The patrol is stretched thin. Beat ${count === 1 ? "a raider ship" : `${count} raider ships`} in a fight, anywhere, then report to ${where(world, o)}.`,
    count,
    reward: Math.round((6_000 * count + 2_000 + rng.range(0, 1_000)) / 50) * 50,
    durationDays: rng.int(150, 240),
    deadline: null,
    status: "offered",
    postedAt: o.id,
    turnInAt: o.id,
  };
}

/** One job for this outpost's board, in its clan's line of work. */
function outpostJob(state: GameState, world: World, o: Outpost, rng: Rng, serial: number): Contract | null {
  const roll = rng.next();
  if (o.clan === "helm" && roll < 0.6) return huntJob(world, o, rng, serial);
  if (o.clan === "midshipmen" && roll < 0.3) return huntJob(world, o, rng, serial);
  if (o.clan === "lyceum" && roll < 0.6) {
    const job = specimenJob(state, world, rng, serial);
    if (job) {
      const count = Math.max(1, Math.round((job.count ?? 1) * 1.5));
      return {
        ...job,
        id: `outpost-${serial}`,
        title: job.title.replace(/^Lyceum: \d+/, `${o.name}: ${count}`),
        text: `${job.text} Bring them to ${where(world, o)}.`,
        count,
        reward: Math.round((job.reward * OUTPOST_PAY) / 50) * 50,
        durationDays: rng.int(150, 240),
        postedAt: o.id,
        turnInAt: o.id,
      };
    }
  }
  if ((o.clan === "covenant" || o.clan === "helm") && roll < 0.8) {
    const job = surveyJob(state, world, o, rng, serial);
    if (job) return job;
  }
  return supplyJob(world, o, rng, serial);
}

/** Fill this outpost's board when the ship lands, at most every couple of months. */
export function refreshOutpostBoard(state: GameState, world: World, o: Outpost): void {
  state.outpostBoardAt ??= {};
  if ((state.outpostBoardAt[o.id] ?? -Infinity) > state.time) return;
  state.outpostBoardAt[o.id] = state.time + BOARD_REFRESH_DAYS * DAY;
  state.contracts ??= [];
  // Last visit's offers go stale.
  state.contracts = state.contracts.filter((c) => !(c.postedAt === o.id && c.status === "offered"));
  if (clanRefuses(state, o.clan)) return;
  const rng = rngFor(state.seed, "outpost-board", o.id, Math.floor(state.time / DAY));
  for (let i = 0; i < BOARD_SIZE; i++) {
    const job = outpostJob(state, world, o, rng, state.contracts.length + 1);
    if (job) state.contracts.push(job);
  }
}

/** Where a job is signed: an outpost's own board, or the Intrepid's. */
export function contractSignedHere(state: GameState, c: Contract): Result<void> {
  if (!c.postedAt) return state.location.kind === "intrepid" ? ok(undefined) : fail("Contracts are signed aboard the Intrepid.");
  const o = currentOutpost(state);
  if (o?.id === c.postedAt) return ok(undefined);
  const at = outpostById(worldOf(state), c.postedAt);
  return fail(`Signed at ${at?.name ?? "its outpost"}.`);
}

/** Where a job is handed in: its outpost, or the Intrepid. */
export function contractTurnInHere(state: GameState, c: Contract): Result<void> {
  if (!c.turnInAt) return state.location.kind === "intrepid" ? ok(undefined) : fail("Turn contracts in aboard the Intrepid.");
  const o = currentOutpost(state);
  if (o?.id === c.turnInAt) return ok(undefined);
  const at = outpostById(worldOf(state), c.turnInAt);
  return fail(`Hand it in at ${at?.name ?? "its outpost"}.`);
}

/** The outpost a job is handed in at, if not the Intrepid (for the job card). */
export function turnInOutpost(state: GameState, c: Contract): Outpost | undefined {
  return c.turnInAt ? outpostById(worldOf(state), c.turnInAt) : undefined;
}

function worldOf(state: GameState): World {
  return worldFor(state.seed, state.worldGen ?? 1);
}

