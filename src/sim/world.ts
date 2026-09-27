/**
 * Low-level state primitives: lookups and every mutation of items, structures, blueprints,
 * floors, logs and memories goes through here so the per-tile grids never drift out of sync.
 */
import { FEATURE, MAP_H, MAP_N, MAP_W, TERRAIN, ZONE } from './constants';
import {
  BUILDINGS,
  CODE_FLOOR,
  CODE_KIND,
  FLOORS,
  FLOOR_CODE,
  ITEMS,
  STRUCT_CODE,
  blueprintSpec,
  isFloorKind,
  type ItemGroup,
} from './defs';
import { DIRS, inBounds, tileIndex, tileX, tileY } from './grid';
import type {
  Blueprint,
  BlueprintKind,
  ItemStack,
  ItemType,
  LogKind,
  Pawn,
  SimState,
  Structure,
  StructureKind,
  TechId,
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

/** Everything currently attacking the settlement: goblins and hostile animals. */
export const hostiles = (s: SimState): Pawn[] =>
  s.pawns.filter((p) => (p.kind === 'goblin' || p.hostile) && p.life === 'ok' && !p.gone);

export const isHostile = (p: Pawn): boolean => p.kind === 'goblin' || p.hostile;

/** Drops the current job. Colonists put down what they carry; goblins keep their loot. */
export function endJob(s: SimState, p: Pawn): void {
  if (p.kind === 'colonist' && p.carry) {
    placeItemNear(s, pawnTile(p), p.carry.type, p.carry.count);
    p.carry = null;
  }
  p.job = null;
  p.path = [];
}

// Log and story

const LOG_MAX = 300;

export function log(s: SimState, kind: LogKind, text: string, chronicle = false): void {
  s.log.push({ id: s.nextLogId++, tick: s.tick, kind, text, chronicle });
  if (s.log.length > LOG_MAX) {
    const i = s.log.findIndex((e) => !e.chronicle);
    s.log.splice(i >= 0 ? i : 0, 1);
  }
}

const STORY_MAX = 60;

/** Adds a line to a colonist's life story. */
export function story(s: SimState, p: Pawn, text: string): void {
  if (p.kind !== 'colonist') return;
  p.story.push({ tick: s.tick, text });
  if (p.story.length > STORY_MAX) p.story.splice(1, 1);
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

// Research

export const techDone = (s: SimState, tech: TechId | undefined): boolean => !tech || s.research.done.includes(tech);

// Terrain

export const isLand = (s: SimState, t: number): boolean =>
  s.terrain[t] === TERRAIN.GRASS || s.terrain[t] === TERRAIN.SAND;

/** Structure codes that block movement. */
export const SOLID_CODE: readonly boolean[] = CODE_KIND.map((k) => (k && k !== 'grave' ? BUILDINGS[k].solid : false));
export const isSolidCode = (code: number): boolean => SOLID_CODE[code] === true;
export const kindAt = (s: SimState, t: number): StructureKind | '' => CODE_KIND[s.structKind[t]] ?? '';

/** Can a colonist stand here? Doors, beds, furniture, traps and graves are walkable. */
export const walkable = (s: SimState, t: number): boolean =>
  isLand(s, t) && s.feature[t] !== FEATURE.BOULDER && s.feature[t] !== FEATURE.ORE && !isSolidCode(s.structKind[t]);

export function harvestable(s: SimState, t: number): boolean {
  const f = s.feature[t];
  return f === FEATURE.TREE || f === FEATURE.BOULDER || f === FEATURE.ORE || (f === FEATURE.BUSH && s.regrow[t] <= s.tick);
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
  if (bp && !isFloorKind(bp.kind) && BUILDINGS[bp.kind].solid) return 0;
  const it = itemAt(s, t);
  if (!it) return ITEMS[type].stack;
  return it.type === type ? ITEMS[type].stack - it.count : 0;
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
  for (const n of nearbyTiles(t, 7)) {
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

export function countGroup(s: SimState, group: ItemGroup): number {
  let n = 0;
  for (const it of s.items) if (ITEMS[it.type].group === group) n += it.count;
  return n;
}

/** Total nutrition in store, raw and cooked. A settler eats about 80 a day. */
export function foodSupply(s: SimState): number {
  let n = 0;
  for (const it of s.items) {
    const spec = ITEMS[it.type];
    if (spec.nutrition && (spec.group === 'food' || spec.group === 'meal')) n += spec.nutrition * it.count;
  }
  return n;
}

export function zoneTiles(s: SimState): number[] {
  const out: number[] = [];
  for (let t = 0; t < MAP_N; t++) if (s.zone[t] === ZONE.STOCKPILE) out.push(t);
  return out;
}

export const inStockpile = (s: SimState, t: number): boolean => s.zone[t] === ZONE.STOCKPILE;

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

/** Everything the settlement owns, as a rough number. Bigger raids come for richer settlements. */
export function wealth(s: SimState): number {
  let w = 0;
  for (const it of s.items) w += ITEMS[it.type].value * it.count;
  for (const st of s.structures) if (st.kind !== 'grave') w += BUILDINGS[st.kind].cost * 2;
  for (const p of s.pawns) if (p.kind === 'colonist') w += 60;
  return w;
}

// Structures

export function structureAt(s: SimState, t: number): Structure | undefined {
  const id = s.structGrid[t];
  return id ? s.structures.find((st) => st.id === id) : undefined;
}

export const structureById = (s: SimState, id: number): Structure | undefined => s.structures.find((st) => st.id === id);

export function addStructure(s: SimState, kind: StructureKind, tile: number, ownerId = 0, label = ''): Structure {
  const hp = kind === 'grave' ? 50 : BUILDINGS[kind].hp;
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
    s.structKind[st.tile] = 0;
  }
  s.decon[st.tile] = 0;
  if (st.kind === 'bed') for (const p of s.pawns) if (p.bedId === st.id) p.bedId = 0;
  s.structVersion++;
}

/** Moves pawns and items off a tile that just became solid. */
function clearTileForSolid(s: SimState, tile: number): void {
  s.zone[tile] = 0;
  s.plant[tile] = 0;
  s.growth[tile] = 0;
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

export function floorBlueprintAt(s: SimState, t: number): Blueprint | undefined {
  const id = s.floorBpGrid[t];
  return id ? s.blueprints.find((b) => b.id === id) : undefined;
}

export const blueprintById = (s: SimState, id: number): Blueprint | undefined => s.blueprints.find((b) => b.id === id);

export function addBlueprint(s: SimState, kind: BlueprintKind, tile: number): Blueprint {
  const floor = isFloorKind(kind);
  const bp: Blueprint = { id: s.nextId++, kind, floor, tile, delivered: 0, work: 0 };
  s.blueprints.push(bp);
  if (floor) s.floorBpGrid[tile] = bp.id;
  else s.bpGrid[tile] = bp.id;
  // Trees and rocks in the way are cut down first.
  const f = s.feature[tile];
  if (f === FEATURE.TREE || f === FEATURE.BOULDER || f === FEATURE.ORE) s.designated[tile] = 1;
  s.structVersion++;
  return bp;
}

export function removeBlueprint(s: SimState, bp: Blueprint, refund: boolean): void {
  const i = s.blueprints.indexOf(bp);
  if (i >= 0) s.blueprints.splice(i, 1);
  if (bp.floor) {
    if (s.floorBpGrid[bp.tile] === bp.id) s.floorBpGrid[bp.tile] = 0;
  } else if (s.bpGrid[bp.tile] === bp.id) {
    s.bpGrid[bp.tile] = 0;
  }
  if (refund && bp.delivered > 0) placeItemNear(s, bp.tile, blueprintSpec(bp.kind).material, bp.delivered);
  s.structVersion++;
}

/** Trees and rocks have to be cleared before building; bushes are simply dug up. */
export const buildBlocked = (s: SimState, t: number): boolean => {
  const f = s.feature[t];
  return f === FEATURE.TREE || f === FEATURE.BOULDER || f === FEATURE.ORE;
};

export function completeBlueprint(s: SimState, bp: Blueprint): void {
  removeBlueprint(s, bp, false);
  if (s.feature[bp.tile] === FEATURE.BUSH) {
    s.feature[bp.tile] = FEATURE.NONE;
    s.designated[bp.tile] = 0;
  }
  if (isFloorKind(bp.kind)) {
    s.floor[bp.tile] = FLOOR_CODE[bp.kind];
    s.structVersion++;
    return;
  }
  addStructure(s, bp.kind, bp.tile);
}

// Beauty and rooms

interface BoardCache {
  version: number;
  room: Int32Array;
  beauty: Float32Array;
  rooms: RoomStats[];
}

export interface RoomStats {
  id: number;
  size: number;
  beds: number;
  tables: number;
  beauty: number;
  impressiveness: number;
}

const boardCache = new WeakMap<SimState, BoardCache>();

const IMPRESSIVENESS_LEVELS: ReadonlyArray<readonly [number, string]> = [
  [65, 'extremely impressive'],
  [50, 'very impressive'],
  [38, 'impressive'],
  [28, 'slightly impressive'],
  [18, 'decent'],
  [8, 'dull'],
  [-Infinity, 'awful'],
];

export function impressivenessLabel(value: number): string {
  for (const [min, label] of IMPRESSIVENESS_LEVELS) if (value >= min) return label;
  return 'awful';
}

/** 0 for awful up to 6 for extremely impressive. */
export function impressivenessTier(value: number): number {
  for (let i = 0; i < IMPRESSIVENESS_LEVELS.length; i++) if (value >= IMPRESSIVENESS_LEVELS[i][0]) return 6 - i;
  return 0;
}

function board(s: SimState): BoardCache {
  const cached = boardCache.get(s);
  if (cached && cached.version === s.structVersion) return cached;

  // Beauty: floors and furniture add to their own tile, statues and trees to their surroundings.
  const beauty = new Float32Array(MAP_N);
  for (let t = 0; t < MAP_N; t++) {
    const fl = CODE_FLOOR[s.floor[t]];
    if (fl) beauty[t] += FLOORS[fl].beauty;
    if (s.feature[t] === FEATURE.TREE || s.feature[t] === FEATURE.BUSH) beauty[t] += 0.5;
  }
  for (const st of s.structures) {
    if (st.kind === 'grave') {
      beauty[st.tile] -= 3;
      continue;
    }
    const spec = BUILDINGS[st.kind];
    beauty[st.tile] += spec.beauty;
    if (spec.radius) {
      for (const n of nearbyTiles(st.tile, spec.radius)) beauty[n] += spec.beauty * 0.6;
    }
  }

  // Rooms: areas enclosed by walls, doors or mountains, with at least one built wall or door.
  const room = new Int32Array(MAP_N).fill(-1);
  const seen = new Uint8Array(MAP_N);
  const wallCode = STRUCT_CODE.wall;
  const stoneCode = STRUCT_CODE.stoneWall;
  const doorCode = STRUCT_CODE.door;
  const built = (t: number): boolean => {
    const k = s.structKind[t];
    return k === wallCode || k === stoneCode || k === doorCode;
  };
  const boundary = (t: number): boolean => built(t) || s.terrain[t] === TERRAIN.MOUNTAIN;
  const rooms: RoomStats[] = [];
  const stack: number[] = [];
  const region: number[] = [];
  for (let t0 = 0; t0 < MAP_N; t0++) {
    if (seen[t0] || boundary(t0)) continue;
    region.length = 0;
    let open = false;
    let walled = false;
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
        if (boundary(n)) {
          if (built(n)) walled = true;
          continue;
        }
        if (seen[n]) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (open || !walled || region.length > 200) continue;
    const id = rooms.length;
    let beds = 0;
    let tables = 0;
    let sum = 0;
    for (const t of region) {
      room[t] = id;
      sum += beauty[t];
      const k = kindAt(s, t);
      if (k === 'bed') beds++;
      else if (k === 'table') tables++;
    }
    const perTile = sum / region.length;
    const space = Math.min(30, region.length * 1.1);
    const impressiveness = Math.round(perTile * 14 + space + Math.min(12, (beds + tables) * 2));
    rooms.push({ id, size: region.length, beds, tables, beauty: perTile, impressiveness });
  }

  const cache: BoardCache = { version: s.structVersion, room, beauty, rooms };
  boardCache.set(s, cache);
  return cache;
}

export const roomAt = (s: SimState, t: number): RoomStats | undefined => {
  const b = board(s);
  const id = b.room[t];
  return id >= 0 ? b.rooms[id] : undefined;
};

export const isIndoors = (s: SimState, t: number): boolean => board(s).room[t] >= 0;

/** Average beauty a colonist sees around a tile: the room they are in, or a few tiles outdoors. */
export function envBeauty(s: SimState, t: number): number {
  const b = board(s);
  const r = b.room[t];
  if (r >= 0) return b.rooms[r].beauty;
  let sum = b.beauty[t];
  let n = 1;
  for (const o of nearbyTiles(t, 3)) {
    if (b.room[o] >= 0) continue;
    sum += b.beauty[o];
    n++;
  }
  return sum / n;
}

/** Light sources near a tile: campfires, torches and stoves. */
export function isLit(s: SimState, t: number): boolean {
  for (const st of s.structures) {
    if (st.kind === 'grave') continue;
    const light = BUILDINGS[st.kind].light;
    if (!light) continue;
    const dx = Math.abs(tileX(st.tile) - tileX(t));
    const dy = Math.abs(tileY(st.tile) - tileY(t));
    if (dx <= light && dy <= light) return true;
  }
  return isIndoors(s, t);
}

export const mapCenter = (): number => tileIndex(MAP_W >> 1, MAP_H >> 1);
