/**
 * Static board geometry: the terrain for each season, and the flat overlays for floors,
 * fields and stockpiles. Each is one merged, vertex-coloured mesh rebuilt only when it changes.
 */
import * as THREE from 'three';
import { FEATURE, MAP_H, MAP_N, MAP_W, TERRAIN, ZONE, inBounds, tileIndex, tileX, tileY, type Season, type SimState } from '../sim';
import { hash01 } from '../sim/noise';
import { PALETTE } from './palette';

const HALF_W = MAP_W / 2;
const HALF_H = MAP_H / 2;
export const worldX = (x: number): number => x - HALF_W + 0.5;
export const worldZ = (y: number): number => y - HALF_H + 0.5;

class MeshBuilder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  private readonly color = new THREE.Color();

  /** A flat rectangle at height y, from (x0, z0) to (x1, z1). */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, hex: number, shade = 1): void {
    this.color.setHex(hex).multiplyScalar(shade);
    const { r, g, b } = this.color;
    const v = [x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0];
    for (let i = 0; i < 6; i++) {
      this.pos.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
      this.nor.push(0, 1, 0);
      this.col.push(r, g, b);
    }
  }

  /** A quad from four corners, facing `n`. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3, hex: number, shade: number): void {
    const e1 = new THREE.Vector3().subVectors(b, a);
    const e2 = new THREE.Vector3().subVectors(c, a);
    const flip = e1.cross(e2).dot(n) < 0;
    const order = flip ? [a, d, c, a, c, b] : [a, b, c, a, c, d];
    this.color.setHex(hex).multiplyScalar(shade);
    for (const v of order) {
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(this.color.r, this.color.g, this.color.b);
    }
  }

  geometry(): THREE.BufferGeometry | null {
    if (this.pos.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return geo;
  }
}

interface GroundColors {
  grass: number;
  forest: number;
  sand: number;
  water: readonly number[];
}

function groundColors(season: Season): GroundColors {
  switch (season) {
    case 'summer':
      return { grass: PALETTE.grassSummer, forest: PALETTE.forestFloor, sand: PALETTE.sand, water: PALETTE.water };
    case 'autumn':
      return { grass: PALETTE.grassAutumn, forest: PALETTE.forestAutumn, sand: PALETTE.sand, water: PALETTE.water };
    case 'winter':
      return { grass: PALETTE.snowGround, forest: PALETTE.snowForest, sand: PALETTE.sandWinter, water: PALETTE.ice };
    default:
      return { grass: PALETTE.grass, forest: PALETTE.forestFloor, sand: PALETTE.sand, water: PALETTE.water };
  }
}

/** Land, water and cliffs, coloured for the season. */
export function terrainGeometry(s: SimState, season: Season): THREE.BufferGeometry {
  const m = new MeshBuilder();
  const colors = groundColors(season);
  const BASE = -1.3;
  const height = (t: number): number => (s.terrain[t] === TERRAIN.WATER ? -0.26 : s.terrain[t] === TERRAIN.SAND ? -0.03 : 0);
  const depth = waterDepth(s);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const d = new THREE.Vector3();
  const n = new THREE.Vector3();
  const sides: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let t = 0; t < MAP_N; t++) {
    const x = tileX(t);
    const y = tileY(t);
    const h = height(t);
    const x0 = worldX(x) - 0.5;
    const z0 = worldZ(y) - 0.5;
    const shade = 0.97 + hash01(s.seed + 3, x, y) * 0.06;
    const terrain = s.terrain[t];
    let top: number;
    if (terrain === TERRAIN.WATER) top = colors.water[Math.min(2, depth[t] - 1)];
    else if (terrain === TERRAIN.SAND) top = colors.sand;
    else if (terrain === TERRAIN.MOUNTAIN) top = season === 'winter' ? PALETTE.snow : PALETTE.mountainGround;
    else top = s.feature[t] === FEATURE.TREE ? colors.forest : colors.grass;
    a.set(x0, h, z0);
    b.set(x0, h, z0 + 1);
    c.set(x0 + 1, h, z0 + 1);
    d.set(x0 + 1, h, z0);
    n.set(0, 1, 0);
    m.quad(a, b, c, d, n, top, terrain === TERRAIN.WATER ? 1 : shade);

    for (const [dx, dy] of sides) {
      const inside = inBounds(x + dx, y + dy);
      const nh = inside ? height(tileIndex(x + dx, y + dy)) : BASE;
      if (nh >= h - 0.001) continue;
      const side = terrain === TERRAIN.SAND ? PALETTE.sandSide : terrain === TERRAIN.WATER ? PALETTE.soilDark : PALETTE.soil;
      n.set(dx, 0, dy);
      const ex = dx === 1 ? x0 + 1 : x0;
      const ez = dy === 1 ? z0 + 1 : z0;
      if (dx !== 0) {
        a.set(ex, h, z0);
        b.set(ex, h, z0 + 1);
        c.set(ex, nh, z0 + 1);
        d.set(ex, nh, z0);
      } else {
        a.set(x0, h, ez);
        b.set(x0 + 1, h, ez);
        c.set(x0 + 1, nh, ez);
        d.set(x0, nh, ez);
      }
      m.quad(a, b, c, d, n, inside ? side : PALETTE.soilDark, inside ? 0.92 : 1);
    }
  }
  return m.geometry()!;
}

