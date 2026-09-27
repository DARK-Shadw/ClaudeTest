/**
 * How colonists decide what to do. Left alone they follow their needs, their daily schedule and
 * their skills, and answer raids according to their traits and the rally point, which is what
 * lets a settlement defend itself while its owner is away. Drafted colonists are the exception:
 * they stand where they are told and fight whom they are told.
 */
import { isRanged, inReach } from '../combat';
import { B, FEATURE, MAP_H, MAP_N, MAP_W, TICKS_PER_DAY, ZONE } from '../constants';
import { CRAFT_ORDER, CROPS, ITEMS, RAW_FOODS, RECIPES, WEAPONS, WORK_SKILL, WORK_TYPES, blueprintSpec } from '../defs';
import { cheb, inBounds, tileIndex, tileX, tileY } from '../grid';
import { INF, bestStand, flood, pathTo, type Flood } from '../path';
import { pick, randInt, random } from '../rng';
import { startBrawl } from '../social';
import { hourOf, isNight, seasonOf } from '../time';
import type { ArmorId, CropKind, ItemStack, Job, JobKind, JoyKind, Pawn, SimState, WeaponId, WorkType } from '../types';
import {
  addMemory,
  buildBlocked,
  countGroup,
  countItems,
  endJob,
  foodSupply,
  firstName,
  harvestable,
  has,
  hostiles,
  inStockpile,
  isIndoors,
  log,
  pawnTile,
  ringSearch,
  structureById,
  techDone,
  zoneDest,
  zoneTiles,
} from '../world';
import {
  assign,
  eatersOf,
  freeStand,
  nearestItem,
  occupied,
  pendingDelivery,
  planFight,
  planWander,
  reservedBuild,
  reservedItem,
  reservedTile,
  stationBusy,
  tendReserved,
  type Plan,
} from './common';
import { perform, scheduleAt } from './jobs';

// Tick

export function tickColonist(s: SimState, p: Pawn): void {
  if (p.mental && s.tick >= p.mental.until) endMental(s, p);
  if (p.drafted) {
    draftedTick(s, p);
    return;
  }
  if (p.job) maybeInterrupt(s, p);
  if (!p.job && s.tick >= p.thinkAt) assign(p, planColonist(s, p));
  perform(s, p);
}

function endMental(s: SimState, p: Pawn): void {
  const m = p.mental!;
  p.mental = null;
  if (p.job?.kind === 'wander' || p.job?.kind === 'fight') endJob(s, p);
  if (m.kind === 'daze') {
    addMemory(p, 'catharsis', 'Catharsis', 8, s.tick + TICKS_PER_DAY);
    log(s, 'info', `${firstName(p)} has pulled themselves together.`);
  }
}

/** Drafted colonists hold their ground until given an order, and only give up when starving or dead on their feet. */
function draftedTick(s: SimState, p: Pawn): void {
  if (p.food <= 5 || p.rest <= 5) {
    setDrafted(s, p, false);
    log(s, 'warn', `${firstName(p)} is too ${p.food <= 5 ? 'hungry' : 'exhausted'} to stay on duty.`);
    return;
  }
  if (!p.job) {
    p.job = { kind: 'hold' };
    p.path = [];
  }
  perform(s, p);
}

// Player orders

export function setDrafted(s: SimState, p: Pawn, on: boolean): boolean {
  if (p.kind !== 'colonist' || p.life !== 'ok') return false;
  if (on) {
    if (p.mental || p.drafted) return p.drafted;
    endJob(s, p);
    p.drafted = true;
    p.job = { kind: 'hold' };
    return true;
  }
  if (!p.drafted) return false;
  p.drafted = false;
  endJob(s, p);
  p.thinkAt = s.tick;
  return true;
}

/** Sends drafted colonists to a spot, spread over the nearest free tiles around it. */
export function orderMove(s: SimState, pawns: Pawn[], tile: number): number {
  const taken = new Set<number>();
  let moved = 0;
  for (const p of pawns) {
    if (!setDrafted(s, p, true)) continue;
    const f = flood(s, pawnTile(p));
    const dest = ringSearch(tile, 5, (t) => f.cost[t] < INF && !taken.has(t) && (t === pawnTile(p) || !occupied(s, t, p)));
    if (dest < 0) continue;
    taken.add(dest);
    endJob(s, p);
    p.job = { kind: 'goto', tile: dest };
    p.path = pathTo(f, dest);
    moved++;
  }
  return moved;
}

