/**
 * Which worlds a ship can set down on (AW-247): now, with better gear or another hull, or never.
 * The body list colors names by it, and the orbit map's landing rings draw it.
 */
import type { Ratings } from "../data/ship";
import type { Body } from "./bodies";
import { landingAccess } from "./environment";
import { shipStats } from "./ship";

/** The best landing ratings any ship can be fitted to. */
export const BEST_LANDING_RATINGS: Ratings = shipStats({
  name: "",
  hull: "bulker",
  upgrades: ["landingStruts", "pressureHull2", "pressureHull3", "cryoHull", "corrosionHull", "radShielding"],
  fuel: 0,
  cargo: {},
}).ratings;

export type LandingTier = "now" | "gear" | "never";

/** Can a ship with these ratings land here ("now"), could a better-fitted one ("gear"), or can no ship ("never")? */
export function landingTier(body: Body, ratings: Ratings): LandingTier {
  if (body.regions <= 0) return "never";
  if (landingAccess(body, ratings).ok) return "now";
  return landingAccess(body, BEST_LANDING_RATINGS).ok ? "gear" : "never";
}
