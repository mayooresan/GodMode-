import {
  Agent, AgentState, AGENT_STATE_INDEX, Biome, OCCUPATIONS, OCCUPATION_OF_STATE,
  Relation, TECHS, TECH_META, Tribe, Vitals, WorldEvent,
} from './types.js';
import { World, generateWorld } from './world.js';
import { Rng } from './rng.js';
import {
  createAgent, isAdult, isElder, mixTraits, stepAgent, yearsOf, findNearest,
} from './agents.js';
import {
  advanceKnowledge, createTribe, depositResearch, migrationAndFission,
  resolveReproduction, setRelation, subjugate, updateDiplomacy, updateTerritory,
} from './tribes.js';
import { placeName } from './names.js';
import { ADULT_AGE, ELDER_AGE, TICKS_PER_YEAR, config } from '../config.js';

export interface SimOptions {
  width: number;
  height: number;
  seed: number;
  startingTribes: number;
  startingAgentsPerTribe: number;
  maxAgents: number;
  eventLogSize: number;
}

/** A time-limited global or regional modifier created by a god intervention. */
interface ActiveEffect {
  kind: 'long_winter' | 'pestilence' | 'famine' | 'flood';
  ticksLeft: number;
  x?: number;
  y?: number;
  radius?: number;
  magnitude: number;
}

const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];

/**
 * The simulation kernel.
 *
 * `step()` is the only mutation entry point for autonomous progress; god
 * interventions mutate state directly between ticks. Everything the dashboard
 * needs is derived here so the transport layer stays a dumb pipe.
 */
export class Simulation {
  world: World;
  rng: Rng;
  readonly opts: SimOptions;

  agents: Agent[] = [];
  private byId = new Map<number, Agent>();
  private byTribe = new Map<number, Agent[]>();
  /** Tile index -> agent ids standing on it; rebuilt once per tick. */
  private occupancy = new Map<number, number[]>();

  tribes = new Map<number, Tribe>();
  retiredTribes: Tribe[] = [];

  tick = 0;
  startedAt = Date.now();
  paused = false;
  tickMs = config.tickMs;

  nextAgentId = 1;
  nextTribeId = 1;

  /** Agents that queued a mating attempt this tick. */
  mateQueue: number[] = [];
  /** Agents mobilised for war this tick. */
  warBand = new Set<number>();
  warCooldown = new Map<string, number>();

  temperature = 14;
  hungerRate = 1;
  effects: ActiveEffect[] = [];

  events: WorldEvent[] = [];
  private eventSeq = 0;

  stats = { births: 0, deaths: 0 };
  private birthWindow: number[] = [];
  private deathWindow: number[] = [];
  /** Wall-clock tick durations, for the observed ticks/second readout. */
  private tickDurations: number[] = [];

  constructor(opts: SimOptions) {
    this.opts = opts;
    this.rng = new Rng(opts.seed);
    this.world = generateWorld(opts.width, opts.height, opts.seed);
  }

  get maxAgents(): number {
    return this.opts.maxAgents;
  }

  get agentCount(): number {
    return this.byId.size;
  }

  // ---------------------------------------------------------------- bootstrap

  /** Seed the world with founding tribes on habitable, watered ground. */
  seed(): void {
    for (let t = 0; t < this.opts.startingTribes; t++) {
      const spot = this.findHabitableSpot();
      if (!spot) break;
      const tribe = createTribe(this, spot.x, spot.y);
      for (let a = 0; a < this.opts.startingAgentsPerTribe; a++) {
        const agent = createAgent(
          this.nextAgentId++,
          tribe.id,
          this.world.clampX(spot.x + this.rng.int(-2, 2)),
          this.world.clampY(spot.y + this.rng.int(-2, 2)),
          this.rng.range(ADULT_AGE, 34),
          this.rng,
          mixTraits(this.rng),
        );
        this.addAgent(agent);
      }
      updateTerritory(this, tribe);
      this.log({
        kind: 'settlement',
        severity: 'info',
        tribeId: tribe.id,
        x: spot.x,
        y: spot.y,
        text: `${tribe.name} settled the ${placeName(spot.x, spot.y, this.world.width, this.world.height)}.`,
      });
    }
    this.log({ kind: 'system', severity: 'info', text: `World seeded (${this.opts.width}x${this.opts.height}, seed ${this.opts.seed}).` });
  }

  private findHabitableSpot(): { x: number; y: number } | null {
    for (let attempt = 0; attempt < 4000; attempt++) {
      const x = this.rng.int(4, this.world.width - 5);
      const y = this.rng.int(4, this.world.height - 5);
      const i = this.world.idx(x, y);
      if (this.world.isWater(i) || !this.world.isPassable(i)) continue;
      if (this.world.owner[i] >= 0) continue;
      if (this.world.foodCap[i] < 24) continue;
      if (!this.nearWater(x, y, 5)) continue;
      let tooClose = false;
      for (const t of this.tribes.values()) {
        if (Math.hypot(t.cx - x, t.cy - y) < 16) tooClose = true;
      }
      if (tooClose) continue;
      return { x, y };
    }
    // Relaxed fallback so seeding never fails on an unlucky map.
    for (let attempt = 0; attempt < 4000; attempt++) {
      const x = this.rng.int(1, this.world.width - 2);
      const y = this.rng.int(1, this.world.height - 2);
      const i = this.world.idx(x, y);
      if (!this.world.isWater(i) && this.world.isPassable(i)) return { x, y };
    }
    return null;
  }

