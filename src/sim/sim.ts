/**
 * The simulation step. step() is the only way time moves: the client runs it for its own
 * settlement now, and the server will run the very same function for every region later.
 */
import { endJob, tickPawn } from './ai';
import { B, MAP_N, TICKS_PER_HOUR } from './constants';
import { compass, isEdge, tileIndex, tileX, tileY } from './grid';
import { generateMap } from './mapgen';
import { computeMood } from './mood';
import { INF, enterCost, flood, isBashTarget } from './path';
import { TRAITS, makeColonist, makeGoblin } from './people';
import { chance, randInt, seedRng } from './rng';
import { spanLabel, tickAt } from './time';
import type { Pawn, Raid, SimState } from './types';
import { firstName, has, isLand, kill, log, nearbyTiles, placeItemNear } from './world';

export const FIRST_RAID_TICK = tickAt(2, 16);

export function createSim(seed: number): SimState {
  const map = generateMap(seed);
  const zeros = (): number[] => new Array<number>(MAP_N).fill(0);
  const s: SimState = {
    version: 1,
    seed,
    rng: seedRng(seed),
    tick: 0,
    nextId: 1,
    nextLogId: 1,
    terrain: map.terrain,
    feature: map.feature,
    regrow: zeros(),
    designated: zeros(),
    decon: zeros(),
    zone: zeros(),
    structGrid: zeros(),
    structKind: zeros(),
    bpGrid: zeros(),
    itemGrid: zeros(),
    pawns: [],
    items: [],
    structures: [],
    blueprints: [],
    raid: null,
    raidCount: 0,
    nextRaidTick: FIRST_RAID_TICK,
    nextWandererTick: tickAt(3, 14),
    rally: -1,
    home: map.home,
    log: [],
    fallen: [],
    over: false,
    structVersion: 1,
    itemVersion: 1,
  };

  const hx = tileX(map.home);
  const hy = tileY(map.home);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = 2; dx <= 4; dx++) {
      const t = tileIndex(hx + dx, hy + dy);
      if (isLand(s, t)) s.zone[t] = 1;
    }
  }
  placeItemNear(s, tileIndex(hx + 3, hy - 1), 'wood', 40);
  placeItemNear(s, tileIndex(hx + 3, hy), 'berries', 30);
  placeItemNear(s, tileIndex(hx + 3, hy + 1), 'meal', 6);

  for (let i = 0; i < 3; i++) s.pawns.push(makeColonist(s, tileIndex(hx - 1 + i, hy - 1)));
  for (const p of s.pawns) p.mood = computeMood(s, p);
  const names = s.pawns.map(firstName);
  log(s, 'info', `${names[0]}, ${names[1]} and ${names[2]} reached the Wildlands to found a settlement.`, true);
  return s;
}

export function step(s: SimState): void {
  if (s.over) return;
  s.tick++;
  updateRaid(s);
  if (s.tick >= s.nextWandererTick) wandererArrives(s);
  if (s.tick % 100 === 0) mentalBreaks(s);
  for (const p of s.pawns) if (p.kind === 'colonist' && p.life !== 'dead') updateNeeds(s, p);
  for (const p of s.pawns) if (p.life === 'ok' && !p.gone) tickPawn(s, p);
  if (s.pawns.some((p) => p.life === 'dead' || p.gone)) s.pawns = s.pawns.filter((p) => p.life !== 'dead' && !p.gone);
  if (!s.pawns.some((p) => p.kind === 'colonist')) {
    s.over = true;
    log(s, 'death', 'The settlement has fallen. No one is left.', true);
  }
}

function updateNeeds(s: SimState, p: Pawn): void {
  if (p.life === 'downed') {
    p.food = Math.max(0, p.food - B.foodDecay * 0.5);
    if (p.bleed > 0) {
      if (--p.bleed === 0) kill(s, p, 'bled out');
    } else if (s.tick % B.downedRecoverEvery === 0 && ++p.hp >= B.standUpHp) {
      p.life = 'ok';
      log(s, 'good', `${firstName(p)} got back up.`);
    }
    return;
  }
  const j = p.job;
  const sleep = j && j.kind === 'sleep' && j.asleep ? j : null;
  const before = p.food;
  p.food = Math.max(0, p.food - B.foodDecay * (has(p, 'glutton') ? B.gluttonFoodMul : 1));
  if (before > 0 && p.food <= 0) log(s, 'bad', `${firstName(p)} is starving!`);
  if (sleep) p.rest = Math.min(100, p.rest + (sleep.bedId ? B.restGainBed : B.restGainGround));
  else p.rest = Math.max(0, p.rest - B.restDecay);
  if (p.food <= 0) {
    if (s.tick % B.starveDamageEvery === 0 && --p.hp <= 0) {
      kill(s, p, 'starved to death');
      return;
    }
  } else if (p.hp < p.maxHp && s.tick % (sleep?.bedId ? B.regenEveryBed : B.regenEvery) === 0) {
    p.hp++;
  }
  if ((s.tick + p.id) % 10 === 0) p.mood = computeMood(s, p);
}

