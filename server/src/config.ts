/** Runtime configuration, all overridable by environment variables. */

const num = (v: string | undefined, d: number) => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  port: num(process.env.PORT, 8080),
  host: process.env.HOST ?? '0.0.0.0',

  /** Grid dimensions. 128x128 is comfortable for a 1 vCPU droplet. */
  width: num(process.env.WORLD_WIDTH, 128),
  height: num(process.env.WORLD_HEIGHT, 128),
  seed: num(process.env.WORLD_SEED, 20260908),

  /** Milliseconds between ticks. God console can change this at runtime. */
  tickMs: num(process.env.TICK_MS, 1000),

  startingTribes: num(process.env.STARTING_TRIBES, 6),
  startingAgentsPerTribe: num(process.env.STARTING_AGENTS, 12),
  /** Hard ceiling; protects the droplet from an unbounded population blow-up. */
  maxAgents: num(process.env.MAX_AGENTS, 6000),

  /** Persistence. */
  dataDir: process.env.DATA_DIR ?? '/data',
  snapshotEveryTicks: num(process.env.SNAPSHOT_EVERY_TICKS, 60),
  /** Set to 0/false to always regenerate a fresh world on boot. */
  resume: (process.env.RESUME ?? 'true') !== 'false',

  /** Ring-buffer size for the world event log. */
  eventLogSize: num(process.env.EVENT_LOG_SIZE, 600),

  /** Optional shared secret required on god-intervention endpoints. */
  adminToken: process.env.ADMIN_TOKEN ?? '',

  /** Comma-separated CORS origins; '*' by default for a bare droplet. */
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
};

/** Ticks per simulated year — drives ageing and the seasonal cycle. */
export const TICKS_PER_YEAR = 96;
export const ADULT_AGE = 14;
export const ELDER_AGE = 45;
export const MAX_AGE = 72;
