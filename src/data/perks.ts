/**
 * Perk trees (docs/crew_perks.md, AW-95). Each station has three branches of five tiers; a perk
 * needs (tier − 1) perks already taken in its branch. One point per level gained.
 *
 * `needs` marks perks whose system isn't built yet: they show in the tree, locked.
 */
import type { Station } from "./crew";

export interface PerkDef {
  id: string;
  station: Station;
  branch: string;
  tier: 1 | 2 | 3 | 4 | 5;
  name: string;
  text: string;
  /** Set when the perk waits on a system that doesn't exist yet ("M3 combat"). */
  needs?: string;
}

export const BRANCHES: Record<Station, readonly [string, string, string]> = {
  science: ["Geology", "Xenobiology", "Physics"],
  navigation: ["Interstellar", "Interplanetary", "Planetary"],
  engineering: ["Astronautics", "Electronics", "Mechanics"],
  comms: ["Diplomacy", "Signals", "Linguistics"],
  medical: ["Field Medicine", "Xenomedicine", "Crew Care"],
  captain: ["Charisma", "Business", "Intuition"],
};

type Row = [id: string, name: string, text: string, needs?: string];

/** Rows per station: three branches × five tiers, in branch order. */
const TREES: Record<Station, readonly (readonly Row[])[]> = {
  science: [
    [
      ["seam-sense", "Seam Sense", "Deposits are detected at +50% sensor range."],
      ["assayer", "Assayer", "Prospect from two hexes away, in half the time."],
      ["rich-veins", "Rich Veins", "Every deposit yields 10% more ore."],
      ["prospectors-eye", "Prospector's Eye", "A detailed survey charts every deposit on the world before you land."],
      ["hidden-seams", "Hidden Seams", "Sensors pick up a layer of deposits other crews miss."],
    ],
    [
      ["field-botanist", "Field Botanist", "Plant sites are detected at +50% sensor range."],
      ["careful-hands", "Careful Hands", "Each collection yields two samples, if there's room."],
      ["ecologist", "Ecologist", "Sensors pick up plant sites other crews miss."],
      ["fauna-handler", "Fauna Handler", "Less harm from hostile specimens.", "hostile life"],
      ["xenologist", "Xenologist", "+2 effective Comms levels in first contact; alien biology dialogue.", "M6 aliens"],
    ],
    [
      ["drive-harmonics", "Drive Harmonics", "+2 effective Navigation levels for fold fuel."],
      ["sensor-calibration", "Sensor Calibration", "+1 sensor tier for orbital region readings."],
      ["plicite-chemistry", "Plicite Chemistry", "+2 effective Navigation levels for fold-drive recharge."],
      ["field-theory", "Field Theory", "Better shields and sensors in combat.", "M3 combat"],
      ["anomaly-theory", "Anomaly Theory", "Detects the \"glitches\" the Covenant asks about.", "the Awaken path"],
    ],
  ],
  navigation: [
    [
      ["fold-plotter", "Fold Plotter", "The star map shows fold fuel and recharge for every star at a glance."],
      ["fold-calibration", "Fold Calibration", "A precise target lock needs less clear space: folds can start 80% of the way to the system edge."],
      ["long-fold", "Long Fold", "+1 ly fold range."],
      ["shoal-reader", "Shoal Reader", "Finds fold shoals: cheap, unstable shortcuts.", "fold shoals"],
      ["wake-masking", "Wake Masking", "Your folds leave a fainter trace.", "fold-wake detection"],
    ],
    [
      ["efficient-burns", "Efficient Burns", "+2 effective Navigation levels for flight fuel."],
      ["gravity-assist", "Gravity Assist", "In-system flights take 20% less time."],
      ["close-orbit", "Close Orbit", "Detailed surveys take half the time."],
      ["evasive-pilot", "Evasive Pilot", "Maneuver advantage in fights.", "M3 combat"],
      ["pursuit-course", "Pursuit Course", "Catch or escape ships in-system.", "M3 combat"],
    ],
    [
      ["pathfinder", "Pathfinder", "Rover routes use 10% less energy."],
      ["pinpoint-landing", "Pinpoint Landing", "Choose your landing hex anywhere in a region.", "the region preview (AW-92)"],
      ["hop-master", "Hop Master", "Ship hops cost half the fuel."],
      ["storm-pilot", "Storm Pilot", "Landing ratings for gravity and pressure +20%."],
      ["ground-navigator", "Ground Navigator", "The rover crosses rough ground as if it were plain."],
    ],
  ],
  engineering: [
    [
      ["drive-tuning", "Drive Tuning", "+2 effective Navigation levels for flight fuel."],
      ["afterburner", "Afterburner", "+10% cruise speed."],
      ["lift-rating", "Lift Rating", "+0.2 g landing gravity rating."],
      ["drive-repair", "Drive Repair", "Engines repaired in half the time.", "M3 combat"],
      ["overdrive", "Overdrive", "An emergency speed burst, at a risk.", "M3 combat"],
    ],
    [
      ["power-management", "Power Management", "+15% rover energy capacity."],
      ["fast-charge", "Fast Charge", "The rover charges twice as fast at the ship."],
      ["sensor-boost", "Sensor Boost", "+1 hex of sensor sweep."],
      ["fire-control", "Fire Control", "Better weapon accuracy and damage.", "M3 combat"],
      ["shield-tuning", "Shield Tuning", "Shields recharge faster.", "M3 combat"],
    ],
    [
      ["drill-master", "Drill Master", "+2 effective Engineering levels for drill rate."],
      ["jury-rig", "Jury-Rig", "The first incident on each landing costs no time."],
      ["deep-bore", "Deep Bore", "The drill reaches 20% deeper."],
      ["rover-overhaul", "Rover Overhaul", "+25% rover cargo capacity."],
      ["field-refinery", "Field Refinery", "The portable refinery runs faster and loses less ore.", "on-site refining (AW-18)"],
    ],
  ],
  comms: [
    [
      ["deal-maker", "Deal Maker", "+2 effective Comms levels for contract pay."],
      ["extensions", "Extensions", "Contracts allow 25% more time."],
      ["note-restructuring", "Note Restructuring", "The Exchange cuts your loan rate by 2 points."],
      ["favors-owed", "Favors Owed", "A clan forgives one failed contract.", "clan reputation (M4)"],
      ["preferred-captain", "Preferred Captain", "Clans offer you exclusive, high-value contracts."],
    ],
    [
      ["market-wire", "Market Wire", "See where each commodity's price is heading over the next week."],
      ["long-ears", "Long Ears", "+1 sensor tier for orbital region readings."],
      ["distress-net", "Distress Net", "Rescue tenders arrive in half the time and charge 25% less."],
      ["early-warning", "Early Warning", "Encounters are detected sooner.", "M3 combat"],
      ["listening-post", "Listening Post", "Picks up the Covenant's \"impossible\" signals.", "the Awaken path"],
    ],
    [
      ["clan-dialects", "Clan Dialects", "Reputation gains +25%.", "clan reputation (M4)"],
      ["translator", "Translator", "Basic alien phrases.", "M6 aliens"],
      ["xenolinguist", "Xenolinguist", "Reveals hidden dialogue options.", "M6 aliens"],
      ["cultural-insight", "Cultural Insight", "Better trade terms with aliens.", "M6 aliens"],
      ["first-words", "First Words", "First contact can't go hostile on the first exchange.", "M6 aliens"],
    ],
  ],
  medical: [
    [
      ["triage", "Triage", "+2 effective Medical levels for time lost to incidents."],
      ["hazard-suits", "Hazard Suits", "+1 radiation rating and 20 °C more temperature range for landing."],
      ["stabilize", "Stabilize", "Injuries heal twice as fast.", "injuries (AW-96)"],
      ["surgeon", "Surgeon", "Can save a crew member from a fatal injury.", "injuries (AW-96)"],
      ["combat-medic", "Combat Medic", "Wounded crew return to their stations mid-fight.", "M3 combat"],
    ],
    [
      ["containment", "Containment", "+2 specimen slots on the rover and the ship."],
      ["culture-lab", "Culture Lab", "+2 effective Medical levels for specimen prices."],
      ["pathogen-screen", "Pathogen Screen", "Immunity to alien sickness events.", "hostile life"],
      ["bio-assay", "Bio-Assay", "Specimens reveal which research they unlock.", "research (AW-15)"],
      ["living-archive", "Living Archive", "Specimen research projects run 25% faster.", "research (AW-15)"],
    ],
    [
      ["mentor", "Mentor", "The whole crew earns 10% more experience."],
      ["morale", "Morale", "Happiness recovers twice as fast.", "crew sentiment (AW-100)"],
      ["steady-hands", "Steady Hands", "Drilling incidents are 15% rarer."],
      ["longevity", "Longevity", "Crew retire five years later.", "aging (AW-96)"],
      ["family-ship", "Family Ship", "Retiring veterans leave a trained protégé.", "aging (AW-96)"],
    ],
  ],
  captain: [
    [
      ["talent-scout", "Talent Scout", "The hiring hall offers two more recruits, at higher levels."],
      ["recruiter", "Recruiter", "Signing fees halved."],
      ["inspiring", "Inspiring", "The whole crew earns 10% more experience."],
      ["loyalty", "Loyalty", "Loyalty grows 50% faster; veterans delay retirement.", "crew sentiment (AW-100)"],
      ["silver-tongue", "Silver Tongue", "Persuade colonists to move to an outpost, or pirates to let you go.", "outposts (M4)"],
    ],
    [
      ["haggler", "Haggler", "+2 effective Captain levels for sale prices."],
      ["bulk-seller", "Bulk Seller", "Big lots move the market price half as much."],
      ["credit-line", "Credit Line", "The Exchange extends 50% more fuel credit."],
      ["futures", "Futures", "Commodity futures contracts.", "Exchange futures"],
      ["shareholder", "Shareholder", "A cut of an outpost's trade.", "outposts (M4)"],
    ],
    [
      ["hunch", "Hunch", "The region chart marks where your gut says to land."],
      ["read-the-room", "Read the Room", "See crew happiness and loyalty as exact 0–100 scores.", "crew sentiment (AW-100)"],
      ["fortune-favors", "Fortune Favors", "Rare mineral specimens are twice as likely, and a quarter of incidents turn up a specimen."],
      ["read-the-enemy", "Read the Enemy", "A hint of the enemy's next move in combat.", "M3 combat"],
      ["sixth-sense", "Sixth Sense", "Notice the world's \"seams\" first.", "the Awaken path"],
    ],
  ],
};

export const PERKS: readonly PerkDef[] = (Object.keys(TREES) as Station[]).flatMap((station) =>
  TREES[station].flatMap((rows, b) =>
    rows.map(([id, name, text, needs], t) => ({
      id,
      station,
      branch: BRANCHES[station][b] as string,
      tier: (t + 1) as PerkDef["tier"],
      name,
      text,
      ...(needs ? { needs } : {}),
    })),
  ),
);

export const PERKS_BY_ID = new Map(PERKS.map((p) => [p.id, p]));

export type PerkId = string;
