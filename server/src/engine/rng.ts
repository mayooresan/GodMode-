/**
 * Deterministic PRNG + value-noise helpers.
 *
 * The whole simulation draws from one seeded stream so a given seed always
 * reproduces the same world — important for debugging a divergent run on a VPS
 * where you cannot attach a debugger mid-flight.
 */

/** mulberry32 — small, fast, good enough distribution for a sim. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Approximately normal via sum of uniforms; clamped by callers. */
  normal(mean = 0, sd = 1): number {
    const u = this.next() + this.next() + this.next() + this.next() +
      this.next() + this.next() + this.next() + this.next() + this.next() +
      this.next() + this.next() + this.next();
    return mean + (u - 6) * sd;
  }

  state(): number {
    return this.s;
  }

  restore(s: number): void {
    this.s = s >>> 0;
  }
}

/** Hash-based lattice value noise — no allocation, stable per (seed, x, y). */
function latticeValue(seed: number, x: number, y: number): number {
  let h = seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function valueNoise2D(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const v00 = latticeValue(seed, x0, y0);
  const v10 = latticeValue(seed, x0 + 1, y0);
  const v01 = latticeValue(seed, x0, y0 + 1);
  const v11 = latticeValue(seed, x0 + 1, y0 + 1);
  const top = v00 + (v10 - v00) * fx;
  const bot = v01 + (v11 - v01) * fx;
  return top + (bot - top) * fy;
}

/** Fractal Brownian motion over value noise; returns roughly 0..1. */
export function fbm(
  seed: number,
  x: number,
  y: number,
  octaves = 5,
  lacunarity = 2,
  gain = 0.5,
): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2D(seed + o * 7919, x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
