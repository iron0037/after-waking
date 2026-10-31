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
