/**
 * Crew content: stations, what each clan's people are good at, and names. People only: no
 * androids or AI crew, ever.
 */
import type { ClanId } from "./ship";

/** The captain is the player; the other five stations are hired officers. */
export type Station = "captain" | "science" | "navigation" | "engineering" | "comms" | "medical";
export type OfficerStation = Exclude<Station, "captain">;

export const OFFICER_STATIONS: readonly OfficerStation[] = ["science", "navigation", "engineering", "comms", "medical"];
export const STATIONS: readonly Station[] = ["captain", ...OFFICER_STATIONS];

export interface StationInfo {
  /** "Science officer" */
  title: string;
  /** What earns experience at this station. */
  learnsFrom: string;
  /** What a higher level improves (shown with the numbers for the current level). */
  improves: string;
}

export const STATION_INFO: Record<Station, StationInfo> = {
  captain: {
    title: "Captain",
    learnsFrom: "selling cargo and closing contracts",
    improves: "sale prices",
  },
  science: {
    title: "Science officer",
    learnsFrom: "scans, surveys, prospecting and finds",
    improves: "sensor sweep radius",
  },
  navigation: {
    title: "Navigator",
    learnsFrom: "folds and in-system flights",
    improves: "fuel per fold and per AU, in-system flight time",
  },
  engineering: {
    title: "Engineer",
    learnsFrom: "drilling, dealing with breakdowns, and fold-drive refits",
    improves: "drill rate, fewer storms-and-jams stoppages, faster fold-drive refits",
  },
  comms: {
    title: "Comms officer",
    learnsFrom: "signing and closing contracts",
    improves: "contract pay",
  },
  medical: {
    title: "Medic",
    learnsFrom: "sample collection and patching up the crew",
    improves: "time lost to incidents, specimen prices",
  },
};

export interface ClanTraits {
  /** Stations this clan trains its people for: +25% experience there, and recruits start further along. */
  affinity: readonly OfficerStation[];
  /** "Helm-trained navigator" style background, shown on the roster. */
  trait: string;
  /** Wage multiplier: Freebooters work cheap and ask no questions. */
  wage: number;
}

export const CLAN_TRAITS: Record<ClanId, ClanTraits> = {
  helm: { affinity: ["navigation"], trait: "Helm-trained: reads fold charts like scripture", wage: 1 },
  midshipmen: { affinity: ["engineering"], trait: "Midshipman: raised in the engine rooms", wage: 1 },
  diggers: { affinity: ["engineering", "science"], trait: "Digger: knows rock by the sound of the drill", wage: 1 },
  lyceum: { affinity: ["science", "medical"], trait: "Lyceum scholar: careful with samples, curious about everything", wage: 1 },
  exchange: { affinity: ["comms"], trait: "Exchange-schooled negotiator", wage: 1.1 },
  covenant: { affinity: ["comms"], trait: "Covenant listener: hears everything, trusts nothing", wage: 0.95 },
  freebooters: { affinity: [], trait: "Freebooter: works cheap, asks no questions", wage: 0.8 },
};

export const FIRST_NAMES = [
  "Ada", "Bram", "Celia", "Dario", "Esme", "Farid", "Greta", "Hollis", "Ines", "Jory",
  "Kaito", "Lena", "Marek", "Nia", "Oren", "Priya", "Quill", "Rosa", "Silas", "Tova",
  "Ugo", "Vesna", "Wren", "Xavi", "Yara", "Zeno", "Amara", "Bastian", "Coral", "Dov",
  "Elif", "Fenn", "Gwen", "Hamid", "Isolde", "Jun", "Kesi", "Lior", "Mira", "Nils",
] as const;

export const SURNAMES = [
  "Abara", "Brandt", "Castell", "Dimas", "Eriksen", "Fairweather", "Gallo", "Hart", "Ibarra", "Jensen",
  "Kovac", "Lindqvist", "Mbeki", "Navarro", "Okafor", "Petrov", "Quint", "Rahman", "Sato", "Tamura",
  "Underhill", "Varga", "Whitlock", "Yilmaz", "Zahir", "Achebe", "Bellweather", "Cho", "Delacroix", "Esposito",
] as const;
