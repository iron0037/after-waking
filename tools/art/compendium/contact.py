"""Contact sheets of generated candidates, grouped by category.

    python tools/art/compendium/contact.py RAW_DIR SHEET_DIR [--picks picks.json]

One sheet per ~8 entries (3 candidates each, labelled key + seed). Picked seeds get a green frame.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
TILE = 240
PER_SHEET = 8


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("raw")
    ap.add_argument("out")
    ap.add_argument("--min-variant", type=int, default=0, help="only show candidates with variant number >= this")
    ap.add_argument("--picks", default=str(HERE / "picks.json"))
    args = ap.parse_args()
    raw, out = Path(args.raw), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    picks = json.loads(Path(args.picks).read_text()) if Path(args.picks).exists() else {}
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    groups: dict[str, list[dict]] = {}
    for e in manifest["entries"]:
        groups.setdefault(e["kind"] if e["kind"] in ("ore", "gem") else "flora", []).append(e)
    for gname, entries in groups.items():
        for s in range(0, len(entries), PER_SHEET):
            chunk = entries[s : s + PER_SHEET]
            cols = 2
            rows = (len(chunk) + 1) // 2
            sheet = Image.new("RGB", (cols * 3 * TILE, rows * (TILE + 16)), (20, 20, 28))
            d = ImageDraw.Draw(sheet)
            for i, e in enumerate(chunk):
                files = sorted(f for f in raw.glob(e["key"].replace(":", "_") + "__*.png") if int(f.stem.split("__")[1]) % 100 >= args.min_variant)
                if not files:
                    continue
                bx, by = (i % cols) * 3 * TILE, (i // cols) * (TILE + 16)
                d.text((bx + 4, by + 2), e["key"], fill=(255, 220, 120))
                for j, f in enumerate(files[:6]):
                    seed = int(re.search(r"__(\d+)\.png", f.name).group(1))
                    im = Image.open(f).convert("RGB").resize((TILE, TILE), Image.LANCZOS)
                    sheet.paste(im, (bx + (j % 3) * TILE, by + 14 + (j // 3) * 0))
                    d.text((bx + (j % 3) * TILE + 4, by + 16), str(seed), fill=(255, 255, 255))
                    if picks.get(e["key"]) == seed:
                        d.rectangle([bx + (j % 3) * TILE, by + 14, bx + (j % 3) * TILE + TILE - 1, by + 14 + TILE - 1], outline=(80, 255, 80), width=4)
            name = f"contact_{gname}{'_v' + str(args.min_variant) if args.min_variant else ''}_{s // PER_SHEET + 1}.png"
            sheet.save(out / name)
            print(name)


if __name__ == "__main__":
    main()