  // ------------------------------------------------------------------ indexes

  addAgent(a: Agent): void {
    this.agents.push(a);
    this.byId.set(a.id, a);
  }

  agentById(id: number): Agent | undefined {
    return this.byId.get(id);
  }

  agentsOf(tribeId: number): Agent[] {
    return this.byTribe.get(tribeId) ?? [];
  }

  tribePopulation(tribeId: number): number {
    return this.byTribe.get(tribeId)?.length ?? 0;
  }

  /** Mean aggression of a tribe's adults; drives war pressure. */
  tribeAggression(tribeId: number): number {
    const list = this.agentsOf(tribeId);
    if (list.length === 0) return 0;
    let sum = 0;
    for (const a of list) sum += a.traits.aggression;
    return sum / list.length;
  }

  private reindex(): void {
    this.byTribe.clear();
    this.occupancy.clear();
    for (const a of this.agents) {
      if (!a.alive) continue;
      const list = this.byTribe.get(a.tribeId);
      if (list) list.push(a);
      else this.byTribe.set(a.tribeId, [a]);

      const i = this.world.idx(a.x, a.y);
      const occ = this.occupancy.get(i);
      if (occ) occ.push(a.id);
      else this.occupancy.set(i, [a.id]);
    }
  }

  /** Drop dead agents once they are a meaningful share of the array. */
  private compact(): void {
    let dead = 0;
    for (const a of this.agents) if (!a.alive) dead++;
    if (dead > 64 && dead > this.agents.length * 0.25) {
      this.agents = this.agents.filter((a) => a.alive);
    }
  }

  // ------------------------------------------------------------------ helpers

  nearWater(x: number, y: number, r: number): boolean {
    const w = this.world;
    for (let dy = -r; dy <= r; dy++) {
      const ay = y + dy;
      if (ay < 0 || ay >= w.height) continue;
      for (let dx = -r; dx <= r; dx++) {
        const ax = x + dx;
        if (ax < 0 || ax >= w.width) continue;
        if (w.water[w.idx(ax, ay)] > 20) return true;
      }
    }
    return false;
  }

  adjacentWater(x: number, y: number): boolean {
    return this.nearWater(x, y, 1);
  }

  canCultivate(i: number): boolean {
    const b = this.world.biome[i];
    return (b === Biome.Plains || b === Biome.Forest) && this.world.cultivated[i] < 3;
  }

  /** How many people the tribe's claimed tiles can sustain. */
  territoryCapacity(tribe: Tribe): number {
    let cap = 0;
    for (const i of tribe.territory) cap += this.world.carrying[i];
    const techBonus = 1 +
      (tribe.knowledge.unlocked.farming ? 0.5 : 0) +
      (tribe.knowledge.unlocked.shelter ? 0.3 : 0) +
      (tribe.knowledge.unlocked.fire ? 0.15 : 0);
    return Math.max(8, cap * 0.12 * techBonus);
  }

  contestedTiles(A: Tribe, B: Tribe): number {
    let n = 0;
    const smaller = A.territory.size < B.territory.size ? A : B;
    const larger = smaller === A ? B : A;
    for (const i of smaller.territory) {
      const x = i % this.world.width;
      const y = (i / this.world.width) | 0;
      if (Math.hypot(x - larger.cx, y - larger.cy) < 14) n++;
    }
    return n;
  }

  addResearch(tribe: Tribe, amount: number): void {
    const fed = tribe.foodStore > this.tribePopulation(tribe.id) * 4 ? 1.4 : 1;
    depositResearch(tribe, amount * fed);
  }

  log(e: Omit<WorldEvent, 'tick' | 'at'>): void {
    const event: WorldEvent = { ...e, tick: this.tick, at: Date.now() };
    this.events.push(event);
    this.eventSeq++;
    if (this.events.length > this.opts.eventLogSize) {
      this.events.splice(0, this.events.length - this.opts.eventLogSize);
    }
  }

  killAgent(a: Agent, cause: string): void {
    if (!a.alive) return;
    a.alive = false;
    this.byId.delete(a.id);
    this.warBand.delete(a.id);
    this.stats.deaths++;
    const tribe = this.tribes.get(a.tribeId);
    if (tribe) tribe.deaths++;
    this.deathsByCause.set(cause, (this.deathsByCause.get(cause) ?? 0) + 1);
  }

  private deathsByCause = new Map<string, number>();

  /**
   * Individual deaths are far too frequent to log one by one; instead the
   * dominant cause is summarised whenever a batch crosses a visible threshold.
   */
  private reportDeaths(): void {
    let worstCause = '';
    let worstCount = 0;
    for (const [cause, n] of this.deathsByCause) {
      if (n > worstCount) {
        worstCount = n;
        worstCause = cause;
      }
    }
    if (worstCount >= 4 && worstCause !== 'combat' && worstCause !== 'old age') {
      this.log({
        kind: 'death',
        severity: 'warn',
        text: `${worstCount} died of ${worstCause} this season.`,
      });
    }
    this.deathsByCause.clear();
  }

  retireTribe(id: number): void {
    const tribe = this.tribes.get(id);
    if (!tribe) return;
    for (const i of tribe.territory) {
      if (this.world.owner[i] === id) {
        this.world.owner[i] = -1;
        this.world.markDirty(i);
      }
    }
    tribe.territory.clear();
    this.tribes.delete(id);
    this.retiredTribes.push(tribe);
    if (this.retiredTribes.length > 80) this.retiredTribes.shift();
    for (const other of this.tribes.values()) delete other.relations[id];
  }

