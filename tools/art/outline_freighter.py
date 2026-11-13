"""
Makes public/assets/freighter-surface.png from freighter-landed.png (AW-212): the landed freighter on the
surface map, readable on grey rock. Also writes public/assets/freighter.png, the same ship with its shadow
dropped, for the Shipyard (AW-253): the starter freighter has one look everywhere.

- The baked-in shadow (opaque grey-purple touching the outside) becomes translucent dark, so it darkens the
  ground under it instead of reading as more grey hull.
- Stray specks (under 8 pixels) join the shadow so they don't get outlined.
- The hull gets a 1 px dark outline and a 1 px amber rim outside it, so it stands out on light and dark ground.

Usage: python tools/art/outline_freighter.py
"""
from PIL import Image

SRC = "public/assets/freighter-landed.png"
DST = "public/assets/freighter-surface.png"
YARD = "public/assets/freighter.png"
SHADOW_RGB = (92, 83, 87)
SHADOW_OUT = (8, 6, 14, 110)
DARK = (24, 16, 10, 255)
AMBER = (255, 176, 56, 255)
PAD = 2
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))

im = Image.open(SRC).convert("RGBA")
W, H = im.size
px = im.load()


def inside(x, y):
    return 0 <= x < W and 0 <= y < H


def solid(x, y):
    return inside(x, y) and px[x, y][3] > 0


# Shadow: shadow-coloured pixels connected to the outside.
shadow = set()
stack = []
for y in range(H):
    for x in range(W):
        if solid(x, y) and px[x, y][:3] == SHADOW_RGB and any(not solid(x + dx, y + dy) for dx, dy in N4):
            shadow.add((x, y))
            stack.append((x, y))
while stack:
    x, y = stack.pop()
    for dx, dy in N4:
        q = (x + dx, y + dy)
        if q not in shadow and solid(*q) and px[q][:3] == SHADOW_RGB:
            shadow.add(q)
            stack.append(q)

# Specks: small hull components join the shadow.
seen = set()
for y in range(H):
    for x in range(W):
        if not solid(x, y) or (x, y) in shadow or (x, y) in seen:
            continue
        comp = [(x, y)]
        seen.add((x, y))
        i = 0
        while i < len(comp):
            a, b = comp[i]
            i += 1
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    q = (a + dx, b + dy)
                    if q not in seen and q not in shadow and solid(*q):
                        seen.add(q)
                        comp.append(q)
        if len(comp) < 8:
            shadow.update(comp)


def hull(x, y):
    return solid(x, y) and (x, y) not in shadow


out = Image.new("RGBA", (W + 2 * PAD, H + 2 * PAD), (0, 0, 0, 0))
o = out.load()
for x, y in shadow:
    o[x + PAD, y + PAD] = SHADOW_OUT
for y in range(-PAD, H + PAD):
    for x in range(-PAD, W + PAD):
        if hull(x, y):
            o[x + PAD, y + PAD] = px[x, y]
        elif any(hull(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
            o[x + PAD, y + PAD] = DARK
        elif any(hull(x + dx, y + dy) for dx in range(-2, 3) for dy in range(-2, 3) if abs(dx) + abs(dy) <= 3):
            o[x + PAD, y + PAD] = AMBER
out.save(DST)
print(f"wrote {DST} ({out.width}x{out.height})")

# The Shipyard's picture: hull pixels only, trimmed.
yard = Image.new("RGBA", (W, H), (0, 0, 0, 0))
y_px = yard.load()
for y in range(H):
    for x in range(W):
        if hull(x, y):
            y_px[x, y] = px[x, y]
yard = yard.crop(yard.getbbox())
yard.save(YARD)
print(f"wrote {YARD} ({yard.width}x{yard.height})")
