/**
 * Core domain types for the civilisation engine.
 *
 * Tile data lives in flat typed arrays on `World` (struct-of-arrays) because the
 * grid is touched in full every tick; agents are plain objects because their
 * access pattern is sparse and branch-heavy.
 */

export const Biome = {
  DeepWater: 0,
  ShallowWater: 1,
  Plains: 2,
  Forest: 3,
  Hills: 4,
  Mountain: 5,
  Desert: 6,
} as const;
export type BiomeId = (typeof Biome)[keyof typeof Biome];

export const BIOME_NAMES: Record<number, string> = {
  0: 'Deep Water',
  1: 'River / Shallow',
  2: 'Plains',
  3: 'Forest',
  4: 'Hills',
  5: 'Mountain',
  6: 'Barren / Desert',
};

/** Per-biome baseline capacities and movement characteristics. */
export interface BiomeProfile {
  food: number;
  water: number;
  wood: number;
  stone: number;
  carrying: number;
  /** Multiplier on movement cost; >1 is slower. */
  moveCost: number;
  passable: boolean;
  /** Fraction of capacity regenerated per tick. */
  regen: number;
}

export const BIOME_PROFILE: Record<number, BiomeProfile> = {
  [Biome.DeepWater]:    { food: 12, water: 0,   wood: 0,  stone: 0,  carrying: 0,  moveCost: 99, passable: false, regen: 0.020 },
  [Biome.ShallowWater]: { food: 34, water: 100, wood: 4,  stone: 2,  carrying: 4,  moveCost: 1.4, passable: true, regen: 0.030 },
  [Biome.Plains]:       { food: 46, water: 12,  wood: 6,  stone: 4,  carrying: 10, moveCost: 1.0, passable: true, regen: 0.022 },
  [Biome.Forest]:       { food: 38, water: 18,  wood: 90, stone: 6,  carrying: 8,  moveCost: 1.5, passable: true, regen: 0.018 },
  [Biome.Hills]:        { food: 18, water: 8,   wood: 22, stone: 80, carrying: 6,  moveCost: 1.8, passable: true, regen: 0.014 },
  [Biome.Mountain]:     { food: 5,  water: 4,   wood: 6,  stone: 120,carrying: 2,  moveCost: 3.0, passable: true, regen: 0.010 },
  [Biome.Desert]:       { food: 7,  water: 1,   wood: 1,  stone: 14, carrying: 1,  moveCost: 2.2, passable: true, regen: 0.006 },
};

export const AgentState = {
  SeekWater: 'seek_water',
  Forage: 'forage',
  Hunt: 'hunt',
  Fish: 'fish',
  SeekShelter: 'seek_shelter',
  Deposit: 'deposit',
  Craft: 'craft',
  Build: 'build',
  Reproduce: 'reproduce',
  Socialize: 'socialize',
  Explore: 'explore',
  Fight: 'fight',
  Rest: 'rest',
} as const;
export type AgentStateId = (typeof AgentState)[keyof typeof AgentState];

/**
 * Fixed occupation buckets for the dashboard's distribution bar.
 *
 * Six categories, not twelve: the bar is a categorical encoding and six is the
 * largest set whose colours stay separable on the dark surface. The mapping is
 * fixed to the entity, never to rank, so a segment keeps its colour as shares
 * change.
 */
export const OCCUPATIONS = [
  'Foraging', 'Hunting', 'Fishing', 'Building', 'Warfare', 'Roaming',
] as const;
export type Occupation = (typeof OCCUPATIONS)[number];

export const OCCUPATION_OF_STATE: Record<string, Occupation> = {
  forage: 'Foraging',
  hunt: 'Hunting',
  fish: 'Fishing',
  deposit: 'Building',
  craft: 'Building',
  build: 'Building',
  fight: 'Warfare',
  seek_water: 'Roaming',
  seek_shelter: 'Roaming',
  explore: 'Roaming',
  socialize: 'Roaming',
  reproduce: 'Roaming',
  rest: 'Roaming',
};