  // --------------------------------------------------------------- climate

  private updateClimate(): void {
    const phase = (this.tick % TICKS_PER_YEAR) / TICKS_PER_YEAR;
    // Peak summer a quarter-year after the origin; winter dips below freezing.
    let temp = 13 + 17 * Math.sin(phase * Math.PI * 2 - Math.PI / 2);
    this.hungerRate = 1;

    for (const fx of this.effects) {
      if (fx.kind === 'long_winter') temp -= fx.magnitude;
      if (fx.kind === 'famine') this.hungerRate += fx.magnitude;
    }
    this.temperature = temp;
  }

  /** Seasonal growth multiplier applied to tile regeneration. */
  private seasonalGrowth(): number {
    const t = this.temperature;
    if (t <= 0) return 0.15;
    return Math.min(1.6, 0.35 + t / 22);
  }

  seasonName(): string {
    const phase = (this.tick % TICKS_PER_YEAR) / TICKS_PER_YEAR;
    return SEASONS[Math.floor(phase * 4) % 4];
  }

  private tickEffects(): void {
    for (const fx of this.effects) {
      fx.ticksLeft--;
      if (fx.kind === 'pestilence' && fx.x !== undefined && fx.y !== undefined) {
        const r = fx.radius ?? 12;
        for (const a of this.agents) {
          if (!a.alive || a.sickness > 0) continue;
          if (Math.hypot(a.x - fx.x, a.y - fx.y) > r) continue;
          if (this.rng.chance(0.06 * fx.magnitude)) a.sickness = this.rng.int(10, 40);
        }
      }
    }
    const expired = this.effects.filter((f) => f.ticksLeft <= 0);
    for (const fx of expired) {
      this.log({
        kind: 'disaster',
        severity: 'info',
        text: `The ${fx.kind.replace('_', ' ')} has passed.`,
      });
    }
    this.effects = this.effects.filter((f) => f.ticksLeft > 0);
  }

  // ------------------------------------------------------------------ combat

  /** Mobilise a share of each warring tribe's adults into the war band. */
  private mobilise(): void {
    this.warBand.clear();
    for (const tribe of this.tribes.values()) {
      const enemies = Object.entries(tribe.relations)
        .filter(([, r]) => r === Relation.War)
        .map(([id]) => Number(id));
      if (enemies.length === 0) continue;
      const roster = this.agentsOf(tribe.id).filter(
        (a) => isAdult(a) && !isElder(a) && a.health > 45 && a.hunger < 70,
      );
      roster.sort((a, b) => b.traits.aggression - a.traits.aggression);
      const share = tribe.knowledge.unlocked.warfare ? 0.45 : 0.28;
      const count = Math.min(roster.length, Math.ceil(roster.length * share));
      for (let i = 0; i < count; i++) this.warBand.add(roster[i].id);
    }
  }

