"""Deep genetic algorithm for the arena: two co-evolving populations of 4-character
teams (heroes and demons), a hall of fame to stop forgetting, XP, and the draft
that hands out new abilities when a character levels up."""
from __future__ import annotations

import pickle
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import sim
from .layout import (INNATE, MAX_SLOTS, NPARAM, XP_THRESHOLDS, draft,
                     empty_abilities, init_params, innate_abilities,
                     mutate_ability)

TEAM = 4


@dataclass
class Side:
    """One side's population. Arrays are indexed [team, character, ...]."""
    side: int                       # 0 heroes, 1 demons
    W: np.ndarray                   # (N, 4, NPARAM) brain weights
    AB: np.ndarray                  # (N, 4, 3, 5) ability slots
    XP: np.ndarray                  # (N, 4) lifetime experience of each character's lineage
    uid: np.ndarray                 # (N,) team lineage id

    @property
    def n(self) -> int:
        return self.W.shape[0]

    def take(self, idx) -> "Side":
        return Side(self.side, self.W[idx].copy(), self.AB[idx].copy(),
                    self.XP[idx].copy(), self.uid[idx].copy())


def new_side(side: int, n: int, rng: np.random.Generator) -> Side:
    W = np.stack([[init_params(rng) for _ in range(TEAM)] for _ in range(n)])
    AB = np.stack([[innate_abilities(side * TEAM + c) for c in range(TEAM)] for _ in range(n)])
    return Side(side, W, AB, np.zeros((n, TEAM)), np.arange(n))


@dataclass
class Config:
    pop: int = 32
    matches: int = 4              # opponents per team per generation
    hof_prob: float = 0.25        # share of opponents drawn from past champions
    hof_size: int = 40
    elites: int = 2
    parent_frac: float = 0.3
    crossover: float = 0.25
    sigma_lo: float = 0.008
    sigma_hi: float = 0.05
    ability_mut: float = 0.15
    tmax: float = 150.0
    tsd: float = 70.0


@dataclass
class State:
    gen: int
    heroes: Side
    demons: Side
    hof_h: list = field(default_factory=list)
    hof_d: list = field(default_factory=list)
    next_uid: int = 0
    unlocks: list = field(default_factory=list)   # story log


# ----------------------------------------------------------------- scoring ---
_HP = sim.RS[:8, 0]


def _contribution(cs_team: np.ndarray) -> np.ndarray:
    raw = (cs_team[:, sim.C_DMG] + 1.5 * cs_team[:, sim.C_HEAL]
           + 20.0 * cs_team[:, sim.C_RAISES] + 8.0 * cs_team[:, sim.C_KILLS])
    tot = raw.sum()
    return raw / tot if tot > 0 else np.full(TEAM, 0.25)


def score_match(S: np.ndarray, CS: np.ndarray, side: int):
    """Fitness and per-character XP for the evaluated `side` of one match."""
    own = slice(side * TEAM, side * TEAM + TEAM)
    foe_hp = _HP[(1 - side) * TEAM:(1 - side) * TEAM + TEAM].sum()
    own_hp = _HP[own].sum()
    result = S[0] if side == 0 else -S[0]          # +1 win, 0 draw, -1 loss
    dealt = min(CS[own, sim.C_DMG].sum() / foe_hp, 1.5)
    heal = min(CS[own, sim.C_HEAL].sum() / own_hp, 1.0)
    own_frac, foe_frac = S[2 + side], S[3 - side]
    # everyone has to pull their weight: a character who deals/heals/raises nothing
    # drags the whole team's score down
    work = (CS[own, sim.C_DMG] + 0.8 * CS[own, sim.C_HEAL] + 30.0 * CS[own, sim.C_RAISES]) / foe_hp
    participation = float(np.mean(np.minimum(work / 0.10, 1.0)))
    fit = (2.0 * (result > 0) + 0.7 * (result == 0) + 1.0 * dealt
           + 0.6 * (own_frac - foe_frac) + 0.25 * heal + 0.5 * participation)
    base = 4.0 if result > 0 else (1.5 if result == 0 else 0.4)
    share = _contribution(CS[own])
    xp = base + 4.0 * share * (1.0 + (result > 0))
    return fit, xp


