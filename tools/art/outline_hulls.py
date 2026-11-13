"""
Makes public/assets/hull-<id>-surface.png from each clan hull's sprite (AW-251): the landed ship on the
surface map, readable on any ground, like freighter-surface.png (tools/art/outline_freighter.py).

- The hull gets a 1 px dark outline and a 1 px amber rim outside it.
- A see-through dark shadow falls down and to the right, so it sits on the ground.
- Specks under 8 pixels are dropped so they don't get outlined.

Usage: python tools/art/outline_hulls.py
"""
from PIL import Image

HULLS = ["firstRate", "bulker", "scout", "listener", "corsair", "destroyer", "merchantman"]
SHADOW_OUT = (8, 6, 14, 110)
SHADOW_OFFSET = (2, 3)
DARK = (24, 16, 10, 255)
AMBER = (255, 176, 56, 255)
PAD = 2  # must match SHIP_SPRITE_PAD in src/ui/screens/surface/mapDraw.ts


def surface(src: str, dst: str) -> None:
    im = Image.open(src).convert("RGBA")
    W, H = im.size
    px = im.load()
    hull = {(x, y) for y in range(H) for x in range(W) if px[x, y][3] >= 128}

    # Drop specks: 8-connected pieces under 8 pixels.
    seen: set = set()
    for start in list(hull):
        if start in seen:
            continue
        comp = [start]
        seen.add(start)
        i = 0
        while i < len(comp):
            a, b = comp[i]
            i += 1
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    q = (a + dx, b + dy)
                    if q in hull and q not in seen:
                        seen.add(q)
                        comp.append(q)
        if len(comp) < 8:
            hull.difference_update(comp)

    sx, sy = SHADOW_OFFSET
    out = Image.new("RGBA", (W + 2 * PAD + sx, H + 2 * PAD + sy), (0, 0, 0, 0))
    o = out.load()
    for x, y in hull:
        o[x + PAD + sx, y + PAD + sy] = SHADOW_OUT
    for y in range(-PAD, H + PAD):
        for x in range(-PAD, W + PAD):
            if (x, y) in hull:
                o[x + PAD, y + PAD] = px[x, y][:3] + (255,)
            elif any((x + dx, y + dy) in hull for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                o[x + PAD, y + PAD] = DARK
            elif any((x + dx, y + dy) in hull for dx in range(-2, 3) for dy in range(-2, 3) if abs(dx) + abs(dy) <= 3):
                o[x + PAD, y + PAD] = AMBER
    out.save(dst)
    print(f"wrote {dst} ({out.width}x{out.height})")


for h in HULLS:
    surface(f"public/assets/hull-{h}.png", f"public/assets/hull-{h}-surface.png")