/** Drafted colonists attack a raider or animal, or tend a downed friend. */
export function orderAttack(s: SimState, pawns: Pawn[], target: Pawn): number {
  let n = 0;
  for (const p of pawns) {
    if (p === target || !setDrafted(s, p, true)) continue;
    if (target.kind === 'colonist') {
      if (target.life !== 'downed') continue;
      const f = flood(s, pawnTile(p));
      const stand = bestStand(f, pawnTile(target), true);
      if (stand < 0) continue;
      endJob(s, p);
      p.job = { kind: 'tend', targetId: target.id, progress: 0, ordered: true };
      p.path = pathTo(f, stand);
    } else {
      if (p.incapable.includes('violence') || target.life !== 'ok' || target.gone) continue;
      endJob(s, p);
      p.job = { kind: 'fight', targetId: target.id, repathAt: s.tick, ordered: true };
      p.path = [];
    }
    n++;
  }
  return n;
}

// Interruptions

const SELF_MANAGED: ReadonlySet<JobKind> = new Set<JobKind>(['fight', 'flee', 'rally', 'tend']);

const bleeding = (o: Pawn): boolean => o.kind === 'colonist' && o.life === 'downed' && o.bleed > 0;

/** Several times a second, busy colonists check whether a raid, hunger or a dying friend should pull them away. */
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
  if (j.kind === 'eat') return;
  if ((s.tick + p.id) % 30 === 0 && s.pawns.some((o) => bleeding(o) && !tendReserved(s, o.id, p))) {
    const plan = planTend(s, p, flood(s, pawnTile(p)), threats);
    if (plan) {
      endJob(s, p);
      assign(p, plan);
      return;
    }
  }
  if (p.food < 10 && j.kind !== 'sleep' && (s.tick + p.id) % 50 === 0) {
    const plan = planEat(s, p, flood(s, pawnTile(p)));
    if (plan) {
      endJob(s, p);
      assign(p, plan);
    }
  }
}

// Planning

function planColonist(s: SimState, p: Pawn): Plan | null {
  const me = pawnTile(p);
  if (p.mental) {
    const plan = planMental(s, p);
    if (plan) return plan;
  }
  const threats = hostiles(s);
  const combat = threats.length > 0 ? planCombat(s, p, threats) : null;
  if (combat && combat.job.kind !== 'rally') return combat;
  const f = flood(s, me);
  // Waiting at the rally point is the one combat job worth leaving to save a life.
  const tend = planTend(s, p, f, threats);
  if (tend || combat) return tend ?? combat;

  if (p.food < B.hungryAt) {
    const eat = planEat(s, p, f);
    if (eat) return eat;
  }
  if (p.rest < 15) return planSleep(s, p, f);
  const block = scheduleAt(p, hourOf(s.tick));
  if (block === 'sleep' && p.rest < 90) return planSleep(s, p, f);
  if (block !== 'work' && p.joy < 95) {
    const joy = planJoy(s, p, f);
    if (joy) return joy;
  }
  if (s.tick >= p.gearAt) {
    p.gearAt = s.tick + 600;
    const gear = planEquip(s, p, f);
    if (gear) return gear;
  }
  if (block !== 'sleep') {
    // With food nearly gone, everyone forages first.
    const colonists = s.pawns.filter((o) => o.kind === 'colonist').length;
    if (foodSupply(s) < colonists * 100) {
      const forage = planGather(s, p, f, true);
      if (forage) return forage;
    }
    const work = planWork(s, p, f);
    if (work) return work;
  }
  if (p.food < 60) {
    const eat = planEat(s, p, f);
    if (eat) return eat;
  }
  if (p.joy < 60) {
    const joy = planJoy(s, p, f);
    if (joy) return joy;
  }
  return planWander(s, f, 5, s.home);
}

