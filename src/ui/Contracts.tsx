/** Contracts overlay: every active job with its targets, plus the postings on offer. Viewable from anywhere. */
import { COMMODITIES } from "../data/commodities";
import { CLAN_NAMES } from "../data/ship";
import { completeContract, contractBenefits, contractPayout, contractProgress, DAY, formatDuration, type Contract, type GameState } from "../sim";
import { useArchiveTopic } from "./ArchivePanel";
import { bandPhrase, cr, pct } from "./format";
import type { GameSession } from "./session";

interface Target {
  key: string;
  system: string;
  body: string;
  done: boolean;
  note?: string;
}

export function contractBodyNames(session: GameSession, bodyId: string): { system: string; body: string } {
  let system = bodyId.split(".")[0] ?? bodyId;
  let body = bodyId;
  try {
    system = session.world.system(system).system.name;
    body = session.world.body(bodyId).body.name;
  } catch {
    /* unknown id: show it raw */
  }
  return { system, body };
}

function targetsOf(session: GameSession, c: Contract): Target[] {
  const { state } = session;
  if (c.kind === "survey") {
    return (c.surveyBodyIds ?? []).map((id) => ({
      key: id,
      ...contractBodyNames(session, id),
      done: state.surveyedBodies.includes(id),
      note: "survey",
    }));
  }
  if (c.kind === "specimens" && c.bodyId) {
    const p = contractProgress(state, c);
    return [{ key: c.bodyId, ...contractBodyNames(session, c.bodyId), done: p.ready, note: `${p.have} / ${p.need} samples` }];
  }
  if (c.kind === "probe" && c.bodyId) {
    const p = contractProgress(state, c);
    return [{ key: c.bodyId, ...contractBodyNames(session, c.bodyId), done: p.ready, note: `down to ${bandPhrase(c.depth ?? 1)}` }];
  }
  return [];
}

/** One subtle line of the non-credit upsides (experience, loyalty, spirits). Used on every contract card. */
export function ContractAlso({ state, c }: { state: GameState; c: Contract }) {
  const text = contractBenefits(state, c).join(" · ");
  return (
    <div class="con-also muted small" title="What finishing this job does besides paying: experience, loyalty and morale">
      Also: {text}
    </div>
  );
}

function Row({ session, c }: { session: GameSession; c: Contract }) {
  const { state } = session;
  const active = c.status === "active";
  const progress = contractProgress(state, c);
  const left = c.deadline !== null ? c.deadline - state.time : 0;
  const targets = targetsOf(session, c);
  const payout = contractPayout(state, c);

  return (
    <div class={`panel con-card ${active ? "active" : ""}`}>
      <div class="hub-card-head">
        <div>
          <span class="tag">{CLAN_NAMES[c.clan]}</span> <strong>{c.title}</strong>
          {c.exclusive && (
            <>
              {" "}
              <span class="tag accent-tag" title="A Preferred Captain's private offer: it never reaches the public board.">
                Private
              </span>
            </>
          )}
        </div>
        <span class="accent" title={payout !== c.reward ? `${cr(c.reward)} posted, adjusted for your comms officer` : undefined}>
          {cr(payout)}
        </span>
      </div>
      <div class="muted small">{c.text}</div>
      <ContractAlso state={state} c={c} />
      {active ? (
        <>
          <div class="hub-contract-row">
            <span class={left < 14 * DAY ? "danger" : "muted"}>{left > 0 ? `${formatDuration(left)} left` : "Overdue"}</span>
            <span class={progress.ready ? "good" : ""}>{progress.label}</span>
          </div>
          <div class="bar hub-contract-bar">
            <span style={{ width: `${pct(progress.have, progress.need)}%` }} />
          </div>
          {progress.ready &&
            (state.location.kind === "intrepid" ? (
              <button class="btn primary" onClick={() => session.act((s) => completeContract(s, c.id))}>
                Turn in for {cr(payout)}
              </button>
            ) : (
              <div class="good small">Ready: turn it in aboard the Intrepid (Jobs tab).</div>
            ))}
        </>
      ) : (
        <div class="muted small">{c.durationDays} days to complete once signed</div>
      )}
      {c.kind === "deliver" && c.commodity && (
        <div class="small">
          Deliver {c.tonnes} t of {COMMODITIES[c.commodity].name.toLowerCase()} to the Intrepid
          {active && (
            <span class={progress.ready ? "good" : "muted"}> ({progress.ready ? "in the hold" : "not yet aboard"})</span>
          )}
        </div>
      )}
      {targets.length > 0 && (
        <ul class="con-targets">
          {targets.map((t) => (
            <li key={t.key} class={active && t.done ? "done" : ""}>
              <span class={active ? (t.done ? "good" : "muted") : "muted"}>{active ? (t.done ? "✔" : "○") : "◆"}</span>
              <span>
                <strong>{t.body}</strong> <span class="muted">in {t.system}</span>
              </span>
              {t.note && <span class="muted small">{active && t.done && c.kind === "survey" ? "surveyed" : t.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Contracts({ session, onClose }: { session: GameSession; onClose: () => void }) {
  useArchiveTopic(session, "contracts");
  const all = session.state.contracts ?? [];
  const active = all.filter((c) => c.status === "active");
  const offered = all.filter((c) => c.status === "offered");

  return (
    <div class="overlay" onClick={onClose}>
      <div class="contracts" onClick={(e) => e.stopPropagation()}>
        <div class="journal-head">
          <h2>Contracts</h2>
          <span class="muted">{active.length} / 4 active</span>
          <button class="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div class="con-body">
          <section>
            <h3>Active</h3>
            {active.length > 0 ? (
              <div class="con-list">
                {active.map((c) => (
                  <Row key={c.id} session={session} c={c} />
                ))}
              </div>
            ) : (
              <p class="muted">Nothing signed. Jobs are taken at the Jobs board aboard the Intrepid.</p>
            )}
          </section>
          <section>
            <h3>On offer</h3>
            <p class="muted small">Postings are accepted and turned in aboard the Intrepid. Listed here for planning only.</p>
            {offered.length > 0 ? (
              <div class="con-list">
                {offered.map((c) => (
                  <Row key={c.id} session={session} c={c} />
                ))}
              </div>
            ) : (
              <p class="muted">The boards are bare.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
