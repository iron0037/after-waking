/** Ship statistics, the starting freighter, and the upgrades sold aboard the Intrepid. */

export type ClanId = "helm" | "midshipmen" | "diggers" | "lyceum" | "exchange" | "covenant" | "freebooters";

export const CLAN_NAMES: Record<ClanId, string> = {
  helm: "Helm",
  midshipmen: "Midshipmen",
  diggers: "Diggers",
  lyceum: "Lyceum",
  exchange: "Exchange",
  covenant: "Covenant",
  freebooters: "Freebooters",
};

/** What a ship can survive on the ground. Compared against a body's environment profile. */
export interface Ratings {
  /** Highest surface gravity the thrusters can lift off from. */
  maxGravityG: number;
  maxPressureAtm: number;
  minTempC: number;
  maxTempC: number;
  corrosionProof: boolean;
  /** 0 (none) to 4 (lethal). */
  maxRadiation: number;
}

export interface ShipStats {
  hullMassT: number;
  cargoCapacityT: number;
  fuelCapacity: number;
  /** Longest single fold the drive can make, in light-years. */
  foldRangeLy: number;
  /** In-system cruise speed as a fraction of c. */
  cruiseSpeedC: number;
  sensorTier: number;
  drillMaxDepthM: number;
  /** Tonnes per hour from a grade-1.0 deposit. */
  drillRateTph: number;
  roverCargoT: number;
  roverEnergy: number;
  roverCanClimb: boolean;
  /** Multiplies the rover's charge rate at the ship. */
  roverChargeMult: number;
  /** Multiplies the time each hex takes the rover (below 1 is faster). */
  roverDriveTime: number;
  /** Atmospheric probes the bay can carry (0 = no bay). */
  probeCapacity: number;
  /** Deepest band the probes are rated for: 0 none, 1 cloud tops ... 4 abyss. */
  probeMaxDepth: number;
  ratings: Ratings;
}

export const BASE_STATS: ShipStats = {
  hullMassT: 1800,
  cargoCapacityT: 200,
  fuelCapacity: 60,
  foldRangeLy: 8,
  cruiseSpeedC: 0.25,
  sensorTier: 1,
  drillMaxDepthM: 250,
  drillRateTph: 1.2,
  roverCargoT: 20,
  roverEnergy: 100,
  roverCanClimb: false,
  roverChargeMult: 1,
  roverDriveTime: 1,
  probeCapacity: 0,
  probeMaxDepth: 0,
  ratings: {
    maxGravityG: 1.3,
    maxPressureAtm: 2.5,
    minTempC: -170,
    maxTempC: 120,
    corrosionProof: false,
    maxRadiation: 2,
  },
};

export type UpgradeEffect = (stats: ShipStats) => void;

export type UpgradeCategory = "ship" | "rover" | "mining" | "sensors";

export const UPGRADE_CATEGORY_NAMES: Record<UpgradeCategory, string> = {
  ship: "Ship",
  rover: "Rover",
  mining: "Mining",
  sensors: "Sensors",
};

export interface Upgrade {
  id: string;
  name: string;
  category: UpgradeCategory;
  /** An upgrade that must be installed first. */
  requires?: string;
  vendor: ClanId;
  price: number;
  description: string;
  apply: UpgradeEffect;
}

