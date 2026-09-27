/**
 * Goblins and wolf packs. Goblins hunt standing colonists, steal from the stockpile and smash
 * what is in their way; archers shoot from range, brutes never run, and the wounded flee.
 * Wolves only hunt. Everyone runs for the edge of the map once the raid breaks.
 */
import { isRanged } from '../combat';
import { MAP_N } from '../constants';
import { isEdge } from '../grid';
import { INF, bestStand, flood, pathTo, type Flood } from '../path';
import type { GoblinUnit, Pawn, SimState } from '../types';
import { endJob, inStockpile, log, pawnTile } from '../world';
import { assign, enemyInReach, freeStand, nearestColonist, planFight, reservedItem, type Plan } from './common';
import { perform } from './jobs';

/** Below this share of their health, raiders give up and run. Brutes never do. */
const FLEE_AT: Record<GoblinUnit | '', number> = { fighter: 0.3, archer: 0.3, brute: 0, chief: 0.25, '': 0.3 };

export function tickRaider(s: SimState, p: Pawn): void {
  const fleeAt = FLEE_AT[p.unit];
  if (p.job && p.job.kind !== 'leave' && p.job.kind !== 'bash' && p.hp < p.maxHp * fleeAt) {
    endJob(s, p);
    log(s, 'good', `${p.kind === 'animal' ? 'A wolf' : p.name} flees, badly wounded.`);
  }
  if (p.job && p.job.kind !== 'fight' && p.job.kind !== 'leave' && (s.tick + p.id) % 8 === 0 && s.raid && !s.raid.retreat) {
    const plan = engage(s, p);
    if (plan) {
      endJob(s, p);
      assign(p, plan);
    }
  }
  if (!p.job && s.tick >= p.thinkAt) assign(p, planRaider(s, p));
  perform(s, p);
}

/** Archers shoot anyone in range; the rest turn on colonists who come close. */
function engage(s: SimState, p: Pawn): Plan | null {
  if (isRanged(p)) {
    const foe = enemyInReach(s, p);
    return foe ? { job: { kind: 'fight', targetId: foe.id, repathAt: s.tick + 10, ordered: false }, path: [] } : null;
  }
  const c = nearestColonist(s, pawnTile(p), p.looter && !p.carry ? 1 : 3);
  return c ? planFight(s, p, c) : null;
}

function planRaider(s: SimState, p: Pawn): Plan | null {
  const f = flood(s, pawnTile(p), true);
  if (!s.raid || s.raid.retreat || p.carry || p.hp < p.maxHp * FLEE_AT[p.unit]) return planLeave(f);
  if (p.kind === 'animal') return planHunt(s, p, f) ?? planLeave(f);
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
  return targetId ? { job: { kind: 'fight', targetId, repathAt: s.tick + 10, ordered: false }, path: pathTo(f, stand) } : null;
}

/** Stockpiles first, the valuable things most of all; anything lying around will do. */
function planLoot(s: SimState, p: Pawn, f: Flood): Plan | null {
  let stand = -1;
  let bestCost = INF;
  let itemId = 0;
  for (const it of s.items) {
    if (reservedItem(s, it.id, p)) continue;
    const st = bestStand(f, it.tile, true);
    if (st < 0) continue;
    const cost = f.cost[st] + (inStockpile(s, it.tile) ? 0 : 40);
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
