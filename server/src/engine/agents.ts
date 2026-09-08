import {
  Agent, AgentState, AgentStateId, Biome, BIOME_PROFILE, Traits,
} from './types.js';
import { ADULT_AGE, ELDER_AGE, MAX_AGE, TICKS_PER_YEAR } from '../config.js';
import type { Rng } from './rng.js';
import type { World } from './world.js';
import type { Simulation } from './simulation.js';

/** Most an agent will haul before returning to camp. */
export const CARRY_CAPACITY = 20;

/** Food units per head that a tribe treats as a comfortable reserve. */
const COMFORTABLE_STORE_PER_HEAD = 14;

export const yearsOf = (a: Agent) => a.ageTicks / TICKS_PER_YEAR;
export const isAdult = (a: Agent) => a.ageTicks >= ADULT_AGE * TICKS_PER_YEAR;
export const isElder = (a: Agent) => a.ageTicks >= ELDER_AGE * TICKS_PER_YEAR;

/** Traits inherited from two parents with mutation, or rolled fresh. */
export function mixTraits(rng: Rng, a?: Traits, b?: Traits): Traits {
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const gene = (x?: number, y?: number) => {
    if (x === undefined || y === undefined) return clamp01(rng.normal(0.5, 0.17));
    return clamp01((x + y) / 2 + rng.normal(0, 0.07));
  };
  return {
    aggression: gene(a?.aggression, b?.aggression),
    inquisitiveness: gene(a?.inquisitiveness, b?.inquisitiveness),
    hardiness: gene(a?.hardiness, b?.hardiness),
  };
}

export function createAgent(
  id: number,
  tribeId: number,
  x: number,
  y: number,
  ageYears: number,
  rng: Rng,
  traits: Traits,
): Agent {
  return {
    id,
    tribeId,
    x,
    y,
    ageTicks: Math.round(ageYears * TICKS_PER_YEAR),
    sex: rng.chance(0.5) ? 0 : 1,
    health: 100,
    hunger: rng.range(10, 35),
    thirst: rng.range(10, 35),
    stamina: rng.range(70, 100),
    morale: rng.range(50, 80),
    traits,
    state: AgentState.Explore,
    carrying: 0,
    tx: null,
    ty: null,
    breedCooldown: rng.int(0, TICKS_PER_YEAR),
    sickness: 0,
    alive: true,
  };
}

/**
 * Outward spiral search for the nearest tile satisfying `ok`.
 *
 * Bounded by `maxR` so a single starving agent on a barren continent cannot
 * make the tick cost blow up; callers fall back to wandering when it misses.
 */
export function findNearest(
  world: World,
  x0: number,
  y0: number,
  maxR: number,
  ok: (i: number, x: number, y: number) => boolean,
): { x: number; y: number } | null {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const ay = y0 + dy;
      if (ay < 0 || ay >= world.height) continue;
      // Only walk the ring's perimeter; interior was covered by smaller r.
      const stepX = Math.abs(dy) === r ? 1 : 2 * r;
      for (let dx = -r; dx <= r; dx += stepX || 1) {
        const ax = x0 + dx;
        if (ax < 0 || ax >= world.width) continue;
        const i = world.idx(ax, ay);
        if (ok(i, ax, ay)) return { x: ax, y: ay };
      }
    }
  }
  return null;
}

/** One greedy step toward (tx, ty), preferring passable tiles. */
function stepToward(sim: Simulation, a: Agent, tx: number, ty: number): void {
  const w = sim.world;
  const dx = Math.sign(tx - a.x);
  const dy = Math.sign(ty - a.y);
  if (dx === 0 && dy === 0) return;

  const candidates: Array<[number, number]> = [
    [a.x + dx, a.y + dy],
    [a.x + dx, a.y],
    [a.x, a.y + dy],
  ];
  for (const [nx, ny] of candidates) {
    if (!w.inBounds(nx, ny)) continue;
    const i = w.idx(nx, ny);
    if (!w.isPassable(i)) continue;
    const cost = BIOME_PROFILE[w.biome[i]].moveCost;
    if (a.stamina < cost * 2) {
      a.state = AgentState.Rest;
      return;
    }
    a.stamina -= cost * 1.6;
    a.x = nx;
    a.y = ny;
    return;
  }
  // Fully boxed in (e.g. flooded around): shuffle to break the deadlock.
  const nx = w.clampX(a.x + sim.rng.int(-1, 1));
  const ny = w.clampY(a.y + sim.rng.int(-1, 1));
  if (w.isPassable(w.idx(nx, ny))) {
    a.x = nx;
    a.y = ny;
  }
}

