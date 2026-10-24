/** Everything that can sit in a cargo hold. Prices are Intrepid base prices in credits per tonne. */

/** Mined from deposits. World generation draws only from these, so adding goods never reshuffles worlds. */
export const ORE_IDS = ["ironNickel", "copper", "titanium", "rareEarths", "uranium", "platinum", "waterIce", "plicite"] as const;

/** Skimmed from giant planets' atmospheres by probes (AW-16). Thin markets: a few tonnes move the price. */
export const GAS_IDS = ["methane", "deuterium", "xenon", "helium3"] as const;

export const COMMODITY_IDS = [...ORE_IDS, ...GAS_IDS] as const;

export type OreId = (typeof ORE_IDS)[number];
export type GasId = (typeof GAS_IDS)[number];

export type CommodityId = (typeof COMMODITY_IDS)[number];

export interface Commodity {
  id: CommodityId;
  name: string;
  basePrice: number;
  /** Tonnes the Intrepid can absorb before the price halves; recovers ~3% a day. */
  marketDepthT: number;
  /** Map/UI tint for deposits of this commodity. */
  color: string;
  blurb: string;
}

export const COMMODITIES: Record<CommodityId, Commodity> = {
  ironNickel: {
    id: "ironNickel",
    name: "Iron-nickel ore",
    basePrice: 15,
    marketDepthT: 3000,
    color: "#a0715a",
    blurb: "Bulk structural metal. The Intrepid's fabricators eat it by the kiloton.",
  },
  copper: {
    id: "copper",
    name: "Copper ore",
    basePrice: 36,
    marketDepthT: 1080,
    color: "#d2804a",
    blurb: "Wiring, motors, heat exchangers. Always in demand, never glamorous.",
  },
  titanium: {
    id: "titanium",
    name: "Titanium ore",
    basePrice: 64,
    marketDepthT: 720,
    color: "#b8c4cc",
    blurb: "Hull plate and pressure vessels. The Midshipmen pay well for clean ore.",
  },
  rareEarths: {
    id: "rareEarths",
    name: "Rare-earth ore",
    basePrice: 161,
    marketDepthT: 180,
    color: "#7fd1a8",
    blurb: "Magnets, lasers, sensor crystals. Scarce aboard and getting scarcer.",
  },
  uranium: {
    id: "uranium",
    name: "Uranium ore",
    basePrice: 253,
    marketDepthT: 132,
    color: "#c8e64a",
    blurb: "Reactor fuel for the Intrepid's aging fission backup plants.",
  },
  platinum: {
    id: "platinum",
    name: "Platinum-group ore",
    basePrice: 431,
    marketDepthT: 43,
    color: "#e6e1ff",
    blurb: "Catalysts and contacts. A good platinum strike pays for a refit.",
  },
  waterIce: {
    id: "waterIce",
    name: "Water ice",
    basePrice: 8,
    marketDepthT: 4800,
    color: "#9fd8ff",
    blurb: "Two million people drink, wash and breathe it. Cheap, but never refused.",
  },
  plicite: {
    id: "plicite",
    name: "Plicite-bearing ore",
    basePrice: 900,
    marketDepthT: 360,
    color: "#ff5fd2",
    blurb:
      "The crystal that makes folding possible. It behaves almost too neatly, as if its lattice were designed. The Lyceum insists that's just good chemistry.",
  },
  methane: {
    id: "methane",
    name: "Methane",
    basePrice: 20,
    marketDepthT: 200,
    color: "#7fb8a0",
    blurb: "Feedstock for the Intrepid's plastics and chemical plants. Ice giants are full of it.",
  },
  deuterium: {
    id: "deuterium",
    name: "Deuterium",
    basePrice: 500,
    marketDepthT: 20,
    color: "#8fb0ff",
    blurb: "Heavy hydrogen for the fusion trials the Lyceum keeps promising will work this time.",
  },
  xenon: {
    id: "xenon",
    name: "Xenon",
    basePrice: 800,
    marketDepthT: 12,
    color: "#c9a0ff",
    blurb: "Ion-drive propellant and anaesthetic. The Medics and the Midshipmen bid against each other for it.",
  },
  helium3: {
    id: "helium3",
    name: "Helium-3",
    basePrice: 2_500,
    marketDepthT: 6,
    color: "#ffe08a",
    blurb: "The fusion fuel of the future, always. Found deep in gas giants, where probes go to die.",
  },
};
