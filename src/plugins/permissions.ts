import type { App } from '../app.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

function hasRequiredScopes(userScopes: string[], required?: string[]) {
  if (!required || required.length === 0) return true;
  return required.every(s => userScopes.includes(s));
}

function isAllowedByPermissions(
  perms: { method: string; path: string }[],
  method: string,
  url: string
) {
  if (!perms || perms.length === 0) return false;
  return perms.some(p => {
    if (p.method.toUpperCase() !== method.toUpperCase()) return false;
    try {
      const regex = new RegExp(p.path);
      return regex.test(url);
    } catch {
      return false;
    }
  });
}

export async function registerPermissions(app: App) {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const config = request.routeOptions.config as
      | { auth?: boolean; scopes?: string[]; permissions?: boolean }
      | undefined;

    if (!config?.auth) return;

    await app.authenticate(request);

    const user = request.user;
    if (user.isAdmin) return;

    if (!hasRequiredScopes(user.scopes, config.scopes)) {
      return reply.code(403).send({ error: 'insufficient_scopes' });
    }

    if (config.permissions) {
      const targetPath = (request.routeOptions.url || request.url).split('?')[0];
      const ok = isAllowedByPermissions(user.perms, request.method, targetPath);
      if (!ok) return reply.code(403).send({ error: 'not_allowed' });
    }
  });
}
