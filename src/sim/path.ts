/**
 * Grid pathfinding and sight lines. A single Dijkstra flood from a pawn answers "what is the
 * nearest X I can reach?" for every kind of work at once, which is cheaper than one A* search
 * per candidate. Costs are integers (10 per straight step) so results are identical on every
 * device.
 */
import { FEATURE, MAP_N, MAP_W, TERRAIN } from './constants';
import { BUILDINGS, CODE_KIND, STRUCT_CODE } from './defs';
import { DIRS, inBounds, tileIndex, tileX, tileY } from './grid';
import type { SimState } from './types';

export const INF = 0x3fffffff;

export interface Flood {
  cost: Int32Array;
  parent: Int32Array;
  start: number;
}

const DOOR = STRUCT_CODE.door;
const SOLID: readonly boolean[] = CODE_KIND.map((k) => !!k && k !== 'grave' && BUILDINGS[k].solid);
const SLOW: readonly number[] = CODE_KIND.map((k) => (k && k !== 'grave' ? BUILDINGS[k].slow : 0));
/** Extra cost a raider pays to plan through a building it will have to smash. */
const BASH: readonly number[] = CODE_KIND.map((k) =>
  k && k !== 'grave' && (BUILDINGS[k].solid || k === 'door') ? Math.round(BUILDINGS[k].hp * 0.9) : 0,
);
const SIGHT_BLOCK: readonly boolean[] = CODE_KIND.map((k) => k === 'wall' || k === 'stoneWall' || k === 'door');

/** Walls, doors and other solid buildings stop raiders until they smash them. */
export const isBashTarget = (s: SimState, t: number): boolean => BASH[s.structKind[t]] > 0;

/**
 * Cost of stepping onto a tile orthogonally, or -1 if impassable. Raiders plan straight
 * through walls and doors at a price, then stop to smash them when they get there.
 */
export function enterCost(s: SimState, t: number, raider: boolean): number {
  const terrain = s.terrain[t];
  if (terrain === TERRAIN.WATER || terrain === TERRAIN.MOUNTAIN) return -1;
  const feature = s.feature[t];
  if (feature === FEATURE.BOULDER || feature === FEATURE.ORE) return -1;
  let cost = feature === FEATURE.TREE ? 16 : feature === FEATURE.BUSH ? 13 : s.floor[t] ? 8 : 10;
  const code = s.structKind[t];
  if (!code) return cost;
  if (SOLID[code]) return raider ? cost + BASH[code] : -1;
  if (code === DOOR) return raider ? cost + BASH[code] : cost + 6;
  cost += SLOW[code];
  return cost;
}

/** Open ground for the no-corner-cutting rule on diagonal steps. */
function open(s: SimState, t: number, raider: boolean): boolean {
  if (enterCost(s, t, false) < 0) return false;
  return !(raider && s.structKind[t] === DOOR);
}

export const diagonalCost = (straight: number): number => ((straight * 14 + 5) / 10) | 0;

/** Cost of one step between two neighbouring tiles, or -1 when it is not allowed. */
export function stepCost(s: SimState, from: number, to: number, raider: boolean): number {
  const c = enterCost(s, to, raider);
  if (c < 0) return -1;
  const dx = tileX(to) - tileX(from);
  const dy = tileY(to) - tileY(from);
  if (dx === 0 || dy === 0) return c;
  const fx = tileX(from);
  const fy = tileY(from);
  if (!open(s, tileIndex(fx + dx, fy), raider) || !open(s, tileIndex(fx, fy + dy), raider)) return -1;
  return diagonalCost(c);
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.vals.length;
  }

  peekKey(): number {
    return this.keys[0];
  }

  push(key: number, val: number): void {
    const keys = this.keys;
    const vals = this.vals;
    let i = vals.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent];
      vals[i] = vals[parent];
      i = parent;
    }
    keys[i] = key;
    vals[i] = val;
  }

  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const top = vals[0];
    const lastKey = keys.pop()!;
    const lastVal = vals.pop()!;
    const n = vals.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = lastKey;
      vals[i] = lastVal;
    }
    return top;
  }
}

/** Per-tile step costs for both movement modes, rebuilt only when the board changes. */
interface CostGrids {
  version: number;
  colonist: Int32Array;
  raider: Int32Array;
  openColonist: Uint8Array;
  openRaider: Uint8Array;
}

const gridCache = new WeakMap<SimState, CostGrids>();

