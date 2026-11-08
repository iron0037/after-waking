"""Remove a flat drop shadow that Stable Diffusion painted under a sprite, then pixel-snap and cut out as usual.

The shadow is a uniform colour touching the background; the hull, even where it's the same gray, is
textured. So: flood out from the background through pixels near the shadow's colour that are locally
flat, paint them background, and run the normal pipeline.

    python tools/art/deshadow.py hull-bulker 7201 [--color 116,103,99] [--tol 14] [--flat 5]
Writes tools/art/output/<id>/<seed>-clean.png (raw, shadow removed) and <seed>.png (processed).
"""
from __future__ import annotations

import argparse
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate import OUTPUT, cutout, load_manifest, pixelate  # noqa: E402


def local_std(gray: np.ndarray, r: int) -> np.ndarray:
    """Standard deviation over a (2r+1)^2 window, via summed-area tables."""
    def box(a: np.ndarray) -> np.ndarray:
        p = np.pad(a, r + 1, mode="edge").cumsum(0).cumsum(1)
        k = 2 * r + 1
        return (p[k:, k:] - p[:-k, k:] - p[k:, :-k] + p[:-k, :-k])[: a.shape[0], : a.shape[1]] / (k * k)
    m = box(gray)
    return np.sqrt(np.maximum(0, box(gray * gray) - m * m))


def trim_fringe(img: Image.Image, passes: int = 2) -> Image.Image:
    """Drop opaque pixels hanging on by one neighbour or none: the rim the shadow leaves behind."""
    arr = np.array(img)
    for _ in range(passes):
        a = arr[:, :, 3] > 0
        n = np.zeros(a.shape, int)
        n[1:] += a[:-1]; n[:-1] += a[1:]; n[:, 1:] += a[:, :-1]; n[:, :-1] += a[:, 1:]
        arr[a & (n <= 1), 3] = 0
    out = Image.fromarray(arr, "RGBA")
    bbox = out.getbbox()
    return out.crop(bbox) if bbox else out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("id")
    ap.add_argument("seed")
    ap.add_argument("--color", default=None, help="shadow colour r,g,b (default: sampled automatically)")
    ap.add_argument("--tol", type=float, default=14.0)
    ap.add_argument("--flat", type=float, default=5.0, help="max local std-dev for a shadow pixel")
    ap.add_argument("--rim", type=float, default=0.85, help="pixels less than this far from background to shadow skip the flatness test")
    args = ap.parse_args()

    d = OUTPUT / args.id
    raw = np.array(Image.open(d / f"{args.seed}-raw.png").convert("RGB")).astype(np.float64)
    h, w = raw.shape[:2]
    border = np.concatenate([raw[0], raw[-1], raw[:, 0], raw[:, -1]])
    bg = np.median(border, axis=0)
    dist_bg = np.sqrt(((raw - bg) ** 2).sum(2))
    flat = local_std(raw.mean(2), 2) < args.flat
    shadow_c = np.array([float(v) for v in args.color.split(",")]) if args.color else None

    # Background: flood from the border through near-background pixels.
    bgmask = np.zeros((h, w), bool)
    q: deque[tuple[int, int]] = deque([(y, x) for x in range(w) for y in (0, h - 1)] + [(y, x) for y in range(h) for x in (0, w - 1)])
    while q:
        y, x = q.popleft()
        if 0 <= y < h and 0 <= x < w and not bgmask[y, x] and dist_bg[y, x] < 30:
            bgmask[y, x] = True
            q.extend([(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)])

    if shadow_c is None:
        # The commonest flat colour just outside the background.
        ring = np.zeros((h, w), bool)
        ring[1:] |= bgmask[:-1]; ring[:-1] |= bgmask[1:]; ring[:, 1:] |= bgmask[:, :-1]; ring[:, :-1] |= bgmask[:, 1:]
        cand = raw[ring & ~bgmask & flat]
        shadow_c = np.median(cand, axis=0)
    print("background", bg.round(), "shadow", np.round(shadow_c))
    # Near the blend between background and shadow (the anti-aliased rim is in between).
    seg = shadow_c - bg
    t = np.clip(((raw - bg) @ seg) / float(seg @ seg), 0, 1)
    near_sh = np.sqrt(((raw - (bg + t[..., None] * seg)) ** 2).sum(2)) < args.tol

    # Shadow: flood from the background through flat pixels near the shadow colour.
    sh = np.zeros((h, w), bool)
    ys, xs = np.nonzero(bgmask)
    q = deque(zip(ys.tolist(), xs.tolist()))
    seen = bgmask.copy()
    while q:
        y, x = q.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx]:
                seen[ny, nx] = True
                # The rim (part way to the shadow colour) needn't be flat; the shadow itself must be.
                if near_sh[ny, nx] and (flat[ny, nx] or t[ny, nx] < args.rim):
                    sh[ny, nx] = True
                    q.append((ny, nx))
    print(f"shadow pixels removed: {sh.sum()}")
    clean = raw.copy()
    clean[sh] = bg
    clean_img = Image.fromarray(clean.astype(np.uint8), "RGB")
    clean_img.save(d / f"{args.seed}-clean.png")

    asset = next(a for a in load_manifest()["assets"] if a["id"] == args.id)
    opts = {**load_manifest()["defaults"], **asset}
    out = pixelate(clean_img, opts["pixel"], opts["colors"])
    out = cutout(out) if opts["cutout"] else out
    out = trim_fringe(out)
    out.save(d / f"{args.seed}.png")
    print(f"-> {d / f'{args.seed}.png'} {out.size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
