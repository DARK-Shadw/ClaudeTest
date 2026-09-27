/** Carrying out jobs, one tick at a time. Planning lives in colonist.ts, raider.ts and animal.ts. */
import { attack, chiefEscaped, inReach, isRanged, onTower } from '../combat';
import { B, CROP, FEATURE, TICKS_PER_DAY, ZONE } from '../constants';
import { ARMORS, BUILDINGS, CROPS, CROP_BY_CODE, ITEMS, RECIPES, TECHS, WEAPONS, blueprintSpec, type CropSpec } from '../defs';
import { cheb, inBounds, isEdge, tileIndex } from '../grid';
import { INF, bestStand, flood, pathTo } from '../path';
import { randInt } from '../rng';
import { learn, workSpeed } from '../skills';
import { hourOf, isNight } from '../time';
import type { ArmorId, Pawn, SimState, WeaponId } from '../types';
import {
  addItemAt,
  addMemory,
  blueprintById,
  buildBlocked,
  capacity,
  completeBlueprint,
  endJob,
  firstName,
  harvestable,
  has,
  impressivenessLabel,
  impressivenessTier,
  itemById,
  log,
  pawnById,
  pawnTile,
  placeItemNear,
  removeStructure,
  roomAt,
  story,
  structureAt,
  structureById,
  takeFromItem,
  techDone,
  zoneDest,
  zoneTiles,
} from '../world';
import {
  approach,
  enemyInReach,
  face,
  freeStand,
  hostileWithin,
  notThere,
  startBash,
  walk,
  type JobOf,
  type Result,
} from './common';

export type ScheduleBlock = 'sleep' | 'work' | 'joy';

/** What a colonist should be doing at this hour. Night owls live the other way round. */
export function scheduleAt(p: Pawn, hour: number): ScheduleBlock {
  const h = Math.floor(hour);
  if (has(p, 'nightOwl')) {
    if (h >= 9 && h < 17) return 'sleep';
    if (h >= 5 && h < 9) return 'joy';
    return 'work';
  }
  if (h >= 22 || h < 6) return 'sleep';
  if (h >= 19) return 'joy';
  return 'work';
}

/** Runs the current job for a tick and clears it once it is over. A failure waits a moment before replanning. */
export function perform(s: SimState, p: Pawn): void {
  if (!p.job) return;
  const result = runJob(s, p);
  if (result === 'run') return;
  endJob(s, p);
  if (result === 'fail') p.thinkAt = s.tick + 5;
}

export function runJob(s: SimState, p: Pawn): Result {
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
    case 'sow':
      return runSow(s, p, j);
    case 'reap':
      return runReap(s, p, j);
    case 'cook':
      return runCook(s, p, j);
    case 'craft':
      return runCraft(s, p, j);
    case 'research':
      return runResearch(s, p, j);
    case 'equip':
      return runEquip(s, p, j);
    case 'eat':
      return runEat(s, p, j);
    case 'sleep':
      return runSleep(s, p, j);
    case 'joy':
      return runJoy(s, p, j);
    case 'tend':
      return runTend(s, p, j);
    case 'fight':
      return runFight(s, p, j);
    case 'hunt':
      return runHunt(s, p, j);
    case 'bash':
      return runBash(s, p, j);
    case 'steal':
      return runSteal(s, p, j);
    case 'leave':
      return runLeave(s, p);
    case 'goto':
      return runGoto(s, p);
    case 'hold':
      return runHold(s, p);
    case 'flee':
    case 'rally':
    case 'wander':
      return runTimed(s, p, j);
  }
}

// Gathering and building

const HARVEST_WORK: Record<number, number> = {
  [FEATURE.TREE]: B.harvestWork.tree,
  [FEATURE.BUSH]: B.harvestWork.bush,
  [FEATURE.BOULDER]: B.harvestWork.boulder,
  [FEATURE.ORE]: B.harvestWork.ore,
};

function runHarvest(s: SimState, p: Pawn, j: JobOf<'harvest'>): Result {
  if (!harvestable(s, j.tile) || (!s.designated[j.tile] && s.feature[j.tile] !== FEATURE.BUSH)) return 'fail';
  const a = approach(s, p, j.tile);
  if (a !== 'there') return notThere(s, p, a);
  face(p, j.tile);
  const f = s.feature[j.tile];
  const skill = f === FEATURE.BOULDER || f === FEATURE.ORE ? 'mining' : 'plants';
  const speed = workSpeed(p, skill);
  j.progress += speed;
  learn(s, p, skill, speed);
  if (j.progress < HARVEST_WORK[f]) return 'run';
  finishHarvest(s, j.tile, p);
  return 'done';
}

