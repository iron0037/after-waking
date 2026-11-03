/**
 * Surface creatures (AW-215): unintelligent animals of the land and seas. Collected as specimens like plants
 * (the shared specimen slots; large ones take two). Some flee the rover, some ignore it, some defend their ground,
 * and some hunt it. Badlands worlds (rare, uncharted) are home to apex predators found nowhere else.
 *
 * Map stats:
 * - `speed`: hexes per hour as they roam; in a fight, hexes per 10-minute round is speed / 6.
 * - `sense`: how near the rover must come before they react (flee or hunt), in hexes.
 * - `hp`: how much stunning it takes to bring them down (always taken alive).
 * - `attack`: damage to the vehicle per hit; `danger` (0–3) sets how badly a hit hurts the crew.
 */
import type { Climate, Rarity } from "./catalog";

export type Temperament = "skittish" | "docile" | "territorial" | "hostile";

export interface CreatureEntry {
  id: string;
  name: string;
  climates: readonly Climate[];
  /** Lives in open water: only the boat meets it. */
  aquatic?: boolean;
  /** Found only on Badlands worlds. */
  badlands?: boolean;
  rarity: Rarity;
  temperament: Temperament;
  /** Specimen slots it fills: 1 small, 2 large. */
  size: 1 | 2;
  speed: number;
  sense: number;
  hp: number;
  attack: number;
  danger: 0 | 1 | 2 | 3;
  /** Lyceum price multiplier over a plant specimen. */
  priceMult: number;
  color: string;
  blurb: string;
}

