/**
 * The Archive's guidance entries (AW-24): first-run help, voiced as the Archive itself. The Archive is
 * the technical record that came with the transmission, decoded by the Lyceum. It speaks formally and
 * a little oddly; a Lyceum translator sometimes adds a plain note ("gloss").
 *
 * Each entry shows once, the first time its trigger comes up (see sim/archive.ts). Order matters:
 * when several are due, the earliest in this list shows first.
 *
 * `strange` is the entry's text once the Awaken path is under way (M5): the help that answers
 * questions you didn't ask.
 */

/**
 * What brings an entry up. State triggers are read from the game state (sim/archive.ts);
 * screen triggers are raised by the screen that shows the thing being explained.
 */
export type ArchiveTrigger =
  // from the state
  | "start"
  | "intrepid"
  | "system"
  | "orbit"
  | "orbit-scanned"
  | "surface"
  | "hold-full"
  | "fuel-low"
  | "raider"
  | "damage"
  | "specimens"
  | "loan-due"
  | "perk-points"
  // from a screen
  | "starmap"
  | "contracts"
  | "market"
  | "region-chart"
  | "sensor-ring"
  | "drill-depth"
  | "rover"
  | "probe"
  | "research"
  | "crew";

export interface ArchiveEntry {
  id: string;
  trigger: ArchiveTrigger;
  title: string;
  /** The Archive's own words. */
  text: string;
  /** A Lyceum translator's practical note, in plain speech. */
  gloss?: string;
  /** The text once the Awaken path is under way. */
  strange?: string;
}

