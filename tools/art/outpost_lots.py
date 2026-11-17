"""
Tidies the outpost sprites into clean lots (AW-260): public/assets/outpost-<clan>.png.

Background removal cut holes where an outpost's own ground matched the backdrop (the Midshipmen's and
Helm's pale yards), so the terrain showed through in ragged patches. This fills every hole with the
lot's ground color, rounds the corners, and draws a 1 px dark edge, so each outpost reads as one lot.

Idempotent: run it again on its own output and nothing changes but the edge.
Usage: python tools/art/outpost_lots.py [clan ...]
"""
import sys
from collections import Counter

from PIL import Image, ImageDraw

CLANS = ["lyceum", "freebooters", "diggers", "exchange", "covenant", "midshipmen", "helm"]
EDGE = (20, 16, 14, 255)
RADIUS = 9
# Lots whose holes are in something pale (a hull) rather than bare ground.
INPAINT = {"midshipmen"}


def ground(px, w, h) -> tuple:
    """The lot's ground: the commonest color touching a hole, or failing that, the edge of the lot."""
    near = Counter()
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    q = (x + dx, y + dy)
                    if 0 <= q[0] < w and 0 <= q[1] < h and px[q][3] > 0:
                        near[px[q][:3]] += 1
    if not near:
        for x in range(w):
            for y in (2, h - 3):
                if px[x, y][3] > 0:
                    near[px[x, y][:3]] += 1
    return near.most_common(1)[0][0]


def inpaint(px, w, h, fallback) -> dict:
    """Grow color into the holes a ring at a time: each hole pixel takes the mean of its filled
    neighbors, leaving out near-black outline pixels when anything lighter is beside it."""
    color = {(x, y): px[x, y][:3] for y in range(h) for x in range(w) if px[x, y][3] > 0}
    holes = {(x, y) for y in range(h) for x in range(w) if px[x, y][3] == 0}
    lum = lambda c: 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
    filled = {}
    while holes:
        ring = {}
        for x, y in holes:
            near = [color[q] for q in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1), (x + 1, y + 1), (x - 1, y - 1), (x + 1, y - 1), (x - 1, y + 1)) if q in color]
            if not near:
                continue
            light = [c for c in near if lum(c) >= 60] or near
            ring[(x, y)] = tuple(round(sum(c[i] for c in light) / len(light)) for i in range(3))
        if not ring:
            for q in holes:
                filled[q] = fallback[:3]
            break
        color.update(ring)
        filled.update(ring)
        holes -= set(ring)
    return filled


def tidy(clan: str) -> None:
    path = f"public/assets/outpost-{clan}.png"
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    g = ground(px, w, h) + (255,)
    # The lot: a rounded rectangle over the whole sprite.
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=RADIUS, fill=255)
    m = mask.load()
    # Fill each hole from its own surroundings, skipping dark outlines, so a pale hull fills pale.
    # Most lots fill flat with their ground; the Midshipmen's holes are in a pale hull, so they grow from around.
    filled = inpaint(px, w, h, g) if clan in INPAINT else {}
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    o = out.load()
    for y in range(h):
        for x in range(w):
            if m[x, y] == 0:
                continue
            p = px[x, y]
            o[x, y] = p[:3] + (255,) if p[3] > 0 else filled.get((x, y), g[:3]) + (255,)
    # A 1 px dark edge just inside the lot's outline.
    for y in range(h):
        for x in range(w):
            if m[x, y] and any(not (0 <= x + dx < w and 0 <= y + dy < h) or m[x + dx, y + dy] == 0 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                o[x, y] = EDGE
    out.save(path)
    print(f"{clan}: ground {g[:3]}")


for c in sys.argv[1:] or CLANS:
    tidy(c)
