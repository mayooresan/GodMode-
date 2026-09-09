import { Simulation } from './engine/simulation.js';
import { TICKS_PER_YEAR, config } from './config.js';
for (const seed of [20260908, 7]) {
  const sim = new Simulation({
    width: config.width, height: config.height, seed,
    startingTribes: config.startingTribes, startingAgentsPerTribe: config.startingAgentsPerTribe,
    maxAgents: config.maxAgents, eventLogSize: config.eventLogSize,
  });
  sim.seed();
  const marks = [50, 100, 150, 200, 250];
  const out: string[] = []; let mi = 0;
  for (let i = 0; i < 250 * TICKS_PER_YEAR; i++) {
    sim.step();
    if (mi < marks.length && sim.tick >= marks[mi] * TICKS_PER_YEAR) {
      const land = [...sim.tribes.values()].reduce((n, t) => n + t.territory.size, 0);
      const camps = [...sim.tribes.values()].reduce((n, t) => n + t.camps.length, 0);
      const big = Math.max(0, ...[...sim.tribes.values()].map((t) => t.territory.size));
      out.push(`y${marks[mi]}: ${String(sim.tribes.size).padStart(2)}t ${String(sim.agentCount).padStart(5)}p ` +
        `${String(camps).padStart(3)}camps biggest ${Math.round(big / 9900 * 100)}% of land`);
      mi++;
    }
  }
  console.log(`seed ${seed}\n  ${out.join('\n  ')}`);
}
