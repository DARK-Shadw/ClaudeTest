import { describe, expect, it } from 'vitest';
import {
  B,
  FEATURE,
  MAP_N,
  STRUCT_CODE,
  TERRAIN,
  TICKS_PER_DAY,
  ZONE,
  applyCommand,
  cheb,
  countItems,
  createSim,
  deserialize,
  flood,
  hashState,
  hostiles,
  INF,
  isEdge,
  isIndoors,
  opinion,
  pawnById,
  planCommand,
  serialize,
  step,
  tickAt,
  tileIndex,
  tileX,
  tileY,
  type Pawn,
  type SimState,
} from '../src/sim';
import { chiefEscaped, kill } from '../src/sim/combat';
import { makeChief, makeGoblin } from '../src/sim/people';
import { random, seedRng } from '../src/sim/rng';
import { startBrawl } from '../src/sim/social';
import { addStructure } from '../src/sim/world';

function run(s: SimState, ticks: number): void {
  for (let i = 0; i < ticks && !s.over; i++) step(s);
}

const colonists = (s: SimState): Pawn[] => s.pawns.filter((p) => p.kind === 'colonist');

/** A typical opening: clear the woods nearby, build a room with beds, a campfire and a rally point. */
function opening(s: SimState): void {
  const hx = tileX(s.home);
  const hy = tileY(s.home);
  applyCommand(s, { t: 'harvest', x0: hx - 8, y0: hy - 8, x1: hx + 8, y1: hy + 8 });
  applyCommand(s, { t: 'room', wall: 'wall', x0: hx - 4, y0: hy + 1, x1: hx, y1: hy + 5 });
  for (let i = 0; i < 3; i++) applyCommand(s, { t: 'build', kind: 'bed', x0: hx - 3 + i, y0: hy + 2, x1: hx - 3 + i, y1: hy + 2 });
  applyCommand(s, { t: 'build', kind: 'campfire', x0: hx + 1, y0: hy - 3, x1: hx + 1, y1: hy - 3 });
  applyCommand(s, { t: 'rally', tile: s.home });
}

/** Open ground near home, clear of the stockpile, for placing things in tests. */
function openTile(s: SimState, dx: number, dy: number): number {
  const t = tileIndex(tileX(s.home) + dx, tileY(s.home) + dy);
  s.feature[t] = FEATURE.NONE;
  s.terrain[t] = TERRAIN.GRASS;
  s.zone[t] = 0;
  s.structVersion++;
  return t;
}

describe('rng', () => {
  it('is deterministic and roughly uniform', () => {
    const a = seedRng(42);
    const b = seedRng(42);
    let sum = 0;
    let below = 0;
    for (let i = 0; i < 100_000; i++) {
      const x = random(a);
      expect(random(b)).toBe(x);
      sum += x;
      if (x < 0.7) below++;
    }
    expect(sum / 100_000).toBeGreaterThan(0.49);
    expect(sum / 100_000).toBeLessThan(0.51);
    expect(below / 100_000).toBeGreaterThan(0.69);
    expect(below / 100_000).toBeLessThan(0.71);
  });
});

