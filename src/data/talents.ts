/**
 * Signature talents (AW-207): every recruit in the hiring hall brings one thing no level gives,
 * learned before they signed on. The five who came with the freighter were green volunteers, and
 * volunteers from the decks still are: no talent. A talent works while its holder is aboard.
 */
import type { OfficerStation } from "./crew";

export type TalentId =
  | "archive-tracker"
  | "deep-sky"
  | "gem-cutter"
  | "dark-fold"
  | "raiders-eyes"
  | "quick-plotter"
  | "tank-rigger"
  | "hold-packer"
  | "rover-whisperer"
  | "clan-fixer"
  | "market-insider"
  | "bounty-hunter"
  | "field-surgeon"
  | "morale-officer"
  | "specimen-keeper";

export interface TalentDef {
  id: TalentId;
  station: OfficerStation;
  name: string;
  /** What it does, in a line. */
  text: string;
}

export const TALENTS: TalentDef[] = [
  { id: "archive-tracker", station: "science", name: "Archive tracker", text: "Spent years cataloguing the Archive's seed vaults: rare plants show on the orbital region chart." },
  { id: "deep-sky", station: "science", name: "Deep-sky astronomer", text: "Knows the dark between the stars: deep-field sweeps reach 50% farther." },
  { id: "gem-cutter", station: "science", name: "Gem cutter", text: "Knows what collectors pay for: mineral specimens fetch twice as much." },
  { id: "dark-fold", station: "navigation", name: "Dark-fold pilot", text: "Flew Helm's survey folds: blind folds reach 80% of the drive's range and burn no extra plicite." },
  { id: "raiders-eyes", station: "navigation", name: "Raider's eyes", text: "Used to ride with the raiders: in flight you nearly always spot them first." },
  { id: "quick-plotter", station: "navigation", name: "Quick plotter", text: "Plots folds the drive likes: fold refits take 25% less time." },
  { id: "tank-rigger", station: "engineering", name: "Tank rigger", text: "Re-plumbs the fuel lines into every void: +25% fuel capacity." },
  { id: "hold-packer", station: "engineering", name: "Hold packer", text: "A dockhand's eye for space: +15% cargo hold." },
  { id: "rover-whisperer", station: "engineering", name: "Rover whisperer", text: "Keeps the rover's cells sweet: +30% rover energy." },
  { id: "clan-fixer", station: "comms", name: "Clan fixer", text: "Knows everyone in their own clan: goodwill with that clan builds 50% faster." },
  { id: "market-insider", station: "comms", name: "Market insider", text: "Hears the Exchange floor before it moves: +4% on everything you sell." },
  { id: "bounty-hunter", station: "comms", name: "Bounty broker", text: "Knows who pays for which raider: bounties are 50% higher." },
  { id: "field-surgeon", station: "medical", name: "Field surgeon", text: "Has patched up worse: incidents cost 40% less time." },
  { id: "morale-officer", station: "medical", name: "Morale officer", text: "Keeps the mess cheerful: the crew's mood settles 8 points higher." },
  { id: "specimen-keeper", station: "medical", name: "Specimen keeper", text: "Packs living samples like nobody else: +4 specimen slots on the rover and the ship." },
];

export const TALENTS_BY_ID = new Map(TALENTS.map((t) => [t.id, t] as const));