function finishHarvest(s: SimState, t: number, p: Pawn): void {
  const f = s.feature[t];
  if (f === FEATURE.TREE) {
    s.feature[t] = FEATURE.NONE;
    s.designated[t] = 0;
    placeItemNear(s, t, 'wood', B.harvestYield.tree);
  } else if (f === FEATURE.BOULDER || f === FEATURE.ORE) {
    s.feature[t] = FEATURE.NONE;
    s.designated[t] = 0;
    placeItemNear(s, t, f === FEATURE.ORE ? 'iron' : 'stone', f === FEATURE.ORE ? B.harvestYield.ore : B.harvestYield.boulder);
  } else if (f === FEATURE.BUSH) {
    s.regrow[t] = s.tick + B.bushRegrow;
    const n = Math.round(B.harvestYield.bush * (has(p, 'greenThumb') ? 1.5 : 1) * (0.8 + p.skills.plants / 40));
    placeItemNear(s, t, 'berries', n);
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
  const spec = blueprintSpec(bp.kind);
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
  const spec = blueprintSpec(bp.kind);
  if (bp.delivered < spec.cost || buildBlocked(s, bp.tile)) return 'fail';
  const a = approach(s, p, bp.tile);
  if (a !== 'there') return notThere(s, p, a);
  face(p, bp.tile);
  const speed = workSpeed(p, 'construction');
  bp.work += speed;
  learn(s, p, 'construction', speed);
  if (bp.work < spec.work) return 'run';
  completeBlueprint(s, bp);
  if (!bp.floor && (bp.kind === 'statue' || bp.kind === 'tower' || bp.kind === 'researchDesk' || bp.kind === 'craftBench' || bp.kind === 'stove')) {
    log(s, 'good', `${firstName(p)} finished building a ${spec.label.toLowerCase()}.`);
    story(s, p, `Built a ${spec.label.toLowerCase()}.`);
  }
  return 'done';
}

function runDecon(s: SimState, p: Pawn, j: JobOf<'decon'>): Result {
  const st = structureAt(s, j.tile);
  if (!st || !s.decon[j.tile]) return 'fail';
  const a = approach(s, p, j.tile);
  if (a !== 'there') return notThere(s, p, a);
  face(p, j.tile);
  j.progress += workSpeed(p, 'construction');
  const work = st.kind === 'grave' ? 30 : BUILDINGS[st.kind].work * 0.5;
  if (j.progress < work) return 'run';
  removeStructure(s, st);
  if (st.kind !== 'grave') {
    const spec = BUILDINGS[st.kind];
    const refund = Math.floor(spec.cost / 2);
    if (refund > 0) placeItemNear(s, st.tile, spec.material, refund);
  }
  return 'done';
}

// Farming

const FIELD_CROP: Record<number, number> = { [ZONE.POTATO]: CROP.POTATO, [ZONE.HEALROOT]: CROP.HEALROOT };

function runSow(s: SimState, p: Pawn, j: JobOf<'sow'>): Result {
  const crop = FIELD_CROP[s.zone[j.tile]];
  if (!crop || s.plant[j.tile] || s.feature[j.tile] !== FEATURE.NONE) return 'fail';
  const a = approach(s, p, j.tile);
  if (a !== 'there') return notThere(s, p, a);
  face(p, j.tile);
  const speed = workSpeed(p, 'plants');
  j.progress += speed;
  learn(s, p, 'plants', speed);
  if (j.progress < B.sowWork) return 'run';
  s.plant[j.tile] = crop;
  s.growth[j.tile] = 0;
  s.structVersion++;
  return 'done';
}

function runReap(s: SimState, p: Pawn, j: JobOf<'reap'>): Result {
  const code = s.plant[j.tile];
  if (!code || s.growth[j.tile] < 1000) return 'fail';
  const a = approach(s, p, j.tile);
  if (a !== 'there') return notThere(s, p, a);
  face(p, j.tile);
  const speed = workSpeed(p, 'plants');
  j.progress += speed;
  learn(s, p, 'plants', speed);
  if (j.progress < B.reapWork) return 'run';
  const crop: CropSpec = CROPS[CROP_BY_CODE[code] as keyof typeof CROPS];
  const n = Math.max(1, Math.round(crop.yield * (has(p, 'greenThumb') ? 1.5 : 1) * (0.8 + p.skills.plants / 40)));
  s.plant[j.tile] = 0;
  s.growth[j.tile] = 0;
  s.structVersion++;
  placeItemNear(s, j.tile, crop.item, n);
  return 'done';
}

// Workshops

function runCook(s: SimState, p: Pawn, j: JobOf<'cook'>): Result {
  const station = structureById(s, j.stationId);
  if (!station) return 'fail';
  if (j.stage === 'fetch') {
    const a = walk(s, p);
    if (a === 'walking') return 'run';
    if (a === 'blocked') return 'fail';
    // Pick up raw food lying next to us.
    const it = s.items.find((i) => ITEMS[i.type].group === 'food' && i.count >= B.rawPerMeal && cheb(i.tile, pawnTile(p)) <= 1);
    if (!it) return 'fail';
    p.carry = { type: it.type, count: takeFromItem(s, it, B.rawPerMeal) };
    const f = flood(s, pawnTile(p));
    const stand = bestStand(f, station.tile, false);
    if (stand < 0) return 'fail';
    p.path = pathTo(f, stand);
    j.stage = 'cook';
    return 'run';
  }
  const a = approach(s, p, station.tile);
  if (a !== 'there') return notThere(s, p, a);
  if (!p.carry || ITEMS[p.carry.type].group !== 'food') return 'fail';
  face(p, station.tile);
  const speed = workSpeed(p, 'cooking') * (station.kind === 'stove' ? 1.3 : 1);
  j.progress += speed;
  learn(s, p, 'cooking', speed);
  if (j.progress < B.cookWork) return 'run';
  p.carry = null;
  placeItemNear(s, pawnTile(p), j.fine ? 'fineMeal' : 'meal', 1);
  return 'done';
}

function runCraft(s: SimState, p: Pawn, j: JobOf<'craft'>): Result {
  const bench = structureById(s, j.benchId);
  const recipe = RECIPES[j.item];
  if (!bench) return 'fail';
  if (j.stage === 'fetch') {
    const a = walk(s, p);
    if (a === 'walking') return 'run';
    if (a === 'blocked') return 'fail';
    const it = s.items.find((i) => i.type === recipe.material && i.count >= recipe.cost && cheb(i.tile, pawnTile(p)) <= 1);
    if (!it) return 'fail';
    p.carry = { type: it.type, count: takeFromItem(s, it, recipe.cost) };
    const f = flood(s, pawnTile(p));
    const stand = bestStand(f, bench.tile, false);
    if (stand < 0) return 'fail';
    p.path = pathTo(f, stand);
    j.stage = 'work';
    return 'run';
  }
  const a = approach(s, p, bench.tile);
  if (a !== 'there') return notThere(s, p, a);
  if (!p.carry || p.carry.type !== recipe.material) return 'fail';
  face(p, bench.tile);
  const speed = workSpeed(p, 'crafting');
  j.progress += speed;
  learn(s, p, 'crafting', speed);
  if (j.progress < recipe.work) return 'run';
  p.carry = null;
  placeItemNear(s, pawnTile(p), j.item, 1);
  log(s, 'info', `${firstName(p)} made a ${ITEMS[j.item].label.toLowerCase()}.`);
  return 'done';
}

function runResearch(s: SimState, p: Pawn, j: JobOf<'research'>): Result {
  const desk = structureById(s, j.deskId);
  const tech = s.research.current;
  if (!desk || !tech) return 'fail';
  const a = approach(s, p, desk.tile);
  if (a !== 'there') return notThere(s, p, a);
  face(p, desk.tile);
  const speed = workSpeed(p, 'intellect');
  s.research.progress[tech] += speed * B.researchRate;
  learn(s, p, 'intellect', speed);
  if (s.research.progress[tech] >= TECHS[tech].cost) {
    s.research.done.push(tech);
    s.research.current = '';
    s.structVersion++;
    log(s, 'good', `Research complete: ${TECHS[tech].label}. ${TECHS[tech].desc}`, true);
    story(s, p, `Finished the research on ${TECHS[tech].label.toLowerCase()}.`);
    return 'done';
  }
  return s.tick >= j.until ? 'done' : 'run';
}

function runEquip(s: SimState, p: Pawn, j: JobOf<'equip'>): Result {
  const it = itemById(s, j.itemId);
  if (!it) return 'fail';
  const a = approach(s, p, it.tile);
  if (a !== 'there') return notThere(s, p, a);
  const type = it.type;
  const group = ITEMS[type].group;
  if (group === 'weapon') {
    const old = WEAPONS[p.weapon].item;
    takeFromItem(s, it, 1);
    if (old) placeItemNear(s, pawnTile(p), old, 1);
    p.weapon = type as WeaponId;
  } else if (group === 'armor') {
    const old = ARMORS[p.armor].item;
    takeFromItem(s, it, 1);
    if (old) placeItemNear(s, pawnTile(p), old, 1);
    p.armor = type as ArmorId;
  } else {
    return 'fail';
  }
  return 'done';
}

// Needs

function runEat(s: SimState, p: Pawn, j: JobOf<'eat'>): Result {
  if (j.stage === 'fetch') {
    const it = itemById(s, j.itemId);
    if (!it) return 'fail';
    const a = approach(s, p, it.tile);
    if (a !== 'there') return notThere(s, p, a);
    const spec = ITEMS[it.type];
    const units = spec.group === 'meal' ? 1 : Math.max(1, Math.min(8, Math.ceil((95 - p.food) / (spec.nutrition ?? 8))));
    p.carry = { type: it.type, count: takeFromItem(s, it, units) };
    // Carry the food to the nearest table with a free seat, if there is one within reach.
    const f = flood(s, pawnTile(p), false, 260);
    let best = -1;
    let bestCost = 1e9;
    for (const st of s.structures) {
      if (st.kind !== 'table') continue;
      const stand = freeStand(s, f, st.tile, p, false);
      if (stand >= 0 && f.cost[stand] < bestCost) {
        bestCost = f.cost[stand];
        best = stand;
        j.table = st.tile;
      }
    }
    if (best >= 0) {
      p.path = pathTo(f, best);
      j.stage = 'table';
    } else {
      j.stage = 'eat';
    }
    return 'run';
  }
  if (j.stage === 'table') {
    const w = walk(s, p);
    if (w === 'walking') return 'run';
    if (w === 'blocked') j.table = -1;
    j.stage = 'eat';
    return 'run';
  }
  if (j.table >= 0) face(p, j.table);
  if (++j.progress < B.eatTicks) return 'run';
  const food = p.carry;
  if (!food) return 'fail';
  const spec = ITEMS[food.type];
  p.food = Math.min(100, p.food + (spec.nutrition ?? 8) * food.count);
  p.carry = null;
  const day = TICKS_PER_DAY;
  if (food.type === 'fineMeal') addMemory(p, 'meal', 'Ate a fine meal', 7, s.tick + day * 0.4);
  else if (food.type === 'meal') addMemory(p, 'meal', 'Ate a simple meal', 3, s.tick + day * 0.4);
  else if (!has(p, 'ascetic')) addMemory(p, 'meal', 'Ate raw food', -3, s.tick + day / 3);
  const atTable = j.table >= 0 && cheb(pawnTile(p), j.table) <= 1;
  if (atTable) {
    const room = roomAt(s, pawnTile(p));
    const tier = room ? impressivenessTier(room.impressiveness) : 0;
    if (tier >= 3) addMemory(p, 'dining', `Ate in a ${impressivenessLabel(room!.impressiveness)} dining room`, (tier - 2) * 2, s.tick + day / 2);
    else p.memories = p.memories.filter((m) => m.key !== 'dining');
  } else if (!has(p, 'ascetic')) {
    addMemory(p, 'dining', 'Ate without a table', -3, s.tick + day / 2);
  }
  return 'done';
}

const BEDROOM_MOOD = [-4, -2, 0, 2, 4, 6, 8];

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
  const block = scheduleAt(p, hourOf(s.tick));
  if (p.rest < 100 && (block === 'sleep' || p.rest < 80)) return 'run';
  const halfDay = s.tick + TICKS_PER_DAY / 2;
  const ascetic = has(p, 'ascetic');
  if (!j.bedId) {
    if (!ascetic) addMemory(p, 'slept', 'Slept on the ground', -4, halfDay);
    return 'done';
  }
  const room = roomAt(s, pawnTile(p));
  if (!room) addMemory(p, 'slept', 'Slept in a bed outdoors', -1, halfDay);
  else if (room.beds >= 3) addMemory(p, 'slept', 'Slept in a barracks', ascetic ? 0 : -2, halfDay);
  else {
    const tier = impressivenessTier(room.impressiveness);
    const mood = BEDROOM_MOOD[tier];
    addMemory(p, 'slept', `Slept in a ${impressivenessLabel(room.impressiveness)} bedroom`, ascetic ? Math.max(1, mood) : mood, halfDay);
  }
  return 'done';
}