function mentalBreaks(s: SimState): void {
  for (const p of s.pawns) {
    if (p.kind !== 'colonist' || p.life !== 'ok' || p.mental || p.mood >= 20 || p.job?.kind === 'fight') continue;
    if (!chance(s.rng, p.mood < 10 ? 0.5 : 0.25)) continue;
    p.mental = { until: s.tick + randInt(s.rng, TICKS_PER_HOUR * 2, TICKS_PER_HOUR * 4) };
    endJob(s, p);
    log(s, 'warn', `${firstName(p)} broke down and is wandering in a daze.`);
  }
}

// Raids

function raidSize(s: SimState): number {
  const colonists = s.pawns.filter((p) => p.kind === 'colonist').length;
  return Math.min(B.raidMaxSize, 2 + s.raidCount + Math.floor(colonists / 3));
}

/** A random map-edge tile that can reach the settlement. */
function pickEdge(s: SimState): number {
  const f = flood(s, s.home, true);
  const edges: number[] = [];
  for (let t = 0; t < MAP_N; t++) if (isEdge(t) && f.cost[t] < INF) edges.push(t);
  return edges.length > 0 ? edges[randInt(s.rng, 0, edges.length - 1)] : -1;
}

function updateRaid(s: SimState): void {
  const r = s.raid;
  if (!r) {
    if (s.tick < s.nextRaidTick - B.raidWarning) return;
    const edge = pickEdge(s);
    if (edge < 0) {
      s.nextRaidTick += TICKS_PER_HOUR * 24;
      return;
    }
    const size = raidSize(s);
    s.raid = {
      id: s.nextId++,
      phase: 'incoming',
      warnTick: s.tick,
      arriveTick: s.nextRaidTick,
      size,
      edge,
      retreat: false,
      slain: 0,
      stolen: 0,
      escapedLoot: 0,
    };
    log(
      s,
      'raid',
      `Scouts spotted a goblin war band of ${size} to the ${compass(s.home, edge)}. They will arrive in about ${spanLabel(s.nextRaidTick - s.tick)}.`,
      true,
    );
    return;
  }

  if (r.phase === 'incoming') {
    if (s.tick < r.arriveTick) return;
    spawnRaiders(s, r);
    r.phase = 'active';
    log(s, 'raid', `The goblins are here! ${r.size} raiders are attacking from the ${compass(s.home, r.edge)}.`);
    return;
  }

  const alive = s.pawns.filter((p) => p.kind === 'goblin' && p.raidId === r.id && p.life === 'ok' && !p.gone);
  if (!r.retreat && (r.slain >= Math.ceil(r.size / 2) || s.tick - r.arriveTick > B.raidMaxDuration)) {
    r.retreat = true;
    if (alive.length > 0) log(s, 'raid', 'The goblins are retreating!');
    for (const g of alive) endJob(s, g);
  }
  if (alive.length > 0) return;

  const parts = [r.slain === 1 ? '1 goblin slain' : `${r.slain} goblins slain`];
  if (r.escapedLoot > 0) parts.push(`${r.escapedLoot} supplies stolen`);
  const lost = s.fallen.filter((f) => f.tick >= r.arriveTick).length;
  if (lost > 0) parts.push(lost === 1 ? '1 settler lost' : `${lost} settlers lost`);
  log(s, 'raid', `The raid is over: ${parts.join(', ')}.`, true);
  s.raid = null;
  s.raidCount++;
  s.nextRaidTick = s.tick + randInt(s.rng, B.raidInterval[0], B.raidInterval[1]);
}

function spawnRaiders(s: SimState, r: Raid): void {
  const spots = [r.edge, ...nearbyTiles(r.edge, 3)].filter((t) => enterCost(s, t, true) >= 0 && !isBashTarget(s, t));
  for (let i = 0; i < r.size; i++) s.pawns.push(makeGoblin(s, spots.length > 0 ? spots[i % spots.length] : r.edge, r.id));
}

function wandererArrives(s: SimState): void {
  s.nextWandererTick = s.tick + randInt(s.rng, B.wandererInterval[0], B.wandererInterval[1]);
  const count = s.pawns.filter((p) => p.kind === 'colonist').length;
  if (count >= B.maxColonists || s.raid) return;
  const edge = pickEdge(s);
  if (edge < 0) return;
  const p = makeColonist(s, edge);
  p.mood = computeMood(s, p);
  s.pawns.push(p);
  const traits = p.traits.map((t) => TRAITS[t].label.toLowerCase()).join(' and ');
  log(s, 'good', `A wanderer, ${p.name}, joined the settlement: ${p.backstory.toLowerCase()}, ${traits}.`, true);
}

// Saving

export const serialize = (s: SimState): string => JSON.stringify(s);

export function deserialize(json: string): SimState | null {
  try {
    const s = JSON.parse(json) as SimState;
    if (!s || s.version !== 1 || !Array.isArray(s.terrain) || s.terrain.length !== MAP_N) return null;
    return s;
  } catch {
    return null;
  }
}

/** FNV-1a of the full state. Two runs that agree on this are identical. */
export function hashState(s: SimState): string {
  const json = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
