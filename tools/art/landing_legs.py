"""
Sketches landing legs onto a hull's raw image, as the starting point for its landed sprite (AW-252).

Image-to-image keeps a ship's outline, so it won't grow legs from a prompt alone. This draws four
splayed struts with foot pads behind the hull, then generate.py repaints the sketch at a low denoise
so the legs pick up the pixel-art style. Output: tools/art/output/hull-<id>-landed/init.png, which the
manifest's "init" points at.

Usage: python tools/art/landing_legs.py [hull ...]   (default: every clan hull)
"""
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

OUTPUT = Path(__file__).resolve().parent / "output"
SOURCES = {"firstRate": 7102, "bulker": 7201, "scout": 7302, "listener": 7401, "corsair": 7502, "destroyer": 7603, "merchantman": 8201}
STRUT = (64, 66, 72)
STRUT_LIGHT = (104, 107, 114)
PAD = (88, 90, 96)
RIM = (36, 37, 42)
MARGIN = 320


def hull_mask(img: Image.Image, tolerance: float = 30.0) -> np.ndarray:
    """True where the ship is: flood-fill the background in from the border."""
    rgb = np.array(img.convert("RGB")).astype(np.int32)
    h, w = rgb.shape[:2]
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    near = np.sqrt(((rgb - np.median(border, axis=0)) ** 2).sum(axis=2)) < tolerance
    bg = np.zeros((h, w), dtype=bool)
    q = deque([(0, x) for x in range(w)] + [(h - 1, x) for x in range(w)] + [(y, 0) for y in range(h)] + [(y, w - 1) for y in range(h)])
    while q:
        y, x = q.popleft()
        if 0 <= y < h and 0 <= x < w and not bg[y, x] and near[y, x]:
            bg[y, x] = True
            q.extend([(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)])
    return ~bg


def sketch(hull: str) -> Path:
    raw = Image.open(OUTPUT / f"hull-{hull}" / f"{SOURCES[hull]}-raw.png").convert("RGB")
    # A margin of background all round, so legs on a wide hull don't run off the canvas.
    bg = tuple(int(v) for v in np.median(np.concatenate([np.array(raw)[0], np.array(raw)[-1]]), axis=0))
    src = Image.new("RGB", (raw.width + 2 * MARGIN, raw.height + 2 * MARGIN), bg)
    src.paste(raw, (MARGIN, MARGIN))
    mask = hull_mask(src)
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    bw, bh = x1 - x0, y1 - y0
    reach = max(70, int(0.17 * max(bw, bh)))
    width = max(18, int(0.035 * max(bw, bh)))
    legs = Image.new("RGB", src.size, (0, 0, 0))
    lmask = Image.new("L", src.size, 0)
    d, dm = ImageDraw.Draw(legs), ImageDraw.Draw(lmask)
    for frac, dy in ((0.3, -0.55), (0.78, 0.55)):
        row = int(y0 + frac * bh)
        cols = np.nonzero(mask[row])[0]
        if len(cols) == 0:
            continue
        for side, edge in ((-1, cols.min()), (1, cols.max())):
            start = (int(edge - side * width), row)
            end = (int(edge + side * reach), int(row + dy * reach))
            for draw, color, w in ((d, RIM, width + 8), (d, STRUT, width), (d, STRUT_LIGHT, max(4, width // 3))):
                draw.line([start, end], fill=color, width=w)
            dm.line([start, end], fill=255, width=width + 8)
            r = int(width * 1.3)
            d.ellipse([end[0] - r - 4, end[1] - r - 4, end[0] + r + 4, end[1] + r + 4], fill=RIM)
            d.ellipse([end[0] - r, end[1] - r, end[0] + r, end[1] + r], fill=PAD)
            dm.ellipse([end[0] - r - 4, end[1] - r - 4, end[0] + r + 4, end[1] + r + 4], fill=255)
    # Legs go behind the hull: paste them only where the ship isn't.
    out = src.copy()
    behind = np.array(lmask) > 0
    behind &= ~mask
    arr, larr = np.array(out), np.array(legs)
    arr[behind] = larr[behind]
    # Crop to a square around the ship and its legs, then back to the raw image's size.
    ys, xs = np.nonzero(mask | (np.array(lmask) > 0))
    cx, cy = (xs.min() + xs.max()) // 2, (ys.min() + ys.max()) // 2
    half = max(xs.max() - xs.min(), ys.max() - ys.min()) // 2 + 60
    sq = Image.fromarray(arr).crop((cx - half, cy - half, cx + half, cy + half)).resize(raw.size, Image.LANCZOS)
    folder = OUTPUT / f"hull-{hull}-landed"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "init.png"
    sq.save(path)
    return path


if __name__ == "__main__":
    for h in sys.argv[1:] or list(SOURCES):
        print(f"{h}: {sketch(h)}")
