/**
 * Exotic seas (AW-189, world generation 3): oceans that aren't water. Each kind follows from a
 * world's temperature, pressure and air (src/sim/bodies.ts, exoticSea); this file says what they're
 * called, how they look, what the boat needs to sail them, and what can be dredged from them.
 */
import type { CommodityId } from "./commodities";

export type SeaKind = "ammonia" | "methane" | "acid" | "nitrogen";

export interface SeaInfo {
  /** "liquid methane" */
  liquid: string;
  /** For the surface map's liquid tint. */
  color: string;
  /** What the boat needs, if anything: a ShipStats flag and the gear that sets it. */
  boatNeeds: { flag: "boatCryo" | "boatAcidProof" | "boatCryoDeep"; gear: string; why: string } | null;
  /** What the boat dredges from the seabed here, with relative weights. */
  dredge: [CommodityId, number][];
  /** One line for the world's description. */
  note: string;
}

export const SEAS: Record<SeaKind, SeaInfo> = {
  ammonia: {
    liquid: "liquid ammonia",
    color: "#9fae7a",
    boatNeeds: null,
    dredge: [
      ["ammonia", 3],
      ["waterIce", 1],
    ],
    note: "Seas of liquid ammonia, cold and pungent. The survey boat sails them as it is.",
  },
  methane: {
    liquid: "liquid methane",
    color: "#3b3326",
    boatNeeds: {
      flag: "boatCryo",
      gear: "cryo floats",
      why: "Liquid methane is too thin to float the boat and cold enough to freeze its drive. It needs cryo floats.",
    },
    dredge: [
      ["methane", 3],
      ["waterIce", 1],
    ],
    note: "Dark, still seas of liquid methane and ethane under an orange sky. The boat needs cryo floats.",
  },
  nitrogen: {
    liquid: "liquid nitrogen",
    color: "#a8c6d4",
    boatNeeds: {
      flag: "boatCryoDeep",
      gear: "cryo floats Mk II",
      why: "Liquid nitrogen at −200 °C would crack the cryo floats' foam and freeze the drive solid. It needs cryo floats Mk II.",
    },
    dredge: [
      ["waterIce", 2],
      ["deuterium", 0.6],
    ],
    note: "Clear, still seas of liquid nitrogen, close to freezing. The ice under them is rich in deuterium. The boat needs cryo floats Mk II.",
  },
  acid: {
    liquid: "sulfuric acid",
    color: "#c9c25a",
    boatNeeds: {
      flag: "boatAcidProof",
      gear: "an acid-lined hull",
      why: "Sulfuric acid would eat through the boat's hull in an hour. It needs an acid-lined hull.",
    },
    dredge: [
      ["copper", 2],
      ["rareEarths", 1.5],
      ["platinum", 0.4],
    ],
    note: "Hot seas of sulfuric acid, thick with dissolved metals. The boat needs an acid-lined hull.",
  },
};
