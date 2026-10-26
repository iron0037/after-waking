/**
 * Research projects (AW-15): bring a clan what it needs, pay for the lab time, and the top tier of
 * a piece of gear goes on sale at the Shipyard when the project finishes. Projects run while you fly.
 */
import { clanMods } from "./clan";
import { FLORA_BY_NAME } from "../data/catalog";
import { COMMODITIES, ORE_IDS, type CommodityId } from "../data/commodities";
import { MAX_ACTIVE_RESEARCH, RESEARCH, RESEARCH_BY_ID, RESEARCH_FOR_UPGRADE, type Requirement, type ResearchProject } from "../data/research";
import { CLAN_NAMES, UPGRADES_BY_ID } from "../data/ship";
import { oreEquivalent, takeOreEquivalent } from "./refinery";
import { fail, ok, type Result } from "./result";
import { bondClan } from "./sentiment";
import { removeCargo } from "./ship";
import type { GameState } from "./state";
import { formatDuration } from "./time";
import { DAY } from "./units";

export interface ResearchRecord {
  startedAt: number;
  readyAt: number;
  done: boolean;
}

export type ResearchStatus = "available" | "running" | "done";

export function researchStatus(state: GameState, id: string): ResearchStatus {
  const r = state.research?.[id];
  if (!r) return "available";
  return r.done ? "done" : "running";
}

export interface RequirementProgress {
  have: number;
  need: number;
  met: boolean;
  label: string;
}

const isOre = (id: CommodityId) => (ORE_IDS as readonly string[]).includes(id);

export function requirementProgress(state: GameState, req: Requirement): RequirementProgress {
  const of = (have: number, need: number, label: string): RequirementProgress => ({ have, need, met: have >= need - 0.05, label });
  switch (req.kind) {
    case "cargo": {
      const have = isOre(req.commodity) ? oreEquivalent(state, req.commodity) : (state.ship.cargo[req.commodity] ?? 0);
      return of(have, req.tonnes, `${req.tonnes} t of ${COMMODITIES[req.commodity].name.toLowerCase()} (${Math.floor(have)} t aboard)`);
    }
    case "surveys": {
      const have = state.surveyedBodies.length;
      return of(have, req.count, `detailed surveys of ${req.count} worlds (${have} so far)`);
    }
    case "species": {
      const have = state.catalogedSpecies.length;
      return of(have, req.count, `${req.count} species catalogued by the Lyceum (${have} so far)`);
    }
    case "readings": {
      const have = Object.values(state.atmoReadings ?? {}).reduce((n, depths) => n + depths.filter((d) => d >= req.depth).length, 0);
      return of(have, req.count, `${req.count} atmospheric readings at depth ${req.depth} or deeper (${have} so far)`);
    }
    case "systems": {
      const have = state.visitedSystems.length;
      return of(have, req.count, `charts from ${req.count} star systems (${have} visited)`);
    }
    case "specimens": {
      const have = matchingSpecimens(state, req).reduce((n, [, c]) => n + c, 0);
      const what = req.species ? `live ${req.species}` : `live specimens of ${req.minRarity === 3 ? "rare" : "uncommon or rarer"} species`;
      return of(have, req.count, `${req.count} ${what} (${have} in the racks)`);
    }
  }
}

/** Specimens in the ship's racks that meet a requirement, as [key, count]. */
function matchingSpecimens(state: GameState, req: Extract<Requirement, { kind: "specimens" }>): [string, number][] {
  return Object.entries(state.ship.specimens ?? {}).filter(([key, n]) => {
    if (n <= 0) return false;
    const species = key.split("|")[1] ?? "";
    if (req.species) return species === req.species;
    return (FLORA_BY_NAME.get(species)?.rarity ?? 0) >= (req.minRarity ?? 1);
  });
}

/** Why a project can't start right now (empty if it can). */
export function researchBlockers(state: GameState, id: string): string[] {
  const p = RESEARCH_BY_ID.get(id);
  if (!p) return ["Unknown project."];
  const out: string[] = [];
  const status = researchStatus(state, id);
  if (status === "running") return ["Already under way."];
  if (status === "done") return ["Already finished."];
  if (state.location.kind !== "intrepid") out.push("Projects are commissioned aboard the Intrepid.");
  const running = RESEARCH.filter((q) => researchStatus(state, q.id) === "running").length;
  if (running >= MAX_ACTIVE_RESEARCH) out.push(`The clans will run ${MAX_ACTIVE_RESEARCH} projects for you at a time.`);
  for (const req of p.needs) {
    const prog = requirementProgress(state, req);
    if (!prog.met) out.push(`Needs ${prog.label}.`);
  }
  if (state.credits < researchCost(state, p)) out.push(`Costs ${researchCost(state, p).toLocaleString()} cr.`);
  return out;
}

