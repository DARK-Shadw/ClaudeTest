"""Headless Heroes-vs-Demons arena. Everything here is numba-compiled so a whole
match, including every character's neural network, runs in a few milliseconds.

Units 0-3 are the heroes, 4-7 the demons, 8-19 are summoned skeletons.
"""
from __future__ import annotations

import math

import numpy as np
from numba import njit, prange

from .layout import *  # noqa: F401,F403  (brain offsets & ability constants)

# ----------------------------------------------------------------- world ---
ARENA = 32.0
DT = 0.05
DECIDE_EVERY = 2            # brains think at 10 Hz
NCH = 8
NSUM = 12
NU = NCH + NSUM
NP = 64                     # projectile slots
NZ = 16                     # ground-effect slots
NSLOT = 3
NTOK = 32
MAX_SKEL = 5                # per team
NPIL = 5
PIL = np.array([[11.0, 10.0, 1.6], [21.0, 22.0, 1.6], [11.0, 22.0, 1.6],
                [21.0, 10.0, 1.6], [16.0, 16.0, 1.8]])
ZDELAY = 0.7                # blasts are telegraphed this long
DODGE_CD = 2.5
DASH_TIME = 0.2
DASH_SPEED = 15.0
VOID_START_R = 24.0
VOID_RATE = 0.35
BIG = 1e30

# unit float columns
(X, Y, VX, VY, HP, MAXHP, SH, SHT, RAD, SPD, FACE, CDB, CDD, LOCK, HASTE, HSTR,
 INV, DASH, DVX, DVY, MVX, MVY, AB0, AB1, AB2, LIFE, ANIM) = range(27)
UF = 27
# unit int columns
TEAM, ROLE, KIND, ALIVE, CORPSE, OWNER, STATE = range(7)
IF = 7
# projectile columns
PA, PX, PY, PVX, PVY, PDMG, PTEAM, POWN, PRAD, PLIFE, PKIND = range(11)
PF = 11
# zone columns
ZA, ZX, ZY, ZR, ZDMG, ZT, ZTEAM, ZOWN, ZKIND = range(9)
ZF = 9
# per-character stats
C_DMG, C_HEAL, C_TAKEN, C_KILLS, C_RAISES, C_BASIC, C_DODGE, C_S0, C_S1, C_S2 = range(10)
CSF = 10
# replay frame widths
RUF = 11
RPF = 6
RZF = 6
# event types
(E_HIT, E_HEAL, E_SHIELD, E_HASTE, E_BLAST, E_EXPLODE, E_SUMMON, E_RAISE, E_DEATH,
 E_DODGE, E_SHOOT, E_SWING, E_IMPACT, E_CAST) = range(1, 15)

# hp, speed, radius, ranged?, dmg, range, cooldown, projectile speed
RS = np.array([
    [150.0, 3.8, 0.75, 0.0, 10.0, 1.9, 0.70, 0.0],     # knight
    [85.0, 4.4, 0.60, 1.0, 8.0, 15.0, 0.60, 18.0],     # archer
    [75.0, 4.0, 0.60, 1.0, 7.0, 12.0, 0.80, 12.0],     # mage
    [95.0, 4.0, 0.65, 1.0, 4.0, 10.0, 0.90, 14.0],     # cleric
    [160.0, 3.8, 0.80, 0.0, 11.0, 1.9, 0.75, 0.0],     # brute
    [80.0, 4.6, 0.55, 1.0, 8.0, 14.0, 0.60, 17.0],     # imp
    [78.0, 4.0, 0.60, 1.0, 7.0, 12.0, 0.80, 12.0],     # warlock
    [90.0, 4.0, 0.65, 1.0, 4.0, 10.0, 0.90, 14.0],     # necromancer
    [30.0, 3.4, 0.50, 0.0, 4.0, 1.5, 0.90, 0.0],       # skeleton
])
# starting formation (hero side; demons mirror x)
FORM = np.array([[7.5, 16.0], [4.5, 10.5], [4.5, 21.5], [2.5, 16.0]])
ABILITY_PROJ_SPEED = 15.0


# --------------------------------------------------------------- helpers ---
@njit(inline='always')
def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-x))


@njit(inline='always')
def seg_hit_t(x1, y1, x2, y2, cx, cy, r):
    """Closest-approach parameter along the segment if it passes within r, else -1."""
    dx = x2 - x1
    dy = y2 - y1
    l2 = dx * dx + dy * dy
    t = 0.0
    if l2 > 1e-12:
        t = ((cx - x1) * dx + (cy - y1) * dy) / l2
        if t < 0.0:
            t = 0.0
        elif t > 1.0:
            t = 1.0
    px = x1 + t * dx - cx
    py = y1 + t * dy - cy
    if px * px + py * py < r * r:
        return t
    return -1.0


@njit(inline='always')
def clear_line(x1, y1, x2, y2):
    for q in range(NPIL):
        if seg_hit_t(x1, y1, x2, y2, PIL[q, 0], PIL[q, 1], PIL[q, 2]) >= 0.0:
            return 0.0
    return 1.0


@njit(inline='always')
def emit(EV, EVN, typ, a, b, v, x, y):
    n = EVN[0]
    if n < EV.shape[0]:
        EV[n, 0] = EVN[1]
        EV[n, 1] = typ
        EV[n, 2] = a
        EV[n, 3] = b
        EV[n, 4] = v
        EV[n, 5] = x
        EV[n, 6] = y
        EVN[0] = n + 1


