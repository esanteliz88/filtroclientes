import type { App } from '../app.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { IntakeSubmission } from '../models/IntakeSubmission.js';

const SubmissionQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  onlyWithMatch: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform(v => (v === undefined ? undefined : v === 'true')),
  sourceUserId: z.coerce.number().int().optional()
});

const MetricsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30)
});

export async function protectedRoutes(app: App) {
  app.get(
    '/data',
    {
      config: { auth: true, scopes: ['read'], permissions: true }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const cacheKey = `data:${request.user.sub}`;
      const redis = app.hasDecorator('redis') ? app.redis : null;

      if (redis) {
        const cached = await redis.get(cacheKey);
        if (cached) return reply.send(JSON.parse(cached));
      }

      const payload = {
        message: 'secure read data',
        at: new Date().toISOString(),
        client: request.user.sub
      };

      if (redis) {
        await redis.set(cacheKey, JSON.stringify(payload), 'EX', 30);
      }

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

  app.get(
    '/submissions',
    {
      config: { auth: true, scopes: ['read'], permissions: true }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.user.actorType === 'user') {
        return reply.code(403).send({ error: 'user_token_not_allowed' });
      }

      const parsed = SubmissionQuery.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

      const companyCodes = (request.user.companyCodes || []).map(c => String(c).toLowerCase());
      if (!request.user.isAdmin && companyCodes.length === 0) {
        return reply.code(403).send({ error: 'missing_company_scope' });
      }

      const filter: Record<string, unknown> = {};
      if (!request.user.isAdmin) {
        filter.companyCodes = { $in: companyCodes };
      }
      if (parsed.data.sourceUserId !== undefined) {
        filter.sourceUserId = parsed.data.sourceUserId;
      }
      if (parsed.data.onlyWithMatch === true) {
        filter['match.total_matches'] = { $gt: 0 };
      }
      if (parsed.data.onlyWithMatch === false) {
        filter['$or'] = [{ 'match.total_matches': 0 }, { match: null }];
      }

      const submissions = await IntakeSubmission.find(filter)
        .sort({ createdAt: -1 })
        .skip(parsed.data.skip)
        .limit(parsed.data.limit)
        .lean();

      const total = await IntakeSubmission.countDocuments(filter);

      return {
        total,
        limit: parsed.data.limit,
        skip: parsed.data.skip,
        submissions
      };
    }
  );

  app.get(
    '/metrics',
    {
      config: { auth: true, scopes: ['read'], permissions: true }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.user.actorType === 'user') {
        return reply.code(403).send({ error: 'user_token_not_allowed' });
      }

      const parsed = MetricsQuery.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

      const companyCodes = (request.user.companyCodes || []).map(c => String(c).toLowerCase());
      if (!request.user.isAdmin && companyCodes.length === 0) {
        return reply.code(403).send({ error: 'missing_company_scope' });
      }

      const since = new Date();
      since.setDate(since.getDate() - parsed.data.days);

      const filter: Record<string, unknown> = {
        createdAt: { $gte: since }
      };
      if (!request.user.isAdmin) {
        filter.companyCodes = { $in: companyCodes };
      }

      const [total, withMatch, withoutMatch] = await Promise.all([
        IntakeSubmission.countDocuments(filter),
        IntakeSubmission.countDocuments({ ...filter, 'match.total_matches': { $gt: 0 } }),
        IntakeSubmission.countDocuments({
          ...filter,
          $or: [{ 'match.total_matches': 0 }, { match: null }]
        })
      ]);

      return {
        days: parsed.data.days,
        total,
        with_match: withMatch,
        without_match: withoutMatch
      };
    }
  );
}
