/**
 * Player orders. Every action a player takes is a small serialisable command, so the same
 * order can be applied on a phone and on the server and both stay in step.
 */
import { FEATURE } from './constants';
import { clipRect, inBounds, rectOutline, rectTiles, tileIndex, type Rect } from './grid';
import { enterCost } from './path';
import type { BuildKind, Role, SimState } from './types';
import { addBlueprint, blueprintAt, isLand, isSolidCode, pawnById, removeBlueprint } from './world';

export type Command =
  | ({ t: 'harvest' } & Rect)
  | ({ t: 'build'; kind: BuildKind } & Rect)
  | ({ t: 'room' } & Rect)
  | ({ t: 'zone' } & Rect)
  | ({ t: 'clear' } & Rect)
  | ({ t: 'demolish' } & Rect)
  | { t: 'rally'; tile: number }
  | { t: 'role'; pawnId: number; role: Role };

export type PlacementAction = 'blueprint' | 'designate' | 'zone' | 'clear' | 'demolish';

export interface Placement {
  tile: number;
  ok: boolean;
  action: PlacementAction;
  kind?: BuildKind;
}

/** Walls are drawn as outlines; traps fill an area; everything else is a single tile. */
const OUTLINE_KINDS: ReadonlySet<BuildKind> = new Set<BuildKind>(['wall', 'stoneWall']);
const AREA_KINDS: ReadonlySet<BuildKind> = new Set<BuildKind>(['trap']);

export const isAreaBuild = (kind: BuildKind): boolean => OUTLINE_KINDS.has(kind) || AREA_KINDS.has(kind);

function canPlace(s: SimState, t: number, kind: BuildKind): boolean {
  if (!isLand(s, t) || s.structGrid[t]) return false;
  const bp = blueprintAt(s, t);
  if (bp) return kind === 'door' && (bp.kind === 'wall' || bp.kind === 'stoneWall');
  return true;
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
        const kind: BuildKind = tile === door ? 'door' : 'wall';
        return { tile, ok: bigEnough && canPlace(s, tile, kind), action: 'blueprint', kind };
      });
    }
    case 'zone':
      return rectTiles(cmd).map((tile) => ({
        tile,
        ok: isLand(s, tile) && !isSolidCode(s.structKind[tile]) && s.feature[tile] !== FEATURE.BOULDER,
        action: 'zone',
      }));
    case 'clear':
      return rectTiles(cmd)
        .filter((t) => s.bpGrid[t] || s.designated[t] || s.zone[t] || s.decon[t] || s.rally === t)
        .map((tile) => ({ tile, ok: true, action: 'clear' }));
    case 'demolish':
      return rectTiles(cmd)
        .filter((t) => s.structGrid[t])
        .map((tile) => ({ tile, ok: true, action: 'demolish' }));
    default:
      return [];
  }
}

export function applyCommand(s: SimState, cmd: Command): void {
  switch (cmd.t) {
    case 'harvest':
      for (const p of planCommand(s, cmd)) s.designated[p.tile] = 1;
      break;
    case 'build':
    case 'room':
      for (const p of planCommand(s, cmd)) {
        if (!p.ok || !p.kind) continue;
        const existing = blueprintAt(s, p.tile);
        if (existing) removeBlueprint(s, existing, true);
        addBlueprint(s, p.kind, p.tile);
      }
      break;
    case 'zone':
      for (const p of planCommand(s, cmd)) if (p.ok) s.zone[p.tile] = 1;
      break;
    case 'clear':
      for (const { tile } of planCommand(s, cmd)) {
        const bp = blueprintAt(s, tile);
        if (bp) removeBlueprint(s, bp, true);
        s.designated[tile] = 0;
        s.zone[tile] = 0;
        s.decon[tile] = 0;
        if (s.rally === tile) s.rally = -1;
      }
      break;
    case 'demolish':
      for (const { tile } of planCommand(s, cmd)) s.decon[tile] = 1;
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
  }
  s.structVersion++;
}
