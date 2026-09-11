import {
  Agent, Relation, Tribe, TECHS, TECH_META, TechId,
} from './types.js';
import { TICKS_PER_YEAR } from '../config.js';
import { isAdult, isElder, mixTraits, createAgent, findNearest } from './agents.js';
import { MAX_TRIBES, makeIdentity, placeName, roman } from './names.js';
import { TUNABLES as T } from './tunables.js';
import { campDistance, nearestCamp } from './camps.js';
import type { Simulation } from './simulation.js';

/**
 * Enforce the invariant that an unlocked technology is fully researched.
 *
 * Inheritance paths (fission, subjugation) copy the `unlocked` flag across but
 * scale `progress` down, which left tribes that genuinely know a technique
 * rendering as "known, 60%" — and would let a later recount treat it as still
 * in progress. Knowledge you have is knowledge you have.
 */
export function normaliseKnowledge(tribe: Tribe): void {
  for (const t of TECHS) {
    if (tribe.knowledge.unlocked[t]) {
      tribe.knowledge.progress[t] = Math.max(
        tribe.knowledge.progress[t],
        TECH_META[t].cost,
      );
    }
  }
}

/**
 * Fill in record fields absent from snapshots written before they existed.
 *
 * Uses the tribe's present state as the floor, so an old world resumes with
 * sensible records rather than zeroes that the next tick would beat anyway.
 */
export function ensureRecords(tribe: Tribe, tick: number, population: number): void {
  const t = tribe as Partial<Tribe> & Tribe;
  if (typeof t.peakPopulation !== 'number') {
    t.peakPopulation = population;
    t.peakPopulationTick = tick;
  }
  if (typeof t.peakTerritory !== 'number') {
    t.peakTerritory = tribe.territory.size;
    t.peakTerritoryTick = tick;
  }
  if (typeof t.peakFood !== 'number') t.peakFood = Math.round(tribe.foodStore);
  if (typeof t.peakTechs !== 'number') {
    t.peakTechs = TECHS.filter((k) => tribe.knowledge.unlocked[k]).length;
  }
}

export function emptyKnowledge(): Tribe['knowledge'] {
  const progress = {} as Record<TechId, number>;
  const unlocked = {} as Record<TechId, boolean>;
  for (const t of TECHS) {
    progress[t] = 0;
    unlocked[t] = false;
  }
  return { progress, unlocked };
}

export function createTribe(sim: Simulation, cx: number, cy: number): Tribe {
  const usedTotems = new Set<string>();
  const usedColors = new Set<string>();
  for (const t of sim.tribes.values()) {
    usedTotems.add(t.totem);
    usedColors.add(t.color);
  }
  const ident = makeIdentity(sim.rng, usedTotems, usedColors);
  // A totem freed by a tribe dying gets reissued; the generation is what keeps
  // the third Wolverine distinct from the first.
  const generation = (sim.totemGenerations.get(ident.totem) ?? 0) + 1;
  sim.totemGenerations.set(ident.totem, generation);

  const tribe: Tribe = {
    id: sim.nextTribeId++,
    name: `${ident.name} ${roman(generation)}`,
    totem: ident.totem,
    glyph: ident.glyph,
    generation,
    color: ident.color,
    cx,
    cy,
    camps: [{ x: cx, y: cy }],
    foodStore: 40,
    toolStore: 0,
    woodStore: 0,
    stoneStore: 0,
    knowledge: emptyKnowledge(),
    territory: new Set<number>(),
    relations: {},
    births: 0,
    deaths: 0,
    kills: 0,
    foundedTick: sim.tick,
    extinctTick: null,
    lastFissionTick: sim.tick,
    lastSettlementTick: sim.tick,
    peakPopulation: 0,
    peakPopulationTick: sim.tick,
    peakTerritory: 0,
    peakTerritoryTick: sim.tick,
    peakFood: 0,
    peakTechs: 0,
    stress: 0,
    overlordId: null,
  };
  sim.tribes.set(tribe.id, tribe);
  for (const other of sim.tribes.values()) {
    if (other.id === tribe.id) continue;
    tribe.relations[other.id] = Relation.Neutral;
    other.relations[tribe.id] = Relation.Neutral;
  }
  return tribe;
}

