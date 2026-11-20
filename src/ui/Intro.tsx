/**
 * The new-career intro (AW-234): seven pixel-art panels that pan and zoom, with captions and a
 * voiceover. Script and motion live in src/data/intro.json; the art is MOSS-Image output
 * (tools/art/moss.py intro-1 ...) and the voice is Kokoro (tools/audio/narrate.py). The player is
 * Cinematic, shared with the endings (AW-277).
 */
import script from "../data/intro.json";
import { Cinematic, type CinematicScene } from "./Cinematic";

const SCENES: CinematicScene[] = script.scenes.map((s, i) => ({ ...s, audio: `vo-${i + 1}` }) as CinematicScene);

export function Intro({ onDone }: { onDone: () => void }) {
  return <Cinematic scenes={SCENES} dir="./assets/intro" title="AFTER WAKING" onDone={onDone} />;
}
