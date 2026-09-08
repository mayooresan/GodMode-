/** Terrain sanity check across seeds: `npx tsx src/terrain-check.ts`. */
import { generateWorld } from './engine/world.js';

const names = ['DeepWater', 'Shallow', 'Plains', 'Forest', 'Hills', 'Mountain', 'Desert'];
for (const seed of [20260908, 7, 123456, 99999, 4242]) {
  const w = generateWorld(128, 128, seed);
  const c = new Array(7).fill(0);
  for (const v of w.biome) c[v]++;
  const pct = (i: number) => `${((c[i] / w.size) * 100).toFixed(1)}%`;
  console.log(
    `seed ${String(seed).padStart(9)} | ` +
      names.map((n, i) => `${n} ${pct(i).padStart(6)}`).join('  '),
  );
}
