/**
 * Everything that happens to a settlement rather than inside it: goblin raids and wolf packs,
 * newcomers, the seasons, growing crops, wildlife, and the slow grind of needs and moods.
 */
import { mentalBreak } from './ai';
import { chiefName, kill } from './combat';
import { B, DAYS_PER_SEASON, FEATURE, MAP_N, TERRAIN, TICKS_PER_DAY } from './constants';
import { CROPS, CROP_BY_CODE } from './defs';
import { compass, isEdge } from './grid';
import { breakThreshold, computeMood } from './mood';
import { INF, enterCost, flood, isBashTarget } from './path';
import { TRAITS, makeAnimal, makeChief, makeColonist, makeGoblin } from './people';
import { chance, pick, randInt, random } from './rng';
import { seedRelations } from './social';
import { SEASON_GROWTH, SEASON_LABEL, dayOf, dayOfSeason, seasonOf, spanLabel, tickAt, yearOf } from './time';
import type { Chief, CropKind, GoblinUnit, Pawn, Raid, SimState, Species } from './types';
import { endJob, firstName, has, log, nearbyTiles, story, walkable, wealth } from './world';

export const FIRST_RAID_TICK = tickAt(2, 16);

// Needs

export function updateNeeds(s: SimState, p: Pawn): void {
  if (p.life === 'downed') {
    p.food = Math.max(0, p.food - B.foodDecay * 0.5);
    if (p.bleed > 0) {
      if (--p.bleed === 0) kill(s, p, 'bled out');
      return;
    }
    const herbs = p.memories.some((m) => m.key === 'tended' && m.mood > 0);
    if (s.tick % (herbs ? B.downedRecoverEveryHerbs : B.downedRecoverEvery) === 0 && ++p.hp >= B.standUpHp) {
      p.life = 'ok';
      p.thinkAt = s.tick;
      log(s, 'good', `${firstName(p)} got back up.`);
    }
    return;
  }
  const j = p.job;
  const sleep = j?.kind === 'sleep' && j.asleep ? j : null;
  const before = p.food;
  p.food = Math.max(0, p.food - B.foodDecay * (has(p, 'glutton') ? B.gluttonFoodMul : 1));
  if (before > 0 && p.food <= 0) log(s, 'bad', `${firstName(p)} is starving!`);
  if (sleep) {
    p.rest = Math.min(100, p.rest + (sleep.bedId ? B.restGainBed : B.restGainGround));
  } else {
    p.rest = Math.max(0, p.rest - B.restDecay);
    p.joy = Math.max(0, p.joy - B.joyDecay);
  }
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

/** Every half hour, colonists past their breaking point may snap. */
export function mentalBreaks(s: SimState): void {
  for (const p of s.pawns) {
    if (p.kind !== 'colonist' || p.life !== 'ok' || p.mental || p.drafted) continue;
    const k = p.job?.kind;
    if (k === 'fight' || k === 'flee' || k === 'tend') continue;
    const limit = breakThreshold(p);
    if (p.mood >= limit || !chance(s.rng, p.mood < limit - 15 ? 0.2 : 0.05)) continue;
    mentalBreak(s, p);
  }
}

// Threats

/** A random map-edge tile that can reach the settlement, or -1. */
export function pickEdge(s: SimState): number {
  const f = flood(s, s.home, true);
  const edges: number[] = [];
  for (let t = 0; t < MAP_N; t++) if (isEdge(t) && f.cost[t] < INF) edges.push(t);
  return edges.length > 0 ? edges[randInt(s.rng, 0, edges.length - 1)] : -1;
}

/** How big the next raid is. Raids grow with time, with the settlement and with its wealth. */
export function raidPoints(s: SimState): number {
  // The first war band is a scouting party.
  if (s.raidCount === 0) return 2.3;
  const colonists = s.pawns.filter((p) => p.kind === 'colonist').length;
  return Math.min(40, 1 + dayOf(s.tick) * 0.45 + colonists * 0.35 + wealth(s) / 2000);
}

function composeRaid(s: SimState, points: number): GoblinUnit[] {
  const day = dayOf(s.tick);
  const units: GoblinUnit[] = [];
  // Budgeted in whole tenths, so rounding never loses a goblin.
  let left = Math.round(points * 10);
  while (left >= 10 && units.length < B.raidMaxSize) {
    const r = random(s.rng);
    if (day >= 5 && left >= 30 && r < 0.15) {
      units.push('brute');
      left -= 30;
    } else if (day >= 2 && left >= 13 && r < 0.45) {
      units.push('archer');
      left -= 13;
    } else {
      units.push('fighter');
      left -= 10;
    }
  }
  if (units.length === 0) units.push('fighter');
  return units;
}

const count = (n: number, one: string, many: string): string => (n === 1 ? `${/^[aeiou]/.test(one) ? 'an' : 'a'} ${one}` : `${n} ${many}`);

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "3 raiders, 2 archers and a brute". */
export function describeUnits(units: readonly GoblinUnit[]): string {
  const n = (u: GoblinUnit): number => units.filter((x) => x === u).length;
  const parts: string[] = [];
  if (n('fighter')) parts.push(count(n('fighter'), 'raider', 'raiders'));
  if (n('archer')) parts.push(count(n('archer'), 'archer', 'archers'));
  if (n('brute')) parts.push(count(n('brute'), 'brute', 'brutes'));
  return joinAnd(parts);
}

function newRaid(s: SimState, kind: Raid['kind'], edge: number, units: GoblinUnit[], size: number, arriveTick: number, chief?: Chief): Raid {
  return {
    id: s.nextId++,
    kind,
    units,
    phase: 'incoming',
    warnTick: s.tick,
    arriveTick,
    size,
    edge,
    retreat: false,
    slain: 0,
    stolen: 0,
    escapedLoot: 0,
    chiefId: chief?.id ?? 0,
  };
}

export function updateThreats(s: SimState): void {
  const r = s.raid;
  if (!r) {
    if (s.tick >= s.nextThreatTick - B.raidWarning) startThreat(s);
    return;
  }
  if (r.phase === 'incoming') {
    if (s.tick < r.arriveTick) return;
    spawnRaiders(s, r);
    r.phase = 'active';
    const from = compass(s.home, r.edge);
    if (r.kind === 'wolves') log(s, 'raid', `The wolves are here! ${r.size} of them are coming from the ${from}.`);
    else log(s, 'raid', `The goblins are here! ${r.size} raiders are attacking from the ${from}.`);
    return;
  }

  const alive = s.pawns.filter((p) => p.raidId === r.id && p.life === 'ok' && !p.gone);
  if (!r.retreat) {
    const chief = r.chiefId ? s.chiefs.find((c) => c.id === r.chiefId) : undefined;
    const chiefGone = !!chief && !alive.some((p) => p.chiefId === chief.id);
    const broken = r.slain >= Math.ceil(r.size / 2);
    if (chiefGone || broken || s.tick - r.arriveTick > B.raidMaxDuration) {
      r.retreat = true;
      if (alive.length > 0) {
        if (chiefGone) log(s, 'raid', chief!.alive ? 'Their chief has fled, and the goblins run after them!' : 'With their chief dead, the goblins are fleeing!');
        else log(s, 'raid', r.kind === 'wolves' ? 'The wolves are running!' : 'The goblins are retreating!');
      }
      for (const g of alive) endJob(s, g);
    }
  }
  if (alive.length > 0) return;

  const noun = r.kind === 'wolves' ? (r.slain === 1 ? 'wolf' : 'wolves') : r.slain === 1 ? 'goblin' : 'goblins';
  const parts = [`${r.slain} ${noun} slain`];
  if (r.escapedLoot > 0) parts.push(`${r.escapedLoot} supplies stolen`);
  const lost = s.fallen.filter((f) => f.tick >= r.arriveTick).length;
  if (lost > 0) parts.push(lost === 1 ? '1 settler lost' : `${lost} settlers lost`);
  log(s, 'raid', `The ${r.kind === 'wolves' ? 'wolf attack' : 'raid'} is over: ${parts.join(', ')}.`, true);
  s.raid = null;
  s.raidCount++;
  s.nextThreatTick = s.tick + randInt(s.rng, B.threatInterval[0], B.threatInterval[1]);
}

function startThreat(s: SimState): void {
  const edge = pickEdge(s);
  if (edge < 0) {
    s.nextThreatTick += TICKS_PER_DAY;
    return;
  }
  const winter = seasonOf(s.tick) === 'winter';
  if (s.raidCount > 0 && dayOf(s.tick) >= 4 && chance(s.rng, winter ? 0.45 : 0.22)) startWolves(s, edge);
  else startGoblins(s, edge);
}

function startGoblins(s: SimState, edge: number): void {
  const points = raidPoints(s);
  let chief: Chief | undefined;
  const living = s.chiefs.filter((c) => c.alive);
  if (living.length > 0 && chance(s.rng, 0.6)) {
    chief = pick(s.rng, living);
  } else if (points >= 7 && chance(s.rng, 0.5)) {
    chief = makeChief(s);
    s.chiefs.push(chief);
  }
  const units = composeRaid(s, points - (chief ? 4 : 0));
  if (chief) units.unshift('chief');
  s.raid = newRaid(s, 'goblins', edge, units, units.length, s.nextThreatTick, chief);
  const dir = compass(s.home, edge);
  const when = spanLabel(s.nextThreatTick - s.tick);
  const band = describeUnits(units);
  if (!chief) {
    log(s, 'raid', `Scouts spotted a goblin war band to the ${dir}: ${band}. They will arrive in about ${when}.`, true);
    return;
  }
  const name = chiefName(chief);
  if (chief.escapes > 0) {
    log(s, 'raid', `${name} is back, with the ${chief.warband} behind them: ${band}. They come from the ${dir} in about ${when}.`, true);
  } else {
    log(s, 'raid', `Scouts spotted the ${chief.warband}, a goblin war band led by ${name}, to the ${dir}: ${band}. They will arrive in about ${when}.`, true);
  }
  const avengers = s.pawns.filter((p) => p.kind === 'colonist' && p.grudge === chief.id).map(firstName);
  if (avengers.length > 0) log(s, 'raid', `${joinAnd(avengers)} ${avengers.length === 1 ? 'has' : 'have'} sworn to kill ${chief.name}.`);
}

function startWolves(s: SimState, edge: number): void {
  const size = Math.min(8, 2 + Math.floor(dayOf(s.tick) / 5) + randInt(s.rng, 0, 1));
  s.raid = newRaid(s, 'wolves', edge, [], size, s.tick + B.wolfWarning);
  log(s, 'raid', `Howling to the ${compass(s.home, edge)}: a pack of ${size} hungry wolves is hunting. They will be here in about ${spanLabel(B.wolfWarning)}.`, true);
}

function spawnRaiders(s: SimState, r: Raid): void {
  const spots = [r.edge, ...nearbyTiles(r.edge, 3)].filter((t) => enterCost(s, t, true) >= 0 && !isBashTarget(s, t));
  const at = (i: number): number => (spots.length > 0 ? spots[i % spots.length] : r.edge);
  if (r.kind === 'wolves') {
    for (let i = 0; i < r.size; i++) {
      const w = makeAnimal(s, at(i), 'wolf');
      w.hostile = true;
      w.raidId = r.id;
      w.food = 0;
      s.pawns.push(w);
    }
    return;
  }
  const chief = r.chiefId ? s.chiefs.find((c) => c.id === r.chiefId) : undefined;
  r.units.forEach((u, i) => s.pawns.push(makeGoblin(s, at(i), r.id, u, u === 'chief' ? chief : undefined)));
}

// Newcomers

function introduce(p: Pawn): string {
  const traits = p.traits.map((t) => TRAITS[t].label.toLowerCase());
  const who = `${p.name}, ${p.age}, a ${p.age < 20 ? 'young' : 'former'} ${p.calling.toLowerCase()}`;
  return traits.length > 0 ? `${who} (${joinAnd(traits)})` : who;
}

const colonistCount = (s: SimState): number => s.pawns.filter((p) => p.kind === 'colonist').length;

export function updateArrivals(s: SimState): void {
  if (s.tick >= s.nextWandererTick) wandererArrives(s);
  if (s.tick >= s.nextMigrationTick) migrationArrives(s);
}

function wandererArrives(s: SimState): void {
  s.nextWandererTick = s.tick + randInt(s.rng, B.wandererInterval[0], B.wandererInterval[1]);
  if (colonistCount(s) >= B.maxColonists || s.raid) return;
  const edge = pickEdge(s);
  if (edge < 0) return;
  const p = makeColonist(s, edge);
  s.pawns.push(p);
  p.mood = computeMood(s, p);
  story(s, p, `Wandered into the settlement on day ${dayOf(s.tick)}.`);
  log(s, 'good', `A wanderer joined the settlement: ${introduce(p)}.`, true);
}

const ORIGINS: readonly string[] = [
  'refugees from a burned village',
  'deserters from a war in the south',
  'pilgrims who lost their way',
  'outcasts from a mountain hold',
  'survivors of a shipwreck',
  'farmers driven off their land',
];

function migrationArrives(s: SimState): void {
  s.nextMigrationTick = s.tick + randInt(s.rng, B.migrationInterval[0], B.migrationInterval[1]);
  const room = B.maxColonists - colonistCount(s);
  if (room < 2 || s.raid) return;
  const edge = pickEdge(s);
  if (edge < 0) return;
  const spots = [edge, ...nearbyTiles(edge, 2).filter((t) => walkable(s, t))];
  const n = Math.min(room, randInt(s.rng, 2, 3));
  const family = chance(s.rng, 0.35);
  const group: Pawn[] = [];
  for (let i = 0; i < n; i++) {
    const lastName = family && group.length > 0 ? group[0].name.split(' ')[1] : undefined;
    const p = makeColonist(s, spots[i % spots.length], lastName ? { lastName } : {});
    s.pawns.push(p);
    group.push(p);
  }
  seedRelations(s, group);
  const origin = pick(s.rng, ORIGINS);
  for (const p of group) {
    p.mood = computeMood(s, p);
    const others = joinAnd(group.filter((o) => o !== p).map(firstName));
    story(s, p, `Came to the settlement on day ${dayOf(s.tick)} with ${others}, ${origin}.`);
  }
  log(s, 'good', `${n === 2 ? 'Two' : 'Three'} ${origin} joined the settlement: ${group.map(introduce).join('; ')}.`, true);
}

// Nature

export function updateNature(s: SimState): void {
  if (dayOf(s.tick) !== dayOf(s.tick - 1)) newDay(s);
  if (s.tick % 50 === 0) grow(s);
  if (s.tick % 600 === 0) wildlife(s);
}

function newDay(s: SimState): void {
  const day = dayOf(s.tick);
  const season = seasonOf(s.tick);
  const dos = dayOfSeason(s.tick);
  if (dos === 1) {
    if (season === 'winter') {
      // The berries are gone until spring.
      const spring = tickAt(day + DAYS_PER_SEASON, 6);
      for (let t = 0; t < MAP_N; t++) if (s.feature[t] === FEATURE.BUSH) s.regrow[t] = Math.max(s.regrow[t], spring);
      s.structVersion++;
      log(s, 'warn', 'Winter has come. Nothing will grow until spring, and the berry bushes are bare.', true);
    } else if (season === 'spring') {
      log(s, 'good', `Spring has come, and with it year ${yearOf(s.tick)}. The fields can be sown again.`, true);
    } else if (season === 'summer') {
      log(s, 'info', 'Summer has come. Crops grow faster in the long days.', true);
    } else {
      log(s, 'info', `${SEASON_LABEL[season]} has come. Winter is ${DAYS_PER_SEASON} days away.`, true);
    }
  } else if (season === 'autumn' && dos === DAYS_PER_SEASON) {
    log(s, 'warn', 'Winter comes tomorrow. Nothing will grow for five days, so stock up on food.', true);
  }
}

/** Crops grow a little every few seconds; sand is poorer soil. */
function grow(s: SimState): void {
  const rate = SEASON_GROWTH[seasonOf(s.tick)];
  if (rate <= 0) return;
  let changed = false;
  for (let t = 0; t < MAP_N; t++) {
    const code = s.plant[t];
    if (!code || s.growth[t] >= 1000) continue;
    const crop = CROPS[CROP_BY_CODE[code] as CropKind];
    const soil = s.terrain[t] === TERRAIN.SAND ? 0.7 : 1;
    const before = s.growth[t];
    const after = Math.min(1000, before + (1000 * 50 * rate * soil) / (crop.growDays * TICKS_PER_DAY));
    s.growth[t] = after;
    if (Math.floor(before / 250) !== Math.floor(after / 250)) changed = true;
  }
  // Redraw the fields when a crop reaches its next stage.
  if (changed) s.structVersion++;
}

/** Keeps a few animals roaming: deer and hares most of the year, boars, and wolves in winter. */
function wildlife(s: SimState): void {
  const season = seasonOf(s.tick);
  const wild = s.pawns.filter((p) => p.kind === 'animal' && !p.hostile).length;
  const target = Math.min(B.maxAnimals, season === 'winter' ? 6 : 12);
  if (wild >= target || !chance(s.rng, 0.35)) return;
  const edge = pickEdge(s);
  if (edge < 0) return;
  const r = random(s.rng);
  let species: Species;
  let n: number;
  if (r < (season === 'winter' ? 0.3 : 0.06)) {
    species = 'wolf';
    n = 2;
  } else if (r < 0.45) {
    species = 'deer';
    n = randInt(s.rng, 2, 4);
  } else if (r < 0.8) {
    species = 'hare';
    n = randInt(s.rng, 1, 3);
  } else {
    species = 'boar';
    n = randInt(s.rng, 1, 2);
  }
  const spots = [edge, ...nearbyTiles(edge, 2).filter((t) => walkable(s, t))];
  for (let i = 0; i < n; i++) s.pawns.push(makeAnimal(s, spots[i % spots.length], species));
}
