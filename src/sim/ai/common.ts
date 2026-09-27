/** Movement, reservations and queries shared by every kind of pawn behaviour. */
import { isEnemy, inReach } from '../combat';
import { ARMORS, SPECIES } from '../defs';
import { DIRS, cheb, inBounds, tileIndex, tileX, tileY } from '../grid';
import { INF, bestStand, flood, isBashTarget, pathTo, stepCost, type Flood } from '../path';
import { randInt } from '../rng';
import type { ItemStack, ItemType, Job, Pawn, SimState } from '../types';
import { has, hostiles, pawnTile, structureAt } from '../world';

export interface Plan {
  job: Job;
  path: number[];
}

export type Result = 'run' | 'done' | 'fail';
export type Approach = 'walking' | 'there' | 'blocked' | 'fail';
export type JobOf<K extends Job['kind']> = Extract<Job, { kind: K }>;

export function assign(p: Pawn, plan: Plan | null): void {
  if (!plan) return;
  p.job = plan.job;
  p.path = plan.path;
}

/** Goblins and hostile animals plan through walls and smash them; everyone else walks around. */
export const bashes = (p: Pawn): boolean => p.kind === 'goblin' || p.hostile;

export function speedMul(p: Pawn): number {
  let m = 1;
  if (p.kind === 'goblin') m = p.unit === 'brute' ? 1.15 : 0.85;
  else if (p.kind === 'animal') m = SPECIES[p.species as keyof typeof SPECIES]?.speed ?? 1;
  else {
    if (has(p, 'fastWalker')) m *= 0.8;
    m *= ARMORS[p.armor].slow;
    if (p.age > 60) m *= 1.1;
  }
  if (p.hp < p.maxHp * 0.5) m *= 1.3;
  if (p.carry) m *= 1.1;
  return m;
}

/** Starts the next step of the path. Smashers report 'blocked' in front of anything they must break. */
export function walk(s: SimState, p: Pawn): 'arrived' | 'walking' | 'blocked' {
  if (p.path.length === 0) return 'arrived';
  const from = pawnTile(p);
  const next = p.path[0];
  if (cheb(from, next) !== 1) return 'blocked';
  const smash = bashes(p);
  if (smash && isBashTarget(s, next)) return 'blocked';
  const cost = stepCost(s, from, next, smash);
  if (cost < 0) return 'blocked';
  p.path.shift();
  p.fromX = p.x;
  p.fromY = p.y;
  p.x = tileX(next);
  p.y = tileY(next);
  p.faceX = Math.sign(p.x - p.fromX);
  p.faceY = Math.sign(p.y - p.fromY);
  p.moveT = 0;
  p.moveDur = Math.max(2, Math.round(cost * 0.5 * speedMul(p)));
  return 'walking';
}

export function approach(s: SimState, p: Pawn, target: number): Approach {
  const w = walk(s, p);
  if (w !== 'arrived') return w;
  return cheb(pawnTile(p), target) <= 1 ? 'there' : 'fail';
}

export function face(p: Pawn, t: number): void {
  const dx = tileX(t) - p.x;
  const dy = tileY(t) - p.y;
  if (dx !== 0 || dy !== 0) {
    p.faceX = Math.sign(dx);
    p.faceY = Math.sign(dy);
  }
}

/** Swaps the current job for smashing whatever blocks the next step. */
export function startBash(s: SimState, p: Pawn): Result {
  const next = p.path[0];
  if (next === undefined || !isBashTarget(s, next)) return 'fail';
  const st = structureAt(s, next);
  if (!st) return 'fail';
  p.job = { kind: 'bash', structureId: st.id };
  p.path = [];
  return 'run';
}

/** Turns an unfinished approach into a job result. Smashers break whatever blocks them. */
export function notThere(s: SimState, p: Pawn, a: Approach): Result {
  if (a === 'walking') return 'run';
  if (a === 'blocked' && bashes(p)) return startBash(s, p);
  return 'fail';
}

// Queries

