import type { App } from '../app.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Client } from '../models/Client.js';
import { AppUser } from '../models/AppUser.js';
import bcrypt from 'bcryptjs';

const TokenBody = z.object({
  grant_type: z.literal('client_credentials'),
  client_id: z.string(),
  client_secret: z.string(),
  scope: z.string().optional()
});

const UserTokenBody = z.object({
  grant_type: z.literal('password'),
  email: z.string().email(),
  password: z.string().min(1)
});

export async function oauthRoutes(app: App) {
  app.post('/token', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = TokenBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

    const { client_id, client_secret, scope } = parsed.data;
    const client = await Client.findOne({ clientId: client_id }).lean();
    if (!client || client.status !== 'active') {
      return reply.code(401).send({ error: 'invalid_client' });
    }

    const ok = await bcrypt.compare(client_secret, client.secretHash);
    if (!ok) return reply.code(401).send({ error: 'invalid_client' });

    const requestedScopes = scope ? scope.split(' ').filter(Boolean) : client.scopes;

    if (scope) {
      const invalidRequestedScopes = requestedScopes.filter(s => !client.scopes.includes(s));
      if (invalidRequestedScopes.length > 0) {
        return reply.code(400).send({
          error: 'invalid_scope',
          invalid_scopes: invalidRequestedScopes
        });
      }
    }

    const allowedScopes = requestedScopes.filter(s => client.scopes.includes(s));

    const token = await reply.jwtSign(
      {
        sub: client.clientId,
        scopes: allowedScopes,
        perms: client.permissions || [],
        isAdmin: !!client.isAdmin,
        actorType: 'client'
      },
      { expiresIn: app.config.TOKEN_TTL_SECONDS }
    );

    return reply.send({
      access_token: token,
      token_type: 'bearer',
      expires_in: app.config.TOKEN_TTL_SECONDS,
      scope: allowedScopes.join(' ')
    });
  });

  app.post('/user-token', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = UserTokenBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

    const { email, password } = parsed.data;
    const user = await AppUser.findOne({ email: email.toLowerCase() }).lean();
    if (!user || user.status !== 'active') {
      return reply.code(401).send({ error: 'invalid_user' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'invalid_user' });

    const token = await reply.jwtSign(
      {
        sub: user.email,
        scopes: ['portal'],
        perms: [],
        isAdmin: user.role === 'super_admin',
        actorType: 'user',
        role: user.role,
        companyCode: user.companyCode,
        userId: String(user._id),
        externalUserId: user.externalUserId
      },
      { expiresIn: app.config.TOKEN_TTL_SECONDS }
    );

    return reply.send({
      access_token: token,
      token_type: 'bearer',
      expires_in: app.config.TOKEN_TTL_SECONDS,
      scope: 'portal',
      role: user.role,
      companyCode: user.companyCode
    });
  });
}
