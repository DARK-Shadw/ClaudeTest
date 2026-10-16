"""Shared constants: the brain's parameter layout, abilities, and ability drafting.

The simulation (sim.py) is compiled with numba, which freezes module-level
constants at compile time. After editing anything in this file, delete
arena/__pycache__ so the compiled simulation is rebuilt.
"""
from __future__ import annotations

import numpy as np

# --------------------------------------------------------------------------
# Brain architecture
#   self features  -> encoder ----------------\
#   entity tokens  -> embed -> 2-head attention -> GRU memory -> heads
#   heads: movement, action logits, per-slot ability scorer, target pointer
# --------------------------------------------------------------------------
D = 16          # embedding width
HID = 32        # GRU memory size
NHEAD = 2       # attention heads
XD = 2 * D      # GRU input = [self encoding, attention context]
SF = 12         # self features
TF = 22         # features per entity token
DF = 13         # features per ability slot (11 static + ready + cooldown)
DSF = 11        # static ability descriptor features (used by the draft head too)
SHD = 12        # hidden size of the shared ability-slot scorer
DRH = 8         # hidden size of the draft head

_off = 0


def _alloc(n: int) -> int:
    global _off
    start = _off
    _off += n
    return start


O_WS = _alloc(D * SF)
O_BS = _alloc(D)
O_WE = _alloc(D * TF)
O_BE = _alloc(D)
O_WK = _alloc(D * D)
O_WV = _alloc(D * D)
O_WQ = _alloc(D * D)
O_WZ = _alloc(HID * XD)
O_WR = _alloc(HID * XD)
O_WN = _alloc(HID * XD)
O_UZ = _alloc(HID * HID)
O_UR = _alloc(HID * HID)
O_UN = _alloc(HID * HID)
O_BZ = _alloc(HID)
O_BR = _alloc(HID)
O_BN = _alloc(HID)
O_WM = _alloc(2 * HID)
O_BM = _alloc(2)
O_WB = _alloc(2 * HID)      # logits for BASIC and DODGE (NONE is fixed at 0)
O_BB = _alloc(2)
O_WSH = _alloc(SHD * HID)   # shared scorer for ability slots: sees memory + descriptor
O_WSD = _alloc(SHD * DF)
O_BSL = _alloc(SHD)
O_VS = _alloc(SHD)
O_VB = _alloc(1)
O_WT = _alloc(D * HID)      # target pointer query
O_DRW = _alloc(DRH * DSF)   # draft head: scores candidate abilities when a slot unlocks
O_DRB = _alloc(DRH)
O_DRV = _alloc(DRH)
NPARAM = _off

# (offset, rows, cols, gain) for weight matrices; everything else starts at zero.
_MATRICES = [
    (O_WS, D, SF, 1.0), (O_WE, D, TF, 1.0),
    (O_WK, D, D, 1.0), (O_WV, D, D, 1.0), (O_WQ, D, D, 1.0),
    (O_WZ, HID, XD, 1.0), (O_WR, HID, XD, 1.0), (O_WN, HID, XD, 1.0),
    (O_UZ, HID, HID, 1.0), (O_UR, HID, HID, 1.0), (O_UN, HID, HID, 1.0),
    (O_WM, 2, HID, 0.8), (O_WB, 2, HID, 0.8),
    (O_WSH, SHD, HID, 1.0), (O_WSD, SHD, DF, 1.0),
    (O_WT, D, HID, 1.0),
    (O_DRW, DRH, DSF, 1.0),
]


def init_params(rng: np.random.Generator) -> np.ndarray:
    p = np.zeros(NPARAM)
    for off, rows, cols, gain in _MATRICES:
        p[off:off + rows * cols] = rng.normal(0.0, gain / np.sqrt(cols), rows * cols)
    p[O_VS:O_VS + SHD] = rng.normal(0.0, 0.5, SHD)
    p[O_DRV:O_DRV + DRH] = rng.normal(0.0, 0.5, DRH)
    p[O_BZ:O_BZ + HID] = 0.5      # lean towards remembering
    p[O_BB + 0] = 0.4             # a mild push to try attacking at all
    p[O_BB + 1] = -0.6            # and not to spam dodge
    return p


# --------------------------------------------------------------------------
# Characters
# --------------------------------------------------------------------------
ROLE_NAMES = ["Knight", "Archer", "Mage", "Cleric",
              "Brute", "Imp", "Warlock", "Necromancer", "Skeleton"]

# --------------------------------------------------------------------------
# Abilities. An ability is a row [type, power, range, cooldown, radius].
# Types are generic primitives so a brain can learn any of them through the
# same slot scorer, and so new primitives can be added later.
# --------------------------------------------------------------------------
A_PROJ, A_AOE, A_HEAL, A_SHIELD, A_HASTE, A_SUMMON, A_RAISE = range(7)
NATYPE = 7
ABILITY_NAMES = ["Power Shot", "Blast", "Heal", "Ward", "Haste", "Summon", "Raise Dead"]