export function nearestColonist(s: SimState, from: number, maxD: number): Pawn | null {
  let best: Pawn | null = null;
  let bestD = maxD + 1;
  for (const c of s.pawns) {
    if (c.kind !== 'colonist' || c.life !== 'ok') continue;
    const d = cheb(from, pawnTile(c));
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function occupied(s: SimState, t: number, self: Pawn): boolean {
  for (const o of s.pawns) if (o !== self && o.life !== 'dead' && !o.gone && pawnTile(o) === t) return true;
  return false;
}

/** Like bestStand, but steers away from tiles someone else already stands on. */
export function freeStand(s: SimState, f: Flood, target: number, self: Pawn, allowOn: boolean): number {
  let best = -1;
  let bestCost = INF;
  const consider = (n: number): void => {
    if (f.cost[n] >= INF) return;
    const c = f.cost[n] + (n !== pawnTile(self) && occupied(s, n, self) ? 25 : 0);
    if (c < bestCost) {
      bestCost = c;
      best = n;
    }
  };
  if (allowOn) consider(target);
  const x = tileX(target);
  const y = tileY(target);
  for (const [dx, dy] of DIRS) if (inBounds(x + dx, y + dy)) consider(tileIndex(x + dx, y + dy));
  return best;
}

/** An enemy this pawn can hit right now without moving: adjacent, or in bow range and sight. */
export function enemyInReach(s: SimState, p: Pawn): Pawn | null {
  let best: Pawn | null = null;
  let bestD = INF;
  const me = pawnTile(p);
  for (const o of s.pawns) {
    if (!isEnemy(p, o)) continue;
    const d = cheb(me, pawnTile(o));
    if (d >= bestD || !inReach(s, p, o)) continue;
    bestD = d;
    best = o;
  }
  return best;
}

export function hostileWithin(s: SimState, from: number, maxD: number): boolean {
  return hostiles(s).some((h) => cheb(from, pawnTile(h)) <= maxD);
}

// Reservations

/** Someone else is about to pick this stack up. Eaters only take a little, so they can be ignored. */
export function reservedItem(s: SimState, itemId: number, except: Pawn, ignoreEaters = false): boolean {
  for (const o of s.pawns) {
    const j = o.job;
    if (o === except || !j) continue;
    if ((j.kind === 'haul' || j.kind === 'deliver') && j.stage === 'fetch' && j.itemId === itemId) return true;
    if ((j.kind === 'steal' || j.kind === 'equip') && j.itemId === itemId) return true;
    if (!ignoreEaters && j.kind === 'eat' && j.stage === 'fetch' && j.itemId === itemId) return true;
  }
  return false;
}

/** How many others are on their way to eat from this stack. */
export const eatersOf = (s: SimState, itemId: number, except: Pawn): number =>
  s.pawns.filter((o) => o !== except && o.job?.kind === 'eat' && o.job.stage === 'fetch' && o.job.itemId === itemId).length;

export function reservedTile(s: SimState, tile: number, except: Pawn): boolean {
  for (const o of s.pawns) {
    const j = o.job;
    if (o === except || !j) continue;
    if ((j.kind === 'harvest' || j.kind === 'decon' || j.kind === 'sow' || j.kind === 'reap') && j.tile === tile) return true;
  }
  return false;
}

export function reservedBuild(s: SimState, bpId: number, except: Pawn): boolean {
  return s.pawns.some((o) => o !== except && o.job?.kind === 'build' && o.job.bpId === bpId);
}

export function tendReserved(s: SimState, targetId: number, except: Pawn): boolean {
  return s.pawns.some((o) => o !== except && o.job?.kind === 'tend' && o.job.targetId === targetId);
}

/** A workstation in use by someone else. */
export function stationBusy(s: SimState, id: number, except: Pawn): boolean {
  return s.pawns.some((o) => {
    const j = o.job;
    if (o === except || !j) return false;
    return (j.kind === 'cook' && j.stationId === id) || (j.kind === 'craft' && j.benchId === id) || (j.kind === 'research' && j.deskId === id);
  });
}

/** Materials already on their way to a blueprint. */
export function pendingDelivery(s: SimState, bpId: number, except: Pawn): number {
  let n = 0;
  for (const o of s.pawns) {
    const j = o.job;
    if (o === except || !j || j.kind !== 'deliver' || j.bpId !== bpId) continue;
    n += j.stage === 'fetch' ? j.amount : (o.carry?.count ?? 0);
  }
  return n;
}

export interface Source {
  item: ItemStack;
  stand: number;
  cost: number;
}

export function nearestItem(s: SimState, f: Flood, types: ItemType | readonly ItemType[], p: Pawn, minCount: number): Source | null {
  const wanted = typeof types === 'string' ? [types] : types;
  let best: Source | null = null;
  for (const item of s.items) {
    if (!wanted.includes(item.type) || item.count < minCount || reservedItem(s, item.id, p)) continue;
    const stand = bestStand(f, item.tile, true);
    if (stand < 0) continue;
    const cost = f.cost[stand];
    if (!best || cost < best.cost) best = { item, stand, cost };
  }
  return best;
}

// Shared plans

/** Walk up to a target and fight it. Raiders and hostile animals plan through walls. */
export function planFight(s: SimState, p: Pawn, target: Pawn, ordered = false): Plan | null {
  const f = flood(s, pawnTile(p), bashes(p));
  const stand = freeStand(s, f, pawnTile(target), p, false);
  if (stand < 0) return null;
  return { job: { kind: 'fight', targetId: target.id, repathAt: s.tick + 10, ordered }, path: pathTo(f, stand) };
}

/** A short stroll to a random reachable tile near `center`. */
export function planWander(s: SimState, f: Flood, radius: number, center: number): Plan {
  const cx = tileX(center);
  const cy = tileY(center);
  for (let i = 0; i < 12; i++) {
    const x = cx + randInt(s.rng, -radius, radius);
    const y = cy + randInt(s.rng, -radius, radius);
    if (!inBounds(x, y)) continue;
    const t = tileIndex(x, y);
    if (f.cost[t] >= INF) continue;
    return { job: { kind: 'wander', until: s.tick + randInt(s.rng, 30, 90) }, path: pathTo(f, t) };
  }
  return { job: { kind: 'wander', until: s.tick + 40 }, path: [] };
}