export const CREATURES: readonly CreatureEntry[] = [
  // --- cold -------------------------------------------------------------------------------------
  { id: "frost-burrower", name: "frost burrower", climates: ["cold"], rarity: 1, temperament: "docile", size: 1, speed: 2, sense: 2, hp: 8, attack: 0, danger: 0, priceMult: 1.5, color: "#cfe6f2", blurb: "A fat, furred digger that tunnels under the frost and surfaces to sun itself. Utterly unbothered by rovers." },
  { id: "snowshell", name: "snowshell", climates: ["cold"], rarity: 1, temperament: "docile", size: 2, speed: 1.5, sense: 2, hp: 22, attack: 0, danger: 0, priceMult: 2, color: "#e8edf0", blurb: "A slow, domed grazer the size of a cargo pod. It pulls into its shell and waits out anything, including you." },
  { id: "rime-skitter", name: "rime skitter", climates: ["cold"], rarity: 2, temperament: "skittish", size: 1, speed: 7, sense: 5, hp: 6, attack: 0, danger: 0, priceMult: 2.5, color: "#9fd8ef", blurb: "Six thin legs and a glassy shell. It hears a rover's motors a long way off and is gone before you see it." },
  { id: "ice-prowler", name: "ice prowler", climates: ["cold"], rarity: 2, temperament: "hostile", size: 2, speed: 5, sense: 6, hp: 30, attack: 9, danger: 2, priceMult: 4, color: "#b8c7d6", blurb: "A pale, long-limbed hunter that stalks anything warm. Rover hulls run warm." },
  { id: "aurora-wisp", name: "aurora wisp", climates: ["cold"], rarity: 3, temperament: "skittish", size: 1, speed: 8, sense: 6, hp: 4, attack: 0, danger: 0, priceMult: 5, color: "#8affc8", blurb: "A drifting, glowing membrane that rides the polar winds. Catching one is a story crews tell for years." },
  // --- temperate ----------------------------------------------------------------------------------
  { id: "glimmerhare", name: "glimmerhare", climates: ["temperate"], rarity: 1, temperament: "skittish", size: 1, speed: 7, sense: 4, hp: 5, attack: 0, danger: 0, priceMult: 1.5, color: "#e6d27a", blurb: "Long-eared and iridescent, it bolts at the first motor whine. The Meadow's scouts called them 'gone-hares'." },
  { id: "bramble-grazer", name: "bramble grazer", climates: ["temperate"], rarity: 1, temperament: "docile", size: 2, speed: 2, sense: 2, hp: 20, attack: 0, danger: 0, priceMult: 1.8, color: "#8aa65a", blurb: "A hulking, placid browser with a back like a hedge. It will happily eat the rover's paint." },
  { id: "pod-hopper", name: "pod hopper", climates: ["temperate", "warm"], rarity: 1, temperament: "skittish", size: 1, speed: 6, sense: 3, hp: 5, attack: 0, danger: 0, priceMult: 1.4, color: "#b5d36b", blurb: "Springs about on one powerful leg, scattering seed pods it carries in a throat sac." },
  { id: "thornjaw", name: "thornjaw", climates: ["temperate"], rarity: 2, temperament: "territorial", size: 1, speed: 4, sense: 2, hp: 16, attack: 6, danger: 1, priceMult: 2.5, color: "#a5763f", blurb: "Leaves you alone until you park on its patch. Then it tries to chew through a tyre." },
  { id: "chime-moth", name: "chime moth", climates: ["temperate", "cold"], rarity: 2, temperament: "skittish", size: 1, speed: 6, sense: 4, hp: 3, attack: 0, danger: 0, priceMult: 2.2, color: "#d8c8f0", blurb: "Wings like thin glass that ring as they beat. A swarm sounds like distant bells." },
  { id: "ridgeback-stalker", name: "ridgeback stalker", climates: ["temperate", "warm"], rarity: 2, temperament: "hostile", size: 2, speed: 5, sense: 6, hp: 32, attack: 10, danger: 2, priceMult: 4, color: "#6e5a44", blurb: "A low, plated predator that follows rover tracks for days. The Lyceum wants one badly; the crews would rather it didn't." },
  { id: "veil-strider", name: "veil strider", climates: ["temperate"], rarity: 3, temperament: "skittish", size: 2, speed: 8, sense: 7, hp: 10, attack: 0, danger: 0, priceMult: 6, color: "#f0f4ff", blurb: "Stilt-legged and nearly transparent. You see the grass bend before you see the animal." },
  // --- warm ---------------------------------------------------------------------------------------
  { id: "dune-skimmer", name: "dune skimmer", climates: ["warm"], rarity: 1, temperament: "skittish", size: 1, speed: 7, sense: 4, hp: 5, attack: 0, danger: 0, priceMult: 1.5, color: "#e3b878", blurb: "Flat as a plate, it surfs the sand on a cushion of its own breath." },
  { id: "sunback-lumberer", name: "sunback lumberer", climates: ["warm"], rarity: 1, temperament: "docile", size: 2, speed: 1.5, sense: 2, hp: 24, attack: 0, danger: 0, priceMult: 1.8, color: "#c98f3c", blurb: "A slow giant that wears a sail of skin on its back, angled always to the sun." },
  { id: "cinder-swarm", name: "cinder swarm", climates: ["warm"], rarity: 1, temperament: "hostile", size: 1, speed: 6, sense: 4, hp: 10, attack: 5, danger: 1, priceMult: 2, color: "#e0603a", blurb: "A boiling cloud of biting beetles that shares one appetite. Stunned, it settles into a single sleepy heap." },
  { id: "glass-scorpid", name: "glass scorpid", climates: ["warm"], rarity: 2, temperament: "territorial", size: 1, speed: 4, sense: 2, hp: 18, attack: 8, danger: 2, priceMult: 3, color: "#d6e6e0", blurb: "A clear-shelled ambusher that buries itself in the sand by a rover's likely path." },
  { id: "mirage-stilt", name: "mirage stilt", climates: ["warm"], rarity: 2, temperament: "skittish", size: 2, speed: 7, sense: 6, hp: 9, attack: 0, danger: 0, priceMult: 3, color: "#f2d6a2", blurb: "So tall and thin it shimmers in the heat haze. The crew argued for an hour about whether it was real." },
  { id: "dust-drake", name: "dust drake", climates: ["warm"], rarity: 3, temperament: "hostile", size: 2, speed: 6, sense: 7, hp: 45, attack: 13, danger: 3, priceMult: 7, color: "#a4573a", blurb: "A long, armoured hunter that rides in on the dust storms. Whole crews have been rescued from its territory." },
  // --- the seas (boat only) --------------------------------------------------------------------------
  { id: "lantern-eel", name: "lantern eel", climates: ["temperate", "warm"], aquatic: true, rarity: 1, temperament: "docile", size: 1, speed: 3, sense: 2, hp: 8, attack: 0, danger: 0, priceMult: 1.6, color: "#7fe0d0", blurb: "A slow, glowing eel that coils around the boat's lights at night." },
  { id: "glassfin-shoal", name: "glassfin shoal", climates: ["temperate", "warm", "cold"], aquatic: true, rarity: 1, temperament: "skittish", size: 1, speed: 7, sense: 4, hp: 5, attack: 0, danger: 0, priceMult: 1.5, color: "#bfe8ff", blurb: "Hundreds of clear fish that turn as one. Net one and you have them all." },
  { id: "reef-roller", name: "reef roller", climates: ["warm"], aquatic: true, rarity: 2, temperament: "docile", size: 2, speed: 2, sense: 2, hp: 20, attack: 0, danger: 0, priceMult: 2.5, color: "#e09a7a", blurb: "A spined ball the size of the boat that rolls along the shallows grazing the reefs." },
  { id: "maw-ray", name: "maw ray", climates: ["temperate", "warm"], aquatic: true, rarity: 2, temperament: "hostile", size: 2, speed: 6, sense: 5, hp: 28, attack: 10, danger: 2, priceMult: 4, color: "#4a6f86", blurb: "A broad, dark ray that rises under anything that floats and bites." },
  { id: "deepmaw", name: "deepmaw", climates: ["temperate", "cold"], aquatic: true, rarity: 3, temperament: "hostile", size: 2, speed: 5, sense: 6, hp: 50, attack: 14, danger: 3, priceMult: 7, color: "#2f3f5a", blurb: "Something big in the deep water. The sonar shows it circling, then the sonar shows nothing." },
  // --- Badlands (apex predators, nowhere else) --------------------------------------------------------
  { id: "shriek-pack", name: "shriek pack", climates: ["cold", "temperate", "warm"], badlands: true, rarity: 1, temperament: "hostile", size: 1, speed: 7, sense: 7, hp: 14, attack: 7, danger: 2, priceMult: 3, color: "#c24a5a", blurb: "Lean, fast pack hunters that scream to drive prey toward the rest of the pack." },
  { id: "blight-mantis", name: "blight mantis", climates: ["temperate", "warm"], badlands: true, rarity: 2, temperament: "hostile", size: 2, speed: 6, sense: 6, hp: 38, attack: 12, danger: 3, priceMult: 6, color: "#7a9a3a", blurb: "A towering ambusher whose forelimbs open rover plating like a ration tin." },
  { id: "razorback-ravager", name: "razorback ravager", climates: ["cold", "temperate", "warm"], badlands: true, rarity: 2, temperament: "hostile", size: 2, speed: 5, sense: 7, hp: 48, attack: 14, danger: 3, priceMult: 7, color: "#5a4a5e", blurb: "Bone plates, a ridge of blades and no fear at all. It charges vehicles on sight." },
  { id: "hollow-king", name: "hollow king", climates: ["cold", "temperate", "warm"], badlands: true, rarity: 3, temperament: "hostile", size: 2, speed: 6, sense: 8, hp: 70, attack: 18, danger: 3, priceMult: 12, color: "#2b2235", blurb: "The apex of its world. Everything else there is shaped by running from it. The Lyceum has never had one alive." },
];

export const CREATURES_BY_ID: ReadonlyMap<string, CreatureEntry> = new Map(CREATURES.map((c) => [c.id, c]));
export const CREATURES_BY_NAME: ReadonlyMap<string, CreatureEntry> = new Map(CREATURES.map((c) => [c.name, c]));
