"""Measure what evolved teams actually do, from recorded matches.

    python -m arena.analyze --run main --gen latest --matches 12
"""
from __future__ import annotations

import argparse
import pickle
from pathlib import Path

import numpy as np

from . import sim
from .layout import ROLE_NAMES

RUNS = Path(__file__).parent / "runs"


def _los_clear(x1, y1, x2, y2):
    for px, py, pr in sim.PIL:
        dx, dy = x2 - x1, y2 - y1
        l2 = dx * dx + dy * dy
        t = 0.0 if l2 < 1e-9 else np.clip(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1)
        if (x1 + t * dx - px) ** 2 + (y1 + t * dy - py) ** 2 < pr * pr:
            return False
    return True


def analyse(heroes: dict, demons: dict, seeds, tmax=150.0, tsd=70.0):
    n_roles = 8
    dist_sum = np.zeros(n_roles)
    dist_n = np.zeros(n_roles)
    cover_n = np.zeros(n_roles)
    exposed_n = np.zeros(n_roles)
    first_death = np.zeros(n_roles)
    focus = []
    healer_hits_first = 0
    out = {"matches": 0, "duration": [], "wins": {1: 0, 0: 0, -1: 0}}
    tot = np.zeros((n_roles, sim.CSF))
    for seed in seeds:
        rec = sim.record_match(heroes["W"], heroes["AB"], demons["W"], demons["AB"],
                               seed=int(seed), tmax=tmax, tsd=tsd)
        u, ev = rec["units"], rec["events"]
        out["matches"] += 1
        out["duration"].append(float(rec["summary"][1]))
        out["wins"][int(rec["summary"][0])] += 1
        tot += rec["stats"]
        for f in range(0, u.shape[0], 5):
            for i in range(n_roles):
                if u[f, i, 10] != 1:
                    continue
                foes = [j for j in range(n_roles) if u[f, j, 10] == 1 and (j // 4) != (i // 4)]
                if not foes:
                    continue
                d = [np.hypot(u[f, i, 0] - u[f, j, 0], u[f, i, 1] - u[f, j, 1]) for j in foes]
                dist_sum[i] += min(d)
                dist_n[i] += 1
                near = [j for j, dd in zip(foes, d) if dd < 14]
                if near:
                    clear = any(_los_clear(u[f, i, 0], u[f, i, 1], u[f, j, 0], u[f, j, 1]) for j in near)
                    (exposed_n if clear else cover_n)[i] += 1
        deaths = ev[(ev[:, 1] == sim.E_DEATH) & (ev[:, 3] < 8)]
        if len(deaths):
            for side in (0, 1):
                side_d = deaths[(deaths[:, 3] // 4) == side]
                if len(side_d):
                    first_death[int(side_d[0, 3])] += 1
        hits = ev[(ev[:, 1] == sim.E_HIT) & (ev[:, 2] >= 0) & (ev[:, 3] < 8)]
        for side in (0, 1):
            h = hits[(hits[:, 3] // 4) == side]
            if len(h) < 6:
                continue
            for w0 in range(0, int(h[-1, 0]) + 1, 100):      # 5-second windows
                win = h[(h[:, 0] >= w0) & (h[:, 0] < w0 + 100)]
                if len(win) >= 4:
                    counts = np.bincount(win[:, 3].astype(int) - side * 4, minlength=4)
                    focus.append(counts.max() / counts.sum())
    out["avg_dist"] = np.where(dist_n > 0, dist_sum / np.maximum(dist_n, 1), 0)
    out["cover_share"] = cover_n / np.maximum(cover_n + exposed_n, 1)
    out["first_death"] = first_death / max(out["matches"], 1)
    out["focus"] = float(np.mean(focus)) if focus else 0.0
    out["totals"] = tot / max(out["matches"], 1)
    return out


def report(o: dict) -> str:
    L = []
    d = np.array(o["duration"])
    L.append(f"{o['matches']} matches | hero wins {o['wins'][1]} | demon wins {o['wins'][-1]} | draws {o['wins'][0]}")
    L.append(f"duration: mean {d.mean():.0f}s, longest {d.max():.0f}s")
    L.append(f"focus fire: {o['focus'] * 100:.0f}% of hits in a 5s window land on the same target "
             f"(random would be ~25-40%)")
    L.append("")
    L.append(f"{'role':12s} {'dist to foe':>11s} {'in cover':>9s} {'1st to die':>10s} {'dmg':>6s} "
             f"{'heal':>6s} {'taken':>6s} {'dodges':>6s} {'raises':>6s} {'ability casts':>14s}")
    for i in range(8):
        t = o["totals"][i]
        L.append(f"{ROLE_NAMES[i]:12s} {o['avg_dist'][i]:11.1f} {o['cover_share'][i] * 100:8.0f}% "
                 f"{o['first_death'][i] * 100:9.0f}% {t[sim.C_DMG]:6.0f} {t[sim.C_HEAL]:6.0f} "
                 f"{t[sim.C_TAKEN]:6.0f} {t[sim.C_DODGE]:6.1f} {t[sim.C_RAISES]:6.1f} "
                 f"{t[sim.C_S0]:5.1f}/{t[sim.C_S1]:4.1f}/{t[sim.C_S2]:4.1f}")
    return "\n".join(L)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="main")
    ap.add_argument("--gen", default="latest")
    ap.add_argument("--matches", type=int, default=12)
    ap.add_argument("--tmax", type=float, default=150.0)
    ap.add_argument("--tsd", type=float, default=70.0)
    args = ap.parse_args(argv)
    files = sorted((RUNS / args.run / "champions").glob("gen_*.pkl"))
    f = files[-1] if args.gen == "latest" else next(p for p in files if int(p.stem[4:]) == int(args.gen))
    with open(f, "rb") as fh:
        blob = pickle.load(fh)
    print(f"{f.name}  (generation {blob['gen']})")
    o = analyse(blob["heroes"], blob["demons"], range(1, args.matches + 1), args.tmax, args.tsd)
    print(report(o))


if __name__ == "__main__":
    main()
