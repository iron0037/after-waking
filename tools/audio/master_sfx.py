"""Master chosen Stable Audio takes for the game (AW-31): even loudness, a soft limiter, Ogg Vorbis.

Takes come from tools/audio/output/<id>/<id>-<seed>.ogg (sfx.py); the masters go to public/assets/sfx/<id>.ogg.
Loudness is matched on the sound's active part (RMS where it's above the noise floor), so a deep, quiet
bellow and a bright chirp come out about equally present; a soft tanh limiter keeps peaks under -1 dBFS.

    E:/StableAudio/.venv/Scripts/python tools/audio/master_sfx.py creature-chirp:1 creature-sea:1:+3
    (id:seed, with an optional :+dB to push one louder than the rest)
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
TAKES = Path(__file__).resolve().parent / "output"
OUT = ROOT / "public" / "assets" / "sfx"
TARGET_RMS = 0.16  # active-part RMS, about -16 dBFS
CEILING = 0.89  # -1 dBFS


def master(sound: str, seed: str, boost_db: float) -> None:
    data, rate = sf.read(TAKES / sound / f"{sound}-{seed}.ogg", always_2d=True)
    mono = data.mean(axis=1)
    frame = int(rate * 0.05)
    frames = [mono[i : i + frame] for i in range(0, len(mono) - frame + 1, frame)]
    levels = np.array([np.sqrt(np.mean(f**2)) for f in frames])
    active = levels[levels > 0.25 * levels.max()]
    rms = float(np.sqrt(np.mean(active**2))) or 1.0
    # Sparse sounds (clicks) would need a big push that the limiter turns into crunch: cap it at +9 dB.
    gain = min(TARGET_RMS / rms, 10 ** (9 / 20)) * 10 ** (boost_db / 20)
    out = np.tanh(data * gain / CEILING) * CEILING
    OUT.mkdir(parents=True, exist_ok=True)
    sf.write(OUT / f"{sound}.ogg", out, rate, format="OGG", subtype="VORBIS")
    print(f"{sound}.ogg from take {seed}: gain {20 * np.log10(gain):+.1f} dB, peak {np.max(np.abs(out)):.2f}")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    for arg in sys.argv[1:]:
        parts = arg.split(":")
        master(parts[0], parts[1], float(parts[2]) if len(parts) > 2 else 0.0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
