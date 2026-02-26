import type { App } from '../app.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Client } from '../models/Client.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const PermissionSchema = z.object({ method: z.string(), path: z.string() });

const ClientParams = z.object({
  clientId: z.string().min(1)
});

const CreateClientBody = z.object({
  clientId: z.string().min(4),
  clientSecret: z.string().min(8).optional(),
  scopes: z.array(z.string()).default([]),
  permissions: z.array(PermissionSchema).default([]),
  isAdmin: z.boolean().default(false)
});

const UpdateClientBody = z
  .object({
    clientSecret: z.string().min(8).optional(),
    scopes: z.array(z.string()).optional(),
    permissions: z.array(PermissionSchema).optional(),
    isAdmin: z.boolean().optional(),
    status: z.enum(['active', 'disabled']).optional()
  })
  .refine(
    data =>
      data.clientSecret !== undefined ||
      data.scopes !== undefined ||
      data.permissions !== undefined ||
      data.isAdmin !== undefined ||
      data.status !== undefined,
    { message: 'At least one field is required' }
  );

function exposeClient(client: Record<string, unknown>) {
  return {
    clientId: client.clientId,
    scopes: client.scopes,
    permissions: client.permissions,
    isAdmin: client.isAdmin,
    status: client.status,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt
  };
}

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
    { config: { auth: true } },
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
        isAdmin,
        status: 'active'
      });
    }
  );

  app.get('/clients', { config: { auth: true } }, async () => {
    const clients = await Client.find(
      {},
      { clientId: 1, scopes: 1, permissions: 1, isAdmin: 1, status: 1, createdAt: 1, updatedAt: 1 }
    ).lean();

    return { clients };
  });

  app.get(
    '/clients/:clientId',
    { config: { auth: true } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = ClientParams.safeParse(request.params);
      if (!parsedParams.success) return reply.code(400).send({ error: 'invalid_request' });

      const client = await Client.findOne({ clientId: parsedParams.data.clientId }).lean();
      if (!client) return reply.code(404).send({ error: 'client_not_found' });

      return { client: exposeClient(client as unknown as Record<string, unknown>) };
    }
  );

  app.patch(
    '/clients/:clientId',
    { config: { auth: true } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = ClientParams.safeParse(request.params);
      const parsedBody = UpdateClientBody.safeParse(request.body);

      if (!parsedParams.success || !parsedBody.success) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      const { clientId } = parsedParams.data;
      const updates = parsedBody.data;

      const current = await Client.findOne({ clientId });
      if (!current) return reply.code(404).send({ error: 'client_not_found' });

      if (updates.clientSecret !== undefined) {
        current.secretHash = await bcrypt.hash(updates.clientSecret, 12);
      }
      if (updates.scopes !== undefined) current.set('scopes', updates.scopes);
      if (updates.permissions !== undefined) current.set('permissions', updates.permissions);
      if (updates.isAdmin !== undefined) current.set('isAdmin', updates.isAdmin);
      if (updates.status !== undefined) current.set('status', updates.status);

      await current.save();

      return {
        client: exposeClient(current.toObject() as Record<string, unknown>),
        secretUpdated: updates.clientSecret !== undefined
      };
    }
  );

  app.delete(
    '/clients/:clientId',
    { config: { auth: true } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = ClientParams.safeParse(request.params);
      if (!parsedParams.success) return reply.code(400).send({ error: 'invalid_request' });

      const result = await Client.deleteOne({ clientId: parsedParams.data.clientId });
      if (result.deletedCount === 0) {
        return reply.code(404).send({ error: 'client_not_found' });
      }

      return reply.code(204).send();
    }
  );
}