/** How far a tribe of this size reaches when claiming land. */
export function claimRadius(population: number): number {
  return Math.min(
    T.tribe.territoryRadiusMax,
    T.tribe.territoryRadiusBase + Math.sqrt(population) * T.tribe.territoryRadiusPerSqrtPop,
  );
}

/**
 * Claim tiles around the camp.
 *
 * Radius grows with population so territory expansion is an emergent
 * consequence of a tribe thriving rather than a scripted timer. Contested
 * tiles go to whichever tribe's camp is closer.
 */
export function updateTerritory(sim: Simulation, tribe: Tribe): void {
  const w = sim.world;
  const pop = sim.tribePopulation(tribe.id);
  if (pop === 0) return;
  // Each settlement claims its own share of the people, so a tribe with several
  // camps reaches across far more ground than one camp ever could.
  const radius = claimRadius(pop / tribe.camps.length);
  const r = Math.ceil(radius);

  for (const i of tribe.territory) {
    if (w.owner[i] === tribe.id) {
      w.owner[i] = -1;
      w.markDirty(i);
    }
  }
  tribe.territory.clear();

  for (const camp of tribe.camps) {
    for (let dy = -r; dy <= r; dy++) {
      const y = camp.y + dy;
      if (y < 0 || y >= w.height) continue;
      for (let dx = -r; dx <= r; dx++) {
        const x = camp.x + dx;
        if (x < 0 || x >= w.width) continue;
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const i = w.idx(x, y);
        if (!w.isPassable(i)) continue;
        if (tribe.territory.has(i)) continue;

        const current = w.owner[i];
        if (current >= 0 && current !== tribe.id) {
          const rival = sim.tribes.get(current);
          if (rival) {
            // Whichever people has a settlement nearer the tile holds it.
            if (campDistance(rival, x, y) <= d) continue;
            rival.territory.delete(i);
          }
        }
        w.owner[i] = tribe.id;
        tribe.territory.add(i);
        w.markDirty(i);
      }
    }
  }
}

/** Distribute accumulated research into the cheapest un-unlocked technology. */
export function advanceKnowledge(sim: Simulation, tribe: Tribe): void {
  const pending = TECHS.filter((t) => !tribe.knowledge.unlocked[t]);
  if (pending.length === 0) return;

  // Priority reflects Stone Age dependency order, with warfare pulled forward
  // for tribes that are actually at war.
  const atWar = Object.values(tribe.relations).includes(Relation.War);
  const ordered = [...pending].sort((a, b) => {
    const bias = (t: TechId) => (t === 'warfare' && atWar ? -T.research.wartimeWarfareBias : 0);
    return TECH_META[a].cost + bias(a) - (TECH_META[b].cost + bias(b));
  });

  const target = ordered[0];
  if (tribe.knowledge.progress[target] >= TECH_META[target].cost) {
    tribe.knowledge.unlocked[target] = true;
    sim.log({
      kind: 'discovery',
      severity: 'info',
      tribeId: tribe.id,
      x: tribe.cx,
      y: tribe.cy,
      text: `${tribe.name} discovered ${TECH_META[target].label} — ${TECH_META[target].blurb}.`,
    });
    if (target === 'shelter') {
      const camp = sim.world.idx(tribe.cx, tribe.cy);
      sim.world.shelter[camp] = Math.max(1, sim.world.shelter[camp]);
      sim.world.refreshCaps(camp);
      sim.world.markDirty(camp);
    }
  }
}

/** Route a research contribution to whichever tech is next in line. */
export function depositResearch(tribe: Tribe, amount: number): void {
  const pending = TECHS.filter((t) => !tribe.knowledge.unlocked[t]);
  if (pending.length === 0) return;
  const atWar = Object.values(tribe.relations).includes(Relation.War);
  let target = pending[0];
  let best = Infinity;
  for (const t of pending) {
    const cost = TECH_META[t].cost + (t === 'warfare' && atWar ? -T.research.wartimeWarfareBias : 0);
    if (cost < best) {
      best = cost;
      target = t;
    }
  }
  tribe.knowledge.progress[target] += amount;
}