export const ARCHIVE: readonly ArchiveEntry[] = [
  {
    id: "welcome",
    trigger: "start",
    title: "Orientation",
    text:
      "Operator: you hold a freighter, a crew of five, and a debt to the Exchange. The work is to fold to a star, find what its worlds hold, bring it back, and sell it. Each return should leave you richer than the last. The Archive will annotate each new procedure once, as it arises.",
    gloss: "You can silence the Archive from this panel, and re-read its notes in the Journal.",
    strange: "Operator: you hold a freighter, a crew of five, and a debt. You have held them before. The Archive will annotate each procedure once, as it arises, again.",
  },
  {
    id: "intrepid",
    trigger: "intrepid",
    title: "The Intrepid",
    text:
      "The generation ship is your port. Its decks offer: the Exchange (sell cargo, buy fuel), the contract boards of the clans, the Shipyard (equipment and repairs), the hiring hall, the Lyceum's specimen desk, and research commissions. Days spent docked restore the crew.",
    gloss: "Fuel first, then a contract that fits your route, then go.",
  },
  {
    id: "loan",
    trigger: "loan-due",
    title: "The Exchange's note",
    text:
      "The note on your ship falls due every 120 days at the Exchange's rate. Missed payments accrue penalties and are remembered. Payment is taken from your credits when it falls due, wherever you are.",
    gloss: "Keep a payment's worth of credits in hand when you leave port. The Ship window (H) shows when the next one is due.",
  },
  {
    id: "starmap",
    trigger: "starmap",
    title: "Folding",
    text:
      "The fold drive moves the ship between stars instantly. Its cost is plicite, in proportion to the distance and the ship's mass. After each fold the drive must be refitted, which takes days and is longer for a longer fold. Charted stars are surveyed and quieter. Uncharted stars hold more, and more is waiting for you there.",
    gloss: "Look at a star's fuel cost before you commit, and keep enough plicite to come home.",
  },
  {
    id: "contracts",
    trigger: "contracts",
    title: "Contracts",
    text:
      "The clans post work: deliveries of a named good, surveys of named worlds, specimens of the living, probe readings from gas giants. Each has a deadline. A fulfilled contract pays and raises that clan's regard for you. A lapsed contract lowers it, and clans do not forget.",
    gloss: "Take contracts you'd half-do anyway on the trip you're planning. Two at once is plenty to start.",
  },
  {
    id: "system",
    trigger: "system",
    title: "Flight within a system",
    text:
      "Folds end at a system's edge; no ship may fold near a star's well. Within the system the drive gives a quarter of light-speed, so a crossing takes hours. Select a world to see the burn's time and fuel. To leave, return to the edge and fold once the drive is refitted.",
  },
  {
    id: "orbit",
    trigger: "orbit",
    title: "Reading a world",
    text:
      "From orbit, a scan identifies the world: its air, its gravity, its heat, and whether a surface exists to land on. A detailed survey reads deeper and sharpens every later estimate, at the cost of hours. Some clans pay for surveys of particular worlds.",
  },
  {
    id: "region-chart",
    trigger: "region-chart",
    title: "Region signal",
    text:
      "A world's surface is divided into regions. The amber glow over each region is the orbital return: brighter means more recoverable value. A basic sensor array counts every seam it can see, including those beyond your drill's reach. Better arrays see through the crust and count only what you can dig. Regions you have already worked return less.",
    gloss: "Land on the brightest region you haven't worked yet. The estimate is a guide, not a promise.",
    strange: "The amber glow over each region is the value placed there. Brighter means more. It was placed for you to find.",
  },
  {
    id: "surface",
    trigger: "surface",
    title: "On the ground",
    text:
      "The ship lands in one region and stays there. The rover leaves it to drill and to sample, and its cells and cargo bay are small: it must come back to unload and recharge. Moving the ship to another region means a short hop through the air.",
  },
  {
    id: "sensor-ring",
    trigger: "sensor-ring",
    title: "The sensor ring",
    text:
      "The dashed ring around the ship or rover is the reach of your ground sensors. Seams and life inside it are identified; beyond it they are not seen at all. Move, and the ring moves with you, revealing what it passes over. Better arrays and a sharper science officer widen it.",
    gloss: "Sweep across the region in steps the width of the ring. Don't drive in circles.",
  },
  {
    id: "rover",
    trigger: "rover",
    title: "The rover",
    text:
      "Rough ground, slopes and water cost the rover energy and time; some ground it cannot cross. Watch its charge, and bring it back to the ship to unload and recharge before it runs low.",
  },
  {
    id: "drill-depth",
    trigger: "drill-depth",
    title: "Drill depth",
    text:
      "Every seam lies at a depth. Your drill reaches only so far; a seam below that is marked and cannot be worked until the drill is improved at the Shipyard. Richer seams are often deeper. The drill's pace also depends on the seam's grade.",
    gloss: "Don't chase a deep seam you can't reach. Note where it is and come back with a better drill.",
  },
  {
    id: "specimens",
    trigger: "specimens",
    title: "Living specimens",
    text:
      "Life sampled from the surface is kept alive in the ship's racks. The Lyceum buys specimens, and pays extra for each species it has not yet catalogued. Contracts and research may ask for particular species: keep those aboard.",
  },
  {
    id: "probe",
    trigger: "probe",
    title: "Probes",
    text:
      "Worlds without a surface can still be sampled. A probe descends on a tether through the layers of the atmosphere, flown from the ship by your crew. Deeper layers hold rarer gases and greater risk. A probe that is lost must be replaced.",
  },
  {
    id: "hold-full",
    trigger: "hold-full",
    title: "A full hold",
    text:
      "The hold is nearly full. Value per tonne now matters more than tonnage: leave the cheaper ores for another trip, or jettison them to make room for better finds. A full hold also draws attention on the way out.",
  },
  {
    id: "market",
    trigger: "market",
    title: "Selling",
    text:
      "The Exchange pays according to its need. Selling many tonnes of one good lowers its price, and the price recovers slowly while you are away. Selling a mix of goods returns more than selling one in bulk.",
  },
  {
    id: "fuel-low",
    trigger: "fuel-low",
    title: "Plicite",
    text:
      "Your plicite is low. Without enough for the fold home, the ship cannot return; the Exchange will send a tender, at a price. Plicite can also be mined, from worlds and asteroids that carry it.",
  },
  {
    id: "raider",
    trigger: "raider",
    title: "Raiders",
    text:
      "Raiders prey on laden freighters, as you fold out of a system or along a burn within it. They size you up first: a well-armed ship is seldom troubled. You may pay, talk, run or fight. A captain who strikes their colours loses most of the hold but keeps the ship and the crew. Your officers can fight or flee for you if you prefer.",
  },
  {
    id: "damage",
    trigger: "damage",
    title: "Battle damage",
    text:
      "Damage stays with the ship until the Shipyard repairs it. Damaged drives slow every burn. Damaged weapons and sensors weaken you in the next fight, and raiders notice a wounded ship.",
  },
  {
    id: "perk-points",
    trigger: "perk-points",
    title: "Experience",
    text:
      "Each officer learns from the work of their station: the navigator from flight, the engineer from repairs and the drill, science from scans and gunnery, comms from talk, medical from the living. With each level they earn a talent, chosen in the Crew window.",
  },
  {
    id: "crew",
    trigger: "crew",
    title: "The crew",
    text:
      "Each officer has a clan, a level, a wage, and a mood. Long voyages wear on them, and shore leave and fair pay restore them. An unhappy officer may leave the ship at the next port. The hiring hall offers replacements, at a signing fee.",
  },
  {
    id: "research",
    trigger: "research",
    title: "Research",
    text:
      "The clans can decode more of the Archive for you, given materials, credits and time. Each project unlocks a piece of equipment at the Shipyard. Track a project to see its needs on the star map and in the hold while you travel.",
    strange: "The clans can decode more of the Archive for you. Some of what they decode is about you.",
  },
];

export const ARCHIVE_BY_ID = new Map(ARCHIVE.map((e) => [e.id, e] as const));
