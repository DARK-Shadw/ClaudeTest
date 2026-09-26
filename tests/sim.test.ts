import { describe, expect, it } from 'vitest';
import {
  FEATURE,
  MAP_N,
  SK,
  TERRAIN,
  TICKS_PER_DAY,
  applyCommand,
  cheb,
  countItems,
  createSim,
  deserialize,
  flood,
  hashState,
  INF,
  isEdge,
  isIndoors,
  planCommand,
  serialize,
  step,
  tileIndex,
  tileX,
  tileY,
  type SimState,
} from '../src/sim';
import { random, seedRng } from '../src/sim/rng';

function run(s: SimState, ticks: number): void {
  for (let i = 0; i < ticks && !s.over; i++) step(s);
}

/** A typical opening: clear the woods nearby, build a room with beds, a campfire and a rally point. */
function opening(s: SimState): void {
  const hx = tileX(s.home);
  const hy = tileY(s.home);
  applyCommand(s, { t: 'harvest', x0: hx - 8, y0: hy - 8, x1: hx + 8, y1: hy + 8 });
  applyCommand(s, { t: 'room', x0: hx - 4, y0: hy + 1, x1: hx, y1: hy + 5 });
  for (let i = 0; i < 3; i++) applyCommand(s, { t: 'build', kind: 'bed', x0: hx - 3 + i, y0: hy + 2, x1: hx - 3 + i, y1: hy + 2 });
  applyCommand(s, { t: 'build', kind: 'campfire', x0: hx + 1, y0: hy - 3, x1: hx + 1, y1: hy - 3 });
  applyCommand(s, { t: 'rally', tile: s.home });
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

describe('map generation', () => {
  it('gives every seed a clear, reachable home', () => {
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
    }
  });

  it('is the same for the same seed', () => {
    expect(hashState(createSim(1234))).toBe(hashState(createSim(1234)));
    expect(hashState(createSim(1234))).not.toBe(hashState(createSim(1235)));
  });

  it('starts three colonists with supplies in the stockpile', () => {
    const s = createSim(99);
    expect(s.pawns.filter((p) => p.kind === 'colonist')).toHaveLength(3);
    expect(countItems(s, 'wood')).toBe(40);
    expect(countItems(s, 'meal')).toBe(6);
    for (const it of s.items) expect(s.zone[it.tile]).toBe(1);
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

  it('rejects saves it cannot read', () => {
    expect(deserialize('not json')).toBeNull();
    expect(deserialize('{"version":2}')).toBeNull();
  });
});

describe('settlement life', () => {
  it('chops trees and hauls the wood to the stockpile', () => {
    const s = createSim(31337);
    const hx = tileX(s.home);
    const hy = tileY(s.home);
    applyCommand(s, { t: 'harvest', x0: hx - 12, y0: hy - 12, x1: hx + 12, y1: hy + 12 });
    run(s, TICKS_PER_DAY / 2);
    const stocked = s.items.filter((it) => it.type === 'wood' && s.zone[it.tile]).reduce((n, it) => n + it.count, 0);
    expect(stocked).toBeGreaterThan(40);
  });

  it('builds an enclosed room with a door', () => {
    const s = createSim(2024);
    opening(s);
    run(s, TICKS_PER_DAY * 1.2);
    const hx = tileX(s.home);
    const hy = tileY(s.home);
    const walls = s.structures.filter((st) => st.kind === 'wall').length;
    const doors = s.structures.filter((st) => st.kind === 'door').length;
    expect(walls).toBe(15);
    expect(doors).toBe(1);
    expect(isIndoors(s, tileIndex(hx - 2, hy + 3))).toBe(true);
    expect(isIndoors(s, s.home)).toBe(false);
    expect(s.structures.filter((st) => st.kind === 'bed')).toHaveLength(3);
  });

  it('keeps colonists fed and rested through the first day', () => {
    const s = createSim(5150);
    opening(s);
    run(s, TICKS_PER_DAY);
    for (const p of s.pawns) {
      if (p.kind !== 'colonist') continue;
      expect(p.food).toBeGreaterThan(20);
      expect(p.rest).toBeGreaterThan(20);
      expect(Number.isFinite(p.mood)).toBe(true);
    }
  });
});

describe('raids', () => {
  it('warns, arrives on day 2 and ends', () => {
    const s = createSim(8080);
    opening(s);
    run(s, TICKS_PER_DAY * 3);
    const texts = s.log.map((e) => e.text);
    expect(texts.some((t) => t.startsWith('Scouts spotted a goblin war band of 3'))).toBe(true);
    expect(texts.some((t) => t.startsWith('The goblins are here!'))).toBe(true);
    expect(s.raidCount + (s.over ? 1 : 0)).toBeGreaterThanOrEqual(1);
    expect(s.pawns.some((p) => p.kind === 'goblin') && !s.raid).toBe(false);
  });

  it('lets colonists walk around walls but sends raiders through them', () => {
    const s = createSim(606);
    const hx = tileX(s.home);
    const hy = tileY(s.home);
    // A wall ring around the home tile.
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
        const t = tileIndex(hx + dx, hy + dy);
        s.structKind[t] = SK.WALL;
        s.structGrid[t] = 999;
      }
    }
    s.structVersion++;
    const inside = s.home;
    const outside = tileIndex(hx + 5, hy);
    expect(flood(s, outside).cost[inside]).toBe(INF);
    expect(flood(s, outside, true).cost[inside]).toBeLessThan(INF);
  });
});

describe('orders', () => {
  it('plans a room with exactly one door on the near side', () => {
    const s = createSim(11);
    const hx = tileX(s.home);
    const hy = tileY(s.home);
    const plan = planCommand(s, { t: 'room', x0: hx - 2, y0: hy - 2, x1: hx + 2, y1: hy + 2 });
    expect(plan).toHaveLength(16);
    const doors = plan.filter((p) => p.kind === 'door');
    expect(doors).toHaveLength(1);
    expect(doors[0].tile).toBe(tileIndex(hx, hy + 2));
    expect(plan.every((p) => p.ok)).toBe(true);
  });

  it('refuses rooms too small to stand in', () => {
    const s = createSim(12);
    const hx = tileX(s.home);
    const hy = tileY(s.home);
    const plan = planCommand(s, { t: 'room', x0: hx, y0: hy, x1: hx + 1, y1: hy + 3 });
    expect(plan.every((p) => !p.ok)).toBe(true);
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
});
