import { Simulation } from './engine/simulation.js';
import { SnapshotStore } from './engine/snapshot.js';
import { StreamHub } from './stream/hub.js';
import { config } from './config.js';
import { BIOME_NAMES } from './engine/types.js';

/**
 * Owns the tick loop, persistence cadence and client fan-out.
 *
 * The loop is a self-rescheduling timer rather than setInterval so a slow tick
 * cannot pile up callbacks; it also lets tick speed change at runtime without
 * tearing the timer down.
 */
export class Runner {
  sim: Simulation;
  readonly hub = new StreamHub();
  private readonly store: SnapshotStore;
  private timer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastBroadcast = 0;
  private stopping = false;

  constructor(sim: Simulation, store: SnapshotStore) {
    this.sim = sim;
    this.store = store;
  }

  static async boot(): Promise<Runner> {
    const store = new SnapshotStore(config.dataDir);
    let sim: Simulation | null = null;

    if (config.resume) {
      sim = await store.load();
      if (sim) {
        sim.log({ kind: 'system', severity: 'info', text: `Resumed from snapshot at tick ${sim.tick}.` });
      }
    }
    if (!sim) {
      sim = new Simulation({
        width: config.width,
        height: config.height,
        seed: config.seed,
        startingTribes: config.startingTribes,
        startingAgentsPerTribe: config.startingAgentsPerTribe,
        maxAgents: config.maxAgents,
        eventLogSize: config.eventLogSize,
      });
      sim.seed();
    }
    return new Runner(sim, store);
  }

  start(): void {
    this.schedule();
    this.heartbeatTimer = setInterval(() => this.hub.heartbeat(), 15000);
  }

  private schedule(): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => this.loop(), Math.max(10, this.sim.tickMs));
  }

  private loop(): void {
    try {
      if (!this.sim.paused) {
        this.sim.step();
        if (this.sim.tick % config.snapshotEveryTicks === 0) {
          void this.store.save(this.sim).catch(() => {
            this.sim.log({ kind: 'system', severity: 'warn', text: 'Snapshot write failed.' });
          });
        }
      }
      this.maybeBroadcast();
    } catch (err) {
      this.sim.log({
        kind: 'system',
        severity: 'critical',
        text: `Tick error: ${(err as Error).message}`,
      });
    } finally {
      this.schedule();
    }
  }

  /**
   * Push a frame, but never more than ~10/second — at fast-forward speeds the
   * simulation outruns any browser's ability to paint.
   */
  private maybeBroadcast(force = false): void {
    if (this.hub.size === 0) {
      // Nobody is watching: still drain diffs so the dirty set cannot grow
      // without bound over a long unattended run.
      if (this.sim.world.dirty.size > 20000) this.sim.drainTileDiffs();
      return;
    }
    const now = Date.now();
    if (!force && now - this.lastBroadcast < 100) return;
    this.lastBroadcast = now;

    const tiles = this.sim.drainTileDiffs();
    const vitals = this.sim.vitals();
    const tribes = this.sim.tribeSummaries();
    const agents = this.sim.agentPayload();

    this.hub.broadcast('frame', (clientId) => {
      const { seq, events } = this.sim.eventsSince(this.hub.eventSeqOf(clientId));
      this.hub.setEventSeq(clientId, seq);
      return { tick: this.sim.tick, vitals, tribes, agents, tiles, events, seq };
    });
  }

  /** Full state for a newly connected client. */
  initPayload() {
    return {
      terrain: this.sim.terrainPayload(),
      vitals: this.sim.vitals(),
      tribes: this.sim.tribeSummaries(),
      agents: this.sim.agentPayload(),
      events: this.sim.events.slice(-200),
      seq: this.sim.currentEventSeq,
      biomes: BIOME_NAMES,
    };
  }

  /** Force an immediate frame after a god intervention, so the UI feels live. */
  flush(): void {
    this.maybeBroadcast(true);
  }

  /** Replace the world entirely (regenerate / reset). */
  async replace(sim: Simulation): Promise<void> {
    this.sim = sim;
    await this.store.save(this.sim);
    this.hub.broadcast('reset', () => ({ at: Date.now() }));
  }

  async persist(): Promise<void> {
    await this.store.save(this.sim);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.hub.closeAll();
    await this.persist();
  }
}
