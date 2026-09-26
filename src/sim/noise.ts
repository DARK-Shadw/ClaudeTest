/**
 * Hash-based value noise for terrain. It sticks to integer hashing and plain arithmetic
 * (no Math.sin and friends) so every device generates the identical map from a seed.
 */
export function hash01(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number): number => t * t * (3 - 2 * t);

export function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const sx = fade(x - x0);
  const sy = fade(y - y0);
  const a = hash01(seed, x0, y0);
  const b = hash01(seed, x0 + 1, y0);
  const c = hash01(seed, x0, y0 + 1);
  const d = hash01(seed, x0 + 1, y0 + 1);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
}

/** Fractal noise in [0, 1). */
export function fbm(seed: number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(seed + o * 1013, x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