describe('founding', () => {
  it('gives every seed a clear, reachable home with iron ore nearby', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const s = createSim(seed * 101);
      for (let t = 0; t < MAP_N; t++) {
        if (cheb(t, s.home) > 3) continue;
        expect([TERRAIN.GRASS, TERRAIN.SAND]).toContain(s.terrain[t]);
        expect(s.feature[t]).toBe(FEATURE.NONE);
      }
      const f = flood(s, s.home);
      let edgeReachable = false;
      for (let t = 0; t < MAP_N && !edgeReachable; t++) edgeReachable = isEdge(t) && f.cost[t] < INF;
      expect(edgeReachable).toBe(true);
      let ore = 0;
      for (let t = 0; t < MAP_N; t++) if (s.feature[t] === FEATURE.ORE && cheb(t, s.home) <= 22) ore++;
      expect(ore).toBeGreaterThanOrEqual(3);
    }
  });

  it('is the same for the same seed', () => {
    expect(hashState(createSim(1234))).toBe(hashState(createSim(1234)));
    expect(hashState(createSim(1234))).not.toBe(hashState(createSim(1235)));
  });

  it('starts three armed settlers with pasts, supplies in the stockpile, and game away from camp', () => {
    const s = createSim(99);
    const people = colonists(s);
    expect(people).toHaveLength(3);
    for (const p of people) {
      expect(p.childhood.length).toBeGreaterThan(10);
      expect(p.story.length).toBeGreaterThan(0);
      expect(p.age).toBeGreaterThanOrEqual(17);
    }
    expect(people.filter((p) => p.weapon !== 'fists').length).toBeGreaterThanOrEqual(people.filter((p) => !p.incapable.includes('violence')).length);
    expect(countItems(s, 'wood')).toBe(60);
    expect(countItems(s, 'stone')).toBe(20);
    expect(countItems(s, 'meal')).toBe(8);
    for (const it of s.items) expect(s.zone[it.tile]).toBe(ZONE.STOCKPILE);
    const animals = s.pawns.filter((p) => p.kind === 'animal');
    expect(animals.length).toBeGreaterThanOrEqual(6);
    for (const a of animals) expect(cheb(tileIndex(a.x, a.y), s.home)).toBeGreaterThanOrEqual(14);
  });
});

describe('determinism', () => {
  it('replays identically from the same seed and orders', () => {
    const a = createSim(777);
    const b = createSim(777);
    opening(a);
    opening(b);
    run(a, TICKS_PER_DAY * 2);
    run(b, TICKS_PER_DAY * 2);
    expect(hashState(a)).toBe(hashState(b));
  });

  it('continues identically after a save and load', () => {
    const straight = createSim(4242);
    opening(straight);
    run(straight, TICKS_PER_DAY);
    const saved = serialize(straight);
    run(straight, TICKS_PER_DAY * 1.5);

    const loaded = deserialize(saved);
    expect(loaded).not.toBeNull();
    run(loaded!, TICKS_PER_DAY * 1.5);
    expect(hashState(loaded!)).toBe(hashState(straight));
  });

  it('rejects saves it cannot read, including the old format', () => {
    expect(deserialize('not json')).toBeNull();
    expect(deserialize('{"version":1}')).toBeNull();
  });
});

describe('settlement life', () => {
  it('chops trees and hauls the wood to the stockpile', () => {
    const s = createSim(31337);
    const hx = tileX(s.home);
    const hy = tileY(s.home);
    applyCommand(s, { t: 'harvest', x0: hx - 12, y0: hy - 12, x1: hx + 12, y1: hy + 12 });
    run(s, TICKS_PER_DAY / 2);
    const stocked = s.items.filter((it) => it.type === 'wood' && s.zone[it.tile] === ZONE.STOCKPILE).reduce((n, it) => n + it.count, 0);
    expect(stocked).toBeGreaterThan(60);
  });

  it('builds an enclosed room with a door', () => {
    const s = createSim(2024);
    opening(s);
    run(s, TICKS_PER_DAY * 1.2);
    const hx = tileX(s.home);
    const hy = tileY(s.home);
    expect(s.structures.filter((st) => st.kind === 'wall')).toHaveLength(15);
    expect(s.structures.filter((st) => st.kind === 'door')).toHaveLength(1);
    expect(isIndoors(s, tileIndex(hx - 2, hy + 3))).toBe(true);
    expect(isIndoors(s, s.home)).toBe(false);
    expect(s.structures.filter((st) => st.kind === 'bed')).toHaveLength(3);
  });

  it('keeps settlers fed and rested through the first day, and cooks meals', () => {
    const s = createSim(5150);
    opening(s);
    run(s, TICKS_PER_DAY);
    for (const p of colonists(s)) {
      expect(p.food).toBeGreaterThan(20);
      expect(p.rest).toBeGreaterThan(20);
      expect(Number.isFinite(p.mood)).toBe(true);
    }
    expect(s.structures.some((st) => st.kind === 'campfire')).toBe(true);
  });

  it('forages berries on its own when food runs low', () => {
    const s = createSim(8675);
    for (const it of [...s.items]) if (it.type === 'berries' || it.type === 'meal') it.count = 1;
    run(s, TICKS_PER_DAY / 3);
    expect(countItems(s, 'berries')).toBeGreaterThan(5);
  });
});

