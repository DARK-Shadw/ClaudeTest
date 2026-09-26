/**
 * Pawn behaviour. Colonists choose work by their focus and needs, and react to raids according
 * to their traits and the rally point. Nobody is steered directly: the player plans, the
 * colonists act, which is what lets a settlement defend itself while its owner is offline.
 * Goblins hunt standing colonists, steal from the stockpile and smash what is in their way.
 */
import { B, FEATURE, MAP_N, STRUCTURES, TICKS_PER_DAY } from './constants';
import { DIRS, cheb, inBounds, isEdge, tileIndex, tileX, tileY } from './grid';
import { INF, bestStand, flood, isBashTarget, pathTo, stepCost, type Flood } from './path';
import { chance, randInt } from './rng';
import { isNight } from './time';
import type { ItemStack, ItemType, Job, JobKind, Pawn, SimState, SkillId, WorkType } from './types';
import {
  addItemAt,
  addMemory,
  blueprintById,
  buildBlocked,
  capacity,
  completeBlueprint,
  countItems,
  firstName,
  harvestable,
  has,
  hostiles,
  isIndoors,
  itemById,
  kill,
  log,
  pawnById,
  pawnTile,
  placeItemNear,
  removeStructure,
  structureAt,
  structureById,
  takeFromItem,
  zoneDest,
  zoneTiles,
} from './world';

interface Plan {
  job: Job;
  path: number[];
}

type Result = 'run' | 'done' | 'fail';
type Approach = 'walking' | 'there' | 'blocked' | 'fail';

// Entry point

export function tickPawn(s: SimState, p: Pawn): void {
  if (p.attackCd > 0) p.attackCd--;
  if (p.moveT < p.moveDur) {
    p.moveT++;
    if (p.moveT < p.moveDur) return;
    if (p.kind === 'goblin') checkTrap(s, p);
    if (p.life !== 'ok') return;
  }
  if (p.kind === 'colonist') colonistTick(s, p);
  else raiderTick(s, p);
}

/** Drops the current job. Colonists put down what they carry; goblins keep their loot. */
export function endJob(s: SimState, p: Pawn): void {
  if (p.kind === 'colonist' && p.carry) {
    placeItemNear(s, pawnTile(p), p.carry.type, p.carry.count);
    p.carry = null;
  }
  p.job = null;
  p.path = [];
}

function assign(p: Pawn, plan: Plan | null): void {
  if (!plan) return;
  p.job = plan.job;
  p.path = plan.path;
}

function colonistTick(s: SimState, p: Pawn): void {
  if (p.job) maybeInterrupt(s, p);
  if (!p.job && s.tick >= p.thinkAt) assign(p, planColonist(s, p));
  finishTick(s, p);
}

function finishTick(s: SimState, p: Pawn): void {
  if (!p.job) return;
  const result = runJob(s, p);
  if (result === 'run') return;
  endJob(s, p);
  if (result === 'fail') p.thinkAt = s.tick + 5;
}

function raiderTick(s: SimState, p: Pawn): void {
  if (p.job && p.job.kind !== 'leave' && p.job.kind !== 'bash' && p.hp < p.maxHp * 0.3) {
    endJob(s, p);
    log(s, 'good', `${p.name} flees, badly wounded.`);
  }
  if (p.job && p.job.kind !== 'fight' && p.job.kind !== 'leave' && (s.tick + p.id) % 8 === 0 && !s.raid?.retreat) {
    const c = nearestStanding(s, pawnTile(p), p.looter ? 1 : 3);
    const plan = c ? planFight(s, p, c) : null;
    if (plan) {
      endJob(s, p);
      assign(p, plan);
    }
  }
  if (!p.job && s.tick >= p.thinkAt) assign(p, planRaider(s, p));
  finishTick(s, p);
}

// Movement

export function workSpeed(p: Pawn, skill: SkillId): number {
  let m = 0.6 + 0.08 * p.skills[skill];
  if (has(p, 'industrious')) m *= 1.25;
  if (has(p, 'lazy')) m *= 0.8;
  if (p.hp < p.maxHp * 0.5) m *= 0.75;
  return m;
}

function speedMul(p: Pawn): number {
  let m = p.kind === 'goblin' ? 0.85 : 1;
  if (p.hp < p.maxHp * 0.5) m *= 1.3;
  if (p.carry) m *= 1.1;
  return m;
}

