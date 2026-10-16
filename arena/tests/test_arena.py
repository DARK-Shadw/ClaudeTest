"""Invariants for the arena simulation, the evolution layer and the replay format."""
import base64

import numpy as np
import pytest

from arena import evolve, replay, sim
from arena.layout import (A_HEAL, A_RAISE, INNATE, NPARAM, POOLS, XP_THRESHOLDS,
                          descriptor, draft, init_params, innate_abilities)


def make_team(base, rng):
    W = np.stack([init_params(rng) for _ in range(4)])
    AB = np.stack([innate_abilities(base + r) for r in range(4)])
    return W, AB


@pytest.fixture(scope="module")
def teams():
    rng = np.random.default_rng(3)
    return make_team(0, rng), make_team(4, rng)


def test_param_layout_is_consistent():
    p = init_params(np.random.default_rng(0))
    assert p.shape == (NPARAM,)
    assert np.isfinite(p).all()


def test_match_is_deterministic(teams):
    (wh, abh), (wd, abd) = teams
    a = sim.record_match(wh, abh, wd, abd, seed=11, tmax=40.0, tsd=20.0)
    b = sim.record_match(wh, abh, wd, abd, seed=11, tmax=40.0, tsd=20.0)
    assert np.array_equal(a["units"], b["units"])
    assert np.array_equal(a["events"], b["events"])
    c = sim.record_match(wh, abh, wd, abd, seed=12, tmax=40.0, tsd=20.0)
    assert not np.array_equal(a["units"], c["units"])


def test_physical_invariants(teams):
    (wh, abh), (wd, abd) = teams
    rec = sim.record_match(wh, abh, wd, abd, seed=5, tmax=60.0, tsd=30.0)
    u = rec["units"]
    alive = u[:, :, 10] == 1
    x, y, hp, mx = u[:, :, 0], u[:, :, 1], u[:, :, 2], u[:, :, 3]
    assert (x[alive] >= 0).all() and (x[alive] <= sim.ARENA).all()
    assert (y[alive] >= 0).all() and (y[alive] <= sim.ARENA).all()
    assert (hp >= -1e-6).all()
    assert (hp[alive] <= mx[alive] + 1e-4).all()
    # nobody stands inside a pillar
    for px, py, pr in sim.PIL:
        d = np.hypot(x - px, y - py)
        assert (d[alive] >= pr - 0.2).all()
    # skeleton cap per team
    for team in (0, 1):
        sk = ((u[:, sim.NCH:, 10] == 1) & (u[:, sim.NCH:, 8] == team)).sum(axis=1)
        assert sk.max() <= sim.MAX_SKEL
    ticks = rec["events"][:, 0]
    assert (np.diff(ticks) >= 0).all()


def test_a_match_always_resolves_within_the_time_limit(teams):
    (wh, abh), (wd, abd) = teams
    rec = sim.record_match(wh, abh, wd, abd, seed=2, tmax=30.0, tsd=10.0)
    assert rec["summary"][1] <= 30.0 + sim.DT
    assert int(rec["summary"][0]) in (-1, 0, 1)


def test_batch_matches_single_runs(teams):
    (wh, abh), (wd, abd) = teams
    WH, ABH, WD, ABD = wh[None], abh[None], wd[None], abd[None]
    hi = np.zeros(3, dtype=np.int64)
    seeds = np.array([4, 5, 6])
    S = np.zeros((3, 8))
    CS = np.zeros((3, sim.NCH, sim.CSF))
    sim.run_batch(WH, ABH, WD, ABD, hi, hi, seeds, 40.0, 20.0, S, CS)
    for k, seed in enumerate(seeds):
        single = sim.record_match(wh, abh, wd, abd, seed=int(seed), tmax=40.0, tsd=20.0)
        assert np.allclose(S[k, :6], single["summary"][:6])
        assert np.allclose(CS[k], single["stats"])


