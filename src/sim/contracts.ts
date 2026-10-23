/**
 * The job board. Clans post contracts at the Intrepid: deliveries, specimen collection, survey
 * work. New captains start with a few easy ones that teach the loop and pay a cushion.
 *
 * This module deliberately avoids importing runtime code from state.ts (it's called from
 * advanceTime), so it writes journal entries and runs its RNG directly.
 */
import { COMMODITIES, type CommodityId } from "../data/commodities";
import { CLAN_NAMES, type ClanId } from "../data/ship";
import { awardXp, crewBonuses } from "./crew";
import { hasPerk } from "./perks";
import { fail, ok, type Result } from "./result";
import { Rng } from "./rng";
import { removeCargo } from "./ship";
import type { GameState } from "./state";
import { DAY } from "./units";
import { fuelPrice } from "./economy";
import { distanceLy } from "./galaxy";
import { World } from "./world";

export type ContractKind = "deliver" | "specimens" | "survey";
export type ContractStatus = "offered" | "active" | "done" | "failed";

export interface Contract {
  id: string;
  clan: ClanId;
  kind: ContractKind;
  title: string;
  text: string;
  reward: number;
  /** Days allowed once accepted. */
  durationDays: number;
  /** Absolute deadline, set when accepted. */
  deadline: number | null;
  status: ContractStatus;
  starter?: boolean;
  // deliver
  commodity?: CommodityId;
  tonnes?: number;
  // specimens
  bodyId?: string;
  count?: number;
  // survey
  surveyBodyIds?: string[];
  /** A Preferred Captain's private offer. */
  exclusive?: boolean;
  /** What was actually paid on completion (reward plus the comms officer's bonus). */
  paid?: number;
}

/** Specimens are keyed "bodyId|species". */
export function specimenKey(bodyId: string, species: string): string {
  return `${bodyId}|${species}`;
}

export function specimensFrom(specimens: Record<string, number> | undefined, bodyId: string): number {
  let n = 0;
  for (const [key, count] of Object.entries(specimens ?? {})) if (key.startsWith(`${bodyId}|`)) n += count;
  return n;
}

/** Easy first jobs, built around the home systems. */
export function starterContracts(world: World, preSurveyed: readonly string[]): Contract[] {
  const contracts: Contract[] = [
    {
      id: "starter-iron",
      clan: "exchange",
      kind: "deliver",
      title: "First haul",
      text:
        "The Exchange is short of structural metal for the hull-patching crews and pays a premium to new captains who prove they can deliver. Bring back 60 t of iron-nickel ore.",
      commodity: "ironNickel",
      tonnes: 60,
      reward: 4_500,
      durationDays: 150,
      deadline: null,
      status: "offered",
      starter: true,
    },
  ];

  const meadow = world.galaxy.systems
    .filter((s) => s.home)
    .flatMap((s) => world.system(s.id).bodies)
    .find((b) => b.nickname === "the Meadow");
  if (meadow) {
    contracts.push({
      id: "starter-meadow",
      clan: "lyceum",
      kind: "specimens",
      title: "Samples from the Meadow",
      text: `The Lyceum's botanists want fresh specimens from ${meadow.name}, the little living world the first scouts called the Meadow. Collect 4 flora samples there. The air is thin but harmless; it's a gentle first landing.`,
      bodyId: meadow.id,
      count: 4,
      reward: 5_000,
      durationDays: 180,
      deadline: null,
      status: "offered",
      starter: true,
    });
  }

  for (const sys of world.galaxy.systems.filter((s) => s.home)) {
    const targets = world
      .system(sys.id)
      .bodies.filter((b) => b.regions > 0 && !preSurveyed.includes(b.id))
      .slice(0, 2);
    if (targets.length < 2) continue;
    contracts.push({
      id: "starter-survey",
      clan: "helm",
      kind: "survey",
      title: "Finish the scouts' charts",
      text: `Helm wants the ${sys.name} charts completed. Fly detailed orbital surveys of ${targets.map((b) => b.name).join(" and ")}.`,
      surveyBodyIds: targets.map((b) => b.id),
      reward: 3_500,
      durationDays: 150,
      deadline: null,
      status: "offered",
      starter: true,
    });
    break;
  }
  return contracts;
}

/** Commodities the Intrepid regularly posts delivery contracts for, and who posts them. */
const DEMAND: readonly (readonly [CommodityId, ClanId, number])[] = [
  ["ironNickel", "exchange", 30],
  ["copper", "midshipmen", 25],
  ["titanium", "midshipmen", 20],
  ["waterIce", "helm", 15],
  ["rareEarths", "lyceum", 12],
  ["uranium", "diggers", 8],
];

