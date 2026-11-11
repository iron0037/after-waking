/**
 * Ship classes (AW-103). Each clan builds one hull; the starter third-rate freighter is the baseline.
 * A hull sets the ship's base stats, the gear it comes with (built-in), and which gear it can take.
 */
import { BASE_STATS, type ClanId, type ShipStats } from "./ship";

export type HullId = "freighter" | "firstRate" | "bulker" | "scout" | "listener" | "corsair" | "destroyer" | "merchantman";

export interface Hull {
  id: HullId;
  /** The class name, as the yard lists it. */
  name: string;
  /** Who builds it; null for the starter freighter, which nobody sells new. */
  vendor: ClanId | null;
  /** New price; what the starter freighter counts as when you sell it. */
  price: number;
  /** One line for the yard card. */
  blurb: string;
  /** Strengths and weaknesses, short, for the card's tags. */
  pros: string[];
  cons: string[];
  /** Sets the hull's base stats on top of the starter freighter's. */
  base: (s: ShipStats) => void;
  /** Gear that comes fitted: counts as installed (for "requires") but costs no upkeep and can't be removed. */
  builtIn: string[];
  /** Gear this hull can't take (the reason is in `cannotFitWhy`). */
  cannotFit: string[];
  cannotFitWhy?: string;
  /** Default names for new ships of this class, in order. */
  names: string[];
}