function clearTarget(a: Agent): void {
  a.tx = null;
  a.ty = null;
}

function atTarget(a: Agent): boolean {
  return a.tx !== null && a.ty !== null && a.x === a.tx && a.y === a.ty;
}

/**
 * Choose this tick's behaviour.
 *
 * Strict priority order, matching the design brief: water, then food, then
 * warmth, then hauling food home, then production, then social/exploratory
 * slack time. Combat pre-empts everything below food when a raid is under way.
 */
function chooseState(sim: Simulation, a: Agent): AgentStateId {
  const w = sim.world;
  const tribe = sim.tribes.get(a.tribeId);
  const i = w.idx(a.x, a.y);

  if (a.stamina < 12) return AgentState.Rest;
  if (a.thirst > 52) return AgentState.SeekWater;

  if (a.hunger > 40) return foodState(sim, a);

  if (tribe && sim.warBand.has(a.id)) return AgentState.Fight;

  // Cold snap: seek warmth before doing anything discretionary.
  const warmth = sim.temperature + (w.shelter[i] > 0 ? 12 : 0) +
    (tribe?.knowledge.unlocked.fire ? 9 : 0) + a.traits.hardiness * 8;
  if (warmth < 4) return AgentState.SeekShelter;

  if (a.carrying >= CARRY_CAPACITY * 0.6) return AgentState.Deposit;

  if (tribe && isAdult(a) && !isElder(a)) {
    // Compare against the cap the tribe can actually reach — palisades need
    // warfare. Checking against a flat 3 left every tribe permanently "about to
    // build" and pinned a fifth of its adults on a job they could never finish.
    const shelterCap = tribe.knowledge.unlocked.warfare ? 3 : 2;
    const needsHut =
      tribe.knowledge.unlocked.shelter && w.shelter[w.idx(tribe.cx, tribe.cy)] < shelterCap;
    if (needsHut && sim.rng.chance(0.25)) return AgentState.Build;
    if (tribe.knowledge.unlocked.flint && tribe.toolStore < sim.tribePopulation(tribe.id) && sim.rng.chance(0.2)) {
      return AgentState.Craft;
    }
    if (tribe.knowledge.unlocked.farming && sim.rng.chance(0.15)) return AgentState.Build;
    if (
      a.breedCooldown <= 0 &&
      a.health > 60 &&
      a.hunger < 40 &&
      tribe.foodStore > sim.tribePopulation(tribe.id) * 4
    ) {
      return AgentState.Reproduce;
    }
  }

  // Slack time goes into stocking the communal store. Without this, agents only
  // ever gather what they immediately eat and the tribe never builds the
  // surplus that reproduction, building and trade all depend on.
  //
  // The decision is graded, not a threshold: a hard cutoff made the entire
  // tribe flip between all-foraging and none from one tick to the next. Here
  // the share of the tribe that goes gathering rises smoothly as the store
  // falls, and a baseline keeps a few hands working even in plenty.
  if (tribe && a.carrying < CARRY_CAPACITY) {
    const pop = Math.max(1, sim.tribePopulation(tribe.id));
    const comfort = tribe.foodStore / (pop * COMFORTABLE_STORE_PER_HEAD);
    // Drowning in food: all but a token few stop gathering. Without this the
    // baseline urge never relaxes and stores grow without bound, which no
    // Stone Age group could actually hold.
    const urge = comfort > 2.5 ? 0.05 : Math.min(0.92, Math.max(0.22, 1.05 - comfort));
    if (sim.rng.chance(urge)) return foodState(sim, a);
  }

  if (a.carrying > 0) return AgentState.Deposit;
  return sim.rng.chance(0.4) ? AgentState.Explore : AgentState.Socialize;
}

/** Pick the gathering method that suits this tile, the tribe's tools and the agent. */
function foodState(sim: Simulation, a: Agent): AgentStateId {
  const w = sim.world;
  const tribe = sim.tribes.get(a.tribeId);
  const i = w.idx(a.x, a.y);
  if (w.biome[i] === Biome.ShallowWater || sim.adjacentWater(a.x, a.y)) {
    if (tribe?.knowledge.unlocked.flint || sim.rng.chance(0.4)) return AgentState.Fish;
  }
  const huntable = w.biome[i] === Biome.Forest || w.biome[i] === Biome.Hills;
  if (huntable && tribe?.knowledge.unlocked.flint && a.traits.aggression > 0.4) {
    return AgentState.Hunt;
  }
  return AgentState.Forage;
}

