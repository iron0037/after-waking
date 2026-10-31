/**
 * The compendium's database: every collectible in the game, so completionists can see how much
 * of the Verge they've catalogued. Living worlds draw their flora from FLORA by climate;
 * drilling sometimes turns up a MINERAL_SPECIMENS find from the ore being worked.
 *
 * Each entry will get its own pixel sprite (tools/art); until then `color` stands in.
 */
import type { SeaKind } from "./seas";
import type { CommodityId } from "./commodities";

export type Climate = "cold" | "temperate" | "warm";
/** 1 common · 2 uncommon · 3 rare */
export type Rarity = 1 | 2 | 3;

export interface FloraEntry {
  id: string;
  name: string;
  climates: readonly Climate[];
  rarity: Rarity;
  color: string;
  blurb: string;
  /** Drifts in a giant's atmosphere; only probes find it (never on a surface, so climates is empty). */
  floating?: boolean;
  /** Specimen price multiplier at the Lyceum (floating life is rare and prized). */
  priceMult?: number;
  /** Lives in open water; only the boat can sample it (AW-17). */
  aquatic?: boolean;
  /** Lives only in these exotic seas (AW-189), not in water. */
  seas?: readonly SeaKind[];
}

export interface MineralSpecimen {
  id: string;
  name: string;
  host: CommodityId;
  rarity: Rarity;
  color: string;
  blurb: string;
}

