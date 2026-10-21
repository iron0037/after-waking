/** Everything that can sit in a cargo hold. Prices are Intrepid base prices in credits per tonne. */

export const COMMODITY_IDS = [
  "ironNickel",
  "copper",
  "titanium",
  "rareEarths",
  "uranium",
  "platinum",
  "waterIce",
  "plicite",
] as const;

export type CommodityId = (typeof COMMODITY_IDS)[number];

export interface Commodity {
  id: CommodityId;
  name: string;
  basePrice: number;
  /** Map/UI tint for deposits of this commodity. */
  color: string;
  blurb: string;
}

export const COMMODITIES: Record<CommodityId, Commodity> = {
  ironNickel: {
    id: "ironNickel",
    name: "Iron-nickel ore",
    basePrice: 40,
    color: "#a0715a",
    blurb: "Bulk structural metal. The Intrepid's fabricators eat it by the kiloton.",
  },
  copper: {
    id: "copper",
    name: "Copper ore",
    basePrice: 95,
    color: "#d2804a",
    blurb: "Wiring, motors, heat exchangers. Always in demand, never glamorous.",
  },
  titanium: {
    id: "titanium",
    name: "Titanium ore",
    basePrice: 170,
    color: "#b8c4cc",
    blurb: "Hull plate and pressure vessels. The Midshipmen pay well for clean ore.",
  },
  rareEarths: {
    id: "rareEarths",
    name: "Rare-earth ore",
    basePrice: 430,
    color: "#7fd1a8",
    blurb: "Magnets, lasers, sensor crystals. Scarce aboard and getting scarcer.",
  },
  uranium: {
    id: "uranium",
    name: "Uranium ore",
    basePrice: 680,
    color: "#c8e64a",
    blurb: "Reactor fuel for the Intrepid's aging fission backup plants.",
  },
  platinum: {
    id: "platinum",
    name: "Platinum-group ore",
    basePrice: 1150,
    color: "#e6e1ff",
    blurb: "Catalysts and contacts. A good platinum strike pays for a refit.",
  },
  waterIce: {
    id: "waterIce",
    name: "Water ice",
    basePrice: 22,
    color: "#9fd8ff",
    blurb: "Two million people drink, wash and breathe it. Cheap, but never refused.",
  },
  plicite: {
    id: "plicite",
    name: "Plicite-bearing ore",
    basePrice: 2400,
    color: "#ff5fd2",
    blurb:
      "The crystal that makes folding possible. It behaves almost too neatly, as if its lattice were designed. The Lyceum insists that's just good chemistry.",
  },
};
