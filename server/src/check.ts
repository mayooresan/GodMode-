/**
 * Invariant and outcome checks for the simulation.
 *
 *   npm run check            # 4000 ticks, default seed
 *   npm run check -- 8000 42 # ticks, seed
 *
 * Every balance bug this project hit — zero births, zero foraging, a world with
 * no hills or mountains, a fifth of every tribe pinned on an unfinishable job,
 * technologies marked known but half-researched — was mechanically detectable
 * and was instead found by reading bench output and squinting at screenshots.
 * This is that reading, written down and made to fail loudly.
 *
 * Structural checks assert things that must hold at every instant. Outcome
 * checks assert that a run produced a world worth looking at.
 */
import { Simulation } from './engine/simulation.js';
import {
  Biome, BIOME_NAMES, OCCUPATIONS, TECHS, TECH_META,
} from './engine/types.js';
import { config } from './config.js';

const ticks = Number(process.argv[2] ?? 4000);
const seed = Number(process.argv[3] ?? config.seed);
/** Structural checks run on this cadence; every tick is needlessly slow. */
const STRIDE = 25;

type Failure = { tick: number; detail: string };

interface Check {
  name: string;
  /** Return a description on failure, or null when the invariant holds. */
  run: (sim: Simulation) => string | null;
}

const finite = (n: number) => Number.isFinite(n);

const structural: Check[] = [
  {
    name: 'agents are inside the world',
    run: (sim) => {
      for (const a of sim.agents) {
        if (!a.alive) continue;
        if (!sim.world.inBounds(a.x, a.y)) return `agent ${a.id} at (${a.x}, ${a.y})`;
      }
      return null;
    },
  },
  {
    name: 'agents belong to a living tribe',
    run: (sim) => {
      for (const a of sim.agents) {
        if (!a.alive) continue;
        if (!sim.tribes.has(a.tribeId)) return `agent ${a.id} references missing tribe ${a.tribeId}`;
      }
      return null;
    },
  },
  {
    name: 'agent vitals stay in range and finite',
    run: (sim) => {
      for (const a of sim.agents) {
        if (!a.alive) continue;
        for (const [k, v] of [
          ['health', a.health], ['hunger', a.hunger], ['thirst', a.thirst],
          ['stamina', a.stamina], ['morale', a.morale], ['carrying', a.carrying],
        ] as const) {
          if (!finite(v)) return `agent ${a.id} has non-finite ${k}`;
          if (v < -0.001) return `agent ${a.id} has negative ${k} (${v.toFixed(2)})`;
        }
        if (a.health > 100.001) return `agent ${a.id} health ${a.health.toFixed(2)} > 100`;
      }
      return null;
    },
  },
  {
    name: 'tile ownership agrees with tribal territory',
    run: (sim) => {
      for (const tribe of sim.tribes.values()) {
        for (const i of tribe.territory) {
          if (sim.world.owner[i] !== tribe.id) {
            return `${tribe.name} claims tile ${i} but the grid says owner ${sim.world.owner[i]}`;
          }
        }
      }
      for (let i = 0; i < sim.world.size; i++) {
        const owner = sim.world.owner[i];
        if (owner < 0) continue;
        const tribe = sim.tribes.get(owner);
        if (!tribe) return `tile ${i} is owned by missing tribe ${owner}`;
        if (!tribe.territory.has(i)) return `tile ${i} owned by ${tribe.name} not in its territory set`;
      }
      return null;
    },
  },
  {
    name: 'an unlocked technology is fully researched',
    run: (sim) => {
      for (const tribe of sim.tribes.values()) {
        for (const t of TECHS) {
          if (tribe.knowledge.unlocked[t] && tribe.knowledge.progress[t] < TECH_META[t].cost) {
            const pct = Math.round((tribe.knowledge.progress[t] / TECH_META[t].cost) * 100);
            return `${tribe.name} has ${t} unlocked at ${pct}%`;
          }
        }
      }
      return null;
    },
  },
  {
    name: 'tribal stores never go negative',
    run: (sim) => {
      for (const tribe of sim.tribes.values()) {
        for (const [k, v] of [
          ['food', tribe.foodStore], ['tools', tribe.toolStore],
          ['wood', tribe.woodStore], ['stone', tribe.stoneStore],
        ] as const) {
          if (!finite(v)) return `${tribe.name} has non-finite ${k}`;
          if (v < -0.001) return `${tribe.name} has ${k} = ${v.toFixed(2)}`;
        }
      }
      return null;
    },
  },
  {
    name: 'tribe colours and totems are unique',
    run: (sim) => {
      const colors = new Set<string>();
      const totems = new Set<string>();
      for (const tribe of sim.tribes.values()) {
        if (colors.has(tribe.color)) return `colour ${tribe.color} reused by ${tribe.name}`;
        if (totems.has(tribe.totem)) return `totem ${tribe.totem} reused by ${tribe.name}`;
        colors.add(tribe.color);
        totems.add(tribe.totem);
      }
      return null;
    },
  },
  {
    name: 'tile resources stay within capacity and finite',
    run: (sim) => {
      const w = sim.world;
      for (let i = 0; i < w.size; i++) {
        if (!finite(w.food[i]) || !finite(w.water[i]) || !finite(w.wood[i]) || !finite(w.stone[i])) {
          return `tile ${i} has a non-finite resource`;
        }
        if (w.food[i] < -0.001) return `tile ${i} has negative food`;
        // Blessings deliberately overfill, so only the lower bound is invariant.
        if (w.water[i] > w.waterCap[i] + 0.001) return `tile ${i} water above capacity`;
      }
      return null;
    },
  },
  {
    name: 'records are never below present state',
    run: (sim) => {
      for (const tribe of sim.tribes.values()) {
        const pop = sim.tribePopulation(tribe.id);
        if (tribe.peakPopulation < pop) {
          return `${tribe.name} peak population ${tribe.peakPopulation} < current ${pop}`;
        }
        if (tribe.peakTerritory < tribe.territory.size) {
          return `${tribe.name} peak territory ${tribe.peakTerritory} < current ${tribe.territory.size}`;
        }
      }
      return null;
    },
  },
  {
    name: 'the live-agent index matches the agent array',
    run: (sim) => {
      const alive = sim.agents.filter((a) => a.alive).length;
      return alive === sim.agentCount ? null : `array has ${alive} alive, index has ${sim.agentCount}`;
    },
  },
];