/**
 * Pair up agents that queued to reproduce and spawn children.
 *
 * Gated on tribal food surplus and the carrying capacity of claimed land, so
 * populations self-limit instead of exploding into a starvation cascade.
 */
export function resolveReproduction(sim: Simulation): void {
  if (sim.mateQueue.length === 0) return;
  const byTribe = new Map<number, Agent[]>();
  for (const id of sim.mateQueue) {
    const a = sim.agentById(id);
    if (!a || !a.alive) continue;
    const list = byTribe.get(a.tribeId);
    if (list) list.push(a);
    else byTribe.set(a.tribeId, [a]);
  }
  sim.mateQueue.length = 0;

  for (const [tribeId, candidates] of byTribe) {
    const tribe = sim.tribes.get(tribeId);
    if (!tribe) continue;
    const pop = sim.tribePopulation(tribeId);
    const capacity = sim.territoryCapacity(tribe);
    // Hardship is accounted once per migration check, not here: this runs every
    // tick, and incrementing on both clocks made the counter ratchet up eight
    // times faster than it could decay.
    if (pop >= capacity) continue;

    const males = candidates.filter((a) => a.sex === 0 && a.breedCooldown <= 0);
    const females = candidates.filter((a) => a.sex === 1 && a.breedCooldown <= 0);
    const pairs = Math.min(males.length, females.length);

    for (let p = 0; p < pairs; p++) {
      if (sim.agentCount >= sim.maxAgents) break;
      const m = males[p];
      const f = females[p];
      const cost = T.birth.foodCost;
      if (tribe.foodStore < cost + pop * 2) break;
      // Both parents must be near camp for the pairing to take.
      if (Math.hypot(m.x - f.x, m.y - f.y) > T.birth.pairDistance) continue;
      const conception = T.birth.baseChance +
        Math.min(T.birth.abundanceBonusMax, tribe.foodStore / (pop * T.birth.abundanceDivisorPerHead));
      if (!sim.rng.chance(conception)) continue;

      tribe.foodStore -= cost;
      m.breedCooldown = Math.round(TICKS_PER_YEAR * T.birth.fatherCooldownYears);
      f.breedCooldown = Math.round(TICKS_PER_YEAR * T.birth.motherCooldownYears);

      const child = createAgent(
        sim.nextAgentId++,
        tribeId,
        f.x,
        f.y,
        0,
        sim.rng,
        mixTraits(sim.rng, m.traits, f.traits),
      );
      // Infant mortality is folded into a spawn-time roll rather than modelled
      // tick by tick; it keeps early population curves realistic and cheap.
      if (sim.rng.chance(T.birth.infantMortality)) {
        tribe.deaths++;
        sim.stats.deaths++;
        continue;
      }
      sim.addAgent(child);
      tribe.births++;
      sim.stats.births++;
    }
  }
}

/** Connected regions of a tribe's claimed land (8-neighbour), as tile lists. */
function territoryRegions(sim: Simulation, tribe: Tribe): number[][] {
  const w = sim.world;
  const seen = new Set<number>();
  const regions: number[][] = [];
  for (const start of tribe.territory) {
    if (seen.has(start)) continue;
    const region: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      region.push(i);
      const x = i % w.width;
      const y = (i / w.width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (!w.inBounds(nx, ny)) continue;
          const n = w.idx(nx, ny);
          if (seen.has(n) || !tribe.territory.has(n)) continue;
          seen.add(n);
          stack.push(n);
        }
      }
    }
    regions.push(region);
  }
  return regions;
}

/** The region holding the capital, or the largest if the capital is unclaimed. */
function coreRegion(sim: Simulation, tribe: Tribe): Set<number> {
  const regions = territoryRegions(sim, tribe);
  const capital = sim.world.idx(tribe.cx, tribe.cy);
  const found = regions.find((r) => r.includes(capital)) ??
    regions.reduce<number[]>((a, b) => (b.length > a.length ? b : a), []);
  return new Set(found);
}