describe('farming', () => {
  it('sows a potato field, and reaps it once ripe', () => {
    const s = createSim(4321);
    const field: number[] = [];
    for (let dx = -2; dx <= 2; dx++) field.push(openTile(s, dx, -6));
    applyCommand(s, { t: 'zone', zone: 'potato', x0: tileX(field[0]), y0: tileY(field[0]), x1: tileX(field[4]), y1: tileY(field[4]) });
    run(s, TICKS_PER_DAY / 4);
    const sown = field.filter((t) => s.plant[t] !== 0);
    expect(sown.length).toBeGreaterThan(0);
    for (const t of sown) s.growth[t] = 1000;
    s.structVersion++;
    run(s, TICKS_PER_DAY / 4);
    expect(countItems(s, 'potato')).toBeGreaterThan(0);
  });

  it('only allows fields on open ground, and healroot only after research', () => {
    const s = createSim(4322);
    const t = openTile(s, 0, -6);
    const r = { x0: tileX(t), y0: tileY(t), x1: tileX(t), y1: tileY(t) };
    expect(planCommand(s, { t: 'zone', zone: 'potato', ...r })[0].ok).toBe(true);
    expect(planCommand(s, { t: 'zone', zone: 'healroot', ...r })[0].ok).toBe(false);
    s.research.done.push('medicine');
    expect(planCommand(s, { t: 'zone', zone: 'healroot', ...r })[0].ok).toBe(true);
    s.feature[t] = FEATURE.TREE;
    expect(planCommand(s, { t: 'zone', zone: 'potato', ...r })[0].ok).toBe(false);
  });

  it('strips the berry bushes bare when winter comes', () => {
    const s = createSim(1111);
    s.tick = tickAt(16, 0) - 1;
    s.nextThreatTick = s.tick + TICKS_PER_DAY * 10;
    step(s);
    const bushes = [];
    for (let t = 0; t < MAP_N; t++) if (s.feature[t] === FEATURE.BUSH) bushes.push(t);
    expect(bushes.length).toBeGreaterThan(0);
    for (const t of bushes) expect(s.regrow[t]).toBeGreaterThan(s.tick);
    expect(s.log.some((e) => e.text.startsWith('Winter has come'))).toBe(true);
  });
});

describe('research and crafting', () => {
  it('studies at a research desk until the subject is learned', () => {
    const s = createSim(7001);
    addStructure(s, 'researchDesk', openTile(s, 0, -5));
    applyCommand(s, { t: 'research', tech: 'games' });
    s.research.progress.games = 990;
    run(s, TICKS_PER_DAY / 2);
    expect(s.research.done).toContain('games');
    expect(s.research.current).toBe('');
    expect(planCommand(s, { t: 'build', kind: 'chessTable', x0: tileX(s.home) + 2, y0: tileY(s.home) - 5, x1: tileX(s.home) + 2, y1: tileY(s.home) - 5 })[0].ok).toBe(true);
  });

  it('will not study a subject before what it builds on', () => {
    const s = createSim(7002);
    applyCommand(s, { t: 'research', tech: 'tactics' });
    expect(s.research.current).toBe('');
    applyCommand(s, { t: 'research', tech: 'archery' });
    expect(s.research.current).toBe('archery');
  });

  it('crafts weapons at a bench to keep the ordered number in stock', () => {
    const s = createSim(7003);
    addStructure(s, 'craftBench', openTile(s, 0, -5));
    applyCommand(s, { t: 'order', item: 'club', count: 2 });
    run(s, TICKS_PER_DAY / 2);
    const clubs = countItems(s, 'club') + colonists(s).filter((p) => p.weapon === 'club').length;
    expect(clubs).toBeGreaterThanOrEqual(2);
  });
});

