/** The clans' outposts (AW-23): small, permanent establishments on planet surfaces, one kind per clan. */
import type { ClanId } from "./ship";

export interface OutpostType {
  clan: ClanId;
  /** What the clan calls it ("research station"). */
  kind: string;
  /** People aboard: a few dozen to a few hundred. */
  population: [number, number];
  /** One line for the panel. */
  blurb: string;
  /** Names for this kind, in no particular order; the seed picks one. */
  names: string[];
}

export const OUTPOST_TYPES: Record<ClanId, OutpostType> = {
  lyceum: {
    clan: "lyceum",
    kind: "research station",
    population: [40, 140],
    blurb: "Prefab labs and greenhouses, where the Lyceum studies a world that's alive.",
    names: ["Linnaeus Station", "Seedbank Field", "Greenhouse Nine", "Wallace Camp"],
  },
  freebooters: {
    clan: "freebooters",
    kind: "pirate's den",
    population: [80, 260],
    blurb: "Landing lights, salvage yards and a bar. Visitors are welcome if the Freebooters know them.",
    names: ["Lantern Hole", "the Back Door", "Snug Harbor", "Last Ditch"],
  },
  diggers: {
    clan: "diggers",
    kind: "refinery",
    population: [120, 320],
    blurb: "Smelters and slag heaps over the richest ground the Diggers could find.",
    names: ["Deepcut", "Slagtown", "Foundry Rise", "Ironhold"],
  },
  exchange: {
    clan: "exchange",
    kind: "trading post",
    population: [90, 240],
    blurb: "Warehouses, a market hall and a counting house on a busy lane.",
    names: ["Crossroads", "Fair Price", "Waystation", "Tally House"],
  },
  covenant: {
    clan: "covenant",
    kind: "telescope array",
    population: [30, 90],
    blurb: "Dishes and antennas on a dead, quiet world, listening to everything.",
    names: ["Long Ear", "Quiet Field", "the Listening Post", "Stillwater Array"],
  },
  midshipmen: {
    clan: "midshipmen",
    kind: "drydock",
    population: [150, 380],
    blurb: "Slipways and machine shops where the Midshipmen refit ships far from home.",
    names: ["Keel Yard", "Slipway Four", "Fitting Out", "Anchor Point"],
  },
  helm: {
    clan: "helm",
    kind: "patrol station",
    population: [100, 280],
    blurb: "A Helm base on the raiders' favorite lane. The pirates give its system a wide berth.",
    names: ["Watchtower", "Picket Station", "Vigilance", "Lamplight"],
  },
};
