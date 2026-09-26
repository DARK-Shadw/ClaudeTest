/**
 * Low-level state primitives: lookups and every mutation of items, structures, blueprints,
 * logs and memories goes through here so the per-tile grids never drift out of sync.
 */
import { FEATURE, MAP_H, MAP_N, MAP_W, SK, STACK_MAX, STRUCTURES, STRUCT_CODE, TERRAIN, TICKS_PER_DAY } from './constants';
import { DIRS, inBounds, tileIndex, tileX, tileY } from './grid';
import type {
  Blueprint,
  BuildKind,
  ItemStack,
  ItemType,
  LogKind,
  Pawn,
  SimState,
  Structure,
  StructureKind,
  TraitId,
} from './types';

// Pawns

export const pawnTile = (p: Pawn): number => tileIndex(p.x, p.y);
export const has = (p: Pawn, trait: TraitId): boolean => p.traits.includes(trait);

export function firstName(p: Pawn): string {
  const i = p.name.indexOf(' ');
  return i < 0 ? p.name : p.name.slice(0, i);
}

export const pawnById = (s: SimState, id: number): Pawn | undefined => s.pawns.find((p) => p.id === id);

export const livingColonists = (s: SimState): Pawn[] =>
  s.pawns.filter((p) => p.kind === 'colonist' && p.life !== 'dead');

export const hostiles = (s: SimState): Pawn[] => s.pawns.filter((p) => p.kind === 'goblin' && p.life === 'ok' && !p.gone);

// Log

const LOG_MAX = 250;

export function log(s: SimState, kind: LogKind, text: string, chronicle = false): void {
  s.log.push({ id: s.nextLogId++, tick: s.tick, kind, text, chronicle });
  if (s.log.length > LOG_MAX) {
    const i = s.log.findIndex((e) => !e.chronicle);
    s.log.splice(i >= 0 ? i : 0, 1);
  }
}

// Mood memories

export function addMemory(p: Pawn, key: string, label: string, mood: number, until: number): void {
  const existing = p.memories.find((m) => m.key === key);
  if (existing) {
    existing.label = label;
    existing.mood = mood;
    existing.until = until;
  } else {
    p.memories.push({ key, label, mood, until });
  }
}

// Terrain

export const isLand = (s: SimState, t: number): boolean =>
  s.terrain[t] === TERRAIN.GRASS || s.terrain[t] === TERRAIN.SAND;

export const isSolidCode = (code: number): boolean => code === SK.WALL || code === SK.STONE_WALL || code === SK.CAMPFIRE;

/** Can a colonist stand here? Doors, beds, traps and graves are walkable. */
export const walkable = (s: SimState, t: number): boolean =>
  isLand(s, t) && s.feature[t] !== FEATURE.BOULDER && !isSolidCode(s.structKind[t]);

export function harvestable(s: SimState, t: number): boolean {
  const f = s.feature[t];
  return f === FEATURE.TREE || f === FEATURE.BOULDER || (f === FEATURE.BUSH && s.regrow[t] <= s.tick);
}

/** Tiles around `center` in rings of growing distance, nearest first. Excludes the centre. */
export function nearbyTiles(center: number, maxR: number): number[] {
  const cx = tileX(center);
  const cy = tileY(center);
  const out: number[] = [];
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (inBounds(x, y)) out.push(tileIndex(x, y));
      }
    }
  }
  return out;
}

/** The centre if it passes, otherwise the nearest tile that does, or -1. */
export function ringSearch(center: number, maxR: number, test: (t: number) => boolean): number {
  if (test(center)) return center;
  for (const t of nearbyTiles(center, maxR)) if (test(t)) return t;
  return -1;
}

// Items

export function itemAt(s: SimState, t: number): ItemStack | undefined {
  const id = s.itemGrid[t];
  return id ? s.items.find((i) => i.id === id) : undefined;
}

export const itemById = (s: SimState, id: number): ItemStack | undefined => s.items.find((i) => i.id === id);

/** How many units of `type` still fit on a tile. */
export function capacity(s: SimState, t: number, type: ItemType): number {
  if (!walkable(s, t)) return 0;
  const bp = blueprintAt(s, t);
  if (bp && STRUCTURES[bp.kind].solid) return 0;
  const it = itemAt(s, t);
  if (!it) return STACK_MAX[type];
  return it.type === type ? STACK_MAX[type] - it.count : 0;
}

/** Adds as much as fits on the tile and returns how many units were placed. */
export function addItemAt(s: SimState, t: number, type: ItemType, count: number): number {
  const n = Math.min(count, capacity(s, t, type));
  if (n <= 0) return 0;
  const it = itemAt(s, t);
  if (it) {
    it.count += n;
  } else {
    const stack: ItemStack = { id: s.nextId++, type, count: n, tile: t };
    s.items.push(stack);
    s.itemGrid[t] = stack.id;
  }
  s.itemVersion++;
  return n;
}

