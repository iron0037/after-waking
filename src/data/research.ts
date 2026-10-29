/**
 * Research projects at the Intrepid (AW-15). Each one is a clan slowly working a corner of the
 * Archive (the data dump from Earth) into something they can build. You bring back what they
 * need, pay for the lab time, and weeks later the gear goes on sale at the Shipyard.
 * The first tier of every kind of gear is sold outright; research gates the top tier.
 */
import type { CommodityId } from "./commodities";
import type { ClanId } from "./ship";

export type Requirement =
  /** Handed over at the start (ores accept concentrate at its ore equivalent). */
  | { kind: "cargo"; commodity: CommodityId; tonnes: number }
  /** Detailed orbital surveys you've flown (data, not used up). */
  | { kind: "surveys"; count: number }
  /** Species the Lyceum has catalogued from your samples. */
  | { kind: "species"; count: number }
  /** Atmospheric readings at this depth band or deeper, across all giants. */
  | { kind: "readings"; depth: number; count: number }
  /** Star systems you've visited. */
  | { kind: "systems"; count: number }
  /** Live specimens from the ship's racks, handed over at the start: one species, or any of a rarity or rarer. */
  | { kind: "specimens"; count: number; species?: string; minRarity?: 1 | 2 | 3 };

export interface ResearchProject {
  id: string;
  name: string;
  clan: ClanId;
  /** The upgrade this makes available at the Shipyard. */
  unlocks: string;
  blurb: string;
  cost: number;
  days: number;
  needs: readonly Requirement[];
}

export const RESEARCH: readonly ResearchProject[] = [
  {
    id: "fold-harmonics",
    name: "Fold harmonics",
    clan: "helm",
    unlocks: "driveCoil2",
    blurb: "Helm's navigators think the Archive's fold equations have a second resonance. Proving it takes plicite to burn and star charts from far afield.",
    cost: 15_000,
    days: 30,
    needs: [
      { kind: "cargo", commodity: "plicite", tonnes: 8 },
      { kind: "systems", count: 6 },
    ],
  },
  {
    id: "plicite-bits",
    name: "Plicite-bit metallurgy",
    clan: "diggers",
    unlocks: "coreDrill",
    blurb: "A drill bit with a plicite lattice in the cutting face, if the Diggers can learn to sinter it without it folding itself into dust.",
    cost: 12_000,
    days: 21,
    needs: [
      { kind: "cargo", commodity: "titanium", tonnes: 25 },
      { kind: "cargo", commodity: "plicite", tonnes: 4 },
    ],
  },
  {
    id: "crust-acoustics",
    name: "Crust acoustics",
    clan: "helm",
    unlocks: "surveyArray2",
    blurb: "Sounding a world's crust from orbit means knowing how a dozen kinds of crust ring. Helm needs survey data, lots of it.",
    cost: 10_000,
    days: 21,
    needs: [{ kind: "surveys", count: 10 }],
  },
  {
    id: "long-baseline",
    name: "Long-baseline interferometry",
    clan: "lyceum",
    unlocks: "longBaselineArray",
    blurb: "Stretch a deep-field array's eye across a kilometre of boom and it sees five light-years out. The Lyceum needs charts from many stars to calibrate it, and xenon for the thrusters that hold the booms true.",
    cost: 15_000,
    days: 28,
    needs: [
      { kind: "systems", count: 20 },
      { kind: "cargo", commodity: "xenon", tonnes: 2 },
    ],
  },
  {
    id: "deep-atmosphere",
    name: "Deep-atmosphere modelling",
    clan: "lyceum",
    unlocks: "probeBay2",
    blurb: "Before the Lyceum will rate a probe for the abyss, it wants real readings from the deep layers of more than one giant.",
    cost: 12_000,
    days: 28,
    needs: [
      { kind: "readings", depth: 3, count: 2 },
      { kind: "cargo", commodity: "helium3", tonnes: 1 },
    ],
  },
  {
    id: "pod-frames",
    name: "Modular pod frames",
    clan: "exchange",
    unlocks: "expandedHold2",
    blurb: "Bolt-on cargo pods need a frame light enough to fold and strong enough to land. The Exchange's yards want the metal up front.",
    cost: 10_000,
    days: 21,
    needs: [
      { kind: "cargo", commodity: "titanium", tonnes: 30 },
      { kind: "cargo", commodity: "copper", tonnes: 30 },
    ],
  },
  {
    id: "compact-fusion",
    name: "Compact fusion cells",
    clan: "midshipmen",
    unlocks: "roverCells2",
    blurb: "A fusion cell small enough for a rover. The Midshipmen have the Archive's drawings; they need fuel to test them on.",
    cost: 12_000,
    days: 28,
    needs: [
      { kind: "cargo", commodity: "uranium", tonnes: 15 },
      { kind: "cargo", commodity: "deuterium", tonnes: 3 },
    ],
  },
  // --- living specimens: hard to get, so the gear is worth it ------------------------------------
  {
    id: "drifter-lift",
    name: "Drifter lift cells",
    clan: "midshipmen",
    unlocks: "liftCells",
    blurb: "Cloud drifters float on a gas their bladders make from nothing much. The Midshipmen want two live ones to learn the trick, and a ship that lands lighter.",
    cost: 8_000,
    days: 28,
    needs: [{ kind: "specimens", species: "cloud drifter", count: 2 }],
  },
  {
    id: "lattice-sleeves",
    name: "Reef-lattice sleeves",
    clan: "diggers",
    unlocks: "latticeSleeves",
    blurb: "Reef lace grows a lattice harder than the bits that cut it. The Diggers think they can grow drill sleeves the same way, given live samples to culture.",
    cost: 10_000,
    days: 28,
    needs: [
      { kind: "specimens", species: "reef lace", count: 3 },
      { kind: "specimens", species: "kelp spire", count: 2 },
    ],
  },
  {
    id: "living-archive",
    name: "The living archive",
    clan: "lyceum",
    unlocks: "fieldXenolab",
    blurb: "The Lyceum wants to culture the rarest things you've found, and teach your crew to keep them alive in the field.",
    cost: 10_000,
    days: 30,
    needs: [{ kind: "specimens", minRarity: 3, count: 4 }],
  },
];

export const RESEARCH_BY_ID: ReadonlyMap<string, ResearchProject> = new Map(RESEARCH.map((p) => [p.id, p]));
/** The project that gates each upgrade. */
export const RESEARCH_FOR_UPGRADE: ReadonlyMap<string, ResearchProject> = new Map(RESEARCH.map((p) => [p.unlocks, p]));

/** How many projects the clans will run for one captain at a time. */
export const MAX_ACTIVE_RESEARCH = 2;