const JOY_RATE: Record<string, number> = {
  campfire: 0.07,
  stargaze: 0.07,
  horseshoes: 0.08,
  chess: 0.09,
  statue: 0.06,
  walk: 0.05,
};

function runJoy(s: SimState, p: Pawn, j: JobOf<'joy'>): Result {
  const w = walk(s, p);
  if (w === 'blocked') return 'fail';
  if (j.joy === 'walk') {
    p.joy = Math.min(100, p.joy + JOY_RATE.walk);
    if (s.tick >= j.until || p.joy >= 100) return 'done';
    if (w === 'arrived') p.path = strollOn(s, p);
    return 'run';
  }
  if (w === 'walking') return 'run';
  if (j.joy !== 'stargaze') face(p, j.target);
  p.joy = Math.min(100, p.joy + JOY_RATE[j.joy]);
  if (j.joy === 'chess') learn(s, p, 'intellect', 0.3);
  if (j.joy === 'horseshoes') learn(s, p, 'shooting', 0.3);
  if (j.joy === 'stargaze' && !isNight(s.tick)) return 'done';
  return s.tick >= j.until || p.joy >= 100 ? 'done' : 'run';
}

/** A few steps further along a stroll. */
function strollOn(s: SimState, p: Pawn): number[] {
  const me = pawnTile(p);
  const f = flood(s, me, false, 90);
  for (let i = 0; i < 8; i++) {
    const x = p.x + randInt(s.rng, -5, 5);
    const y = p.y + randInt(s.rng, -5, 5);
    if (!inBounds(x, y)) continue;
    const t = tileIndex(x, y);
    if (t !== me && f.cost[t] < INF) return pathTo(f, t);
  }
  return [];
}

