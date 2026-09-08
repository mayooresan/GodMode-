import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { Runner } from './runner.js';
import { registerRoutes } from './api/routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** In the container the built dashboard is copied next to the server bundle. */
const publicDir = path.resolve(here, '../public');

async function main(): Promise<void> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
    },
    // SSE responses are written to the raw socket and never time out on their own.
    connectionTimeout: 0,
    keepAliveTimeout: 72000,
  });

  await app.register(cors, {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Admin-Token'],
  });

  const runner = await Runner.boot();
  await registerRoutes(app, runner);

  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
      // Vite fingerprints asset filenames, so their contents can never change
      // under a given URL — cache them hard. index.html is the mutable entry
      // point that names the current bundles, so it must always revalidate,
      // otherwise a browser can keep pointing at assets a deploy has removed.
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    });
    // SPA fallback for any non-API path.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ ok: false, error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn(`No dashboard build at ${publicDir}; serving API only.`);
  }

  runner.start();

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    `Civilisation engine live — ${config.width}x${config.height}, seed ${config.seed}, ${runner.sim.tickMs}ms/tick, tick ${runner.sim.tick}`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received — snapshotting and shutting down.`);
    try {
      await runner.stop();
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => app.log.error({ err }, 'unhandled rejection'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
