"""Render the surface call-outs (AW-281) with Kokoro, in the intro narrator's voice (src/data/intro.json).

Short recorded alerts the sensor package plays: "Mineral detected.", "Lifeform detected."
Writes public/assets/sfx/<id>.ogg. Runs in the Kokoro venv on E::

    E:/Kokoro/.venv/Scripts/python tools/audio/callouts.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "assets" / "sfx"
MODELS = Path("E:/Kokoro/models")
LINES = {"mineral-detected": "Mineral detected.", "lifeform-detected": "Lifeform detected."}
PAD_S = 0.05


def main() -> None:
    script = json.loads((ROOT / "src" / "data" / "intro.json").read_text(encoding="utf-8"))
    kokoro = Kokoro(str(MODELS / "kokoro-v1.0.onnx"), str(MODELS / "voices-v1.0.bin"))
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in LINES.items():
        samples, rate = kokoro.create(text, voice=script["voice"], speed=1.0, lang="en-us")
        # Trim the model's own leading and trailing silence, then a short pad.
        loud = np.nonzero(np.abs(samples) > 0.01)[0]
        if len(loud):
            samples = samples[max(0, loud[0] - int(rate * 0.02)) : loud[-1] + int(rate * 0.08)]
        pad = np.zeros(int(rate * PAD_S), dtype=samples.dtype)
        audio = np.concatenate([pad, samples, pad])
        audio = audio * (0.89 / (float(np.max(np.abs(audio))) or 1.0))
        sf.write(OUT / f"{name}.ogg", audio, rate, format="OGG", subtype="VORBIS")
        print(f"{name}.ogg {len(audio) / rate:.2f} s", flush=True)


if __name__ == "__main__":
    main()
