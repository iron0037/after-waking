/**
 * Atmospheric probe dives on gas and ice giants (AW-16). The science officer flies the probe down
 * to a chosen depth band, making a call at each decision point; the link fails at depth and a
 * mechanical ballast timer brings it back up, if it survives. A probe that returns is reused; a lost
 * one has to be replaced at the Shipyard.
 */
import { COMMODITIES, GAS_IDS, type GasId } from "../data/commodities";
import { DEPTHS, PROBE_EVENTS, PROBE_PRICE, type DepthBand, type ProbeDepth, type ProbeEvent } from "../data/probes";
import type { Body } from "./bodies";
import { awardXp, workingLevel } from "./crew";
import { sellPrice } from "./economy";
import { effectiveStats } from "./perks";
import { fail, ok, type Result } from "./result";
import { rngFor } from "./rng";
import { cheerStation } from "./sentiment";
import { addCargo } from "./ship";
import { advanceTime, log, withRng, type GameState } from "./state";
import { HOUR } from "./units";
import type { World } from "./world";

/** A dive in progress (saved, so it survives a reload mid-descent). */
export interface ProbeDive {
  bodyId: string;
  depth: ProbeDepth;
  /** Decision points on the way down, in order (event ids). */
  events: string[];
  /** Index of the next decision. */
  step: number;
  risk: number;
  yieldMult: number;
  hours: number;
  /** What the pilot chose at each point (labels), for the debrief. */
  choices: string[];
}

export type ProbeOutcome = "recovered" | "damaged" | "lost";

export interface DiveResult {
  outcome: ProbeOutcome;
  /** Tonnes recovered, by gas. */
  gases: Partial<Record<GasId, number>>;
  hours: number;
}

export function isGiant(body: Body): boolean {
  return body.kind === "gasGiant" || body.kind === "iceGiant";
}

/** How rich a giant's atmosphere is (0.6–1.4), stable per body. */
export function atmosphereRichness(seed: number, body: Body): number {
  return Math.round(rngFor(seed, body.id, "atmosphere").range(0.6, 1.4) * 100) / 100;
}

export function depthBand(depth: ProbeDepth): DepthBand {
  return DEPTHS[depth - 1] as DepthBand;
}

/** The pilot's effect: each science level above 1 trims risk (to 40% at best) and adds a little yield. */
function pilotSkill(state: GameState): { riskMult: number; yieldMult: number } {
  const level = workingLevel(state, "science");
  return { riskMult: Math.max(0.4, 1 - 0.06 * (level - 1)), yieldMult: 1 + 0.03 * Math.max(0, level - 1) };
}

const clampRisk = (r: number) => Math.max(0.01, Math.min(0.9, r));

export interface DiveOdds {
  depth: ProbeDepth;
  risk: number;
  tonnes: number;
  hours: number;
  /** Rough market value of a full haul at today's prices. */
  value: number;
  /** Why this depth can't be dived now, if it can't. */
  blocked: string | null;
}

/** What each depth band looks like from orbit, for the dive planner. */
export function diveOdds(state: GameState, world: World, body: Body): DiveOdds[] {
  const pilot = pilotSkill(state);
  const rich = atmosphereRichness(state.seed, body);
  const maxDepth = effectiveStats(state).probeMaxDepth;
  const kind = body.kind === "iceGiant" ? "iceGiant" : "gasGiant";
  return DEPTHS.map((band) => {
    const tonnes = band.tonnes * rich * pilot.yieldMult;
    const mix = band.mix[kind];
    const total = Object.values(mix).reduce((a, b) => a + (b ?? 0), 0);
    const perT = (Object.entries(mix) as [GasId, number][]).reduce((s, [g, w]) => s + (w / total) * sellPrice(state.market, g), 0);
    return {
      depth: band.depth,
      risk: clampRisk(band.risk * pilot.riskMult),
      tonnes,
      hours: band.hours,
      value: Math.round(tonnes * perT),
      blocked: band.depth > maxDepth ? (maxDepth === 0 ? "No probe bay." : "The probes aren't rated this deep.") : null,
    };
  });

}

/** Why a probe can't be launched right now (empty if it can). */
export function probeBlockers(state: GameState, world: World): string[] {
  const out: string[] = [];
  const stats = effectiveStats(state);
  if (stats.probeCapacity === 0) return ["Needs an atmospheric probe bay (Shipyard)."];
  const loc = state.location;
  const body = loc.kind === "space" && loc.orbiting ? world.body(loc.orbiting).body : null;
  if (!body || !isGiant(body)) out.push("Probes dive into gas and ice giants: enter orbit around one first.");
  else if (!state.scannedBodies.includes(body.id)) out.push("Scan the giant first, so the pilot knows what's down there.");
  if (state.probeDive) out.push("A probe is already on its way down.");
  if ((state.ship.probes ?? 0) <= 0) out.push("No probes in the bay. Buy more at the Shipyard.");
  if (workingLevel(state, "science") <= 0) out.push("No science officer to fly it.");
  return out;
}