function touchesCore(sim: Simulation, core: Set<number>, x: number, y: number): boolean {
  const w = sim.world;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (w.inBounds(nx, ny) && core.has(w.idx(nx, ny))) return true;
    }
  }
  return false;
}

/**
 * Settlements cut off from the tribe's core land break away.
 *
 * Territory is claimed around every settlement, so when a rival's claim, a
 * lost border or open sea separates a settlement's land from the capital's,
 * that settlement is isolated. If enough people live around it, it declares
 * itself a new tribe, taking its settlements, its people and a proportional
 * share of the food. Too few people and the outpost is simply abandoned.
 */
export function splitIsolatedSettlements(sim: Simulation, tribe: Tribe): void {
  if (tribe.camps.length < 2 || tribe.territory.size === 0) return;
  const w = sim.world;
  const regions = territoryRegions(sim, tribe);
  if (regions.length < 2) return;

  const capital = w.idx(tribe.cx, tribe.cy);
  const core = regions.find((r) => r.includes(capital)) ??
    regions.reduce((a, b) => (b.length > a.length ? b : a));

  for (const region of regions) {
    if (region === core) continue;
    const tiles = new Set(region);
    const cut = tribe.camps.filter((c) => tiles.has(w.idx(c.x, c.y)));
    if (cut.length === 0) continue;

    const people = sim.agents.filter((a) => {
      if (!a.alive || a.tribeId !== tribe.id) return false;
      const home = nearestCamp(tribe, a.x, a.y);
      return cut.includes(home);
    });

    // Too few to stand alone, or no colour slot free: abandon the outpost.
    // Its people re-anchor to the nearest settlement still held.
    if (people.length < T.migration.isolatedMinPeople || sim.tribes.size >= MAX_TRIBES) {
      if (people.length < T.migration.isolatedMinPeople) {
        tribe.camps = tribe.camps.filter((c) => !cut.includes(c));
      }
      continue;
    }

    const pop = Math.max(1, sim.tribePopulation(tribe.id));
    const seat = cut[0];
    const breakaway = createTribe(sim, seat.x, seat.y);
    breakaway.camps = cut.map((c) => ({ x: c.x, y: c.y }));

    for (const t of TECHS) {
      breakaway.knowledge.progress[t] = tribe.knowledge.progress[t];
      breakaway.knowledge.unlocked[t] = tribe.knowledge.unlocked[t];
    }
    normaliseKnowledge(breakaway);

    const share = Math.min(1, people.length / pop);
    breakaway.foodStore = tribe.foodStore * share;
    tribe.foodStore -= breakaway.foodStore;

    for (const a of people) a.tribeId = breakaway.id;
    tribe.camps = tribe.camps.filter((c) => !cut.includes(c));

    // Hand the isolated land over now rather than on the next claim pass.
    for (const i of region) {
      tribe.territory.delete(i);
      breakaway.territory.add(i);
      w.owner[i] = breakaway.id;
      w.markDirty(i);
    }

    sim.log({
      kind: 'settlement',
      severity: 'warn',
      tribeId: breakaway.id,
      x: seat.x,
      y: seat.y,
      text: `Cut off from ${tribe.name}, ${cut.length} settlement${cut.length === 1 ? '' : 's'} in the ` +
        `${placeName(seat.x, seat.y, w.width, w.height)} declared independence as ${breakaway.name} ` +
        `(${people.length} people).`,
    });
  }
}

/**
 * Found a further settlement inside the tribe's own reach.
 *
 * This is growth, not division: the people stay one tribe. It is the mechanism
 * that lets a tribe actually occupy a large territory instead of claiming a
 * wide area while living in a single bubble around one camp.
 */
