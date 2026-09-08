import { Biome, BIOME_PROFILE } from './types.js';
import { Rng, fbm } from './rng.js';

/**
 * The tile grid.
 *
 * Every per-tile field is a flat typed array indexed by `y * width + x`. This
 * keeps a 128x128 world under ~1 MB and makes the per-tick regeneration sweep a
 * linear scan over contiguous memory.
 */
export class World {
  readonly width: number;
  readonly height: number;
  readonly size: number;

  readonly biome: Uint8Array;
  readonly elevation: Float32Array;
  readonly moisture: Float32Array;

  readonly food: Float32Array;
  readonly water: Float32Array;
  readonly wood: Float32Array;
  readonly stone: Float32Array;

  readonly foodCap: Float32Array;
  readonly waterCap: Float32Array;
  readonly woodCap: Float32Array;
  readonly stoneCap: Float32Array;

  readonly carrying: Uint16Array;
  /** Owning tribe id, or -1 for unclaimed. */
  readonly owner: Int16Array;
  /** 0 = wild, 1..3 = cultivated plot level. */
  readonly cultivated: Uint8Array;
  /** 0 = open ground, 1 = windbreak, 2 = hut, 3 = hut + palisade. */
  readonly shelter: Uint8Array;
  /** Remaining ticks of a divine blessing / curse on this tile. */
  readonly blessed: Int16Array;
  readonly cursed: Int16Array;

  /** Tiles whose renderable state changed since the last frame flush. */
  readonly dirty = new Set<number>();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    const n = this.size;
    this.biome = new Uint8Array(n);
    this.elevation = new Float32Array(n);
    this.moisture = new Float32Array(n);
    this.food = new Float32Array(n);
    this.water = new Float32Array(n);
    this.wood = new Float32Array(n);
    this.stone = new Float32Array(n);
    this.foodCap = new Float32Array(n);
    this.waterCap = new Float32Array(n);
    this.woodCap = new Float32Array(n);
    this.stoneCap = new Float32Array(n);
    this.carrying = new Uint16Array(n);
    this.owner = new Int16Array(n).fill(-1);
    this.cultivated = new Uint8Array(n);
    this.shelter = new Uint8Array(n);
    this.blessed = new Int16Array(n);
    this.cursed = new Int16Array(n);
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Wraps out-of-range coordinates back into the grid (toroidal clamp). */
  clampX(x: number): number {
    return x < 0 ? 0 : x >= this.width ? this.width - 1 : x;
  }

  clampY(y: number): number {
    return y < 0 ? 0 : y >= this.height ? this.height - 1 : y;
  }

  isPassable(i: number): boolean {
    return BIOME_PROFILE[this.biome[i]].passable;
  }

  isWater(i: number): boolean {
    return this.biome[i] === Biome.DeepWater || this.biome[i] === Biome.ShallowWater;
  }

  markDirty(i: number): void {
    this.dirty.add(i);
  }

  /** Recompute a tile's capacities from its biome, cultivation and shelter. */
  refreshCaps(i: number): void {
    const p = BIOME_PROFILE[this.biome[i]];
    const cultBonus = 1 + this.cultivated[i] * 0.85;
    const moist = 0.7 + this.moisture[i] * 0.6;
    this.foodCap[i] = p.food * cultBonus * moist;
    this.waterCap[i] = p.water;
    this.woodCap[i] = p.wood;
    this.stoneCap[i] = p.stone;
    this.carrying[i] = Math.min(
      65535,
      Math.round(p.carrying + this.shelter[i] * 6 + this.cultivated[i] * 3),
    );
  }

  /** Reset a tile's live stocks to full capacity. */
  fill(i: number): void {
    this.food[i] = this.foodCap[i];
    this.water[i] = this.waterCap[i];
    this.wood[i] = this.woodCap[i];
    this.stone[i] = this.stoneCap[i];
  }

