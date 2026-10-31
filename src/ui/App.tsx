import { ArchivePanel } from "./ArchivePanel";
import { ShipStatus } from "./ShipStatus";
import { useEffect, useState } from "preact/hooks";
import { Compendium } from "./Compendium";
import { preloadSprites } from "./compendiumSprites";
import { Clans } from "./Clans";
import { Contracts } from "./Contracts";
import { CrewOverlay } from "./Crew";
import { EncounterOverlay } from "./Encounter";
import { Journal } from "./Journal";
import { ProbeDiveOverlay } from "./ProbeDive";
import { LevelUpPopup, PerkTreeModal } from "./PerkTree";
import { TimeLapseClock } from "./TimeLapseClock";
import { TitleScreen } from "./TitleScreen";
import { TopBar } from "./TopBar";
import { defaultView, GameSession, useSession } from "./session";
import { Hub } from "./screens/Hub";
import { StarMap } from "./screens/StarMap";
import { SurfaceView } from "./screens/SurfaceView";
import { SystemView } from "./screens/SystemView";
import { warmTerrain } from "./screens/surface/terrainImage";

export function App() {
  const [session, setSession] = useState<GameSession | null>(null);
  return session ? <Game session={session} onQuit={() => setSession(null)} /> : <TitleScreen onStart={setSession} />;
}

function Game({ session, onQuit }: { session: GameSession; onQuit: () => void }) {
  useSession(session);
  const [journalOpen, setJournalOpen] = useState(false);
  const [compendiumOpen, setCompendiumOpen] = useState(false);
  const [contractsOpen, setContractsOpen] = useState(false);
  const [clansOpen, setClansOpen] = useState(false);
  const [shipOpen, setShipOpen] = useState(false);
  const [crewOpen, setCrewOpen] = useState(false);

  // Get the terrain workers going as soon as the game is up (and tell them which world is in orbit), so the first
  // surface doesn't wait for threads, textures or the universe to be built.
  const loc = session.state.location;
  const orbiting = loc.kind === "space" ? loc.orbiting : null;
  useEffect(() => {
    warmTerrain(session.state.seed, session.state.worldGen ?? 1, orbiting);
  }, [session, orbiting]);
  // The compendium's sprite atlas, fetched and decoded now rather than when the book is opened.
  useEffect(() => {
    void preloadSprites();
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || session.busy) return;
      // A raider has the floor: no hotkeys until the encounter (and its debrief) is settled.
      if (session.state.encounter || session.encounterDebrief) return;
      if (ev.key === "j" || ev.key === "J") setJournalOpen((o) => !o);
      // C is a hex movement key on the surface (down-right), so the compendium lives on B ("book").
      else if (ev.key === "b" || ev.key === "B") setCompendiumOpen((o) => !o);
      else if (ev.key === "k" || ev.key === "K") setContractsOpen((o) => !o);
      else if (ev.key === "l" || ev.key === "L") setClansOpen((o) => !o);
      else if (ev.key === "h" || ev.key === "H") setShipOpen((o) => !o);
      else if (ev.key === "o" || ev.key === "O") setCrewOpen((o) => !o);
      else if (ev.key === "Escape") {
        if (session.perkTree) session.openPerkTree(null);
        else setCrewOpen(false);
        setJournalOpen(false);
        setCompendiumOpen(false);
        setContractsOpen(false);
        setClansOpen(false);
        setShipOpen(false);
      }
      else if (ev.key === "m" || ev.key === "M") session.go(session.view === "starmap" ? defaultView(session.state) : "starmap");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);

  // Level-ups wait for animations (flights, drives, time-lapses) to finish, and for any tree the player has open.
  const levelUp = session.busy || session.timelapse || session.perkTree || session.probeReport || session.state.encounter || session.encounterDebrief ? null : (session.state.levelUps?.[0] ?? null);
  // With a window open over the game, the Archive floats above it instead of docking above the journal footer.
  const windowOpen =
    journalOpen || compendiumOpen || contractsOpen || clansOpen || shipOpen || crewOpen || !!session.perkTree || !!levelUp || !!session.state.encounter ||
    !!session.encounterDebrief || !!session.probeReport || !!session.state.probeDive;
  const latest = session.state.journal.slice(-2).reverse();

  return (
    <div class="game">
      <TopBar session={session} onJournal={() => setJournalOpen(true)} onCompendium={() => setCompendiumOpen(true)}
        onContracts={() => setContractsOpen(true)} onClans={() => setClansOpen(true)} onCrew={() => setCrewOpen(true)} onShip={() => setShipOpen(true)}
        onQuit={onQuit} />
      <main class="main">
        {session.view === "hub" && <Hub session={session} />}
        {session.view === "starmap" && <StarMap session={session} />}
        {session.view === "system" && <SystemView session={session} />}
        {session.view === "surface" && <SurfaceView session={session} />}
      </main>
      <ArchivePanel session={session} floating={windowOpen} />
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
      {clansOpen && <Clans session={session} onClose={() => setClansOpen(false)} />}
      {shipOpen && <ShipStatus session={session} onClose={() => setShipOpen(false)} />}
      {crewOpen && <CrewOverlay session={session} onClose={() => setCrewOpen(false)} />}
      <ProbeDiveOverlay session={session} />
      <EncounterOverlay session={session} />
      {session.perkTree && <PerkTreeModal session={session} station={session.perkTree} onClose={() => session.openPerkTree(null)} />}
      {levelUp && <LevelUpPopup session={session} up={levelUp} />}
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