export function foundSettlement(sim: Simulation, tribe: Tribe): void {
  const pop = sim.tribePopulation(tribe.id);
  if (pop === 0) return;
  if (tribe.camps.length >= T.migration.maxCampsPerTribe) return;
  if (pop / tribe.camps.length < T.migration.settlementPopulation) return;
  if (sim.tick - tribe.lastSettlementTick < T.migration.settlementCooldownYears * TICKS_PER_YEAR) {
    return;
  }

  const w = sim.world;
  // Search out from the settlement with the most people pressing on it.
  const origin = tribe.camps.reduce((best, c) => {
    const count = sim.agentsOf(tribe.id).filter((a) => nearestCamp(tribe, a.x, a.y) === c).length;
    return count > best.count ? { camp: c, count } : best;
  }, { camp: tribe.camps[0], count: -1 }).camp;

  const core = coreRegion(sim, tribe);
  const spot = findNearest(w, origin.x, origin.y, T.migration.settlementSearchRadius, (i, x, y) => {
    if (!w.isPassable(i) || w.isWater(i)) return false;
    // Inside the connected core, or unclaimed ground right at its edge — so a
    // new settlement starts joined to the tribe rather than already cut off.
    if (w.owner[i] >= 0 && w.owner[i] !== tribe.id) return false;
    if (!core.has(i) && !touchesCore(sim, core, x, y)) return false;
    for (const c of tribe.camps) {
      if (Math.hypot(x - c.x, y - c.y) < T.migration.settlementMinDistance) return false;
    }
    return w.foodCap[i] > T.migration.settlementMinFoodCap &&
      sim.nearWater(x, y, T.migration.settlementWaterRadius);
  });
  if (!spot) return;

  tribe.camps.push({ x: spot.x, y: spot.y });
  tribe.lastSettlementTick = sim.tick;
  sim.log({
    kind: 'settlement',
    severity: 'info',
    tribeId: tribe.id,
    x: spot.x,
    y: spot.y,
    text: `${tribe.name} founded a settlement in the ${placeName(spot.x, spot.y, w.width, w.height)} ` +
      `(${tribe.camps.length} settlements).`,
  });
}

/**
 * Relocate a camp when the surrounding land is exhausted, and split off a
 * daughter tribe when a settlement outgrows what its territory can feed.
 */
