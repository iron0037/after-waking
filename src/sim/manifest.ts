/**
 * The ship's status at a glance (AW-130): what's in the hold, what it's worth, what's held for
 * contracts, and what the refinery could do with it. Read-only; the UI's ship status window uses it.
 */
import { COMMODITIES, type CommodityId } from "../data/commodities";
import { reservedCargo, sellableTonnes } from "./actions";
import { sellPrice } from "./economy";
import { effectiveStats, shipSpecimenSlots } from "./perks";
import { concentrateOf, refineBlockers, refineHours } from "./refinery";
import { cargoTonnes, specimenCount } from "./ship";
import type { GameState } from "./state";

export interface ManifestRow {
  id: CommodityId;
  name: string;
  tonnes: number;
  /** At today's Intrepid price (before big-lot slippage). */
  value: number;
  /** Tonnes not held back for delivery contracts. */
  sellable: number;
  /** Ore tonnes active delivery contracts want (for ores; concentrate counts toward them). */
  wanted: number;
  /** Can the refinery turn this into concentrate right now, and how long would all of it take. */
  refinable: boolean;
  refineHours: number;
}

export interface HoldManifest {
  rows: ManifestRow[];
  usedT: number;
  capacityT: number;
  value: number;
  specimens: { species: string; bodyId: string; count: number }[];
  specimenSlots: number;
  specimenCount: number;
}

export function holdManifest(state: GameState): HoldManifest {
  const stats = effectiveStats(state);
  const reserved = reservedCargo(state);
  const rows: ManifestRow[] = (Object.entries(state.ship.cargo) as [CommodityId, number][])
    .filter(([, t]) => t > 0.05)
    .map(([id, t]) => ({
      id,
      name: COMMODITIES[id].name,
      tonnes: t,
      value: Math.round(t * sellPrice(state.market, id)),
      sellable: sellableTonnes(state, id),
      wanted: reserved[id] ?? 0,
      refinable: concentrateOf(id) !== null && refineBlockers(state, id).length === 0,
      refineHours: concentrateOf(id) ? refineHours(state, t) : 0,
    }))
    .sort((a, b) => b.value - a.value);
  const specimens = Object.entries(state.ship.specimens ?? {})
    .filter(([, n]) => n > 0)
    .map(([key, count]) => ({ bodyId: key.split("|")[0] ?? "", species: key.split("|")[1] ?? key, count }));
  return {
    rows,
    usedT: cargoTonnes(state.ship.cargo),
    capacityT: stats.cargoCapacityT,
    value: rows.reduce((s, r) => s + r.value, 0),
    specimens,
    specimenSlots: shipSpecimenSlots(state),
    specimenCount: specimenCount(state.ship.specimens),
  };
}