/** Wooden planks, stone tiles and carpets, and tilled soil under fields. */
export function groundworkGeometry(s: SimState): THREE.BufferGeometry | null {
  const m = new MeshBuilder();
  const y = 0.012;
  for (let t = 0; t < MAP_N; t++) {
    const fl = s.floor[t];
    const zone = s.zone[t];
    if (!fl && zone !== ZONE.POTATO && zone !== ZONE.HEALROOT) continue;
    const x = tileX(t);
    const ty = tileY(t);
    const x0 = worldX(x) - 0.5;
    const z0 = worldZ(ty) - 0.5;
    const shade = 0.96 + hash01(s.seed + 17, x, ty) * 0.08;
    if (fl === 1) {
      // Wood: three planks with dark seams.
      m.flat(x0, z0, x0 + 1, z0 + 1, y, PALETTE.floorWoodDark);
      for (let i = 0; i < 3; i++) {
        const offset = hash01(s.seed + 19 + i, x, ty) * 0.3;
        m.flat(x0 + 0.02, z0 + i / 3 + 0.02, x0 + 0.98, z0 + (i + 1) / 3 - 0.02, y + 0.002, PALETTE.floorWood, shade - offset * 0.1);
      }
    } else if (fl === 2) {
      // Stone: four slabs.
      m.flat(x0, z0, x0 + 1, z0 + 1, y, PALETTE.floorStoneDark);
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          const sh = 0.94 + hash01(s.seed + 23 + i * 2 + j, x, ty) * 0.1;
          m.flat(x0 + i / 2 + 0.03, z0 + j / 2 + 0.03, x0 + (i + 1) / 2 - 0.03, z0 + (j + 1) / 2 - 0.03, y + 0.002, PALETTE.floorStone, sh);
        }
      }
    } else if (fl === 3) {
      // Carpet, with a gold border wherever the carpet ends.
      m.flat(x0, z0, x0 + 1, z0 + 1, y, PALETTE.carpet, shade);
      const edge = (dx: number, dy: number): boolean => !inBounds(x + dx, ty + dy) || s.floor[tileIndex(x + dx, ty + dy)] !== 3;
      const w = 0.08;
      if (edge(-1, 0)) m.flat(x0, z0, x0 + w, z0 + 1, y + 0.003, PALETTE.carpetEdge);
      if (edge(1, 0)) m.flat(x0 + 1 - w, z0, x0 + 1, z0 + 1, y + 0.003, PALETTE.carpetEdge);
      if (edge(0, -1)) m.flat(x0, z0, x0 + 1, z0 + w, y + 0.003, PALETTE.carpetEdge);
      if (edge(0, 1)) m.flat(x0, z0 + 1 - w, x0 + 1, z0 + 1, y + 0.003, PALETTE.carpetEdge);
    } else {
      // Tilled field: soil with two furrows.
      m.flat(x0 + 0.03, z0 + 0.03, x0 + 0.97, z0 + 0.97, y, PALETTE.tilled, shade);
      m.flat(x0 + 0.06, z0 + 0.22, x0 + 0.94, z0 + 0.3, y + 0.002, PALETTE.tilledDark);
      m.flat(x0 + 0.06, z0 + 0.7, x0 + 0.94, z0 + 0.78, y + 0.002, PALETTE.tilledDark);
    }
  }
  return m.geometry();
}

/** Stockpile tiles, drawn as a translucent wash. */
export function stockpileGeometry(s: SimState): THREE.BufferGeometry | null {
  const m = new MeshBuilder();
  for (let t = 0; t < MAP_N; t++) {
    if (s.zone[t] !== ZONE.STOCKPILE) continue;
    const x0 = worldX(tileX(t)) - 0.46;
    const z0 = worldZ(tileY(t)) - 0.46;
    m.flat(x0, z0, x0 + 0.92, z0 + 0.92, 0.02, PALETTE.zone);
  }
  return m.geometry();
}

/** Distance of every water tile from the nearest shore, for shallow-to-deep shading. */
function waterDepth(s: SimState): Int32Array {
  const depth = new Int32Array(MAP_N);
  const queue: number[] = [];
  for (let t = 0; t < MAP_N; t++) {
    if (s.terrain[t] !== TERRAIN.WATER) {
      depth[t] = 0;
      queue.push(t);
    } else {
      depth[t] = -1;
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    const x = tileX(t);
    const y = tileY(t);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (!inBounds(x + dx, y + dy)) continue;
      const n = tileIndex(x + dx, y + dy);
      if (depth[n] !== -1) continue;
      depth[n] = depth[t] + 1;
      queue.push(n);
    }
  }
  for (let t = 0; t < MAP_N; t++) if (depth[t] < 1 && s.terrain[t] === TERRAIN.WATER) depth[t] = 3;
  return depth;
}
