import { useEffect, useState } from "preact/hooks";
import { Journal } from "./Journal";
import { TitleScreen } from "./TitleScreen";
import { TopBar } from "./TopBar";
import { GameSession, useSession } from "./session";
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

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || session.busy) return;
      if (ev.key === "j" || ev.key === "J") setJournalOpen((o) => !o);
      else if (ev.key === "Escape") setJournalOpen(false);
      else if (ev.key === "m" || ev.key === "M") session.go(session.view === "starmap" ? "system" : "starmap");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);

  const latest = session.state.journal.slice(-2).reverse();

  return (
    <div class="game">
      <TopBar session={session} onJournal={() => setJournalOpen(true)} onQuit={onQuit} />
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
