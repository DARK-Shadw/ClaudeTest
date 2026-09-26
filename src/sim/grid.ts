import { MAP_H, MAP_W } from './constants';

export const tileIndex = (x: number, y: number): number => y * MAP_W + x;
export const tileX = (t: number): number => t % MAP_W;
export const tileY = (t: number): number => (t / MAP_W) | 0;
export const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

/** Orthogonal neighbours first, then diagonals. The order is fixed so searches stay deterministic. */
export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Chebyshev distance: the number of king moves between two tiles. */
export function cheb(a: number, b: number): number {
  return Math.max(Math.abs(tileX(a) - tileX(b)), Math.abs(tileY(a) - tileY(b)));
}

export function isEdge(t: number): boolean {
  const x = tileX(t);
  const y = tileY(t);
  return x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Normalises a rectangle and clips it to the map. */
export function clipRect(r: Rect): Rect {
  return {
    x0: Math.max(0, Math.min(r.x0, r.x1)),
    y0: Math.max(0, Math.min(r.y0, r.y1)),
    x1: Math.min(MAP_W - 1, Math.max(r.x0, r.x1)),
    y1: Math.min(MAP_H - 1, Math.max(r.y0, r.y1)),
  };
}

export function rectTiles(r: Rect): number[] {
  const c = clipRect(r);
  const out: number[] = [];
  for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) out.push(tileIndex(x, y));
  return out;
}

export function rectOutline(r: Rect): number[] {
  const c = clipRect(r);
  const out: number[] = [];
  for (let y = c.y0; y <= c.y1; y++) {
    for (let x = c.x0; x <= c.x1; x++) {
      if (x === c.x0 || x === c.x1 || y === c.y0 || y === c.y1) out.push(tileIndex(x, y));
    }
  }
  return out;
}
