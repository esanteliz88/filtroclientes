import Fastify from 'fastify';
import dotenv from 'dotenv';
import { loadEnv, type Env } from './config/env.js';
import { registerDb } from './plugins/db.js';
import { registerRedis } from './plugins/redis.js';
import { registerAuth } from './plugins/auth.js';
import { registerPermissions } from './plugins/permissions.js';
import { registerDocs } from './plugins/docs.js';
import { registerRoutes } from './routes/index.js';
import underPressure from '@fastify/under-pressure';
import rateLimit from '@fastify/rate-limit';

export type App = ReturnType<typeof Fastify> & { config: Env };

export async function buildApp() {
  dotenv.config();
  const config = loadEnv();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined
    }
  }) as App;

  app.decorate('config', config);

  await app.register(underPressure, {
    maxEventLoopDelay: 1000,
    maxHeapUsedBytes: 512 * 1024 * 1024,
    maxRssBytes: 1024 * 1024 * 1024
  });

  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute'
  });

  await registerDb(app);
  await registerRedis(app);
  await registerAuth(app);
  await registerPermissions(app);
  await registerDocs(app);
  await registerRoutes(app);

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
