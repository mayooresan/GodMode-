import type { Simulation } from './simulation.js';
import { ADULT_AGE, ELDER_AGE, TICKS_PER_YEAR } from '../config.js';
import { TECHS } from './types.js';
import { yearsOf } from './agents.js';

/**
 * The world's memory.
 *
 * Without this the simulation can only ever answer "what is true now" — you
 * cannot ask when the population peaked, whether a drought actually hurt, or
 * which tribe was ascendant two centuries ago. Aggregates are sampled on a
 * stride and kept in columnar arrays, which is both compact on the wire and
 * exactly the shape a chart wants.
 *
 * Series for tribes that have died out are deliberately retained: their rise
 * and fall is the most interesting part of the record.
 */

export interface HistoryOptions {
  /** Ticks between samples. */
  stride: number;
  /** Maximum samples retained; older ones are dropped. */
  maxSamples: number;
  /** Maximum distinct tribe series retained. */
  maxTribeSeries: number;
}

interface TribeSeries {
  id: number;
  name: string;
  glyph: string;
  color: string;
  /** Population at each sample index; 0 before founding and after extinction. */
  pops: number[];
  /** Whether the tribe still exists as of the last sample. */
  alive: boolean;
}

export class History {
  readonly opts: HistoryOptions;

  ticks: number[] = [];
  population: number[] = [];
  young: number[] = [];
  adults: number[] = [];
  elders: number[] = [];
  tribeCount: number[] = [];
  births: number[] = [];
  deaths: number[] = [];
  food: number[] = [];
  claimed: number[] = [];
  temperature: number[] = [];
  /** Total technologies unlocked across all living tribes. */
  techs: number[] = [];
  /** Number of tribe pairs currently at war. */
  wars: number[] = [];

  private tribeSeries = new Map<number, TribeSeries>();
  /** Births and deaths accumulated since the previous sample. */
  private pendingBirths = 0;
  private pendingDeaths = 0;

  constructor(opts: HistoryOptions) {
    this.opts = opts;
  }

  get length(): number {
    return this.ticks.length;
  }

  /** Called every tick; the sample itself is taken on the stride. */
  observe(sim: Simulation, births: number, deaths: number): void {
    this.pendingBirths += births;
    this.pendingDeaths += deaths;
    if (sim.tick % this.opts.stride !== 0) return;
    this.sample(sim);
  }

  private sample(sim: Simulation): void {
    let young = 0;
    let adults = 0;
    let elders = 0;
    for (const a of sim.agents) {
      if (!a.alive) continue;
      const y = yearsOf(a);
      if (y < ADULT_AGE) young++;
      else if (y < ELDER_AGE) adults++;
      else elders++;
    }

    let food = 0;
    let claimed = 0;
    let techs = 0;
    let wars = 0;
    for (const tribe of sim.tribes.values()) {
      food += tribe.foodStore;
      claimed += tribe.territory.size;
      techs += TECHS.filter((t) => tribe.knowledge.unlocked[t]).length;
      for (const [, rel] of Object.entries(tribe.relations)) if (rel === 'war') wars++;
    }

    this.ticks.push(sim.tick);
    this.population.push(young + adults + elders);
    this.young.push(young);
    this.adults.push(adults);
    this.elders.push(elders);
    this.tribeCount.push(sim.tribes.size);
    this.births.push(this.pendingBirths);
    this.deaths.push(this.pendingDeaths);
    this.food.push(Math.round(food));
    this.claimed.push(claimed);
    this.temperature.push(Math.round(sim.temperature * 10) / 10);
    this.techs.push(techs);
    // Each war is counted from both sides.
    this.wars.push(Math.round(wars / 2));
    this.pendingBirths = 0;
    this.pendingDeaths = 0;

    this.sampleTribes(sim);
    this.trim();
  }

