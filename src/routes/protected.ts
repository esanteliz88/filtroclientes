import type { App } from '../app.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

export async function protectedRoutes(app: App) {
  app.get(
    '/data',
    {
      config: { auth: true, scopes: ['read'], permissions: true }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const cacheKey = `data:${request.user.sub}`;
      const cached = await app.redis.get(cacheKey);
      if (cached) return reply.send(JSON.parse(cached));

      const payload = {
        message: 'secure read data',
        at: new Date().toISOString(),
        client: request.user.sub
      };

      await app.redis.set(cacheKey, JSON.stringify(payload), 'EX', 30);
      return payload;
    }
  );

  app.post(
    '/data',
    {
      config: { auth: true, scopes: ['write'], permissions: true }
    },
    async (request: FastifyRequest) => {
      return {
        message: 'secure write accepted',
        at: new Date().toISOString(),
        client: request.user.sub
      };
    }
  );
}
