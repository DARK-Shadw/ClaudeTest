"""Turn a recorded match into compact JSON for the viewer."""
from __future__ import annotations

import base64

import numpy as np

from . import sim
from .layout import ABILITY_NAMES, ROLE_NAMES

_HERO_FIRST = ["Aldric", "Maren", "Eira", "Cael", "Thorne", "Lysa", "Bran", "Isolde",
               "Garrick", "Elowen", "Rowan", "Sera", "Dorian", "Wren", "Alaric", "Odette"]
_HERO_LAST = ["Dawnblade", "Brightwood", "the Steadfast", "Stormcaller", "Ashgrove",
              "the Unbroken", "Silverfern", "Highwind", "Oathkeeper", "the Kind"]
_DEMON_FIRST = ["Grakh", "Vyx", "Malzor", "Skree", "Azgul", "Nyxa", "Dreth", "Orrak",
                "Zul'ka", "Krael", "Vorn", "Xhal", "Moloch", "Ysmir", "Thrag", "Urzuk"]
_DEMON_LAST = ["the Flayer", "Ashmouth", "Hollowhorn", "the Insatiable", "Gravebloom",
               "Cinderfang", "the Whisper", "Bonecrown", "the Unmade", "Rotheart"]


def character_name(side: int, uid: int, char: int) -> str:
    rng = np.random.default_rng(uid * 977 + char * 31 + side * 7919)
    if side == 0:
        return f"{rng.choice(_HERO_FIRST)} {rng.choice(_HERO_LAST)}"
    return f"{rng.choice(_DEMON_FIRST)} {rng.choice(_DEMON_LAST)}"


def _b64(arr: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(arr.astype("<i2")).tobytes()).decode("ascii")


def encode_match(rec: dict) -> dict:
    u = rec["units"].astype(np.float64).copy()
    # x y hp maxhp shield face state anim team role alive
    scale = np.array([100, 100, 10, 10, 10, 1000, 1, 100, 1, 1, 1], dtype=np.float64)
    u = np.clip(np.round(u * scale), -32000, 32000)
    p = rec["proj"].astype(np.float64).copy()
    p = np.clip(np.round(p * np.array([100, 100, 1, 1, 100, 100])), -32000, 32000)
    z = rec["zones"].astype(np.float64).copy()
    z = np.clip(np.round(z * np.array([100, 100, 100, 1000, 1, 1])), -32000, 32000)
    v = np.round(rec["void"].astype(np.float64) * 100)
    ev = rec["events"]
    events = [[int(e[0]), int(e[1]), int(e[2]), int(e[3]), round(float(e[4]), 2),
               round(float(e[5]), 2), round(float(e[6]), 2)] for e in ev]
    return {"frames": int(u.shape[0]), "units": _b64(u), "proj": _b64(p),
            "zones": _b64(z), "void": _b64(v), "events": events}


def team_meta(side: int, team: dict) -> list[dict]:
    chars = []
    for c in range(4):
        role = side * 4 + c
        abil = []
        for s in range(3):
            row = team["AB"][c][s]
            if row[0] >= 0:
                abil.append({"type": int(row[0]), "name": ABILITY_NAMES[int(row[0])],
                             "power": round(float(row[1]), 1), "range": round(float(row[2]), 1),
                             "cd": round(float(row[3]), 1), "radius": round(float(row[4]), 1)})
        chars.append({"role": role, "title": ROLE_NAMES[role],
                      "name": character_name(side, team["uid"], c),
                      "xp": round(float(team["XP"][c]), 1), "abilities": abil})
    return chars


def build_replay(heroes: dict, demons: dict, *, seed: int, tmax: float, tsd: float,
                 title: str, subtitle: str = "") -> dict:
    rec = sim.record_match(heroes["W"], heroes["AB"], demons["W"], demons["AB"],
                           seed=seed, tmax=tmax, tsd=tsd)
    S = rec["summary"]
    winner = {1: "heroes", -1: "demons", 0: "draw"}[int(S[0])]
    cs = rec["stats"]
    stats = [{"damage": round(float(cs[i, sim.C_DMG])), "heal": round(float(cs[i, sim.C_HEAL])),
              "taken": round(float(cs[i, sim.C_TAKEN])), "kills": int(cs[i, sim.C_KILLS]),
              "raises": int(cs[i, sim.C_RAISES]),
              "casts": [int(cs[i, sim.C_S0 + k]) for k in range(3)],
              "dodges": int(cs[i, sim.C_DODGE])} for i in range(8)]
    meta = {
        "title": title, "subtitle": subtitle, "winner": winner,
        "duration": round(float(S[1]), 1), "seed": seed, "tsd": tsd, "tmax": tmax,
        "heroes": team_meta(0, heroes), "demons": team_meta(1, demons), "stats": stats,
        "arena": {"size": sim.ARENA, "pillars": sim.PIL.tolist(), "fps": 10, "dt": sim.DT,
                  "nu": sim.NU, "np": sim.NP, "nz": sim.NZ, "void_start": sim.VOID_START_R},
        "roles": ROLE_NAMES,
    }
    meta.update(encode_match(rec))
    return meta
