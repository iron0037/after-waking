"""Generate composed art (big ships, title scenes) with MOSS-Image, then pixel-process it.

MOSS follows layout and composition far better than SDXL; use it for anything that isn't a
single small sprite. Runs inside the MOSS-Image venv (4-bit, fits an 8 GB GPU):

    E:/MOSS-Image/.venv/Scripts/python tools/art/moss.py intrepid --seeds 1 2 3 --size 1280 512
    E:/MOSS-Image/.venv/Scripts/python tools/art/moss.py intro-1 intro-2 --seeds 1 2 --size 1344 768

The prompt comes from manifest.json ("moss_prompt", falling back to "prompt"). Outputs land in
tools/art/output/<id>/moss-<seed>-raw.png and moss-<seed>.png (processed).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ART = Path(__file__).resolve().parent
MOSS_ROOT = Path("E:/MOSS-Image")
sys.path.insert(0, str(MOSS_ROOT))
sys.path.insert(0, str(ART))

import torch  # noqa: E402
from generate import process  # noqa: E402
from run_lowvram import load_pipeline_nf4  # noqa: E402

NEGATIVE = "worst quality, blurry, watermark, jpeg artifact, text, letters, logo, green hull"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("assets", nargs="+", help="one or more manifest ids; the model loads once")
    parser.add_argument("--seeds", type=int, nargs="+", default=[1])
    parser.add_argument("--size", type=int, nargs=2, metavar=("W", "H"), default=[1024, 1024])
    parser.add_argument("--steps", type=int, default=40)
    args = parser.parse_args()

    manifest = json.loads((ART / "manifest.json").read_text(encoding="utf-8"))
    by_id = {a["id"]: a for a in manifest["assets"]}
    missing = [a for a in args.assets if a not in by_id]
    if missing:
        print(f"No asset named {', '.join(missing)}", file=sys.stderr)
        return 1
    width, height = (v // 16 * 16 for v in args.size)

    pipe = load_pipeline_nf4(str(MOSS_ROOT / "models" / "MOSS-Image-SFT"), local_files_only=True)
    pipe.enable_model_cpu_offload()
    for asset_id in args.assets:
        render(pipe, by_id[asset_id], manifest, args.seeds, width, height, args.steps)
    return 0


def render(pipe, asset: dict, manifest: dict, seeds: list[int], width: int, height: int, steps: int) -> None:
    opts = {**manifest["defaults"], **asset}
    prompt = asset.get("moss_prompt", asset["prompt"])
    folder = ART / "output" / asset["id"]
    folder.mkdir(parents=True, exist_ok=True)
    for seed in seeds:
        image = pipe(
            prompt,
            negative_prompt=", ".join(filter(None, [NEGATIVE, asset.get("moss_negative")])),
            height=height,
            width=width,
            num_inference_steps=steps,
            guidance_scale=3.0,
            uncond_skip_layers=[22],
            generator=torch.Generator("cpu").manual_seed(seed),
        ).images[0].convert("RGB")
        image.save(folder / f"moss-{seed}-raw.png")
        processed = process(image, opts)
        processed.save(folder / f"moss-{seed}.png")
        print(f"{asset['id']} moss seed {seed} -> {folder / f'moss-{seed}.png'}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