export const FLORA: readonly FloraEntry[] = [
  // --- cold ---------------------------------------------------------------------------------
  { id: "frost-lantern", name: "frost lantern", climates: ["cold"], rarity: 1, color: "#9fe7ff", blurb: "Glowing bulbs that grow beneath clear ice, lighting their own small caverns." },
  { id: "glass-reed", name: "glass reed", climates: ["cold", "temperate"], rarity: 1, color: "#d8f3ff", blurb: "Silica-walled stalks that ring like chimes when the wind moves them." },
  { id: "snowcap-lichen", name: "snowcap lichen", climates: ["cold"], rarity: 1, color: "#e9eef2", blurb: "Crusts the color of old snow. It grows a millimetre a decade and has all the time in the world." },
  { id: "needle-moss", name: "needle moss", climates: ["cold"], rarity: 1, color: "#7fb59a", blurb: "Stiff, frost-hardened tufts that puncture careless glove seams." },
  { id: "rime-fern", name: "rime fern", climates: ["cold"], rarity: 2, color: "#b4d6e6", blurb: "Its fronds collect frost in perfect geometric patterns, then drink it at noon." },
  { id: "pale-crawler", name: "pale crawler", climates: ["cold", "temperate"], rarity: 2, color: "#cfd8c8", blurb: "A creeping mat that edges toward warmth. Slowly, but measurably." },
  { id: "ghost-frond", name: "ghost frond", climates: ["cold"], rarity: 2, color: "#e6f0ff", blurb: "Almost perfectly transparent. Crews find it by touch more often than sight." },
  { id: "aurora-tuft", name: "aurora tuft", climates: ["cold"], rarity: 3, color: "#8affc8", blurb: "Flares green and violet during radiation storms. Nobody knows what it gains from it." },
  { id: "vent-wort", name: "vent wort", climates: ["cold"], rarity: 3, color: "#d79a6a", blurb: "Grows only around warm seeps in the ice, feeding on chemistry rather than light." },
  // --- temperate -----------------------------------------------------------------------------
  { id: "bellwort", name: "bellwort", climates: ["temperate"], rarity: 1, color: "#b7d36b", blurb: "Hanging cups that fill with dew. The Meadow's first scouts drank from them, against regulations." },
  { id: "velvet-frond", name: "velvet frond", climates: ["temperate"], rarity: 1, color: "#5f9e57", blurb: "Soft as cloth, and the crews have tried to weave it. It doesn't take a dye." },
  { id: "spiral-vine", name: "spiral vine", climates: ["temperate", "warm"], rarity: 1, color: "#6bb37a", blurb: "Always winds counter-clockwise, on every world it's been found on." },
  { id: "copper-frond", name: "copper frond", climates: ["temperate"], rarity: 1, color: "#c6844c", blurb: "Leaves bronzed with copper salts drawn from the soil. A prospector's signpost." },
  { id: "amber-vine", name: "amber vine", climates: ["temperate"], rarity: 1, color: "#e0a640", blurb: "Weeps a fragrant resin that hardens into amber within hours." },
  { id: "whisper-reed", name: "whisper reed", climates: ["temperate"], rarity: 1, color: "#a9c48a", blurb: "Hollow stems that hum in a breeze. Some crews swear they hear words." },
  { id: "lantern-moss", name: "lantern moss", climates: ["temperate", "cold"], rarity: 1, color: "#b9f08a", blurb: "Glows faintly at night, enough to read a gauge by." },
  { id: "thread-grass", name: "thread grass", climates: ["temperate"], rarity: 1, color: "#9cc06a", blurb: "Blades thin as hair, so dense the rover leaves tracks for a week." },
  { id: "hollow-cap", name: "hollow cap", climates: ["temperate"], rarity: 2, color: "#c9a98a", blurb: "Fungus-like domes, empty inside except for a single seed that rattles." },
  { id: "silver-fern", name: "silver fern", climates: ["temperate"], rarity: 2, color: "#c4d0d4", blurb: "Mirrored undersides that flash in the sun, turning whole hillsides to signals." },
  { id: "drift-pod", name: "drift pod", climates: ["temperate", "warm"], rarity: 2, color: "#e7d3a1", blurb: "Seed pods lifted by little gas bladders. They follow the wind for hundreds of kilometres." },
  { id: "coil-bloom", name: "coil bloom", climates: ["temperate"], rarity: 2, color: "#e58fb4", blurb: "A flower that unrolls like a spring at dawn and snaps shut at dusk." },
  { id: "cradle-tree", name: "cradle tree", climates: ["temperate"], rarity: 3, color: "#7a9e4f", blurb: "A knee-high tree whose branches curl into nests. Something used them once." },
  { id: "song-moss", name: "song moss", climates: ["temperate"], rarity: 3, color: "#8fd1b8", blurb: "Vibrates at a steady 432 hertz. The Covenant has opinions about why." },
  // --- warm ----------------------------------------------------------------------------------
  { id: "ember-cap", name: "ember cap", climates: ["warm"], rarity: 1, color: "#d9663a", blurb: "Red-orange caps that stay warm to the touch long after sunset." },
  { id: "sunscale-lichen", name: "sunscale lichen", climates: ["warm"], rarity: 1, color: "#e8c35a", blurb: "Overlapping scales that tilt to follow the star, like a field of tiny mirrors." },
  { id: "brine-reed", name: "brine reed", climates: ["warm", "temperate"], rarity: 1, color: "#9ab89a", blurb: "Thrives in salt flats, sweating crystals from its stems." },
  { id: "heat-mat", name: "heat mat", climates: ["warm"], rarity: 1, color: "#b0703c", blurb: "A low, leathery carpet that cracks into hexagons in the dry season." },
  { id: "glasswing-bloom", name: "glasswing bloom", climates: ["warm"], rarity: 2, color: "#b4e6f0", blurb: "Petals thin enough to see through, veined like insect wings." },
  { id: "smoke-fern", name: "smoke fern", climates: ["warm"], rarity: 2, color: "#8e8a86", blurb: "Releases a grey haze of spores when disturbed. Seal your suit." },
  { id: "dune-runner", name: "dune runner", climates: ["warm"], rarity: 2, color: "#d4b483", blurb: "A tumbleweed that rolls uphill. The Lyceum has three theories and no proof." },
  { id: "pyre-lily", name: "pyre lily", climates: ["warm"], rarity: 3, color: "#ff7a3d", blurb: "Blooms only after wildfire, from seeds that wait decades for the heat." },
  { id: "mirror-palm", name: "mirror palm", climates: ["warm"], rarity: 3, color: "#d6e2e6", blurb: "Fronds coated in a reflective wax so perfect it looks machined." },
  // --- sea life (open water; the boat samples it) ----------------------------------------------
  { id: "azotosome-drift", name: "azotosome drift", climates: ["cold"], rarity: 3, aquatic: true, seas: ["methane"], priceMult: 2, color: "#d2a86e", blurb: "Cell-like bubbles of nitrogen and hydrocarbon skin, drifting in liquid methane at −180 °C. The Lyceum says it's alive. Nobody is sure what it's alive with." },
  { id: "tholin-mat", name: "tholin mat", climates: ["cold"], rarity: 2, aquatic: true, seas: ["methane"], priceMult: 1.5, color: "#8a5a3c", blurb: "Rust-brown rafts of organic sludge that thicken and thin with the methane tides." },
  { id: "tide-bulb", name: "tide bulb", climates: ["cold", "temperate"], rarity: 1, aquatic: true, color: "#7fc7c0", blurb: "Floating bladders that bob in rafts and sink together at dusk. Nobody has found where they go." },
  { id: "reef-lace", name: "reef lace", climates: ["temperate", "warm"], rarity: 1, aquatic: true, color: "#e3b2c8", blurb: "A brittle mesh that grows on itself in the shallows, one lattice cell a day." },
  { id: "kelp-spire", name: "kelp spire", climates: ["cold", "temperate"], rarity: 2, aquatic: true, color: "#4f8a5e", blurb: "Stalks that rise straight from the seabed to just below the surface, and no higher." },
  { id: "brine-fan", name: "brine fan", climates: ["warm"], rarity: 2, aquatic: true, color: "#d9b25c", blurb: "Gold fans that filter the warm seas and leave a crust of salt where they die." },
  { id: "drift-veil", name: "drift veil", climates: ["temperate", "warm"], rarity: 2, aquatic: true, priceMult: 1.5, color: "#bfe4ff", blurb: "A colony as wide as a boat and as thin as paper, steering with the wind." },
  { id: "abyss-lantern", name: "abyss lantern", climates: ["cold", "temperate", "warm"], rarity: 3, aquatic: true, priceMult: 2, color: "#9effd6", blurb: "Comes up from the deep only at night, glowing, and only near the boat. The Lyceum wants to know why." },
  // --- floating life (giant atmospheres; probes only) ----------------------------------------
  { id: "cloud-drifter", name: "cloud drifter", climates: [], rarity: 2, floating: true, priceMult: 4, color: "#f2e6c8", blurb: "A gas bladder the size of a hand, riding the updrafts and feeding on lightning-made nitrates." },
  { id: "storm-kelp", name: "storm kelp", climates: [], rarity: 2, floating: true, priceMult: 4, color: "#9fc4a8", blurb: "Long ribbons that knot themselves around ice grains and sail the jet streams for years." },
  { id: "lantern-siphon", name: "lantern siphon", climates: [], rarity: 3, floating: true, priceMult: 6, color: "#ffd48a", blurb: "A colony of glowing cells that pumps itself up and down through the decks, chasing warmth." },
  { id: "abyssal-bloom", name: "abyssal bloom", climates: [], rarity: 3, floating: true, priceMult: 8, color: "#c08aff", blurb: "Found only where the pressure should crush anything alive. The Lyceum wants every one you can bring." },
];

