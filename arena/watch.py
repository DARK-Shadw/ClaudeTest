"""Record champion matches from a training run and bundle them into one standalone
HTML page you can open in any browser.

    python -m arena.watch --run main --gens 0,50,100,latest --out arena/viewer/watch.html
"""
from __future__ import annotations

import argparse
import json
import pickle
from pathlib import Path

from .replay import build_replay

HERE = Path(__file__).parent
RUNS = HERE / "runs"
TEMPLATE = HERE / "viewer" / "index.html"
MARK = "/*__REPLAYS__*/[]"


def load_champs(run: Path):
    out = {}
    for p in sorted((run / "champions").glob("gen_*.pkl")):
        with open(p, "rb") as f:
            blob = pickle.load(f)
        out[blob["gen"]] = blob
    return out


def pick(champs: dict, spec: str):
    gens = sorted(champs)
    picked = []
    for token in spec.split(","):
        token = token.strip()
        if token in ("latest", "last"):
            picked.append(gens[-1])
        elif token == "all":
            picked.extend(gens)
        else:
            want = int(token)
            picked.append(min(gens, key=lambda g: abs(g - want)))
    seen, uniq = set(), []
    for g in picked:
        if g not in seen:
            seen.add(g)
            uniq.append(g)
    return uniq


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="main")
    ap.add_argument("--gens", default="0,latest")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--tmax", type=float, default=150.0)
    ap.add_argument("--tsd", type=float, default=70.0)
    ap.add_argument("--out", default=str(HERE / "viewer" / "watch.html"))
    args = ap.parse_args(argv)

    champs = load_champs(RUNS / args.run)
    replays = []
    for g in pick(champs, args.gens):
        c = champs[g]
        replays.append(build_replay(
            c["heroes"], c["demons"], seed=args.seed, tmax=args.tmax, tsd=args.tsd,
            title=f"Generation {g}", subtitle=f"Champion heroes vs champion demons · run “{args.run}”"))
        r = replays[-1]
        print(f"gen {g}: {r['winner']} in {r['duration']}s, {len(r['events'])} events")
    html = TEMPLATE.read_text().replace(MARK, json.dumps(replays, separators=(",", ":")))
    Path(args.out).write_text(html)
    print(f"wrote {args.out} ({len(html) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