def test_heal_never_overheals_and_is_credited(teams):
    (wh, abh), (wd, abd) = teams
    rec = sim.record_match(wh, abh, wd, abd, seed=9, tmax=60.0, tsd=40.0)
    heals = rec["events"][rec["events"][:, 1] == sim.E_HEAL]
    assert (heals[:, 4] >= 0).all()
    assert (heals[:, 2] != heals[:, 3]).all()          # nobody heals themself
    total = rec["stats"][:, sim.C_HEAL].sum()
    assert total == pytest.approx(heals[:, 4].sum(), rel=1e-6)


def test_draft_obeys_role_pool_and_prefers_unowned_types():
    rng = np.random.default_rng(1)
    params = init_params(rng)
    for role, pool in POOLS.items():
        chosen, cands = draft(role, params, set(), rng)
        assert int(chosen[0]) in pool
        assert all(int(c[0]) in pool for c in cands)
    chosen, cands = draft(3, params, {A_HEAL}, rng)
    assert A_HEAL not in [int(c[0]) for c in cands]
    assert descriptor(chosen).shape == (11,)


def test_unlocks_follow_xp_and_slot_limits():
    cfg = evolve.Config(pop=6, matches=1, tmax=20.0, tsd=10.0)
    rng = np.random.default_rng(0)
    side = evolve.new_side(0, 6, rng)
    story = []
    side.XP[:] = 0
    evolve._unlock(side, 0, 0, rng, 0, story)
    assert story == [] and (side.AB[0, 0, :, 0] >= 0).sum() == 0     # knight: nothing yet
    side.XP[0, 0] = XP_THRESHOLDS[0] + 1
    evolve._unlock(side, 0, 0, rng, 1, story)
    assert (side.AB[0, 0, :, 0] >= 0).sum() == 1
    side.XP[0, 0] = 10_000
    evolve._unlock(side, 0, 0, rng, 2, story)
    assert (side.AB[0, 0, :, 0] >= 0).sum() == 3                       # capped at three slots
    # the cleric already has an innate heal, so it can only gain two more
    side.XP[0, 3] = 10_000
    evolve._unlock(side, 0, 3, rng, 3, story)
    assert (side.AB[0, 3, :, 0] >= 0).sum() == 3
    assert side.AB[0, 3, 0, 0] == A_HEAL


def test_one_generation_runs_and_keeps_population_size():
    cfg = evolve.Config(pop=8, matches=2, tmax=25.0, tsd=10.0)
    rng = np.random.default_rng(0)
    state = evolve.init_state(cfg, rng)
    log, ch, cd = evolve.step_generation(state, cfg, rng)
    assert state.heroes.n == 8 and state.demons.n == 8
    assert state.gen == 1 and len(state.hof_h) == 1
    assert np.isfinite(state.heroes.W).all()
    assert 0.0 <= log["hero_win"] + log["demon_win"] + log["draw"] <= 1.0 + 1e-9


def test_replay_encoding_round_trips(teams):
    (wh, abh), (wd, abd) = teams
    heroes = {"W": wh, "AB": abh, "XP": np.zeros(4), "uid": 1}
    demons = {"W": wd, "AB": abd, "XP": np.zeros(4), "uid": 2}
    r = replay.build_replay(heroes, demons, seed=3, tmax=20.0, tsd=10.0, title="t")
    raw = np.frombuffer(base64.b64decode(r["units"]), dtype="<i2")
    assert raw.size == r["frames"] * sim.NU * sim.RUF
    assert len(r["heroes"]) == 4 and len(r["demons"]) == 4
    assert r["heroes"][3]["abilities"][0]["name"] == "Heal"
    names = {c["name"] for c in r["heroes"] + r["demons"]}
    assert len(names) == 8


def test_wards_and_heals_never_target_the_caster(teams):
    (wh, abh), (wd, abd) = teams
    # give every character a Ward in slot 1 so the rule is exercised
    abh = abh.copy()
    abd = abd.copy()
    abh[:, 1] = [3.0, 30.0, 9.0, 4.0, 0.0]
    abd[:, 1] = [3.0, 30.0, 9.0, 4.0, 0.0]
    rec = sim.record_match(wh, abh, wd, abd, seed=21, tmax=50.0, tsd=30.0)
    wards = rec["events"][rec["events"][:, 1] == sim.E_SHIELD]
    assert (wards[:, 2] != wards[:, 3]).all()
