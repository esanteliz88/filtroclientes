import type { App } from '../app.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Client } from '../models/Client.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const CreateClientBody = z.object({
  clientId: z.string().min(4),
  clientSecret: z.string().min(8).optional(),
  scopes: z.array(z.string()).default([]),
  permissions: z
    .array(z.object({ method: z.string(), path: z.string() }))
    .default([]),
  isAdmin: z.boolean().default(false)
});

export async function adminRoutes(app: App) {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const config = request.routeOptions.config as { auth?: boolean } | undefined;
    if (!config?.auth) return;
    await app.authenticate(request);
    if (!request.user.isAdmin && !request.user.scopes.includes('admin')) {
      return reply.code(403).send({ error: 'admin_only' });
    }
  });

  app.post(
    '/clients',
    {
      config: { auth: true }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = CreateClientBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

      const { clientId, clientSecret, scopes, permissions, isAdmin } = parsed.data;
      const existing = await Client.findOne({ clientId }).lean();
      if (existing) return reply.code(409).send({ error: 'client_exists' });

      const rawSecret = clientSecret ?? crypto.randomBytes(24).toString('hex');
      const secretHash = await bcrypt.hash(rawSecret, 12);

      await Client.create({
        clientId,
        secretHash,
        scopes,
        permissions,
        isAdmin
      });

      return reply.code(201).send({
        clientId,
        clientSecret: rawSecret,
        scopes,
        permissions,
        isAdmin
      });
    }
  );

  app.get(
    '/clients',
    { config: { auth: true } },
    async () => {
      const clients = await Client.find({}, { clientId: 1, scopes: 1, permissions: 1, isAdmin: 1, status: 1 }).lean();
      return { clients };
    }
  );
}
