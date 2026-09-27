/**
 * Player orders. Every action a player takes is a small serialisable command, so the same
 * order can be applied on a phone and on the server and both stay in step.
 */
import { orderAttack, orderMove, setDrafted } from './ai';
import { FEATURE, TERRAIN, ZONE } from './constants';
import { CRAFT_ORDER, CROPS, FLOOR_CODE, TECHS, blueprintSpec, isFloorKind } from './defs';
import { clipRect, inBounds, rectOutline, rectTiles, tileIndex, type Rect } from './grid';
import { enterCost } from './path';
import type { BlueprintKind, BuildKind, CraftItem, Pawn, Role, SimState, TechId } from './types';
import {
  addBlueprint,
  blueprintAt,
  floorBlueprintAt,
  isLand,
  isSolidCode,
  pawnById,
  removeBlueprint,
  techDone,
} from './world';

export type ZoneKind = 'stockpile' | 'potato' | 'healroot';
export type WallKind = 'wall' | 'stoneWall';

export type Command =
  | ({ t: 'harvest' } & Rect)
  | ({ t: 'build'; kind: BlueprintKind } & Rect)
  | ({ t: 'room'; wall: WallKind } & Rect)
  | ({ t: 'zone'; zone: ZoneKind } & Rect)
  | ({ t: 'clear' } & Rect)
  | ({ t: 'demolish' } & Rect)
  | { t: 'rally'; tile: number }
  | { t: 'role'; pawnId: number; role: Role }
  | { t: 'draft'; ids: number[]; on: boolean }
  | { t: 'move'; ids: number[]; tile: number }
  | { t: 'attack'; ids: number[]; targetId: number }
  | { t: 'hunt'; animalId: number; on: boolean }
  | { t: 'research'; tech: TechId | '' }
  | { t: 'order'; item: CraftItem; count: number };

export type PlacementAction = 'blueprint' | 'designate' | 'zone' | 'clear' | 'demolish';

export interface Placement {
  tile: number;
  ok: boolean;
  action: PlacementAction;
  kind?: BlueprintKind;
}

export const ZONE_CODE: Record<ZoneKind, number> = { stockpile: ZONE.STOCKPILE, potato: ZONE.POTATO, healroot: ZONE.HEALROOT };
export const ZONE_TECH: Record<ZoneKind, TechId | undefined> = { stockpile: undefined, potato: CROPS.potato.tech, healroot: CROPS.healroot.tech };

/** Walls are drawn as outlines; floors, traps and barricades fill an area; everything else is one tile. */
const OUTLINE_KINDS: ReadonlySet<BlueprintKind> = new Set<BlueprintKind>(['wall', 'stoneWall']);
const AREA_KINDS: ReadonlySet<BlueprintKind> = new Set<BlueprintKind>(['trap', 'barricade', 'woodFloor', 'stoneFloor', 'carpet']);

export const isAreaBuild = (kind: BlueprintKind): boolean => OUTLINE_KINDS.has(kind) || AREA_KINDS.has(kind);
export const isOutlineBuild = (kind: BlueprintKind): boolean => OUTLINE_KINDS.has(kind);

/** Why a blueprint cannot go on a tile, or '' when it can. */
export function placeProblem(s: SimState, t: number, kind: BlueprintKind): string {
  if (!isLand(s, t)) return 'Only on open ground';
  if (!techDone(s, blueprintSpec(kind).tech)) return `Needs ${TECHS[blueprintSpec(kind).tech!].label} research`;
  if (isFloorKind(kind)) {
    if (isSolidCode(s.structKind[t])) return 'Not under a wall';
    if (s.floor[t] === FLOOR_CODE[kind]) return 'Already built';
    const fb = floorBlueprintAt(s, t);
    if (fb && fb.kind === kind) return 'Already planned';
    return '';
  }
  if (s.structGrid[t]) return 'Something is already built there';
  const bp = blueprintAt(s, t);
  if (bp && !(kind === 'door' && (bp.kind === 'wall' || bp.kind === 'stoneWall'))) return 'Something is already planned there';
  return '';
}

const canPlace = (s: SimState, t: number, kind: BlueprintKind): boolean => placeProblem(s, t, kind) === '';

function zoneOk(s: SimState, t: number, zone: ZoneKind): boolean {
  if (!isLand(s, t) || isSolidCode(s.structKind[t]) || !techDone(s, ZONE_TECH[zone])) return false;
  const f = s.feature[t];
  if (zone === 'stockpile') return f !== FEATURE.BOULDER && f !== FEATURE.ORE;
  return f === FEATURE.NONE && (s.terrain[t] === TERRAIN.GRASS || s.terrain[t] === TERRAIN.SAND);
}

