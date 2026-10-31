/**
 * Can we set down here? Compares a body's environment profile against the ship's ratings and
 * explains every reason it can't, so the UI can show the player what to unlock.
 */
import type { Ratings } from "../data/ship";
import { KIND_LABEL, type Body } from "./bodies";

export interface AccessResult {
  ok: boolean;
  reasons: string[];
}

export const RADIATION_LABEL = ["None", "Low", "Moderate", "High", "Lethal"] as const;
export const WEATHER_LABEL = ["Calm", "Breezy", "Stormy", "Violent", "Superstorms"] as const;
export const TECTONICS_LABEL = ["Dead", "Quiet", "Active", "Unstable", "Volcanic"] as const;

export function landingAccess(body: Body, ratings: Ratings): AccessResult {
  const reasons: string[] = [];
  if (body.surface === "none") {
    reasons.push(`${KIND_LABEL[body.kind]}s have no surface to land on. Skim or probe them instead.`);
    return { ok: false, reasons };
  }
  if (body.gravityG > ratings.maxGravityG) {
    reasons.push(`Gravity ${body.gravityG.toFixed(2)} g: thrusters can only lift off from ${ratings.maxGravityG.toFixed(1)} g.`);
  }
  if (body.pressureAtm > ratings.maxPressureAtm) {
    reasons.push(`Pressure ${formatPressure(body.pressureAtm)}: hull rated to ${ratings.maxPressureAtm} atm.`);
  }
  if (body.tempC > ratings.maxTempC) {
    reasons.push(`Surface ${Math.round(body.tempC)} °C: hull rated to ${ratings.maxTempC} °C.`);
  }
  if (body.tempC < ratings.minTempC) {
    reasons.push(`Surface ${Math.round(body.tempC)} °C: hull rated down to ${ratings.minTempC} °C.`);
  }
  if (body.chemistry === "corrosive" && !ratings.corrosionProof) {
    reasons.push("Corrosive atmosphere: needs a corrosion-proof hull (ceramic hull cladding, at the Shipyard).");
  }
  if (body.radiation > ratings.maxRadiation) {
    reasons.push(`Radiation ${RADIATION_LABEL[body.radiation]}: shielding rated to ${RADIATION_LABEL[ratings.maxRadiation]}.`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function formatPressure(atm: number): string {
  if (!Number.isFinite(atm)) return "crushing";
  if (atm === 0) return "vacuum";
  if (atm < 0.01) return "trace";
  return `${atm < 10 ? atm.toFixed(2) : Math.round(atm)} atm`;
}
