/**
 * A clan outpost's own screen (AW-256, docs/ui_design.md rule 10): settlements are full screen, like the
 * Intrepid. One tab per service the outpost offers; leaving goes back to the surface, where the ship
 * still stands on its pad.
 */
import { useEffect, useState } from "preact/hooks";
import { CLAN_NAMES } from "../../data/ship";
import { currentOutpost, OUTPOST_TYPES, outpostTitle, type Outpost } from "../../sim";
import { useSession, type GameSession } from "../session";
import { OutpostFuel, OutpostJobs, OutpostShop, OutpostTrade, OutpostYard } from "./surface/OutpostPanel";
import "./hub.css";

type OutpostTab = "jobs" | "fuel" | "shop" | "trade" | "yard";

const TAB_LABEL: Record<OutpostTab, string> = {
  jobs: "Jobs",
  fuel: "Fuel",
  shop: "Shop",
  trade: "Trading post",
  yard: "The den's yard",
};

/** The tabs this outpost has: everyone has jobs, fuel and a shop; the Exchange buys cargo; a den sells Corsairs. */
function tabsFor(o: Outpost): OutpostTab[] {
  return ["jobs", "fuel", "shop", ...(o.clan === "exchange" ? (["trade"] as const) : []), ...(o.clan === "freebooters" ? (["yard"] as const) : [])];
}

export function OutpostHub({ session }: { session: GameSession }) {
  useSession(session);
  const { state, world } = session;
  const o = currentOutpost(state, world);
  const [tab, setTab] = useState<OutpostTab>("jobs");
  const tabs = o ? tabsFor(o) : [];

  // Number keys pick tabs, as on the Intrepid; Escape goes back out.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === "Escape") session.go("surface");
      const next = tabs[Number(ev.key) - 1];
      if (next) setTab(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabs.join()]);

  if (!o) return null;
  const all = state.contracts ?? [];
  const jobsHere = all.filter((c) => (c.status === "offered" && c.postedAt === o.id) || (c.status === "active" && c.turnInAt === o.id)).length;
  return (
    <div class="full hub outpost-hub">
      <header class="hub-head">
        <div class="hub-id">
          <img class="hub-ship outpost-hub-art" src={`./assets/outpost-${o.clan}.png`} alt={o.name} />
          <div>
            <div class="hub-title-row">
              <h1 class="hub-title">{o.name}</h1>
              <button class="btn primary hub-depart" onClick={() => session.go("surface")} title="Back to the surface (Esc): the ship is on its pad">
                ◂ Back to the surface
              </button>
            </div>
            <div class="muted">
              {outpostTitle(o)}, {o.population} people. {OUTPOST_TYPES[o.clan].blurb}
            </div>
            <div class="muted small">
              {CLAN_NAMES[o.clan]} · your ship: <span class="accent">{state.ship.name}</span>
            </div>
          </div>
        </div>
        <nav class="hub-tabs" role="tablist">
          {tabs.map((t, i) => (
            <button key={t} role="tab" aria-selected={tab === t} class={`hub-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)} title={`${TAB_LABEL[t]} (${i + 1})`}>
              <span class="hub-tab-key">{i + 1}</span> {TAB_LABEL[t]}
              {t === "jobs" && jobsHere > 0 && <span class="hub-badge">{jobsHere}</span>}
            </button>
          ))}
        </nav>
      </header>
      <div class="hub-body">
        <section class="panel outpost-hub-pane">
          <h2>{TAB_LABEL[tab]}</h2>
          {tab === "jobs" && <OutpostJobs session={session} outpostId={o.id} />}
          {tab === "fuel" && <OutpostFuel session={session} />}
          {tab === "shop" && <OutpostShop session={session} outpost={o} />}
          {tab === "trade" && <OutpostTrade session={session} />}
          {tab === "yard" && <OutpostYard session={session} />}
        </section>
      </div>
    </div>
  );
}
