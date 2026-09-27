/**
 * Wild animals. Deer and hares bolt from anyone who comes close, boars and wolves fight back
 * when hurt, and hungry wolves hunt deer and hares. Hostile wolves in a raid use the raider
 * behaviour instead.
 */
import { SPECIES, type SpeciesSpec } from '../defs';
import { cheb } from '../grid';
import { INF, flood, pathTo } from '../path';
import { randInt } from '../rng';
import type { Pawn, SimState } from '../types';
import { endJob, nearbyTiles, pawnById, pawnTile } from '../world';
import { assign, freeStand, planWander, type Plan } from './common';
import { perform } from './jobs';

/** Predators get hungry again about a day and a half after a meal. */
const PREDATOR_HUNGER = 70 / 7200;

const specOf = (p: Pawn): SpeciesSpec => SPECIES[p.species as keyof typeof SPECIES];

export function tickAnimal(s: SimState, p: Pawn): void {
  const spec = specOf(p);
  if (spec.temper === 'predator') p.food = Math.max(0, p.food - PREDATOR_HUNGER);
  if ((s.tick + p.id) % 10 === 0) react(s, p, spec);
  if (!p.job && s.tick >= p.thinkAt) assign(p, planAnimal(s, p, spec));
  perform(s, p);
}

/** Whoever just hurt it gets fought or fled from; skittish animals also run from anyone nearby. */
function react(s: SimState, p: Pawn, spec: SpeciesSpec): void {
  const j = p.job;
  if (s.tick - p.hitTick < 30 && p.lastHitBy) {
    const foe = pawnById(s, p.lastHitBy);
    if (foe && foe.life === 'ok' && !foe.gone) {
      if (spec.temper === 'skittish' || p.hp < p.maxHp * 0.25) {
        if (j?.kind !== 'flee') fleeFrom(s, p, pawnTile(foe));
      } else if (!(j?.kind === 'fight' && j.targetId === foe.id)) {
        endJob(s, p);
        p.job = { kind: 'fight', targetId: foe.id, repathAt: s.tick, ordered: true };
        p.path = [];
      }
      return;
    }
  }
  if (spec.temper !== 'skittish' || j?.kind === 'flee') return;
  const me = pawnTile(p);
  const threat = s.pawns.find(
    (o) =>
      o.life === 'ok' &&
      !o.gone &&
      (o.kind !== 'animal' || specOf(o).temper === 'predator') &&
      cheb(me, pawnTile(o)) <= 4,
  );
  if (threat) fleeFrom(s, p, pawnTile(threat));
}

function fleeFrom(s: SimState, p: Pawn, from: number): void {
  const me = pawnTile(p);
  const f = flood(s, me, false, 160);
  let best = -1;
  let bestScore = -INF;
  for (const t of nearbyTiles(me, 10)) {
    if (f.cost[t] >= INF) continue;
    const score = cheb(t, from) * 10 - f.cost[t] / 10;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  endJob(s, p);
  p.job = { kind: 'flee', until: s.tick + 40 };
  p.path = best < 0 ? [] : pathTo(f, best);
}

function planAnimal(s: SimState, p: Pawn, spec: SpeciesSpec): Plan {
  const me = pawnTile(p);
  if (spec.temper === 'predator' && p.food < 30) {
    const f = flood(s, me, false, 700);
    let prey: Pawn | null = null;
    let stand = -1;
    let bestCost = INF;
    for (const o of s.pawns) {
      if (o.kind !== 'animal' || o.life !== 'ok' || specOf(o).temper !== 'skittish') continue;
      const st = freeStand(s, f, pawnTile(o), p, false);
      if (st >= 0 && f.cost[st] < bestCost) {
        bestCost = f.cost[st];
        stand = st;
        prey = o;
      }
    }
    if (prey) return { job: { kind: 'fight', targetId: prey.id, repathAt: s.tick + 10, ordered: true }, path: pathTo(f, stand) };
  }
  const plan = planWander(s, flood(s, me, false, 120), 6, me);
  if (plan.job.kind === 'wander') plan.job.until = s.tick + randInt(s.rng, 80, 240);
  return plan;
}