export const HULLS: readonly Hull[] = [
  {
    id: "freighter",
    name: "Third-rate freighter",
    vendor: null,
    price: 60_000,
    blurb: "The Intrepid's workhorse: a little of everything, and room to grow only so far.",
    pros: ["Takes every Mk I fitting"],
    cons: ["No room for the top tier of most gear"],
    base: () => {},
    builtIn: [],
    cannotFit: [],
    names: ["Second Wind"],
  },
  {
    id: "firstRate",
    name: "First-rate freighter",
    vendor: "helm",
    price: 120_000,
    blurb: "Helm's own design: the freighter done properly. Same tonnage, better drive, sturdier legs.",
    pros: ["Faster cruise", "Fold 10 ly", "Better landing ratings", "Takes most top-tier gear"],
    cons: [],
    base: (s) => {
      s.cargoCapacityT = 220;
      s.fuelCapacity = 75;
      s.foldRangeLy = 10;
      s.cruiseSpeedC = 0.32;
      s.combatHull = 110;
      s.combatSpeed = 1.1;
      s.ratings.maxGravityG = 1.5;
      s.ratings.maxPressureAtm = 4;
    },
    builtIn: [],
    cannotFit: [],
    names: ["Fair Passage", "Long Watch", "Steady Hand"],
  },
  {
    id: "bulker",
    name: "Bulker",
    vendor: "diggers",
    price: 180_000,
    blurb: "A Diggers mining tender: a flying ore bin with legs that set it down on worlds nobody else will touch.",
    pros: ["500 t hold", "Lands on heavy, high-pressure worlds", "Corrosion-proofed", "Faster drilling", "Takes the core drill"],
    cons: ["Slow", "Heavy: every fold and landing burns more", "Light guns, slow in a fight"],
    base: (s) => {
      s.hullMassT = 2930; // 3,000 t with its corrosion lining
      s.cargoCapacityT = 500;
      s.fuelCapacity = 100;
      s.cruiseSpeedC = 0.18;
      s.drillRateTph = 1.5;
      s.combatHull = 160;
      s.laserDmg = 4;
      s.combatSpeed = 0.8;
      s.surfaceBurnMult = 0.85;
      s.ratings.maxGravityG = 2.2;
      s.ratings.maxPressureAtm = 15;
    },
    builtIn: ["corrosionHull"],
    cannotFit: [],
    names: ["Deep Pocket", "Stonebelly", "Heavy Heart"],
  },
  {
    id: "scout",
    name: "Scout",
    vendor: "lyceum",
    price: 150_000,
    blurb: "The Lyceum's survey ship: big tanks, a long drive and good eyes, built to go far and bring back specimens.",
    pros: ["Fold 13 ly", "110 fuel on a light hull", "Fastest cruise", "Survey array fitted", "28 specimen racks"],
    cons: ["80 t hold", "Thin hull, light guns"],
    base: (s) => {
      s.hullMassT = 1100;
      s.cargoCapacityT = 80;
      s.fuelCapacity = 110;
      s.foldRangeLy = 13;
      s.cruiseSpeedC = 0.4;
      s.combatHull = 60;
      s.laserDmg = 4;
      s.combatSpeed = 1.3;
      s.shipRackBonus = 12;
    },
    builtIn: ["surveyArray"],
    cannotFit: ["expandedHold", "expandedHold2", "driveCoil2"],
    cannotFitWhy: "No room in a scout's frame",
    names: ["Far Look", "Wayfinder", "Quiet Margin"],
  },
  {
    id: "listener",
    name: "Listener",
    vendor: "covenant",
    price: 170_000,
    blurb: "Hand-built by the Covenant with nothing Archive-designed aboard. It runs quiet, folds well into the dark, and hears everything.",
    pros: ["Raiders seldom see it first", "Blind folds at 90% range, no extra fuel", "Deep-field array fitted", "Catches seams in the world"],
    cons: ["140 t hold", "Light guns"],
    base: (s) => {
      s.hullMassT = 1390; // 1,400 t with its deep-field array
      s.cargoCapacityT = 140;
      s.fuelCapacity = 80;
      s.foldRangeLy = 9;
      s.cruiseSpeedC = 0.28;
      s.combatHull = 80;
      s.laserDmg = 4;
      s.combatSpeed = 1.05;
      s.spotBonus = 0.25;
      s.raidChanceMult = 0.7;
      s.blindFoldRange = 0.9;
      s.blindFoldFuel = 1;
      s.seamSense = 0.15;
    },
    builtIn: ["deepFieldArray"],
    cannotFit: [],
    names: ["Small Hours", "Still Water", "Open Ear"],
  },
  {
    id: "corsair",
    name: "Corsair",
    vendor: "freebooters",
    price: 200_000,
    blurb: "Built in the pirate dens from salvaged prizes, and sold nowhere else. Raiders take it for one of their own; Helm notices whenever you dock.",
    pros: ["Raiders come for you less often", "Fold 10 ly, quick cruise", "Real guns, quick in a fight", "One quirk from its last owner"],
    cons: ["Helm's opinion of you slips each time you dock", "180 t hold"],
    base: (s) => {
      s.cargoCapacityT = 180;
      s.fuelCapacity = 70;
      s.foldRangeLy = 10;
      s.cruiseSpeedC = 0.35;
      s.combatHull = 160;
      s.laserDmg = 14;
      s.shieldStrength = 6;
      s.combatSpeed = 1.15;
      s.raidChanceMult = 0.6;
      s.ratings.maxGravityG = 1.4;
    },
    builtIn: [],
    cannotFit: [],
    names: ["No Questions", "Borrowed Time", "Fair Game"],
  },
  {
    id: "destroyer",
    name: "Destroyer",
    vendor: "midshipmen",
    price: 260_000,
    blurb: "A Midshipmen warship: heavy batteries, shields and the speed to choose its fights. Not much room for anything else.",
    pros: ["220 hull, laser 18, kinetic 20, shields 10", "Fastest in a fight", "Fold 10 ly, fast cruise"],
    cons: ["100 t hold", "8 specimen racks"],
    base: (s) => {
      s.hullMassT = 1600;
      s.cargoCapacityT = 100;
      s.fuelCapacity = 70;
      s.foldRangeLy = 10;
      s.cruiseSpeedC = 0.4;
      s.combatHull = 220;
      s.laserDmg = 18;
      s.kineticDmg = 20;
      s.shieldStrength = 10;
      s.combatSpeed = 1.3;
      s.shipRackBonus = -8;
    },
    builtIn: [],
    cannotFit: [],
    names: ["Resolute", "Vigil", "Hard Line"],
  },
  {
    id: "merchantman",
    name: "Merchantman",
    vendor: "exchange",
    price: 400_000,
    blurb: "The Exchange's armed hauler: the biggest hold in the fleet and the guns to keep it. Too big to set down anywhere rough.",
    pros: ["650 t hold", "260 hull, laser 12, kinetic 12, shields 14", "Takes the hold Mk II and kinetic batteries"],
    cons: ["Lands only on gentle worlds (1 g, 2 atm)", "Slow, and heavy to fold"],
    base: (s) => {
      s.hullMassT = 3400;
      s.cargoCapacityT = 650;
      s.fuelCapacity = 110;
      s.cruiseSpeedC = 0.2;
      s.combatHull = 260;
      s.laserDmg = 12;
      s.kineticDmg = 12;
      s.shieldStrength = 14;
      s.combatSpeed = 0.85;
      s.ratings.maxGravityG = 1;
      s.ratings.maxPressureAtm = 2;
    },
    builtIn: [],
    cannotFit: ["landingStruts", "pressureHull2", "pressureHull3"],
    cannotFitWhy: "Too big to set down on a rough world",
    names: ["Full Measure", "Good Credit", "Plenty"],
  },
];