  setBiome(i: number, b: number): void {
    this.biome[i] = b;
    this.refreshCaps(i);
    this.food[i] = Math.min(this.food[i], this.foodCap[i]);
    this.water[i] = Math.min(this.water[i], this.waterCap[i]);
    this.wood[i] = Math.min(this.wood[i], this.woodCap[i]);
    this.stone[i] = Math.min(this.stone[i], this.stoneCap[i]);
    this.markDirty(i);
  }

  /**
   * Per-tick resource regeneration.
   *
   * `seasonal` scales plant growth (winter suppresses forage); blessings and
   * curses are decremented here so they expire without a separate sweep.
   */
  regenerate(seasonal: number): void {
    const { size, biome, food, water, wood, stone } = this;
    for (let i = 0; i < size; i++) {
      const p = BIOME_PROFILE[biome[i]];
      let rate = p.regen;
      const b = this.blessed[i];
      const c = this.cursed[i];
      if (b > 0) {
        rate *= 8;
        this.blessed[i] = b - 1;
        if (this.blessed[i] === 0) this.markDirty(i);
      }
      if (c > 0) {
        rate *= 0.05;
        this.cursed[i] = c - 1;
        if (this.cursed[i] === 0) this.markDirty(i);
      }

      const fCap = this.foodCap[i] * (c > 0 ? 0.25 : 1);
      const growth = rate * seasonal;
      if (food[i] < fCap) food[i] = Math.min(fCap, food[i] + fCap * growth + 0.05);
      else if (food[i] > fCap) food[i] = Math.max(fCap, food[i] - 0.5);

      if (water[i] < this.waterCap[i]) {
        water[i] = Math.min(this.waterCap[i], water[i] + this.waterCap[i] * rate * 3 + 0.2);
      }
      if (wood[i] < this.woodCap[i]) {
        wood[i] = Math.min(this.woodCap[i], wood[i] + this.woodCap[i] * rate * 0.5);
      }
      if (stone[i] < this.stoneCap[i]) {
        stone[i] = Math.min(this.stoneCap[i], stone[i] + this.stoneCap[i] * rate * 0.2);
      }
    }
  }

  /**
   * Renderable byte for a tile: biome in the low 3 bits, plus flags the map
   * shades differently (cultivated / shelter / blessed / cursed).
   */
  renderByte(i: number): number {
    let v = this.biome[i] & 0b111;
    if (this.cultivated[i] > 0) v |= 0b1000;
    if (this.shelter[i] > 0) v |= 0b10000;
    if (this.blessed[i] > 0) v |= 0b100000;
    if (this.cursed[i] > 0) v |= 0b1000000;
    return v;
  }
}

/**
 * Procedurally generate elevation, moisture, biomes and a river network.
 *
 * Continents come from two fBm fields multiplied by a radial falloff so the map
 * edges are ocean; rivers are carved by walking downhill from wet highlands,
 * which produces branching systems that reliably reach the sea.
 */
