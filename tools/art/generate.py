"""Asset pipeline: manifest -> Stable Diffusion WebUI API -> pixel-snap -> palette -> cutout.

Usage (Stable Diffusion WebUI must be running with --api on 127.0.0.1:7860):
    python tools/art/generate.py                       # every asset, one variant each
    python tools/art/generate.py --only rover -n 4     # four seed variants of one asset
    python tools/art/generate.py --promote rover 4103  # copy a chosen variant into public/assets

Outputs land in tools/art/output/<id>/<seed>-raw.png and <seed>.png (processed).
Needs Pillow and numpy.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import shutil
import sys
import urllib.request
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "output"
PUBLIC = ROOT.parent.parent / "public" / "assets"
API = "http://127.0.0.1:7860/sdapi/v1/txt2img"


def load_manifest() -> dict:
    return json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))


def txt2img(prompt: str, negative: str, seed: int, opts: dict) -> Image.Image:
    body = {
        "prompt": prompt,
        "negative_prompt": negative,
        "seed": seed,
        "steps": opts["steps"],
        "cfg_scale": opts["cfg"],
        "sampler_name": opts["sampler"],
        "scheduler": opts["scheduler"],
        "width": opts["width"],
        "height": opts["height"],
    }
    req = urllib.request.Request(API, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as resp:
        data = json.load(resp)
    return Image.open(io.BytesIO(base64.b64decode(data["images"][0]))).convert("RGB")


def pixelate(img: Image.Image, factor: int, colors: int) -> Image.Image:
    """Average each factor x factor block to one pixel, then reduce to a fixed palette (no dithering)."""
    small = img.resize((img.width // factor, img.height // factor), Image.BOX)
    return small.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGBA")


def cutout(img: Image.Image, tolerance: float = 38.0) -> Image.Image:
    """Make the background transparent: flood-fill from the border through pixels near the border's median color."""
    arr = np.array(img)
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3].astype(np.int32)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    near = np.sqrt(((rgb - bg) ** 2).sum(axis=2)) < tolerance

    seen = np.zeros((h, w), dtype=bool)
    queue: deque[tuple[int, int]] = deque()
    for x in range(w):
        queue.extend([(0, x), (h - 1, x)])
    for y in range(h):
        queue.extend([(y, 0), (y, w - 1)])
    while queue:
        y, x = queue.popleft()
        if y < 0 or x < 0 or y >= h or x >= w or seen[y, x] or not near[y, x]:
            continue
        seen[y, x] = True
        queue.extend([(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)])

    arr[seen, 3] = 0
    drop_specks(arr, min_pixels=max(4, (h * w) // 800))
    out = Image.fromarray(arr, "RGBA")
    bbox = out.getbbox()
    return out.crop(bbox) if bbox else out


def drop_specks(arr: np.ndarray, min_pixels: int) -> None:
    """Clear opaque islands smaller than min_pixels (stray stars and noise around a sprite)."""
    h, w = arr.shape[:2]
    opaque = arr[:, :, 3] > 0
    seen = np.zeros((h, w), dtype=bool)
    for sy in range(h):
        for sx in range(w):
            if seen[sy, sx] or not opaque[sy, sx]:
                continue
            component = []
            queue = deque([(sy, sx)])
            seen[sy, sx] = True
            while queue:
                y, x = queue.popleft()
                component.append((y, x))
                for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                    if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and opaque[ny, nx]:
                        seen[ny, nx] = True
                        queue.append((ny, nx))
            if len(component) < min_pixels:
                for y, x in component:
                    arr[y, x, 3] = 0


def build(asset: dict, manifest: dict, seed: int) -> Path:
    opts = {**manifest["defaults"], **asset}
    prompt = f"{manifest['style']}, {asset['prompt']}"
    folder = OUTPUT / asset["id"]
    folder.mkdir(parents=True, exist_ok=True)
    raw = txt2img(prompt, manifest["negative"], seed, opts)
    raw.save(folder / f"{seed}-raw.png")
    img = pixelate(raw, opts["pixel"], opts["colors"])
    if opts["cutout"]:
        img = cutout(img)
    path = folder / f"{seed}.png"
    img.save(path)
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", help="asset id to generate")
    parser.add_argument("-n", "--variants", type=int, default=1, help="seeds to try per asset (seed, seed+1, ...)")
    parser.add_argument("--promote", nargs=2, metavar=("ID", "SEED"), help="copy a processed variant to public/assets")
    args = parser.parse_args()

    manifest = load_manifest()
    if args.promote:
        asset_id, seed = args.promote
        src = OUTPUT / asset_id / f"{seed}.png"
        if not src.exists():
            print(f"No variant at {src}", file=sys.stderr)
            return 1
        PUBLIC.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, PUBLIC / f"{asset_id}.png")
        print(f"Promoted {src.name} -> public/assets/{asset_id}.png")
        return 0

    assets = [a for a in manifest["assets"] if not args.only or a["id"] == args.only]
    if not assets:
        print(f"No asset named {args.only}", file=sys.stderr)
        return 1
    for asset in assets:
        for i in range(args.variants):
            seed = asset["seed"] + i
            print(f"{asset['id']} seed {seed} -> {build(asset, manifest, seed)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