/** Advance one agent by a single tick: needs, decision, action, mortality. */
export function stepAgent(sim: Simulation, a: Agent): void {
  const w = sim.world;
  const tribe = sim.tribes.get(a.tribeId);
  a.ageTicks++;

  const hardy = 1 - a.traits.hardiness * 0.35;
  a.hunger = Math.min(100, a.hunger + 0.78 * hardy * sim.hungerRate);
  a.thirst = Math.min(100, a.thirst + 1.25 * hardy);
  a.stamina = Math.min(100, a.stamina + 1.2);
  if (a.breedCooldown > 0) a.breedCooldown--;

  const desired = chooseState(sim, a);
  if (desired !== a.state) {
    a.state = desired;
    clearTarget(a);
  }

  switch (a.state) {
    case AgentState.Rest:
      a.stamina = Math.min(100, a.stamina + 6);
      break;

    case AgentState.SeekWater: {
      const here = w.idx(a.x, a.y);
      if (w.water[here] > 1) {
        const drink = Math.min(w.water[here], 45);
        w.water[here] -= drink;
        a.thirst = Math.max(0, a.thirst - drink * 1.6);
        clearTarget(a);
      } else {
        seekTile(sim, a, 14, (i) => w.water[i] > 8);
      }
      break;
    }

    case AgentState.Forage:
    case AgentState.Hunt:
    case AgentState.Fish: {
      const here = w.idx(a.x, a.y);
      const toolBonus = tribe?.knowledge.unlocked.flint ? 1.55 : 1;
      const fireBonus = tribe?.knowledge.unlocked.fire ? 1.25 : 1; // cooking yields more calories
      const stateBonus = a.state === AgentState.Hunt ? 1.6 : a.state === AgentState.Fish ? 1.3 : 1;
      const potential = w.food[here];
      if (potential > 1.5) {
        const take = Math.min(potential, 3.4 * toolBonus * stateBonus);
        w.food[here] -= take;
        const calories = take * fireBonus;
        const eaten = Math.min(calories, a.hunger / 3.2);
        a.hunger = Math.max(0, a.hunger - eaten * 3.2);
        a.carrying = Math.min(CARRY_CAPACITY, a.carrying + Math.max(0, calories - eaten));
        if (a.state === AgentState.Hunt && sim.rng.chance(0.012 * (1 - a.traits.hardiness))) {
          a.health -= sim.rng.range(8, 30); // gored by the quarry
        }
        if (w.food[here] < 1.5) clearTarget(a);
      } else {
        seekTile(sim, a, 12, (i) => w.food[i] > 6);
      }
      break;
    }

    case AgentState.SeekShelter: {
      const here = w.idx(a.x, a.y);
      if (w.shelter[here] > 0) {
        a.stamina = Math.min(100, a.stamina + 3);
        a.morale = Math.min(100, a.morale + 0.4);
      } else if (tribe) {
        a.tx = tribe.cx;
        a.ty = tribe.cy;
        stepToward(sim, a, tribe.cx, tribe.cy);
      }
      break;
    }

    case AgentState.Deposit: {
      if (!tribe) break;
      if (a.x === tribe.cx && a.y === tribe.cy) {
        tribe.foodStore += a.carrying;
        a.carrying = 0;
        a.morale = Math.min(100, a.morale + 1);
        clearTarget(a);
      } else {
        stepToward(sim, a, tribe.cx, tribe.cy);
      }
      break;
    }

    case AgentState.Craft: {
      if (!tribe) break;
      const here = w.idx(a.x, a.y);
      if (w.stone[here] > 4) {
        w.stone[here] -= 4;
        tribe.stoneStore += 4;
        tribe.toolStore += 0.6;
      } else if (tribe.stoneStore > 6) {
        tribe.stoneStore -= 6;
        tribe.toolStore += 1;
      } else {
        seekTile(sim, a, 10, (i) => w.stone[i] > 12);
      }
      break;
    }

    case AgentState.Build: {
      if (!tribe) break;
      const here = w.idx(a.x, a.y);
      if (w.wood[here] > 6) {
        w.wood[here] -= 6;
        tribe.woodStore += 6;
      }
      if (tribe.knowledge.unlocked.farming && sim.canCultivate(here) && tribe.woodStore > 10) {
        tribe.woodStore -= 10;
        w.cultivated[here] = Math.min(3, w.cultivated[here] + 1);
        w.refreshCaps(here);
        w.markDirty(here);
      } else if (tribe.knowledge.unlocked.shelter && tribe.woodStore > 24) {
        const camp = w.idx(tribe.cx, tribe.cy);
        const cap = tribe.knowledge.unlocked.warfare ? 3 : 2;
        if (w.shelter[camp] < cap) {
          tribe.woodStore -= 24;
          w.shelter[camp] = w.shelter[camp] + 1;
          w.refreshCaps(camp);
          w.markDirty(camp);
        }
      } else if (w.wood[here] <= 6) {
        seekTile(sim, a, 10, (i) => w.wood[i] > 20);
      }
      break;
    }

    case AgentState.Reproduce: {
      // Pairing itself is resolved tribe-side so both parents are consumed once.
      if (tribe) {
        stepToward(sim, a, tribe.cx, tribe.cy);
        sim.mateQueue.push(a.id);
      }
      break;
    }

    case AgentState.Fight: {
      sim.resolveAgentCombat(a);
      break;
    }

    case AgentState.Socialize: {
      a.morale = Math.min(100, a.morale + 0.6);
      // Storytelling around the fire; the bulk of research accrues tribe-side.
      if (tribe) sim.addResearch(tribe, a.traits.inquisitiveness * 0.5);
      break;
    }

    case AgentState.Explore:
    default: {
      if (!atTarget(a) && a.tx !== null && a.ty !== null) {
        stepToward(sim, a, a.tx, a.ty);
      } else {
        // Range around the camp rather than around the agent's current spot.
        // A self-relative random walk lets agents drift out of the tribe's
        // ration radius over time and quietly starve at the map's edge.
        const r = 14;
        const ox = tribe ? tribe.cx : a.x;
        const oy = tribe ? tribe.cy : a.y;
        const nx = w.clampX(ox + sim.rng.int(-r, r));
        const ny = w.clampY(oy + sim.rng.int(-r, r));
        if (w.isPassable(w.idx(nx, ny))) {
          a.tx = nx;
          a.ty = ny;
        }
      }
      break;
    }
  }

  applyMortality(sim, a);
}