const outcomes: Check[] = [
  {
    name: 'humanity survives the run',
    run: (sim) => (sim.agentCount > 0 ? null : 'population reached zero'),
  },
  {
    name: 'population stays within a sane band',
    run: (sim) =>
      sim.agentCount < sim.maxAgents
        ? null
        : `population hit the ${sim.maxAgents} ceiling — growth is unbounded`,
  },
  {
    name: 'at least two tribes remain',
    run: (sim) => (sim.tribes.size >= 2 ? null : `only ${sim.tribes.size} tribe(s) left`),
  },
  {
    name: 'every biome exists in the world',
    run: (sim) => {
      const seen = new Set<number>();
      for (let i = 0; i < sim.world.size; i++) seen.add(sim.world.biome[i]);
      const missing = Object.values(Biome).filter((b) => !seen.has(b));
      return missing.length === 0
        ? null
        : `missing ${missing.map((b) => BIOME_NAMES[b]).join(', ')} — resources tied to them are unreachable`;
    },
  },
  {
    name: 'technology advances',
    run: (sim) => {
      const unlocked = [...sim.tribes.values()].reduce(
        (n, t) => n + TECHS.filter((k) => t.knowledge.unlocked[k]).length, 0);
      return unlocked > 0 ? null : 'no tribe discovered anything';
    },
  },
  {
    name: 'people are both born and dying',
    run: (sim) => {
      const births = [...sim.tribes.values()].reduce((n, t) => n + t.births, 0);
      const deaths = [...sim.tribes.values()].reduce((n, t) => n + t.deaths, 0);
      if (births === 0) return 'no births occurred — reproduction is not firing';
      if (deaths === 0) return 'no deaths occurred — mortality is not firing';
      return null;
    },
  },
  {
    name: 'no single occupation dominates the population',
    run: (sim) => {
      const mix: Record<string, number> = {};
      let total = 0;
      for (const t of sim.tribeSummaries()) {
        for (const [k, n] of Object.entries(t.occupations)) {
          mix[k] = (mix[k] ?? 0) + n;
          total += n;
        }
      }
      if (total === 0) return null;
      for (const o of OCCUPATIONS) {
        const share = (mix[o] ?? 0) / total;
        if (share > 0.9) return `${o} is ${(share * 100).toFixed(0)}% of everyone — the FSM is stuck`;
      }
      return null;
    },
  },
  {
    name: 'history columns stay aligned',
    run: (sim) => {
      const h = sim.history.payload();
      const cols: Array<[string, number[]]> = [
        ['population', h.population], ['young', h.young], ['adults', h.adults],
        ['elders', h.elders], ['tribeCount', h.tribeCount], ['births', h.births],
        ['deaths', h.deaths], ['food', h.food], ['claimed', h.claimed],
        ['temperature', h.temperature], ['techs', h.techs], ['wars', h.wars],
      ];
      for (const [name, col] of cols) {
        if (col.length !== h.tick.length) {
          return `${name} has ${col.length} samples, tick axis has ${h.tick.length}`;
        }
      }
      for (const t of h.tribes) {
        if (t.pops.length !== h.tick.length) {
          return `series for ${t.name} has ${t.pops.length} samples, tick axis has ${h.tick.length}`;
        }
      }
      return null;
    },
  },
  {
    name: 'tribes hold territory',
    run: (sim) => {
      const claimed = [...sim.tribes.values()].reduce((n, t) => n + t.territory.size, 0);
      return claimed > 0 ? null : 'no tribe claims any land';
    },
  },
];

