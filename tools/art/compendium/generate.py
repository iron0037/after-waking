"""Generate compendium sprite candidates via the Stable Diffusion WebUI API.

Usage (WebUI running with --api on 127.0.0.1:7860):
    python tools/art/compendium/generate.py OUT_DIR [-n 3] [--only key,key] [--seed-base 1000] [--start 0]

Writes OUT_DIR/<key with ':' -> '_'>__<seed>.png. Seeds are seed_base + index*100 + variant,
so every candidate is reproducible from the manifest. Chosen seeds go in picks.json (key -> seed);
build_atlas.py turns them into public/assets/compendium/.
Per-entry "subject" / "bg" / "kind" overrides live in manifest.json.
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import urllib.request
from pathlib import Path

API = "http://127.0.0.1:7860/sdapi/v1/txt2img"
HERE = Path(__file__).resolve().parent


def seed_for(index: int, variant: int, base: int) -> int:
    return base + index * 100 + variant


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("-n", type=int, default=3)
    ap.add_argument("--only", default="")
    ap.add_argument("--seed-base", type=int, default=1000)
    ap.add_argument("--start", type=int, default=0, help="first variant number")
    args = ap.parse_args()
    m = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    only = set(filter(None, args.only.split(",")))
    for i, e in enumerate(m["entries"]):
        if only and e["key"] not in only:
            continue
        for v in range(args.start, args.start + args.n):
            # variants >= wild_from_variant use the "<kind>_wild" template (plants grown from bare soil, no pot) when it exists
            wild = v >= m.get("wild_from_variant", 10**9) and e["kind"] + "_wild" in m["templates"]
            template = m["templates"][e["kind"] + "_wild" if wild else e["kind"]]
            prompt = template.format(subject=e.get("subject_wild", e["subject"]) if wild else e["subject"], bg=e.get("bg", m["bg"]))
            negative = m["negative"] + (", " + m["negative_wild"] if wild else "")
            seed = seed_for(i, v, args.seed_base)
            path = out / f"{e['key'].replace(':', '_')}__{seed}.png"
            if path.exists():
                continue
            body = {
                "prompt": prompt,
                "negative_prompt": negative,
                "seed": seed,
                "steps": 8,
                "cfg_scale": 2,
                "width": m["size"],
                "height": m["size"],
                "sampler_name": "DPM++ SDE",
                "scheduler": "Karras",
            }
            req = urllib.request.Request(API, json.dumps(body).encode(), {"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=900) as r:
                data = json.load(r)
            path.write_bytes(base64.b64decode(data["images"][0]))
            print(path.name, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