# per type: power, range, cooldown, radius  (low, high)
_RANGES = {
    A_PROJ: ((12, 26), (8, 16), (3, 7), (0.3, 0.5)),
    A_AOE: ((12, 28), (5, 12), (4, 9), (1.6, 3.2)),
    A_HEAL: ((15, 40), (6, 12), (2.5, 6), (0.0, 0.0)),
    A_SHIELD: ((15, 40), (6, 12), (5, 10), (0.0, 0.0)),
    A_HASTE: ((1.3, 1.7), (6, 12), (6, 12), (0.0, 0.0)),
    A_SUMMON: ((1.0, 3.0), (0.0, 0.0), (7, 12), (0.0, 0.0)),
    A_RAISE: ((0.5, 1.2), (5, 12), (4, 8), (0.0, 0.0)),
}
POWER_SCALE = np.array([26.0, 28.0, 40.0, 40.0, 1.7, 3.0, 1.2])

# What each role can be offered when it levels up.
POOLS = {
    0: [A_AOE, A_SHIELD, A_HASTE, A_PROJ],
    1: [A_PROJ, A_AOE, A_HASTE, A_SHIELD],
    2: [A_AOE, A_PROJ, A_SHIELD, A_HASTE],
    3: [A_HEAL, A_SHIELD, A_HASTE, A_AOE],
    4: [A_AOE, A_HASTE, A_SHIELD, A_PROJ],
    5: [A_PROJ, A_HASTE, A_AOE, A_SHIELD],
    6: [A_AOE, A_PROJ, A_HEAL, A_SHIELD],
    7: [A_SUMMON, A_RAISE, A_PROJ, A_HEAL],
}

# Innate kit: the cleric heals, the necromancer summons, casters have a blast.
INNATE = {
    2: [A_AOE, 18.0, 11.0, 5.5, 2.2],
    3: [A_HEAL, 24.0, 9.0, 2.6, 0.0],
    6: [A_AOE, 18.0, 11.0, 5.5, 2.2],
    7: [A_SUMMON, 2.0, 0.0, 9.5, 0.0],
}

# Cumulative XP needed to unlock the 1st, 2nd and 3rd extra ability.
XP_THRESHOLDS = [120.0, 350.0, 700.0]
MAX_SLOTS = 3


def empty_abilities() -> np.ndarray:
    ab = np.zeros((MAX_SLOTS, 5))
    ab[:, 0] = -1.0
    return ab


def innate_abilities(role: int) -> np.ndarray:
    ab = empty_abilities()
    if role in INNATE:
        ab[0] = INNATE[role]
    return ab


def sample_ability(atype: int, rng: np.random.Generator) -> np.ndarray:
    (pl, ph), (rl, rh), (cl, ch), (dl, dh) = _RANGES[atype]
    power = rng.uniform(pl, ph)
    if atype == A_SUMMON:
        power = float(np.round(power))
    return np.array([atype, power, rng.uniform(rl, rh), rng.uniform(cl, ch),
                     rng.uniform(dl, dh)])


def mutate_ability(ab: np.ndarray, rng: np.random.Generator, strength: float = 0.12) -> np.ndarray:
    out = ab.copy()
    atype = int(ab[0])
    for k, key in ((1, "power"), (2, "range"), (3, "cd"), (4, "radius")):
        lo, hi = _RANGES[atype][k - 1]
        if hi == 0.0:
            continue
        # allow evolution a little room beyond the starting range
        v = ab[k] * np.exp(rng.normal(0.0, strength))
        out[k] = float(np.clip(v, lo * 0.7, hi * 1.5))
    if atype == A_SUMMON:
        out[1] = float(np.clip(np.round(out[1]), 1, 3))
    return out


def descriptor(ab: np.ndarray) -> np.ndarray:
    """Static, normalised features of an ability (what the brain 'reads')."""
    d = np.zeros(DSF)
    t = int(ab[0])
    d[t] = 1.0
    d[7] = ab[1] / POWER_SCALE[t]
    d[8] = ab[2] / 12.0
    d[9] = ab[3] / 10.0
    d[10] = ab[4] / 3.0
    return d


def draft_scores(params: np.ndarray, candidates: list[np.ndarray]) -> np.ndarray:
    """The character's own brain rates each offered ability."""
    w = params[O_DRW:O_DRW + DRH * DSF].reshape(DRH, DSF)
    b = params[O_DRB:O_DRB + DRH]
    v = params[O_DRV:O_DRV + DRH]
    return np.array([v @ np.tanh(w @ descriptor(c) + b) for c in candidates])


def draft(role: int, params: np.ndarray, owned_types: set[int],
          rng: np.random.Generator, offers: int = 3):
    """Offer random mutations from the role's pool; the brain picks one."""
    pool = [t for t in POOLS[role] if t not in owned_types] or list(POOLS[role])
    types = rng.choice(pool, size=min(offers, len(pool)), replace=False)
    cands = [sample_ability(int(t), rng) for t in types]
    scores = draft_scores(params, cands)
    return cands[int(np.argmax(scores))], cands
