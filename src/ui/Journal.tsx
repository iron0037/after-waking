import { useMemo, useState } from "preact/hooks";
import { archiveRead, archiveText, awakenFinaleReached, clueCount, covenantErrands, dossier, formatDate, guidanceOn, hasClue, reportFutureLog, resetArchive, setGuidance, type JournalKind } from "../sim";
import { CLUES, FINALE_TEXT } from "../data/clues";
import { useSession, type GameSession } from "./session";
import "./archive.css";
import "./covenant.css";

const KINDS: { kind: JournalKind; label: string }[] = [
  { kind: "discovery", label: "Discoveries" },
  { kind: "travel", label: "Travel" },
  { kind: "trade", label: "Trade" },
  { kind: "warning", label: "Warnings" },
  { kind: "info", label: "Other" },
];

export function Journal({ session, onClose }: { session: GameSession; onClose: () => void }) {
  useSession(session);
  const [section, setSection] = useState<"log" | "archive" | "dossier">("log");
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<Set<JournalKind>>(new Set());
  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return session.state.journal
      .filter((e) => !hidden.has(e.kind) && (!q || e.text.toLowerCase().includes(q)))
      .slice()
      .reverse();
  }, [session.state.journal.length, query, hidden]);

  const { state } = session;
  const showDossier = clueCount(state) > 0 || covenantErrands(state, session.world).length > 0;
  // The impossible entry sits above the rest, newest of all (its date has not happened yet).
  const future = state.futureLog;
  const futureShown = !!future && (!query.trim() || future.text.toLowerCase().includes(query.trim().toLowerCase()));

  const toggle = (kind: JournalKind) => {
    const next = new Set(hidden);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setHidden(next);
  };

  return (
    <div class="overlay" onClick={onClose}>
      <div class="journal" onClick={(e) => e.stopPropagation()}>
        <div class="journal-head">
          <h2>Captain's journal</h2>
          {section === "log" && (
            <input
              class="search"
              placeholder="Search…"
              value={query}
              autoFocus
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
          )}
          <button class="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div class="chips journal-tabs" role="tablist">
          <button role="tab" aria-selected={section === "log"} class={`chip ${section === "log" ? "active" : ""}`} onClick={() => setSection("log")}>
            Log
          </button>
          <button role="tab" aria-selected={section === "archive"} class={`chip ${section === "archive" ? "active" : ""}`} onClick={() => setSection("archive")}>
            Archive
          </button>
          {showDossier && (
            <button role="tab" aria-selected={section === "dossier"} class={`chip chip-covenant ${section === "dossier" ? "active" : ""}`} onClick={() => setSection("dossier")}>
              Dossier ({clueCount(state)}/{CLUES.length})
            </button>
          )}
        </div>
        {section === "archive" ? (
          <ArchiveSection session={session} />
        ) : section === "dossier" && showDossier ? (
          <DossierSection session={session} />
        ) : (
          <>
            <div class="chips">
              {KINDS.map(({ kind, label }) => (
                <button key={kind} class={`chip kind-${kind} ${hidden.has(kind) ? "off" : ""}`} onClick={() => toggle(kind)}>
                  {label}
                </button>
              ))}
            </div>
            <ol class="journal-list">
              {futureShown && future && (
                <li class="future-log">
                  <span class="when">{formatDate(future.t)}</span>
                  <span class="what">
                    {future.text}
                    {!hasClue(state, "future-log") && (
                      <button class="btn covenant-btn future-report" onClick={() => session.act((s) => reportFutureLog(s), { timelapse: false })}>
                        Report to the Covenant
                      </button>
                    )}
                  </span>
                </li>
              )}
              {entries.map((e, i) => (
                <li key={i} class={`kind-${e.kind}`}>
                  <span class="when">{formatDate(e.t)}</span>
                  <span class="what">{e.text}</span>
                </li>
              ))}
              {entries.length === 0 && <li class="muted">Nothing matches.</li>}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

/** The Covenant's dossier: what has been found, what the Covenant makes of it, and what is still only a hint. */
function DossierSection({ session }: { session: GameSession }) {
  const { state } = session;
  const entries = dossier(state);
  const found = entries.filter((e) => e.foundAt !== null).length;
  return (
    <div class="dossier">
      {awakenFinaleReached(state) && (
        <div class="dossier-finale">
          <span class="dossier-finale-label">Where the threads lead</span>
          <p>{FINALE_TEXT}</p>
        </div>
      )}
      <div class="dossier-count">
        <span class="covenant-glyph" aria-hidden="true" /> {found} of {entries.length}
        <span class="muted small"> clues in the Covenant's dossier</span>
      </div>
      <ul class="dossier-list">
        {entries.map(({ clue, foundAt }) =>
          foundAt !== null ? (
            <li key={clue.id} class="dossier-clue found">
              <div class="dossier-head">
                <h4>{clue.title}</h4>
                <span class="when">{formatDate(foundAt)}</span>
              </div>
              <p>{clue.found}</p>
              <blockquote class="dossier-quote">{clue.covenant}</blockquote>
            </li>
          ) : (
            <li key={clue.id} class="dossier-clue unfound">
              <div class="dossier-head">
                <h4>?</h4>
              </div>
              <p class="muted">{clue.hint}</p>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

/** The Archive's notes so far, to re-read, plus the switches for its guidance. */
function ArchiveSection({ session }: { session: GameSession }) {
  const { state } = session;
  const read = archiveRead(state);
  const on = guidanceOn(state);
  return (
    <>
      <div class="archive-controls">
        <button class={`btn ${on ? "primary" : ""}`} aria-pressed={on} onClick={() => session.act((s) => setGuidance(s, !on), { timelapse: false })}>
          The Archive speaks: {on ? "on" : "off"}
        </button>
        <span class="muted small grow">
          {on ? "Each new procedure is annotated once, as it arises." : "Silent. No notes will appear until you turn it back on."}
        </span>
        <button
          class="btn"
          title="Mark every note unread and turn the Archive on, so each shows again as its subject comes up"
          onClick={() => session.act((s) => resetArchive(s), { timelapse: false })}
        >
          Read everything again
        </button>
      </div>
      <ul class="archive-log">
        {read.map((e) => (
          <li key={e.id}>
            <h4>{e.title}</h4>
            <p>{archiveText(state, e)}</p>
            {e.gloss && (
              <p class="archive-gloss">
                <span class="archive-gloss-label">Lyceum gloss</span>
                {e.gloss}
              </p>
            )}
          </li>
        ))}
        {read.length === 0 && <li class="muted">The Archive has annotated nothing yet.</li>}
      </ul>
    </>
  );
}
