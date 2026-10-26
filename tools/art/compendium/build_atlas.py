"""Turn the picked candidates into the sprite atlas used by the Compendium overlay.

    python tools/art/compendium/build_atlas.py RAW_DIR [--preview preview.png]

Reads picks.json (key -> seed), and for each pick: cut out the flat background (flood fill from the border),
crop to the subject, fit it into a 64x64 cell with a clean box downscale, quantize to a small palette, and
write public/assets/compendium/atlas.webp (lossless, transparent) plus index.json:
    { "cell": 64, "cols": N, "width": W, "height": H, "sprites": { "flora:glass-reed": [col, row], ... } }
Needs Pillow and numpy.
"""
from __future__ import annotations

import argparse
import json
import math
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent.parent.parent / "public" / "assets" / "compendium"
CELL = 64
FIT = 60  # subject fits in FIT x FIT, centred in the cell
COLORS = 28


def cutout(img: Image.Image, tolerance: float) -> np.ndarray:
    """RGBA array: border-connected background pixels (near the border's median colour) made transparent."""
    arr = np.array(img.convert("RGBA"))
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3].astype(np.int32)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    near = np.sqrt(((rgb - bg) ** 2).sum(axis=2)) < tolerance
    seen = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.extend([(0, x), (h - 1, x)])
    for y in range(h):
        q.extend([(y, 0), (y, w - 1)])
    while q:
        y, x = q.popleft()
        if y < 0 or x < 0 or y >= h or x >= w or seen[y, x] or not near[y, x]:
            continue
        seen[y, x] = True
        q.extend([(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)])
    arr[seen, 3] = 0
    drop_specks(arr, max(6, h * w // 1500))
    return arr


def drop_specks(arr: np.ndarray, min_pixels: int) -> None:
    h, w = arr.shape[:2]
    opaque = arr[:, :, 3] > 0
    seen = np.zeros((h, w), dtype=bool)
    for sy in range(h):
        for sx in range(w):
            if seen[sy, sx] or not opaque[sy, sx]:
                continue
            comp = []
            q = deque([(sy, sx)])
            seen[sy, sx] = True
            while q:
                y, x = q.popleft()
                comp.append((y, x))
                for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                    if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and opaque[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            if len(comp) < min_pixels:
                for y, x in comp:
                    arr[y, x, 3] = 0


def sprite(raw: Image.Image, tolerance: float = 34.0) -> Image.Image:
    # work at half size so the flood fill stays quick; the box downscale to 64 wipes out the difference
    raw = raw.convert("RGB").resize((raw.width // 2, raw.height // 2), Image.BOX)
    rgba = Image.fromarray(cutout(raw, tolerance), "RGBA")
    bbox = rgba.getbbox()
    if not bbox:
        raise ValueError("empty cutout")
    rgba = rgba.crop(bbox)
    scale = FIT / max(rgba.size)
    w, h = max(1, round(rgba.width * scale)), max(1, round(rgba.height * scale))
    # premultiply-free box resize: colour and alpha separately so edges don't pick up the dark fringe
    a = np.array(rgba)
    alpha = Image.fromarray(a[:, :, 3], "L").resize((w, h), Image.BOX)
    fg = a.copy()
    fg[a[:, :, 3] == 0, :3] = a[a[:, :, 3] > 0, :3].mean(axis=0).astype(np.uint8)
    col = Image.fromarray(fg[:, :, :3], "RGB").resize((w, h), Image.BOX)
    col = col.quantize(colors=COLORS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    out = np.array(col.convert("RGBA"))
    out[:, :, 3] = np.where(np.array(alpha) >= 128, 255, 0)
    small = Image.fromarray(out, "RGBA")
    cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    cell.paste(small, ((CELL - w) // 2, (CELL - h) // 2))
    return cell


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("raw")
    ap.add_argument("--preview", default="")
    args = ap.parse_args()
    raw = Path(args.raw)
    picks: dict[str, int] = json.loads((HERE / "picks.json").read_text())
    tol: dict[str, float] = json.loads((HERE / "tolerances.json").read_text()) if (HERE / "tolerances.json").exists() else {}
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    keys = [e["key"] for e in manifest["entries"] if e["key"] in picks]
    cols = 11
    rows = math.ceil(len(keys) / cols)
    atlas = Image.new("RGBA", (cols * CELL, rows * CELL), (0, 0, 0, 0))
    index: dict[str, list[int]] = {}
    for i, key in enumerate(keys):
        f = raw / f"{key.replace(':', '_')}__{picks[key]}.png"
        cell = sprite(Image.open(f), tol.get(key, 34.0))
        atlas.paste(cell, ((i % cols) * CELL, (i // cols) * CELL))
        index[key] = [i % cols, i // cols]
    PUBLIC.mkdir(parents=True, exist_ok=True)
    atlas.save(PUBLIC / "atlas.webp", lossless=True, quality=100, method=6)
    (PUBLIC / "index.json").write_text(
        json.dumps({"cell": CELL, "cols": cols, "width": atlas.width, "height": atlas.height, "sprites": index}, indent=1) + "\n"
    )
    print(f"{len(keys)} sprites -> {PUBLIC / 'atlas.webp'} ({(PUBLIC / 'atlas.webp').stat().st_size} bytes)")
    if args.preview:
        bg = Image.new("RGBA", atlas.size, (17, 24, 41, 255))
        bg.alpha_composite(atlas)
        bg.resize((atlas.width * 2, atlas.height * 2), Image.NEAREST).save(args.preview)


if __name__ == "__main__":
    main()
