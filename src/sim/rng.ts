/**
 * sfc32, a small fast PRNG. Its state lives inside SimState, so a saved game or a replay
 * continues with exactly the same random numbers on every device.
 */
export type RngState = [number, number, number, number];

export function seedRng(seed: number): RngState {
  let s = seed | 0;
  const split = (): number => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) | 0;
  };
  const r: RngState = [split(), split(), split(), split()];
  for (let i = 0; i < 12; i++) nextU32(r);
  return r;
}

export function nextU32(r: RngState): number {
  let a = r[0];
  let b = r[1];
  let c = r[2];
  let d = r[3];
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  r[0] = a;
  r[1] = b;
  r[2] = c;
  r[3] = d;
  return t >>> 0;
}

/** Uniform float in [0, 1). */
export const random = (r: RngState): number => nextU32(r) / 4294967296;

/** Uniform integer in [min, max], both inclusive. */
export const randInt = (r: RngState, min: number, max: number): number => min + Math.floor(random(r) * (max - min + 1));

export const chance = (r: RngState, p: number): boolean => random(r) < p;

export function pick<T>(r: RngState, list: readonly T[]): T {
  return list[randInt(r, 0, list.length - 1)];
}
