import { COMMODITIES, type CommodityId } from "../data/commodities";
import { cargoTonnes, type Cargo } from "../sim";
import { DEPTHS } from "../data/probes";

export function cr(n: number): string {
  return `${Math.round(n).toLocaleString()} cr`;
}

export function tonnes(n: number): string {
  return `${n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString()} t`;
}

export function cargoList(cargo: Cargo): { id: CommodityId; name: string; tonnes: number }[] {
  return (Object.entries(cargo) as [CommodityId, number][])
    .filter(([, t]) => t > 0.05)
    .map(([id, t]) => ({ id, name: COMMODITIES[id].name, tonnes: t }))
    .sort((a, b) => b.tonnes - a.tonnes);
}

export function cargoSummary(cargo: Cargo, capacity: number): string {
  return `${tonnes(cargoTonnes(cargo))} / ${tonnes(capacity)}`;
}

export function pct(value: number, max: number): number {
  return max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
}

/** A probe depth band in a sentence: "the middle decks", "the abyss". */
export function bandPhrase(depth: number): string {
  const name = DEPTHS[depth - 1]?.name ?? "depths";
  return `the ${name.toLowerCase().replace(/^the /, "")}`;
}
