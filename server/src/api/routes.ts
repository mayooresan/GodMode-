import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Runner } from '../runner.js';
import { Simulation } from '../engine/simulation.js';
import { Biome, TECHS, TECH_META } from '../engine/types.js';
import { config } from '../config.js';

/** Minimal hand-rolled coercion — avoids pulling a validation library in. */
const num = (v: unknown, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const int = (v: unknown, d: number): number => Math.round(num(v, d));

const BIOME_BY_NAME: Record<string, number> = {
  deep_water: Biome.DeepWater,
  water: Biome.DeepWater,
  ocean: Biome.DeepWater,
  river: Biome.ShallowWater,
  shallow_water: Biome.ShallowWater,
  plains: Biome.Plains,
  grassland: Biome.Plains,
  forest: Biome.Forest,
  hills: Biome.Hills,
  mountain: Biome.Mountain,
  desert: Biome.Desert,
  barren: Biome.Desert,
};

export async function registerRoutes(app: FastifyInstance, runner: Runner): Promise<void> {
  const clampXY = (x: number, y: number) => ({
    x: runner.sim.world.clampX(int(x, 0)),
    y: runner.sim.world.clampY(int(y, 0)),
  });

  /** Shared secret gate for every mutating endpoint. */
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!config.adminToken) return;
    const header = req.headers['x-admin-token'];
    const token = Array.isArray(header) ? header[0] : header;
    if (token !== config.adminToken) {
      reply.code(401).send({ ok: false, error: 'Invalid or missing X-Admin-Token' });
    }
  };

  // -------------------------------------------------------------- telemetry

  app.get('/api/health', async () => ({
    ok: true,
    tick: runner.sim.tick,
    population: runner.sim.agentCount,
    tribes: runner.sim.tribes.size,
    paused: runner.sim.paused,
    clients: runner.hub.size,
    uptimeMs: Date.now() - runner.sim.startedAt,
  }));

  app.get('/api/state', async () => runner.initPayload());

  app.get('/api/world/terrain', async () => runner.sim.terrainPayload());

  app.get('/api/tribes', async () => ({ tribes: runner.sim.tribeSummaries() }));

  app.get('/api/vitals', async () => runner.sim.vitals());

  app.get('/api/events', async (req) => {
    const limit = int((req.query as Record<string, unknown>)?.limit, 100);
    return { events: runner.sim.events.slice(-Math.max(1, Math.min(limit, 600))) };
  });

  app.get('/api/tech', async () => ({
    techs: TECHS.map((t) => ({ id: t, ...TECH_META[t] })),
  }));

  /** Inspect a single tile — used by the map's click-to-select panel. */
  app.get('/api/tile', async (req) => {
    const q = req.query as Record<string, unknown>;
    const { x, y } = clampXY(num(q.x, 0), num(q.y, 0));
    const w = runner.sim.world;
    const i = w.idx(x, y);
    const owner = w.owner[i];
    const agentsHere = runner.sim.agents.filter((a) => a.alive && a.x === x && a.y === y).length;
    return {
      x,
      y,
      biome: w.biome[i],
      elevation: Math.round(w.elevation[i] * 1000) / 1000,
      moisture: Math.round(w.moisture[i] * 1000) / 1000,
      food: Math.round(w.food[i] * 10) / 10,
      water: Math.round(w.water[i] * 10) / 10,
      wood: Math.round(w.wood[i] * 10) / 10,
      stone: Math.round(w.stone[i] * 10) / 10,
      carryingCapacity: w.carrying[i],
      cultivated: w.cultivated[i],
      shelter: w.shelter[i],
      blessed: w.blessed[i],
      cursed: w.cursed[i],
      owner,
      ownerName: owner >= 0 ? runner.sim.tribes.get(owner)?.name ?? null : null,
      agents: agentsHere,
    };
  });

  // ------------------------------------------------------------------ stream

  app.get('/api/stream', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tell nginx not to buffer the stream if one is in front of us.
      'X-Accel-Buffering': 'no',
    });
    const clientId = runner.hub.add(reply, runner.sim.currentEventSeq);
    runner.hub.sendTo(clientId, 'init', runner.initPayload());
    req.raw.on('close', () => runner.hub.remove(clientId));
    // Keep the request open; Fastify must not send its own response.
    return reply;
  });

  // ------------------------------------------------------- god interventions

  const god = async (instance: FastifyInstance) => {
    instance.addHook('preHandler', requireAdmin);

    instance.post('/api/god/pause', async (req) => {
      const b = req.body as Record<string, unknown>;
      const paused = b?.paused === undefined ? !runner.sim.paused : Boolean(b.paused);
      runner.sim.setPaused(paused);
      runner.flush();
      return { ok: true, paused };
    });

    instance.post('/api/god/speed', async (req) => {
      const b = req.body as Record<string, unknown>;
      runner.sim.setTickMs(num(b?.tickMs, 1000));
      runner.flush();
      return { ok: true, tickMs: runner.sim.tickMs };
    });

    instance.post('/api/god/terraform', async (req, reply) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const { x, y } = clampXY(num(b.x, 0), num(b.y, 0));
      const radius = Math.max(0, Math.min(40, int(b.radius, 3)));
      const raw = b.biome;
      const biome = typeof raw === 'string' ? BIOME_BY_NAME[raw.toLowerCase()] : int(raw, -1);
      if (biome === undefined || biome < 0 || biome > 6) {
        return reply.code(400).send({ ok: false, error: `Unknown biome: ${String(raw)}` });
      }
      const changed = runner.sim.terraform(x, y, radius, biome);
      runner.flush();
      return { ok: true, changed };
    });

    instance.post('/api/god/bless', async (req) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const { x, y } = clampXY(num(b.x, 0), num(b.y, 0));
      const n = runner.sim.bless(x, y, Math.min(40, int(b.radius, 4)), int(b.ticks, 120));
      runner.flush();
      return { ok: true, tiles: n };
    });

    instance.post('/api/god/curse', async (req) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const { x, y } = clampXY(num(b.x, 0), num(b.y, 0));
      const n = runner.sim.curse(x, y, Math.min(40, int(b.radius, 4)), int(b.ticks, 120));
      runner.flush();
      return { ok: true, tiles: n };
    });

    instance.post('/api/god/disaster', async (req, reply) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const kind = String(b.kind ?? '');
      const allowed = ['flood', 'long_winter', 'pestilence', 'famine', 'megafauna'] as const;
      if (!(allowed as readonly string[]).includes(kind)) {
        return reply.code(400).send({ ok: false, error: `kind must be one of ${allowed.join(', ')}` });
      }
      const msg = runner.sim.disaster(kind as (typeof allowed)[number], {
        x: b.x === undefined ? undefined : clampXY(num(b.x, 0), 0).x,
        y: b.y === undefined ? undefined : clampXY(0, num(b.y, 0)).y,
        radius: Math.min(50, int(b.radius, 10)),
        ticks: Math.min(5000, int(b.ticks, 60)),
        magnitude: Math.min(5, num(b.magnitude, 1)),
      });
      runner.flush();
      return { ok: true, message: msg };
    });

    instance.post('/api/god/food', async (req) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const msg = runner.sim.boonFood(
        num(b.amount, 200),
        b.tribeId === undefined ? undefined : int(b.tribeId, 0),
        b.x === undefined ? undefined : clampXY(num(b.x, 0), 0).x,
        b.y === undefined ? undefined : clampXY(0, num(b.y, 0)).y,
        Math.min(40, int(b.radius, 6)),
      );
      runner.flush();
      return { ok: true, message: msg };
    });

    instance.post('/api/god/inspire', async (req, reply) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      if (b.tribeId === undefined) return reply.code(400).send({ ok: false, error: 'tribeId required' });
      const msg = runner.sim.inspire(int(b.tribeId, 0), b.tech === undefined ? undefined : String(b.tech));
      runner.flush();
      return { ok: true, message: msg };
    });

    instance.post('/api/god/births', async (req) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const msg = runner.sim.birthWave(
        Math.min(200, int(b.count, 5)),
        b.tribeId === undefined ? undefined : int(b.tribeId, 0),
      );
      runner.flush();
      return { ok: true, message: msg };
    });

    instance.post('/api/god/smite', async (req) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const msg = runner.sim.smite({
        x: b.x === undefined ? undefined : clampXY(num(b.x, 0), 0).x,
        y: b.y === undefined ? undefined : clampXY(0, num(b.y, 0)).y,
        radius: Math.min(40, int(b.radius, 3)),
        tribeId: b.tribeId === undefined ? undefined : int(b.tribeId, 0),
        percent: b.percent === undefined ? undefined : num(b.percent, 10),
      });
      runner.flush();
      return { ok: true, message: msg };
    });

    instance.post('/api/god/tribe', async (req) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const { x, y } = clampXY(num(b.x, 0), num(b.y, 0));
      const msg = runner.sim.spawnTribe(x, y, Math.min(60, int(b.size, 10)));
      runner.flush();
      return { ok: true, message: msg };
    });

    instance.post('/api/god/decree', async (req, reply) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const rel = String(b.rel ?? 'neutral');
      if (!['war', 'trade', 'neutral'].includes(rel)) {
        return reply.code(400).send({ ok: false, error: 'rel must be war | trade | neutral' });
      }
      const msg = runner.sim.decree(int(b.a, 0), int(b.b, 0), rel as 'war' | 'trade' | 'neutral');
      runner.flush();
      return { ok: true, message: msg };
    });

    /** Wipe the world and regenerate from a (possibly new) seed. */
    instance.post('/api/god/reset', async (req) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const seed = int(b.seed, Math.floor(Math.random() * 2 ** 31));
      const sim = new Simulation({
        width: config.width,
        height: config.height,
        seed,
        startingTribes: int(b.tribes, config.startingTribes),
        startingAgentsPerTribe: config.startingAgentsPerTribe,
        maxAgents: config.maxAgents,
        eventLogSize: config.eventLogSize,
      });
      sim.seed();
      await runner.replace(sim);
      runner.flush();
      return { ok: true, seed };
    });
  };

  await app.register(god);
}