describe('drafting', () => {
  it('drafts, moves and releases settlers on command', () => {
    const s = createSim(9001);
    const fighter = colonists(s).find((p) => !p.incapable.includes('violence'))!;
    applyCommand(s, { t: 'draft', ids: [fighter.id], on: true });
    expect(fighter.drafted).toBe(true);
    const dest = openTile(s, 4, -4);
    applyCommand(s, { t: 'move', ids: [fighter.id], tile: dest });
    run(s, 200);
    expect(cheb(tileIndex(fighter.x, fighter.y), dest)).toBeLessThanOrEqual(1);
    expect(fighter.job?.kind).toBe('hold');
    applyCommand(s, { t: 'draft', ids: [fighter.id], on: false });
    expect(fighter.drafted).toBe(false);
  });

  it('sends drafted settlers after a raider they are told to attack', () => {
    const s = createSim(9002);
    const fighter = colonists(s).find((p) => !p.incapable.includes('violence'))!;
    const goblin = makeGoblin(s, openTile(s, 6, 0), 0, 'fighter');
    s.pawns.push(goblin);
    applyCommand(s, { t: 'attack', ids: [fighter.id], targetId: goblin.id });
    expect(fighter.drafted).toBe(true);
    expect(fighter.job).toMatchObject({ kind: 'fight', targetId: goblin.id, ordered: true });
    expect(hostiles(s)).toContain(goblin);
  });
});

describe('people', () => {
  it('ends a fistfight before anyone is badly hurt, and nobody forgets it', () => {
    const s = createSim(5555);
    const [a, b] = colonists(s);
    const before = opinion(s, b, a);
    startBrawl(s, a, b);
    run(s, 500);
    for (const p of [a, b]) {
      expect(p.life).not.toBe('dead');
      expect(p.mental).toBeNull();
      expect(p.hp).toBeGreaterThan(0);
    }
    expect(opinion(s, b, a)).toBeLessThan(before);
  });

  it('gives chiefs who escape a new name and a higher level', () => {
    const s = createSim(6666);
    const chief = makeChief(s);
    s.chiefs.push(chief);
    const g = makeGoblin(s, s.home, 0, 'chief', chief);
    g.hp = 10;
    chiefEscaped(s, g);
    expect(chief.level).toBe(2);
    expect(chief.title).toBe('the Scarred');
    expect(s.log.at(-1)!.text).toContain('will be back');
  });

  it('remembers settlers who died, buries them, and their family mourns', () => {
    const s = createSim(6667);
    const [p, sibling] = colonists(s);
    sibling.relations.push({ id: p.id, kind: 'sibling', since: 0 });
    kill(s, p, 'was lost in the woods');
    step(s);
    expect(pawnById(s, p.id)).toBeUndefined();
    expect(s.fallen.some((f) => f.id === p.id && f.cause === 'was lost in the woods')).toBe(true);
    expect(s.structures.some((st) => st.kind === 'grave' && st.label === p.name)).toBe(true);
    expect(sibling.memories.some((m) => m.key === `death:${p.id}` && m.mood < -10)).toBe(true);
  });
});

describe('raids', () => {
  it('always sends two goblins first', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = createSim(seed * 13);
      // Skip straight to the moment the scouts spot them.
      s.tick = s.nextThreatTick - B.raidWarning - 1;
      step(s);
      expect(s.raid?.units).toHaveLength(2);
    }
  });

  it('warns about a small first war band, which arrives on day 2 and ends', () => {
    const s = createSim(8080);
    opening(s);
    run(s, TICKS_PER_DAY * 3);
    const texts = s.log.map((e) => e.text);
    expect(texts.some((t) => t.startsWith('Scouts spotted a goblin war band to the'))).toBe(true);
    expect(texts.some((t) => t.startsWith('The goblins are here!'))).toBe(true);
    expect(s.raidCount + (s.over ? 1 : 0)).toBeGreaterThanOrEqual(1);
    const first = s.log.find((e) => e.text.startsWith('The goblins are here!'))!;
    expect(Number(/(\d+) raiders/.exec(first.text)![1])).toBeLessThanOrEqual(3);
  });

  it('lets colonists walk around walls but sends raiders through them', () => {
    const s = createSim(606);
    const hx = tileX(s.home);
    const hy = tileY(s.home);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
        const t = tileIndex(hx + dx, hy + dy);
        s.structKind[t] = STRUCT_CODE.wall;
        s.structGrid[t] = 999;
      }
    }
    s.structVersion++;
    const outside = tileIndex(hx + 5, hy);
    expect(flood(s, outside).cost[s.home]).toBe(INF);
    expect(flood(s, outside, true).cost[s.home]).toBeLessThan(INF);
  });
});