  /** Move a warrior toward the nearest enemy and resolve a melee if adjacent. */
  resolveAgentCombat(a: Agent): void {
    const tribe = this.tribes.get(a.tribeId);
    if (!tribe) return;
    const enemyIds = new Set(
      Object.entries(tribe.relations)
        .filter(([, r]) => r === Relation.War)
        .map(([id]) => Number(id)),
    );
    if (enemyIds.size === 0) return;

    // Look for an enemy in melee range using the per-tick occupancy index.
    let target: Agent | null = null;
    for (let dy = -1; dy <= 1 && !target; dy++) {
      for (let dx = -1; dx <= 1 && !target; dx++) {
        const nx = a.x + dx;
        const ny = a.y + dy;
        if (!this.world.inBounds(nx, ny)) continue;
        const occ = this.occupancy.get(this.world.idx(nx, ny));
        if (!occ) continue;
        for (const id of occ) {
          const other = this.byId.get(id);
          if (other && other.alive && enemyIds.has(other.tribeId)) {
            target = other;
            break;
          }
        }
      }
    }

    if (target) {
      this.melee(a, target);
      return;
    }

    // Otherwise march on the nearest enemy camp.
    let best: Tribe | null = null;
    let bestD = Infinity;
    for (const id of enemyIds) {
      const t = this.tribes.get(id);
      if (!t) continue;
      const d = Math.hypot(t.cx - a.x, t.cy - a.y);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (best) {
      a.tx = best.cx;
      a.ty = best.cy;
      const dx = Math.sign(best.cx - a.x);
      const dy = Math.sign(best.cy - a.y);
      const nx = this.world.clampX(a.x + dx);
      const ny = this.world.clampY(a.y + dy);
      if (this.world.isPassable(this.world.idx(nx, ny)) && a.stamina > 6) {
        a.x = nx;
        a.y = ny;
        a.stamina -= 2;
      }
    }
  }

  private melee(a: Agent, b: Agent): void {
    const power = (x: Agent) => {
      const t = this.tribes.get(x.tribeId);
      const tools = t ? Math.min(1, t.toolStore / Math.max(1, this.tribePopulation(t.id))) : 0;
      const tech = t?.knowledge.unlocked.warfare ? 1.45 : 1;
      const fort = this.world.shelter[this.world.idx(x.x, x.y)] >= 3 ? 1.3 : 1;
      return (x.health / 100) * (1 + tools * 0.6) * (0.6 + x.traits.aggression) * tech * fort;
    };
    const pa = power(a) * this.rng.range(0.7, 1.3);
    const pb = power(b) * this.rng.range(0.7, 1.3);
    const swing = 26;
    if (pa >= pb) {
      b.health -= swing * (pa / Math.max(0.1, pb));
      a.health -= swing * 0.28;
    } else {
      a.health -= swing * (pb / Math.max(0.1, pa));
      b.health -= swing * 0.28;
    }

    for (const [loser, winner] of [[a, b], [b, a]] as const) {
      if (loser.health <= 0 && loser.alive) {
        const winnerTribe = this.tribes.get(winner.tribeId);
        if (winnerTribe) winnerTribe.kills++;
        this.killAgent(loser, 'combat');
        // Keyed by the belligerent pair so the log can name both sides.
        const key = a.tribeId < b.tribeId
          ? `${a.tribeId}:${b.tribeId}`
          : `${b.tribeId}:${a.tribeId}`;
        this.battleCasualties.set(key, (this.battleCasualties.get(key) ?? 0) + 1);
      }
    }
  }

  /** Casualties this tick, keyed by "lowTribeId:highTribeId". */
  private battleCasualties = new Map<string, number>();
  /** Running totals per front, so we log one line per engagement, not per death. */
  private battleTotals = new Map<string, number>();

  /**
   * Summarise melees into readable skirmish entries.
   *
   * Casualties accumulate per front and are only flushed to the log once they
   * reach a threshold, which keeps a long war from drowning out every other
   * event in the ticker.
   */
  private reportBattles(): void {
    for (const [key, n] of this.battleCasualties) {
      this.battleTotals.set(key, (this.battleTotals.get(key) ?? 0) + n);
    }
    this.battleCasualties.clear();

    for (const [key, total] of [...this.battleTotals]) {
      if (total < 3) continue;
      const [aId, bId] = key.split(':').map(Number);
      const A = this.tribes.get(aId);
      const B = this.tribes.get(bId);
      const shortName = (t?: Tribe) => t?.totem ?? 'a forgotten people';
      this.log({
        kind: 'battle',
        severity: 'warn',
        tribeId: aId,
        x: A ? Math.round((A.cx + (B?.cx ?? A.cx)) / 2) : undefined,
        y: A ? Math.round((A.cy + (B?.cy ?? A.cy)) / 2) : undefined,
        text: `Skirmish between ${shortName(A)} and ${shortName(B)} tribes: ${total} casualties.`,
      });
      this.battleTotals.delete(key);
    }
  }

  /** End wars that have become one-sided by absorbing the losing tribe. */
  private resolveConquest(): void {
    for (const tribe of [...this.tribes.values()]) {
      const pop = this.tribePopulation(tribe.id);
      if (pop === 0 || pop > 8) continue;
      for (const [idStr, rel] of Object.entries(tribe.relations)) {
        if (rel !== Relation.War) continue;
        const rival = this.tribes.get(Number(idStr));
        if (!rival) continue;
        if (this.tribePopulation(rival.id) > pop * 3) {
          subjugate(this, rival, tribe);
          break;
        }
      }
    }
  }

  // -------------------------------------------------------------------- tick

  /** Advance the world by exactly one tick. */
  step(): void {
    const t0 = Date.now();
    this.tick++;

    this.updateClimate();
    this.tickEffects();
    this.world.regenerate(this.seasonalGrowth());
    this.reindex();
    this.mobilise();

    for (const a of this.agents) {
      if (a.alive) stepAgent(this, a);
    }

    this.reportBattles();
    resolveReproduction(this);

    // Tribe-level bookkeeping is staggered so a 128x128 world with 15 tribes
    // does not pay the full territory recompute every tick.
    for (const tribe of this.tribes.values()) {
      // Oral tradition: every adult contributes a little know-how each tick,
      // scaled by curiosity. This is the steady drip that eventually unlocks
      // technologies; individual states only add bonuses on top.
      let curiosity = 0;
      for (const a of this.agentsOf(tribe.id)) {
        if (isAdult(a)) curiosity += a.traits.inquisitiveness;
      }
      this.addResearch(tribe, curiosity * 0.3);
      advanceKnowledge(this, tribe);
      this.rationFood(tribe);
      // Communal stores spoil; there is no granary in the Stone Age, so a
      // store is a buffer that carries a tribe through a bad winter, never a
      // bank that grows for ever.
      tribe.foodStore = Math.max(0, tribe.foodStore * 0.995);
      if ((this.tick + tribe.id) % 8 === 0) {
        updateTerritory(this, tribe);
        migrationAndFission(this, tribe);
      }
    }

    if (this.tick % 12 === 0) updateDiplomacy(this);
    if (this.tick % 24 === 0) this.reportDeaths();
    this.resolveConquest();
    this.cullExtinctTribes();
    this.compact();

    this.birthWindow.push(this.stats.births);
    this.deathWindow.push(this.stats.deaths);
    this.stats.births = 0;
    this.stats.deaths = 0;
    if (this.birthWindow.length > 60) this.birthWindow.shift();
    if (this.deathWindow.length > 60) this.deathWindow.shift();

    this.tickDurations.push(Date.now() - t0);
    if (this.tickDurations.length > 30) this.tickDurations.shift();
  }

  /**
   * Feed the tribe from its communal store.
   *
   * Without this the store is write-only: agents deposit into it, nothing ever
   * draws it down, and every tribe drifts into permanent surplus where nobody
   * needs to forage. Rationing makes the store the buffer it is meant to be —
   * it carries a tribe through winter, and it runs dry in a famine.
   */
  private rationFood(tribe: Tribe): void {
    if (tribe.foodStore <= 0) return;
    const members = this.agentsOf(tribe.id);
    if (members.length === 0) return;

    // The hungriest eat first, and only those close enough to reach the camp.
    const eligible = members
      .filter((a) => a.hunger > 25 && Math.hypot(a.x - tribe.cx, a.y - tribe.cy) < 12)
      .sort((x, y) => y.hunger - x.hunger);

    for (const a of eligible) {
      if (tribe.foodStore <= 0) break;
      // Children and elders are fed even when they cannot forage for themselves.
      const need = Math.min((a.hunger - 20) / 3.2, 6);
      const served = Math.min(need, tribe.foodStore);
      if (served <= 0.05) continue;
      tribe.foodStore -= served;
      a.hunger = Math.max(0, a.hunger - served * 3.2);
    }
  }

  private cullExtinctTribes(): void {
    for (const tribe of [...this.tribes.values()]) {
      if (this.tribePopulation(tribe.id) > 0) continue;
      // Give a freshly founded tribe a grace period before declaring it dead.
      if (this.tick - tribe.foundedTick < 5) continue;
      tribe.extinctTick = this.tick;
      this.log({
        kind: 'extinction',
        severity: 'critical',
        tribeId: tribe.id,
        x: tribe.cx,
        y: tribe.cy,
        text: `${tribe.name} died out after ${Math.max(1, Math.round((this.tick - tribe.foundedTick) / TICKS_PER_YEAR))} years.`,
      });
      this.retireTribe(tribe.id);
    }
  }

  // ------------------------------------------------------------- projections

  vitals(): Vitals {
    let infants = 0;
    let adults = 0;
    let elders = 0;
    for (const a of this.agents) {
      if (!a.alive) continue;
      const y = yearsOf(a);
      if (y < ADULT_AGE) infants++;
      else if (y < ELDER_AGE) adults++;
      else elders++;
    }
    const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0);
    const windowLen = Math.max(1, this.birthWindow.length);
    let totalFood = 0;
    let claimed = 0;
    for (const t of this.tribes.values()) {
      totalFood += t.foodStore;
      claimed += t.territory.size;
    }
    const avgTick = this.tickDurations.length
      ? sum(this.tickDurations) / this.tickDurations.length
      : 0;

    return {
      tick: this.tick,
      population: infants + adults + elders,
      infants,
      adults,
      elders,
      tribes: this.tribes.size,
      births: sum(this.birthWindow),
      deaths: sum(this.deathWindow),
      birthRate: sum(this.birthWindow) / windowLen,
      deathRate: sum(this.deathWindow) / windowLen,
      season: this.seasonName(),
      temperature: Math.round(this.temperature * 10) / 10,
      year: Math.floor(this.tick / TICKS_PER_YEAR),
      elapsedMs: Date.now() - this.startedAt,
      paused: this.paused,
      tickMs: this.tickMs,
      tps: avgTick > 0 ? Math.round((1000 / Math.max(avgTick, this.tickMs)) * 100) / 100 : 0,
      totalFood: Math.round(totalFood),
      claimedTiles: claimed,
    };
  }