const DELIVERY_FLAVOR: Record<ClanId, string> = {
  exchange: "The Exchange has buyers lined up and will pay over market for a guaranteed lot.",
  midshipmen: "The Midshipmen's yards are behind on a refit and need stock fast.",
  helm: "Helm is topping up the Intrepid's reserves and pays well for reliability.",
  lyceum: "The Lyceum needs feedstock for its instrument shops.",
  diggers: "The Diggers' refiners are idle and they'd rather pay you than wait.",
  covenant: "The Covenant needs supplies and asks few questions.",
  freebooters: "Someone wants this delivered quietly. The pay is good.",
};

export function deliveryContract(rng: Rng, now: number, serial: number): Contract {
  const [commodity, clan] = rng.weighted(DEMAND.map(([c, clanId, w]) => [[c, clanId] as const, w] as const));
  const price = COMMODITIES[commodity].basePrice;
  const tonnes = Math.max(10, Math.round(Math.min(150, rng.range(5_000, 12_000) / price) / 10) * 10);
  return {
    id: `deliver-${serial}`,
    clan,
    kind: "deliver",
    title: `${CLAN_NAMES[clan]}: ${tonnes} t of ${COMMODITIES[commodity].name.toLowerCase()}`,
    text: DELIVERY_FLAVOR[clan],
    commodity,
    tonnes,
    reward: Math.round((tonnes * price * rng.range(1.3, 1.6) + 1_000) / 50) * 50,
    durationDays: rng.int(90, 160),
    deadline: null,
    status: "offered",
  };
}

/** A private offer for a Preferred Captain: half again as large, and paid well above the board. */
export function exclusiveContract(rng: Rng, serial: number): Contract {
  const base = deliveryContract(rng, 0, serial);
  const tonnes = Math.round(((base.tonnes ?? 10) * 1.5) / 10) * 10;
  return {
    ...base,
    id: `private-${serial}`,
    title: `Private: ${base.title.replace(/\d+ t/, `${tonnes} t`)}`,
    text: `${base.text} Offered to you alone; it never reached the public board.`,
    tonnes,
    reward: Math.round((base.reward * 1.5 * 1.3) / 50) * 50,
    exclusive: true,
  };
}

const worldCache = new Map<number, World>();
function worldFor(seed: number): World {
  let w = worldCache.get(seed);
  if (!w) {
    w = new World(seed);
    worldCache.clear();
    worldCache.set(seed, w);
  }
  return w;
}

/**
 * Helm always has charting work: survey two worlds of a charted system from orbit. No landing or
 * mining needed, and it pays the fuel there and back with something over, so a captain who's
 * down on their luck always has a way to earn. One on the board at a time.
 */
export function standingSurvey(state: GameState, rng: Rng, serial: number): Contract | null {
  const world = worldFor(state.seed);
  const surveyed = new Set(state.surveyedBodies ?? []);
  const claimed = new Set((state.contracts ?? []).filter((c) => c.status === "active" || c.status === "offered").flatMap((c) => c.surveyBodyIds ?? []));
  const options = world.galaxy.systems
    .filter((s) => s.charted)
    .map((s) => ({ s, bodies: world.system(s.id).bodies.filter((b) => b.regions > 0 && !surveyed.has(b.id) && !claimed.has(b.id)) }))
    .filter((o) => o.bodies.length >= 2);
  if (options.length === 0) return null;
  const { s, bodies } = rng.pick(options);
  const targets = bodies.slice(0, 2);
  const ly = distanceLy(world.galaxy, "intrepid", s.id);
  // Round-trip fold fuel for the starter freighter (about 2 units per ly each way), with margin.
  const fuelCost = 4 * ly * fuelPrice(state.market);
  return {
    id: `survey-${serial}`,
    clan: "helm",
    kind: "survey",
    title: `Helm: finish the ${s.name} charts`,
    text: `Helm pays steady money for orbital surveys. Fly detailed surveys of ${targets.map((b) => b.name).join(" and ")}. No landing needed.`,
    surveyBodyIds: targets.map((b) => b.id),
    reward: Math.round((fuelCost * 1.5 + 2_000) / 50) * 50,
    durationDays: 90,
    deadline: null,
    status: "offered",
  };
}

