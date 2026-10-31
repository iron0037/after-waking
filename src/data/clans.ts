/**
 * The captain's own clan (chosen at the start). Each gives a small, felt perk with a matching
 * cost, from the Starting Clan Perks table in docs/game_design.md. Costs that need systems not
 * built yet (clan reputation, enforcement jobs, smuggling) use stand-ins that work today.
 */
import type { ClanId } from "./ship";

export interface ClanMods {
  loanRate: number;
  fuelPrice: number;
  salePrice: number;
  foldRefit: number;
  raidChance: number;
  /** Price multiplier on upgrades sold by the captain's own clan. */
  ownVendorPrice: number;
  upkeep: number;
  drillRate: number;
  /** Share of platinum and plicite sale revenue the clan takes. */
  tithe: number;
  scanTime: number;
  specimenPrice: number;
  cargoT: number;
  shoreLeave: number;
  researchCost: number;
  /** Can Helm's small operators' fund help this captain? */
  helmFund: boolean;
}

export const NO_CLAN_MODS: ClanMods = {
  loanRate: 1,
  fuelPrice: 1,
  salePrice: 1,
  foldRefit: 1,
  raidChance: 1,
  ownVendorPrice: 1,
  upkeep: 1,
  drillRate: 1,
  tithe: 0,
  scanTime: 1,
  specimenPrice: 1,
  cargoT: 0,
  shoreLeave: 1,
  researchCost: 1,
  helmFund: true,
};

/**
 * How the clans feel about each other (AW-22), -1 (rivals) to +1 (allies). Standing you gain with one
 * clan spills onto the others by half this much: help Helm and the Midshipmen approve, the Freebooters don't.
 * Listed once per pair.
 */
export const CLAN_TIES: Partial<Record<ClanId, Partial<Record<ClanId, number>>>> = {
  // Order and the ship: Helm and the Midshipmen run the Intrepid between them; the Lyceum is their quiet ally.
  helm: { midshipmen: 0.4, lyceum: 0.2, freebooters: -0.6, covenant: -0.2 },
  midshipmen: { diggers: 0.3 },
  // The bank and the smugglers: the Exchange hates competition it can't tax.
  exchange: { freebooters: -0.5, diggers: -0.2 },
  // The Archive's keepers and its doubters.
  lyceum: { covenant: -0.5 },
};

/** What each clan is about, one line, for the Clans panel (docs/lore.md, Society: The Clans). */
export const CLAN_SPECIALTY: Record<ClanId, string> = {
  helm: "Navigation and order. The old command crew's heirs, loyal to the council. Charts, sensors, surveys.",
  midshipmen: "Ship operations. The best engineers aboard. Drives, hulls, weapons, shields.",
  diggers: "Mining. Drills, rover gear, and ore. They post most of the delivery work.",
  lyceum: "Research and the Archive. Specimens, probes, and most research projects.",
  exchange: "Trade and finance. The market, the loans, and the cargo gear.",
  covenant: "The doubters. They listen to everything and trust none of it.",
  freebooters: "Smugglers and privateers. No questions asked, in either direction.",
};

export interface CaptainClan {
  perk: string;
  cost: string;
  mods: Partial<ClanMods>;
}

export const CAPTAIN_CLANS: Record<ClanId, CaptainClan> = {
  exchange: {
    perk: "The note's interest is halved, and you sell 3% better.",
    cost: "Traders, not haulers: the Exchange's own brokers add 5% to your plicite, and a missed payment adds a late fee.",
    mods: { loanRate: 0.5, fuelPrice: 1.05, salePrice: 1.03 },
  },
  helm: {
    perk: "Fold-drive refits 15% faster, and Helm's charts of three more stars come with you.",
    cost: "Helm colours draw raiders: pirates hail you 20% more often.",
    mods: { foldRefit: 0.85, raidChance: 1.2 },
  },
  midshipmen: {
    perk: "10% off Midshipmen gear, and you start with a seasoned engineer.",
    cost: "Fussy about maintenance: equipment upkeep costs 20% more.",
    mods: { ownVendorPrice: 0.9, upkeep: 1.2 },
  },
  diggers: {
    perk: "Drills run 15% faster.",
    cost: "The Diggers take a 5% tithe on your platinum and plicite sales.",
    mods: { drillRate: 1.15, tithe: 0.05 },
  },
  lyceum: {
    perk: "Orbital scans and surveys take half the time; specimens sell for 15% more.",
    cost: "You carry Lyceum researchers: their berths take 10 t of hold space.",
    mods: { scanTime: 0.5, specimenPrice: 1.15, cargoT: -10 },
  },
  covenant: {
    perk: "Your crew finds peace aboard: shore leave lifts spirits 50% faster.",
    cost: "Your brethren disapprove of the Archive: research projects cost 10% more.",
    mods: { shoreLeave: 1.5, researchCost: 1.1 },
  },
  freebooters: {
    perk: "Black-market fuel 10% cheaper, and you start with 3,000 cr more.",
    cost: "Helm won't help a Freebooter: no small operators' fund.",
    mods: { fuelPrice: 0.9, helmFund: false },
  },
};
