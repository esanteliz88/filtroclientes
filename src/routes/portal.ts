import type { App } from '../app.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { IntakeSubmission } from '../models/IntakeSubmission.js';
import { ClinicalStudy } from '../models/ClinicalStudy.js';
import { Types } from 'mongoose';

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  onlyWithMatch: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform(v => (v === undefined ? undefined : v === 'true'))
});

const StudiesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  search: z.string().optional()
});

const StudyBody = z.record(z.unknown()).refine(data => Object.keys(data).length > 0, {
  message: 'study_payload_required'
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

function canSeeCrossCenter(user: FastifyRequest['user']) {
  return user.actorType === 'user' && user.role === 'super_admin';
}

function requireSuperAdmin(user: FastifyRequest['user']) {
  return user.actorType === 'user' && user.role === 'super_admin';
}

function sanitizeSubmissionForActor(
  submission: Record<string, unknown>,
  user: FastifyRequest['user']
) {
  if (canSeeCrossCenter(user)) return submission;
  const out = { ...submission };
  delete out.matchCrossCenter;
  delete out.matchDebug;
  return out;
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
        submissions: submissions.map(s =>
          sanitizeSubmissionForActor(s as unknown as Record<string, unknown>, request.user)
        )
      };
    }
  );

  app.get(
    '/studies',
    { config: { auth: true, scopes: ['portal'], permissions: false } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireSuperAdmin(request.user)) {
        return reply.code(403).send({ error: 'super_admin_only' });
      }

      const parsed = StudiesQuery.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

      const filter: Record<string, unknown> = {};
      if (parsed.data.search) {
        const needle = parsed.data.search.trim();
        if (needle.length > 0) {
          filter.$or = [
            { protocolo: { $regex: needle, $options: 'i' } },
            { enfermedad: { $regex: needle, $options: 'i' } },
            { tipo_enfermedad: { $regex: needle, $options: 'i' } },
            { subtipo: { $regex: needle, $options: 'i' } }
          ];
        }
      }

      const studies = await ClinicalStudy.find(filter)
        .sort({ createdAt: -1 })
        .skip(parsed.data.skip)
        .limit(parsed.data.limit)
        .lean();

      const total = await ClinicalStudy.countDocuments(filter);

      return {
        total,
        limit: parsed.data.limit,
        skip: parsed.data.skip,
        studies
      };
    }
  );

  app.get(
    '/studies/:id',
    { config: { auth: true, scopes: ['portal'], permissions: false } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireSuperAdmin(request.user)) {
        return reply.code(403).send({ error: 'super_admin_only' });
      }

      const id = String((request.params as { id?: string }).id ?? '');
      if (!Types.ObjectId.isValid(id)) return reply.code(400).send({ error: 'invalid_id' });

      const study = await ClinicalStudy.findById(id).lean();
      if (!study) return reply.code(404).send({ error: 'study_not_found' });
      return { study };
    }
  );

  app.post(
    '/studies',
    { config: { auth: true, scopes: ['portal'], permissions: false } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireSuperAdmin(request.user)) {
        return reply.code(403).send({ error: 'super_admin_only' });
      }

      const parsed = StudyBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

      const payload = { ...parsed.data, createdAt: new Date(), updatedAt: new Date() };
      const created = await ClinicalStudy.create(payload);
      return reply.code(201).send({ study: created });
    }
  );

  app.patch(
    '/studies/:id',
    { config: { auth: true, scopes: ['portal'], permissions: false } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireSuperAdmin(request.user)) {
        return reply.code(403).send({ error: 'super_admin_only' });
      }

      const id = String((request.params as { id?: string }).id ?? '');
      if (!Types.ObjectId.isValid(id)) return reply.code(400).send({ error: 'invalid_id' });

      const parsed = StudyBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

      const updates = { ...parsed.data, updatedAt: new Date() };
      const updated = await ClinicalStudy.findByIdAndUpdate(id, updates, { new: true }).lean();
      if (!updated) return reply.code(404).send({ error: 'study_not_found' });
      return { study: updated };
    }
  );

  app.delete(
    '/studies/:id',
    { config: { auth: true, scopes: ['portal'], permissions: false } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireSuperAdmin(request.user)) {
        return reply.code(403).send({ error: 'super_admin_only' });
      }

      const id = String((request.params as { id?: string }).id ?? '');
      if (!Types.ObjectId.isValid(id)) return reply.code(400).send({ error: 'invalid_id' });

      const result = await ClinicalStudy.deleteOne({ _id: id });
      if (result.deletedCount === 0) return reply.code(404).send({ error: 'study_not_found' });
      return reply.code(204).send();
    }
  );
}
