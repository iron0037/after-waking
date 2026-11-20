"""Generate sound effects with Stable Audio Open 1.0, run locally on the GPU (AW-31; docs/audio.md).

The prompts live in tools/audio/sfx.json: one entry per sound, with its text prompt, length and seeds.
Each take is written to tools/audio/output/<id>/<id>-<seed>.ogg for listening; the one picked for the
game is copied into public/assets/sfx/ by hand (the same way art is chosen from tools/art/output).

Runs in its own venv on E: (model in E:/StableAudio/models/stable-audio-open-1.0, diffusers format).
Don't run it alongside MOSS or the SD WebUI: they share the 8 GB GPU.

    E:/StableAudio/.venv/Scripts/python tools/audio/sfx.py creature-chirp
    E:/StableAudio/.venv/Scripts/python tools/audio/sfx.py creature-chirp creature-growl --seeds 1 2 3
    E:/StableAudio/.venv/Scripts/python tools/audio/sfx.py --prompt "a metal door slams" --seconds 3
    E:/StableAudio/.venv/Scripts/python tools/audio/sfx.py --manifest music.json music-intrepid
        # the soundtrack's takes (AW-274): tools/audio/music.json, same format

License: Stability AI Community License. Re-check its terms before shipping anything it made.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from diffusers import StableAudioPipeline

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = Path(__file__).resolve().parent / "sfx.json"
OUT = Path(__file__).resolve().parent / "output"
MODEL = Path("E:/StableAudio/models/stable-audio-open-1.0")
NEGATIVE = "low quality, distorted, clipping, music, speech, voices"


def load() -> StableAudioPipeline:
    pipe = StableAudioPipeline.from_pretrained(str(MODEL), torch_dtype=torch.float16, local_files_only=True)
    return pipe.to("cuda")


def write_ogg(path: Path, data: np.ndarray, rate: int) -> None:
    """libsndfile's Vorbis encoder crashes the process on a long clip written in one call (music, AW-274),
    so write it a second at a time."""
    with sf.SoundFile(path, "w", rate, data.shape[1], format="OGG", subtype="VORBIS") as f:
        for i in range(0, len(data), rate):
            f.write(data[i : i + rate])


def render(pipe: StableAudioPipeline, name: str, prompt: str, seconds: float, seeds: list[int], steps: int, negative: str) -> None:
    folder = OUT / name
    folder.mkdir(parents=True, exist_ok=True)
    rate = pipe.vae.sampling_rate
    for seed in seeds:
        audio = pipe(
            prompt,
            negative_prompt=negative,
            num_inference_steps=steps,
            audio_end_in_s=seconds,
            num_waveforms_per_prompt=1,
            generator=torch.Generator("cuda").manual_seed(seed),
        ).audios[0]
        data = audio.T.float().cpu().numpy()  # (samples, channels)
        # Trim to the asked length, short fades so nothing clicks, and leave headroom (-1 dBFS).
        data = data[: int(seconds * rate)]
        fade = min(len(data) // 10, int(0.01 * rate))
        if fade > 0:
            ramp = np.linspace(0.0, 1.0, fade)[:, None]
            data[:fade] *= ramp
            data[-fade:] *= ramp[::-1]
        peak = float(np.max(np.abs(data))) or 1.0
        data = data * (0.89 / peak)
        path = folder / f"{name}-{seed}.ogg"
        write_ogg(path, data, rate)
        print(f"{path.relative_to(ROOT)}  {seconds:.1f} s  seed {seed}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sounds", nargs="*", help="ids from the manifest; the model loads once")
    ap.add_argument("--manifest", default=MANIFEST.name, help="prompt list next to this script (default sfx.json; music.json for music)")
    ap.add_argument("--seeds", type=int, nargs="+", help="override each sound's seeds")
    ap.add_argument("--steps", type=int, default=100)
    ap.add_argument("--prompt", help="try a prompt without adding it to sfx.json (saved as 'scratch')")
    ap.add_argument("--seconds", type=float, default=3.0, help="length for --prompt")
    args = ap.parse_args()

    path = MANIFEST.parent / args.manifest
    manifest = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"sounds": []}
    by_id = {s["id"]: s for s in manifest["sounds"]}
    missing = [s for s in args.sounds if s not in by_id]
    if missing:
        print(f"No sound named {', '.join(missing)} in {path.name}", file=sys.stderr)
        return 1
    if not args.sounds and not args.prompt:
        ap.print_help()
        return 1

    pipe = load()
    if args.prompt:
        render(pipe, "scratch", args.prompt, args.seconds, args.seeds or [1], args.steps, NEGATIVE)
    for sid in args.sounds:
        s = by_id[sid]
        render(pipe, sid, s["prompt"], s.get("seconds", 3.0), args.seeds or s.get("seeds", [1]), args.steps, s.get("negative", NEGATIVE))
    return 0


if __name__ == "__main__":
    sys.exit(main())