export interface Traits {
  /** 0..1 — likelihood of raiding, willingness to fight rather than flee. */
  aggression: number;
  /** 0..1 — research contribution multiplier. */
  inquisitiveness: number;
  /** 0..1 — resistance to cold, disease and starvation damage. */
  hardiness: number;
}

export interface Agent {
  id: number;
  tribeId: number;
  x: number;
  y: number;
  /** Ticks lived; years = ticks / TICKS_PER_YEAR. */
  ageTicks: number;
  sex: 0 | 1;
  health: number;    // 0..100
  hunger: number;    // 0..100 (100 = starving)
  thirst: number;    // 0..100 (100 = dying of thirst)
  stamina: number;   // 0..100
  morale: number;    // 0..100
  traits: Traits;
  state: AgentStateId;
  /** Food units carried but not yet deposited at camp. */
  carrying: number;
  /** Current pathing target, or null when acting in place. */
  tx: number | null;
  ty: number | null;
  /** Ticks until this agent may reproduce again. */
  breedCooldown: number;
  /** >0 while infected by a pestilence event. */
  sickness: number;
  alive: boolean;
}

export const TECHS = [
  'fire',
  'flint',
  'farming',
  'shelter',
  'warfare',
] as const;
export type TechId = (typeof TECHS)[number];

export const TECH_META: Record<TechId, { label: string; cost: number; blurb: string }> = {
  fire:    { label: 'Fire Handling',    cost: 1400,  blurb: 'cooking and warmth' },
  flint:   { label: 'Flint Knapping',   cost: 2600,  blurb: 'sharper tools and spears' },
  shelter: { label: 'Mud Huts',         cost: 4200,  blurb: 'permanent dwellings' },
  farming: { label: 'Plant Domestication', cost: 7000, blurb: 'cultivated plots' },
  warfare: { label: 'Warfare & Palisades', cost: 9500, blurb: 'weapons and fortification' },
};

export interface TribeKnowledge {
  /** Accumulated research points per tech. */
  progress: Record<TechId, number>;
  unlocked: Record<TechId, boolean>;
}

export const Relation = {
  Neutral: 'neutral',
  Trade: 'trade',
  War: 'war',
  Vassal: 'vassal',
} as const;
export type RelationId = (typeof Relation)[keyof typeof Relation];

export interface Tribe {
  id: number;
  name: string;
  /** Bare animal name, e.g. "Wolf" — kept unadorned so identity de-duplication works. */
  totem: string;
  /** Emoji shown beside the tribe in the dashboard. */
  glyph: string;
  color: string;
  /** Camp / settlement centre. */
  cx: number;
  cy: number;
  foodStore: number;
  toolStore: number;
  woodStore: number;
  stoneStore: number;
  knowledge: TribeKnowledge;
  /** Tile indices claimed by this tribe. */
  territory: Set<number>;
  relations: Record<number, RelationId>;
  /** Rolling per-tribe counters, reset each stats window. */
  births: number;
  deaths: number;
  kills: number;
  foundedTick: number;
  extinctTick: number | null;
  /** Ticks of accumulated hardship; drives migration decisions. */
  stress: number;
  overlordId: number | null;
}

export interface WorldEvent {
  tick: number;
  /** Wall-clock ms, for client-side ordering across reconnects. */
  at: number;
  kind:
    | 'settlement' | 'discovery' | 'birth_wave' | 'death' | 'war' | 'battle'
    | 'peace' | 'trade' | 'disaster' | 'divine' | 'migration' | 'extinction'
    | 'system';
  severity: 'info' | 'warn' | 'critical' | 'divine';
  text: string;
  tribeId?: number;
  x?: number;
  y?: number;
}

export interface Vitals {
  tick: number;
  population: number;
  infants: number;
  adults: number;
  elders: number;
  tribes: number;
  births: number;
  deaths: number;
  birthRate: number;
  deathRate: number;
  season: string;
  temperature: number;
  year: number;
  elapsedMs: number;
  paused: boolean;
  tickMs: number;
  tps: number;
  totalFood: number;
  claimedTiles: number;
}
