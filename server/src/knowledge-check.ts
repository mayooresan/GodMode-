/** Invariant check: an unlocked technology must be fully researched. */
import { Simulation } from './engine/simulation.js';
import { TECHS, TECH_META } from './engine/types.js';
import { config } from './config.js';

const sim = new Simulation({
  width: config.width, height: config.height, seed: config.seed,
  startingTribes: config.startingTribes,
  startingAgentsPerTribe: config.startingAgentsPerTribe,
  maxAgents: config.maxAgents, eventLogSize: config.eventLogSize,
});
sim.seed();

let violations = 0;
for (let i = 0; i < 6000; i++) {
  sim.step();
  for (const tribe of sim.tribes.values()) {
    for (const t of TECHS) {
      if (tribe.knowledge.unlocked[t] && tribe.knowledge.progress[t] < TECH_META[t].cost) {
        violations++;
        if (violations < 4) {
          console.log(`  tick ${sim.tick}: ${tribe.name} has ${t} unlocked at ` +
            `${Math.round((tribe.knowledge.progress[t] / TECH_META[t].cost) * 100)}%`);
        }
      }
    }
  }
}
console.log(violations === 0
  ? 'PASS — every unlocked technology is fully researched across 6000 ticks'
  : `FAIL — ${violations} tribe-ticks with an unlocked but incomplete technology`);