function runTend(s: SimState, p: Pawn, j: JobOf<'tend'>): Result {
  const o = pawnById(s, j.targetId);
  if (!o || o.life !== 'downed' || (o.bleed <= 0 && o.memories.some((m) => m.key === 'tended'))) return 'done';
  // Only the brave, or those under orders, keep working on a wound with raiders closing in.
  if (!j.ordered && !has(p, 'brave') && hostileWithin(s, pawnTile(p), 3)) return 'fail';
  const a = approach(s, p, pawnTile(o));
  if (a !== 'there') return notThere(s, p, a);
  face(p, pawnTile(o));
  const speed = workSpeed(p, 'medicine');
  j.progress += speed;
  learn(s, p, 'medicine', speed * 2);
  if (j.progress < B.tendWork) return 'run';
  o.bleed = 0;
  o.hp = Math.max(o.hp, 6);
  const herbs = techDone(s, 'medicine') ? s.items.find((i) => i.type === 'herbs') : undefined;
  if (herbs) takeFromItem(s, herbs, 1);
  addMemory(o, 'tended', herbs ? 'Treated with healroot' : 'Wounds bandaged', herbs ? 3 : 0, s.tick + TICKS_PER_DAY);
  log(s, 'good', `${firstName(p)} ${herbs ? 'treated' : 'bandaged'} ${firstName(o)}'s wounds.`);
  if (j.ordered || o.bleed === 0) {
    story(s, o, `Was saved by ${firstName(p)}.`);
    story(s, p, `Saved ${firstName(o)}’s life.`);
  }
  return 'done';
}

