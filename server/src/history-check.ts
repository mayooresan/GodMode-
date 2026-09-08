/** Smoke-check the history recorder: alignment, growth and payload size. */
import { Simulation } from './engine/simulation.js';
import { config } from './config.js';

const sim = new Simulation({
  width: config.width, height: config.height, seed: config.seed,
  startingTribes: config.startingTribes,
  startingAgentsPerTribe: config.startingAgentsPerTribe,
  maxAgents: config.maxAgents, eventLogSize: config.eventLogSize,
});
sim.seed();
for (let i = 0; i < 4000; i++) sim.step();

const h = sim.history.payload();
const cols = ['tick','population','young','adults','elders','tribeCount','births','deaths','food','claimed','temperature','techs','wars'] as const;
const lens = new Set(cols.map((c) => (h[c] as number[]).length));
console.log(`samples:        ${h.samples} (stride ${h.stride}, so ${h.samples * h.stride} ticks covered)`);
console.log(`column lengths: ${[...lens].join(', ')} ${lens.size === 1 ? '(aligned ✓)' : '(MISALIGNED ✗)'}`);
const misaligned = h.tribes.filter((t) => t.pops.length !== h.samples);
console.log(`tribe series:   ${h.tribes.length} (${h.tribes.filter((t) => t.alive).length} alive), ` +
  `${misaligned.length === 0 ? 'all aligned ✓' : `${misaligned.length} MISALIGNED ✗`}`);
console.log(`payload size:   ${(JSON.stringify(h).length / 1024).toFixed(0)} KB`);
console.log(`pop first/peak/last: ${h.population[0]} / ${Math.max(...h.population)} / ${h.population[h.population.length - 1]}`);
console.log(`births total:   ${h.births.reduce((a, b) => a + b, 0)}, deaths total: ${h.deaths.reduce((a, b) => a + b, 0)}`);
console.log(`temp range:     ${Math.min(...h.temperature)} to ${Math.max(...h.temperature)}`);
const top = h.tribes.slice(0, 3).map((t) => `${t.glyph} ${t.name.replace('Tribe of the ','')} peak ${Math.max(...t.pops)}`);
console.log(`top series:     ${top.join(' | ')}`);
