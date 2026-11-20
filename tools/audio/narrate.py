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


def cut_hiss_tail(samples: np.ndarray, rate: int) -> np.ndarray:
    """Kokoro sometimes ends a line with a breathy hiss after the last word, heard as a stray "s"
    ("we wills"). Walk back from the end in 10 ms frames and cut while a frame is mostly high-frequency
    noise or near silence, stopping at the last voiced sound."""
    frame = int(rate * 0.01)
    peak = float(np.sqrt(np.mean(samples**2))) or 1.0
    end = len(samples)
    while end > frame * 10:
        seg = samples[end - frame : end]
        spec = np.abs(np.fft.rfft(seg)) ** 2
        freqs = np.fft.rfftfreq(len(seg), 1 / rate)
        hf = float(spec[freqs > 4000].sum() / max(spec.sum(), 1e-12))
        rms = float(np.sqrt(np.mean(seg**2)))
        if hf < 0.4 and rms > 0.2 * peak:
            break
        end -= frame
    return samples[: end + int(rate * 0.02)]


def render_parts(kokoro: Kokoro, parts: list[dict], voice: str, speed: float, path: Path) -> float:
    """A line delivered in pieces (AW-277): each part is "say" (text) or "phonemes" (IPA, to place the stress),
    with its own "speed" and a "pause" in seconds after it. Each piece's tail is trimmed tight, so nothing
    trails off into a stray sound, and given a short fade."""
    rate = 24000
    chunks = []
    for part in parts:
        if "phonemes" in part:
            samples, rate = kokoro.create(part["phonemes"], voice=voice, speed=part.get("speed", speed), lang="en-us", is_phonemes=True)
        else:
            samples, rate = kokoro.create(part["say"], voice=voice, speed=part.get("speed", speed), lang="en-us")
        loud = np.nonzero(np.abs(samples) > 0.02 * float(np.max(np.abs(samples))))[0]
        if len(loud):
            samples = samples[max(0, loud[0] - int(rate * 0.01)) : loud[-1] + int(rate * 0.04)]
        samples = cut_hiss_tail(samples, rate)
        fade = int(rate * 0.03)
        samples = samples.copy()
        samples[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=samples.dtype)
        chunks.append(samples)
        chunks.append(np.zeros(int(rate * part.get("pause", 0.0)), dtype=samples.dtype))
    pad = np.zeros(int(rate * PAD_S), dtype=chunks[0].dtype)
    audio = np.concatenate([pad, *chunks, pad])
    audio = audio * (0.89 / (float(np.max(np.abs(audio))) or 1.0))
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
        if "parts" in scene:
            secs = render_parts(kokoro, scene["parts"], voice, script["speed"], out / name)
        else:
            secs = render(kokoro, scene.get("say", scene["text"]), voice, script["speed"], out / name)
        print(f"{name} {voice} {secs:.1f} s  {scene['text'][:50]}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