// Fighting

function runFight(s: SimState, p: Pawn, j: JobOf<'fight'>): Result {
  const t = pawnById(s, j.targetId);
  if (!t || t.life !== 'ok' || t.gone) return 'done';
  const brawling = p.mental?.kind === 'brawl';
  if (brawling ? t.mental?.kind !== 'brawl' : p.kind === 'colonist' && t.kind === 'colonist') return 'done';
  const me = pawnTile(p);
  if (p.kind === 'colonist' && !j.ordered && !brawling && !has(p, 'bloodlust')) {
    if (!has(p, 'brave') && p.hp < p.maxHp * 0.3) return 'done';
    const sworn = p.grudge !== 0 && p.grudge === t.chiefId;
    if (cheb(s.rally >= 0 ? s.rally : s.home, pawnTile(t)) > 18 && !sworn) return 'done';
  }
  const reach = brawling ? cheb(me, pawnTile(t)) <= 1 : inReach(s, p, t);
  if (reach) {
    p.path = [];
    face(p, pawnTile(t));
    if (p.attackCd <= 0) attack(s, p, t);
    return 'run';
  }
  if (!brawling && !j.ordered) {
    const other = enemyInReach(s, p);
    if (other) {
      j.targetId = other.id;
      p.path = [];
      face(p, pawnTile(other));
      if (p.attackCd <= 0) attack(s, p, other);
      return 'run';
    }
    // Archers on a watchtower stay up there rather than chase.
    if (p.kind === 'colonist' && onTower(s, p)) return 'done';
  }
  if (s.tick >= j.repathAt || p.path.length === 0) {
    const f = flood(s, me, p.kind === 'goblin' || p.hostile);
    const stand = freeStand(s, f, pawnTile(t), p, false);
    if (stand < 0) return 'fail';
    p.path = pathTo(f, stand);
    j.repathAt = s.tick + 10;
  }
  const w = walk(s, p);
  if (w === 'blocked') return p.kind === 'goblin' || p.hostile ? startBash(s, p) : 'fail';
  return 'run';
}