/** Launch a probe toward a depth band. The pilot then decides at each point on the way down. */
export function launchProbe(state: GameState, world: World, depth: ProbeDepth): Result<ProbeDive> {
  const blocked = probeBlockers(state, world);
  if (blocked.length > 0) return fail(blocked[0] as string);
  if (depth > effectiveStats(state).probeMaxDepth) return fail("The probes aren't rated this deep.");
  const loc = state.location as Extract<GameState["location"], { kind: "space" }>;
  const body = world.body(loc.orbiting as string).body;
  const band = depthBand(depth);
  const pilot = pilotSkill(state);
  const events = withRng(state, (rng) => {
    const pool = [...PROBE_EVENTS];
    const picked: ProbeEvent[] = [];
    while (picked.length < band.events && pool.length > 0) picked.push(pool.splice(rng.int(0, pool.length - 1), 1)[0] as ProbeEvent);
    return picked.map((e) => e.id);
  });
  state.ship.probes = (state.ship.probes ?? 0) - 1;
  state.probeDive = {
    bodyId: body.id,
    depth,
    events,
    step: 0,
    risk: band.risk * pilot.riskMult,
    yieldMult: atmosphereRichness(state.seed, body) * pilot.yieldMult,
    hours: band.hours,
    choices: [],
  };
  log(state, "discovery", `Launched a probe into ${body.name}, bound for the ${band.name.toLowerCase()} (${band.km.toLocaleString()} km down).`);
  return ok(state.probeDive);
}

/** The decision point the pilot faces now, or null when the descent is past them. */
export function currentProbeEvent(state: GameState): ProbeEvent | null {
  const dive = state.probeDive;
  if (!dive) return null;
  const id = dive.events[dive.step];
  return PROBE_EVENTS.find((e) => e.id === id) ?? null;
}

/** Make the call at the current decision point. After the last one the link fails and the dive plays out. */
export function chooseProbeOption(state: GameState, world: World, option: 0 | 1): Result<{ done: boolean; result?: DiveResult }> {
  const dive = state.probeDive;
  const event = currentProbeEvent(state);
  if (!dive || !event) return fail("No probe is waiting on a decision.");
  const pick = event.options[option];
  dive.risk = (dive.risk + (pick.risk ?? 0)) * (pick.riskMult ?? 1);
  dive.yieldMult *= pick.yield ?? 1;
  dive.hours = Math.max(2, dive.hours + (pick.hours ?? 0));
  dive.choices.push(pick.label);
  dive.step++;
  if (dive.step < dive.events.length) return ok({ done: false });
  return ok({ done: true, result: finishDive(state, world) });
}

/** The link is gone: wait for the ballast timer, then see what (if anything) comes back up. */
function finishDive(state: GameState, world: World): DiveResult {
  const dive = state.probeDive as ProbeDive;
  state.probeDive = undefined;
  const body = world.body(dive.bodyId).body;
  const band = depthBand(dive.depth);
  advanceTime(state, dive.hours * HOUR);
  const risk = clampRisk(dive.risk);
  const roll = withRng(state, (rng) => rng.next());
  const outcome: ProbeOutcome = roll < risk ? "lost" : roll < Math.min(0.95, risk * 1.6) ? "damaged" : "recovered";
  const gases: Partial<Record<GasId, number>> = {};
  if (outcome !== "lost") {
    state.ship.probes = (state.ship.probes ?? 0) + 1;
    const haul = band.tonnes * dive.yieldMult * (outcome === "damaged" ? 0.5 : 1);
    const mix = band.mix[body.kind === "iceGiant" ? "iceGiant" : "gasGiant"];
    const total = Object.values(mix).reduce((a, b) => a + (b ?? 0), 0);
    const capacity = effectiveStats(state).cargoCapacityT;
    for (const gas of GAS_IDS) {
      const t = Math.round(((haul * (mix[gas] ?? 0)) / total) * 100) / 100;
      if (t <= 0) continue;
      const added = addCargo(state.ship.cargo, gas, t, capacity);
      if (added > 0) gases[gas] = Math.round(added * 100) / 100;
    }
  }
  awardXp(state, "science", band.xp);
  cheerStation(state, "science", outcome === "lost" ? -3 : dive.depth >= 3 ? 2 : 1);
  const haulText = (Object.entries(gases) as [GasId, number][]).map(([g, t]) => `${t} t ${COMMODITIES[g].name.toLowerCase()}`).join(", ");
  log(
    state,
    outcome === "lost" ? "warning" : "discovery",
    outcome === "lost"
      ? `The probe never came back up from ${body.name}'s ${band.name.toLowerCase()}. Contact was lost ${Math.round(dive.hours)} hours ago.`
      : `The probe surfaced from ${body.name}${outcome === "damaged" ? ", battered, with half its canisters cracked" : ""}: ${haulText || "nothing worth keeping"}.`,
  );
  return { outcome, gases, hours: dive.hours };
}

/** Buy probes at the Intrepid's Shipyard (up to the bay's capacity). */
export function buyProbes(state: GameState, count: number): Result<number> {
  if (state.location.kind !== "intrepid") return fail("Probes are sold aboard the Intrepid.");
  const capacity = effectiveStats(state).probeCapacity;
  if (capacity === 0) return fail("Install an atmospheric probe bay first.");
  const n = Math.min(Math.floor(count), capacity - (state.ship.probes ?? 0), Math.floor(state.credits / PROBE_PRICE));
  if (n <= 0) return fail((state.ship.probes ?? 0) >= capacity ? "The probe racks are full." : `A probe costs ${PROBE_PRICE.toLocaleString()} cr.`);
  state.credits -= n * PROBE_PRICE;
  state.ship.probes = (state.ship.probes ?? 0) + n;
  log(state, "trade", `Bought ${n} atmospheric probe${n === 1 ? "" : "s"} from the Lyceum for ${(n * PROBE_PRICE).toLocaleString()} cr.`);
  return ok(n);
}
