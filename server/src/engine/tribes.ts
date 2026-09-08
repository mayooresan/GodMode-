import {
  Agent, Relation, Tribe, TECHS, TECH_META, TechId,
} from './types.js';
import { TICKS_PER_YEAR } from '../config.js';
import { isAdult, isElder, mixTraits, createAgent, findNearest } from './agents.js';
import { MAX_TRIBES, makeIdentity, placeName } from './names.js';
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
  const tribe: Tribe = {
    id: sim.nextTribeId++,
    name: ident.name,
    totem: ident.totem,
    glyph: ident.glyph,
    color: ident.color,
    cx,
    cy,
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
  const radius = Math.min(18, 3 + Math.sqrt(pop) * 1.5);
  const r = Math.ceil(radius);

  for (const i of tribe.territory) {
    if (w.owner[i] === tribe.id) {
      w.owner[i] = -1;
      w.markDirty(i);
    }
  }
  tribe.territory.clear();

  for (let dy = -r; dy <= r; dy++) {
    const y = tribe.cy + dy;
    if (y < 0 || y >= w.height) continue;
    for (let dx = -r; dx <= r; dx++) {
      const x = tribe.cx + dx;
      if (x < 0 || x >= w.width) continue;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const i = w.idx(x, y);
      if (!w.isPassable(i)) continue;

      const current = w.owner[i];
      if (current >= 0 && current !== tribe.id) {
        const rival = sim.tribes.get(current);
        if (rival) {
          const rd = Math.hypot(rival.cx - x, rival.cy - y);
          if (rd <= d) continue; // rival is closer; they keep it
          rival.territory.delete(i);
        }
      }
      w.owner[i] = tribe.id;
      tribe.territory.add(i);
      w.markDirty(i);
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
    const bias = (t: TechId) => (t === 'warfare' && atWar ? -3000 : 0);
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
    const cost = TECH_META[t].cost + (t === 'warfare' && atWar ? -3000 : 0);
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
    if (pop >= capacity) {
      tribe.stress += 1;
      continue;
    }

    const males = candidates.filter((a) => a.sex === 0 && a.breedCooldown <= 0);
    const females = candidates.filter((a) => a.sex === 1 && a.breedCooldown <= 0);
    const pairs = Math.min(males.length, females.length);

    for (let p = 0; p < pairs; p++) {
      if (sim.agentCount >= sim.maxAgents) break;
      const m = males[p];
      const f = females[p];
      const cost = 14;
      if (tribe.foodStore < cost + pop * 2) break;
      // Both parents must be near camp for the pairing to take.
      if (Math.hypot(m.x - f.x, m.y - f.y) > 6) continue;
      if (!sim.rng.chance(0.32 + Math.min(0.3, tribe.foodStore / (pop * 40)))) continue;

      tribe.foodStore -= cost;
      m.breedCooldown = Math.round(TICKS_PER_YEAR * 0.8);
      f.breedCooldown = Math.round(TICKS_PER_YEAR * 1.6);

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
      if (sim.rng.chance(0.12)) {
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
  if (perCapita < 4) tribe.stress += 1;
  else tribe.stress = Math.max(0, tribe.stress - 1);

  // Move camp toward better ground.
  if (tribe.stress > 40) {
    const spot = findNearest(w, tribe.cx, tribe.cy, 26, (i, x, y) => {
      if (!w.isPassable(i) || w.isWater(i)) return false;
      if (w.owner[i] >= 0 && w.owner[i] !== tribe.id) return false;
      return w.foodCap[i] > 30 && sim.nearWater(x, y, 4);
    });
    if (spot && (spot.x !== tribe.cx || spot.y !== tribe.cy)) {
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

  // Fission: a large tribe buds off a splinter group.
  if (pop >= 55 && sim.tribes.size < MAX_TRIBES && sim.rng.chance(0.06)) {
    const spot = findNearest(w, tribe.cx, tribe.cy, 34, (i, x, y) => {
      if (!w.isPassable(i) || w.isWater(i)) return false;
      if (w.owner[i] >= 0) return false;
      if (Math.hypot(x - tribe.cx, y - tribe.cy) < 12) return false;
      return w.foodCap[i] > 26 && sim.nearWater(x, y, 5);
    });
    if (!spot) return;

    const daughter = createTribe(sim, spot.x, spot.y);
    // Splinters inherit the parent's oral tradition, slightly degraded.
    for (const t of TECHS) {
      daughter.knowledge.progress[t] = tribe.knowledge.progress[t] * 0.6;
      // Knowledge travels with the people who carry it. A splinter band that
      // leaves without a skilled knapper simply loses the technique and has to
      // rediscover it, which is what keeps tech levels uneven across the map.
      daughter.knowledge.unlocked[t] = tribe.knowledge.unlocked[t] && sim.rng.chance(0.7);
    }
    normaliseKnowledge(daughter);
    daughter.foodStore = tribe.foodStore * 0.3;
    tribe.foodStore *= 0.7;
    daughter.relations[tribe.id] = Relation.Trade;
    tribe.relations[daughter.id] = Relation.Trade;

    const movers = sim
      .agentsOf(tribe.id)
      .filter((a) => isAdult(a) && !isElder(a))
      .slice(0, Math.floor(pop * 0.35));
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
      if (dist > 34) continue;

      const rel = A.relations[B.id] ?? Relation.Neutral;
      if (rel === Relation.Vassal) continue;

      const aggression = sim.tribeAggression(A.id) + sim.tribeAggression(B.id);
      const scarcity = (A.stress + B.stress) / 80;
      const contested = sim.contestedTiles(A, B);

      if (rel === Relation.War) {
        // Wars end when one side is bled dry or both sides lose the appetite.
        const popA = sim.tribePopulation(A.id);
        const popB = sim.tribePopulation(B.id);
        if (popA < 6 || popB < 6 || sim.rng.chance(0.008)) {
          setRelation(A, B, Relation.Neutral);
          sim.warCooldown.set(pairKey(A.id, B.id), sim.tick + TICKS_PER_YEAR * 2);
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
      const warPressure = aggression * 0.5 + scarcity + contested / 40 + (dist < 16 ? 0.3 : 0);
      if (!cooling && warPressure > 1.35 && sim.rng.chance(0.05)) {
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

      if (warPressure < 0.7 && sim.rng.chance(0.03)) {
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

      if (rel === Relation.Trade && sim.rng.chance(0.2)) runTrade(sim, A, B);
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
  const surplusA = A.foodStore - popA * 6;
  const surplusB = B.foodStore - popB * 6;

  if (surplusA > 20 && B.toolStore > 3) {
    const food = Math.min(surplusA * 0.3, 40);
    const tools = Math.min(B.toolStore * 0.3, food / 8);
    A.foodStore -= food;
    B.foodStore += food;
    B.toolStore -= tools;
    A.toolStore += tools;
  } else if (surplusB > 20 && A.toolStore > 3) {
    const food = Math.min(surplusB * 0.3, 40);
    const tools = Math.min(A.toolStore * 0.3, food / 8);
    B.foodStore -= food;
    A.foodStore += food;
    A.toolStore -= tools;
    B.toolStore += tools;
  }

  // Technology diffusion: contact spreads ideas faster than isolation.
  for (const t of TECHS) {
    if (A.knowledge.unlocked[t] && !B.knowledge.unlocked[t]) {
      B.knowledge.progress[t] += TECH_META[t].cost * 0.02;
    } else if (B.knowledge.unlocked[t] && !A.knowledge.unlocked[t]) {
      A.knowledge.progress[t] += TECH_META[t].cost * 0.02;
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
  const survivors = sim.agentsOf(loser.id);
  for (const a of survivors) {
    a.tribeId = victor.id;
    a.morale = Math.max(10, a.morale - 25);
  }
  victor.foodStore += loser.foodStore;
  victor.toolStore += loser.toolStore;
  for (const t of TECHS) {
    victor.knowledge.progress[t] = Math.max(
      victor.knowledge.progress[t],
      loser.knowledge.progress[t] * 0.8,
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