export const UPGRADES: readonly Upgrade[] = [
  {
    id: "expandedHold",
    category: "ship",
    name: "Expanded hold",
    vendor: "exchange",
    price: 22_000,
    description: "+100 t cargo capacity. Adds 150 t of hull mass, so folds cost more.",
    apply: (s) => {
      s.cargoCapacityT += 100;
      s.hullMassT += 150;
    },
  },
  {
    id: "expandedHold2",
    category: "ship",
    requires: "expandedHold",
    name: "Cargo pods",
    vendor: "exchange",
    price: 48_000,
    description: "+150 t cargo capacity on top of the expanded hold. Adds 250 t of hull mass, so folds cost noticeably more.",
    apply: (s) => {
      s.cargoCapacityT += 150;
      s.hullMassT += 250;
    },
  },
  {
    id: "auxTanks",
    category: "ship",
    name: "Auxiliary plicite tanks",
    vendor: "midshipmen",
    price: 14_000,
    description: "+40 fuel capacity.",
    apply: (s) => {
      s.fuelCapacity += 40;
      s.hullMassT += 40;
    },
  },
  {
    id: "driveCoil2",
    category: "ship",
    name: "Fold coil Mk II",
    vendor: "midshipmen",
    price: 55_000,
    description: "Maximum fold range 13 ly.",
    apply: (s) => {
      s.foldRangeLy = Math.max(s.foldRangeLy, 13);
    },
  },
  {
    id: "landingStruts",
    category: "ship",
    name: "Heavy struts & lift thrusters",
    vendor: "midshipmen",
    price: 28_000,
    description: "Lift off from worlds up to 1.9 g.",
    apply: (s) => {
      s.ratings.maxGravityG = Math.max(s.ratings.maxGravityG, 1.9);
      s.hullMassT += 60;
    },
  },
  {
    id: "pressureHull2",
    category: "ship",
    name: "Pressure hull Mk II",
    vendor: "midshipmen",
    price: 38_000,
    description: "Land under up to 12 atm, from −200 °C to 260 °C.",
    apply: (s) => {
      s.ratings.maxPressureAtm = Math.max(s.ratings.maxPressureAtm, 12);
      s.ratings.minTempC = Math.min(s.ratings.minTempC, -200);
      s.ratings.maxTempC = Math.max(s.ratings.maxTempC, 260);
      s.hullMassT += 120;
    },
  },
  {
    id: "radShielding",
    category: "ship",
    name: "Radiation baffles",
    vendor: "lyceum",
    price: 18_000,
    description: "Survive surface radiation up to level 3.",
    apply: (s) => {
      s.ratings.maxRadiation = Math.max(s.ratings.maxRadiation, 3);
      s.hullMassT += 50;
    },
  },
  {
    id: "surveyArray",
    category: "sensors",
    name: "Helm survey array",
    vendor: "helm",
    price: 16_000,
    description: "Sensor tier 2: sharper orbital region readings, wider rover detection.",
    apply: (s) => {
      s.sensorTier = Math.max(s.sensorTier, 2);
    },
  },
  {
    id: "deepDrill",
    category: "mining",
    name: "Deep-core drill",
    vendor: "diggers",
    price: 24_000,
    description: "Drill to 700 m at double the extraction rate.",
    apply: (s) => {
      s.drillMaxDepthM = Math.max(s.drillMaxDepthM, 700);
      s.drillRateTph *= 2;
    },
  },
  {
    id: "roverSled",
    category: "rover",
    name: "Rover cargo sled",
    vendor: "diggers",
    price: 6_000,
    description: "+20 t rover cargo.",
    apply: (s) => {
      s.roverCargoT += 20;
    },
  },
  {
    id: "roverFastCharger",
    category: "rover",
    name: "Rover fast charger",
    vendor: "midshipmen",
    price: 9_000,
    description: "A heavy feed from the ship's reactor: the rover charges twice as fast at the ship.",
    apply: (s) => {
      s.roverChargeMult *= 2;
    },
  },
  {
    id: "roverMotors",
    category: "rover",
    name: "Uprated drive motors",
    vendor: "diggers",
    price: 12_000,
    description: "The rover covers ground 25% faster (same energy per hex).",
    apply: (s) => {
      s.roverDriveTime *= 0.75;
    },
  },
  {
    id: "roverCells",
    category: "rover",
    name: "Rover power cells",
    vendor: "diggers",
    price: 5_000,
    description: "+80 rover energy.",
    apply: (s) => {
      s.roverEnergy += 80;
    },
  },
  {
    id: "allTerrain",
    category: "rover",
    name: "All-terrain treads",
    vendor: "diggers",
    price: 8_000,
    description: "The rover can climb mountainous terrain.",
    apply: (s) => {
      s.roverCanClimb = true;
    },
  },
  {
    id: "roverSled2",
    category: "rover",
    requires: "roverSled",
    name: "Heavy cargo trailer",
    vendor: "diggers",
    price: 18_000,
    description: "+40 t rover cargo (on top of the sled).",
    apply: (s) => {
      s.roverCargoT += 40;
    },
  },
  {
    id: "roverCells2",
    category: "rover",
    requires: "roverCells",
    name: "Fusion cell pack",
    vendor: "midshipmen",
    price: 20_000,
    description: "+150 rover energy (on top of the power cells).",
    apply: (s) => {
      s.roverEnergy += 150;
    },
  },
  {
    id: "coreDrill",
    category: "mining",
    requires: "deepDrill",
    name: "Plicite-bit core drill",
    vendor: "diggers",
    price: 48_000,
    description: "Drill to 1,200 m at 1.5x the deep-core rate.",
    apply: (s) => {
      s.drillMaxDepthM = Math.max(s.drillMaxDepthM, 1200);
      s.drillRateTph *= 1.5;
    },
  },
  {
    id: "surveyArray2",
    category: "sensors",
    requires: "surveyArray",
    name: "Deep-crust sounding array",
    vendor: "helm",
    price: 45_000,
    description: "Sensor tier 3: exact region readings and the widest rover detection.",
    apply: (s) => {
      s.sensorTier = Math.max(s.sensorTier, 3);
    },
  },
  {
    id: "probeBay",
    category: "sensors",
    name: "Atmospheric probe bay",
    vendor: "lyceum",
    price: 20_000,
    description:
      "Carries 3 atmospheric probes for gas and ice giants, remote-piloted by your science officer down to the deep layers. Probes are sold separately.",
    apply: (s) => {
      s.probeCapacity = Math.max(s.probeCapacity, 3);
      s.probeMaxDepth = Math.max(s.probeMaxDepth, 3);
      s.hullMassT += 30;
    },
  },
  {
    id: "probeBay2",
    category: "sensors",
    requires: "probeBay",
    name: "Pressure-rated probe racks",
    vendor: "lyceum",
    price: 35_000,
    description: "Room for 6 probes, rated for abyssal dives where the helium-3 is richest.",
    apply: (s) => {
      s.probeCapacity = Math.max(s.probeCapacity, 6);
      s.probeMaxDepth = Math.max(s.probeMaxDepth, 4);
      s.hullMassT += 30;
    },
  },
];

export const UPGRADES_BY_ID: ReadonlyMap<string, Upgrade> = new Map(UPGRADES.map((u) => [u.id, u]));
