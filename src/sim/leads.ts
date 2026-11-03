/**
 * The Diggers' lead (AW-21): a Digger captain's clan passes on one high-grade seam a year from its assay office.
 * The first comes with the ship; after that, one at the first docking a year or more after the last. The seam is
 * marked identified in its region, so it shows on the region chart from orbit (AW-209) and from afar.
 */
import { COMMODITIES } from "../data/commodities";
import { mountainBlocker } from "./actions";
import type { Body } from "./bodies";
import { landingAccess } from "./environment";
import { effectiveStats } from "./perks";
import { emptyKnowledge, normalizeKnowledge, regionKey } from "./surface";
import { log, withRng, type GameState } from "./state";
import { YEAR } from "./units";
import { siteOnWater } from "./vehicles";
import type { World } from "./world";

/** A seam worth passing on: at least this grade. */
const LEAD_MIN_GRADE = 0.45;
/** How many bodies and regions the assay office looks through for each lead. */
const LEAD_BODIES = 14;
const LEAD_REGIONS = 6;

export interface DiggersLead {
  bodyId: string;
  region: number;
  depositId: number;
}

/**
 * Pick the lead: the most valuable unknown, high-grade seam on dry, drivable ground within the drill's reach, on a
 * scanned world the ship can land on. Null if nothing qualifies.
 */
export function findDiggersLead(state: GameState, world: World): DiggersLead | null {
  const stats = effectiveStats(state);
  const bodies = [...new Set(state.scannedBodies)]
    .map((id) => {
      try {
        return world.body(id).body;
      } catch {
        return null;
      }
    })
    .filter((b): b is Body => !!b && b.regions > 0 && Object.keys(b.resources).length > 0 && landingAccess(b, stats.ratings).ok);
  if (bodies.length === 0) return null;
  return withRng(state, (rng) => {
    const pool = [...bodies];
    let best: (DiggersLead & { value: number }) | null = null;
    for (let i = 0; i < LEAD_BODIES && pool.length > 0; i++) {
      const body = pool.splice(rng.int(0, pool.length - 1), 1)[0]!;
      const surface = world.surface(body.id);
      const regions = Array.from({ length: body.regions }, (_, r) => r);
      for (let j = 0; j < LEAD_REGIONS && regions.length > 0; j++) {
        const region = regions.splice(rng.int(0, regions.length - 1), 1)[0]!;
        const know = state.regions[regionKey(body.id, region)];
        for (const d of surface.deposits(region)) {
          if (d.hidden || d.grade < LEAD_MIN_GRADE || d.depthM > stats.drillMaxDepthM) continue;
          if (know && (know.discovered.includes(d.id) || (know.extracted[d.id] ?? 0) > 0)) continue;
          if (siteOnWater(world, body.id, d) || mountainBlocker(state, world, body.id, d)) continue;
          const value = d.tonnes * COMMODITIES[d.commodity].basePrice;
          if (!best || value > best.value) best = { bodyId: body.id, region, depositId: d.id, value };
        }
      }
    }
    return best && { bodyId: best.bodyId, region: best.region, depositId: best.depositId };
  });
}

/** Give a lead now (if one can be found) and note when. */
export function grantDiggersLead(state: GameState, world: World): DiggersLead | null {
  state.diggersLeadAt = state.time;
  const lead = findDiggersLead(state, world);
  if (!lead) return null;
  const know = normalizeKnowledge((state.regions[regionKey(lead.bodyId, lead.region)] ??= emptyKnowledge()));
  know.discovered.push(lead.depositId);
  const { body } = world.body(lead.bodyId);
  const system = world.galaxy.systems.find((sy) => sy.id === lead.bodyId.split(".")[0]);
  const d = world.surface(lead.bodyId).deposits(lead.region).find((x) => x.id === lead.depositId)!;
  log(
    state,
    "discovery",
    `The Diggers' assay office passed you a lead: a rich ${COMMODITIES[d.commodity].name.toLowerCase()} seam, about ${Math.round(d.tonnes)} t, on ${body.name} (${system?.name ?? "the Verge"}), region ${lead.region + 1}. It's marked on the region chart.`,
  );
  return lead;
}

/** At docking: a Digger captain's yearly lead, when it's due. */
export function diggersLeadOnDocked(state: GameState, world: World): void {
  if (state.captain.clan !== "diggers") return;
  if (state.diggersLeadAt !== undefined && state.time - state.diggersLeadAt < YEAR) return;
  grantDiggersLead(state, world);
}
