import type { App } from '../app.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { IntakeSubmission } from '../models/IntakeSubmission.js';

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  onlyWithMatch: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform(v => (v === undefined ? undefined : v === 'true'))
});

function buildUserSubmissionFilter(user: FastifyRequest['user']) {
  if (user.actorType !== 'user') return null;

  if (user.role === 'super_admin') return {};

  if (user.role === 'company_admin') {
    if (!user.companyCode) return { _id: null };
    return { companyCodes: user.companyCode.toLowerCase() };
  }

  if (user.role === 'company_user') {
    if (user.externalUserId !== null && user.externalUserId !== undefined) {
      return { sourceUserId: user.externalUserId };
    }
    if (user.companyCode) {
      return { companyCodes: user.companyCode.toLowerCase() };
    }
    return { _id: null };
  }

  return { _id: null };
}

export async function portalRoutes(app: App) {
  app.get(
    '/submissions',
    { config: { auth: true, scopes: ['portal'], permissions: false } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = QuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

      const filter = buildUserSubmissionFilter(request.user);
      if (filter === null) return reply.code(403).send({ error: 'forbidden_actor' });

      const queryFilter: Record<string, unknown> = { ...filter };
      if (parsed.data.onlyWithMatch === true) {
        queryFilter['match.total_matches'] = { $gt: 0 };
      }
      if (parsed.data.onlyWithMatch === false) {
        queryFilter['$or'] = [{ 'match.total_matches': 0 }, { match: null }];
      }

      const submissions = await IntakeSubmission.find(queryFilter)
        .sort({ createdAt: -1 })
        .skip(parsed.data.skip)
        .limit(parsed.data.limit)
        .lean();

      const total = await IntakeSubmission.countDocuments(queryFilter);

      return {
        total,
        limit: parsed.data.limit,
        skip: parsed.data.skip,
        submissions
      };
    }
  );
}
