import type { App } from '../app.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { IntakeSubmission } from '../models/IntakeSubmission.js';
import { ClinicalStudy } from '../models/ClinicalStudy.js';
import { Types } from 'mongoose';
import { sendMatchWebhook } from '../services/n8n-webhook.js';

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
  search: z.string().optional(),
  includeDisabled: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform(v => (v === undefined ? undefined : v === 'true'))
});

const StudyBody = z.record(z.unknown()).refine(data => Object.keys(data).length > 0, {
  message: 'study_payload_required'
});

const NotifyBody = z.object({
  submissionId: z.string().optional(),
  payload: z.record(z.unknown()).optional()
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
    '/submissions/:id/derivation',
    { config: { auth: true, scopes: ['portal'], permissions: false } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireSuperAdmin(request.user)) {
        return reply.code(403).send({ error: 'super_admin_only' });
      }

      const id = String((request.params as { id?: string }).id ?? '');
      if (!Types.ObjectId.isValid(id)) return reply.code(400).send({ error: 'invalid_id' });

      const submission = await IntakeSubmission.findById(id).lean();
      if (!submission) return reply.code(404).send({ error: 'submission_not_found' });

      const currentCenterTotal =
        typeof submission?.match === 'object' && submission?.match !== null
          ? Number((submission.match as Record<string, unknown>).total_matches ?? 0)
          : 0;

      const cross = (submission.matchCrossCenter as Record<string, unknown> | null) ?? null;
      const studiesOtherCenters = Array.isArray(cross?.studies_other_centers) ? cross?.studies_other_centers : [];

      return {
        submissionId: String(submission._id),
        companyCodes: submission.companyCodes ?? [],
        sourceUserRef: submission.sourceUserRef ?? null,
        createdAt: submission.createdAt ?? null,
        current_center: {
          total_matches: currentCenterTotal,
          studies: (submission.match as Record<string, unknown> | null)?.studies ?? []
        },
        derivation: {
          total_matches_all_centers: Number(cross?.total_matches_all_centers ?? 0),
          total_matches_other_centers: Number(cross?.total_matches_other_centers ?? studiesOtherCenters.length),
          studies_other_centers: studiesOtherCenters
        },
        debug: submission.matchDebug ?? null
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

      const clauses: Record<string, unknown>[] = [];
      if (parsed.data.search) {
        const needle = parsed.data.search.trim();
        if (needle.length > 0) {
          clauses.push({
            $or: [
              { protocolo: { $regex: needle, $options: 'i' } },
              { enfermedad: { $regex: needle, $options: 'i' } },
              { tipo_enfermedad: { $regex: needle, $options: 'i' } },
              { subtipo: { $regex: needle, $options: 'i' } }
            ]
          });
        }
      }
      if (parsed.data.includeDisabled !== true) {
        clauses.push({ $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] });
      }
      const filter =
        clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0] : { $and: clauses };

      const studiesRaw = await ClinicalStudy.find(filter)
        .sort({ createdAt: -1 })
        .skip(parsed.data.skip)
        .limit(parsed.data.limit)
        .lean();

      const total = await ClinicalStudy.countDocuments(filter);

      const formatted = studiesRaw.map(study => {
        const doc = study as Record<string, unknown>;
        return { ...doc, activo: (doc as { deletedAt?: unknown }).deletedAt ? false : true };
      });

      return {
        total,
        limit: parsed.data.limit,
        skip: parsed.data.skip,
        studies: formatted
      };
    }
  );

  app.get(
    '/studies/all',
    { config: { auth: true, scopes: ['portal'], permissions: false } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireSuperAdmin(request.user)) {
        return reply.code(403).send({ error: 'super_admin_only' });
      }

      const studiesRaw = await ClinicalStudy.find({}).sort({ createdAt: -1 }).lean();
      const studies = studiesRaw.map(study => {
        const doc = study as Record<string, unknown>;
        return { ...doc, activo: (doc as { deletedAt?: unknown }).deletedAt ? false : true };
      });

      return {
        total: studies.length,
        limit: studies.length,
        skip: 0,
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

      const includeDisabled =
        String((request.query as { includeDisabled?: string })?.includeDisabled ?? '') === 'true';
      const id = String((request.params as { id?: string }).id ?? '');
      if (!Types.ObjectId.isValid(id)) return reply.code(400).send({ error: 'invalid_id' });

      const baseFilter = includeDisabled
        ? { _id: id }
        : { _id: id, $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] };
      const study = await ClinicalStudy.findOne(baseFilter).lean();
      if (!study) return reply.code(404).send({ error: 'study_not_found' });
      return {
        study: {
          ...(study as Record<string, unknown>),
          activo: (study as { deletedAt?: unknown }).deletedAt ? false : true
        }
      };
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

      const payload = { ...parsed.data, createdAt: new Date(), updatedAt: new Date() } as Record<
        string,
        unknown
      >;
      if (typeof (payload as { activo?: boolean }).activo === 'boolean') {
        (payload as { deletedAt?: Date | null }).deletedAt =
          (payload as { activo?: boolean }).activo ? null : new Date();
      }
      const created = await ClinicalStudy.create(payload);
      const createdSafe =
        (created as unknown as { toObject?: () => Record<string, unknown> })?.toObject?.() ?? created;
      return reply.code(201).send({
        study: {
          ...(createdSafe as Record<string, unknown>),
          activo: (createdSafe as { deletedAt?: unknown }).deletedAt ? false : true
        }
      });
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

      const payload = parsed.data as Record<string, unknown>;
      const wantsRestore = payload.activo === true;
      const wantsDisable = payload.activo === false;

      const setUpdates: Record<string, unknown> = { ...payload, updatedAt: new Date() };
      delete setUpdates.activo;

      const updateDoc: Record<string, unknown> = { $set: setUpdates };
      if (wantsRestore) {
        updateDoc.$unset = { deletedAt: '' };
      }
      if (wantsDisable) {
        (updateDoc.$set as Record<string, unknown>).deletedAt = new Date();
      }

      const query: Record<string, unknown> = { _id: id };
      if (!wantsRestore) {
        query.deletedAt = { $exists: false };
      }

      const updated = await ClinicalStudy.findOneAndUpdate(query, updateDoc, { new: true }).lean();
      if (!updated) return reply.code(404).send({ error: 'study_not_found' });
      return {
        study: {
          ...(updated as Record<string, unknown>),
          activo: (updated as { deletedAt?: unknown }).deletedAt ? false : true
        }
      };
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

      const deleted = await ClinicalStudy.findOneAndUpdate(
        { _id: id, deletedAt: { $exists: false } },
        { deletedAt: new Date(), updatedAt: new Date() },
        { new: true }
      ).lean();
      if (!deleted) return reply.code(404).send({ error: 'study_not_found' });
      return reply.code(204).send();
    }
  );

  app.post(
    '/notify-match',
    { config: { auth: true, scopes: ['portal'], permissions: false } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireSuperAdmin(request.user)) {
        return reply.code(403).send({ error: 'super_admin_only' });
      }

      const parsed = NotifyBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

      const submissionId = parsed.data.submissionId;
      const payload = parsed.data.payload;

      if (!submissionId && !payload) {
        return reply.code(400).send({ error: 'submission_or_payload_required' });
      }

      if (payload) {
        await sendMatchWebhook(app, { trigger: 'manual', ...payload });
        return reply.code(202).send({ ok: true });
      }

      if (!Types.ObjectId.isValid(submissionId as string)) {
        return reply.code(400).send({ error: 'invalid_id' });
      }

      const submission = await IntakeSubmission.findById(submissionId).lean();
      if (!submission) return reply.code(404).send({ error: 'submission_not_found' });

      const match = submission.match as Record<string, unknown> | null;
      const total = Number(match?.total_matches ?? 0);
      const matchReason = total > 0 ? 'with_match' : 'no_match';
      const topReasons = (submission.matchDebug as { top_reasons?: unknown } | null)?.top_reasons ?? null;

      await sendMatchWebhook(app, {
        trigger: 'manual',
        match_status: matchReason,
        total_matches: total,
        top_reasons: topReasons,
        submission
      });

      return reply.code(202).send({ ok: true });
    }
  );
}