function costGrids(s: SimState): CostGrids {
  const cached = gridCache.get(s);
  if (cached && cached.version === s.structVersion) return cached;
  const g: CostGrids = {
    version: s.structVersion,
    colonist: new Int32Array(MAP_N),
    raider: new Int32Array(MAP_N),
    openColonist: new Uint8Array(MAP_N),
    openRaider: new Uint8Array(MAP_N),
  };
  for (let t = 0; t < MAP_N; t++) {
    g.colonist[t] = enterCost(s, t, false);
    g.raider[t] = enterCost(s, t, true);
    g.openColonist[t] = open(s, t, false) ? 1 : 0;
    g.openRaider[t] = open(s, t, true) ? 1 : 0;
  }
  gridCache.set(s, g);
  return g;
}

export function flood(s: SimState, start: number, raider = false, maxCost = INF): Flood {
  const grids = costGrids(s);
  const enter = raider ? grids.raider : grids.colonist;
  const isOpen = raider ? grids.openRaider : grids.openColonist;
  const cost = new Int32Array(MAP_N).fill(INF);
  const parent = new Int32Array(MAP_N).fill(-1);
  const heap = new MinHeap();
  cost[start] = 0;
  heap.push(0, start);
  while (heap.size > 0) {
    const c = heap.peekKey();
    const t = heap.pop();
    if (c > cost[t]) continue;
    const x = tileX(t);
    const y = tileY(t);
    for (let d = 0; d < 8; d++) {
      const dx = DIRS[d][0];
      const dy = DIRS[d][1];
      if (!inBounds(x + dx, y + dy)) continue;
      const n = t + dx + dy * MAP_W;
      let step = enter[n];
      if (step < 0) continue;
      if (dx !== 0 && dy !== 0) {
        if (!isOpen[t + dx] || !isOpen[t + dy * MAP_W]) continue;
        step = diagonalCost(step);
      }
      const nc = c + step;
      if (nc < cost[n] && nc <= maxCost) {
        cost[n] = nc;
        parent[n] = t;
        heap.push(nc, n);
      }
    }
  }
  return { cost, parent, start };
}

/**
 * Cheapest reachable tile from which a pawn can touch `target`: one of its eight neighbours,
 * or the target itself when `allowOn` is set. Returns -1 if none is reachable.
 */
export function bestStand(f: Flood, target: number, allowOn: boolean): number {
  let best = -1;
  let bestCost = INF;
  if (allowOn && f.cost[target] < bestCost) {
    best = target;
    bestCost = f.cost[target];
  }
  const x = tileX(target);
  const y = tileY(target);
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(nx, ny)) continue;
    const n = tileIndex(nx, ny);
    if (f.cost[n] < bestCost) {
      bestCost = f.cost[n];
      best = n;
    }
  }
  return best;
}

/** Tiles to walk from the flood's start to `dest`, excluding the start. Empty if unreachable. */
export function pathTo(f: Flood, dest: number): number[] {
  if (dest < 0 || f.cost[dest] >= INF) return [];
  const out: number[] = [];
  let t = dest;
  while (t !== f.start) {
    out.push(t);
    t = f.parent[t];
    if (t < 0) return [];
  }
  out.reverse();
  return out;
}

// Sight

function blocksSight(s: SimState, t: number): boolean {
  return s.terrain[t] === TERRAIN.MOUNTAIN || SIGHT_BLOCK[s.structKind[t]];
}

/** True when nothing tall stands on the straight line between two tiles (Bresenham). */
export function lineOfSight(s: SimState, a: number, b: number): boolean {
  let x0 = tileX(a);
  let y0 = tileY(a);
  const x1 = tileX(b);
  const y1 = tileY(b);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
    if (x0 === x1 && y0 === y1) return true;
    if (blocksSight(s, tileIndex(x0, y0))) return false;
  }
}

const BARRICADE = STRUCT_CODE.barricade;

/** How much a target is hidden from a shooter by barricades, trees and rocks next to it. */
export function coverAt(s: SimState, target: number, from: number): number {
  if (s.structKind[target] === BARRICADE) return 0.35;
  const tx = tileX(target);
  const ty = tileY(target);
  const nx = tx + Math.sign(tileX(from) - tx);
  const ny = ty + Math.sign(tileY(from) - ty);
  if (!inBounds(nx, ny) || (nx === tx && ny === ty)) return 0;
  const n = tileIndex(nx, ny);
  const code = s.structKind[n];
  if (code === BARRICADE) return 0.35;
  if (SIGHT_BLOCK[code]) return 0.25;
  const f = s.feature[n];
  if (f === FEATURE.BOULDER || f === FEATURE.ORE) return 0.25;
  if (f === FEATURE.TREE) return 0.15;
  return 0;
}
