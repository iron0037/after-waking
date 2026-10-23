/**
 * The Exchange's trade depot aboard the Intrepid. Prices drift day to day around their base,
 * and dumping a lot of one commodity depresses its price until the glut clears.
 */
import { COMMODITIES, COMMODITY_IDS, type CommodityId } from "../data/commodities";
import type { Rng } from "./rng";
import { clamp } from "./units";

export const FUEL_BASE_PRICE = 220;

export interface MarketState {
  /** Last simulated day (absolute day number). */
  day: number;
  mult: Record<CommodityId, number>;
  glut: Record<CommodityId, number>;
  fuelMult: number;
}

export function newMarket(day: number): MarketState {
  const mult = {} as Record<CommodityId, number>;
  const glut = {} as Record<CommodityId, number>;
  for (const id of COMMODITY_IDS) {
    mult[id] = 1;
    glut[id] = 0;
  }
  return { day, mult, glut, fuelMult: 1 };
}

/** Simulate each day up to `day`: mean-reverting random walk, gluts decay. */
export function stepMarket(market: MarketState, rng: Rng, day: number): void {
  const days = Math.min(day - market.day, 3650);
  for (let i = 0; i < days; i++) {
    for (const id of COMMODITY_IDS) {
      market.mult[id] = clamp(market.mult[id] + 0.08 * (1 - market.mult[id]) + rng.gaussian(0, 0.035), 0.5, 1.8);
      market.glut[id] *= 0.97;
    }
    market.fuelMult = clamp(market.fuelMult + 0.1 * (1 - market.fuelMult) + rng.gaussian(0, 0.02), 0.7, 1.5);
  }
  market.day = Math.max(market.day, day);
}

export function sellPrice(market: MarketState, id: CommodityId): number {
  const c = COMMODITIES[id];
  return Math.round((c.basePrice * market.mult[id]) / (1 + market.glut[id] / c.marketDepthT));
}

export function fuelPrice(market: MarketState): number {
  return Math.round(FUEL_BASE_PRICE * market.fuelMult);
}

/** Credits for selling `tonnes`, averaging the price slide across the sale. Records the glut. */
/** `impact` scales how much the sale floods the market (Bulk Seller: half). */
export function sellCommodity(market: MarketState, id: CommodityId, tonnes: number, impact = 1): number {
  const before = sellPrice(market, id);
  market.glut[id] += tonnes * impact;
  const after = sellPrice(market, id);
  return Math.round(((before + after) / 2) * tonnes);
}
