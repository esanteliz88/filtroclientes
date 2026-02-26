import type { App } from '../app.js';
import redisPlugin from '@fastify/redis';

export async function registerRedis(app: App) {
  if (!app.config.ENABLE_REDIS) {
    app.log.info('Redis disabled (ENABLE_REDIS=false)');
    return;
  }

  await app.register(redisPlugin, { url: app.config.REDIS_URL! });
  app.log.info('Redis connected');
}