@njit
def deal_damage(U, I, CS, EV, EVN, tgt, amt, src):
    """Apply damage (shield first). `src` is the credited character or -1."""
    if I[tgt, ALIVE] == 0 or U[tgt, INV] > 0.0 or amt <= 0.0:
        return 0.0
    rest = amt
    if U[tgt, SH] > 0.0:
        absorbed = min(U[tgt, SH], rest)
        U[tgt, SH] -= absorbed
        rest -= absorbed
    dealt = min(rest, U[tgt, HP])
    U[tgt, HP] -= rest
    if tgt < NCH:
        CS[tgt, C_TAKEN] += dealt
        if src >= 0:
            CS[src, C_DMG] += dealt
    emit(EV, EVN, E_HIT, src, tgt, amt, U[tgt, X], U[tgt, Y])
    if U[tgt, HP] <= 0.0:
        U[tgt, HP] = 0.0
        I[tgt, ALIVE] = 0
        I[tgt, STATE] = 5
        U[tgt, ANIM] = 0.0
        U[tgt, MVX] = 0.0
        U[tgt, MVY] = 0.0
        if tgt < NCH:
            I[tgt, CORPSE] = 1
            if src >= 0:
                CS[src, C_KILLS] += 1
        emit(EV, EVN, E_DEATH, src, tgt, 0.0, U[tgt, X], U[tgt, Y])
    return dealt


@njit
def spawn_skeleton(U, I, SP, team, owner, x, y, hp, life):
    count = 0
    for i in range(NCH, NU):
        if I[i, ALIVE] == 1 and I[i, TEAM] == team:
            count += 1
    if count >= MAX_SKEL:
        return -1
    for k in range(NSUM):
        i = NCH + (SP[0] + k) % NSUM
        if I[i, ALIVE] == 0:
            SP[0] = (i - NCH + 1) % NSUM
            for c in range(UF):
                U[i, c] = 0.0
            U[i, X] = x
            U[i, Y] = y
            U[i, HP] = hp
            U[i, MAXHP] = hp
            U[i, RAD] = RS[8, 2]
            U[i, SPD] = RS[8, 1]
            U[i, FACE] = 0.0 if team == 0 else math.pi
            U[i, LIFE] = life
            U[i, CDB] = 0.6
            I[i, TEAM] = team
            I[i, ROLE] = 8
            I[i, KIND] = 1
            I[i, ALIVE] = 1
            I[i, CORPSE] = 0
            I[i, OWNER] = owner
            I[i, STATE] = 0
            return i
    return -1


@njit
def fire_projectile(P, team, owner, x, y, tx, ty, speed, dmg, rad, life, kind):
    for k in range(NP):
        if P[k, PA] == 0.0:
            dx = tx - x
            dy = ty - y
            d = math.hypot(dx, dy)
            if d < 1e-6:
                dx = 1.0
                dy = 0.0
                d = 1.0
            P[k, PA] = 1.0
            P[k, PX] = x
            P[k, PY] = y
            P[k, PVX] = dx / d * speed
            P[k, PVY] = dy / d * speed
            P[k, PDMG] = dmg
            P[k, PTEAM] = team
            P[k, POWN] = owner
            P[k, PRAD] = rad
            P[k, PLIFE] = life
            P[k, PKIND] = kind
            return k
    return -1


@njit
def add_zone(Z, team, owner, x, y, r, dmg, kind):
    for k in range(NZ):
        if Z[k, ZA] == 0.0:
            Z[k, ZA] = 1.0
            Z[k, ZX] = x
            Z[k, ZY] = y
            Z[k, ZR] = r
            Z[k, ZDMG] = dmg
            Z[k, ZT] = ZDELAY
            Z[k, ZTEAM] = team
            Z[k, ZOWN] = owner
            Z[k, ZKIND] = kind
            return k
    return -1


