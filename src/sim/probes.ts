/**
 * Atmospheric probe dives on gas and ice giants (AW-16). The science officer flies the probe down
 * to a chosen depth band, making a call at each decision point; the link fails at depth and a
 * mechanical ballast timer brings it back up, if it survives. A probe that returns is reused; a lost
 * one has to be replaced at the Shipyard.
 */
import { FLORA, FLORA_BY_NAME } from "../data/catalog";
import { COMMODITIES, GAS_IDS, type GasId } from "../data/commodities";
import { DEPTHS, PROBE_EVENTS, PROBE_PRICE, type DepthBand, type ProbeDepth, type ProbeEvent, type ProbeOption } from "../data/probes";
import type { Body } from "./bodies";
import { awardXp, workingLevel } from "./crew";
import { sellPrice } from "./economy";
import { recordFind } from "./compendium";
import { specimenKey } from "./contracts";
import { effectiveStats, shipSpecimenSlots } from "./perks";
import { fail, ok, type Result } from "./result";
import { rngFor } from "./rng";
import { cheerStation } from "./sentiment";
import { addCargo, specimenCount } from "./ship";
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
  /** Depth bands profiled for the first time on this giant (readings the Lyceum will buy). */
  newReadings: ProbeDepth[];
  /** A floating organism caught in the canisters, if any. */
  floater: string | null;
}

/** A dive on record (for contracts and the debrief history). */
export interface DiveRecord {
  bodyId: string;
  depth: ProbeDepth;
  outcome: ProbeOutcome;
  t: number;
}

/** What the Lyceum pays for a first atmospheric profile of a depth band on a giant. */
export const READING_PRICE_PER_DEPTH = 600;
/** Chance a returning deep probe brings up floating life (gas giants; ice giants half as often). */
export const FLOATER_CHANCE: Record<ProbeDepth, number> = { 1: 0, 2: 0, 3: 0.08, 4: 0.15 };

/** Depth bands profiled on this giant (from probes that came back). */
export function readingsFor(state: GameState, bodyId: string): ProbeDepth[] {
  return (state.atmoReadings?.[bodyId] ?? []) as ProbeDepth[];
}

/** A giant's atmosphere is charted once any probe has come back from it: the planner then shows true values. */
export function atmosphereCharted(state: GameState, bodyId: string): boolean {
  return readingsFor(state, bodyId).length > 0;
}

/** What a dive to `depth` on this giant would add for the Lyceum: the bands it passes that no probe has profiled yet. */
export function newReadingsFor(state: GameState, bodyId: string, depth: ProbeDepth): { depths: ProbeDepth[]; value: number } {
  const had = new Set<number>(readingsFor(state, bodyId));
  const depths: ProbeDepth[] = [];
  for (let d = 1; d <= depth; d++) if (!had.has(d)) depths.push(d as ProbeDepth);
  return { depths, value: depths.reduce((s, d) => s + READING_PRICE_PER_DEPTH * d, 0) };
}

/** Readings not yet sold to the Lyceum, and what they're worth. */
export function unsoldReadings(state: GameState): { key: string; bodyId: string; depth: ProbeDepth; value: number }[] {
  const sold = new Set(state.atmoSold ?? []);
  const out: { key: string; bodyId: string; depth: ProbeDepth; value: number }[] = [];
  for (const [bodyId, depths] of Object.entries(state.atmoReadings ?? {})) {
    for (const depth of depths as ProbeDepth[]) {
      const key = `${bodyId}|${depth}`;
      if (!sold.has(key)) out.push({ key, bodyId, depth, value: READING_PRICE_PER_DEPTH * depth });
    }
  }
  return out;
}

/** Sell new atmospheric profiles to the Lyceum (each giant and depth band pays once). */
export function sellReadings(state: GameState): Result<number> {
  if (state.location.kind !== "intrepid") return fail("The Lyceum buys readings aboard the Intrepid.");
  const fresh = unsoldReadings(state);
  if (fresh.length === 0) return fail("No new atmospheric readings to sell.");
  const total = fresh.reduce((s, r) => s + r.value, 0);
  state.atmoSold = [...(state.atmoSold ?? []), ...fresh.map((r) => r.key)];
  state.credits += total;
  state.stats.earned += total;
  awardXp(state, "science", 3 * fresh.length);
  log(state, "trade", `The Lyceum paid ${total.toLocaleString()} cr for ${fresh.length} new atmospheric profile${fresh.length === 1 ? "" : "s"}.`);
  return ok(total);
}

export function isGiant(body: Body): boolean {
  return body.kind === "gasGiant" || body.kind === "iceGiant";
}

/** How rich a giant's atmosphere is (0.6–1.4), stable per body. */
export function atmosphereRichness(seed: number, body: Body): number {
  return Math.round(rngFor(seed, body.id, "atmosphere").range(0.6, 1.4) * 100) / 100;
}

/** Words for an atmosphere's richness, for the dive planner. */
export function richnessLabel(richness: number): "lean" | "average" | "rich" {
  return richness < 0.8 ? "lean" : richness < 1.2 ? "average" : "rich";
}