/** Commission a project: hand over the goods, pay, and the clock starts. */
export function startResearch(state: GameState, id: string): Result<ResearchProject> {
  const blockers = researchBlockers(state, id);
  if (blockers.length > 0) return fail(blockers[0] as string);
  const p = RESEARCH_BY_ID.get(id) as ResearchProject;
  for (const req of p.needs) {
    if (req.kind === "specimens") {
      let left = req.count;
      for (const [key, n] of matchingSpecimens(state, req)) {
        const take = Math.min(left, n);
        const racks = state.ship.specimens as Record<string, number>;
        racks[key] = n - take;
        if ((racks[key] ?? 0) <= 0) delete racks[key];
        left -= take;
        if (left <= 0) break;
      }
    }
    if (req.kind !== "cargo") continue;
    if (isOre(req.commodity)) takeOreEquivalent(state, req.commodity, req.tonnes);
    else removeCargo(state.ship.cargo, req.commodity, req.tonnes);
  }
  state.trackedResearch = (state.trackedResearch ?? []).filter((t) => t !== id);
  state.credits -= researchCost(state, p);
  state.research ??= {};
  state.research[id] = { startedAt: state.time, readyAt: state.time + p.days * DAY, done: false };
  bondClan(state, p.clan, 3);
  state.journal.push({
    t: state.time,
    kind: "trade",
    text: `Commissioned "${p.name}" from ${CLAN_NAMES[p.clan]}. They expect results in ${formatDuration(p.days * DAY)}. The Covenant's pamphleteers disapprove, as always.`,
  });
  return ok(p);
}

/** Finish any projects whose time has come. Called as time passes. */
export function tickResearch(state: GameState): void {
  for (const [id, r] of Object.entries(state.research ?? {})) {
    if (r.done || state.time < r.readyAt) continue;
    r.done = true;
    const p = RESEARCH_BY_ID.get(id);
    if (!p) continue;
    const gear = UPGRADES_BY_ID.get(p.unlocks)?.name ?? p.unlocks;
    state.journal.push({ t: state.time, kind: "discovery", text: `Research finished: "${p.name}". ${CLAN_NAMES[p.clan]} can now sell the ${gear} at the Shipyard.` });
  }
}

/** The project that gates an upgrade, if any. */
export function researchFor(upgradeId: string): ResearchProject | null {
  return RESEARCH_FOR_UPGRADE.get(upgradeId) ?? null;
}

/** Can this upgrade be bought? Ungated gear always; gated gear once its project is done (or if it's already fitted). */
export function upgradeUnlocked(state: GameState, upgradeId: string): boolean {
  const p = researchFor(upgradeId);
  return !p || researchStatus(state, p.id) === "done" || state.ship.upgrades.includes(upgradeId);
}

/** Pin a project's shopping list to the ship status window and star map while you're out (or unpin it). */
export function toggleTrackResearch(state: GameState, id: string): Result<boolean> {
  if (!RESEARCH_BY_ID.has(id)) return fail("Unknown project.");
  if (researchStatus(state, id) !== "available") return fail("That project is already under way.");
  const tracked = state.trackedResearch ?? [];
  const on = !tracked.includes(id);
  state.trackedResearch = on ? [...tracked, id] : tracked.filter((t) => t !== id);
  return ok(on);
}

/** The projects you're collecting for. */
export function trackedProjects(state: GameState): ResearchProject[] {
  return (state.trackedResearch ?? []).map((id) => RESEARCH_BY_ID.get(id)).filter((p): p is ResearchProject => !!p && researchStatus(state, p.id) === "available");
}

/** Tonnes of each good your tracked projects still want, for highlighting on the star map and in the hold. */
export function researchWants(state: GameState): Map<CommodityId, number> {
  const out = new Map<CommodityId, number>();
  for (const p of trackedProjects(state)) {
    for (const req of p.needs) if (req.kind === "cargo") out.set(req.commodity, (out.get(req.commodity) ?? 0) + req.tonnes);
  }
  return out;
}

/** What a project costs this captain (Covenant captains pay more for Archive work). */
export function researchCost(state: GameState, p: ResearchProject): number {
  return Math.round((p.cost * clanMods(state).researchCost) / 100) * 100;
}