# ----------------------------------------------------------- observation ---
@njit
def observe(a, U, I, P, Z, tfrac, void_r, AB, selfv, TOK, TIDX, DESC,
            cand_d, cand_i):
    """Fill the self vector, the entity tokens and the ability descriptors.
    Returns the number of tokens."""
    myteam = I[a, TEAM]
    ax = U[a, X]
    ay = U[a, Y]
    mh = U[a, MAXHP]
    selfv[0] = U[a, HP] / mh
    selfv[1] = min(U[a, SH] / mh, 1.0)
    selfv[2] = ax / 16.0 - 1.0
    selfv[3] = ay / 16.0 - 1.0
    selfv[4] = U[a, VX] / 5.0
    selfv[5] = U[a, VY] / 5.0
    selfv[6] = U[a, CDD] / DODGE_CD
    selfv[7] = U[a, CDB] / max(RS[I[a, ROLE], 6], 0.1)
    selfv[8] = 1.0 if U[a, HASTE] > 0.0 else 0.0
    selfv[9] = min(U[a, LOCK] / 0.5, 1.0)
    dc = math.hypot(ax - 16.0, ay - 16.0)
    selfv[10] = max(min((void_r - dc) / 10.0, 1.5), -1.5)
    selfv[11] = tfrac

    for s in range(NSLOT):
        t = int(AB[a, s, 0])
        for c in range(DF):
            DESC[s, c] = 0.0
        if t >= 0:
            DESC[s, t] = 1.0
            DESC[s, 7] = AB[a, s, 1] / POWER_SCALE[t]
            DESC[s, 8] = AB[a, s, 2] / 12.0
            DESC[s, 9] = AB[a, s, 3] / 10.0
            DESC[s, 10] = AB[a, s, 4] / 3.0
            cdv = U[a, AB0 + s]
            DESC[s, 11] = 1.0 if cdv <= 0.0 else 0.0
            DESC[s, 12] = min(cdv / max(AB[a, s, 3], 0.1), 1.0)

    n = 0
    for j in range(NU):
        present_alive = I[j, ALIVE] == 1
        present_corpse = I[j, CORPSE] == 1
        if not (present_alive or present_corpse):
            continue
        for c in range(TF):
            TOK[n, c] = 0.0
        dx = U[j, X] - ax
        dy = U[j, Y] - ay
        d = math.hypot(dx, dy)
        ally = I[j, TEAM] == myteam
        TOK[n, 0] = 1.0 if ally else 0.0
        TOK[n, 1] = 0.0 if ally else 1.0
        if present_alive:
            TOK[n, 2 if I[j, KIND] == 0 else 3] = 1.0
        else:
            TOK[n, 4] = 1.0
        if I[j, KIND] == 0:
            TOK[n, 7 + I[j, ROLE] % 4] = 1.0
        TOK[n, 11] = dx / 16.0
        TOK[n, 12] = dy / 16.0
        TOK[n, 13] = d / 20.0
        TOK[n, 14] = (U[j, VX] - U[a, VX]) / 6.0
        TOK[n, 15] = (U[j, VY] - U[a, VY]) / 6.0
        if present_alive:
            TOK[n, 16] = U[j, HP] / U[j, MAXHP]
            TOK[n, 17] = min(U[j, SH] / U[j, MAXHP], 1.0)
            TOK[n, 18] = 1.0 if U[j, LOCK] > 0.0 else 0.0
            TOK[n, 21] = 1.0 if U[j, HASTE] > 0.0 else 0.0
        TOK[n, 19] = clear_line(ax, ay, U[j, X], U[j, Y])
        TIDX[n] = j
        n += 1

    # nearest hostile projectiles
    cnt = 0
    for k in range(NP):
        if P[k, PA] > 0.0 and int(P[k, PTEAM]) != myteam:
            d = math.hypot(P[k, PX] - ax, P[k, PY] - ay)
            if d < 14.0:
                cand_d[cnt] = d
                cand_i[cnt] = k
                cnt += 1
    for rep in range(min(cnt, 6)):
        bi = rep
        for q in range(rep + 1, cnt):
            if cand_d[q] < cand_d[bi]:
                bi = q
        td = cand_d[rep]
        ti = cand_i[rep]
        cand_d[rep] = cand_d[bi]
        cand_i[rep] = cand_i[bi]
        cand_d[bi] = td
        cand_i[bi] = ti
        k = cand_i[rep]
        for c in range(TF):
            TOK[n, c] = 0.0
        dx = P[k, PX] - ax
        dy = P[k, PY] - ay
        d = max(math.hypot(dx, dy), 1e-6)
        TOK[n, 1] = 1.0
        TOK[n, 5] = 1.0
        TOK[n, 11] = dx / 16.0
        TOK[n, 12] = dy / 16.0
        TOK[n, 13] = d / 20.0
        TOK[n, 14] = (P[k, PVX] - U[a, VX]) / 18.0
        TOK[n, 15] = (P[k, PVY] - U[a, VY]) / 18.0
        sp = max(math.hypot(P[k, PVX], P[k, PVY]), 1e-6)
        TOK[n, 20] = P[k, PDMG] / 20.0
        TOK[n, 21] = (P[k, PVX] * (-dx) + P[k, PVY] * (-dy)) / (sp * d)
        TOK[n, 19] = 1.0
        TIDX[n] = -1
        n += 1

    # nearest hostile blasts
    cnt = 0
    for k in range(NZ):
        if Z[k, ZA] > 0.0 and int(Z[k, ZTEAM]) != myteam:
            cand_d[cnt] = math.hypot(Z[k, ZX] - ax, Z[k, ZY] - ay)
            cand_i[cnt] = k
            cnt += 1
    for rep in range(min(cnt, 3)):
        bi = rep
        for q in range(rep + 1, cnt):
            if cand_d[q] < cand_d[bi]:
                bi = q
        td = cand_d[rep]
        ti = cand_i[rep]
        cand_d[rep] = cand_d[bi]
        cand_i[rep] = cand_i[bi]
        cand_d[bi] = td
        cand_i[bi] = ti
        k = cand_i[rep]
        for c in range(TF):
            TOK[n, c] = 0.0
        dx = Z[k, ZX] - ax
        dy = Z[k, ZY] - ay
        TOK[n, 1] = 1.0
        TOK[n, 6] = 1.0
        TOK[n, 11] = dx / 16.0
        TOK[n, 12] = dy / 16.0
        TOK[n, 13] = math.hypot(dx, dy) / 20.0
        TOK[n, 17] = Z[k, ZR] / 4.0
        TOK[n, 20] = Z[k, ZDMG] / 20.0
        TOK[n, 21] = Z[k, ZT] / ZDELAY
        TOK[n, 19] = 1.0
        TIDX[n] = -1
        n += 1
    return n