export function migrationAndFission(sim: Simulation, tribe: Tribe): void {
  const w = sim.world;
  const pop = sim.tribePopulation(tribe.id);
  if (pop === 0) return;

  let localFood = 0;
  for (const i of tribe.territory) localFood += w.food[i];
  const perCapita = localFood / Math.max(1, pop);
  // Both pressures are judged on this one clock so a single +1 can be undone
  // by a single -1. `capacity` bites when the land cannot hold more people even
  // though the larder is full; `perCapita` bites when the land is picked bare.
  const overCapacity = pop >= sim.territoryCapacity(tribe);
  const underfed = perCapita < T.tribe.hardshipFoodPerHead;
  const ceiling = T.migration.relocateStress * T.migration.stressCeilingMultiple;
  if (underfed || overCapacity) tribe.stress = Math.min(ceiling, tribe.stress + 1);
  else tribe.stress = Math.max(0, tribe.stress - 1);

  // Move camp toward better ground.
  if (tribe.stress > T.migration.relocateStress) {
    // Desperation runs 0..1 as hardship climbs from the threshold to the
    // ceiling, and progressively lowers the bar for somewhere to go.
    const desperation = Math.min(
      1,
      (tribe.stress - T.migration.relocateStress) / T.migration.relocateStress,
    );
    const minFood =
      T.migration.relocateMinFoodCap * (1 - T.migration.desperationFoodRelief * desperation);
    const waterRadius =
      T.migration.relocateWaterRadius +
      Math.round(T.migration.desperationWaterRadiusBonus * desperation);
    const searchRadius = Math.round(
      T.migration.relocateSearchRadius * (1 + T.migration.desperationSearchBonus * desperation),
    );
    const spot = findNearest(w, tribe.cx, tribe.cy, searchRadius, (i, x, y) => {
      if (!w.isPassable(i) || w.isWater(i)) return false;
      if (w.owner[i] >= 0 && w.owner[i] !== tribe.id) return false;
      return w.foodCap[i] > minFood && sim.nearWater(x, y, waterRadius);
    });
    if (spot && (spot.x !== tribe.cx || spot.y !== tribe.cy)) {
      tribe.camps[0] = { x: spot.x, y: spot.y };
      tribe.cx = spot.x;
      tribe.cy = spot.y;
      tribe.stress = 0;
      sim.log({
        kind: 'migration',
        severity: 'info',
        tribeId: tribe.id,
        x: spot.x,
        y: spot.y,
        text: `${tribe.name} abandoned their camp and migrated to the ${placeName(spot.x, spot.y, w.width, w.height)}.`,
      });
    }
  }

  // Fission: a tribe that has outgrown its land buds off a splinter group.
  const cooldown = T.migration.fissionCooldownYears * TICKS_PER_YEAR;
  const settled = sim.tick - tribe.foundedTick >= cooldown;
  const rested = sim.tick - tribe.lastFissionTick >= cooldown;
  const crowded = pop >= sim.territoryCapacity(tribe) * T.migration.fissionCapacityRatio;
  if (
    pop >= T.migration.fissionPopulation &&
    settled && rested && crowded &&
    sim.tribes.size < MAX_TRIBES &&
    sim.rng.chance(T.migration.fissionChance)
  ) {
    const spot = findNearest(w, tribe.cx, tribe.cy, T.migration.fissionSearchRadius, (i, x, y) => {
      if (!w.isPassable(i) || w.isWater(i)) return false;
      if (w.owner[i] >= 0) return false;
      if (Math.hypot(x - tribe.cx, y - tribe.cy) < T.migration.fissionMinDistance) return false;
      return w.foodCap[i] > T.migration.fissionMinFoodCap && sim.nearWater(x, y, T.migration.fissionWaterRadius);
    });
    if (!spot) return;

    // Decide who leaves *before* founding anything, and take the same share of
    // every age band rather than adults alone.
    //
    // Two bugs lived here. Capping movers at a share of total population while
    // selecting from a list of adults let `slice` swallow every working-age
    // adult, stranding the parent with only children and elders. And a band of
    // pure adults gave the daughter a single narrow age cohort with a built-in
    // fourteen-year gap before anyone else could work or fight — so one war in
    // its first decade wiped out everybody who could hold a spear.
    //
    // Moving a slice of each band keeps both tribes demographically whole.
    const members = sim.agentsOf(tribe.id);
    const share = T.migration.fissionMoverShare;
    const adultBand = members.filter((a) => isAdult(a) && !isElder(a));
    const youngBand = members.filter((a) => !isAdult(a));
    const elderBand = members.filter((a) => isElder(a));

    const leaving = Math.floor(adultBand.length * share);
    if (leaving < T.migration.fissionMinMovers) return;

    const daughter = createTribe(sim, spot.x, spot.y);
    // Splinters inherit the parent's oral tradition, slightly degraded.
    for (const t of TECHS) {
      daughter.knowledge.progress[t] = tribe.knowledge.progress[t] * T.migration.fissionKnowledgeRetained;
      // Knowledge travels with the people who carry it. A splinter band that
      // leaves without a skilled knapper simply loses the technique and has to
      // rediscover it, which is what keeps tech levels uneven across the map.
      daughter.knowledge.unlocked[t] = tribe.knowledge.unlocked[t] && sim.rng.chance(T.migration.fissionTechRetainChance);
    }
    normaliseKnowledge(daughter);
    daughter.foodStore = tribe.foodStore * T.migration.fissionFoodShare;
    tribe.foodStore *= 1 - T.migration.fissionFoodShare;
    daughter.relations[tribe.id] = Relation.Trade;
    tribe.relations[daughter.id] = Relation.Trade;

    tribe.lastFissionTick = sim.tick;

    const movers = [
      ...adultBand.slice(0, leaving),
      ...youngBand.slice(0, Math.floor(youngBand.length * share)),
      ...elderBand.slice(0, Math.floor(elderBand.length * share)),
    ];
    for (const a of movers) {
      a.tribeId = daughter.id;
      a.tx = spot.x;
      a.ty = spot.y;
    }
    sim.log({
      kind: 'settlement',
      severity: 'info',
      tribeId: daughter.id,
      x: spot.x,
      y: spot.y,
      text: `${daughter.name} broke away from ${tribe.name} and settled the ${placeName(spot.x, spot.y, w.width, w.height)}.`,
    });
  }
}

