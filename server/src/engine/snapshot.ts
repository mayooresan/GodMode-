import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Simulation, SimOptions } from './simulation.js';
import { World } from './world.js';
import { normaliseKnowledge } from './tribes.js';
import type { Agent, Tribe } from './types.js';

/**
 * Persistence.
 *
 * The live world stays in memory for tick throughput; every N ticks we write a
 * single JSON document (typed arrays base64-encoded) to disk, atomically via
 * write-to-temp + rename so a droplet reboot mid-write cannot corrupt it.
 */

const SNAPSHOT_VERSION = 3;

const b64 = (a: { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }) =>
  Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');

function readInto<T extends { set(v: ArrayLike<number>): void; length: number }>(
  target: T,
  encoded: string,
  Ctor: new (buf: ArrayBuffer) => ArrayLike<number>,
): void {
  const raw = Buffer.from(encoded, 'base64');
  const copy = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const view = new Ctor(copy) as unknown as ArrayLike<number>;
  target.set(view);
}

interface SnapshotDoc {
  version: number;
  opts: SimOptions;
  tick: number;
  startedAt: number;
  rngState: number;
  nextAgentId: number;
  nextTribeId: number;
  tickMs: number;
  paused: boolean;
  temperature: number;
  effects: unknown[];
  warCooldown: Array<[string, number]>;
  world: Record<string, string | number>;
  tribes: Array<Omit<Tribe, 'territory'> & { territory: number[] }>;
  /** Added after v3 shipped; absent in older snapshots, hence optional. */
  history?: ReturnType<Simulation['history']['serialize']>;
  retiredTribes?: Array<Omit<Tribe, 'territory'> & { territory: number[] }>;
  agents: Agent[];
  events: unknown[];
}

export function serialize(sim: Simulation): SnapshotDoc {
  const w = sim.world;
  return {
    version: SNAPSHOT_VERSION,
    opts: sim.opts,
    tick: sim.tick,
    startedAt: sim.startedAt,
    rngState: sim.rng.state(),
    nextAgentId: sim.nextAgentId,
    nextTribeId: sim.nextTribeId,
    tickMs: sim.tickMs,
    paused: sim.paused,
    temperature: sim.temperature,
    effects: sim.effects,
    warCooldown: [...sim.warCooldown.entries()],
    world: {
      width: w.width,
      height: w.height,
      biome: b64(w.biome),
      elevation: b64(w.elevation),
      moisture: b64(w.moisture),
      food: b64(w.food),
      water: b64(w.water),
      wood: b64(w.wood),
      stone: b64(w.stone),
      carrying: b64(w.carrying),
      owner: b64(w.owner),
      cultivated: b64(w.cultivated),
      shelter: b64(w.shelter),
      blessed: b64(w.blessed),
      cursed: b64(w.cursed),
    },
    tribes: [...sim.tribes.values()].map((t) => ({ ...t, territory: [...t.territory] })),
    retiredTribes: sim.retiredTribes.map((t) => ({ ...t, territory: [] })),
    history: sim.history.serialize(),
    agents: sim.agents.filter((a) => a.alive),
    events: sim.events,
  };
}

export function deserialize(doc: SnapshotDoc): Simulation {
  const sim = new Simulation(doc.opts);
  const w = new World(doc.world.width as number, doc.world.height as number);

  readInto(w.biome, doc.world.biome as string, Uint8Array as never);
  readInto(w.elevation, doc.world.elevation as string, Float32Array as never);
  readInto(w.moisture, doc.world.moisture as string, Float32Array as never);
  readInto(w.food, doc.world.food as string, Float32Array as never);
  readInto(w.water, doc.world.water as string, Float32Array as never);
  readInto(w.wood, doc.world.wood as string, Float32Array as never);
  readInto(w.stone, doc.world.stone as string, Float32Array as never);
  readInto(w.carrying, doc.world.carrying as string, Uint16Array as never);
  readInto(w.owner, doc.world.owner as string, Int16Array as never);
  readInto(w.cultivated, doc.world.cultivated as string, Uint8Array as never);
  readInto(w.shelter, doc.world.shelter as string, Uint8Array as never);
  readInto(w.blessed, doc.world.blessed as string, Int16Array as never);
  readInto(w.cursed, doc.world.cursed as string, Int16Array as never);
  for (let i = 0; i < w.size; i++) w.refreshCaps(i);

  sim.world = w;
  sim.tick = doc.tick;
  sim.startedAt = doc.startedAt;
  sim.rng.restore(doc.rngState);
  sim.nextAgentId = doc.nextAgentId;
  sim.nextTribeId = doc.nextTribeId;
  sim.tickMs = doc.tickMs;
  sim.paused = doc.paused;
  sim.temperature = doc.temperature;
  sim.effects = doc.effects as Simulation['effects'];
  sim.warCooldown = new Map(doc.warCooldown);
  sim.events = doc.events as Simulation['events'];

  for (const t of doc.tribes) {
    const tribe: Tribe = { ...t, territory: new Set(t.territory) } as Tribe;
    // Repair worlds snapshotted before the unlocked/progress invariant was
    // enforced, so an existing save is corrected rather than carried forward.
    normaliseKnowledge(tribe);
    sim.tribes.set(tribe.id, tribe);
  }
  // Deliberately tolerant: snapshots written before this field existed simply
  // resume with an empty chronicle rather than being rejected as incompatible.
  sim.history.restore(doc.history);
  sim.retiredTribes = (doc.retiredTribes ?? []).map(
    (t) => ({ ...t, territory: new Set<number>() } as Tribe),
  );

  for (const a of doc.agents) sim.addAgent(a);
  return sim;
}

export class SnapshotStore {
  private readonly file: string;
  private writing = false;

  constructor(dir: string, name = 'world.json') {
    this.file = path.join(dir, name);
  }

  get path(): string {
    return this.file;
  }

  async save(sim: Simulation): Promise<void> {
    // Skip rather than queue: the next scheduled snapshot is only seconds away
    // and a backlog of writes would be worse than a missed one.
    if (this.writing) return;
    this.writing = true;
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(serialize(sim)), 'utf8');
      await fs.rename(tmp, this.file);
    } finally {
      this.writing = false;
    }
  }

  async load(): Promise<Simulation | null> {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const doc = JSON.parse(raw) as SnapshotDoc;
      if (doc.version !== SNAPSHOT_VERSION) return null;
      return deserialize(doc);
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    await fs.rm(this.file, { force: true });
  }
}
