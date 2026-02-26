import type { App } from '../app.js';
import redisPlugin from '@fastify/redis';

export async function registerRedis(app: App) {
  await app.register(redisPlugin, { url: app.config.REDIS_URL });
  app.log.info('Redis connected');
}