/**
 * Inter-tribal diplomacy.
 *
 * Neighbours compete for the same riverbanks: scarcity plus aggression pushes
 * toward war, surplus plus proximity pushes toward trade.
 */
export function updateDiplomacy(sim: Simulation): void {
  const tribes = [...sim.tribes.values()].filter((t) => sim.tribePopulation(t.id) > 0);
  for (let a = 0; a < tribes.length; a++) {
    for (let b = a + 1; b < tribes.length; b++) {
      const A = tribes[a];
      const B = tribes[b];
      const dist = Math.hypot(A.cx - B.cx, A.cy - B.cy);
      // Two peoples know each other when the land they claim comes close to
      // touching, not when their camps happen to sit within a fixed radius.
      const reach =
        claimRadius(sim.tribePopulation(A.id)) +
        claimRadius(sim.tribePopulation(B.id)) +
        T.diplomacy.contactMargin;
      if (dist > reach) continue;

      const rel = A.relations[B.id] ?? Relation.Neutral;
      if (rel === Relation.Vassal) continue;

      const aggression = sim.tribeAggression(A.id) + sim.tribeAggression(B.id);
      const scarcity = (A.stress + B.stress) / T.diplomacy.scarcityDivisor;
      const contested = sim.contestedTiles(A, B);

      if (rel === Relation.War) {
        // Wars end when one side is bled dry or both sides lose the appetite.
        const popA = sim.tribePopulation(A.id);
        const popB = sim.tribePopulation(B.id);
        if (
          popA < T.diplomacy.exhaustedPopulation ||
          popB < T.diplomacy.exhaustedPopulation ||
          sim.rng.chance(T.diplomacy.peaceChance)
        ) {
          setRelation(A, B, Relation.Neutral);
          sim.warCooldown.set(
            pairKey(A.id, B.id),
            sim.tick + TICKS_PER_YEAR * T.diplomacy.peaceCooldownYears,
          );
          sim.log({
            kind: 'peace',
            severity: 'info',
            tribeId: A.id,
            text: `${A.name} and ${B.name} laid down their spears; an uneasy peace holds.`,
          });
        }
        continue;
      }

      const cooling = (sim.warCooldown.get(pairKey(A.id, B.id)) ?? 0) > sim.tick;
      const warPressure =
        aggression * T.diplomacy.aggressionWeight +
        scarcity +
        contested / T.diplomacy.contestedDivisor +
        (dist < reach * T.diplomacy.proximityFraction ? T.diplomacy.proximityBonus : 0);
      if (!cooling && warPressure > T.diplomacy.warThreshold && sim.rng.chance(T.diplomacy.warChance)) {
        setRelation(A, B, Relation.War);
        sim.log({
          kind: 'war',
          severity: 'critical',
          tribeId: A.id,
          x: Math.round((A.cx + B.cx) / 2),
          y: Math.round((A.cy + B.cy) / 2),
          text: `${A.name} declared war on ${B.name} over the ${placeName(
            Math.round((A.cx + B.cx) / 2), Math.round((A.cy + B.cy) / 2),
            sim.world.width, sim.world.height,
          )}.`,
        });
        continue;
      }

      if (warPressure < T.diplomacy.tradeThreshold && sim.rng.chance(T.diplomacy.tradeChance)) {
        if (rel !== Relation.Trade) {
          setRelation(A, B, Relation.Trade);
          sim.log({
            kind: 'trade',
            severity: 'info',
            tribeId: A.id,
            text: `${A.name} and ${B.name} opened a trade path for tools and dried meat.`,
          });
        }
      }

      if (rel === Relation.Trade && sim.rng.chance(T.diplomacy.tradeRunChance)) runTrade(sim, A, B);
    }
  }
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function setRelation(A: Tribe, B: Tribe, rel: (typeof Relation)[keyof typeof Relation]): void {
  A.relations[B.id] = rel;
  B.relations[A.id] = rel;
}

/** Surplus food flows toward tools, and knowledge leaks along trade routes. */
function runTrade(sim: Simulation, A: Tribe, B: Tribe): void {
  const popA = Math.max(1, sim.tribePopulation(A.id));
  const popB = Math.max(1, sim.tribePopulation(B.id));
  const surplusA = A.foodStore - popA * T.diplomacy.tradeReservePerHead;
  const surplusB = B.foodStore - popB * T.diplomacy.tradeReservePerHead;

  if (surplusA > T.diplomacy.tradeSurplusThreshold && B.toolStore > 3) {
    const food = Math.min(surplusA * T.diplomacy.tradeFraction, T.diplomacy.tradeFoodCap);
    const tools = Math.min(B.toolStore * T.diplomacy.tradeFraction, food / T.diplomacy.tradeFoodPerTool);
    A.foodStore -= food;
    B.foodStore += food;
    B.toolStore -= tools;
    A.toolStore += tools;
  } else if (surplusB > T.diplomacy.tradeSurplusThreshold && A.toolStore > 3) {
    const food = Math.min(surplusB * T.diplomacy.tradeFraction, T.diplomacy.tradeFoodCap);
    const tools = Math.min(A.toolStore * T.diplomacy.tradeFraction, food / T.diplomacy.tradeFoodPerTool);
    B.foodStore -= food;
    A.foodStore += food;
    A.toolStore -= tools;
    B.toolStore += tools;
  }

  // Technology diffusion: contact spreads ideas faster than isolation.
  for (const t of TECHS) {
    if (A.knowledge.unlocked[t] && !B.knowledge.unlocked[t]) {
      B.knowledge.progress[t] += TECH_META[t].cost * T.research.tradeDiffusionRate;
    } else if (B.knowledge.unlocked[t] && !A.knowledge.unlocked[t]) {
      A.knowledge.progress[t] += TECH_META[t].cost * T.research.tradeDiffusionRate;
    }
  }
}

/**
 * Absorb a defeated tribe into the victor.
 *
 * Survivors change allegiance rather than dying, which is what actually
 * happened to most Stone Age groups that lost a territorial war.
 */
export function subjugate(sim: Simulation, victor: Tribe, loser: Tribe): void {
  // Scan the whole roster rather than the per-tribe index: this must not miss
  // anybody, or the leftovers are orphaned when the tribe is retired.
  const survivors = sim.agents.filter((a) => a.alive && a.tribeId === loser.id);
  for (const a of survivors) {
    a.tribeId = victor.id;
    a.morale = Math.max(10, a.morale - T.diplomacy.subjugationMoralePenalty);
  }
  // The victor takes the loser's settlements as well as its people; an empire
  // is built out of the towns it absorbs.
  for (const camp of loser.camps) {
    if (!victor.camps.some((c) => c.x === camp.x && c.y === camp.y)) victor.camps.push(camp);
  }
  victor.foodStore += loser.foodStore;
  victor.toolStore += loser.toolStore;
  for (const t of TECHS) {
    victor.knowledge.progress[t] = Math.max(
      victor.knowledge.progress[t],
      loser.knowledge.progress[t] * T.diplomacy.subjugationKnowledgeRetained,
    );
    victor.knowledge.unlocked[t] = victor.knowledge.unlocked[t] || loser.knowledge.unlocked[t];
  }
  normaliseKnowledge(victor);
  loser.extinctTick = sim.tick;
  loser.overlordId = victor.id;
  sim.log({
    kind: 'extinction',
    severity: 'warn',
    tribeId: victor.id,
    x: loser.cx,
    y: loser.cy,
    text: `${loser.name} was subjugated by ${victor.name}; ${survivors.length} survivors were absorbed.`,
  });
  sim.retireTribe(loser.id);
}
