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
  drillRateTph: 2,
  roverCargoT: 20,
  roverEnergy: 100,
  roverCanClimb: false,
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

export interface Upgrade {
  id: string;
  name: string;
  vendor: ClanId;
  price: number;
  description: string;
  apply: UpgradeEffect;
}

export const UPGRADES: readonly Upgrade[] = [
  {
    id: "expandedHold",
    name: "Expanded hold",
    vendor: "exchange",
    price: 12_000,
    description: "+100 t cargo capacity. Adds 150 t of hull mass, so folds cost more.",
    apply: (s) => {
      s.cargoCapacityT += 100;
      s.hullMassT += 150;
    },
  },
  {
    id: "auxTanks",
    name: "Auxiliary plicite tanks",
    vendor: "midshipmen",
    price: 9_000,
    description: "+40 fuel capacity.",
    apply: (s) => {
      s.fuelCapacity += 40;
      s.hullMassT += 40;
    },
  },
  {
    id: "driveCoil2",
    name: "Fold coil Mk II",
    vendor: "midshipmen",
    price: 30_000,
    description: "Maximum fold range 13 ly.",
    apply: (s) => {
      s.foldRangeLy = Math.max(s.foldRangeLy, 13);
    },
  },
  {
    id: "landingStruts",
    name: "Heavy struts & lift thrusters",
    vendor: "midshipmen",
    price: 18_000,
    description: "Lift off from worlds up to 1.9 g.",
    apply: (s) => {
      s.ratings.maxGravityG = Math.max(s.ratings.maxGravityG, 1.9);
      s.hullMassT += 60;
    },
  },
  {
    id: "pressureHull2",
    name: "Pressure hull Mk II",
    vendor: "midshipmen",
    price: 22_000,
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
    name: "Radiation baffles",
    vendor: "lyceum",
    price: 11_000,
    description: "Survive surface radiation up to level 3.",
    apply: (s) => {
      s.ratings.maxRadiation = Math.max(s.ratings.maxRadiation, 3);
      s.hullMassT += 50;
    },
  },
  {
    id: "surveyArray",
    name: "Helm survey array",
    vendor: "helm",
    price: 14_000,
    description: "Sensor tier 2: sharper orbital region readings, wider rover detection.",
    apply: (s) => {
      s.sensorTier = Math.max(s.sensorTier, 2);
    },
  },
  {
    id: "deepDrill",
    name: "Deep-core drill",
    vendor: "diggers",
    price: 15_000,
    description: "Drill to 700 m at double the extraction rate.",
    apply: (s) => {
      s.drillMaxDepthM = Math.max(s.drillMaxDepthM, 700);
      s.drillRateTph *= 2;
    },
  },
  {
    id: "roverSled",
    name: "Rover cargo sled",
    vendor: "diggers",
    price: 6_000,
    description: "+20 t rover cargo.",
    apply: (s) => {
      s.roverCargoT += 20;
    },
  },
  {
    id: "roverCells",
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
    name: "All-terrain treads",
    vendor: "diggers",
    price: 8_000,
    description: "The rover can climb mountainous terrain.",
    apply: (s) => {
      s.roverCanClimb = true;
    },
  },
];

export const UPGRADES_BY_ID: ReadonlyMap<string, Upgrade> = new Map(UPGRADES.map((u) => [u.id, u]));
