/**
 * Headless throughput benchmark: `npm run bench -- 2000`.
 *
 * Runs the engine with no server or clients attached and reports tick cost plus
 * the state of the world at the end — the quickest way to sanity-check a
 * balance change or to size a droplet before deploying.
 */
import { Simulation } from './engine/simulation.js';
import { config } from './config.js';

const ticks = Number(process.argv[2] ?? 1000);

const sim = new Simulation({
  width: config.width,
  height: config.height,
  seed: config.seed,
  startingTribes: config.startingTribes,
  startingAgentsPerTribe: config.startingAgentsPerTribe,
  maxAgents: config.maxAgents,
  eventLogSize: config.eventLogSize,
});
sim.seed();

const t0 = process.hrtime.bigint();
for (let i = 0; i < ticks; i++) sim.step();
const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

const v = sim.vitals();
console.log(`ticks:        ${ticks}`);
console.log(`elapsed:      ${elapsedMs.toFixed(0)} ms`);
console.log(`per tick:     ${(elapsedMs / ticks).toFixed(3)} ms`);
console.log(`throughput:   ${(ticks / (elapsedMs / 1000)).toFixed(0)} ticks/s`);
console.log(`heap:         ${(process.memoryUsage().heapUsed / 1e6).toFixed(1)} MB`);
console.log('---');
console.log(`year ${v.year}, ${v.season}, ${v.temperature}°`);
console.log(`population:   ${v.population} (${v.infants} infants / ${v.adults} adults / ${v.elders} elders)`);
console.log(`tribes:       ${v.tribes}, claimed tiles: ${v.claimedTiles}`);
for (const t of sim.tribeSummaries()) {
  console.log(`  ${t.glyph} ${t.name}: pop ${t.population}, food ${t.food}, land ${t.territory}, techs [${t.techs.join(', ')}]`);
}
console.log('--- occupation mix (all tribes) ---');
const mix: Record<string, number> = {};
let people = 0;
for (const t of sim.tribeSummaries()) {
  for (const [k, n] of Object.entries(t.occupations)) {
    mix[k] = (mix[k] ?? 0) + n;
    people += n;
  }
}
for (const [k, n] of Object.entries(mix)) {
  console.log(`  ${k.padEnd(10)} ${String(n).padStart(4)}  ${((n / Math.max(1, people)) * 100).toFixed(1)}%`);
}
console.log('--- last events ---');
for (const e of sim.events.slice(-12)) console.log(`  [${e.tick}] ${e.text}`);