function planMental(s: SimState, p: Pawn): Plan | null {
  const m = p.mental!;
  if (m.kind === 'brawl') {
    const o = s.pawns.find((x) => x.id === m.targetId);
    if (o && o.life === 'ok' && o.mental?.kind === 'brawl') {
      const plan = planFight(s, p, o, true);
      if (plan) return plan;
    }
    p.mental = null;
    return null;
  }
  return planWander(s, flood(s, pawnTile(p)), 10, pawnTile(p));
}

// Combat

/**
 * How a colonist answers an attack depends on who they are. Everyone else musters at the rally
 * point, or at home when there is none, and fights whatever comes near it, so the settlement
 * meets a raid together instead of one settler at a time.
 */
export function planCombat(s: SimState, p: Pawn, threats: Pawn[]): Plan | null {
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
  if (p.incapable.includes('violence')) return nearestD <= 12 ? planFlee(s, p, threats) : null;
  const reckless = has(p, 'bloodlust');
  if (!reckless && !has(p, 'brave') && p.hp < p.maxHp * 0.3) return nearestD <= 12 ? planFlee(s, p, threats) : null;
  if (has(p, 'coward')) {
    if (nearestD <= 1) return planFight(s, p, nearest);
    return nearestD <= 14 ? planFlee(s, p, threats) : null;
  }
  if (reckless) return planFight(s, p, nearest);

  const anchor = s.rally >= 0 ? s.rally : s.home;
  // A sworn enemy on the field draws them out.
  if (p.grudge) {
    const foe = threats.find((h) => h.chiefId === p.grudge);
    if (foe && cheb(anchor, pawnTile(foe)) <= 18) {
      const plan = planFight(s, p, foe);
      if (plan) return plan;
    }
  }
  const reach = 7;
  let target: Pawn | null = null;
  let targetD = INF;
  for (const h of threats) {
    const ht = pawnTile(h);
    const d = cheb(me, ht);
    if (cheb(anchor, ht) > reach && d > 2 && !inReach(s, p, h)) continue;
    if (d < targetD) {
      targetD = d;
      target = h;
    }
  }
  if (target) return planFight(s, p, target);
  if (isRanged(p)) {
    const tower = planTower(s, p, anchor);
    if (tower) return tower;
  }
  return planRally(s, p, anchor);
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

function planRally(s: SimState, p: Pawn, anchor: number): Plan | null {
  const me = pawnTile(p);
  const until = s.tick + 15;
  if (cheb(me, anchor) <= 1) return { job: { kind: 'rally', until }, path: [] };
  const f = flood(s, me);
  const stand = freeStand(s, f, anchor, p, true);
  if (stand < 0) return null;
  return { job: { kind: 'rally', until }, path: pathTo(f, stand) };
}

const headingTo = (s: SimState, tile: number, self: Pawn): boolean =>
  s.pawns.some((o) => o !== self && o.job?.kind === 'rally' && o.path.length > 0 && o.path[o.path.length - 1] === tile);

/** Archers man the nearest free watchtower and wait for targets. */
function planTower(s: SimState, p: Pawn, anchor: number): Plan | null {
  const me = pawnTile(p);
  const until = s.tick + 15;
  let f: Flood | null = null;
  let best = -1;
  let bestCost = INF;
  for (const st of s.structures) {
    if (st.kind !== 'tower' || cheb(st.tile, anchor) > 14) continue;
    if (st.tile === me) return { job: { kind: 'rally', until }, path: [] };
    if (occupied(s, st.tile, p) || headingTo(s, st.tile, p)) continue;
    f ??= flood(s, me);
    if (f.cost[st.tile] < bestCost) {
      bestCost = f.cost[st.tile];
      best = st.tile;
    }
  }
  if (best < 0 || !f) return null;
  return { job: { kind: 'rally', until }, path: pathTo(f, best) };
}

// Needs

/** Downed colonists who are bleeding, or who have not had their wounds seen to yet. */
const needsTending = (o: Pawn): boolean =>
  o.kind === 'colonist' && o.life === 'downed' && (o.bleed > 0 || !o.memories.some((m) => m.key === 'tended'));

function planTend(s: SimState, p: Pawn, f: Flood, threats: Pawn[]): Plan | null {
  let stand = -1;
  let bestCost = INF;
  let targetId = 0;
  for (const o of s.pawns) {
    if (o === p || !needsTending(o) || tendReserved(s, o.id, p)) continue;
    const ot = pawnTile(o);
    if (!has(p, 'brave') && threats.some((h) => cheb(pawnTile(h), ot) <= 4)) continue;
    const st = bestStand(f, ot, true);
    if (st < 0) continue;
    // The bleeding come first.
    const cost = f.cost[st] + (o.bleed > 0 ? 0 : 400);
    if (cost < bestCost) {
      bestCost = cost;
      stand = st;
      targetId = o.id;
    }
  }
  if (stand < 0) return null;
  return { job: { kind: 'tend', targetId, progress: 0, ordered: false }, path: pathTo(f, stand) };
}

/** Fine meals, then simple meals, then whatever raw food is nearest. */
function planEat(s: SimState, p: Pawn, f: Flood): Plan | null {
  const ascetic = has(p, 'ascetic');
  let best: ItemStack | null = null;
  let stand = -1;
  let bestCost = INF;
  for (const it of s.items) {
    const spec = ITEMS[it.type];
    const meal = spec.group === 'meal';
    if (!meal && spec.group !== 'food') continue;
    const servings = meal ? it.count : Math.floor(it.count / 4);
    if (eatersOf(s, it.id, p) >= Math.max(1, servings) || reservedItem(s, it.id, p, true)) continue;
    const st = bestStand(f, it.tile, true);
    if (st < 0) continue;
    const cost = f.cost[st] + (it.type === 'fineMeal' ? 0 : meal ? 30 : ascetic ? 60 : 250);
    if (cost < bestCost) {
      bestCost = cost;
      stand = st;
      best = it;
    }
  }
  if (!best) return null;
  return { job: { kind: 'eat', itemId: best.id, stage: 'fetch', progress: 0, table: -1 }, path: pathTo(f, stand) };
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

// Recreation

const JOY_OF: Partial<Record<string, JoyKind>> = { campfire: 'campfire', horseshoes: 'horseshoes', chessTable: 'chess', statue: 'statue' };
/** How many can share one game at a time. */
const JOY_SEATS: Partial<Record<JoyKind, number>> = { chess: 2, horseshoes: 2 };

interface JoyOption {
  joy: JoyKind;
  target: number;
  stand: number;
  weight: number;
}

const playing = (s: SimState, joy: JoyKind, target: number, self: Pawn): number =>
  s.pawns.filter((o) => o !== self && o.job?.kind === 'joy' && o.job.joy === joy && o.job.target === target).length;

/** Picks something fun to do: a fire, a game, a statue, the stars or a stroll. Tastes differ. */
function planJoy(s: SimState, p: Pawn, f: Flood): Plan | null {
  const night = isNight(s.tick);
  const nearest = new Map<JoyKind, JoyOption>();
  for (const st of s.structures) {
    const joy = JOY_OF[st.kind];
    if (!joy) continue;
    const seats = JOY_SEATS[joy];
    if (seats && playing(s, joy, st.tile, p) >= seats) continue;
    const stand = freeStand(s, f, st.tile, p, false);
    if (stand < 0 || f.cost[stand] > 500) continue;
    const prev = nearest.get(joy);
    if (!prev || f.cost[stand] < f.cost[prev.stand]) nearest.set(joy, { joy, target: st.tile, stand, weight: 0 });
  }
  const options: JoyOption[] = [];
  for (const o of nearest.values()) {
    if (o.joy === 'campfire') o.weight = night ? 3 : 1;
    else if (o.joy === 'chess') o.weight = 1.5 + p.passions.intellect + (has(p, 'tooSmart') ? 1 : 0);
    else if (o.joy === 'horseshoes') o.weight = 1.5 + p.passions.shooting;
    else o.weight = has(p, 'ascetic') ? 0.3 : 1.2;
    options.push(o);
  }
  if (night) {
    for (let i = 0; i < 6; i++) {
      const t = tileIndex(
        Math.max(0, Math.min(MAP_W - 1, tileX(s.home) + randInt(s.rng, -8, 8))),
        Math.max(0, Math.min(MAP_H - 1, tileY(s.home) + randInt(s.rng, -8, 8))),
      );
      if (f.cost[t] >= INF || isIndoors(s, t)) continue;
      options.push({ joy: 'stargaze', target: t, stand: t, weight: has(p, 'nightOwl') ? 3 : 1.5 });
      break;
    }
  }
  for (let i = 0; i < 6; i++) {
    const x = p.x + randInt(s.rng, -10, 10);
    const y = p.y + randInt(s.rng, -10, 10);
    if (!inBounds(x, y)) continue;
    const t = tileIndex(x, y);
    if (f.cost[t] >= INF) continue;
    options.push({ joy: 'walk', target: t, stand: t, weight: 1 });
    break;
  }
  if (options.length === 0) return null;
  let total = 0;
  for (const o of options) total += o.weight;
  let r = random(s.rng) * total;
  let choice = options[options.length - 1];
  for (const o of options) {
    if ((r -= o.weight) < 0) {
      choice = o;
      break;
    }
  }
  return {
    job: { kind: 'joy', joy: choice.joy, target: choice.target, until: s.tick + randInt(s.rng, 150, 300) },
    path: pathTo(f, choice.stand),
  };
}

// Gear

/** How much a colonist would like to fight with a weapon, given their skills. */
export function weaponScore(p: Pawn, weapon: WeaponId): number {
  const spec = WEAPONS[weapon];
  if (weapon === 'fists') return p.skills.melee * 0.5;
  if (spec.range > 1) return p.skills.shooting + spec.tier * 2;
  return p.skills.melee + spec.tier * 3;
}

const ARMOR_RANK: Record<ArmorId, number> = { none: 0, leatherArmor: 1, ironArmor: 2 };

/** Picks up a better weapon or armor lying around, if there is one. */
function planEquip(s: SimState, p: Pawn, f: Flood): Plan | null {
  const fights = !p.incapable.includes('violence');
  const current = weaponScore(p, p.weapon);
  let best: ItemStack | null = null;
  let stand = -1;
  let bestGain = 0;
  let bestCost = INF;
  for (const it of s.items) {
    const group = ITEMS[it.type].group;
    let gain: number;
    if (group === 'weapon') {
      if (!fights) continue;
      gain = weaponScore(p, it.type as WeaponId) - current;
    } else if (group === 'armor') {
      gain = (ARMOR_RANK[it.type as ArmorId] - ARMOR_RANK[p.armor]) * 4;
    } else {
      continue;
    }
    if (gain < 1 || gain < bestGain || reservedItem(s, it.id, p)) continue;
    const st = bestStand(f, it.tile, true);
    if (st < 0) continue;
    if (gain === bestGain && f.cost[st] >= bestCost) continue;
    best = it;
    stand = st;
    bestGain = gain;
    bestCost = f.cost[st];
  }
  if (!best) return null;
  return { job: { kind: 'equip', itemId: best.id }, path: pathTo(f, stand) };
}

// Work

/** Their focus first; otherwise what they are best at and love most, with research and hauling last. */
export function workOrder(p: Pawn): WorkType[] {
  const can = (w: WorkType): boolean =>
    !(w === 'haul' && p.incapable.includes('dumb')) && !(w === 'hunt' && p.incapable.includes('violence'));
  const score = (w: WorkType): number => {
    const skill = WORK_SKILL[w];
    const bonus = w === 'build' ? 3 : w === 'cook' ? 2 : w === 'hunt' ? 1 : 0;
    return (skill ? p.skills[skill] + p.passions[skill] * 3 : 0) + bonus;
  };
  const main = WORK_TYPES.filter((w) => w !== 'research' && w !== 'haul' && can(w)).sort((a, b) => score(b) - score(a));
  const order = [...main, 'research' as const, ...(can('haul') ? (['haul'] as const) : [])];
  if (p.role === 'any' || !can(p.role)) return order;
  return [p.role, ...order.filter((w) => w !== p.role)];
}

function planWork(s: SimState, p: Pawn, f: Flood): Plan | null {
  for (const work of workOrder(p)) {
    const plan = PLANNERS[work](s, p, f);
    if (plan) return plan;
  }
  return null;
}

const PLANNERS: Record<WorkType, (s: SimState, p: Pawn, f: Flood) => Plan | null> = {
  build: planBuild,
  farm: planFarm,
  gather: planGather,
  cook: planCook,
  craft: planCraft,
  hunt: planHunting,
  research: planResearch,
  haul: planHaul,
};

function planBuild(s: SimState, p: Pawn, f: Flood): Plan | null {
  let job: Job | null = null;
  let stand = -1;
  let bestCost = INF;

  // Raise blueprints that have all their materials.
  for (const bp of s.blueprints) {
    if (bp.delivered < blueprintSpec(bp.kind).cost || buildBlocked(s, bp.tile) || reservedBuild(s, bp.id, p)) continue;
    const st = bestStand(f, bp.tile, false);
    if (st >= 0 && f.cost[st] < bestCost) {
      bestCost = f.cost[st];
      stand = st;
      job = { kind: 'build', bpId: bp.id };
    }
  }
  if (job) return { job, path: pathTo(f, stand) };

  // Carry materials to blueprints.
  const sources = new Map<string, ReturnType<typeof nearestItem>>();
  for (const bp of s.blueprints) {
    const spec = blueprintSpec(bp.kind);
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

const FIELD_CROP: Record<number, CropKind> = { [ZONE.POTATO]: 'potato', [ZONE.HEALROOT]: 'healroot' };

/** Harvest what is ripe, then sow empty field tiles. Nothing is sown in winter. */
function planFarm(s: SimState, p: Pawn, f: Flood): Plan | null {
  const sowing = seasonOf(s.tick) !== 'winter';
  let job: Job | null = null;
  let stand = -1;
  let bestCost = INF;
  for (let t = 0; t < MAP_N; t++) {
    const code = s.plant[t];
    let kind: 'reap' | 'sow';
    if (code) {
      if (s.growth[t] < 1000) continue;
      kind = 'reap';
    } else {
      const crop = FIELD_CROP[s.zone[t]];
      if (!sowing || !crop || s.feature[t] !== FEATURE.NONE || s.structGrid[t] || !techDone(s, CROPS[crop].tech)) continue;
      kind = 'sow';
    }
    if (reservedTile(s, t, p)) continue;
    const st = bestStand(f, t, true);
    if (st < 0) continue;
    // Ripe crops come before sowing.
    const cost = f.cost[st] + (kind === 'sow' ? 150 : 0);
    if (cost < bestCost) {
      bestCost = cost;
      stand = st;
      job = { kind, tile: t, progress: 0 };
    }
  }
  return job ? { job, path: pathTo(f, stand) } : null;
}

/** Marked trees, rocks and bushes. When food runs low, any ripe berry bush near home will do. */
function planGather(s: SimState, p: Pawn, f: Flood, forageOnly = false): Plan | null {
  const forage = forageOnly || foodSupply(s) < s.pawns.filter((o) => o.kind === 'colonist').length * 160;
  let stand = -1;
  let tile = -1;
  let bestCost = INF;
  for (let t = 0; t < MAP_N; t++) {
    const bush = s.feature[t] === FEATURE.BUSH;
    const wanted = forageOnly ? bush && (s.designated[t] || cheb(t, s.home) <= 22) : s.designated[t] || (forage && bush && cheb(t, s.home) <= 22);
    if (!wanted || !harvestable(s, t) || reservedTile(s, t, p)) continue;
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

/** Keeps a couple of meals per settler in stock. Good cooks make fine meals at a stove. */
function planCook(s: SimState, p: Pawn, f: Flood): Plan | null {
  const stations = s.structures.filter((st) => (st.kind === 'campfire' || st.kind === 'stove') && !stationBusy(s, st.id, p));
  if (stations.length === 0) return null;
  const eaters = s.pawns.filter((o) => o.kind === 'colonist').length;
  const cooking = s.pawns.filter((o) => o.job?.kind === 'cook').length;
  if (countGroup(s, 'meal') + cooking >= eaters * 2 + 1) return null;
  const src = nearestItem(s, f, RAW_FOODS, p, B.rawPerMeal);
  if (!src) return null;
  const fine = p.skills.cooking >= 5;
  let station = null;
  let bestScore = INF;
  for (const st of stations) {
    if (bestStand(f, st.tile, false) < 0) continue;
    const score = cheb(st.tile, src.item.tile) * 10 - (st.kind === 'stove' && fine ? 150 : 0);
    if (score < bestScore) {
      bestScore = score;
      station = st;
    }
  }
  if (!station) return null;
  return {
    job: { kind: 'cook', stationId: station.id, stage: 'fetch', progress: 0, fine: station.kind === 'stove' && fine },
    path: pathTo(f, src.stand),
  };
}

/** Works through the crafting orders: keep this many of each item in stock. */
function planCraft(s: SimState, p: Pawn, f: Flood): Plan | null {
  const benches = s.structures.filter((st) => st.kind === 'craftBench' && !stationBusy(s, st.id, p) && bestStand(f, st.tile, false) >= 0);
  if (benches.length === 0) return null;
  for (const item of CRAFT_ORDER) {
    const want = s.orders[item];
    const recipe = RECIPES[item];
    if (!want || !techDone(s, recipe.tech)) continue;
    const making = s.pawns.filter((o) => o.job?.kind === 'craft' && o.job.item === item).length;
    if (countItems(s, item) + making >= want) continue;
    const src = nearestItem(s, f, recipe.material, p, recipe.cost);
    if (!src) continue;
    let bench = benches[0];
    for (const b of benches) if (cheb(b.tile, src.item.tile) < cheb(bench.tile, src.item.tile)) bench = b;
    return { job: { kind: 'craft', benchId: bench.id, item, stage: 'fetch', progress: 0 }, path: pathTo(f, src.stand) };
  }
  return null;
}

/** Animals the player marked for hunting. Nobody hunts barehanded. */
function planHunting(s: SimState, p: Pawn, f: Flood): Plan | null {
  if (p.weapon === 'fists') return null;
  let stand = -1;
  let targetId = 0;
  let bestCost = INF;
  for (const a of s.pawns) {
    if (a.kind !== 'animal' || !a.marked || a.hostile || a.life !== 'ok') continue;
    const st = freeStand(s, f, pawnTile(a), p, false);
    if (st >= 0 && f.cost[st] < bestCost) {
      bestCost = f.cost[st];
      stand = st;
      targetId = a.id;
    }
  }
  if (!targetId) return null;
  return { job: { kind: 'hunt', targetId, repathAt: s.tick + 10 }, path: pathTo(f, stand) };
}

function planResearch(s: SimState, p: Pawn, f: Flood): Plan | null {
  const tech = s.research.current;
  if (!tech || s.research.done.includes(tech)) return null;
  let deskId = 0;
  let stand = -1;
  let bestCost = INF;
  for (const st of s.structures) {
    if (st.kind !== 'researchDesk' || stationBusy(s, st.id, p)) continue;
    const sp = bestStand(f, st.tile, false);
    if (sp >= 0 && f.cost[sp] < bestCost) {
      bestCost = f.cost[sp];
      stand = sp;
      deskId = st.id;
    }
  }
  if (!deskId) return null;
  return { job: { kind: 'research', deskId, until: s.tick + 400 }, path: pathTo(f, stand) };
}

function planHaul(s: SimState, p: Pawn, f: Flood): Plan | null {
  const zone = zoneTiles(s);
  if (zone.length === 0) return null;
  let job: Job | null = null;
  let stand = -1;
  let bestCost = INF;
  for (const it of s.items) {
    if (inStockpile(s, it.tile) || reservedItem(s, it.id, p)) continue;
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

// Mental breaks

/** Colonists pushed past their limit either wander off in a daze or pick a fight with someone they hate. */
export function mentalBreak(s: SimState, p: Pawn): void {
  const foes = s.pawns.filter(
    (o) => o !== p && o.kind === 'colonist' && o.life === 'ok' && !o.drafted && !o.mental && p.relations.some((r) => r.id === o.id && r.kind === 'rival'),
  );
  const angry = has(p, 'volatile') || has(p, 'abrasive') || has(p, 'bloodlust');
  endJob(s, p);
  if (foes.length > 0 && !p.incapable.includes('violence') && random(s.rng) < (angry ? 0.7 : 0.3)) {
    startBrawl(s, p, pick(s.rng, foes));
    return;
  }
  p.mental = { kind: 'daze', until: s.tick + randInt(s.rng, TICKS_PER_DAY / 12, TICKS_PER_DAY / 6), targetId: 0 };
  log(s, 'warn', `${firstName(p)} broke down and is wandering in a daze.`);
}