def evaluate(state: State, cfg: Config, rng: np.random.Generator):
    """Everyone plays `cfg.matches` games against the other side; returns fitness,
    xp gains and logging data."""
    h, d = state.heroes, state.demons
    n = h.n
    pool_wh = np.concatenate([h.W] + [g["W"][None] for g in state.hof_h])
    pool_abh = np.concatenate([h.AB] + [g["AB"][None] for g in state.hof_h])
    pool_wd = np.concatenate([d.W] + [g["W"][None] for g in state.hof_d])
    pool_abd = np.concatenate([d.AB] + [g["AB"][None] for g in state.hof_d])

    hi, di, eside, eidx, vs_current = [], [], [], [], []
    for side in (0, 1):
        for i in range(n):
            for _ in range(cfg.matches):
                use_hof = (rng.random() < cfg.hof_prob and
                           len(state.hof_d if side == 0 else state.hof_h) > 0)
                if use_hof:
                    hof_n = len(state.hof_d if side == 0 else state.hof_h)
                    opp = n + int(rng.integers(hof_n))
                else:
                    opp = int(rng.integers(n))
                hi.append(i if side == 0 else opp)
                di.append(opp if side == 0 else i)
                eside.append(side)
                eidx.append(i)
                vs_current.append(not use_hof)
    hi = np.array(hi)
    di = np.array(di)
    eside = np.array(eside)
    eidx = np.array(eidx)
    vs_current = np.array(vs_current)
    m = len(hi)
    seeds = rng.integers(1, 2 ** 31 - 1, m)
    S = np.zeros((m, 8))
    CS = np.zeros((m, sim.NCH, sim.CSF))
    sim.run_batch(pool_wh, pool_abh, pool_wd, pool_abd, hi, di, seeds,
                  cfg.tmax, cfg.tsd, S, CS)

    fit = [np.zeros(n), np.zeros(n)]
    xp = [np.zeros((n, TEAM)), np.zeros((n, TEAM))]
    cnt = [np.zeros(n), np.zeros(n)]
    for k in range(m):
        s = eside[k]
        f, x = score_match(S[k], CS[k], s)
        fit[s][eidx[k]] += f
        xp[s][eidx[k]] += x
        cnt[s][eidx[k]] += 1
    for s in (0, 1):
        fit[s] /= cnt[s]
        xp[s] /= cnt[s][:, None]

    cur = vs_current & (eside == 0)          # each current-vs-current pairing counted once
    log = {
        "hero_win": float(np.mean(S[cur, 0] > 0)),
        "demon_win": float(np.mean(S[cur, 0] < 0)),
        "draw": float(np.mean(S[cur, 0] == 0)),
        "duration": float(np.mean(S[cur, 1])),
        "decisive": float(np.mean(S[cur, 7])),
        "heal_per_match": float(np.mean(CS[cur][:, :, sim.C_HEAL].sum(1))),
        "raises_per_match": float(np.mean(CS[cur][:, :, sim.C_RAISES].sum(1))),
        "casts_per_match": [float(np.mean(CS[cur][:, :, sim.C_S0 + i].sum(1))) for i in range(3)],
        "dodges_per_match": float(np.mean(CS[cur][:, :, sim.C_DODGE].sum(1))),
    }
    return fit, xp, log


# ---------------------------------------------------------------- breeding ---
def _extras_allowed(role: int) -> int:
    return MAX_SLOTS - (1 if role in INNATE else 0)


def _unlock(side: Side, t: int, c: int, rng, gen: int, story: list):
    role = side.side * TEAM + c
    ab = side.AB[t, c]
    while True:
        owned = int(np.sum(ab[:, 0] >= 0))
        extras = owned - (1 if role in INNATE else 0)
        if extras >= _extras_allowed(role) or owned >= MAX_SLOTS:
            return
        if side.XP[t, c] < XP_THRESHOLDS[extras]:
            return
        slot = int(np.argmax(ab[:, 0] < 0))
        owned_types = {int(x) for x in ab[:, 0] if x >= 0}
        chosen, cands = draft(role, side.W[t, c], owned_types, rng)
        ab[slot] = chosen
        story.append({"gen": gen, "side": side.side, "char": c, "uid": int(side.uid[t]),
                      "ability": [float(x) for x in chosen],
                      "offered": [int(x[0]) for x in cands]})


