import {
  Agent, AgentState, AgentStateId, Biome, BIOME_PROFILE, Traits,
} from './types.js';
import { ADULT_AGE, ELDER_AGE, MAX_AGE, TICKS_PER_YEAR } from '../config.js';
import type { Rng } from './rng.js';
import type { World } from './world.js';
import { TUNABLES as T } from './tunables.js';
import { nearestCamp } from './camps.js';
import type { Simulation } from './simulation.js';

/** Re-exported for callers that reason about how much an agent can carry. */
export const CARRY_CAPACITY = T.foraging.carryCapacity;

export const yearsOf = (a: Agent) => a.ageTicks / TICKS_PER_YEAR;
export const isAdult = (a: Agent) => a.ageTicks >= ADULT_AGE * TICKS_PER_YEAR;
export const isElder = (a: Agent) => a.ageTicks >= ELDER_AGE * TICKS_PER_YEAR;

/** Traits inherited from two parents with mutation, or rolled fresh. */
export function mixTraits(rng: Rng, a?: Traits, b?: Traits): Traits {
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const gene = (x?: number, y?: number) => {
    if (x === undefined || y === undefined) return clamp01(rng.normal(T.genetics.freshMean, T.genetics.freshSpread));
    return clamp01((x + y) / 2 + rng.normal(0, T.genetics.mutationSpread));
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
    if (a.stamina < cost * T.movement.staminaSafetyFactor) {
      a.state = AgentState.Rest;
      return;
    }
    a.stamina -= cost * T.movement.staminaPerStep;
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

  if (a.stamina < T.needs.exhaustedStamina) return AgentState.Rest;
  if (a.thirst > T.needs.thirstSeekThreshold) return AgentState.SeekWater;

  if (a.hunger > T.needs.hungerSeekThreshold) return foodState(sim, a);

  if (tribe && sim.warBand.has(a.id)) return AgentState.Fight;

  // Cold snap: seek warmth before doing anything discretionary.
  const warmth = warmthAt(sim, a, i, tribe);
  if (warmth < T.warmth.seekShelterBelow) return AgentState.SeekShelter;

  if (a.carrying >= CARRY_CAPACITY * T.foraging.depositAtFraction) return AgentState.Deposit;

  if (tribe && isAdult(a) && !isElder(a)) {
    // Compare against the cap the tribe can actually reach — palisades need
    // warfare. Checking against a flat 3 left every tribe permanently "about to
    // build" and pinned a fifth of its adults on a job they could never finish.
    const shelterCap = tribe.knowledge.unlocked.warfare ? 3 : 2;
    const home = nearestCamp(tribe, a.x, a.y);
    const needsHut =
      tribe.knowledge.unlocked.shelter && w.shelter[w.idx(home.x, home.y)] < shelterCap;
    if (needsHut && sim.rng.chance(T.work.buildChance)) return AgentState.Build;
    if (tribe.knowledge.unlocked.flint && tribe.toolStore < sim.tribePopulation(tribe.id) && sim.rng.chance(T.work.craftChance)) {
      return AgentState.Craft;
    }
    if (tribe.knowledge.unlocked.farming && sim.rng.chance(T.work.cultivateChance)) return AgentState.Build;
    if (
      a.breedCooldown <= 0 &&
      a.health > T.reproduction.minHealth &&
      a.hunger < T.reproduction.maxHunger &&
      tribe.foodStore > sim.tribePopulation(tribe.id) * T.reproduction.storePerHeadRequired
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
    const comfort = tribe.foodStore / (pop * T.surplus.comfortableStorePerHead);
    // Drowning in food: all but a token few stop gathering. Without this the
    // baseline urge never relaxes and stores grow without bound, which no
    // Stone Age group could actually hold.
    const urge = comfort > T.surplus.abundanceRatio
      ? T.surplus.abundanceUrge
      : Math.min(T.surplus.urgeMax, Math.max(T.surplus.urgeMin, T.surplus.urgeBase - comfort));
    if (sim.rng.chance(urge)) return foodState(sim, a);
  }

  if (a.carrying > 0) return AgentState.Deposit;
  return sim.rng.chance(T.behaviour.exploreOverSocialise) ? AgentState.Explore : AgentState.Socialize;
}

/** Pick the gathering method that suits this tile, the tribe's tools and the agent. */
function foodState(sim: Simulation, a: Agent): AgentStateId {
  const w = sim.world;
  const tribe = sim.tribes.get(a.tribeId);
  const i = w.idx(a.x, a.y);
  if (w.biome[i] === Biome.ShallowWater || sim.adjacentWater(a.x, a.y)) {
    if (tribe?.knowledge.unlocked.flint || sim.rng.chance(T.behaviour.opportunisticFishChance)) {
      return AgentState.Fish;
    }
  }
  const huntable = w.biome[i] === Biome.Forest || w.biome[i] === Biome.Hills;
  if (huntable && tribe?.knowledge.unlocked.flint && a.traits.aggression > T.behaviour.hunterAggression) {
    return AgentState.Hunt;
  }
  return AgentState.Forage;
}

/** Effective warmth for an agent: ambient plus shelter, fire and hardiness. */
function warmthAt(
  sim: Simulation,
  a: Agent,
  tileIndex: number,
  tribe: ReturnType<Simulation['tribes']['get']>,
): number {
  return (
    sim.temperature +
    (sim.world.shelter[tileIndex] > 0 ? T.warmth.shelterBonus : 0) +
    (tribe?.knowledge.unlocked.fire ? T.warmth.fireBonus : 0) +
    a.traits.hardiness * T.warmth.hardinessBonus
  );
}

/** Advance one agent by a single tick: needs, decision, action, mortality. */
export function stepAgent(sim: Simulation, a: Agent): void {
  const w = sim.world;
  const tribe = sim.tribes.get(a.tribeId);
  a.ageTicks++;

  const hardy = 1 - a.traits.hardiness * T.needs.hardinessNeedsRelief;
  a.hunger = Math.min(100, a.hunger + T.needs.hungerPerTick * hardy * sim.hungerRate);
  a.thirst = Math.min(100, a.thirst + T.needs.thirstPerTick * hardy);
  a.stamina = Math.min(100, a.stamina + T.needs.staminaRegenPerTick);
  if (a.breedCooldown > 0) a.breedCooldown--;

  const desired = chooseState(sim, a);
  if (desired !== a.state) {
    a.state = desired;
    clearTarget(a);
  }

  switch (a.state) {
    case AgentState.Rest:
      a.stamina = Math.min(100, a.stamina + T.needs.restStaminaRegen);
      break;

    case AgentState.SeekWater: {
      const here = w.idx(a.x, a.y);
      if (w.water[here] > T.water.minDrinkable) {
        const drink = Math.min(w.water[here], T.water.drinkAmount);
        w.water[here] -= drink;
        a.thirst = Math.max(0, a.thirst - drink * T.water.thirstPerUnit);
        clearTarget(a);
      } else {
        seekTile(sim, a, T.water.seekRadius, (i) => w.water[i] > T.water.minWorthwhile);
      }
      break;
    }

    case AgentState.Forage:
    case AgentState.Hunt:
    case AgentState.Fish: {
      const here = w.idx(a.x, a.y);
      const toolBonus = tribe?.knowledge.unlocked.flint ? T.foraging.toolYieldBonus : 1;
      const fireBonus = tribe?.knowledge.unlocked.fire ? T.foraging.cookingCalorieBonus : 1;
      const stateBonus = a.state === AgentState.Hunt
        ? T.foraging.huntYieldBonus
        : a.state === AgentState.Fish ? T.foraging.fishYieldBonus : 1;
      const potential = w.food[here];
      if (potential > T.foraging.minTileFood) {
        const take = Math.min(potential, T.foraging.baseTakePerTick * toolBonus * stateBonus);
        w.food[here] -= take;
        const calories = take * fireBonus;
        const eaten = Math.min(calories, a.hunger / T.foraging.caloriesPerHungerPoint);
        a.hunger = Math.max(0, a.hunger - eaten * T.foraging.caloriesPerHungerPoint);
        a.carrying = Math.min(CARRY_CAPACITY, a.carrying + Math.max(0, calories - eaten));
        if (a.state === AgentState.Hunt && sim.rng.chance(T.foraging.huntInjuryChance * (1 - a.traits.hardiness))) {
          a.health -= sim.rng.range(T.foraging.huntInjuryMin, T.foraging.huntInjuryMax); // gored
        }
        if (w.food[here] < T.foraging.minTileFood) clearTarget(a);
      } else {
        seekTile(sim, a, T.foraging.seekRadius, (i) => w.food[i] > T.foraging.minWorthwhile);
      }
      break;
    }

    case AgentState.SeekShelter: {
      const here = w.idx(a.x, a.y);
      if (w.shelter[here] > 0) {
        a.stamina = Math.min(100, a.stamina + T.warmth.shelterStaminaRegen);
        a.morale = Math.min(100, a.morale + T.warmth.shelterMoraleGain);
      } else if (tribe) {
        const home = nearestCamp(tribe, a.x, a.y);
        a.tx = home.x;
        a.ty = home.y;
        stepToward(sim, a, home.x, home.y);
      }
      break;
    }

    case AgentState.Deposit: {
      if (!tribe) break;
      const drop = nearestCamp(tribe, a.x, a.y);
      if (a.x === drop.x && a.y === drop.y) {
        tribe.foodStore += a.carrying;
        a.carrying = 0;
        a.morale = Math.min(100, a.morale + T.work.depositMoraleGain);
        clearTarget(a);
      } else {
        stepToward(sim, a, drop.x, drop.y);
      }
      break;
    }

    case AgentState.Craft: {
      if (!tribe) break;
      const here = w.idx(a.x, a.y);
      if (w.stone[here] > T.work.craftStoneCost) {
        w.stone[here] -= T.work.craftStoneCost;
        tribe.stoneStore += T.work.craftStoneCost;
        tribe.toolStore += T.work.craftToolYield;
      } else if (tribe.stoneStore > T.work.craftFromStoreCost) {
        tribe.stoneStore -= T.work.craftFromStoreCost;
        tribe.toolStore += T.work.craftFromStoreYield;
      } else {
        seekTile(sim, a, T.work.stoneSeekRadius, (i) => w.stone[i] > T.work.minTileStone);
      }
      break;
    }

    case AgentState.Build: {
      if (!tribe) break;
      const here = w.idx(a.x, a.y);
      if (w.wood[here] > T.work.woodHarvest) {
        w.wood[here] -= T.work.woodHarvest;
        tribe.woodStore += T.work.woodHarvest;
      }
      if (tribe.knowledge.unlocked.farming && sim.canCultivate(here) && tribe.woodStore > T.work.cultivateWoodCost) {
        tribe.woodStore -= T.work.cultivateWoodCost;
        w.cultivated[here] = Math.min(3, w.cultivated[here] + 1);
        w.refreshCaps(here);
        w.markDirty(here);
      } else if (tribe.knowledge.unlocked.shelter && tribe.woodStore > T.work.hutWoodCost) {
        const site = nearestCamp(tribe, a.x, a.y);
        const camp = w.idx(site.x, site.y);
        const cap = tribe.knowledge.unlocked.warfare ? 3 : 2;
        if (w.shelter[camp] < cap) {
          tribe.woodStore -= T.work.hutWoodCost;
          w.shelter[camp] = w.shelter[camp] + 1;
          w.refreshCaps(camp);
          w.markDirty(camp);
        }
      } else if (w.wood[here] <= T.work.woodHarvest) {
        seekTile(sim, a, T.work.woodSeekRadius, (i) => w.wood[i] > T.work.minTileWood);
      }
      break;
    }

    case AgentState.Reproduce: {
      // Pairing itself is resolved tribe-side so both parents are consumed once.
      if (tribe) {
        const home = nearestCamp(tribe, a.x, a.y);
        stepToward(sim, a, home.x, home.y);
        sim.mateQueue.push(a.id);
      }
      break;
    }

    case AgentState.Fight: {
      sim.resolveAgentCombat(a);
      break;
    }

    case AgentState.Socialize: {
      a.morale = Math.min(100, a.morale + T.work.socialiseMoraleGain);
      // Storytelling around the fire; the bulk of research accrues tribe-side.
      if (tribe) sim.addResearch(tribe, a.traits.inquisitiveness * T.work.socialiseResearch);
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
        const r = T.work.exploreRadius;
        const home = tribe ? nearestCamp(tribe, a.x, a.y) : null;
        const ox = home ? home.x : a.x;
        const oy = home ? home.y : a.y;
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
  const hardy = 1 - a.traits.hardiness * T.needs.hardinessDamageRelief;

  if (a.hunger > T.mortality.starvationThreshold) {
    a.health -= (a.hunger - T.mortality.starvationThreshold) * T.mortality.starvationRate * hardy;
  }
  if (a.thirst > T.mortality.dehydrationThreshold) {
    a.health -= (a.thirst - T.mortality.dehydrationThreshold) * T.mortality.dehydrationRate * hardy;
  }
  if (a.sickness > 0) {
    a.sickness--;
    a.health -= T.mortality.sicknessDamage * hardy;
  }

  const warmth = warmthAt(sim, a, i, tribe);
  if (warmth < T.warmth.damageBelow) a.health -= -warmth * T.warmth.damageRate;

  const years = yearsOf(a);
  if (years > ELDER_AGE) a.health -= (years - ELDER_AGE) * T.mortality.elderDecayRate;

  if (
    a.hunger < T.mortality.recoveryHungerBelow &&
    a.thirst < T.mortality.recoveryThirstBelow &&
    a.health < 100
  ) {
    a.health += T.mortality.recoveryRate;
  }
  a.health = Math.min(100, a.health);

  if (a.health <= 0) {
    sim.killAgent(a, causeOfDeath(a, warmth));
    return;
  }
  if (years > MAX_AGE && sim.rng.chance(T.mortality.oldAgeDeathChance)) {
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