# ----------------------------------------------------------------- brain ---
@njit(fastmath=True)
def think(Pm, h, selfv, TOK, ntok, DESC, AB_a, out_move, out_logit, ptr,
          E, Kk, V, s, q, ctx, xin, zt, rt, nt, att, q2):
    # encode self
    for d in range(D):
        acc = Pm[O_BS + d]
        base = O_WS + d * SF
        for c in range(SF):
            acc += Pm[base + c] * selfv[c]
        s[d] = math.tanh(acc)
    # embed tokens, make keys and values
    for j in range(ntok):
        for d in range(D):
            acc = Pm[O_BE + d]
            base = O_WE + d * TF
            for c in range(TF):
                acc += Pm[base + c] * TOK[j, c]
            E[j, d] = math.tanh(acc)
        for d in range(D):
            ak = 0.0
            av = 0.0
            base = d * D
            for c in range(D):
                e = E[j, c]
                ak += Pm[O_WK + base + c] * e
                av += Pm[O_WV + base + c] * e
            Kk[j, d] = ak
            V[j, d] = av
    for d in range(D):
        acc = 0.0
        base = O_WQ + d * D
        for c in range(D):
            acc += Pm[base + c] * s[c]
        q[d] = acc
    # multi-head attention of the self query over the entities
    dh = D // NHEAD
    scale = 1.0 / math.sqrt(dh)
    for hd in range(NHEAD):
        mx = -BIG
        for j in range(ntok):
            sc = 0.0
            for c in range(dh):
                sc += q[hd * dh + c] * Kk[j, hd * dh + c]
            sc *= scale
            att[j] = sc
            if sc > mx:
                mx = sc
        sm = 0.0
        for j in range(ntok):
            att[j] = math.exp(att[j] - mx)
            sm += att[j]
        for c in range(dh):
            acc = 0.0
            for j in range(ntok):
                acc += att[j] * V[j, hd * dh + c]
            ctx[hd * dh + c] = acc / sm
    for d in range(D):
        xin[d] = s[d]
        xin[D + d] = ctx[d]
    # GRU memory
    for u in range(HID):
        az = Pm[O_BZ + u]
        ar = Pm[O_BR + u]
        an = Pm[O_BN + u]
        bx = u * XD
        for c in range(XD):
            xv = xin[c]
            az += Pm[O_WZ + bx + c] * xv
            ar += Pm[O_WR + bx + c] * xv
            an += Pm[O_WN + bx + c] * xv
        bh = u * HID
        hn = 0.0
        for c in range(HID):
            hv = h[c]
            az += Pm[O_UZ + bh + c] * hv
            ar += Pm[O_UR + bh + c] * hv
            hn += Pm[O_UN + bh + c] * hv
        zt[u] = sigmoid(az)
        rt[u] = sigmoid(ar)
        nt[u] = math.tanh(an + rt[u] * hn)
    for u in range(HID):
        h[u] = (1.0 - zt[u]) * nt[u] + zt[u] * h[u]
    # movement and base action logits
    for o in range(2):
        acc = Pm[O_BM + o]
        base = O_WM + o * HID
        for c in range(HID):
            acc += Pm[base + c] * h[c]
        out_move[o] = math.tanh(acc)
    out_logit[0] = 0.0
    for o in range(2):
        acc = Pm[O_BB + o]
        base = O_WB + o * HID
        for c in range(HID):
            acc += Pm[base + c] * h[c]
        out_logit[1 + o] = acc
    # ability slots share one scorer, so any ability type can sit in any slot
    hid_part = np.empty(SHD)
    for u in range(SHD):
        acc = 0.0
        base = O_WSH + u * HID
        for c in range(HID):
            acc += Pm[base + c] * h[c]
        hid_part[u] = acc
    for sl in range(NSLOT):
        if AB_a[sl, 0] < 0.0:
            out_logit[3 + sl] = -BIG
            continue
        tot = Pm[O_VB]
        for u in range(SHD):
            acc = Pm[O_BSL + u] + hid_part[u]
            base = O_WSD + u * DF
            for c in range(DF):
                acc += Pm[base + c] * DESC[sl, c]
            tot += Pm[O_VS + u] * math.tanh(acc)
        out_logit[3 + sl] = tot
    # target pointer
    for d in range(D):
        acc = 0.0
        base = O_WT + d * HID
        for c in range(HID):
            acc += Pm[base + c] * h[c]
        q2[d] = acc
    sc2 = 1.0 / math.sqrt(D)
    for j in range(ntok):
        acc = 0.0
        for c in range(D):
            acc += q2[c] * Kk[j, c]
        ptr[j] = acc * sc2


@njit
def intent_of(action, AB_a):
    """0 none, 1 enemy, 2 ally (self allowed), 3 corpse, 4 ally other than self."""
    if action <= 1:
        return 1 if action == 1 else 0
    if action == 2:
        return 0
    t = int(AB_a[action - 3, 0])
    if t == A_PROJ or t == A_AOE:
        return 1
    if t == A_HEAL or t == A_SHIELD:
        return 4            # heals and wards only work on others: no self-sustain loops
    if t == A_HASTE:
        return 2
    if t == A_RAISE:
        return 3
    return 0