describe('orders', () => {
  it('plans a room with exactly one door on the near side', () => {
    const s = createSim(11);
    const hx = tileX(s.home);
    const hy = tileY(s.home);
    const plan = planCommand(s, { t: 'room', wall: 'stoneWall', x0: hx - 2, y0: hy - 2, x1: hx + 2, y1: hy + 2 });
    expect(plan).toHaveLength(16);
    const doors = plan.filter((p) => p.kind === 'door');
    expect(doors).toHaveLength(1);
    expect(doors[0].tile).toBe(tileIndex(hx, hy + 2));
    expect(plan.filter((p) => p.kind === 'stoneWall')).toHaveLength(15);
    expect(plan.every((p) => p.ok)).toBe(true);
  });

  it('refuses rooms too small to stand in', () => {
    const s = createSim(12);
    const hx = tileX(s.home);
    const hy = tileY(s.home);
    const plan = planCommand(s, { t: 'room', wall: 'wall', x0: hx, y0: hy, x1: hx + 1, y1: hy + 3 });
    expect(plan.every((p) => !p.ok)).toBe(true);
  });

  it('lays floors under furniture but not under walls, and locks buildings behind research', () => {
    const s = createSim(14);
    const t = openTile(s, 0, -5);
    const r = { x0: tileX(t), y0: tileY(t), x1: tileX(t), y1: tileY(t) };
    addStructure(s, 'bed', t);
    expect(planCommand(s, { t: 'build', kind: 'woodFloor', ...r })[0].ok).toBe(true);
    const w = openTile(s, 2, -5);
    addStructure(s, 'wall', w);
    expect(planCommand(s, { t: 'build', kind: 'woodFloor', x0: tileX(w), y0: tileY(w), x1: tileX(w), y1: tileY(w) })[0].ok).toBe(false);
    const u = openTile(s, 4, -5);
    const ru = { x0: tileX(u), y0: tileY(u), x1: tileX(u), y1: tileY(u) };
    expect(planCommand(s, { t: 'build', kind: 'tower', ...ru })[0].ok).toBe(false);
    s.research.done.push('archery');
    expect(planCommand(s, { t: 'build', kind: 'tower', ...ru })[0].ok).toBe(true);
  });

  it('clears orders without touching buildings, and demolishes on request', () => {
    const s = createSim(13);
    opening(s);
    run(s, TICKS_PER_DAY);
    const wall = s.structures.find((st) => st.kind === 'wall')!;
    const r = { x0: tileX(wall.tile), y0: tileY(wall.tile), x1: tileX(wall.tile), y1: tileY(wall.tile) };
    applyCommand(s, { t: 'clear', ...r });
    expect(s.structGrid[wall.tile]).toBe(wall.id);
    applyCommand(s, { t: 'demolish', ...r });
    expect(s.decon[wall.tile]).toBe(1);
    run(s, TICKS_PER_DAY / 4);
    expect(s.structGrid[wall.tile]).not.toBe(wall.id);
  });

  it('marks wild animals for hunting, but not raiders', () => {
    const s = createSim(15);
    const deer = s.pawns.find((p) => p.kind === 'animal')!;
    applyCommand(s, { t: 'hunt', animalId: deer.id, on: true });
    expect(deer.marked).toBe(true);
    const wolf = s.pawns.find((p) => p.kind === 'animal' && p !== deer)!;
    wolf.hostile = true;
    applyCommand(s, { t: 'hunt', animalId: wolf.id, on: true });
    expect(wolf.marked).toBe(false);
  });
});
