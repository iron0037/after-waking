"""Pack the chosen portrait sets into the atlas used by the crew windows.

    python tools/art/portraits/build_atlas.py RAW_DIR [--preview preview.png]

Reads picks.json (face id -> variant number; default 0) and, for each face and age band, takes
RAW_DIR/f<id>_a<band>_v<variant>.png: crop to a square bust, replace the (grey-ish) generated background by the UI navy,
box-downscale to 64x64, quantize, and paste into one atlas: row = face, column = age band.
Writes public/assets/portraits/atlas.webp (lossless) and index.json:
    { "cell": 64, "faces": N, "bands": 4, "width": 256, "height": 64*N }
Needs Pillow and numpy.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent.parent.parent / "public" / "assets" / "portraits"
CELL = 64
BANDS = 4
WORK = 256  # background removal happens at this size, then a 4:1 box downscale gives the cell
CROP = (56, 0, 712, 656)  # square bust, in the 768 px source
NAVY = (38, 54, 88)
COLORS = 26
TOLERANCE = 30.0


def fill_background(arr: np.ndarray, tolerance: float) -> tuple[np.ndarray, np.ndarray]:
    """Flood fill from the border: pixels connected to the border and close to its median colour become NAVY."""
    h, w = arr.shape[:2]
    rgb = arr.astype(np.int32)
    border = np.concatenate([rgb[0], rgb[:, 0], rgb[:, -1]])  # not the bottom edge: that is shoulders
    bg = np.median(border, axis=0)
    near = np.sqrt(((rgb - bg) ** 2).sum(axis=2)) < tolerance
    seen = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.append((0, x))
    for y in range(h):
        q.extend([(y, 0), (y, w - 1)])
    while q:
        y, x = q.popleft()
        if y < 0 or x < 0 or y >= h or x >= w or seen[y, x] or not near[y, x]:
            continue
        seen[y, x] = True
        q.extend([(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)])
    out = arr.copy()
    out[seen] = NAVY
    return out, seen


def cell_from(path: Path) -> Image.Image:
    im = Image.open(path).convert("RGB").crop(CROP).resize((WORK, WORK), Image.BOX)
    arr, bg = fill_background(np.array(im), TOLERANCE)
    small = Image.fromarray(arr, "RGB").resize((CELL, CELL), Image.BOX)
    q = np.array(small.quantize(colors=COLORS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB"))
    # the backdrop is a flat navy: wherever at least half of a 4x4 block was background
    mask = np.array(Image.fromarray(bg.astype(np.uint8) * 255, "L").resize((CELL, CELL), Image.BOX)) >= 128
    q[mask] = NAVY
    return Image.fromarray(q, "RGB")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("raw")
    ap.add_argument("--preview", default="")
    ap.add_argument("--faces", default="", help="only these faces (preview runs on a partial set)")
    args = ap.parse_args()
    raw = Path(args.raw)
    picks_path = HERE / "picks.json"
    picks: dict[str, int] = json.loads(picks_path.read_text()) if picks_path.exists() else {}
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    only = {int(x) for x in args.faces.split(",") if x}
    ids = [f["id"] for f in manifest["faces"] if not only or f["id"] in only]
    who = {f["id"]: f["who"] for f in manifest["faces"]}
    genders = "".join("f" if "woman" in who[fid] else "m" for fid in ids)
    atlas = Image.new("RGB", (BANDS * CELL, len(ids) * CELL), NAVY)
    for row, fid in enumerate(ids):
        v = int(picks.get(str(fid), 0))
        for band in range(BANDS):
            atlas.paste(cell_from(raw / f"f{fid}_a{band}_v{v}.png"), (band * CELL, row * CELL))
    if only:
        print("partial run: not writing the public atlas", file=sys.stderr)
    else:
        PUBLIC.mkdir(parents=True, exist_ok=True)
        atlas.save(PUBLIC / "atlas.webp", lossless=True, quality=100, method=6)
        (PUBLIC / "index.json").write_text(
            json.dumps({"cell": CELL, "faces": len(ids), "bands": BANDS, "width": atlas.width, "height": atlas.height, "genders": genders}, indent=1) + "\n"
        )
        print(f"{len(ids)} faces -> {PUBLIC / 'atlas.webp'} ({(PUBLIC / 'atlas.webp').stat().st_size} bytes)")
    if args.preview:
        atlas.resize((atlas.width * 3, atlas.height * 3), Image.NEAREST).save(args.preview)


if __name__ == "__main__":
    main()