/** Drops items on the nearest tiles with room. Returns the units that found no room. */
export function placeItemNear(s: SimState, t: number, type: ItemType, count: number): number {
  let left = count - addItemAt(s, t, type, count);
  if (left <= 0) return 0;
  for (const n of nearbyTiles(t, 6)) {
    left -= addItemAt(s, n, type, left);
    if (left <= 0) return 0;
  }
  return left;
}

export function removeItem(s: SimState, it: ItemStack): void {
  const i = s.items.indexOf(it);
  if (i >= 0) s.items.splice(i, 1);
  if (s.itemGrid[it.tile] === it.id) s.itemGrid[it.tile] = 0;
  s.itemVersion++;
}

export function takeFromItem(s: SimState, it: ItemStack, n: number): number {
  const k = Math.min(n, it.count);
  it.count -= k;
  if (it.count <= 0) removeItem(s, it);
  else s.itemVersion++;
  return k;
}

export function countItems(s: SimState, type: ItemType): number {
  let n = 0;
  for (const it of s.items) if (it.type === type) n += it.count;
  return n;
}

export function zoneTiles(s: SimState): number[] {
  const out: number[] = [];
  for (let t = 0; t < MAP_N; t++) if (s.zone[t]) out.push(t);
  return out;
}

/** The best stockpile tile for an item: top up a matching stack first, otherwise the nearest free tile. */
export function zoneDest(s: SimState, type: ItemType, near: number, tiles = zoneTiles(s)): number {
  let best = -1;
  let bestScore = Infinity;
  const nx = tileX(near);
  const ny = tileY(near);
  for (const t of tiles) {
    if (capacity(s, t, type) <= 0) continue;
    const d = Math.max(Math.abs(tileX(t) - nx), Math.abs(tileY(t) - ny));
    const score = d * 10 + (s.itemGrid[t] ? 0 : 6);
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

// Structures

export function structureAt(s: SimState, t: number): Structure | undefined {
  const id = s.structGrid[t];
  return id ? s.structures.find((st) => st.id === id) : undefined;
}

export const structureById = (s: SimState, id: number): Structure | undefined => s.structures.find((st) => st.id === id);

export function addStructure(s: SimState, kind: StructureKind, tile: number, ownerId = 0, label = ''): Structure {
  const hp = kind === 'grave' ? 50 : STRUCTURES[kind].hp;
  const st: Structure = { id: s.nextId++, kind, tile, hp, maxHp: hp, ownerId, label };
  s.structures.push(st);
  s.structGrid[tile] = st.id;
  s.structKind[tile] = STRUCT_CODE[kind];
  s.structVersion++;
  if (isSolidCode(s.structKind[tile])) clearTileForSolid(s, tile);
  return st;
}

export function removeStructure(s: SimState, st: Structure): void {
  const i = s.structures.indexOf(st);
  if (i >= 0) s.structures.splice(i, 1);
  if (s.structGrid[st.tile] === st.id) {
    s.structGrid[st.tile] = 0;
    s.structKind[st.tile] = SK.NONE;
  }
  s.decon[st.tile] = 0;
  if (st.kind === 'bed') for (const p of s.pawns) if (p.bedId === st.id) p.bedId = 0;
  s.structVersion++;
}

/** Moves pawns and items off a tile that just became solid. */
function clearTileForSolid(s: SimState, tile: number): void {
  s.zone[tile] = 0;
  const it = itemAt(s, tile);
  if (it) {
    const { type, count } = it;
    removeItem(s, it);
    placeItemNear(s, tile, type, count);
  }
  for (const p of s.pawns) {
    if (pawnTile(p) !== tile) continue;
    const free = ringSearch(tile, 6, (t) => t !== tile && walkable(s, t));
    if (free < 0) continue;
    p.x = p.fromX = tileX(free);
    p.y = p.fromY = tileY(free);
    p.moveT = p.moveDur = 0;
    p.path = [];
  }
}

// Blueprints

export function blueprintAt(s: SimState, t: number): Blueprint | undefined {
  const id = s.bpGrid[t];
  return id ? s.blueprints.find((b) => b.id === id) : undefined;
}

export const blueprintById = (s: SimState, id: number): Blueprint | undefined => s.blueprints.find((b) => b.id === id);

export function addBlueprint(s: SimState, kind: BuildKind, tile: number): Blueprint {
  const bp: Blueprint = { id: s.nextId++, kind, tile, delivered: 0, work: 0 };
  s.blueprints.push(bp);
  s.bpGrid[tile] = bp.id;
  // Trees and rocks in the way are cut down first.
  if (s.feature[tile] === FEATURE.TREE || s.feature[tile] === FEATURE.BOULDER) s.designated[tile] = 1;
  s.structVersion++;
  return bp;
}

export function removeBlueprint(s: SimState, bp: Blueprint, refund: boolean): void {
  const i = s.blueprints.indexOf(bp);
  if (i >= 0) s.blueprints.splice(i, 1);
  if (s.bpGrid[bp.tile] === bp.id) s.bpGrid[bp.tile] = 0;
  if (refund && bp.delivered > 0) placeItemNear(s, bp.tile, STRUCTURES[bp.kind].material, bp.delivered);
  s.structVersion++;
}

/** Trees and rocks have to be cleared before building; bushes are simply dug up. */
export const buildBlocked = (s: SimState, t: number): boolean =>
  s.feature[t] === FEATURE.TREE || s.feature[t] === FEATURE.BOULDER;

export function completeBlueprint(s: SimState, bp: Blueprint): void {
  removeBlueprint(s, bp, false);
  if (s.feature[bp.tile] === FEATURE.BUSH) {
    s.feature[bp.tile] = FEATURE.NONE;
    s.designated[bp.tile] = 0;
  }
  addStructure(s, bp.kind, bp.tile);
  if (bp.kind === 'bed' || bp.kind === 'campfire') log(s, 'good', `A new ${STRUCTURES[bp.kind].label.toLowerCase()} is ready.`);
}

// Rooms

const roomCache = new WeakMap<SimState, { version: number; room: Int32Array }>();

/**
 * Room id for every tile: areas fully enclosed by walls, doors or mountains. Outdoors is -1.
 * Cached until the board changes.
 */
export function roomMap(s: SimState): Int32Array {
  const cached = roomCache.get(s);
  if (cached && cached.version === s.structVersion) return cached.room;
  const room = new Int32Array(MAP_N).fill(-1);
  const seen = new Uint8Array(MAP_N);
  const boundary = (t: number): boolean => {
    const k = s.structKind[t];
    return k === SK.WALL || k === SK.STONE_WALL || k === SK.DOOR || s.terrain[t] === TERRAIN.MOUNTAIN;
  };
  const stack: number[] = [];
  const region: number[] = [];
  let next = 0;
  for (let t0 = 0; t0 < MAP_N; t0++) {
    if (seen[t0] || boundary(t0)) continue;
    region.length = 0;
    let open = false;
    seen[t0] = 1;
    stack.push(t0);
    while (stack.length > 0) {
      const t = stack.pop()!;
      region.push(t);
      const x = tileX(t);
      const y = tileY(t);
      if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1) open = true;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d][0];
        const ny = y + DIRS[d][1];
        if (!inBounds(nx, ny)) continue;
        const n = tileIndex(nx, ny);
        if (seen[n] || boundary(n)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (!open && region.length <= 160) {
      for (const t of region) room[t] = next;
      next++;
    }
  }
  roomCache.set(s, { version: s.structVersion, room });
  return room;
}

export const isIndoors = (s: SimState, t: number): boolean => roomMap(s)[t] >= 0;

// Death

export function kill(s: SimState, p: Pawn, cause: string): void {
  if (p.life === 'dead') return;
  const tile = pawnTile(p);
  if (p.carry) {
    placeItemNear(s, tile, p.carry.type, p.carry.count);
    p.carry = null;
  }
  p.life = 'dead';
  p.job = null;
  p.path = [];
  p.hp = 0;
  if (p.kind !== 'colonist') {
    if (s.raid && p.raidId === s.raid.id) s.raid.slain++;
    return;
  }
  s.fallen.push({ name: p.name, tick: s.tick, cause });
  log(s, 'death', `${p.name} ${cause}.`, true);
  const grave = ringSearch(tile, 5, (t) => walkable(s, t) && !s.structGrid[t] && !s.bpGrid[t] && !s.zone[t] && !s.itemGrid[t]);
  if (grave >= 0) addStructure(s, 'grave', grave, 0, p.name);
  for (const o of s.pawns) {
    if (o === p || o.kind !== 'colonist' || o.life === 'dead') continue;
    addMemory(o, `death:${p.id}`, `${firstName(p)} died`, -12, s.tick + TICKS_PER_DAY * 2);
  }
  for (const st of s.structures) {
    if (st.ownerId === p.id) {
      st.ownerId = 0;
      s.structVersion++;
    }
  }
}

export const mapCenter = (): number => tileIndex(MAP_W >> 1, MAP_H >> 1);
