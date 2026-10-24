/**
 * The compendium: every collectible in the game, found or not. Found entries show where and when;
 * unfound ones are silhouettes with just enough of a hint to go looking.
 */
import { useState } from "preact/hooks";
import { COMMODITIES, ORE_IDS } from "../data/commodities";
import { FLORA, MINERAL_SPECIMENS, type Rarity } from "../data/catalog";
import { compendiumKey, compendiumTotals, formatDate, type CompendiumRecord } from "../sim";
import type { GameSession } from "./session";

type Tab = "flora" | "minerals" | "artifacts";

const RARITY: Record<Rarity, string> = { 1: "common", 2: "uncommon", 3: "rare" };
const CLIMATE_HINT = { cold: "cold worlds", temperate: "temperate worlds", warm: "warm worlds" } as const;

interface Card {
  key: string;
  name: string;
  color: string;
  blurb: string;
  hint: string;
  rarity?: Rarity;
}

export function Compendium({ session, onClose }: { session: GameSession; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("flora");
  const state = session.state;
  const found = state.compendium ?? {};
  const totals = compendiumTotals(state);

  const flora: Card[] = FLORA.map((f) => ({
    key: compendiumKey("flora", f.id),
    name: f.name,
    color: f.color,
    blurb: f.blurb,
    hint: `Grows on ${f.climates.map((c) => CLIMATE_HINT[c]).join(" and ")}`,
    rarity: f.rarity,
  }));
  const ores: Card[] = ORE_IDS.map((id) => ({
    key: compendiumKey("mineral", id),
    name: COMMODITIES[id].name,
    color: COMMODITIES[id].color,
    blurb: COMMODITIES[id].blurb,
    hint: "Drill any deposit of it",
  }));
  const gems: Card[] = MINERAL_SPECIMENS.map((g) => ({
    key: compendiumKey("gem", g.id),
    name: g.name,
    color: g.color,
    blurb: g.blurb,
    hint: `Sometimes found while drilling ${COMMODITIES[g.host].name.toLowerCase()}`,
    rarity: g.rarity,
  }));

  return (
    <div class="overlay" onClick={onClose}>
      <div class="compendium" onClick={(e) => e.stopPropagation()}>
        <div class="journal-head">
          <h2>Compendium</h2>
          <span class="muted">
            {totals.all.found} / {totals.all.total} catalogued
          </span>
          <button class="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div class="bar comp-total">
          <span style={{ width: `${(100 * totals.all.found) / totals.all.total}%` }} />
        </div>
        <div class="chips">
          <button class={`chip ${tab === "flora" ? "" : "off"}`} onClick={() => setTab("flora")}>
            Flora {totals.flora.found}/{totals.flora.total}
          </button>
          <button class={`chip ${tab === "minerals" ? "" : "off"}`} onClick={() => setTab("minerals")}>
            Minerals {totals.mineral.found + totals.gem.found}/{totals.mineral.total + totals.gem.total}
          </button>
          <button class={`chip ${tab === "artifacts" ? "" : "off"}`} onClick={() => setTab("artifacts")}>
            Artifacts
          </button>
        </div>
        <div class="comp-body">
          {tab === "flora" && <Grid cards={flora} found={found} />}
          {tab === "minerals" && (
            <>
              <h3>Ores</h3>
              <Grid cards={ores} found={found} />
              <h3>Specimens</h3>
              <Grid cards={gems} found={found} />
            </>
          )}
          {tab === "artifacts" && (
            <p class="muted">
              Ruins and derelicts haven't been found in the Verge yet. When they are, what you recover will be catalogued here.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Grid({ cards, found }: { cards: Card[]; found: Record<string, CompendiumRecord> }) {
  return (
    <div class="comp-grid">
      {cards.map((c) => {
        const rec = found[c.key];
        return rec ? (
          <div key={c.key} class="comp-card found" title={c.blurb}>
            <span class="comp-icon" style={{ background: c.color }} />
            <div class="comp-text">
              <div class="comp-name">{c.name}</div>
              {c.rarity && <div class={`comp-rarity r${c.rarity}`}>{RARITY[c.rarity]}</div>}
              <div class="comp-blurb">{c.blurb}</div>
              <div class="comp-where muted">
                {rec.where} · {formatDate(rec.t)}
              </div>
            </div>
          </div>
        ) : (
          <div key={c.key} class="comp-card unknown">
            <span class="comp-icon" />
            <div class="comp-text">
              <div class="comp-name">???</div>
              {c.rarity && <div class={`comp-rarity r${c.rarity}`}>{RARITY[c.rarity]}</div>}
              <div class="comp-where muted">{c.hint}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
