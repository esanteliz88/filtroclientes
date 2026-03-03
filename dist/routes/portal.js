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
    search: z.string().optional(),
    includeDisabled: z
        .union([z.literal('true'), z.literal('false')])
        .optional()
        .transform(v => (v === undefined ? undefined : v === 'true'))
});
const StudyBody = z.record(z.unknown()).refine(data => Object.keys(data).length > 0, {
    message: 'study_payload_required'
});
function buildUserSubmissionFilter(user) {
    if (user.actorType !== 'user')
        return null;
    if (user.role === 'super_admin')
        return {};
    if (user.role === 'company_admin') {
        if (!user.companyCode)
            return { _id: null };
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
function canSeeCrossCenter(user) {
    return user.actorType === 'user' && user.role === 'super_admin';
}
function requireSuperAdmin(user) {
    return user.actorType === 'user' && user.role === 'super_admin';
}
function sanitizeSubmissionForActor(submission, user) {
    if (canSeeCrossCenter(user))
        return submission;
    const out = { ...submission };
    delete out.matchCrossCenter;
    delete out.matchDebug;
    return out;
}
export async function portalRoutes(app) {
    app.get('/submissions', { config: { auth: true, scopes: ['portal'], permissions: false } }, async (request, reply) => {
        const parsed = QuerySchema.safeParse(request.query);
        if (!parsed.success)
            return reply.code(400).send({ error: 'invalid_request' });
        const filter = buildUserSubmissionFilter(request.user);
        if (filter === null)
            return reply.code(403).send({ error: 'forbidden_actor' });
        const queryFilter = { ...filter };
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
            submissions: submissions.map(s => sanitizeSubmissionForActor(s, request.user))
        };
    });
    app.get('/submissions/:id/derivation', { config: { auth: true, scopes: ['portal'], permissions: false } }, async (request, reply) => {
        if (!requireSuperAdmin(request.user)) {
            return reply.code(403).send({ error: 'super_admin_only' });
        }
        const id = String(request.params.id ?? '');
        if (!Types.ObjectId.isValid(id))
            return reply.code(400).send({ error: 'invalid_id' });
        const submission = await IntakeSubmission.findById(id).lean();
        if (!submission)
            return reply.code(404).send({ error: 'submission_not_found' });
        const currentCenterTotal = typeof submission?.match === 'object' && submission?.match !== null
            ? Number(submission.match.total_matches ?? 0)
            : 0;
        const cross = submission.matchCrossCenter ?? null;
        const studiesOtherCenters = Array.isArray(cross?.studies_other_centers) ? cross?.studies_other_centers : [];
        return {
            submissionId: String(submission._id),
            companyCodes: submission.companyCodes ?? [],
            sourceUserRef: submission.sourceUserRef ?? null,
            createdAt: submission.createdAt ?? null,
            current_center: {
                total_matches: currentCenterTotal,
                studies: submission.match?.studies ?? []
            },
            derivation: {
                total_matches_all_centers: Number(cross?.total_matches_all_centers ?? 0),
                total_matches_other_centers: Number(cross?.total_matches_other_centers ?? studiesOtherCenters.length),
                studies_other_centers: studiesOtherCenters
            },
            debug: submission.matchDebug ?? null
        };
    });
    app.get('/studies', { config: { auth: true, scopes: ['portal'], permissions: false } }, async (request, reply) => {
        if (!requireSuperAdmin(request.user)) {
            return reply.code(403).send({ error: 'super_admin_only' });
        }
        const parsed = StudiesQuery.safeParse(request.query);
        if (!parsed.success)
            return reply.code(400).send({ error: 'invalid_request' });
        const clauses = [];
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
            clauses.push({
                $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }]
            });
        }
        const filter = clauses.length === 0 ? {} : (clauses.length === 1 ? clauses[0] : { $and: clauses });
        const studiesRaw = await ClinicalStudy.find(filter)
            .sort({ createdAt: -1 })
            .skip(parsed.data.skip)
            .limit(parsed.data.limit)
            .lean();
        const total = await ClinicalStudy.countDocuments(filter);
        const studies = studiesRaw.map(study => ({
            ...study,
            activo: study.deletedAt ? false : true
        }));
        return {
            total,
            limit: parsed.data.limit,
            skip: parsed.data.skip,
            studies
        };
    });
    app.get('/studies/all', { config: { auth: true, scopes: ['portal'], permissions: false } }, async (request, reply) => {
        if (!requireSuperAdmin(request.user)) {
            return reply.code(403).send({ error: 'super_admin_only' });
        }
        const studiesRaw = await ClinicalStudy.find({}).sort({ createdAt: -1 }).lean();
        const studies = studiesRaw.map(study => ({
            ...study,
            activo: study.deletedAt ? false : true
        }));
        return {
            total: studies.length,
            limit: studies.length,
            skip: 0,
            studies
        };
    });
    app.get('/studies/:id', { config: { auth: true, scopes: ['portal'], permissions: false } }, async (request, reply) => {
        if (!requireSuperAdmin(request.user)) {
            return reply.code(403).send({ error: 'super_admin_only' });
        }
        const includeDisabled = String(request.query?.includeDisabled ?? '') === 'true';
        const id = String(request.params.id ?? '');
        if (!Types.ObjectId.isValid(id))
            return reply.code(400).send({ error: 'invalid_id' });
        const baseFilter = includeDisabled
            ? { _id: id }
            : { _id: id, $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] };
        const study = await ClinicalStudy.findOne(baseFilter).lean();
        if (!study)
            return reply.code(404).send({ error: 'study_not_found' });
        return { study: { ...study, activo: study.deletedAt ? false : true } };
    });
    app.post('/studies', { config: { auth: true, scopes: ['portal'], permissions: false } }, async (request, reply) => {
        if (!requireSuperAdmin(request.user)) {
            return reply.code(403).send({ error: 'super_admin_only' });
        }
        const parsed = StudyBody.safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'invalid_request' });
        const payload = { ...parsed.data, createdAt: new Date(), updatedAt: new Date() };
        if (typeof payload.activo === 'boolean') {
            payload.deletedAt = payload.activo ? null : new Date();
        }
        const created = await ClinicalStudy.create(payload);
        const createdSafe = created?.toObject ? created.toObject() : created;
        return reply.code(201).send({
            study: { ...createdSafe, activo: createdSafe?.deletedAt ? false : true }
        });
    });
    app.patch('/studies/:id', { config: { auth: true, scopes: ['portal'], permissions: false } }, async (request, reply) => {
        if (!requireSuperAdmin(request.user)) {
            return reply.code(403).send({ error: 'super_admin_only' });
        }
        const id = String(request.params.id ?? '');
        if (!Types.ObjectId.isValid(id))
            return reply.code(400).send({ error: 'invalid_id' });
        const parsed = StudyBody.safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'invalid_request' });
        const updates = { ...parsed.data, updatedAt: new Date() };
        if (typeof updates.activo === 'boolean') {
            updates.deletedAt = updates.activo ? null : new Date();
        }
        const updated = await ClinicalStudy.findByIdAndUpdate(id, updates, { new: true }).lean();
        if (!updated)
            return reply.code(404).send({ error: 'study_not_found' });
        return { study: { ...updated, activo: updated.deletedAt ? false : true } };
    });
    app.delete('/studies/:id', { config: { auth: true, scopes: ['portal'], permissions: false } }, async (request, reply) => {
        if (!requireSuperAdmin(request.user)) {
            return reply.code(403).send({ error: 'super_admin_only' });
        }
        const id = String(request.params.id ?? '');
        if (!Types.ObjectId.isValid(id))
            return reply.code(400).send({ error: 'invalid_id' });
        const updated = await ClinicalStudy.findByIdAndUpdate(id, { deletedAt: new Date(), updatedAt: new Date() }, { new: true }).lean();
        if (!updated)
            return reply.code(404).send({ error: 'study_not_found' });
        return reply.code(204).send();
    });
}