  private sampleTribes(sim: Simulation): void {
    const index = this.ticks.length - 1;
    for (const series of this.tribeSeries.values()) series.alive = false;

    for (const tribe of sim.tribes.values()) {
      let series = this.tribeSeries.get(tribe.id);
      if (!series) {
        series = {
          id: tribe.id,
          name: tribe.name,
          glyph: tribe.glyph,
          color: tribe.color,
          // Backfill so every series is aligned to the shared tick axis.
          pops: new Array(index).fill(0),
          alive: true,
        };
        this.tribeSeries.set(tribe.id, series);
      }
      series.alive = true;
      while (series.pops.length < index) series.pops.push(0);
      series.pops[index] = sim.tribePopulation(tribe.id);
    }

    // Extinct tribes keep their shape but flatline to zero.
    for (const series of this.tribeSeries.values()) {
      while (series.pops.length <= index) series.pops.push(0);
    }
  }

  private trim(): void {
    const over = this.ticks.length - this.opts.maxSamples;
    if (over > 0) {
      for (const arr of [
        this.ticks, this.population, this.young, this.adults, this.elders,
        this.tribeCount, this.births, this.deaths, this.food, this.claimed,
        this.temperature, this.techs, this.wars,
      ]) {
        arr.splice(0, over);
      }
      for (const series of this.tribeSeries.values()) series.pops.splice(0, over);
    }

    // Bound the number of series by discarding the longest-dead tribes.
    if (this.tribeSeries.size > this.opts.maxTribeSeries) {
      const dead = [...this.tribeSeries.values()]
        .filter((s) => !s.alive)
        .sort((a, b) => lastNonZero(a.pops) - lastNonZero(b.pops));
      let excess = this.tribeSeries.size - this.opts.maxTribeSeries;
      for (const s of dead) {
        if (excess-- <= 0) break;
        this.tribeSeries.delete(s.id);
      }
    }
  }

  /**
   * Columnar payload for the charts.
   *
   * Columnar rather than an array of objects: at 1,200 samples the key
   * repetition of object-per-sample roughly triples the JSON.
   */
  payload(limit?: number) {
    const n = this.ticks.length;
    const start = limit && limit < n ? n - limit : 0;
    const cut = <T>(a: T[]) => (start > 0 ? a.slice(start) : a);
    return {
      stride: this.opts.stride,
      ticksPerYear: TICKS_PER_YEAR,
      samples: n - start,
      tick: cut(this.ticks),
      population: cut(this.population),
      young: cut(this.young),
      adults: cut(this.adults),
      elders: cut(this.elders),
      tribeCount: cut(this.tribeCount),
      births: cut(this.births),
      deaths: cut(this.deaths),
      food: cut(this.food),
      claimed: cut(this.claimed),
      temperature: cut(this.temperature),
      techs: cut(this.techs),
      wars: cut(this.wars),
      tribes: [...this.tribeSeries.values()]
        .map((s) => ({
          id: s.id,
          name: s.name,
          glyph: s.glyph,
          color: s.color,
          alive: s.alive,
          pops: cut(s.pops),
        }))
        // Largest peak first, so the chart legend leads with the tribes that mattered.
        .sort((a, b) => Math.max(...b.pops, 0) - Math.max(...a.pops, 0)),
    };
  }

  /** Plain object for the snapshot. */
  serialize() {
    return {
      ticks: this.ticks,
      population: this.population,
      young: this.young,
      adults: this.adults,
      elders: this.elders,
      tribeCount: this.tribeCount,
      births: this.births,
      deaths: this.deaths,
      food: this.food,
      claimed: this.claimed,
      temperature: this.temperature,
      techs: this.techs,
      wars: this.wars,
      tribeSeries: [...this.tribeSeries.values()],
    };
  }

  restore(doc: ReturnType<History['serialize']> | undefined): void {
    if (!doc) return;
    this.ticks = doc.ticks ?? [];
    this.population = doc.population ?? [];
    this.young = doc.young ?? [];
    this.adults = doc.adults ?? [];
    this.elders = doc.elders ?? [];
    this.tribeCount = doc.tribeCount ?? [];
    this.births = doc.births ?? [];
    this.deaths = doc.deaths ?? [];
    this.food = doc.food ?? [];
    this.claimed = doc.claimed ?? [];
    this.temperature = doc.temperature ?? [];
    this.techs = doc.techs ?? [];
    this.wars = doc.wars ?? [];
    this.tribeSeries = new Map((doc.tribeSeries ?? []).map((s) => [s.id, s]));
  }
}

function lastNonZero(pops: number[]): number {
  for (let i = pops.length - 1; i >= 0; i--) if (pops[i] > 0) return i;
  return -1;
}