  /** Per-tribe rows for the dashboard table. */
  tribeSummaries() {
    const rows = [];
    for (const tribe of this.tribes.values()) {
      const members = this.agentsOf(tribe.id);
      let infants = 0;
      let adults = 0;
      let elders = 0;
      const occupations: Record<string, number> = {};
      for (const o of OCCUPATIONS) occupations[o] = 0;
      let morale = 0;
      let aggression = 0;
      for (const a of members) {
        const y = yearsOf(a);
        if (y < ADULT_AGE) infants++;
        else if (y < ELDER_AGE) adults++;
        else elders++;
        const occ = OCCUPATION_OF_STATE[a.state] ?? 'Roaming';
        occupations[occ] += 1;
        morale += a.morale;
        aggression += a.traits.aggression;
      }
      const n = Math.max(1, members.length);
      rows.push({
        id: tribe.id,
        name: tribe.name,
        totem: tribe.totem,
        glyph: tribe.glyph,
        color: tribe.color,
        cx: tribe.cx,
        cy: tribe.cy,
        population: members.length,
        infants,
        adults,
        elders,
        food: Math.round(tribe.foodStore),
        tools: Math.round(tribe.toolStore),
        territory: tribe.territory.size,
        morale: Math.round(morale / n),
        aggression: Math.round((aggression / n) * 100) / 100,
        stress: Math.round(tribe.stress),
        births: tribe.births,
        deaths: tribe.deaths,
        kills: tribe.kills,
        occupations,
        techs: TECHS.filter((t) => tribe.knowledge.unlocked[t]).map((t) => TECH_META[t].label),
        research: TECHS.map((t) => ({
          id: t,
          label: TECH_META[t].label,
          pct: Math.min(100, Math.round((tribe.knowledge.progress[t] / TECH_META[t].cost) * 100)),
          unlocked: tribe.knowledge.unlocked[t],
        })),
        relations: Object.entries(tribe.relations)
          .filter(([id]) => this.tribes.has(Number(id)))
          .map(([id, rel]) => ({ id: Number(id), rel })),
      });
    }
    return rows.sort((a, b) => b.population - a.population);
  }

