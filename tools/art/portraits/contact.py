"""Contact sheets: faces as rows, four age bands as columns.

    python tools/art/portraits/contact.py RAW_DIR OUT_PNG [--faces 0,1,2] [--picks picks.json] [--variant 0] [--tile 200]

If picks.json (face id -> variant) exists, the picked variant is used for each face; otherwise --variant.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("raw")
    ap.add_argument("out")
    ap.add_argument("--faces", default="")
    ap.add_argument("--variant", type=int, default=0)
    ap.add_argument("--tile", type=int, default=200)
    ap.add_argument("--picks", default="")
    ap.add_argument("--all-variants", action="store_true", help="one row per (face, variant) found")
    args = ap.parse_args()
    raw = Path(args.raw)
    picks = json.loads(Path(args.picks).read_text()) if args.picks and Path(args.picks).exists() else {}
    m = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    ids = [int(x) for x in args.faces.split(",") if x] or [f["id"] for f in m["faces"]]
    rows: list[tuple[int, int]] = []
    for i in ids:
        if args.all_variants:
            rows += [(i, v) for v in range(10) if (raw / f"f{i}_a0_v{v}.png").exists()]
        else:
            rows.append((i, int(picks.get(str(i), args.variant))))
    t = args.tile
    sheet = Image.new("RGB", (4 * t, len(rows) * t), (20, 20, 28))
    d = ImageDraw.Draw(sheet)
    for r, (i, v) in enumerate(rows):
        for a in range(4):
            p = raw / f"f{i}_a{a}_v{v}.png"
            if p.exists():
                sheet.paste(Image.open(p).convert("RGB").resize((t, t), Image.LANCZOS), (a * t, r * t))
        d.text((4, r * t + 2), f"face {i} v{v}", fill=(255, 220, 120))
    sheet.save(args.out)
    print(args.out, sheet.size)


if __name__ == "__main__":
    main()
