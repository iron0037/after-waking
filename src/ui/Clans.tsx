/** Clans overlay (AW-22): how each of the seven clans rates you, what that means, and what moved it lately. */
import { CLAN_SPECIALTY } from "../data/clans";
import { CLAN_NAMES, type ClanId } from "../data/ship";
import { clanStandings, formatDate, repPayMult, repPriceMult, tierOf, TIER_INFO, type GameState } from "../sim";
import "./clans.css";
import type { GameSession } from "./session";

/** Tier boundaries on the -100..100 bar (see repTier in the sim). */
const BOUNDS = [-40, -10, 20, 50];
const pos = (v: number) => `${((v + 100) / 2).toFixed(1)}%`;
/** Width of a bar segment between two standings. */
const span = (a: number, b: number) => `${(((b - a) / 200) * 100).toFixed(1)}%`;

const sign = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");
const shortDate = (t: number) => formatDate(t).replace(/ · \d\d:\d\d$/, "");

/** "+10%" style change from a multiplier, or "" at 1. */
function pctOf(mult: number): string {
  const p = Math.round((mult - 1) * 100);
  return p === 0 ? "" : `${p > 0 ? "+" : "−"}${Math.abs(p)}%`;
}

/** Next to a contract's pay: "Friendly +10%". Nothing when the clan is neutral. */
export function PayStandingTag({ state, clan }: { state: GameState; clan: ClanId }) {
  const tier = tierOf(state, clan);
  if (tier === "neutral") return null;
  const info = TIER_INFO[tier];
  // A hostile clan still pays what it owes, at the cool rate.
  const mult = repPayMult(state, clan) || TIER_INFO.cool.pay;
  return (
    <span class={`tag tier-tag tier-${tier}`} title={`${CLAN_NAMES[clan]} rate you ${info.label.toLowerCase()}. ${info.means}`}>
      {info.label} {pctOf(mult)}
    </span>
  );
}

/** At a vendor's counter: "Trusted −10%". Nothing when the clan is neutral (or hostile: the Buy button says why). */
export function PriceStandingTag({ state, clan }: { state: GameState; clan: ClanId }) {
  const tier = tierOf(state, clan);
  if (tier === "neutral" || tier === "hostile") return null;
  const info = TIER_INFO[tier];
  return (
    <span class={`tag tier-tag tier-${tier}`} title={`${CLAN_NAMES[clan]} rate you ${info.label.toLowerCase()}. ${info.means}`}>
      {info.label} {pctOf(repPriceMult(state, clan))}
    </span>
  );
}

function ClanChip({ clan, kind, of }: { clan: ClanId; kind: "ally" | "rival"; of: ClanId }) {
  return (
    <span
      class={`clan-chip ${kind}`}
      title={kind === "ally" ? `${CLAN_NAMES[clan]} are friends of ${CLAN_NAMES[of]}: what you do for one reaches the other` : `${CLAN_NAMES[clan]} are rivals of ${CLAN_NAMES[of]}: helping one costs you with the other`}
    >
      {CLAN_NAMES[clan]}
    </span>
  );
}

export function Clans({ session, onClose }: { session: GameSession; onClose: () => void }) {
  const { state } = session;
  const standings = clanStandings(state);
  return (
    <div class="overlay" onClick={onClose}>
      <div class="contracts clans-window" onClick={(e) => e.stopPropagation()}>
        <div class="journal-head">
          <h2>Clans</h2>
          <span class="muted">How the seven clans rate you. What you do for one ripples to its friends and rivals.</span>
          <button class="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div class="con-body">
          <div class="clans-grid">
            {standings.map((s) => (
              <div key={s.clan} class={`panel clan-card tier-${s.tier}`}>
                <div class="hub-card-head">
                  <div>
                    <strong>{CLAN_NAMES[s.clan]}</strong>
                    {s.clan === state.captain.clan && (
                      <>
                        {" "}
                        <span class="tag accent-tag" title="The clan you were born into">
                          Your clan
                        </span>
                      </>
                    )}
                  </div>
                  <span class="clan-tier">
                    {s.info.label} <span class="clan-val">{sign(s.value)}</span>
                  </span>
                </div>
                <div class="muted small clan-spec">{CLAN_SPECIALTY[s.clan]}</div>
                <div class="clan-bar" role="img" aria-label={`${CLAN_NAMES[s.clan]}: ${s.info.label}, ${sign(s.value)} of 100`}>
                  <span class="clan-seg tier-hostile" style={{ left: 0, width: span(-100, -40) }} />
                  <span class="clan-seg tier-cool" style={{ left: pos(-40), width: span(-40, -10) }} />
                  <span class="clan-seg tier-neutral" style={{ left: pos(-10), width: span(-10, 20) }} />
                  <span class="clan-seg tier-friendly" style={{ left: pos(20), width: span(20, 50) }} />
                  <span class="clan-seg tier-trusted" style={{ left: pos(50), width: span(50, 100) }} />
                  {BOUNDS.map((b) => (
                    <span key={b} class="clan-tick" style={{ left: pos(b) }} />
                  ))}
                  <span class="clan-mark" style={{ left: pos(s.value) }} />
                </div>
                <div class="small clan-means">{s.info.means}</div>
                <div class="clan-ties">
                  {s.allies.length > 0 && (
                    <span>
                      <span class="muted small">Friends</span>
                      {s.allies.map((c) => (
                        <ClanChip key={c} clan={c} kind="ally" of={s.clan} />
                      ))}
                    </span>
                  )}
                  {s.rivals.length > 0 && (
                    <span>
                      <span class="muted small">Rivals</span>
                      {s.rivals.map((c) => (
                        <ClanChip key={c} clan={c} kind="rival" of={s.clan} />
                      ))}
                    </span>
                  )}
                </div>
                {s.recent.length > 0 ? (
                  <ul class="clan-log small">
                    {s.recent.slice(0, 3).map((r, i) => (
                      <li key={i} title={r.reason}>
                        <span class={r.delta > 0 ? "good" : "danger"}>{sign(r.delta)}</span> {r.reason} <span class="muted">{shortDate(r.t)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div class="muted small">No recent dealings.</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
