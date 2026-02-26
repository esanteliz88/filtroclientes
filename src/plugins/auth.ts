import type { App } from '../app.js';
import jwt from '@fastify/jwt';
import type { FastifyRequest } from 'fastify';

export async function registerAuth(app: App) {
  await app.register(jwt, { secret: app.config.JWT_SECRET });

  app.decorate('authenticate', async (request: FastifyRequest) => {
    await request.jwtVerify();
  });
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      scopes: string[];
      perms: { method: string; path: string }[];
      isAdmin: boolean;
    };
    user: {
      sub: string;
      scopes: string[];
      perms: { method: string; path: string }[];
      isAdmin: boolean;
    };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}