// ---------------------------------------------------------------------------

const sim = new Simulation({
  width: config.width,
  height: config.height,
  seed,
  startingTribes: config.startingTribes,
  startingAgentsPerTribe: config.startingAgentsPerTribe,
  maxAgents: config.maxAgents,
  eventLogSize: config.eventLogSize,
});
sim.seed();

const failures = new Map<string, Failure>();
const record = (check: Check, detail: string, tick: number) => {
  if (!failures.has(check.name)) failures.set(check.name, { tick, detail });
};

const t0 = Date.now();
for (let i = 0; i < ticks; i++) {
  sim.step();
  if (sim.tick % STRIDE !== 0) continue;
  for (const check of structural) {
    const detail = check.run(sim);
    if (detail) record(check, detail, sim.tick);
  }
}
const elapsed = Date.now() - t0;

for (const check of outcomes) {
  const detail = check.run(sim);
  if (detail) record(check, detail, sim.tick);
}

const v = sim.vitals();
console.log(`world  ${config.width}x${config.height}, seed ${seed}, ${ticks} ticks in ${elapsed} ms`);
console.log(`ended  year ${v.year} ${v.season} · ${v.population} alive · ${v.tribes} tribes · ${v.claimedTiles} tiles claimed`);
console.log('');

const all = [...structural, ...outcomes];
for (const check of all) {
  const f = failures.get(check.name);
  if (f) console.log(`  FAIL  ${check.name}\n          tick ${f.tick}: ${f.detail}`);
  else console.log(`  pass  ${check.name}`);
}

console.log('');
if (failures.size === 0) {
  console.log(`All ${all.length} checks passed.`);
  process.exit(0);
} else {
  console.log(`${failures.size} of ${all.length} checks FAILED.`);
  process.exit(1);
}
