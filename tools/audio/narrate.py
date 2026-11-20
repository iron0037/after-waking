"""Render a cinematic's voiceover with Kokoro, a local text-to-speech model: the intro (AW-234) by default,
or another script such as the Return ending (AW-277) with --script and --out.

Reads the lines, voice and speed from the script and writes <out>/vo-<id>.ogg (vo-<n> when scenes have
no id). A scene's own "voice" overrides the script's narrator. Runs in the Kokoro venv on E: (models in
E:/Kokoro/models):

    E:/Kokoro/.venv/Scripts/python tools/audio/narrate.py                 # every line
    E:/Kokoro/.venv/Scripts/python tools/audio/narrate.py --only 4        # one line (1-based)
    E:/Kokoro/.venv/Scripts/python tools/audio/narrate.py --script src/data/ending-return.json --out public/assets/ending-return
    E:/Kokoro/.venv/Scripts/python tools/audio/narrate.py --sample bm_george am_michael af_heart
        # one line in several voices, to tools/audio/samples/, for choosing a narrator
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "src" / "data" / "intro.json"
OUT = ROOT / "public" / "assets" / "intro"
SAMPLES = Path(__file__).resolve().parent / "samples"
MODELS = Path("E:/Kokoro/models")
# A beat of silence either side, so lines don't start or end abruptly.
PAD_S = 0.25


def render(kokoro: Kokoro, text: str, voice: str, speed: float, path: Path) -> float:
    samples, rate = kokoro.create(text, voice=voice, speed=speed, lang="en-us")
    pad = np.zeros(int(rate * PAD_S), dtype=samples.dtype)
    audio = np.concatenate([pad, samples, pad])
    # Leave headroom: normalise to -1 dBFS.
    peak = float(np.max(np.abs(audio))) or 1.0
    audio = audio * (0.89 / peak)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, audio, rate, format="OGG", subtype="VORBIS")
    return len(audio) / rate


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", type=int, help="render just this line (1-based)")
    ap.add_argument("--sample", nargs="+", metavar="VOICE", help="render one line in each of these voices")
    ap.add_argument("--line", type=int, default=6, help="which line --sample uses (1-based)")
    ap.add_argument("--script", type=Path, default=SCRIPT, help="the cinematic's script (default: the intro)")
    ap.add_argument("--out", type=Path, default=OUT, help="where the vo-*.ogg files go")
    args = ap.parse_args()

    script = json.loads((args.script if args.script.is_absolute() else ROOT / args.script).read_text(encoding="utf-8"))
    out = args.out if args.out.is_absolute() else ROOT / args.out
    scenes = script["scenes"]
    kokoro = Kokoro(str(MODELS / "kokoro-v1.0.onnx"), str(MODELS / "voices-v1.0.bin"))

    if args.sample:
        scene = scenes[args.line - 1]
        text = scene.get("say", scene["text"])
        for voice in args.sample:
            secs = render(kokoro, text, voice, script["speed"], SAMPLES / f"{voice}.ogg")
            print(f"{voice}: {secs:.1f} s", flush=True)
        return 0

    for i, scene in enumerate(scenes, start=1):
        if args.only and i != args.only:
            continue
        name = f"vo-{scene.get('id', i)}.ogg"
        voice = scene.get("voice", script["voice"])
        secs = render(kokoro, scene.get("say", scene["text"]), voice, script["speed"], out / name)
        print(f"{name} {voice} {secs:.1f} s  {scene['text'][:50]}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