/** A subtle nudge about what a choice leans toward (never numbers): "faster, riskier". */
export function optionHint(option: ProbeOption): string {
  const hints: string[] = [];
  const hours = option.hours ?? 0;
  if (hours < 0) hints.push("faster");
  else if (hours > 0) hints.push("slower");
  if (option.riskMult !== undefined && option.riskMult < 1) hints.push("safer");
  else if ((option.risk ?? 0) > 0) hints.push("riskier");
  else if ((option.risk ?? 0) < 0) hints.push("safer");
  const y = option.yield ?? 1;
  if (y > 1) hints.push("richer sample");
  else if (y < 1) hints.push("leaner sample");
  return hints.join(", ");
}

/** Roughly how far down the probe is when it reaches decision point `step` (0-based) of a dive. */
export function diveDepthKm(depth: ProbeDepth, step: number): number {
  const band = depthBand(depth);
  return Math.round((band.km * (step + 1)) / (band.events + 1));
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
  /** True until a probe has come back from this giant: the haul is a guess from an average atmosphere. */
  estimated: boolean;
  /** Expected tonnes of each gas in a full haul, largest first. */
  gases: { gas: GasId; tonnes: number }[];
}

/** What each depth band looks like from orbit, for the dive planner. */
export function diveOdds(state: GameState, world: World, body: Body): DiveOdds[] {
  const pilot = pilotSkill(state);
  // Until a probe comes back from this giant, the planner can only assume an average atmosphere.
  const charted = atmosphereCharted(state, body.id);
  const rich = charted ? atmosphereRichness(state.seed, body) : 1;
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
      estimated: !charted,
      gases: (Object.entries(mix) as [GasId, number][])
        .map(([gas, w]) => ({ gas, tonnes: (tonnes * w) / total }))
        .sort((a, b) => b.tonnes - a.tonnes),
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
  const newReadings: ProbeDepth[] = [];
  let floater: string | null = null;
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
    // The probe profiled every band it passed through on the way down.
    state.atmoReadings ??= {};
    const had = new Set(state.atmoReadings[body.id] ?? []);
    for (let d = 1; d <= dive.depth; d++) {
      if (!had.has(d)) {
        newReadings.push(d as ProbeDepth);
        had.add(d);
      }
    }
    state.atmoReadings[body.id] = [...had].sort();
    // Now and then something alive rides up in the canisters.
    const chance = FLOATER_CHANCE[dive.depth] * (body.kind === "iceGiant" ? 0.5 : 1) * (outcome === "damaged" ? 0.5 : 1);
    const pool = FLORA.filter((f) => f.floating && (dive.depth >= 4 || f.rarity < 3));
    floater = withRng(state, (rng) => (pool.length > 0 && rng.chance(chance) ? rng.weighted(pool.map((f) => [f, f.rarity === 3 ? 1 : 3] as const)).name : null));
    if (floater) {
      const room = shipSpecimenSlots(state) - specimenCount(state.ship.specimens);
      if (room > 0) {
        state.ship.specimens ??= {};
        const key = specimenKey(body.id, floater);
        state.ship.specimens[key] = (state.ship.specimens[key] ?? 0) + 1;
        const entry = FLORA_BY_NAME.get(floater);
        if (entry) recordFind(state, "flora", entry.id, body.name, entry.name);
        noteGiantLife(state, body.id, floater);
        log(state, "discovery", `Something alive came up in the canisters: a ${floater}, still drifting in its sample jar.`);
      } else {
        log(state, "warning", `A ${floater} came up in the canisters, but the containment racks are full. It had to be released.`);
        floater = null;
      }
    }
  }
  state.probeHistory = [...(state.probeHistory ?? []).slice(-49), { bodyId: body.id, depth: dive.depth, outcome, t: state.time }];
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
  return { outcome, gases, hours: dive.hours, newReadings, floater };
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

function noteGiantLife(state: GameState, bodyId: string, species: string): void {
  state.giantLife ??= {};
  const seen = (state.giantLife[bodyId] ??= []);
  if (!seen.includes(species)) seen.push(species);
}

export interface LifeSigns {
  label: string;
  /** "good" when life is known here, "muted" otherwise. */
  tone: "good" | "muted";
  title?: string;
}

/**
 * What the world info says about life (playtest 15). Worlds with a surface read it from orbit. Giants
 * can't be read from orbit: drifting life lives only in the deep layers, and only a probe that comes
 * back from band 3 or deeper can bring some up; once one has, it's confirmed by name.
 */
export function lifeSigns(state: GameState, body: Body): LifeSigns {
  const giant = body.kind === "gasGiant" || body.kind === "iceGiant";
  if (!giant) return body.life ? { label: "Detected", tone: "good" } : { label: "None detected", tone: "muted" };
  const found = state.giantLife?.[body.id] ?? [];
  if (found.length > 0) return { label: `Confirmed: ${found.join(", ")}`, tone: "good", title: "Brought up from the deep layers by your probes." };
  return {
    label: "Unknown below the clouds",
    tone: "muted",
    title: `Drifting life lives only in the deep layers. A probe back from band 3 or deeper sometimes brings some up${body.kind === "iceGiant" ? " (about half as often on ice giants)" : ""}.`,
  };
}