/** Starts the next step of the path. Goblins report 'blocked' in front of anything they must smash. */
function walk(s: SimState, p: Pawn): 'arrived' | 'walking' | 'blocked' {
  if (p.path.length === 0) return 'arrived';
  const from = pawnTile(p);
  const next = p.path[0];
  if (cheb(from, next) !== 1) return 'blocked';
  const raider = p.kind === 'goblin';
  if (raider && isBashTarget(s, next)) return 'blocked';
  const cost = stepCost(s, from, next, raider);
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

function approach(s: SimState, p: Pawn, target: number): Approach {
  const w = walk(s, p);
  if (w !== 'arrived') return w;
  return cheb(pawnTile(p), target) <= 1 ? 'there' : 'fail';
}

/** Turns an unfinished approach into a job result. Goblins smash whatever blocks them. */
function notThere(s: SimState, p: Pawn, a: Approach): Result {
  if (a === 'walking') return 'run';
  if (a === 'blocked' && p.kind === 'goblin') return startBash(s, p);
  return 'fail';
}

function face(p: Pawn, t: number): void {
  const dx = tileX(t) - p.x;
  const dy = tileY(t) - p.y;
  if (dx !== 0 || dy !== 0) {
    p.faceX = Math.sign(dx);
    p.faceY = Math.sign(dy);
  }
}

// Queries

function nearestStanding(s: SimState, from: number, maxD: number): Pawn | null {
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

function occupied(s: SimState, t: number, self: Pawn): boolean {
  for (const o of s.pawns) if (o !== self && o.life !== 'dead' && !o.gone && pawnTile(o) === t) return true;
  return false;
}

/** Like bestStand, but steers away from tiles someone else already stands on. */
function freeStand(s: SimState, f: Flood, target: number, self: Pawn, allowOn: boolean): number {
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

function adjacentFoe(s: SimState, p: Pawn): Pawn | null {
  const me = pawnTile(p);
  for (const o of s.pawns) {
    if (o.kind === p.kind || o.life !== 'ok' || o.gone) continue;
    if (cheb(me, pawnTile(o)) <= 1) return o;
  }
  return null;
}

function hostileWithin(s: SimState, from: number, maxD: number): boolean {
  return hostiles(s).some((h) => cheb(from, pawnTile(h)) <= maxD);
}

function reservedItem(s: SimState, itemId: number, except: Pawn): boolean {
  for (const o of s.pawns) {
    const j = o.job;
    if (o === except || !j) continue;
    if ((j.kind === 'haul' || j.kind === 'deliver' || j.kind === 'cook') && j.stage === 'fetch' && j.itemId === itemId) return true;
    if (j.kind === 'steal' && j.itemId === itemId) return true;
  }
  return false;
}

function reservedTile(s: SimState, tile: number, except: Pawn): boolean {
  for (const o of s.pawns) {
    const j = o.job;
    if (o !== except && j && (j.kind === 'harvest' || j.kind === 'decon') && j.tile === tile) return true;
  }
  return false;
}

function reservedBuild(s: SimState, bpId: number, except: Pawn): boolean {
  return s.pawns.some((o) => o !== except && o.job?.kind === 'build' && o.job.bpId === bpId);
}

function tendReserved(s: SimState, targetId: number, except: Pawn): boolean {
  return s.pawns.some((o) => o !== except && o.job?.kind === 'tend' && o.job.targetId === targetId);
}

/** Materials already on their way to a blueprint. */
function pendingDelivery(s: SimState, bpId: number, except: Pawn): number {
  let n = 0;
  for (const o of s.pawns) {
    const j = o.job;
    if (o === except || !j || j.kind !== 'deliver' || j.bpId !== bpId) continue;
    n += j.stage === 'fetch' ? j.amount : (o.carry?.count ?? 0);
  }
  return n;
}

interface Source {
  item: ItemStack;
  stand: number;
  cost: number;
}

function nearestItem(s: SimState, f: Flood, type: ItemType, p: Pawn, minCount: number): Source | null {
  let best: Source | null = null;
  for (const item of s.items) {
    if (item.type !== type || item.count < minCount || reservedItem(s, item.id, p)) continue;
    const stand = bestStand(f, item.tile, true);
    if (stand < 0) continue;
    const cost = f.cost[stand];
    if (!best || cost < best.cost) best = { item, stand, cost };
  }
  return best;
}

// Colonist planning

const SELF_MANAGED: ReadonlySet<JobKind> = new Set<JobKind>(['fight', 'flee', 'rally', 'tend']);

/** Every second, working colonists check whether a raid or hunger should pull them away. */
function maybeInterrupt(s: SimState, p: Pawn): void {
  const j = p.job!;
  if (SELF_MANAGED.has(j.kind) || p.mental || (s.tick + p.id) % 10 !== 0) return;
  const threats = hostiles(s);
  if (threats.length > 0) {
    const plan = planCombat(s, p, threats);
    if (plan) {
      endJob(s, p);
      assign(p, plan);
      return;
    }
  }
  if (p.food < 10 && j.kind !== 'eat' && j.kind !== 'sleep' && (s.tick + p.id) % 50 === 0) {
    const plan = planEat(s, flood(s, pawnTile(p)));
    if (plan) {
      endJob(s, p);
      assign(p, plan);
    }
  }
}

const needsSleep = (s: SimState, p: Pawn): boolean => p.rest < 25 || (isNight(s.tick) && p.rest < 70);

function planColonist(s: SimState, p: Pawn): Plan | null {
  if (p.mental) {
    if (p.mental.until > s.tick) return planWander(s, flood(s, pawnTile(p)), 10, pawnTile(p));
    p.mental = null;
    addMemory(p, 'catharsis', 'Catharsis', 8, s.tick + TICKS_PER_DAY);
  }
  const threats = hostiles(s);
  const combat = threats.length > 0 ? planCombat(s, p, threats) : null;
  if (combat && combat.job.kind !== 'rally') return combat;
  const f = flood(s, pawnTile(p));
  // Waiting at the rally point is the one combat job worth interrupting to save a life.
  const tend = planTend(s, p, f, threats);
  if (tend || combat) return tend ?? combat;
  return (
    (p.food < B.hungryAt ? planEat(s, f) : null) ??
    (needsSleep(s, p) ? planSleep(s, p, f) : null) ??
    planWork(s, p, f) ??
    (p.food < 70 ? planEat(s, f) : null) ??
    planWander(s, f, 5, s.home)
  );
}

/** How a colonist answers a raid depends on who they are and whether a rally point is set. */
function planCombat(s: SimState, p: Pawn, threats: Pawn[]): Plan | null {
  const me = pawnTile(p);
  let nearest = threats[0];
  let nearestD = INF;
  for (const h of threats) {
    const d = cheb(me, pawnTile(h));
    if (d < nearestD) {
      nearestD = d;
      nearest = h;
    }
  }
  const reckless = has(p, 'bloodlust');
  if (!reckless && !has(p, 'brave') && p.hp < p.maxHp * 0.3) return nearestD <= 12 ? planFlee(s, p, threats) : null;
  if (has(p, 'coward')) {
    if (nearestD <= 1) return planFight(s, p, nearest);
    return nearestD <= 14 ? planFlee(s, p, threats) : null;
  }
  if (reckless) return planFight(s, p, nearest);

  const anchor = s.rally >= 0 ? s.rally : s.home;
  const reach = s.rally >= 0 ? 7 : 12;
  let target: Pawn | null = null;
  let targetD = INF;
  for (const h of threats) {
    const ht = pawnTile(h);
    const d = cheb(me, ht);
    if (cheb(anchor, ht) > reach && d > 2) continue;
    if (d < targetD) {
      targetD = d;
      target = h;
    }
  }
  if (target) return planFight(s, p, target);
  return s.rally >= 0 ? planRally(s, p) : null;
}

function planFight(s: SimState, p: Pawn, target: Pawn): Plan | null {
  const f = flood(s, pawnTile(p), p.kind === 'goblin');
  const stand = freeStand(s, f, pawnTile(target), p, false);
  if (stand < 0) return null;
  return { job: { kind: 'fight', targetId: target.id, repathAt: s.tick + 10 }, path: pathTo(f, stand) };
}

/** Runs for the safest reachable spot: far from raiders, ideally indoors. */
function planFlee(s: SimState, p: Pawn, threats: Pawn[]): Plan | null {
  const f = flood(s, pawnTile(p), false, 260);
  const threatTiles = threats.map(pawnTile);
  let best = -1;
  let bestScore = -INF;
  for (let t = 0; t < MAP_N; t++) {
    if (f.cost[t] >= INF) continue;
    let minD = INF;
    for (const h of threatTiles) minD = Math.min(minD, cheb(t, h));
    const score = Math.min(minD, 16) * 10 + (isIndoors(s, t) ? 40 : 0) - ((f.cost[t] / 10) | 0);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (best < 0) return null;
  return { job: { kind: 'flee', until: s.tick + 60 }, path: pathTo(f, best) };
}

function planRally(s: SimState, p: Pawn): Plan | null {
  const me = pawnTile(p);
  const until = s.tick + 15;
  if (cheb(me, s.rally) <= 1) return { job: { kind: 'rally', until }, path: [] };
  const f = flood(s, me);
  const stand = freeStand(s, f, s.rally, p, true);
  if (stand < 0) return null;
  return { job: { kind: 'rally', until }, path: pathTo(f, stand) };
}

function planTend(s: SimState, p: Pawn, f: Flood, threats: Pawn[]): Plan | null {
  let bestStandTile = -1;
  let bestCost = INF;
  let targetId = 0;
  for (const o of s.pawns) {
    if (o === p || o.kind !== 'colonist' || o.life !== 'downed' || o.bleed <= 0) continue;
    if (tendReserved(s, o.id, p)) continue;
    const ot = pawnTile(o);
    if (!has(p, 'brave') && threats.some((h) => cheb(pawnTile(h), ot) <= 4)) continue;
    const stand = bestStand(f, ot, true);
    if (stand >= 0 && f.cost[stand] < bestCost) {
      bestCost = f.cost[stand];
      bestStandTile = stand;
      targetId = o.id;
    }
  }
  if (bestStandTile < 0) return null;
  return { job: { kind: 'tend', targetId, progress: 0 }, path: pathTo(f, bestStandTile) };
}

function planEat(s: SimState, f: Flood): Plan | null {
  let bestStandTile = -1;
  let bestCost = INF;
  let itemId = 0;
  for (const it of s.items) {
    if (it.type !== 'meal' && it.type !== 'berries') continue;
    const stand = bestStand(f, it.tile, true);
    if (stand < 0) continue;
    const cost = f.cost[stand] + (it.type === 'berries' ? 80 : 0);
    if (cost < bestCost) {
      bestCost = cost;
      bestStandTile = stand;
      itemId = it.id;
    }
  }
  if (bestStandTile < 0) return null;
  return { job: { kind: 'eat', itemId, progress: 0 }, path: pathTo(f, bestStandTile) };
}

function planSleep(s: SimState, p: Pawn, f: Flood): Plan {
  let bed = p.bedId ? structureById(s, p.bedId) : undefined;
  if (bed && (bed.kind !== 'bed' || bed.ownerId !== p.id)) bed = undefined;
  if (!bed) {
    p.bedId = 0;
    let bestCost = INF;
    for (const st of s.structures) {
      if (st.kind !== 'bed' || st.ownerId !== 0 || f.cost[st.tile] >= bestCost) continue;
      bestCost = f.cost[st.tile];
      bed = st;
    }
    if (bed) {
      bed.ownerId = p.id;
      p.bedId = bed.id;
      s.structVersion++;
    }
  }
  if (bed && f.cost[bed.tile] < INF) return { job: { kind: 'sleep', bedId: bed.id, asleep: false }, path: pathTo(f, bed.tile) };
  return { job: { kind: 'sleep', bedId: 0, asleep: false }, path: [] };
}

const DEFAULT_ORDER: readonly WorkType[] = ['build', 'cook', 'gather', 'haul'];

function planWork(s: SimState, p: Pawn, f: Flood): Plan | null {
  const order = p.role === 'any' ? DEFAULT_ORDER : [p.role, ...DEFAULT_ORDER.filter((w) => w !== p.role)];
  for (const work of order) {
    const plan =
      work === 'build' ? planBuild(s, p, f) : work === 'cook' ? planCook(s, p, f) : work === 'gather' ? planGather(s, p, f) : planHaul(s, p, f);
    if (plan) return plan;
  }
  return null;
}

function planBuild(s: SimState, p: Pawn, f: Flood): Plan | null {
  let job: Job | null = null;
  let stand = -1;
  let bestCost = INF;

  // Raise blueprints that have all their materials.
  for (const bp of s.blueprints) {
    if (bp.delivered < STRUCTURES[bp.kind].cost || buildBlocked(s, bp.tile) || reservedBuild(s, bp.id, p)) continue;
    const st = bestStand(f, bp.tile, false);
    if (st >= 0 && f.cost[st] < bestCost) {
      bestCost = f.cost[st];
      stand = st;
      job = { kind: 'build', bpId: bp.id };
    }
  }
  if (job) return { job, path: pathTo(f, stand) };

  // Carry materials to blueprints.
  const sources = new Map<ItemType, Source | null>();
  for (const bp of s.blueprints) {
    const spec = STRUCTURES[bp.kind];
    const need = spec.cost - bp.delivered - pendingDelivery(s, bp.id, p);
    if (need <= 0 || bestStand(f, bp.tile, true) < 0) continue;
    if (!sources.has(spec.material)) sources.set(spec.material, nearestItem(s, f, spec.material, p, 1));
    const src = sources.get(spec.material);
    if (!src) continue;
    const cost = src.cost + cheb(src.item.tile, bp.tile) * 10;
    if (cost < bestCost) {
      bestCost = cost;
      stand = src.stand;
      job = { kind: 'deliver', bpId: bp.id, itemId: src.item.id, amount: need, stage: 'fetch' };
    }
  }
  if (job) return { job, path: pathTo(f, stand) };

  // Take apart structures marked for removal.
  for (let t = 0; t < MAP_N; t++) {
    if (!s.decon[t] || !s.structGrid[t] || reservedTile(s, t, p)) continue;
    const st = bestStand(f, t, false);
    if (st >= 0 && f.cost[st] < bestCost) {
      bestCost = f.cost[st];
      stand = st;
      job = { kind: 'decon', tile: t, progress: 0 };
    }
  }
  return job ? { job, path: pathTo(f, stand) } : null;
}

function planCook(s: SimState, p: Pawn, f: Flood): Plan | null {
  const fires = s.structures.filter((st) => st.kind === 'campfire');
  if (fires.length === 0) return null;
  const eaters = s.pawns.filter((o) => o.kind === 'colonist').length;
  const cooking = s.pawns.filter((o) => o.job?.kind === 'cook').length;
  if (countItems(s, 'meal') + cooking >= eaters * 2 + 1) return null;
  const src = nearestItem(s, f, 'berries', p, B.berriesPerMeal);
  if (!src) return null;
  let fire = fires[0];
  for (const st of fires) if (cheb(st.tile, src.item.tile) < cheb(fire.tile, src.item.tile)) fire = st;
  if (bestStand(f, fire.tile, false) < 0) return null;
  return {
    job: { kind: 'cook', stationId: fire.id, itemId: src.item.id, stage: 'fetch', progress: 0 },
    path: pathTo(f, src.stand),
  };
}

function planGather(s: SimState, p: Pawn, f: Flood): Plan | null {
  let stand = -1;
  let tile = -1;
  let bestCost = INF;
  for (let t = 0; t < MAP_N; t++) {
    if (!s.designated[t] || !harvestable(s, t) || reservedTile(s, t, p)) continue;
    const st = bestStand(f, t, false);
    if (st >= 0 && f.cost[st] < bestCost) {
      bestCost = f.cost[st];
      stand = st;
      tile = t;
    }
  }
  if (stand < 0) return null;
  return { job: { kind: 'harvest', tile, progress: 0 }, path: pathTo(f, stand) };
}

function planHaul(s: SimState, p: Pawn, f: Flood): Plan | null {
  const zone = zoneTiles(s);
  if (zone.length === 0) return null;
  let job: Job | null = null;
  let stand = -1;
  let bestCost = INF;
  for (const it of s.items) {
    if (s.zone[it.tile] || reservedItem(s, it.id, p)) continue;
    const st = bestStand(f, it.tile, true);
    if (st < 0 || f.cost[st] >= bestCost) continue;
    const dest = zoneDest(s, it.type, it.tile, zone);
    if (dest < 0 || bestStand(f, dest, true) < 0) continue;
    bestCost = f.cost[st];
    stand = st;
    job = { kind: 'haul', itemId: it.id, dest, stage: 'fetch' };
  }
  return job ? { job, path: pathTo(f, stand) } : null;
}

function planWander(s: SimState, f: Flood, radius: number, center: number): Plan {
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

// Raider planning

function planRaider(s: SimState, p: Pawn): Plan | null {
  const f = flood(s, pawnTile(p), true);
  if (!s.raid || s.raid.retreat || p.carry || p.hp < p.maxHp * 0.3) return planLeave(f);
  if (p.looter) return planLoot(s, p, f) ?? planHunt(s, p, f) ?? planSmash(s, f) ?? planLeave(f);
  return planHunt(s, p, f) ?? planLoot(s, p, f) ?? planSmash(s, f) ?? planLeave(f);
}

/** The closest standing colonist by walking cost, walls included. */
function planHunt(s: SimState, p: Pawn, f: Flood): Plan | null {
  let stand = -1;
  let bestCost = INF;
  let targetId = 0;
  for (const c of s.pawns) {
    if (c.kind !== 'colonist' || c.life !== 'ok') continue;
    const st = freeStand(s, f, pawnTile(c), p, false);
    if (st >= 0 && f.cost[st] < bestCost) {
      bestCost = f.cost[st];
      stand = st;
      targetId = c.id;
    }
  }
  return targetId ? { job: { kind: 'fight', targetId, repathAt: s.tick + 10 }, path: pathTo(f, stand) } : null;
}

/** Stockpiles first; anything lying around will do. */
function planLoot(s: SimState, p: Pawn, f: Flood): Plan | null {
  let stand = -1;
  let bestCost = INF;
  let itemId = 0;
  for (const it of s.items) {
    if (reservedItem(s, it.id, p)) continue;
    const st = bestStand(f, it.tile, true);
    if (st < 0) continue;
    const cost = f.cost[st] + (s.zone[it.tile] ? 0 : 40);
    if (cost < bestCost) {
      bestCost = cost;
      stand = st;
      itemId = it.id;
    }
  }
  return itemId ? { job: { kind: 'steal', itemId }, path: pathTo(f, stand) } : null;
}

function planSmash(s: SimState, f: Flood): Plan | null {
  let stand = -1;
  let bestCost = INF;
  let structureId = 0;
  for (const st of s.structures) {
    if (st.kind === 'grave' || st.kind === 'trap') continue;
    const sp = bestStand(f, st.tile, false);
    if (sp >= 0 && f.cost[sp] < bestCost) {
      bestCost = f.cost[sp];
      stand = sp;
      structureId = st.id;
    }
  }
  return structureId ? { job: { kind: 'bash', structureId }, path: pathTo(f, stand) } : null;
}

function planLeave(f: Flood): Plan {
  let best = -1;
  let bestCost = INF;
  for (let t = 0; t < MAP_N; t++) {
    if (isEdge(t) && f.cost[t] < bestCost) {
      bestCost = f.cost[t];
      best = t;
    }
  }
  return { job: { kind: 'leave' }, path: best < 0 ? [] : pathTo(f, best) };
}

// Job execution

function runJob(s: SimState, p: Pawn): Result {
  const j = p.job!;
  switch (j.kind) {
    case 'harvest':
      return runHarvest(s, p, j);
    case 'haul':
      return runHaul(s, p, j);
    case 'deliver':
      return runDeliver(s, p, j);
    case 'build':
      return runBuild(s, p, j);
    case 'decon':
      return runDecon(s, p, j);
    case 'cook':
      return runCook(s, p, j);
    case 'eat':
      return runEat(s, p, j);
    case 'sleep':
      return runSleep(s, p, j);
    case 'tend':
      return runTend(s, p, j);
    case 'fight':
      return runFight(s, p, j);
    case 'bash':
      return runBash(s, p, j);
    case 'steal':
      return runSteal(s, p, j);
    case 'leave':
      return runLeave(s, p);
    case 'flee':
    case 'rally':
    case 'wander':
      return runTimed(s, p, j);
  }
}

type JobOf<K extends JobKind> = Extract<Job, { kind: K }>;

const HARVEST_WORK: Record<number, number> = {
  [FEATURE.TREE]: B.harvestWork.tree,
  [FEATURE.BUSH]: B.harvestWork.bush,
  [FEATURE.BOULDER]: B.harvestWork.boulder,
};

function runHarvest(s: SimState, p: Pawn, j: JobOf<'harvest'>): Result {
  if (!s.designated[j.tile] || !harvestable(s, j.tile)) return 'fail';
  const a = approach(s, p, j.tile);
  if (a !== 'there') return notThere(s, p, a);
  face(p, j.tile);
  j.progress += workSpeed(p, 'gather');
  if (j.progress < HARVEST_WORK[s.feature[j.tile]]) return 'run';
  finishHarvest(s, j.tile, has(p, 'greenThumb'));
  return 'done';
}

function finishHarvest(s: SimState, t: number, greenThumb: boolean): void {
  const f = s.feature[t];
  if (f === FEATURE.TREE) {
    s.feature[t] = FEATURE.NONE;
    s.designated[t] = 0;
    placeItemNear(s, t, 'wood', B.harvestYield.tree);
  } else if (f === FEATURE.BOULDER) {
    s.feature[t] = FEATURE.NONE;
    s.designated[t] = 0;
    placeItemNear(s, t, 'stone', B.harvestYield.boulder);
  } else if (f === FEATURE.BUSH) {
    s.regrow[t] = s.tick + B.bushRegrow;
    placeItemNear(s, t, 'berries', greenThumb ? Math.round(B.harvestYield.bush * 1.5) : B.harvestYield.bush);
  }
  s.structVersion++;
}

function runHaul(s: SimState, p: Pawn, j: JobOf<'haul'>): Result {
  if (j.stage === 'fetch') {
    const it = itemById(s, j.itemId);
    if (!it) return 'fail';
    const a = approach(s, p, it.tile);
    if (a !== 'there') return notThere(s, p, a);
    const type = it.type;
    p.carry = { type, count: takeFromItem(s, it, B.carryMax) };
    if (capacity(s, j.dest, type) <= 0) j.dest = zoneDest(s, type, pawnTile(p));
    if (j.dest < 0) return 'fail';
    const f = flood(s, pawnTile(p));
    const stand = bestStand(f, j.dest, true);
    if (stand < 0) return 'fail';
    p.path = pathTo(f, stand);
    j.stage = 'drop';
    return 'run';
  }
  const a = approach(s, p, j.dest);
  if (a !== 'there') return notThere(s, p, a);
  if (!p.carry) return 'fail';
  const { type } = p.carry;
  let left = p.carry.count - addItemAt(s, j.dest, type, p.carry.count);
  const zone = zoneTiles(s);
  while (left > 0) {
    const d = zoneDest(s, type, j.dest, zone);
    if (d < 0 || cheb(d, pawnTile(p)) > 3) break;
    const added = addItemAt(s, d, type, left);
    if (added <= 0) break;
    left -= added;
  }
  if (left > 0) placeItemNear(s, pawnTile(p), type, left);
  p.carry = null;
  return 'done';
}

function runDeliver(s: SimState, p: Pawn, j: JobOf<'deliver'>): Result {
  const bp = blueprintById(s, j.bpId);
  if (!bp) return 'fail';
  const spec = STRUCTURES[bp.kind];
  if (j.stage === 'fetch') {
    const it = itemById(s, j.itemId);
    if (!it || it.type !== spec.material) return 'fail';
    const a = approach(s, p, it.tile);
    if (a !== 'there') return notThere(s, p, a);
    p.carry = { type: it.type, count: takeFromItem(s, it, Math.min(j.amount, B.carryMax)) };
    const f = flood(s, pawnTile(p));
    const stand = bestStand(f, bp.tile, true);
    if (stand < 0) return 'fail';
    p.path = pathTo(f, stand);
    j.stage = 'drop';
    return 'run';
  }
  const a = approach(s, p, bp.tile);
  if (a !== 'there') return notThere(s, p, a);
  if (!p.carry) return 'fail';
  face(p, bp.tile);
  const give = Math.min(spec.cost - bp.delivered, p.carry.count);
  bp.delivered += give;
  p.carry.count -= give;
  if (p.carry.count > 0) placeItemNear(s, pawnTile(p), p.carry.type, p.carry.count);
  p.carry = null;
  return 'done';
}

function runBuild(s: SimState, p: Pawn, j: JobOf<'build'>): Result {
  const bp = blueprintById(s, j.bpId);
  if (!bp) return 'done';
  const spec = STRUCTURES[bp.kind];
  if (bp.delivered < spec.cost || buildBlocked(s, bp.tile)) return 'fail';
  const a = approach(s, p, bp.tile);
  if (a !== 'there') return notThere(s, p, a);
  face(p, bp.tile);
  bp.work += workSpeed(p, 'build');
  if (bp.work < spec.work) return 'run';
  completeBlueprint(s, bp);
  return 'done';
}

function runDecon(s: SimState, p: Pawn, j: JobOf<'decon'>): Result {
  const st = structureAt(s, j.tile);
  if (!st || !s.decon[j.tile]) return 'fail';
  const a = approach(s, p, j.tile);
  if (a !== 'there') return notThere(s, p, a);
  face(p, j.tile);
  j.progress += workSpeed(p, 'build');
  const work = st.kind === 'grave' ? 30 : STRUCTURES[st.kind].work * 0.5;
  if (j.progress < work) return 'run';
  removeStructure(s, st);
  if (st.kind !== 'grave') {
    const spec = STRUCTURES[st.kind];
    const refund = Math.floor(spec.cost / 2);
    if (refund > 0) placeItemNear(s, st.tile, spec.material, refund);
  }
  return 'done';
}

function runCook(s: SimState, p: Pawn, j: JobOf<'cook'>): Result {
  const fire = structureById(s, j.stationId);
  if (!fire) return 'fail';
  if (j.stage === 'fetch') {
    const it = itemById(s, j.itemId);
    if (!it || it.type !== 'berries' || it.count < B.berriesPerMeal) return 'fail';
    const a = approach(s, p, it.tile);
    if (a !== 'there') return notThere(s, p, a);
    p.carry = { type: 'berries', count: takeFromItem(s, it, B.berriesPerMeal) };
    const f = flood(s, pawnTile(p));
    const stand = bestStand(f, fire.tile, false);
    if (stand < 0) return 'fail';
    p.path = pathTo(f, stand);
    j.stage = 'cook';
    return 'run';
  }
  const a = approach(s, p, fire.tile);
  if (a !== 'there') return notThere(s, p, a);
  if (!p.carry || p.carry.type !== 'berries') return 'fail';
  face(p, fire.tile);
  j.progress += workSpeed(p, 'cook');
  if (j.progress < B.cookWork) return 'run';
  p.carry = null;
  placeItemNear(s, pawnTile(p), 'meal', 1);
  return 'done';
}

function runEat(s: SimState, p: Pawn, j: JobOf<'eat'>): Result {
  const it = itemById(s, j.itemId);
  if (!it) return 'fail';
  const a = approach(s, p, it.tile);
  if (a !== 'there') return notThere(s, p, a);
  face(p, it.tile);
  if (++j.progress < B.eatTicks) return 'run';
  if (it.type === 'meal') {
    takeFromItem(s, it, 1);
    p.food = Math.min(100, p.food + B.mealNutrition);
    addMemory(p, 'ateMeal', 'Ate a hot meal', 5, s.tick + TICKS_PER_DAY * 0.4);
  } else {
    const units = Math.max(1, Math.min(it.count, Math.ceil((95 - p.food) / B.berryNutrition)));
    takeFromItem(s, it, units);
    p.food = Math.min(100, p.food + units * B.berryNutrition);
    addMemory(p, 'ateRaw', 'Ate raw berries', -3, s.tick + TICKS_PER_DAY / 3);
  }
  return 'done';
}

function runSleep(s: SimState, p: Pawn, j: JobOf<'sleep'>): Result {
  if (!j.asleep) {
    const w = walk(s, p);
    if (w === 'walking') return 'run';
    if (w === 'blocked') return 'fail';
    const bed = j.bedId ? structureById(s, j.bedId) : undefined;
    if (!bed || bed.tile !== pawnTile(p)) j.bedId = 0;
    j.asleep = true;
    return 'run';
  }
  if (j.bedId && !structureById(s, j.bedId)) j.bedId = 0;
  if (p.rest < 100 && (isNight(s.tick) || p.rest < 85)) return 'run';
  const halfDay = s.tick + TICKS_PER_DAY / 2;
  if (!j.bedId) addMemory(p, 'slept', 'Slept on the ground', -4, halfDay);
  else if (isIndoors(s, pawnTile(p))) addMemory(p, 'slept', 'Slept in a bedroom', 4, halfDay);
  else addMemory(p, 'slept', 'Slept in a bed outdoors', 1, halfDay);
  return 'done';
}

function runTend(s: SimState, p: Pawn, j: JobOf<'tend'>): Result {
  const o = pawnById(s, j.targetId);
  if (!o || o.life !== 'downed' || o.bleed <= 0) return 'done';
  const a = approach(s, p, pawnTile(o));
  if (a !== 'there') return notThere(s, p, a);
  face(p, pawnTile(o));
  if (++j.progress < B.tendWork) return 'run';
  o.bleed = 0;
  o.hp = Math.max(o.hp, 6);
  log(s, 'good', `${firstName(p)} bandaged ${firstName(o)}'s wounds.`);
  addMemory(o, 'rescued', `Rescued by ${firstName(p)}`, 6, s.tick + TICKS_PER_DAY);
  return 'done';
}

function runFight(s: SimState, p: Pawn, j: JobOf<'fight'>): Result {
  const t = pawnById(s, j.targetId);
  if (!t || t.life !== 'ok' || t.gone) return 'done';
  const me = pawnTile(p);
  if (p.kind === 'colonist' && !has(p, 'bloodlust')) {
    if (!has(p, 'brave') && p.hp < p.maxHp * 0.3) return 'done';
    if (cheb(s.rally >= 0 ? s.rally : s.home, pawnTile(t)) > 18) return 'done';
  }
  const foe = cheb(me, pawnTile(t)) <= 1 ? t : adjacentFoe(s, p);
  if (foe) {
    j.targetId = foe.id;
    p.path = [];
    face(p, pawnTile(foe));
    if (p.attackCd <= 0) attack(s, p, foe);
    return 'run';
  }
  if (s.tick >= j.repathAt || p.path.length === 0) {
    const f = flood(s, me, p.kind === 'goblin');
    const stand = freeStand(s, f, pawnTile(t), p, false);
    if (stand < 0) return 'fail';
    p.path = pathTo(f, stand);
    j.repathAt = s.tick + 10;
  }
  const w = walk(s, p);
  if (w === 'blocked') return p.kind === 'goblin' ? startBash(s, p) : 'fail';
  return 'run';
}

function runBash(s: SimState, p: Pawn, j: JobOf<'bash'>): Result {
  const st = structureById(s, j.structureId);
  if (!st) return 'done';
  if (p.path.length > 0) {
    const a = approach(s, p, st.tile);
    if (a !== 'there') return notThere(s, p, a);
  }
  if (cheb(pawnTile(p), st.tile) > 1) return 'fail';
  face(p, st.tile);
  if (p.attackCd > 0) return 'run';
  p.attackCd = B.goblinAttackCd;
  p.lastAttackTick = s.tick;
  st.hp -= randInt(s.rng, B.goblinDmg[0], B.goblinDmg[1]);
  if (st.hp > 0) return 'run';
  removeStructure(s, st);
  const label = st.kind === 'grave' ? 'grave' : STRUCTURES[st.kind].label.toLowerCase();
  log(s, 'bad', st.kind === 'door' || st.kind === 'wall' || st.kind === 'stoneWall' ? `Goblins smashed through a ${label}.` : `Goblins wrecked a ${label}.`);
  return 'done';
}

function startBash(s: SimState, p: Pawn): Result {
  const next = p.path[0];
  if (next === undefined || !isBashTarget(s, next)) return 'fail';
  const st = structureAt(s, next);
  if (!st) return 'fail';
  p.job = { kind: 'bash', structureId: st.id };
  p.path = [];
  return 'run';
}

function runSteal(s: SimState, p: Pawn, j: JobOf<'steal'>): Result {
  const it = itemById(s, j.itemId);
  if (!it) return 'fail';
  const a = approach(s, p, it.tile);
  if (a !== 'there') return notThere(s, p, a);
  const type = it.type;
  const n = takeFromItem(s, it, B.stealMax);
  p.carry = { type, count: n };
  if (s.raid) s.raid.stolen += n;
  return 'done';
}

function runLeave(s: SimState, p: Pawn): Result {
  const w = walk(s, p);
  if (w === 'walking') return 'run';
  if (w === 'blocked') return startBash(s, p);
  if (!isEdge(pawnTile(p))) return 'fail';
  p.gone = true;
  if (p.carry && s.raid) s.raid.escapedLoot += p.carry.count;
  return 'done';
}

function runTimed(s: SimState, p: Pawn, j: JobOf<'flee' | 'rally' | 'wander'>): Result {
  if (j.kind === 'flee' && has(p, 'coward') && adjacentFoe(s, p)) return 'done';
  if (j.kind === 'rally' && hostileWithin(s, pawnTile(p), 2)) return 'done';
  const w = walk(s, p);
  if (w === 'walking') return 'run';
  if (w === 'blocked') return 'fail';
  return s.tick >= j.until ? 'done' : 'run';
}

// Combat

/** Colonists standing by the rally point fight as a unit. */
export const holdingLine = (s: SimState, p: Pawn): boolean =>
  p.kind === 'colonist' && s.rally >= 0 && cheb(pawnTile(p), s.rally) <= 2;

function hitChance(s: SimState, a: Pawn, t: Pawn): number {
  let hit = 0.55 + a.skills.combat * 0.035;
  // Every other attacker already on the target makes it harder to parry.
  const target = pawnTile(t);
  let allies = 0;
  for (const o of s.pawns) {
    if (o !== a && o.kind === a.kind && o.life === 'ok' && !o.gone && cheb(pawnTile(o), target) <= 1) allies++;
  }
  hit += Math.min(allies, 2) * B.flankBonus;
  if (holdingLine(s, a)) hit += B.lineHitBonus;
  return Math.min(0.95, hit);
}

function attack(s: SimState, a: Pawn, t: Pawn): void {
  a.attackCd = a.kind === 'goblin' ? B.goblinAttackCd : B.colonistAttackCd;
  a.lastAttackTick = s.tick;
  if (!chance(s.rng, hitChance(s, a, t))) return;
  const [lo, hi] = a.kind === 'goblin' ? B.goblinDmg : B.colonistDmg;
  damage(s, t, randInt(s.rng, lo, hi), a);
}

export function damage(s: SimState, t: Pawn, amount: number, by: Pawn | null): void {
  let dmg = has(t, 'tough') ? amount * B.toughMul : amount;
  if (holdingLine(s, t)) dmg *= B.lineDamageMul;
  t.hp -= Math.round(dmg);
  t.hitTick = s.tick;
  if (t.hp > 0) return;
  t.hp = 0;
  if (t.kind === 'goblin') {
    kill(s, t, 'died');
    if (by) {
      by.kills++;
      log(s, 'good', `${firstName(by)} slew ${t.name}.`);
      if (has(by, 'bloodlust')) addMemory(by, 'bloodlust', 'Enjoyed a good fight', 6, s.tick + TICKS_PER_DAY);
    }
    return;
  }
  if (chance(s.rng, has(t, 'tough') ? B.toughDeathBlowChance : B.deathBlowChance)) {
    if (by) by.kills++;
    kill(s, t, by ? `was slain by ${by.name}` : 'died of wounds');
    return;
  }
  downColonist(s, t);
}

function downColonist(s: SimState, p: Pawn): void {
  endJob(s, p);
  p.life = 'downed';
  p.mental = null;
  p.fromX = p.x;
  p.fromY = p.y;
  p.moveT = p.moveDur = 0;
  const stable = chance(s.rng, has(p, 'tough') ? B.toughStableChance : B.stableChance);
  p.bleed = stable ? 0 : B.bleedTicks;
  log(s, 'bad', stable ? `${p.name} is down, but not bleeding badly.` : `${p.name} is down and bleeding!`);
}

function checkTrap(s: SimState, p: Pawn): void {
  const st = structureAt(s, pawnTile(p));
  if (!st || st.kind !== 'trap') return;
  removeStructure(s, st);
  damage(s, p, randInt(s.rng, B.trapDmg[0], B.trapDmg[1]), null);
  log(s, 'good', p.life === 'dead' ? `${p.name} died on a spike trap.` : `A spike trap caught ${p.name}.`);
}