  /** Full terrain + ownership payload, sent once when a client connects. */
  terrainPayload() {
    const bytes = new Uint8Array(this.world.size);
    for (let i = 0; i < this.world.size; i++) bytes[i] = this.world.renderByte(i);
    const owner = new Int16Array(this.world.owner);
    return {
      width: this.world.width,
      height: this.world.height,
      tiles: Buffer.from(bytes).toString('base64'),
      owner: Buffer.from(owner.buffer, owner.byteOffset, owner.byteLength).toString('base64'),
    };
  }

  /** Packed agent positions: Int16 triples of (x, y, tribeId). */
  agentPayload(): string {
    const live = this.agents.filter((a) => a.alive);
    const buf = new Int16Array(live.length * 3);
    for (let k = 0; k < live.length; k++) {
      buf[k * 3] = live[k].x;
      buf[k * 3 + 1] = live[k].y;
      buf[k * 3 + 2] = live[k].tribeId;
    }
    return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString('base64');
  }

  /**
   * Rich per-agent payload for the map view: Int32 stride 7 —
   * `(id, x, y, tribeId, stateIndex, targetX, targetY)`, target `-1` when the
   * agent is acting in place.
   *
   * Ids are what let the client stitch positions together across frames into
   * movement trails; the lean `agentPayload` omits them because the dashboard
   * only ever draws the current instant. This is opt-in per client so a
   * fast-forwarded world with several dashboard viewers does not pay for it.
   */
  agentDetailPayload(): string {
    const live = this.agents.filter((a) => a.alive);
    const buf = new Int32Array(live.length * 7);
    for (let k = 0; k < live.length; k++) {
      const a = live[k];
      const o = k * 7;
      buf[o] = a.id;
      buf[o + 1] = a.x;
      buf[o + 2] = a.y;
      buf[o + 3] = a.tribeId;
      buf[o + 4] = AGENT_STATE_INDEX[a.state] ?? 0;
      buf[o + 5] = a.tx ?? -1;
      buf[o + 6] = a.ty ?? -1;
    }
    return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString('base64');
  }

  /**
   * Food saturation per tile, quantised to 0-255 of that tile's capacity.
   *
   * Deliberately NOT part of the dirty-tile diff: regeneration touches every
   * tile every tick, so routing this through the diff would send the whole
   * grid each frame. The map view takes it on a slow cadence instead, which is
   * ample for spotting a drought or picking somewhere worth blessing.
   */
  foodOverlayPayload(): string {
    const w = this.world;
    const out = new Uint8Array(w.size);
    for (let i = 0; i < w.size; i++) {
      const cap = w.foodCap[i];
      out[i] = cap <= 0 ? 0 : Math.max(0, Math.min(255, Math.round((w.food[i] / cap) * 255)));
    }
    return Buffer.from(out).toString('base64');
  }

  /** Changed tiles since the last flush, as [index, renderByte, owner] triples. */
  drainTileDiffs(): number[] {
    const out: number[] = [];
    for (const i of this.world.dirty) {
      out.push(i, this.world.renderByte(i), this.world.owner[i]);
    }
    this.world.dirty.clear();
    return out;
  }

  eventsSince(seq: number): { seq: number; events: WorldEvent[] } {
    const behind = this.eventSeq - seq;
    if (behind <= 0) return { seq: this.eventSeq, events: [] };
    const take = Math.min(behind, this.events.length);
    return { seq: this.eventSeq, events: this.events.slice(this.events.length - take) };
  }

  get currentEventSeq(): number {
    return this.eventSeq;
  }