export const HULLS_BY_ID: ReadonlyMap<HullId, Hull> = new Map(HULLS.map((h) => [h.id, h]));

/** Top-tier gear the starter freighter has no room for: only these hulls can take it. */
export const HULL_ONLY: Readonly<Record<string, readonly HullId[]>> = {
  expandedHold2: ["firstRate", "bulker", "merchantman"],
  coreDrill: ["bulker"],
  pressureHull3: ["firstRate", "bulker"],
  driveCoil2: ["firstRate", "listener", "corsair", "destroyer"],
  surveyArray2: ["firstRate", "scout", "listener"],
  longBaselineArray: ["scout", "listener"],
  probeBay2: ["scout"],
  kineticBattery: ["corsair", "destroyer", "merchantman"],
};

/** The standing a clan wants before it sells you one of its ships. */
export const HULL_STANDING = "friendly";

/** A berthed ship sells back for this share of what its hull and fitted gear cost. */
export const HULL_RESALE = 0.5;

/** A day to shift the crew, the rover and the boat across. */
export const SWAP_MINUTES = 12 * 60;

/** The secondhand corsair's history (AW-103): one quirk, rolled when you buy it. */
export interface Quirk {
  id: string;
  name: string;
  good: boolean;
  text: string;
  apply: (s: ShipStats) => void;
}

export const QUIRKS: readonly Quirk[] = [
  { id: "tuned-drive", name: "Tuned drive", good: true, text: "The last owner had the fold drive tuned past spec: +1 ly.", apply: (s) => void (s.foldRangeLy += 1) },
  { id: "false-bulkheads", name: "False bulkheads", good: true, text: "Smuggling space behind the bulkheads: +40 t of hold.", apply: (s) => void (s.cargoCapacityT += 40) },
  { id: "hot-guns", name: "Hot guns", good: true, text: "The lasers were bored out: +3 damage a hit.", apply: (s) => void (s.laserDmg += 3) },
  { id: "leaky-tanks", name: "Leaky tanks", good: false, text: "Patched tanks that never quite seal: 12 less fuel.", apply: (s) => void (s.fuelCapacity -= 12) },
  { id: "patched-hull", name: "Patched hull", good: false, text: "Old battle damage under the paint: 30 less hull.", apply: (s) => void (s.combatHull -= 30) },
  { id: "known-silhouette", name: "Known silhouette", good: false, text: "Raiders know this ship, and not fondly: they come for it as often as for anyone.", apply: (s) => void (s.raidChanceMult = 1) },
];

export const QUIRKS_BY_ID: ReadonlyMap<string, Quirk> = new Map(QUIRKS.map((q) => [q.id, q]));

/** Stats of a bare hull (no fitted gear beyond what it's built with is applied here). */
export function hullBase(id: HullId): ShipStats {
  const s = structuredClone(BASE_STATS);
  HULLS_BY_ID.get(id)?.base(s);
  return s;
}
