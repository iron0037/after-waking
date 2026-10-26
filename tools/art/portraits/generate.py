"""Generate crew portrait sets via the Stable Diffusion WebUI API.

    python tools/art/portraits/generate.py OUT_DIR [--faces 0,1,2] [--seed-base 5000] [--variant 0]

For each face: base (age band 0) via txt2img, then bands 1..3 via img2img from the base (same seed,
prompt gains age cues, denoise from manifest). Writes OUT_DIR/f<id>_a<band>_v<variant>.png.
Seeds: seed_base + id*10 + variant, so every set is reproducible. Use --variant to retry a face.
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import urllib.request
from pathlib import Path

API = "http://127.0.0.1:7860/sdapi/v1/"
HERE = Path(__file__).resolve().parent


def post(path: str, body: dict) -> bytes:
    req = urllib.request.Request(API + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        return base64.b64decode(json.load(r)["images"][0])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--faces", default="")
    ap.add_argument("--seed-base", type=int, default=5000)
    ap.add_argument("--variant", type=int, default=0)
    ap.add_argument("--base-only", action="store_true")
    ap.add_argument("--age-from-prev", action="store_true", help="derive each band from the previous band instead of the base")
    ap.add_argument("--denoise", default="", help="override denoise for bands 1..3, e.g. 0.35,0.4,0.45")
    args = ap.parse_args()
    m = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    only = {int(x) for x in args.faces.split(",") if x != ""}
    dn = [float(x) for x in args.denoise.split(",")] if args.denoise else []
    common = {"negative_prompt": m["negative"], "steps": 8, "cfg_scale": 2, "width": m["size"], "height": m["size"], "sampler_name": "DPM++ SDE", "scheduler": "Karras"}
    for f in m["faces"]:
        if only and f["id"] not in only:
            continue
        seed = args.seed_base + f["id"] * 10 + args.variant
        base_path = out / f"f{f['id']}_a0_v{args.variant}.png"
        prev = base_path
        for a in m["ages"]:
            p = out / f"f{f['id']}_a{a['band']}_v{args.variant}.png"
            if a["band"] > 0 and args.base_only:
                break
            if not p.exists():
                prompt = m["template"].format(who=f["who"], age=a["txt"].format(hair=f["hair"], style=f["style"]), clothes=f["clothes"])
                body = dict(common, prompt=prompt, seed=seed)
                if a["band"] > 0:
                    src = prev if args.age_from_prev else base_path
                    body["init_images"] = [base64.b64encode(src.read_bytes()).decode()]
                    body["denoising_strength"] = dn[a["band"] - 1] if dn else a["denoise"]
                    p.write_bytes(post("img2img", body))
                else:
                    p.write_bytes(post("txt2img", body))
                print(p.name, flush=True)
            prev = p
    return 0


if __name__ == "__main__":
    sys.exit(main())
