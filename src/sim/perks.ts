/**
 * Perk trees (AW-95, docs/crew_perks.md): one point per level gained, spent in a station's three
 * branches. Perks belong to the person, so a new hire brings theirs and a departing officer takes
 * theirs ashore.
 *
 * This module owns the rules for taking, retraining and auto-spending perks, plus the ship stats as
 * modified by perks (`effectiveStats`), which gameplay should read instead of raw `shipStats`.
 */
import type { OfficerStation, Station } from "../data/crew";
import { BRANCHES, PERKS, PERKS_BY_ID, type PerkDef } from "../data/perks";
import type { ClanId, ShipStats } from "../data/ship";
import { levelForXp, officerAt, type CrewMember } from "./crew";
import { fail, ok, type Result } from "./result";
import type { Rng } from "./rng";
import { shipStats } from "./ship";
import { advanceTime, type GameState } from "./state";
import { DAY } from "./units";

/** Whoever holds a station: the captain's record, or the officer. */
interface Holder {
  xp?: number;
  perks?: string[];
}

function holderOf(state: GameState, station: Station): Holder | null {
  return station === "captain" ? state.captain : officerAt(state, station);
}

/** True if whoever holds the perk's station has taken it (and the perk's system exists). */
export function hasPerk(state: GameState, id: string): boolean {
  const def = PERKS_BY_ID.get(id);
  if (!def || def.needs) return false;
  return holderOf(state, def.station)?.perks?.includes(id) ?? false;
}

/** Points earned (one per level above 1) and not yet spent. */
export function freePerkPoints(holder: Holder): number {
  return Math.max(0, levelForXp(holder.xp ?? 0) - 1 - (holder.perks?.length ?? 0));
}

/** Unspent points across the whole crew, for the top-bar reminder. */
export function crewFreePoints(state: GameState): number {
  return freePerkPoints(state.captain) + (state.crew ?? []).reduce((n, m) => n + freePerkPoints(m), 0);
}

/** Why `holder` (at `station`) can't take a perk now, or null if they can. */
export function perkBlocker(holder: Holder, station: Station, def: PerkDef): string | null {
  if (def.station !== station) return "That perk belongs to another station.";
  if (def.needs) return `Arrives with ${def.needs}.`;
  const taken = holder.perks ?? [];
  if (taken.includes(def.id)) return "Already taken.";
  const inBranch = taken.filter((id) => PERKS_BY_ID.get(id)?.branch === def.branch).length;
  if (inBranch < def.tier - 1) return `Needs ${def.tier - 1} ${def.branch} perk${def.tier === 2 ? "" : "s"} first.`;
  if (freePerkPoints(holder) <= 0) return "No perk points to spend. Each level brings one.";
  return null;
}

/** Spend a point. `station` picks the person: the captain or that station's officer. */
export function takePerk(state: GameState, station: Station, perkId: string): Result<PerkDef> {
  const def = PERKS_BY_ID.get(perkId);
  if (!def) return fail("Unknown perk.");
  const holder = holderOf(state, station);
  if (!holder) return fail("Nobody holds that station.");
  const blocked = perkBlocker(holder, station, def);
  if (blocked) return fail(blocked);
  holder.perks = [...(holder.perks ?? []), def.id];
  const who = station === "captain" ? "The captain" : (holder as CrewMember).name;
  state.journal.push({ t: state.time, kind: "info", text: `${who} trained as ${def.name}: ${def.text}` });
  return ok(def);
}

// --- retraining --------------------------------------------------------------------------

export function retrainCost(level: number): { credits: number; days: number } {
  return { credits: 400 * level, days: 14 + 2 * level };
}

/** A Lyceum course aboard the Intrepid: refunds every perk point, for credits and weeks of time. */
export function retrain(state: GameState, station: Station): Result<{ refunded: number }> {
  if (state.location.kind !== "intrepid") return fail("The Lyceum runs its courses aboard the Intrepid.");
  const holder = holderOf(state, station);
  if (!holder) return fail("Nobody holds that station.");
  const refunded = holder.perks?.length ?? 0;
  if (refunded === 0) return fail("Nothing to unlearn yet.");
  const cost = retrainCost(levelForXp(holder.xp ?? 0));
  if (state.credits < cost.credits) return fail(`The course costs ${cost.credits.toLocaleString()} cr.`);
  state.credits -= cost.credits;
  holder.perks = [];
  advanceTime(state, cost.days * DAY);
  const who = station === "captain" ? "The captain" : (holder as CrewMember).name;
  state.journal.push({
    t: state.time,
    kind: "info",
    text: `${who} finished a ${cost.days}-day Lyceum retraining course: ${refunded} perk point${refunded === 1 ? "" : "s"} to spend again.`,
  });
  return ok({ refunded });
}