/** Expire overdue contracts and post new deliveries now and then. Called as time passes. */
export function tickContracts(state: GameState): void {
  state.contracts ??= [];
  for (const c of state.contracts) {
    if (c.status === "active" && c.deadline !== null && state.time > c.deadline) {
      c.status = "failed";
      state.journal.push({ t: state.time, kind: "warning", text: `Contract lapsed: "${c.title}". ${CLAN_NAMES[c.clan]} won't forget it.` });
    }
  }
  state.nextContractAt ??= state.time + 20 * DAY;
  while (state.time >= state.nextContractAt) {
    const rng = new Rng(state.rngState);
    const offered = state.contracts.filter((c) => c.status === "offered").length;
    if (offered < 4) {
      const serial = state.contracts.length + 1;
      state.contracts.push(deliveryContract(rng, state.time, serial));
    }
    // Helm's standing survey work: one on the board at all times, so there's always a way to earn.
    const hasSurvey = state.contracts.some((c) => c.kind === "survey" && !c.starter && (c.status === "offered" || c.status === "active"));
    if (!hasSurvey) {
      const survey = standingSurvey(state, rng, state.contracts.length + 1);
      if (survey) state.contracts.push(survey);
    }
    // Preferred Captain (comms): now and then a clan offers private work, bigger and better paid.
    if (hasPerk(state, "preferred-captain") && rng.chance(0.5) && !state.contracts.some((c) => c.status === "offered" && c.exclusive)) {
      state.contracts.push(exclusiveContract(rng, state.contracts.length + 1));
    }
    state.nextContractAt += rng.range(15, 30) * DAY;
    state.rngState = rng.state;
  }
}

export interface ContractProgress {
  have: number;
  need: number;
  ready: boolean;
  label: string;
}

export function contractProgress(state: GameState, c: Contract): ContractProgress {
  switch (c.kind) {
    case "deliver": {
      const have = state.ship.cargo[c.commodity as CommodityId] ?? 0;
      const need = c.tonnes ?? 0;
      return { have, need, ready: have >= need - 0.05, label: `${Math.floor(have)} / ${need} t aboard` };
    }
    case "specimens": {
      const rover = state.location.kind === "surface" ? state.location.rover?.specimens : undefined;
      const aboard = specimensFrom(state.ship.specimens, c.bodyId ?? "");
      const have = aboard + specimensFrom(rover, c.bodyId ?? "");
      const need = c.count ?? 0;
      // Only samples in the ship's racks can be turned in.
      return { have, need, ready: aboard >= need, label: `${have} / ${need} samples collected` };
    }
    case "survey": {
      const ids = c.surveyBodyIds ?? [];
      const have = ids.filter((id) => state.surveyedBodies.includes(id)).length;
      return { have, need: ids.length, ready: have >= ids.length, label: `${have} / ${ids.length} worlds surveyed` };
    }
  }
}

function findContract(state: GameState, id: string): Contract | undefined {
  return (state.contracts ?? []).find((c) => c.id === id);
}

export function acceptContract(state: GameState, id: string): Result<Contract> {
  if (state.location.kind !== "intrepid") return fail("Contracts are signed aboard the Intrepid.");
  const c = findContract(state, id);
  if (!c || c.status !== "offered") return fail("That contract isn't on offer.");
  if ((state.contracts ?? []).filter((x) => x.status === "active").length >= 4) return fail("You can hold at most 4 active contracts.");
  c.status = "active";
  // Extensions (comms): the clans allow a quarter more time.
  c.deadline = state.time + c.durationDays * DAY * (hasPerk(state, "extensions") ? 1.25 : 1);
  state.journal.push({ t: state.time, kind: "trade", text: `Signed with ${CLAN_NAMES[c.clan]}: "${c.title}". ${c.durationDays} days to deliver.` });
  awardXp(state, "comms", 8);
  return ok(c);
}

/** What a contract pays on completion: its reward, plus the comms officer's haggling. */
export function contractPayout(state: GameState, c: Contract): number {
  return Math.round((c.reward * crewBonuses(state).contractPay) / 10) * 10;
}

export function completeContract(state: GameState, id: string): Result<number> {
  if (state.location.kind !== "intrepid") return fail("Turn contracts in aboard the Intrepid.");
  const c = findContract(state, id);
  if (!c || c.status !== "active") return fail("That contract isn't active.");
  const progress = contractProgress(state, c);
  if (!progress.ready) return fail(`Not yet: ${progress.label}.`);

  if (c.kind === "deliver") removeCargo(state.ship.cargo, c.commodity as CommodityId, c.tonnes ?? 0);
  if (c.kind === "specimens") {
    let left = c.count ?? 0;
    const specimens = state.ship.specimens ?? {};
    for (const key of Object.keys(specimens)) {
      if (left <= 0 || !key.startsWith(`${c.bodyId}|`)) continue;
      const take = Math.min(left, specimens[key] ?? 0);
      specimens[key] = (specimens[key] ?? 0) - take;
      if ((specimens[key] ?? 0) <= 0) delete specimens[key];
      left -= take;
    }
  }
  c.status = "done";
  const pay = contractPayout(state, c);
  c.paid = pay;
  state.credits += pay;
  state.stats.earned += pay;
  state.journal.push({ t: state.time, kind: "trade", text: `Contract fulfilled: "${c.title}". ${CLAN_NAMES[c.clan]} paid ${pay.toLocaleString()} cr.` });
  awardXp(state, "comms", 25);
  awardXp(state, "captain", 25);
  return ok(pay);
}
