"""Evolve heroes against demons.

    python -m arena.train --name run1 --gens 200
    python -m arena.train --name run1 --gens 400 --resume      # keep going

Writes to arena/runs/<name>/: log.jsonl, checkpoint.pkl and champions/gen_XXXX.pkl.
"""
from __future__ import annotations

import argparse
import json
import pickle
import time
from pathlib import Path

import numpy as np

from . import evolve

RUNS = Path(__file__).parent / "runs"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="run1")
    ap.add_argument("--gens", type=int, default=100, help="generations to run (this call)")
    ap.add_argument("--pop", type=int, default=32)
    ap.add_argument("--matches", type=int, default=4)
    ap.add_argument("--tmax", type=float, default=150.0)
    ap.add_argument("--tsd", type=float, default=70.0, help="when the void starts closing in")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--save-every", type=int, default=5)
    ap.add_argument("--champ-every", type=int, default=10)
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args(argv)

    run = RUNS / args.name
    run.mkdir(parents=True, exist_ok=True)
    ckpt = run / "checkpoint.pkl"
    rng = np.random.default_rng(args.seed)
    if args.resume and ckpt.exists():
        state, cfg = evolve.load_state(ckpt)
        cfg.tmax, cfg.tsd = args.tmax, args.tsd
        rng = np.random.default_rng(args.seed + state.gen)
        print(f"resumed {args.name} at generation {state.gen}")
    else:
        cfg = evolve.Config(pop=args.pop, matches=args.matches, tmax=args.tmax, tsd=args.tsd)
        state = evolve.init_state(cfg, rng)

    (run / "champions").mkdir(exist_ok=True)
    logf = open(run / "log.jsonl", "a")
    t0 = time.time()
    for _ in range(args.gens):
        g = state.gen
        log, ch, cd = evolve.step_generation(state, cfg, rng)
        log["elapsed"] = round(time.time() - t0, 1)
        logf.write(json.dumps(log) + "\n")
        logf.flush()
        print(f"gen {g:4d} | hero win {log['hero_win']:.2f} demon {log['demon_win']:.2f} "
              f"draw {log['draw']:.2f} | len {log['duration']:5.1f}s | "
              f"fit H {log['fit_h']:.2f}/{log['fit_h_max']:.2f} D {log['fit_d']:.2f}/{log['fit_d_max']:.2f} | "
              f"abil H {log['abilities_h']:.1f} D {log['abilities_d']:.1f} | "
              f"heal {log['heal_per_match']:.0f} raise {log['raises_per_match']:.1f} "
              f"casts {[round(c, 1) for c in log['casts_per_match']]} | {log['elapsed']:.0f}s",
              flush=True)
        if g % args.champ_every == 0:
            with open(run / "champions" / f"gen_{g:04d}.pkl", "wb") as f:
                pickle.dump({"gen": g, "heroes": ch, "demons": cd, "log": log}, f)
        if g % args.save_every == 0:
            evolve.save_state(state, cfg, ckpt)
    evolve.save_state(state, cfg, ckpt)
    with open(run / "unlocks.json", "w") as f:
        json.dump(state.unlocks, f)


if __name__ == "__main__":
    main()