// --- recruits arrive with their points spent ---------------------------------------------

/** The branch a clan trains its people in, per station (index into BRANCHES). */
const CLAN_BRANCH: Partial<Record<ClanId, Partial<Record<Station, number>>>> = {
  helm: { navigation: 0 },
  midshipmen: { engineering: 0 },
  diggers: { engineering: 2, science: 0 },
  lyceum: { science: 1, medical: 1 },
  exchange: { comms: 0 },
  covenant: { comms: 1 },
};

/** Spend a recruit's points the way their training would: mostly down one branch. */
export function autoSpendPerks(person: { station: OfficerStation; clan: ClanId; xp: number; perks?: string[] }, rng: Rng): void {
  const station: Station = person.station;
  const preferred = CLAN_BRANCH[person.clan]?.[station] ?? rng.int(0, 2);
  const order = [preferred, ...[0, 1, 2].filter((b) => b !== preferred)];
  person.perks ??= [];
  for (let guard = 0; guard < 20 && freePerkPoints(person) > 0; guard++) {
    const next = order
      .map((b) => BRANCHES[station][b])
      .map((branch) => PERKS.find((p) => p.station === station && p.branch === branch && perkBlocker(person, station, p) === null))
      .find((p) => p !== undefined);
    if (!next) break;
    person.perks.push(next.id);
  }
}

/** Mainly for the headless bot: spend everyone's free points automatically. */
export function autoSpendCrew(state: GameState, rng: Rng): void {
  for (const m of state.crew ?? []) autoSpendPerks(m, rng);
  state.captain.perks ??= [];
  for (let guard = 0; guard < 20 && freePerkPoints(state.captain) > 0; guard++) {
    const next = PERKS.find((p) => p.station === "captain" && perkBlocker(state.captain, "captain", p) === null);
    if (!next) break;
    state.captain.perks.push(next.id);
  }
}

// --- ship stats with the crew's perks ----------------------------------------------------

/** The ship's stats as the crew actually gets to use them: hardware plus perks. */
export function effectiveStats(state: GameState): ShipStats {
  const s = shipStats(state.ship);
  if (hasPerk(state, "power-management")) s.roverEnergy = Math.round(s.roverEnergy * 1.15);
  if (hasPerk(state, "rover-overhaul")) s.roverCargoT = Math.round(s.roverCargoT * 1.25);
  if (hasPerk(state, "deep-bore")) s.drillMaxDepthM = Math.round(s.drillMaxDepthM * 1.2);
  if (hasPerk(state, "afterburner")) s.cruiseSpeedC = Math.round(s.cruiseSpeedC * 1.1 * 1000) / 1000;
  if (hasPerk(state, "long-fold")) s.foldRangeLy += 1;
  if (hasPerk(state, "storm-pilot")) {
    s.ratings.maxGravityG = Math.round(s.ratings.maxGravityG * 1.2 * 100) / 100;
    s.ratings.maxPressureAtm = Math.round(s.ratings.maxPressureAtm * 1.2 * 100) / 100;
  }
  if (hasPerk(state, "lift-rating")) s.ratings.maxGravityG = Math.round((s.ratings.maxGravityG + 0.2) * 100) / 100;
  if (hasPerk(state, "hazard-suits")) {
    s.ratings.maxRadiation += 1;
    s.ratings.minTempC -= 20;
    s.ratings.maxTempC += 20;
  }
  return s;
}

/** Extra effective levels that cross-training perks grant, per crew bonus (principle 2 in the design). */
export const CROSS_TRAINING: Record<string, readonly string[]> = {
  foldFuel: ["drive-harmonics"],
  foldRecharge: ["plicite-chemistry"],
  flightFuel: ["efficient-burns", "drive-tuning"],
  drillRate: ["drill-master"],
  contractPay: ["deal-maker"],
  incidentHours: ["triage"],
  specimenPrice: ["culture-lab"],
  salePrice: ["haggler"],
};

/** Effective levels can run past the cap with help from other stations, up to this. */
export const MAX_EFFECTIVE_LEVEL = 12;

export function crossTrainingLevels(state: GameState, bonus: string): number {
  return (CROSS_TRAINING[bonus] ?? []).filter((id) => hasPerk(state, id)).length * 2;
}

export const ROVER_SPECIMEN_BASE = 6;
export const SHIP_SPECIMEN_BASE = 16;

export function roverSpecimenSlots(state: GameState): number {
  return ROVER_SPECIMEN_BASE + (hasPerk(state, "containment") ? 2 : 0);
}

export function shipSpecimenSlots(state: GameState): number {
  return SHIP_SPECIMEN_BASE + (hasPerk(state, "containment") ? 2 : 0);
}