  // ----------------------------------------------------- god interventions

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.log({ kind: 'divine', severity: 'divine', text: paused ? 'Time itself was halted.' : 'Time resumed its course.' });
  }

  setTickMs(ms: number): void {
    this.tickMs = Math.max(20, Math.min(60000, Math.round(ms)));
    this.log({ kind: 'divine', severity: 'divine', text: `The pace of the world was set to ${this.tickMs}ms per tick.` });
  }

  /** Paint a disc of terrain — rivers, land, mountains, floods. */
  terraform(x: number, y: number, radius: number, biome: number): number {
    let changed = 0;
    const w = this.world;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.hypot(dx, dy) > radius) continue;
        const ax = x + dx;
        const ay = y + dy;
        if (!w.inBounds(ax, ay)) continue;
        const i = w.idx(ax, ay);
        w.setBiome(i, biome);
        if (!w.isPassable(i)) {
          w.cultivated[i] = 0;
          w.shelter[i] = 0;
        }
        w.fill(i);
        changed++;
      }
    }
    // Anyone standing on newly impassable water drowns.
    if (biome === Biome.DeepWater) {
      for (const a of this.agents) {
        if (!a.alive) continue;
        if (Math.hypot(a.x - x, a.y - y) <= radius) this.killAgent(a, 'drowning');
      }
    }
    this.log({
      kind: 'divine',
      severity: 'divine',
      x,
      y,
      text: `The land was reshaped at (${x}, ${y}) — ${changed} tiles became ${['deep water', 'shallow water', 'plains', 'forest', 'hills', 'mountain', 'desert'][biome] ?? 'unknown'}.`,
    });
    return changed;
  }

  bless(x: number, y: number, radius: number, ticks: number): number {
    return this.applyTileMark(x, y, radius, ticks, true);
  }

  curse(x: number, y: number, radius: number, ticks: number): number {
    return this.applyTileMark(x, y, radius, ticks, false);
  }

  private applyTileMark(x: number, y: number, radius: number, ticks: number, blessing: boolean): number {
    const w = this.world;
    let n = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.hypot(dx, dy) > radius) continue;
        const ax = x + dx;
        const ay = y + dy;
        if (!w.inBounds(ax, ay)) continue;
        const i = w.idx(ax, ay);
        if (blessing) {
          w.blessed[i] = Math.min(32000, ticks);
          w.cursed[i] = 0;
          w.food[i] = w.foodCap[i];
          w.water[i] = w.waterCap[i];
        } else {
          w.cursed[i] = Math.min(32000, ticks);
          w.blessed[i] = 0;
          w.food[i] *= 0.15;
          w.water[i] *= 0.3;
        }
        w.markDirty(i);
        n++;
      }
    }
    this.log({
      kind: 'divine',
      severity: 'divine',
      x,
      y,
      text: blessing
        ? `Abundance blessed the ${placeName(x, y, w.width, w.height)} (${n} tiles).`
        : `A drought cursed the ${placeName(x, y, w.width, w.height)} (${n} tiles, -85% forage).`,
    });
    return n;
  }

  /** Region-limited or global disasters. */
  disaster(
    kind: 'flood' | 'long_winter' | 'pestilence' | 'famine' | 'megafauna',
    opts: { x?: number; y?: number; radius?: number; ticks?: number; magnitude?: number } = {},
  ): string {
    const x = opts.x ?? this.rng.int(0, this.world.width - 1);
    const y = opts.y ?? this.rng.int(0, this.world.height - 1);
    const radius = opts.radius ?? 10;
    const ticks = opts.ticks ?? 60;
    const magnitude = opts.magnitude ?? 1;
    const where = placeName(x, y, this.world.width, this.world.height);

    switch (kind) {
      case 'flood': {
        this.terraform(x, y, radius, Biome.ShallowWater);
        this.log({ kind: 'disaster', severity: 'critical', x, y, text: `A flash flood swept the ${where}.` });
        return `Flood at (${x}, ${y})`;
      }
      case 'long_winter': {
        this.effects.push({ kind: 'long_winter', ticksLeft: ticks, magnitude: 16 * magnitude });
        this.log({ kind: 'disaster', severity: 'critical', text: `A long winter descended upon the world for ${ticks} ticks.` });
        return 'Long winter began';
      }
      case 'pestilence': {
        this.effects.push({ kind: 'pestilence', ticksLeft: ticks, x, y, radius, magnitude });
        this.log({ kind: 'disaster', severity: 'critical', x, y, text: `A pestilence broke out across the ${where}.` });
        return `Pestilence at (${x}, ${y})`;
      }
      case 'famine': {
        this.effects.push({ kind: 'famine', ticksLeft: ticks, magnitude: 0.9 * magnitude });
        for (let i = 0; i < this.world.size; i++) {
          this.world.food[i] *= 0.4;
        }
        this.log({ kind: 'disaster', severity: 'critical', text: `Famine gripped the world; forage withered everywhere.` });
        return 'Famine began';
      }
      case 'megafauna': {
        let killed = 0;
        for (const a of this.agents) {
          if (!a.alive) continue;
          if (Math.hypot(a.x - x, a.y - y) > radius) continue;
          a.health -= this.rng.range(20, 80) * magnitude;
          if (a.health <= 0) {
            this.killAgent(a, 'megafauna');
            killed++;
          }
        }
        this.log({
          kind: 'disaster',
          severity: 'critical',
          x,
          y,
          text: `A cave lion pride rampaged through the ${where}: ${killed} dead.`,
        });
        return `Megafauna attack: ${killed} dead`;
      }
    }
  }

  /** Drop a food cache onto tribal stores or a region's tiles. */
  boonFood(amount: number, tribeId?: number, x?: number, y?: number, radius = 6): string {
    if (tribeId !== undefined) {
      const t = this.tribes.get(tribeId);
      if (!t) return 'No such tribe';
      t.foodStore += amount;
      this.log({ kind: 'divine', severity: 'divine', tribeId, text: `A cache of ${amount} food appeared in the stores of ${t.name}.` });
      return `Granted ${amount} food to ${t.name}`;
    }
    const cx = x ?? this.rng.int(0, this.world.width - 1);
    const cy = y ?? this.rng.int(0, this.world.height - 1);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.hypot(dx, dy) > radius) continue;
        const ax = cx + dx;
        const ay = cy + dy;
        if (!this.world.inBounds(ax, ay)) continue;
        const i = this.world.idx(ax, ay);
        this.world.food[i] = this.world.foodCap[i] * 2 + amount / 10;
      }
    }
    this.log({ kind: 'divine', severity: 'divine', x: cx, y: cy, text: `Food spilled from the sky over the ${placeName(cx, cy, this.world.width, this.world.height)}.` });
    return `Food cache at (${cx}, ${cy})`;
  }

  /** Divine inspiration: instantly unlock a technology. */
  inspire(tribeId: number, techId?: string): string {
    const tribe = this.tribes.get(tribeId);
    if (!tribe) return 'No such tribe';
    const target = (techId as (typeof TECHS)[number] | undefined) ??
      TECHS.find((t) => !tribe.knowledge.unlocked[t]);
    if (!target || !TECHS.includes(target)) return 'Nothing left to learn';
    tribe.knowledge.unlocked[target] = true;
    tribe.knowledge.progress[target] = TECH_META[target].cost;
    this.log({
      kind: 'divine',
      severity: 'divine',
      tribeId,
      x: tribe.cx,
      y: tribe.cy,
      text: `Divine inspiration struck ${tribe.name}: ${TECH_META[target].label} revealed in a dream.`,
    });
    return `${tribe.name} learned ${TECH_META[target].label}`;
  }

  /** A wave of spontaneous births for one tribe or all of them. */
  birthWave(count: number, tribeId?: number): string {
    const targets = tribeId !== undefined
      ? [this.tribes.get(tribeId)].filter(Boolean) as Tribe[]
      : [...this.tribes.values()];
    let born = 0;
    for (const tribe of targets) {
      const parents = this.agentsOf(tribe.id).filter(isAdult);
      for (let i = 0; i < count && this.agentCount < this.maxAgents; i++) {
        const p1 = parents.length ? this.rng.pick(parents) : undefined;
        const p2 = parents.length ? this.rng.pick(parents) : undefined;
        const child = createAgent(
          this.nextAgentId++,
          tribe.id,
          this.world.clampX(tribe.cx + this.rng.int(-2, 2)),
          this.world.clampY(tribe.cy + this.rng.int(-2, 2)),
          0,
          this.rng,
          mixTraits(this.rng, p1?.traits, p2?.traits),
        );
        this.addAgent(child);
        tribe.births++;
        this.stats.births++;
        born++;
      }
    }
    this.log({ kind: 'birth_wave', severity: 'divine', tribeId, text: `A wave of ${born} births blessed ${tribeId !== undefined ? this.tribes.get(tribeId)?.name ?? 'a tribe' : 'every tribe'}.` });
    return `${born} births`;
  }

  /** Targeted smite: coordinates, a whole tribe, or a share of everyone. */
  smite(opts: { x?: number; y?: number; radius?: number; tribeId?: number; percent?: number }): string {
    let killed = 0;
    if (opts.tribeId !== undefined) {
      const tribe = this.tribes.get(opts.tribeId);
      if (!tribe) return 'No such tribe';
      const members = [...this.agentsOf(opts.tribeId)];
      const share = opts.percent !== undefined ? Math.max(0, Math.min(1, opts.percent / 100)) : 1;
      const n = Math.round(members.length * share);
      for (let i = 0; i < n; i++) {
        this.killAgent(members[i], 'smite');
        killed++;
      }
      this.log({ kind: 'divine', severity: 'divine', tribeId: opts.tribeId, x: tribe.cx, y: tribe.cy, text: `Divine wrath struck ${tribe.name}: ${killed} slain.` });
      return `${killed} slain`;
    }

    if (opts.x !== undefined && opts.y !== undefined) {
      const r = opts.radius ?? 3;
      for (const a of this.agents) {
        if (!a.alive) continue;
        if (Math.hypot(a.x - opts.x, a.y - opts.y) > r) continue;
        this.killAgent(a, 'smite');
        killed++;
      }
      this.log({ kind: 'divine', severity: 'divine', x: opts.x, y: opts.y, text: `Lightning fell on (${opts.x}, ${opts.y}): ${killed} slain.` });
      return `${killed} slain`;
    }

    const share = Math.max(0, Math.min(1, (opts.percent ?? 10) / 100));
    for (const a of this.agents) {
      if (!a.alive) continue;
      if (this.rng.chance(share)) {
        this.killAgent(a, 'smite');
        killed++;
      }
    }
    this.log({ kind: 'divine', severity: 'divine', text: `A culling swept the world: ${killed} souls taken (${Math.round(share * 100)}%).` });
    return `${killed} slain`;
  }

  /** Found a brand-new tribe at a chosen location. */
  spawnTribe(x: number, y: number, size = 10): string {
    const i = this.world.idx(this.world.clampX(x), this.world.clampY(y));
    if (!this.world.isPassable(i) || this.world.isWater(i)) return 'That ground will not hold a camp';
    const tribe = createTribe(this, this.world.clampX(x), this.world.clampY(y));
    for (let n = 0; n < size && this.agentCount < this.maxAgents; n++) {
      this.addAgent(
        createAgent(
          this.nextAgentId++,
          tribe.id,
          this.world.clampX(x + this.rng.int(-2, 2)),
          this.world.clampY(y + this.rng.int(-2, 2)),
          this.rng.range(ADULT_AGE, 30),
          this.rng,
          mixTraits(this.rng),
        ),
      );
    }
    updateTerritory(this, tribe);
    this.log({
      kind: 'divine',
      severity: 'divine',
      tribeId: tribe.id,
      x,
      y,
      text: `${tribe.name} was breathed into being at the ${placeName(x, y, this.world.width, this.world.height)}.`,
    });
    return `${tribe.name} founded`;
  }

  /** Force two tribes into a given diplomatic posture. */
  decree(aId: number, bId: number, rel: 'war' | 'trade' | 'neutral'): string {
    const A = this.tribes.get(aId);
    const B = this.tribes.get(bId);
    if (!A || !B) return 'No such tribe';
    const mapped = rel === 'war' ? Relation.War : rel === 'trade' ? Relation.Trade : Relation.Neutral;
    setRelation(A, B, mapped);
    if (mapped !== Relation.War) {
      this.warCooldown.set(aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`, this.tick + TICKS_PER_YEAR);
    }
    this.log({ kind: 'divine', severity: 'divine', text: `By divine decree, ${A.name} and ${B.name} are now at ${rel}.` });
    return `${A.name} <-> ${B.name}: ${rel}`;
  }
}
