"""Master chosen soundtrack takes into seamless loops (AW-274).

Takes come from tools/audio/output/<id>/<id>-<seed>.ogg (sfx.py --manifest music.json); the masters go to
public/assets/music/<id>.ogg. Each take's tail is crossfaded (equal power) into its head, so the loop point
can't be heard; then the cues are matched in loudness (overall RMS), with a soft tanh limiter under -1 dBFS.

    E:/StableAudio/.venv/Scripts/python tools/audio/master_music.py music-title:2 music-combat:1:-2
    (id:seed, with an optional :+dB/-dB to set one cue apart from the rest)
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
TAKES = Path(__file__).resolve().parent / "output"
OUT = ROOT / "public" / "assets" / "music"
TARGET_RMS = 0.12  # about -18 dBFS: music sits under everything, and the engine lowers it further
CEILING = 0.89  # -1 dBFS
CROSSFADE_S = 4.0


def seamless(data: np.ndarray, rate: int) -> np.ndarray:
    """Fold the last CROSSFADE_S seconds over the first, so the end flows into the start."""
    n = int(CROSSFADE_S * rate)
    head, body, tail = data[:n], data[n:-n], data[-n:]
    t = np.linspace(0.0, 1.0, n)[:, None]
    blended = tail * np.cos(t * np.pi / 2) + head * np.sin(t * np.pi / 2)
    # The loop now runs blended → body; the file's last sample leads straight back into its first.
    return np.concatenate([blended, body])


def master(cue: str, seed: str, offset_db: float) -> None:
    data, rate = sf.read(TAKES / cue / f"{cue}-{seed}.ogg", always_2d=True)
    loop = seamless(data, rate)
    rms = float(np.sqrt(np.mean(loop**2))) or 1.0
    gain = TARGET_RMS / rms * 10 ** (offset_db / 20)
    out = np.tanh(loop * gain / CEILING) * CEILING
    OUT.mkdir(parents=True, exist_ok=True)
    # libsndfile's Vorbis encoder crashes on long clips written in one call: a second at a time.
    with sf.SoundFile(OUT / f"{cue}.ogg", "w", rate, out.shape[1], format="OGG", subtype="VORBIS") as f:
        for i in range(0, len(out), rate):
            f.write(out[i : i + rate])
    print(f"{cue}.ogg from take {seed}: {len(out) / rate:.1f} s loop, gain {20 * np.log10(gain):+.1f} dB, peak {np.max(np.abs(out)):.2f}")


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
