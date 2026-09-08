/** Wire types mirroring the engine's projections in server/src/engine. */

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

export interface ResearchRow {
  id: string;
  label: string;
  pct: number;
  unlocked: boolean;
}

export interface TribeRow {
  id: number;
  name: string;
  totem: string;
  glyph: string;
  color: string;
  cx: number;
  cy: number;
  population: number;
  infants: number;
  adults: number;
  elders: number;
  food: number;
  tools: number;
  territory: number;
  morale: number;
  aggression: number;
  stress: number;
  births: number;
  deaths: number;
  kills: number;
  occupations: Record<string, number>;
  techs: string[];
  research: ResearchRow[];
  relations: Array<{ id: number; rel: string }>;
}

export interface WorldEvent {
  tick: number;
  at: number;
  kind: string;
  severity: 'info' | 'warn' | 'critical' | 'divine';
  text: string;
  tribeId?: number;
  x?: number;
  y?: number;
}

export interface TileInfo {
  x: number;
  y: number;
  biome: number;
  elevation: number;
  moisture: number;
  food: number;
  water: number;
  wood: number;
  stone: number;
  carryingCapacity: number;
  cultivated: number;
  shelter: number;
  blessed: number;
  cursed: number;
  owner: number;
  ownerName: string | null;
  agents: number;
}

/** Wire order for agent states; index into this is what the stream sends. */
export const AGENT_STATES = [
  'seek_water', 'forage', 'hunt', 'fish', 'seek_shelter', 'deposit', 'craft',
  'build', 'reproduce', 'socialize', 'explore', 'fight', 'rest',
] as const;

export const STATE_LABEL: Record<string, string> = {
  seek_water: 'Seeking water',
  forage: 'Foraging',
  hunt: 'Hunting',
  fish: 'Fishing',
  seek_shelter: 'Seeking shelter',
  deposit: 'Hauling to camp',
  craft: 'Crafting tools',
  build: 'Building',
  reproduce: 'Courting',
  socialize: 'Socialising',
  explore: 'Exploring',
  fight: 'Fighting',
  rest: 'Resting',
};

/** One frame of agent detail, kept in a short history to draw movement trails. */
export interface AgentFrame {
  tick: number;
  /** agent id -> packed offset into `data` (stride 7). */
  index: Map<number, number>;
  data: Int32Array;
}

/** A tribe that no longer exists, from /api/tribes. */
export interface FallenTribe {
  id: number;
  name: string;
  totem: string;
  glyph: string;
  color: string;
  foundedYear: number;
  extinctYear: number;
  lifespanYears: number;
  births: number;
  deaths: number;
  kills: number;
  techs: string[];
  fate: string;
  conqueror: string | null;
}

/** Live world state assembled from the `init` frame plus streamed diffs. */
export interface WorldState {
  width: number;
  height: number;
  /** Per tile: biome in low 3 bits + cultivated/shelter/blessed/cursed flags. */
  tiles: Uint8Array;
  owner: Int16Array;
  /** Packed Int16 triples of (x, y, tribeId). */
  agents: Int16Array;
  /** Food saturation 0-255 per tile; only present on the detailed stream. */
  food: Uint8Array | null;
}

export const BIOME_LABEL = [
  'Deep Water', 'River / Shallow', 'Plains', 'Forest', 'Hills', 'Mountain', 'Barren / Desert',
];

/** Fixed occupation slots; must match OCCUPATIONS in the engine. */
export const OCCUPATIONS = [
  { key: 'Foraging', varName: '--occ-foraging' },
  { key: 'Hunting', varName: '--occ-hunting' },
  { key: 'Fishing', varName: '--occ-fishing' },
  { key: 'Building', varName: '--occ-building' },
  { key: 'Warfare', varName: '--occ-warfare' },
  { key: 'Roaming', varName: '--occ-roaming' },
] as const;