/** What a command would do, tile by tile. The UI previews exactly this before it is applied. */
export function planCommand(s: SimState, cmd: Command): Placement[] {
  switch (cmd.t) {
    case 'harvest':
      return rectTiles(cmd)
        .filter((t) => s.feature[t] !== FEATURE.NONE)
        .map((tile) => ({ tile, ok: true, action: 'designate' }));
    case 'build': {
      let tiles: number[];
      if (OUTLINE_KINDS.has(cmd.kind)) tiles = rectOutline(cmd);
      else if (AREA_KINDS.has(cmd.kind)) tiles = rectTiles(cmd);
      else tiles = inBounds(cmd.x1, cmd.y1) ? [tileIndex(cmd.x1, cmd.y1)] : [];
      return tiles.map((tile) => ({ tile, ok: canPlace(s, tile, cmd.kind), action: 'blueprint', kind: cmd.kind }));
    }
    case 'room': {
      const r = clipRect(cmd);
      const bigEnough = r.x1 - r.x0 >= 2 && r.y1 - r.y0 >= 2;
      // The door goes in the middle of the side facing the camera.
      const door = tileIndex((r.x0 + r.x1) >> 1, r.y1);
      return rectOutline(r).map((tile) => {
        const kind: BuildKind = tile === door ? 'door' : cmd.wall;
        return { tile, ok: bigEnough && canPlace(s, tile, kind), action: 'blueprint', kind };
      });
    }
    case 'zone':
      return rectTiles(cmd).map((tile) => ({ tile, ok: zoneOk(s, tile, cmd.zone), action: 'zone' }));
    case 'clear':
      return rectTiles(cmd)
        .filter((t) => s.bpGrid[t] || s.floorBpGrid[t] || s.designated[t] || s.zone[t] || s.decon[t] || s.rally === t)
        .map((tile) => ({ tile, ok: true, action: 'clear' }));
    case 'demolish':
      return rectTiles(cmd)
        .filter((t) => s.structGrid[t] || s.floor[t])
        .map((tile) => ({ tile, ok: true, action: 'demolish' }));
    default:
      return [];
  }
}

const pawnsOf = (s: SimState, ids: readonly number[]): Pawn[] =>
  ids.map((id) => pawnById(s, id)).filter((p): p is Pawn => !!p && p.kind === 'colonist');

export function applyCommand(s: SimState, cmd: Command): void {
  switch (cmd.t) {
    case 'harvest':
      for (const p of planCommand(s, cmd)) s.designated[p.tile] = 1;
      break;
    case 'build':
    case 'room':
      for (const p of planCommand(s, cmd)) {
        if (!p.ok || !p.kind) continue;
        const existing = isFloorKind(p.kind) ? floorBlueprintAt(s, p.tile) : blueprintAt(s, p.tile);
        if (existing) removeBlueprint(s, existing, true);
        addBlueprint(s, p.kind, p.tile);
      }
      break;
    case 'zone': {
      const code = ZONE_CODE[cmd.zone];
      for (const p of planCommand(s, cmd)) if (p.ok) s.zone[p.tile] = code;
      break;
    }
    case 'clear':
      for (const { tile } of planCommand(s, cmd)) {
        const bp = blueprintAt(s, tile);
        if (bp) removeBlueprint(s, bp, true);
        const fb = floorBlueprintAt(s, tile);
        if (fb) removeBlueprint(s, fb, true);
        s.designated[tile] = 0;
        s.zone[tile] = 0;
        s.decon[tile] = 0;
        if (s.rally === tile) s.rally = -1;
      }
      break;
    case 'demolish':
      for (const { tile } of planCommand(s, cmd)) {
        if (s.structGrid[tile]) s.decon[tile] = 1;
        // Floors come up at once, with nothing to salvage.
        else s.floor[tile] = 0;
      }
      break;
    case 'rally':
      if (cmd.tile < 0 || cmd.tile === s.rally) s.rally = -1;
      else if (enterCost(s, cmd.tile, false) >= 0) s.rally = cmd.tile;
      break;
    case 'role': {
      const p = pawnById(s, cmd.pawnId);
      if (p && p.kind === 'colonist') p.role = cmd.role;
      return;
    }
    case 'draft':
      for (const p of pawnsOf(s, cmd.ids)) setDrafted(s, p, cmd.on);
      return;
    case 'move':
      orderMove(s, pawnsOf(s, cmd.ids), cmd.tile);
      return;
    case 'attack': {
      const target = pawnById(s, cmd.targetId);
      if (target) orderAttack(s, pawnsOf(s, cmd.ids), target);
      return;
    }
    case 'hunt': {
      const a = pawnById(s, cmd.animalId);
      if (a && a.kind === 'animal' && !a.hostile) a.marked = cmd.on;
      return;
    }
    case 'research': {
      const tech = cmd.tech;
      if (tech === '' || canResearch(s, tech)) s.research.current = tech;
      return;
    }
    case 'order':
      if (CRAFT_ORDER.includes(cmd.item)) s.orders[cmd.item] = Math.max(0, Math.min(20, Math.round(cmd.count)));
      return;
  }
  s.structVersion++;
}

/** Not yet known, and anything it builds on is. */
export function canResearch(s: SimState, tech: TechId): boolean {
  if (s.research.done.includes(tech)) return false;
  const req = TECHS[tech].requires;
  return !req || s.research.done.includes(req);
}
