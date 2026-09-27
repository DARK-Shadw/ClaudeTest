/**
 * The simulation step. step() is the only way time moves: the client runs it for its own
 * settlement now, and the server will run the very same function for every region later.
 */
import { tickPawn, weaponScore } from './ai';
import { MAP_N, ZONE } from './constants';
import { TECH_ORDER } from './defs';
import { mentalBreaks, updateArrivals, updateNature, updateNeeds, updateThreats, FIRST_RAID_TICK } from './events';
import { cheb, tileIndex, tileX, tileY } from './grid';
import { generateMap } from './mapgen';
import { computeMood } from './mood';
import { makeAnimal, makeColonist } from './people';
import { chance, randInt, seedRng } from './rng';
import { seedRelations, socialTick } from './social';
import { tickAt } from './time';
import type { Pawn, SimState, Species, TechId } from './types';
import { firstName, isLand, log, nearbyTiles, placeItemNear, story, walkable } from './world';

export { FIRST_RAID_TICK };

export function createSim(seed: number): SimState {
  const map = generateMap(seed);
  const zeros = (): number[] => new Array<number>(MAP_N).fill(0);
  const s: SimState = {
    version: 2,
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
    floor: zeros(),
    plant: zeros(),
    growth: zeros(),
    structGrid: zeros(),
    structKind: zeros(),
    bpGrid: zeros(),
    floorBpGrid: zeros(),
    itemGrid: zeros(),
    pawns: [],
    items: [],
    structures: [],
    blueprints: [],
    raid: null,
    raidCount: 0,
    nextThreatTick: FIRST_RAID_TICK,
    nextWandererTick: tickAt(3, 14),
    nextMigrationTick: tickAt(5, 11),
    chiefs: [],
    research: {
      current: '',
      progress: Object.fromEntries(TECH_ORDER.map((t) => [t, 0])) as Record<TechId, number>,
      done: [],
    },
    orders: { club: 0, spear: 1, bow: 1, sword: 0, leatherArmor: 1, ironArmor: 0 },
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
    for (let dx = 2; dx <= 5; dx++) {
      const t = tileIndex(hx + dx, hy + dy);
      if (isLand(s, t)) s.zone[t] = ZONE.STOCKPILE;
    }
  }
  placeItemNear(s, tileIndex(hx + 3, hy - 1), 'wood', 60);
  placeItemNear(s, tileIndex(hx + 4, hy - 1), 'stone', 20);
  placeItemNear(s, tileIndex(hx + 3, hy), 'berries', 30);
  placeItemNear(s, tileIndex(hx + 3, hy + 1), 'meal', 8);

  const family = chance(s.rng, 0.25);
  const founders: Pawn[] = [];
  for (let i = 0; i < 3; i++) {
    const lastName = family && i > 0 ? founders[0].name.split(' ')[1] : undefined;
    const p = makeColonist(s, tileIndex(hx - 1 + i, hy - 1), lastName ? { lastName } : {});
    s.pawns.push(p);
    founders.push(p);
  }
  seedRelations(s, founders);
  armFounders(founders);
  for (const p of founders) {
    const others = founders.filter((o) => o !== p).map(firstName);
    story(s, p, `Set out for the Wildlands with ${others.join(' and ')} to found a settlement.`);
    p.mood = computeMood(s, p);
  }
  spawnWildlife(s);

  const names = founders.map(firstName);
  log(s, 'info', `${names[0]}, ${names[1]} and ${names[2]} reached the Wildlands to found a settlement.`, true);
  return s;
}

/** The best shot gets the bow; the others share a club and a spear. */
function armFounders(founders: Pawn[]): void {
  const fighters = founders.filter((p) => !p.incapable.includes('violence'));
  if (fighters.length === 0) return;
  const archer = fighters.reduce((a, b) => (weaponScore(b, 'bow') - weaponScore(b, 'spear') > weaponScore(a, 'bow') - weaponScore(a, 'spear') ? b : a));
  archer.weapon = 'bow';
  const rest = fighters.filter((p) => p !== archer).sort((a, b) => b.skills.melee - a.skills.melee);
  if (rest[0]) rest[0].weapon = 'spear';
  if (rest[1]) rest[1].weapon = 'club';
}

/** A few herds and loners, well away from the camp. */
function spawnWildlife(s: SimState): void {
  const groups: ReadonlyArray<readonly [Species, number]> = [
    ['deer', 4],
    ['hare', 2],
    ['hare', 2],
    ['boar', 1],
    ['boar', 1],
  ];
  for (const [species, n] of groups) {
    for (let tries = 0; tries < 40; tries++) {
      const t = randInt(s.rng, 0, MAP_N - 1);
      if (!walkable(s, t) || cheb(t, s.home) < 14) continue;
      // A herd grazes side by side, not in a heap.
      const spots = [t, ...nearbyTiles(t, 2).filter((n) => walkable(s, n))];
      for (let i = 0; i < n; i++) s.pawns.push(makeAnimal(s, spots[i % spots.length], species));
      break;
    }
  }
}

export function step(s: SimState): void {
  if (s.over) return;
  s.tick++;
  updateThreats(s);
  updateArrivals(s);
  updateNature(s);
  if (s.tick % 100 === 0) mentalBreaks(s);
  for (const p of s.pawns) if (p.kind === 'colonist' && p.life !== 'dead') updateNeeds(s, p);
  socialTick(s);
  for (const p of s.pawns) if (p.life === 'ok' && !p.gone) tickPawn(s, p);
  if (s.pawns.some((p) => p.life === 'dead' || p.gone)) s.pawns = s.pawns.filter((p) => p.life !== 'dead' && !p.gone);
  if (!s.pawns.some((p) => p.kind === 'colonist')) {
    s.over = true;
    log(s, 'death', 'The settlement has fallen. No one is left.', true);
  }
}

// Saving

export const serialize = (s: SimState): string => JSON.stringify(s);

export function deserialize(json: string): SimState | null {
  try {
    const s = JSON.parse(json) as SimState;
    if (!s || s.version !== 2 || !Array.isArray(s.terrain) || s.terrain.length !== MAP_N) return null;
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