def breed(side: Side, fit: np.ndarray, xp_gain: np.ndarray, cfg: Config,
          rng: np.random.Generator, gen: int, next_uid: int, story: list):
    """Selection + crossover + mutation -> next generation of this side."""
    side.XP = side.XP + xp_gain
    n = side.n
    order = np.argsort(-fit)
    n_par = max(4, int(cfg.parent_frac * n))
    parents = order[:n_par]
    new = side.take(order[:cfg.elites])        # elites unchanged
    kids_W, kids_AB, kids_XP, kids_uid = [], [], [], []
    for _ in range(n - cfg.elites):
        pa = int(rng.choice(parents))
        W = side.W[pa].copy()
        AB = side.AB[pa].copy()
        XP = side.XP[pa].copy()
        if rng.random() < cfg.crossover:
            pb = int(rng.choice(parents))
            for c in range(TEAM):
                if rng.random() < 0.5:
                    W[c], AB[c], XP[c] = side.W[pb, c], side.AB[pb, c], side.XP[pb, c]
        sigma = float(np.exp(rng.uniform(np.log(cfg.sigma_lo), np.log(cfg.sigma_hi))))
        W += rng.normal(0.0, sigma, W.shape)
        for c in range(TEAM):
            for s in range(MAX_SLOTS):
                if AB[c, s, 0] >= 0 and rng.random() < cfg.ability_mut:
                    AB[c, s] = mutate_ability(AB[c, s], rng)
        kids_W.append(W)
        kids_AB.append(AB)
        kids_XP.append(XP)
        kids_uid.append(next_uid)
        next_uid += 1
    if kids_W:
        new.W = np.concatenate([new.W, np.stack(kids_W)])
        new.AB = np.concatenate([new.AB, np.stack(kids_AB)])
        new.XP = np.concatenate([new.XP, np.stack(kids_XP)])
        new.uid = np.concatenate([new.uid, np.array(kids_uid)])
    for t in range(cfg.elites, n):
        for c in range(TEAM):
            _unlock(new, t, c, rng, gen, story)
    return new, next_uid


def champion(side: Side, fit: np.ndarray, gen: int) -> dict:
    i = int(np.argmax(fit))
    return {"W": side.W[i].copy(), "AB": side.AB[i].copy(), "XP": side.XP[i].copy(),
            "uid": int(side.uid[i]), "gen": gen, "fit": float(fit[i])}


def add_hof(hof: list, champ: dict, size: int, rng: np.random.Generator):
    hof.append(champ)
    while len(hof) > size:
        # thin out the old guard but always keep the most recent champions
        del hof[int(rng.integers(0, len(hof) - 8))]


def init_state(cfg: Config, rng: np.random.Generator) -> State:
    return State(0, new_side(0, cfg.pop, rng), new_side(1, cfg.pop, rng),
                 next_uid=cfg.pop)


def step_generation(state: State, cfg: Config, rng: np.random.Generator):
    fit, xp, log = evaluate(state, cfg, rng)
    champ_h = champion(state.heroes, fit[0], state.gen)
    champ_d = champion(state.demons, fit[1], state.gen)
    add_hof(state.hof_h, champ_h, cfg.hof_size, rng)
    add_hof(state.hof_d, champ_d, cfg.hof_size, rng)
    story: list = []
    state.heroes, state.next_uid = breed(state.heroes, fit[0], xp[0], cfg, rng,
                                         state.gen, state.next_uid, story)
    state.demons, state.next_uid = breed(state.demons, fit[1], xp[1], cfg, rng,
                                         state.gen, state.next_uid, story)
    state.unlocks.extend(story)
    log.update({
        "gen": state.gen,
        "fit_h": float(fit[0].mean()), "fit_h_max": float(fit[0].max()),
        "fit_d": float(fit[1].mean()), "fit_d_max": float(fit[1].max()),
        "abilities_h": int(np.sum(state.heroes.AB[:, :, :, 0] >= 0)) / state.heroes.n,
        "abilities_d": int(np.sum(state.demons.AB[:, :, :, 0] >= 0)) / state.demons.n,
        "xp_h": float(state.heroes.XP.mean()), "xp_d": float(state.demons.XP.mean()),
        "unlocks": len(story),
    })
    state.gen += 1
    return log, champ_h, champ_d


def save_state(state: State, cfg: Config, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "wb") as f:
        pickle.dump({"state": state, "cfg": cfg}, f)
    tmp.replace(path)


def load_state(path: Path):
    with open(path, "rb") as f:
        blob = pickle.load(f)
    return blob["state"], blob["cfg"]