export function generateWorld(width: number, height: number, seed: number): World {
  const world = new World(width, height);
  const rng = new Rng(seed);
  const eSeed = seed ^ 0x9e3779b9;
  const mSeed = seed ^ 0x85ebca6b;

  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.hypot(cx, cy);
  const scale = 6 / Math.max(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = world.idx(x, y);
      const base = fbm(eSeed, x * scale, y * scale, 6);
      const ridge = Math.abs(fbm(eSeed + 1013, x * scale * 2.2, y * scale * 2.2, 4) - 0.5) * 2;
      const dist = Math.hypot(x - cx, y - cy) / maxR;
      // Radial falloff pushes the borders under water, leaving an island world.
      const falloff = 1 - Math.pow(Math.min(1, dist * 1.18), 2.6);
      const e = Math.max(0, base * 0.75 + ridge * 0.25) * falloff;
      world.elevation[i] = e;
      world.moisture[i] = fbm(mSeed, x * scale * 1.6, y * scale * 1.6, 4);
    }
  }

  // Classify biomes by *quantile*, not by absolute thresholds.
  //
  // fBm output is roughly Gaussian around 0.5 and the radial falloff drags it
  // lower still, so fixed cut-offs produced worlds with no hills or mountains
  // at all — and therefore no stone for toolmaking. Ranking the tiles instead
  // guarantees every seed yields a full spread of terrain.
  const sortedE = Float32Array.from(world.elevation).sort();
  const sortedM = Float32Array.from(world.moisture).sort();
  const qe = (p: number) => sortedE[Math.min(sortedE.length - 1, Math.floor(p * sortedE.length))];
  const qm = (p: number) => sortedM[Math.min(sortedM.length - 1, Math.floor(p * sortedM.length))];

  const seaLevel = qe(0.40);
  const shoreLevel = qe(0.47);
  const hillLevel = qe(0.80);
  const mountainLevel = qe(0.93);
  const dryLevel = qm(0.24);
  const wetLevel = qm(0.60);

  for (let i = 0; i < world.size; i++) {
    const e = world.elevation[i];
    const m = world.moisture[i];
    let b: number;
    if (e < seaLevel) b = Biome.DeepWater;
    else if (e < shoreLevel) b = Biome.ShallowWater;
    else if (e > mountainLevel) b = Biome.Mountain;
    else if (e > hillLevel) b = Biome.Hills;
    else if (m < dryLevel) b = Biome.Desert;
    else if (m > wetLevel) b = Biome.Forest;
    else b = Biome.Plains;
    world.biome[i] = b;
  }

  const eMin = sortedE[0];
  const eMax = sortedE[sortedE.length - 1];
  const span = Math.max(1e-6, eMax - eMin);
  for (let i = 0; i < world.size; i++) {
    world.elevation[i] = (world.elevation[i] - eMin) / span;
  }

  carveRivers(world, rng);

  for (let i = 0; i < world.size; i++) {
    world.refreshCaps(i);
    world.fill(i);
  }
  return world;
}

/** Walk downhill from wet high ground, converting the path to shallow water. */
function carveRivers(world: World, rng: Rng): void {
  const sources: number[] = [];
  for (let i = 0; i < world.size; i++) {
    if (world.elevation[i] > 0.72 && world.moisture[i] > 0.45) sources.push(i);
  }
  const riverCount = Math.max(4, Math.floor(world.size / 900));

  for (let r = 0; r < riverCount && sources.length > 0; r++) {
    let i = sources[rng.int(0, sources.length - 1)];
    let guard = 0;
    while (guard++ < world.width * 2) {
      const x = i % world.width;
      const y = (i / world.width) | 0;
      if (world.biome[i] === Biome.DeepWater) break;
      world.biome[i] = Biome.ShallowWater;
      // Widen occasionally so rivers read clearly on a 1px-per-tile map.
      if (rng.chance(0.35)) {
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (world.inBounds(nx, ny)) {
            const ni = world.idx(nx, ny);
            if (world.biome[ni] !== Biome.DeepWater) world.biome[ni] = Biome.ShallowWater;
          }
        }
      }

      let best = -1;
      let bestE = world.elevation[i];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (!world.inBounds(nx, ny)) continue;
          const ni = world.idx(nx, ny);
          const e = world.elevation[ni] + rng.range(-0.006, 0.006);
          if (e < bestE) {
            bestE = e;
            best = ni;
          }
        }
      }
      // Local minimum: nudge toward the map edge so the river still drains.
      if (best < 0) {
        const nx = world.clampX(x + (x < world.width / 2 ? -1 : 1));
        const ny = world.clampY(y + (y < world.height / 2 ? -1 : 1));
        const ni = world.idx(nx, ny);
        if (ni === i) break;
        best = ni;
      }
      i = best;
    }
  }
}
