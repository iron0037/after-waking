import { useEffect, useState } from "preact/hooks";
import { Compendium } from "./Compendium";
import { Contracts } from "./Contracts";
import { Journal } from "./Journal";
import { TimeLapseClock } from "./TimeLapseClock";
import { TitleScreen } from "./TitleScreen";
import { TopBar } from "./TopBar";
import { defaultView, GameSession, useSession } from "./session";
import { Hub } from "./screens/Hub";
import { StarMap } from "./screens/StarMap";
import { SurfaceView } from "./screens/SurfaceView";
import { SystemView } from "./screens/SystemView";

export function App() {
  const [session, setSession] = useState<GameSession | null>(null);
  return session ? <Game session={session} onQuit={() => setSession(null)} /> : <TitleScreen onStart={setSession} />;
}

function Game({ session, onQuit }: { session: GameSession; onQuit: () => void }) {
  useSession(session);
  const [journalOpen, setJournalOpen] = useState(false);
  const [compendiumOpen, setCompendiumOpen] = useState(false);
  const [contractsOpen, setContractsOpen] = useState(false);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || session.busy) return;
      if (ev.key === "j" || ev.key === "J") setJournalOpen((o) => !o);
      else if (ev.key === "c" || ev.key === "C") setCompendiumOpen((o) => !o);
      else if (ev.key === "k" || ev.key === "K") setContractsOpen((o) => !o);
      else if (ev.key === "Escape") {
        setJournalOpen(false);
        setCompendiumOpen(false);
        setContractsOpen(false);
      }
      else if (ev.key === "m" || ev.key === "M") session.go(session.view === "starmap" ? defaultView(session.state) : "starmap");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);

  const latest = session.state.journal.slice(-2).reverse();

  return (
    <div class="game">
      <TopBar session={session} onJournal={() => setJournalOpen(true)} onCompendium={() => setCompendiumOpen(true)}
        onContracts={() => setContractsOpen(true)}
        onQuit={onQuit} />
      <main class="main">
        {session.view === "hub" && <Hub session={session} />}
        {session.view === "starmap" && <StarMap session={session} />}
        {session.view === "system" && <SystemView session={session} />}
        {session.view === "surface" && <SurfaceView session={session} />}
      </main>
      <footer class="journal-strip" onClick={() => setJournalOpen(true)} title="Open journal (J)">
        {latest.map((e, i) => (
          <div key={i} class={`strip-entry kind-${e.kind}`}>
            {e.text}
          </div>
        ))}
      </footer>
      {journalOpen && <Journal session={session} onClose={() => setJournalOpen(false)} />}
      {compendiumOpen && <Compendium session={session} onClose={() => setCompendiumOpen(false)} />}
      {contractsOpen && <Contracts session={session} onClose={() => setContractsOpen(false)} />}
      {session.timelapse && <TimeLapseClock lapse={session.timelapse} />}
      <div class="notices">
        {session.notices.map((n) => (
          <div key={n.id} class={`notice notice-${n.kind}`}>
            {n.text}
          </div>
        ))}
      </div>
    </div>
  );
}
