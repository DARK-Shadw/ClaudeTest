/** Procedural generation of one region: lakes, beaches, meadows, forests, rocky ridges and iron veins. */
import { FEATURE, MAP_H, MAP_N, MAP_W, TERRAIN } from './constants';
import { DIRS, cheb, inBounds, isEdge, tileIndex, tileX, tileY } from './grid';
import { fbm, hash01 } from './noise';

export interface GeneratedMap {
  terrain: number[];
  feature: number[];
  home: number;
}

const CLEAR_RADIUS = 4;

export function generateMap(seed: number): GeneratedMap {
  const elev: number[] = new Array(MAP_N);
  const moist: number[] = new Array(MAP_N);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const t = tileIndex(x, y);
      elev[t] = fbm(seed, x / 13, y / 13, 4);
      moist[t] = fbm(seed ^ 0x5bd1e995, x / 9, y / 9, 3);
    }
  }

  // Percentile thresholds keep every map a similar mix of water, beach and mountain.
  const sorted = [...elev].sort((a, b) => a - b);
  const waterLine = sorted[Math.floor(MAP_N * 0.1)];
  const sandLine = sorted[Math.floor(MAP_N * 0.15)];
  const peakLine = sorted[Math.floor(MAP_N * 0.93)];
  const terrain = elev.map((e) => {
    if (e <= waterLine) return TERRAIN.WATER;
    if (e <= sandLine) return TERRAIN.SAND;
    if (e >= peakLine) return TERRAIN.MOUNTAIN;
    return TERRAIN.GRASS;
  });

  const home = findHome(terrain);

  const nearMountain = (t: number): boolean => {
    const x = tileX(t);
    const y = tileY(t);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (inBounds(x + dx, y + dy) && terrain[tileIndex(x + dx, y + dy)] === TERRAIN.MOUNTAIN) return true;
      }
    }
    return false;
  };

  const feature: number[] = new Array(MAP_N).fill(FEATURE.NONE);
  for (let t = 0; t < MAP_N; t++) {
    const x = tileX(t);
    const y = tileY(t);
    if (terrain[t] === TERRAIN.SAND) {
      if (hash01(seed + 41, x, y) < 0.04) feature[t] = FEATURE.BOULDER;
      continue;
    }
    if (terrain[t] !== TERRAIN.GRASS) continue;
    const m = moist[t];
    const forest = Math.max(0, Math.min(0.8, (m - 0.5) * 2.4));
    const r = hash01(seed + 17, x, y);
    if (r < forest + 0.03) {
      feature[t] = FEATURE.TREE;
    } else if (hash01(seed + 29, x, y) < (m > 0.42 && m < 0.62 ? 0.08 : 0.03)) {
      feature[t] = FEATURE.BUSH;
    } else if (hash01(seed + 41, x, y) < (nearMountain(t) ? 0.2 : 0.012)) {
      // Veins of iron show up among the rocks at the foot of the mountains.
      feature[t] = nearMountain(t) && hash01(seed + 43, x, y) < 0.35 ? FEATURE.ORE : FEATURE.BOULDER;
    }
  }

  for (let t = 0; t < MAP_N; t++) if (cheb(t, home) <= CLEAR_RADIUS) feature[t] = FEATURE.NONE;
  ensureNearby(seed + 53, terrain, feature, home, FEATURE.BUSH, 10, 11);
  ensureNearby(seed + 59, terrain, feature, home, FEATURE.TREE, 16, 10);
  ensureNearby(seed + 61, terrain, feature, home, FEATURE.BOULDER, 4, 12);
  ensureNearby(seed + 67, terrain, feature, home, FEATURE.ORE, 3, 22);
  connectToEdge(terrain, feature, home);

  return { terrain, feature, home };
}

/** The land tile closest to the centre with open ground all around it. */
function findHome(terrain: number[]): number {
  const cx = MAP_W >> 1;
  const cy = MAP_H >> 1;
  const byDistance: number[] = [];
  for (let t = 0; t < MAP_N; t++) byDistance.push(t);
  const d2 = (t: number): number => (tileX(t) - cx) ** 2 + (tileY(t) - cy) ** 2;
  byDistance.sort((a, b) => d2(a) - d2(b) || a - b);
  const isOpenLand = (t: number): boolean => terrain[t] === TERRAIN.GRASS || terrain[t] === TERRAIN.SAND;
  for (const radius of [CLEAR_RADIUS, 3, 2]) {
    for (const t of byDistance) {
      const x = tileX(t);
      const y = tileY(t);
      if (x - radius < 1 || y - radius < 1 || x + radius > MAP_W - 2 || y + radius > MAP_H - 2) continue;
      let ok = true;
      for (let dy = -radius; dy <= radius && ok; dy++) {
        for (let dx = -radius; dx <= radius && ok; dx++) ok = isOpenLand(tileIndex(x + dx, y + dy));
      }
      if (ok) return t;
    }
  }
  const center = tileIndex(cx, cy);
  for (let t = 0; t < MAP_N; t++) if (cheb(t, center) <= CLEAR_RADIUS) terrain[t] = TERRAIN.GRASS;
  return center;
}

/** Guarantees a starting settlement has some food, wood or stone within walking distance. */
function ensureNearby(
  seed: number,
  terrain: number[],
  feature: number[],
  home: number,
  kind: number,
  want: number,
  radius: number,
): void {
  const candidates: number[] = [];
  let have = 0;
  for (let t = 0; t < MAP_N; t++) {
    const d = cheb(t, home);
    if (d > radius) continue;
    if (feature[t] === kind) have++;
    else if (d > CLEAR_RADIUS + 1 && feature[t] === FEATURE.NONE && terrain[t] === TERRAIN.GRASS) candidates.push(t);
  }
  const order = (t: number): number => hash01(seed, tileX(t), tileY(t));
  candidates.sort((a, b) => order(a) - order(b) || a - b);
  for (let i = 0; have < want && i < candidates.length; i++, have++) feature[candidates[i]] = kind;
}

/** Makes sure raiders and wanderers can reach the settlement from the map edge. */
function connectToEdge(terrain: number[], feature: number[], home: number): void {
  const passable = (t: number): boolean =>
    (terrain[t] === TERRAIN.GRASS || terrain[t] === TERRAIN.SAND) && feature[t] !== FEATURE.BOULDER;
  const seen = new Uint8Array(MAP_N);
  const queue = [home];
  seen[home] = 1;
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    if (isEdge(t)) return;
    for (const [dx, dy] of DIRS.slice(0, 4)) {
      const nx = tileX(t) + dx;
      const ny = tileY(t) + dy;
      if (!inBounds(nx, ny)) continue;
      const n = tileIndex(nx, ny);
      if (!seen[n] && passable(n)) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  // Walled in by water or rock: carve a trail straight south.
  for (let y = tileY(home); y < MAP_H; y++) {
    const t = tileIndex(tileX(home), y);
    if (!passable(t)) {
      terrain[t] = TERRAIN.GRASS;
      feature[t] = FEATURE.NONE;
    }
  }
}