export const MINERAL_SPECIMENS: readonly MineralSpecimen[] = [
  { id: "banded-geode", name: "banded iron geode", host: "ironNickel", rarity: 1, color: "#9a5b44", blurb: "Stripes of rust and steel-grey, laid down over ages of ancient seas." },
  { id: "meteoric-lattice", name: "meteoric lattice", host: "ironNickel", rarity: 2, color: "#b7b3ad", blurb: "Iron-nickel etched with crossing crystal bands that only form cooling in space." },
  { id: "copper-dendrite", name: "native copper dendrite", host: "copper", rarity: 1, color: "#d2804a", blurb: "Pure copper grown in fern-like branches through the rock." },
  { id: "malachite-rosette", name: "malachite rosette", host: "copper", rarity: 2, color: "#3fae7a", blurb: "Concentric green rings, polished smooth by groundwater." },
  { id: "rutile-needles", name: "rutile needle crystal", host: "titanium", rarity: 1, color: "#c9874a", blurb: "Golden needles of titanium oxide caught in clear quartz." },
  { id: "star-ilmenite", name: "star ilmenite", host: "titanium", rarity: 3, color: "#5a5e66", blurb: "A black crystal that throws a six-rayed star when you turn it in the light." },
  { id: "monazite-pearl", name: "monazite sand pearl", host: "rareEarths", rarity: 1, color: "#d9b07a", blurb: "Rounded grains of rare-earth phosphate, heavy for their size." },
  { id: "bastnasite-prism", name: "bastnäsite prism", host: "rareEarths", rarity: 2, color: "#e0a87a", blurb: "A honey-coloured prism, glassy and almost too regular." },
  { id: "pitchblende-nodule", name: "pitchblende nodule", host: "uranium", rarity: 1, color: "#3a3a32", blurb: "Black, greasy, heavy, and hot on the dosimeter. Kept in lead." },
  { id: "autunite-plate", name: "autunite glow-plate", host: "uranium", rarity: 3, color: "#c8f04a", blurb: "Thin yellow-green plates that fluoresce under the cabin's UV lamp." },
  { id: "platinum-nugget", name: "platinum nugget", host: "platinum", rarity: 1, color: "#e6e1ff", blurb: "Water-worn and heavy, the kind prospectors on Earth once dreamed about." },
  { id: "iridium-bead", name: "iridium bead", host: "platinum", rarity: 3, color: "#c0c8d8", blurb: "A droplet of iridium, frozen mid-splash by some ancient impact." },
  { id: "blue-ice-core", name: "blue ice core", host: "waterIce", rarity: 1, color: "#6fb8ff", blurb: "Ice so old and compressed it has turned deep blue." },
  { id: "clathrate-bubble", name: "clathrate bubble", host: "waterIce", rarity: 2, color: "#bfe6ff", blurb: "Ice that traps gas in its lattice. It fizzes as it melts." },
  { id: "plicite-geode", name: "plicite geode", host: "plicite", rarity: 2, color: "#ff5fd2", blurb: "A cavity lined with plicite crystals. Every facet sits at the same angle, to six decimal places." },
  { id: "folded-plicite", name: "folded plicite", host: "plicite", rarity: 3, color: "#ff9ff0", blurb: "Its crystal lattice folds back through itself. The Lyceum has no model for it, and has asked you not to mention it." },
];

export function climateOf(tempC: number): Climate {
  return tempC < 0 ? "cold" : tempC > 30 ? "warm" : "temperate";
}

/** Compendium keys: "mineral:copper", "gem:plicite-geode", "flora:glass-reed". */
export type CompendiumKind = "mineral" | "gem" | "flora";

export const FLORA_BY_NAME: ReadonlyMap<string, FloraEntry> = new Map(FLORA.map((f) => [f.name, f]));