/** Retarget toward the nearest tile matching `ok`, then take one step. */
function seekTile(
  sim: Simulation,
  a: Agent,
  radius: number,
  ok: (i: number) => boolean,
): void {
  const w = sim.world;
  if (a.tx === null || a.ty === null || (a.x === a.tx && a.y === a.ty)) {
    const found = findNearest(w, a.x, a.y, radius, (i) => w.isPassable(i) && ok(i));
    if (found) {
      a.tx = found.x;
      a.ty = found.y;
    } else {
      // Nothing in range — drift outward to find fresh ground.
      a.tx = w.clampX(a.x + sim.rng.int(-radius, radius));
      a.ty = w.clampY(a.y + sim.rng.int(-radius, radius));
    }
  }
  if (a.tx !== null && a.ty !== null) stepToward(sim, a, a.tx, a.ty);
}

/** Starvation, thirst, exposure, disease and old age. */
function applyMortality(sim: Simulation, a: Agent): void {
  const w = sim.world;
  const i = w.idx(a.x, a.y);
  const tribe = sim.tribes.get(a.tribeId);
  const hardy = 1 - a.traits.hardiness * 0.5;

  if (a.hunger > 82) a.health -= (a.hunger - 82) * 0.22 * hardy;
  if (a.thirst > 86) a.health -= (a.thirst - 86) * 0.4 * hardy;
  if (a.sickness > 0) {
    a.sickness--;
    a.health -= 1.7 * hardy;
  }

  const warmth = sim.temperature + (w.shelter[i] > 0 ? 12 : 0) +
    (tribe?.knowledge.unlocked.fire ? 9 : 0) + a.traits.hardiness * 8;
  if (warmth < 0) a.health -= -warmth * 0.35;

  const years = yearsOf(a);
  if (years > ELDER_AGE) a.health -= (years - ELDER_AGE) * 0.035;

  if (a.hunger < 30 && a.thirst < 40 && a.health < 100) a.health += 0.5;
  a.health = Math.min(100, a.health);

  if (a.health <= 0) {
    sim.killAgent(a, causeOfDeath(a, warmth));
    return;
  }
  if (years > MAX_AGE && sim.rng.chance(0.05)) {
    sim.killAgent(a, 'old age');
  }
}

function causeOfDeath(a: Agent, warmth: number): string {
  if (a.thirst > 90) return 'thirst';
  if (a.hunger > 85) return 'starvation';
  if (a.sickness > 0) return 'sickness';
  if (warmth < 0) return 'exposure';
  if (yearsOf(a) > ELDER_AGE) return 'old age';
  return 'injury';
}