# ----------------------------------------------------------------- match ---
@njit
def run_match(Wh, ABh, Wd, ABd, seed, tmax, tsd, S, CS, RU, RP, RZ, RV, EV, EVN):
    np.random.seed(seed)
    U = np.zeros((NU, UF))
    I = np.zeros((NU, IF), dtype=np.int64)
    P = np.zeros((NP, PF))
    Z = np.zeros((NZ, ZF))
    W = np.empty((NCH, NPARAM))
    AB = np.empty((NCH, NSLOT, 5))
    for c in range(4):
        W[c, :] = Wh[c]
        W[4 + c, :] = Wd[c]
        for s in range(NSLOT):
            for k in range(5):
                AB[c, s, k] = ABh[c, s, k]
                AB[4 + c, s, k] = ABd[c, s, k]
    for c in range(CS.shape[0]):
        for k in range(CSF):
            CS[c, k] = 0.0
    SP = np.zeros(1, dtype=np.int64)
    EVN[0] = 0
    EVN[1] = 0

    for c in range(NCH):
        team = c // 4
        r = c % 4
        px = FORM[r, 0] + np.random.uniform(-0.5, 0.5)
        py = FORM[r, 1] + np.random.uniform(-0.5, 0.5)
        if team == 1:
            px = ARENA - px
        U[c, X] = px
        U[c, Y] = py
        U[c, HP] = RS[c, 0]
        U[c, MAXHP] = RS[c, 0]
        U[c, RAD] = RS[c, 2]
        U[c, SPD] = RS[c, 1]
        U[c, FACE] = 0.0 if team == 0 else math.pi
        U[c, CDB] = 0.5
        U[c, HSTR] = 1.0
        for s in range(NSLOT):
            if AB[c, s, 0] >= 0.0:
                U[c, AB0 + s] = AB[c, s, 3] * 0.4
        I[c, TEAM] = team
        I[c, ROLE] = c
        I[c, KIND] = 0
        I[c, ALIVE] = 1
        I[c, OWNER] = -1

    # scratch
    hstate = np.zeros((NCH, HID))
    selfv = np.zeros(SF)
    TOK = np.zeros((NTOK, TF))
    TIDX = np.zeros(NTOK, dtype=np.int64)
    DESC = np.zeros((NSLOT, DF))
    cand_d = np.zeros(NP + NZ)
    cand_i = np.zeros(NP + NZ, dtype=np.int64)
    out_move = np.zeros(2)
    out_logit = np.zeros(6)
    ptr = np.zeros(NTOK)
    E = np.zeros((NTOK, D))
    Kk = np.zeros((NTOK, D))
    V = np.zeros((NTOK, D))
    s_ = np.zeros(D)
    q = np.zeros(D)
    ctx = np.zeros(D)
    xin = np.zeros(XD)
    zt = np.zeros(HID)
    rt = np.zeros(HID)
    nt = np.zeros(HID)
    att = np.zeros(NTOK)
    q2 = np.zeros(D)
    dec_act = np.zeros(NCH, dtype=np.int64)
    dec_tgt = np.zeros(NCH, dtype=np.int64)

    recording = RU.shape[0] > 0
    maxticks = int(tmax / DT)
    winner = 0
    ended = False
    final_t = tmax
    nframes = 0
    void_r = VOID_START_R

    for tick in range(maxticks):
        t = tick * DT
        EVN[1] = tick
        if t < tsd:
            void_r = VOID_START_R
        else:
            void_r = max(3.0, VOID_START_R - (t - tsd) * VOID_RATE)

        # ---- phase 1: every living character thinks about the same snapshot
        if tick % DECIDE_EVERY == 0:
            tfrac = t / tmax
            for a in range(NCH):
                dec_act[a] = 0
                dec_tgt[a] = -1
                if I[a, ALIVE] == 0:
                    continue
                ntok = observe(a, U, I, P, Z, tfrac, void_r, AB, selfv, TOK, TIDX,
                               DESC, cand_d, cand_i)
                think(W[a], hstate[a], selfv, TOK, ntok, DESC, AB[a], out_move,
                      out_logit, ptr, E, Kk, V, s_, q, ctx, xin, zt, rt, nt, att, q2)
                mx = out_move[0]
                my = out_move[1]
                mm = math.hypot(mx, my)
                if mm > 1.0:
                    mx /= mm
                    my /= mm
                U[a, MVX] = mx
                U[a, MVY] = my
                # pick the best currently-possible action
                best = 0
                bestv = out_logit[0]
                if U[a, CDB] <= 0.0 and out_logit[1] > bestv:
                    best = 1
                    bestv = out_logit[1]
                if U[a, CDD] <= 0.0 and out_logit[2] > bestv:
                    best = 2
                    bestv = out_logit[2]
                for sl in range(NSLOT):
                    if AB[a, sl, 0] >= 0.0 and U[a, AB0 + sl] <= 0.0 and out_logit[3 + sl] > bestv:
                        best = 3 + sl
                        bestv = out_logit[3 + sl]
                intent = intent_of(best, AB[a])
                if intent > 0:
                    bj = -1
                    bv = -BIG
                    for j in range(ntok):
                        u = TIDX[j]
                        if u < 0:
                            continue
                        ok = False
                        if intent == 1:
                            ok = I[u, ALIVE] == 1 and I[u, TEAM] != I[a, TEAM]
                        elif intent == 2:
                            ok = I[u, ALIVE] == 1 and I[u, TEAM] == I[a, TEAM]
                        elif intent == 4:
                            ok = I[u, ALIVE] == 1 and I[u, TEAM] == I[a, TEAM] and u != a
                        else:
                            ok = I[u, CORPSE] == 1
                        if ok and ptr[j] > bv:
                            bv = ptr[j]
                            bj = u
                    if bj < 0:
                        best = 0
                    dec_tgt[a] = bj
                dec_act[a] = best

            # ---- phase 2: execute, starting from a rotating index for fairness
            for off in range(NCH):
                a = (tick // DECIDE_EVERY + off) % NCH
                act = dec_act[a]
                if act == 0 or I[a, ALIVE] == 0:
                    continue
                if U[a, LOCK] > 0.0 or U[a, DASH] > 0.0:
                    continue
                role = I[a, ROLE]
                team = I[a, TEAM]
                ax = U[a, X]
                ay = U[a, Y]
                hf = U[a, HSTR] if U[a, HASTE] > 0.0 else 1.0
                if act == 2:
                    dxm = U[a, MVX]
                    dym = U[a, MVY]
                    mm = math.hypot(dxm, dym)
                    if mm < 0.25:
                        dxm = -math.cos(U[a, FACE])
                        dym = -math.sin(U[a, FACE])
                        mm = 1.0
                    U[a, DVX] = dxm / mm * DASH_SPEED
                    U[a, DVY] = dym / mm * DASH_SPEED
                    U[a, DASH] = DASH_TIME
                    U[a, INV] = DASH_TIME + 0.05
                    U[a, CDD] = DODGE_CD
                    I[a, STATE] = 4
                    U[a, ANIM] = 0.0
                    CS[a, C_DODGE] += 1.0
                    emit(EV, EVN, E_DODGE, a, a, 0.0, ax, ay)
                    continue
                tgt = dec_tgt[a]
                if tgt < 0:
                    continue
                tx = U[tgt, X]
                ty = U[tgt, Y]
                dist = math.hypot(tx - ax, ty - ay)
                # projectiles lead a moving target (one-step intercept estimate)
                lx = tx
                ly = ty
                if act == 1:
                    pspd = RS[role, 7]
                else:
                    pspd = ABILITY_PROJ_SPEED
                if pspd > 0.0:
                    t_fly = dist / pspd
                    lx = min(max(tx + U[tgt, VX] * t_fly, 0.0), ARENA)
                    ly = min(max(ty + U[tgt, VY] * t_fly, 0.0), ARENA)
                if act == 1:
                    if RS[role, 3] == 0.0:
                        reach = RS[role, 5] + U[tgt, RAD] + U[a, RAD]
                        if dist <= reach:
                            U[a, FACE] = math.atan2(ty - ay, tx - ax)
                            emit(EV, EVN, E_SWING, a, tgt, 0.0, ax, ay)
                            deal_damage(U, I, CS, EV, EVN, tgt, RS[role, 4], a)
                            U[a, CDB] = RS[role, 6] / hf
                            U[a, LOCK] = 0.25
                            I[a, STATE] = 2
                            U[a, ANIM] = 0.0
                            CS[a, C_BASIC] += 1.0
                        else:
                            U[a, LOCK] = 0.05
                    else:
                        U[a, FACE] = math.atan2(ty - ay, tx - ax)
                        life = RS[role, 5] / RS[role, 7]
                        fire_projectile(P, team, a, ax, ay, lx, ly, RS[role, 7],
                                        RS[role, 4], 0.3, life, role)
                        emit(EV, EVN, E_SHOOT, a, tgt, 0.0, ax, ay)
                        U[a, CDB] = RS[role, 6] / hf
                        U[a, LOCK] = 0.2
                        I[a, STATE] = 2
                        U[a, ANIM] = 0.0
                        CS[a, C_BASIC] += 1.0
                    continue
                # ability slot
                sl = act - 3
                at = int(AB[a, sl, 0])
                pw = AB[a, sl, 1]
                rg = AB[a, sl, 2]
                cdv = AB[a, sl, 3]
                rd = AB[a, sl, 4]
                done = False
                if at == A_PROJ:
                    if dist <= rg + 1.0:
                        U[a, FACE] = math.atan2(ty - ay, tx - ax)
                        fire_projectile(P, team, a, ax, ay, lx, ly, ABILITY_PROJ_SPEED,
                                        pw, 0.4, (rg + 1.0) / ABILITY_PROJ_SPEED, 20 + role)
                        emit(EV, EVN, E_CAST, a, tgt, at, ax, ay)
                        done = True
                elif at == A_AOE:
                    if dist <= rg:
                        U[a, FACE] = math.atan2(ty - ay, tx - ax)
                        add_zone(Z, team, a, tx, ty, rd, pw, role)
                        emit(EV, EVN, E_BLAST, a, tgt, rd, tx, ty)
                        done = True
                elif at == A_HEAL:
                    if dist <= rg:
                        got = min(pw, U[tgt, MAXHP] - U[tgt, HP])
                        U[tgt, HP] += got
                        CS[a, C_HEAL] += got
                        emit(EV, EVN, E_HEAL, a, tgt, got, tx, ty)
                        done = True
                elif at == A_SHIELD:
                    if dist <= rg:
                        U[tgt, SH] = min(U[tgt, SH] + pw, U[tgt, MAXHP] * 0.6)
                        U[tgt, SHT] = 6.0
                        emit(EV, EVN, E_SHIELD, a, tgt, pw, tx, ty)
                        done = True
                elif at == A_HASTE:
                    if dist <= rg:
                        U[tgt, HASTE] = 3.5
                        U[tgt, HSTR] = pw
                        emit(EV, EVN, E_HASTE, a, tgt, pw, tx, ty)
                        done = True
                elif at == A_SUMMON:
                    n_sum = int(round(pw))
                    for k in range(n_sum):
                        ang = np.random.uniform(0.0, 2.0 * math.pi)
                        nx = min(max(ax + 1.4 * math.cos(ang), 0.6), ARENA - 0.6)
                        ny = min(max(ay + 1.4 * math.sin(ang), 0.6), ARENA - 0.6)
                        sk = spawn_skeleton(U, I, SP, team, a, nx, ny, 30.0, 28.0)
                        if sk >= 0:
                            emit(EV, EVN, E_SUMMON, a, sk, 0.0, nx, ny)
                            done = True
                elif at == A_RAISE:
                    if dist <= rg and I[tgt, CORPSE] == 1:
                        I[tgt, CORPSE] = 0
                        sk = spawn_skeleton(U, I, SP, team, a, tx, ty, 40.0 * pw, 30.0)
                        if sk >= 0:
                            CS[a, C_RAISES] += 1.0
                            emit(EV, EVN, E_RAISE, a, sk, tgt, tx, ty)
                            done = True
                        else:
                            I[tgt, CORPSE] = 1
                if done:
                    U[a, AB0 + sl] = cdv
                    U[a, LOCK] = 0.4
                    I[a, STATE] = 3
                    U[a, ANIM] = 0.0
                    CS[a, C_S0 + sl] += 1.0
                else:
                    U[a, LOCK] = 0.05

        # ---- skeleton minds (simple scripted brawlers)
        for i in range(NCH, NU):
            if I[i, ALIVE] == 0:
                continue
            bestd = BIG
            bj = -1
            for j in range(NU):
                if I[j, ALIVE] == 1 and I[j, TEAM] != I[i, TEAM]:
                    d = math.hypot(U[j, X] - U[i, X], U[j, Y] - U[i, Y])
                    if d < bestd:
                        bestd = d
                        bj = j
            if bj < 0:
                U[i, MVX] = 0.0
                U[i, MVY] = 0.0
                continue
            dx = U[bj, X] - U[i, X]
            dy = U[bj, Y] - U[i, Y]
            U[i, FACE] = math.atan2(dy, dx)
            reach = RS[8, 5] + U[bj, RAD] + U[i, RAD]
            if bestd <= reach:
                U[i, MVX] = 0.0
                U[i, MVY] = 0.0
                if U[i, CDB] <= 0.0 and U[i, LOCK] <= 0.0:
                    emit(EV, EVN, E_SWING, i, bj, 0.0, U[i, X], U[i, Y])
                    deal_damage(U, I, CS, EV, EVN, bj, RS[8, 4], I[i, OWNER])
                    U[i, CDB] = RS[8, 6]
                    U[i, LOCK] = 0.2
                    I[i, STATE] = 2
                    U[i, ANIM] = 0.0
            else:
                U[i, MVX] = dx / bestd
                U[i, MVY] = dy / bestd

        # ---- movement and collisions
        for i in range(NU):
            if I[i, ALIVE] == 0:
                U[i, VX] = 0.0
                U[i, VY] = 0.0
                continue
            if U[i, DASH] > 0.0:
                vx = U[i, DVX]
                vy = U[i, DVY]
            else:
                sp = U[i, SPD]
                if U[i, HASTE] > 0.0:
                    sp *= U[i, HSTR]
                if U[i, LOCK] > 0.0:
                    sp *= 0.6
                vx = U[i, MVX] * sp
                vy = U[i, MVY] * sp
            U[i, VX] = vx
            U[i, VY] = vy
            U[i, X] += vx * DT
            U[i, Y] += vy * DT
            if (vx * vx + vy * vy) > 0.5 and I[i, STATE] <= 1 and U[i, LOCK] <= 0.0:
                U[i, FACE] = math.atan2(vy, vx)
        for i in range(NU):
            if I[i, ALIVE] == 0:
                continue
            r = U[i, RAD]
            if U[i, X] < r:
                U[i, X] = r
            if U[i, X] > ARENA - r:
                U[i, X] = ARENA - r
            if U[i, Y] < r:
                U[i, Y] = r
            if U[i, Y] > ARENA - r:
                U[i, Y] = ARENA - r
            for p in range(NPIL):
                dx = U[i, X] - PIL[p, 0]
                dy = U[i, Y] - PIL[p, 1]
                d = math.hypot(dx, dy)
                md = PIL[p, 2] + r
                if d < md:
                    if d < 1e-6:
                        dx = 1.0
                        dy = 0.0
                        d = 1.0
                    U[i, X] = PIL[p, 0] + dx / d * md
                    U[i, Y] = PIL[p, 1] + dy / d * md
        for i in range(NU):
            if I[i, ALIVE] == 0:
                continue
            for j in range(i + 1, NU):
                if I[j, ALIVE] == 0:
                    continue
                dx = U[j, X] - U[i, X]
                dy = U[j, Y] - U[i, Y]
                md = U[i, RAD] + U[j, RAD]
                d2 = dx * dx + dy * dy
                if d2 < md * md:
                    d = math.sqrt(d2)
                    if d < 1e-6:
                        dx = 1.0
                        dy = 0.0
                        d = 1.0
                    push = (md - d) * 0.5
                    U[i, X] -= dx / d * push
                    U[i, Y] -= dy / d * push
                    U[j, X] += dx / d * push
                    U[j, Y] += dy / d * push

        # ---- projectiles
        for k in range(NP):
            if P[k, PA] == 0.0:
                continue
            ox = P[k, PX]
            oy = P[k, PY]
            nx = ox + P[k, PVX] * DT
            ny = oy + P[k, PVY] * DT
            P[k, PLIFE] -= DT
            best_t = 2.0
            hit_u = -1
            for q_ in range(NPIL):
                tt = seg_hit_t(ox, oy, nx, ny, PIL[q_, 0], PIL[q_, 1], PIL[q_, 2] + 0.05)
                if tt >= 0.0 and tt < best_t:
                    best_t = tt
                    hit_u = -2
            for i in range(NU):
                if I[i, ALIVE] == 0 or I[i, TEAM] == int(P[k, PTEAM]) or U[i, INV] > 0.0:
                    continue
                tt = seg_hit_t(ox, oy, nx, ny, U[i, X], U[i, Y], U[i, RAD] + P[k, PRAD])
                if tt >= 0.0 and tt < best_t:
                    best_t = tt
                    hit_u = i
            if hit_u >= 0:
                deal_damage(U, I, CS, EV, EVN, hit_u, P[k, PDMG], int(P[k, POWN]))
                P[k, PA] = 0.0
            elif hit_u == -2:
                emit(EV, EVN, E_IMPACT, int(P[k, POWN]), -1, 0.0, nx, ny)
                P[k, PA] = 0.0
            elif nx < 0.0 or nx > ARENA or ny < 0.0 or ny > ARENA or P[k, PLIFE] <= 0.0:
                P[k, PA] = 0.0
            else:
                P[k, PX] = nx
                P[k, PY] = ny

        # ---- telegraphed blasts
        for k in range(NZ):
            if Z[k, ZA] == 0.0:
                continue
            Z[k, ZT] -= DT
            if Z[k, ZT] <= 0.0:
                Z[k, ZA] = 0.0
                emit(EV, EVN, E_EXPLODE, int(Z[k, ZOWN]), -1, Z[k, ZR], Z[k, ZX], Z[k, ZY])
                for i in range(NU):
                    if I[i, ALIVE] == 1 and I[i, TEAM] != int(Z[k, ZTEAM]):
                        if math.hypot(U[i, X] - Z[k, ZX], U[i, Y] - Z[k, ZY]) <= Z[k, ZR] + U[i, RAD] * 0.5:
                            deal_damage(U, I, CS, EV, EVN, i, Z[k, ZDMG], int(Z[k, ZOWN]))

        # ---- the closing void, timers
        void_dps = 0.0
        if t >= tsd:
            void_dps = 4.0 + 0.25 * (t - tsd)
        for i in range(NU):
            if I[i, ALIVE] == 0:
                continue
            if void_dps > 0.0 and math.hypot(U[i, X] - 16.0, U[i, Y] - 16.0) > void_r:
                deal_damage(U, I, CS, EV, EVN, i, void_dps * DT, -1)
                if I[i, ALIVE] == 0:
                    continue
            U[i, CDB] = max(U[i, CDB] - DT, 0.0)
            U[i, CDD] = max(U[i, CDD] - DT, 0.0)
            U[i, LOCK] = max(U[i, LOCK] - DT, 0.0)
            U[i, HASTE] = max(U[i, HASTE] - DT, 0.0)
            U[i, INV] = max(U[i, INV] - DT, 0.0)
            U[i, DASH] = max(U[i, DASH] - DT, 0.0)
            for s in range(NSLOT):
                U[i, AB0 + s] = max(U[i, AB0 + s] - DT, 0.0)
            if U[i, SHT] > 0.0:
                U[i, SHT] -= DT
                if U[i, SHT] <= 0.0:
                    U[i, SH] = 0.0
            U[i, ANIM] += DT
            st = I[i, STATE]
            if st == 4 and U[i, DASH] <= 0.0:
                I[i, STATE] = 0
            elif (st == 2 or st == 3) and U[i, ANIM] > 0.4:
                I[i, STATE] = 0
            if I[i, STATE] <= 1:
                moving = (U[i, VX] * U[i, VX] + U[i, VY] * U[i, VY]) > 0.5
                I[i, STATE] = 1 if moving else 0
            if i >= NCH:
                U[i, LIFE] -= DT
                if U[i, LIFE] <= 0.0:
                    I[i, ALIVE] = 0
                    I[i, STATE] = 5
                    U[i, ANIM] = 0.0
                    emit(EV, EVN, E_DEATH, -1, i, 0.0, U[i, X], U[i, Y])

        # ---- record
        if recording and tick % 2 == 0 and nframes < RU.shape[0]:
            f = nframes
            for i in range(NU):
                RU[f, i, 0] = U[i, X]
                RU[f, i, 1] = U[i, Y]
                RU[f, i, 2] = U[i, HP]
                RU[f, i, 3] = U[i, MAXHP]
                RU[f, i, 4] = U[i, SH]
                RU[f, i, 5] = U[i, FACE]
                RU[f, i, 6] = I[i, STATE]
                RU[f, i, 7] = U[i, ANIM]
                RU[f, i, 8] = I[i, TEAM]
                RU[f, i, 9] = I[i, ROLE]
                RU[f, i, 10] = 1 if I[i, ALIVE] == 1 else (2 if I[i, CORPSE] == 1 else 0)
            for k in range(NP):
                RP[f, k, 0] = P[k, PX]
                RP[f, k, 1] = P[k, PY]
                RP[f, k, 2] = P[k, PKIND]
                RP[f, k, 3] = P[k, PA]
                RP[f, k, 4] = P[k, PVX]
                RP[f, k, 5] = P[k, PVY]
            for k in range(NZ):
                RZ[f, k, 0] = Z[k, ZX]
                RZ[f, k, 1] = Z[k, ZY]
                RZ[f, k, 2] = Z[k, ZR]
                RZ[f, k, 3] = 1.0 - Z[k, ZT] / ZDELAY
                RZ[f, k, 4] = Z[k, ZA]
                RZ[f, k, 5] = Z[k, ZKIND]
            RV[f] = void_r
            nframes += 1

        # ---- end of match?
        ha = 0
        da = 0
        for c in range(4):
            if I[c, ALIVE] == 1:
                ha += 1
            if I[4 + c, ALIVE] == 1:
                da += 1
        if ha == 0 or da == 0:
            ended = True
            final_t = t + DT
            if ha > 0:
                winner = 1
            elif da > 0:
                winner = -1
            else:
                winner = 0
            break

    hh = 0.0
    dh_ = 0.0
    hm = 0.0
    dm = 0.0
    ha = 0
    da = 0
    for c in range(4):
        hm += U[c, MAXHP]
        dm += U[4 + c, MAXHP]
        if I[c, ALIVE] == 1:
            hh += U[c, HP]
            ha += 1
        if I[4 + c, ALIVE] == 1:
            dh_ += U[4 + c, HP]
            da += 1
    hf_ = hh / hm
    df_ = dh_ / dm
    if not ended:
        if hf_ - df_ > 0.05:
            winner = 1
        elif df_ - hf_ > 0.05:
            winner = -1
        else:
            winner = 0
    S[0] = winner
    S[1] = final_t
    S[2] = hf_
    S[3] = df_
    S[4] = ha
    S[5] = da
    S[6] = nframes
    S[7] = 1.0 if ended else 0.0


@njit(parallel=True)
def run_batch(WH, ABH, WD, ABD, hi, di, seeds, tmax, tsd, S, CS):
    """Play many matches in parallel. hi/di index into the hero/demon pools."""
    for m in prange(hi.shape[0]):
        RU = np.zeros((0, NU, RUF))
        RP = np.zeros((0, NP, RPF))
        RZ = np.zeros((0, NZ, RZF))
        RV = np.zeros(0)
        EV = np.zeros((0, 8))
        EVN = np.zeros(2, dtype=np.int64)
        run_match(WH[hi[m]], ABH[hi[m]], WD[di[m]], ABD[di[m]], seeds[m], tmax, tsd,
                  S[m], CS[m], RU, RP, RZ, RV, EV, EVN)


def record_match(wh, abh, wd, abd, seed=1, tmax=150.0, tsd=70.0, max_events=40000):
    """Play one match and keep every frame and event, for the viewer."""
    frames = int(tmax / DT / 2) + 4
    S = np.zeros(8)
    CS = np.zeros((NCH, CSF))
    RU = np.zeros((frames, NU, RUF), dtype=np.float32)
    RP = np.zeros((frames, NP, RPF), dtype=np.float32)
    RZ = np.zeros((frames, NZ, RZF), dtype=np.float32)
    RV = np.zeros(frames, dtype=np.float32)
    EV = np.zeros((max_events, 8))
    EVN = np.zeros(2, dtype=np.int64)
    run_match(wh, abh, wd, abd, seed, tmax, tsd, S, CS, RU, RP, RZ, RV, EV, EVN)
    n = int(S[6])
    return {"summary": S, "stats": CS, "units": RU[:n], "proj": RP[:n], "zones": RZ[:n],
            "void": RV[:n], "events": EV[:EVN[0]]}
