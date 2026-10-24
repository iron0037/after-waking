/**
 * Atmospheric probes (AW-16): depth bands and the descent's decision points. Probes are flown by
 * the science officer over a link that fails at depth; after that a mechanical ballast timer brings
 * the probe back up, if it survives. Nothing aboard thinks for itself.
 */
import type { GasId } from "./commodities";

export type ProbeDepth = 1 | 2 | 3 | 4;

export interface DepthBand {
  depth: ProbeDepth;
  name: string;
  /** Kilometres below the cloud tops (flavour). */
  km: number;
  /** Chance the probe is lost, before the pilot's skill and choices. */
  risk: number;
  /** Tonnes of gas a full canister load brings back, before the atmosphere's richness. */
  tonnes: number;
  /** Hours from launch to recovery. */
  hours: number;
  /** Decision points on the way down. */
  events: number;
  /** Science experience for the dive. */
  xp: number;
  /** Mix of gases recovered (relative weights) for each kind of giant. */
  mix: { gasGiant: Partial<Record<GasId, number>>; iceGiant: Partial<Record<GasId, number>> };
}

export const DEPTHS: readonly DepthBand[] = [
  {
    depth: 1,
    name: "Cloud tops",
    km: 60,
    risk: 0.03,
    tonnes: 1.2,
    hours: 4,
    events: 1,
    xp: 10,
    mix: { gasGiant: { methane: 30, deuterium: 50, xenon: 15, helium3: 5 }, iceGiant: { methane: 70, deuterium: 25, xenon: 5 } },
  },
  {
    depth: 2,
    name: "Middle decks",
    km: 300,
    risk: 0.1,
    tonnes: 2.5,
    hours: 8,
    events: 2,
    xp: 15,
    mix: { gasGiant: { methane: 15, deuterium: 45, xenon: 28, helium3: 12 }, iceGiant: { methane: 55, deuterium: 30, xenon: 12, helium3: 3 } },
  },
  {
    depth: 3,
    name: "Deep layers",
    km: 900,
    risk: 0.22,
    tonnes: 4.5,
    hours: 14,
    events: 3,
    xp: 22,
    mix: { gasGiant: { methane: 5, deuterium: 35, xenon: 35, helium3: 25 }, iceGiant: { methane: 40, deuterium: 30, xenon: 20, helium3: 10 } },
  },
  {
    depth: 4,
    name: "The abyss",
    km: 2_500,
    risk: 0.35,
    tonnes: 6.5,
    hours: 20,
    events: 3,
    xp: 30,
    mix: { gasGiant: { deuterium: 25, xenon: 35, helium3: 40 }, iceGiant: { methane: 25, deuterium: 30, xenon: 25, helium3: 20 } },
  },
];

export interface ProbeOption {
  label: string;
  /** Added to the loss chance (percentage points as a fraction). */
  risk?: number;
  /** Multiplies the loss chance (e.g. 0.5 halves it). */
  riskMult?: number;
  /** Multiplies the haul. */
  yield?: number;
  /** Hours added to (or taken off) the dive. */
  hours?: number;
}

export interface ProbeEvent {
  id: string;
  text: string;
  options: readonly [ProbeOption, ProbeOption];
}

export const PROBE_EVENTS: readonly ProbeEvent[] = [
  {
    id: "storm",
    text: "A storm band blocks the descent: walls of cloud moving at four hundred metres a second.",
    options: [
      { label: "Ride the downdraft", risk: 0.04, hours: -2 },
      { label: "Steer around it", risk: -0.02, hours: 3 },
    ],
  },
  {
    id: "lightning",
    text: "Lightning arcs between the cloud decks. The instruments are taking hits.",
    options: [
      { label: "Shield the instruments", risk: -0.03, yield: 0.85 },
      { label: "Keep sampling through it", risk: 0.04, yield: 1.15 },
    ],
  },
  {
    id: "richLayer",
    text: "The spectrometer lights up: a dense layer of heavy isotopes, right where the probe is.",
    options: [
      { label: "Linger in it", risk: 0.05, yield: 1.3, hours: 3 },
      { label: "Keep to the plan" },
    ],
  },
  {
    id: "pressure",
    text: "The hull creaks. Pressure is climbing faster than the model said it would.",
    options: [
      { label: "Drop ballast and start up early", riskMult: 0.5, yield: 0.7 },
      { label: "Hold depth", risk: 0.03 },
    ],
  },
  {
    id: "icing",
    text: "Ice crystals are clogging the intake.",
    options: [
      { label: "Purge it and lose some sample", risk: -0.02, yield: 0.9 },
      { label: "Push through", risk: 0.04 },
    ],
  },
];

/** Price of one probe at the Shipyard. They come back for reuse if they survive. */
export const PROBE_PRICE = 2_500;