function runHunt(s: SimState, p: Pawn, j: JobOf<'hunt'>): Result {
  const t = pawnById(s, j.targetId);
  if (!t || t.life !== 'ok' || !t.marked) return 'done';
  const me = pawnTile(p);
  if (inReach(s, p, t)) {
    p.path = [];
    face(p, pawnTile(t));
    if (p.attackCd <= 0) attack(s, p, t);
    return 'run';
  }
  if (s.tick >= j.repathAt || p.path.length === 0) {
    const f = flood(s, me);
    const stand = freeStand(s, f, pawnTile(t), p, false);
    if (stand < 0) return 'fail';
    p.path = pathTo(f, stand);
    j.repathAt = s.tick + (isRanged(p) ? 6 : 10);
  }
  return walk(s, p) === 'blocked' ? 'fail' : 'run';
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
  const w = WEAPONS[p.weapon];
  p.attackCd = Math.max(10, w.cd);
  p.lastAttackTick = s.tick;
  st.hp -= randInt(s.rng, w.dmg[0], w.dmg[1]) * (w.range > 1 ? 0.4 : 1);
  if (st.hp > 0) return 'run';
  removeStructure(s, st);
  const label = st.kind === 'grave' ? 'grave' : BUILDINGS[st.kind].label.toLowerCase();
  const who = p.kind === 'goblin' ? 'Goblins' : 'Wolves';
  log(s, 'bad', st.kind === 'door' || st.kind === 'wall' || st.kind === 'stoneWall' ? `${who} smashed through a ${label}.` : `${who} wrecked a ${label}.`);
  return 'done';
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
  if (p.chiefId) chiefEscaped(s, p);
  return 'done';
}

// Orders

function runGoto(s: SimState, p: Pawn): Result {
  const w = walk(s, p);
  if (w === 'walking') return 'run';
  return w === 'blocked' ? 'fail' : 'done';
}

/** A drafted colonist holds position and fights whatever comes within reach. */
function runHold(s: SimState, p: Pawn): Result {
  if (p.incapable.includes('violence') || p.attackCd > 0) return 'run';
  const foe = enemyInReach(s, p);
  if (foe) {
    face(p, pawnTile(foe));
    attack(s, p, foe);
  }
  return 'run';
}

function runTimed(s: SimState, p: Pawn, j: JobOf<'flee' | 'rally' | 'wander'>): Result {
  if (j.kind === 'flee' && has(p, 'coward') && enemyInReach(s, p)) return 'done';
  if (j.kind === 'rally' && (hostileWithin(s, pawnTile(p), 2) || enemyInReach(s, p))) return 'done';
  const w = walk(s, p);
  if (w === 'walking') return 'run';
  if (w === 'blocked') return 'fail';
  return s.tick >= j.until ? 'done' : 'run';
}
