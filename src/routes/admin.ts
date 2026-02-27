import type { App } from '../app.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Client } from '../models/Client.js';
import { Company } from '../models/Company.js';
import { AppUser } from '../models/AppUser.js';
import { IntakeSubmission } from '../models/IntakeSubmission.js';

const PermissionSchema = z.object({ method: z.string(), path: z.string() });
const RoleSchema = z.enum(['super_admin', 'company_admin', 'company_user']);
const StatusSchema = z.enum(['active', 'disabled']);
const StrongPasswordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password is too long')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[0-9]/, 'Password must include a number')
  .regex(/[^A-Za-z0-9]/, 'Password must include a symbol')
  .regex(/^\S+$/, 'Password cannot contain spaces');

const IdParam = z.object({
  id: z.string().min(1)
});

const CreateClientBody = z.object({
  clientId: z.string().min(4),
  clientSecret: z.string().min(8).optional(),
  companyCodes: z.array(z.string()).default([]),
  scopes: z.array(z.string()).default([]),
  permissions: z.array(PermissionSchema).default([]),
  isAdmin: z.boolean().default(false)
});

const UpdateClientBody = z
  .object({
    clientSecret: z.string().min(8).optional(),
    companyCodes: z.array(z.string()).optional(),
    scopes: z.array(z.string()).optional(),
    permissions: z.array(PermissionSchema).optional(),
    isAdmin: z.boolean().optional(),
    status: StatusSchema.optional()
  })
  .refine(
    data =>
      data.clientSecret !== undefined ||
      data.companyCodes !== undefined ||
      data.scopes !== undefined ||
      data.permissions !== undefined ||
      data.isAdmin !== undefined ||
      data.status !== undefined,
    { message: 'At least one field is required' }
  );

const CreateUserBody = z
  .object({
    email: z.string().email(),
    fullName: z.string().min(2),
    password: StrongPasswordSchema.optional(),
    role: RoleSchema,
    companyCode: z.string().min(1).optional().nullable(),
    externalUserId: z.coerce.number().int().optional().nullable(),
    status: StatusSchema.default('active')
  })
  .superRefine((data, ctx) => {
    if (data.role !== 'super_admin' && !data.companyCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['companyCode'],
        message: 'companyCode is required for company_admin and company_user'
      });
    }
  });

const UpdateUserBody = z
  .object({
    fullName: z.string().min(2).optional(),
    password: StrongPasswordSchema.optional(),
    role: RoleSchema.optional(),
    companyCode: z.string().min(1).optional().nullable(),
    externalUserId: z.coerce.number().int().optional().nullable(),
    status: StatusSchema.optional()
  })
  .refine(
    data =>
      data.fullName !== undefined ||
      data.password !== undefined ||
      data.role !== undefined ||
      data.companyCode !== undefined ||
      data.externalUserId !== undefined ||
      data.status !== undefined,
    { message: 'At least one field is required' }
  );

const SubmissionQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  companyCode: z.string().optional(),
  externalUserId: z.coerce.number().int().optional(),
  onlyWithMatch: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform(v => (v === undefined ? undefined : v === 'true'))
});

const CreateCompanyBody = z.object({
  name: z.string().min(2),
  code: z.string().min(2).optional(),
  status: StatusSchema.default('active')
});

const UpdateCompanyBody = z
  .object({
    name: z.string().min(2).optional(),
    code: z.string().min(2).optional(),
    status: StatusSchema.optional()
  })
  .refine(data => data.name !== undefined || data.code !== undefined || data.status !== undefined, {
    message: 'At least one field is required'
  });

function isObjectId(value: string) {
  return Types.ObjectId.isValid(value);
}

function findClientByIdOrClientId(id: string) {
  if (isObjectId(id)) return Client.findById(id);
  return Client.findOne({ clientId: id });
}

function deleteClientByIdOrClientId(id: string) {
  if (isObjectId(id)) return Client.deleteOne({ _id: id });
  return Client.deleteOne({ clientId: id });
}

function exposeClient(client: Record<string, unknown>) {
  return {
    id: String(client._id ?? ''),
    clientId: client.clientId,
    companyCodes: client.companyCodes,
    scopes: client.scopes,
    permissions: client.permissions,
    isAdmin: client.isAdmin,
    status: client.status,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt
  };
}

function exposeUser(user: Record<string, unknown>) {
  return {
    id: String(user._id ?? ''),
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    companyCode: user.companyCode,
    externalUserId: user.externalUserId,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function normalizeCompanyCode(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();
}

function canSeeCrossCenter(user: FastifyRequest['user']) {
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

async function generateUniqueCompanyCode(nameOrCode: string) {
  const base = normalizeCompanyCode(nameOrCode) || 'company';
  let code = base;
  let i = 1;

  while (await Company.exists({ code })) {
    code = `${base}-${i}`;
    i += 1;
  }

  return code;
}

async function validateCompanyCodesExist(companyCodes: string[]) {
  const normalized = companyCodes.map(c => c.toLowerCase());
  if (normalized.length === 0) return { ok: true as const, normalized };

  const found = await Company.find({ code: { $in: normalized }, status: 'active' }, { code: 1 }).lean();
  const foundSet = new Set(found.map(f => String(f.code)));
  const missing = normalized.filter(c => !foundSet.has(c));
  if (missing.length > 0) return { ok: false as const, missing };

  return { ok: true as const, normalized };
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

  app.post('/clients', { config: { auth: true } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = CreateClientBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

    const { clientId, clientSecret, companyCodes, scopes, permissions, isAdmin } = parsed.data;
    const companyValidation = await validateCompanyCodesExist(companyCodes);
    if (!companyValidation.ok) {
      return reply.code(400).send({ error: 'invalid_company_codes', missing: companyValidation.missing });
    }
    const existing = await Client.findOne({ clientId }).lean();
    if (existing) return reply.code(409).send({ error: 'client_exists' });

    const rawSecret = clientSecret ?? crypto.randomBytes(24).toString('hex');
    const secretHash = await bcrypt.hash(rawSecret, 12);

    const created = await Client.create({
      clientId,
      secretHash,
      companyCodes: companyValidation.normalized,
      scopes,
      permissions,
      isAdmin
    });

    return reply.code(201).send({
      client: exposeClient(created.toObject() as Record<string, unknown>),
      clientSecret: rawSecret
    });
  });

  app.get('/clients', { config: { auth: true } }, async () => {
    const clients = await Client.find(
      {},
      { clientId: 1, scopes: 1, permissions: 1, isAdmin: 1, status: 1, createdAt: 1, updatedAt: 1 }
    ).lean();
    return { clients: clients.map(c => exposeClient(c as unknown as Record<string, unknown>)) };
  });

  app.get('/clients/:id', { config: { auth: true } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = IdParam.safeParse(request.params);
    if (!parsedParams.success) return reply.code(400).send({ error: 'invalid_request' });

    const client = await findClientByIdOrClientId(parsedParams.data.id);
    if (!client) return reply.code(404).send({ error: 'client_not_found' });

    return { client: exposeClient(client.toObject() as Record<string, unknown>) };
  });

  app.patch('/clients/:id', { config: { auth: true } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = IdParam.safeParse(request.params);
    const parsedBody = UpdateClientBody.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }

    const current = await findClientByIdOrClientId(parsedParams.data.id);
    if (!current) return reply.code(404).send({ error: 'client_not_found' });

    const updates = parsedBody.data;
    if (updates.clientSecret !== undefined) current.secretHash = await bcrypt.hash(updates.clientSecret, 12);
    if (updates.companyCodes !== undefined) {
      const companyValidation = await validateCompanyCodesExist(updates.companyCodes);
      if (!companyValidation.ok) {
        return reply.code(400).send({ error: 'invalid_company_codes', missing: companyValidation.missing });
      }
      current.set('companyCodes', companyValidation.normalized);
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
  });

  app.delete('/clients/:id', { config: { auth: true } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = IdParam.safeParse(request.params);
    if (!parsedParams.success) return reply.code(400).send({ error: 'invalid_request' });

    const result = await deleteClientByIdOrClientId(parsedParams.data.id);
    if (result.deletedCount === 0) return reply.code(404).send({ error: 'client_not_found' });
    return reply.code(204).send();
  });

  app.post('/users', { config: { auth: true } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = CreateUserBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

    const data = parsed.data;
    if (data.role !== 'super_admin') {
      const companyValidation = await validateCompanyCodesExist([String(data.companyCode)]);
      if (!companyValidation.ok) {
        return reply.code(400).send({ error: 'invalid_company_code', missing: companyValidation.missing });
      }
    }
    const email = data.email.toLowerCase();
    const exists = await AppUser.findOne({ email }).lean();
    if (exists) return reply.code(409).send({ error: 'user_exists' });

    const passwordWasProvided = data.password !== undefined;
    const rawPassword = data.password ?? crypto.randomBytes(16).toString('hex');
    const passwordHash = await bcrypt.hash(rawPassword, 12);

    const created = await AppUser.create({
      email,
      fullName: data.fullName,
      passwordHash,
      role: data.role,
      companyCode: data.role === 'super_admin' ? null : data.companyCode?.toLowerCase() ?? null,
      externalUserId: data.externalUserId ?? null,
      status: data.status
    });

    return reply.code(201).send(
      passwordWasProvided
        ? {
            user: exposeUser(created.toObject() as Record<string, unknown>)
          }
        : {
            user: exposeUser(created.toObject() as Record<string, unknown>),
            generatedPassword: rawPassword
          }
    );
  });

  app.get('/users', { config: { auth: true } }, async (request: FastifyRequest) => {
    const query = request.query as { companyCode?: string; role?: string; status?: string };
    const filter: Record<string, unknown> = {};
    if (query.companyCode) filter.companyCode = query.companyCode.toLowerCase();
    if (query.role) filter.role = query.role;
    if (query.status) filter.status = query.status;

    const users = await AppUser.find(filter).sort({ createdAt: -1 }).lean();
    return { users: users.map(u => exposeUser(u as unknown as Record<string, unknown>)) };
  });

  app.get('/users/:id', { config: { auth: true } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = IdParam.safeParse(request.params);
    if (!parsedParams.success || !isObjectId(parsedParams.data.id)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }

    const user = await AppUser.findById(parsedParams.data.id).lean();
    if (!user) return reply.code(404).send({ error: 'user_not_found' });

    return { user: exposeUser(user as unknown as Record<string, unknown>) };
  });

  app.patch('/users/:id', { config: { auth: true } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = IdParam.safeParse(request.params);
    const parsedBody = UpdateUserBody.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success || !isObjectId(parsedParams.data.id)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }

    const user = await AppUser.findById(parsedParams.data.id);
    if (!user) return reply.code(404).send({ error: 'user_not_found' });

    const data = parsedBody.data;
    if (data.fullName !== undefined) user.set('fullName', data.fullName);
    if (data.password !== undefined) user.set('passwordHash', await bcrypt.hash(data.password, 12));
    if (data.role !== undefined) user.set('role', data.role);
    if (data.companyCode !== undefined) {
      if (data.companyCode) {
        const companyValidation = await validateCompanyCodesExist([data.companyCode]);
        if (!companyValidation.ok) {
          return reply.code(400).send({ error: 'invalid_company_code', missing: companyValidation.missing });
        }
        user.set('companyCode', companyValidation.normalized[0]);
      } else {
        user.set('companyCode', null);
      }
    }
    if (data.externalUserId !== undefined) user.set('externalUserId', data.externalUserId ?? null);
    if (data.status !== undefined) user.set('status', data.status);

    if (user.get('role') !== 'super_admin' && !user.get('companyCode')) {
      return reply.code(400).send({ error: 'companyCode_required_for_role' });
    }

    await user.save();

    return {
      user: exposeUser(user.toObject() as Record<string, unknown>),
      passwordUpdated: data.password !== undefined
    };
  });

  app.delete('/users/:id', { config: { auth: true } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = IdParam.safeParse(request.params);
    if (!parsedParams.success || !isObjectId(parsedParams.data.id)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }

    const result = await AppUser.deleteOne({ _id: parsedParams.data.id });
    if (result.deletedCount === 0) return reply.code(404).send({ error: 'user_not_found' });
    return reply.code(204).send();
  });

  app.get('/submissions', { config: { auth: true } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = SubmissionQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

    const filter: Record<string, unknown> = {};
    if (parsed.data.companyCode) filter.companyCodes = parsed.data.companyCode.toLowerCase();
    if (parsed.data.externalUserId !== undefined) filter.sourceUserId = parsed.data.externalUserId;
    if (parsed.data.onlyWithMatch === true) filter['match.total_matches'] = { $gt: 0 };
    if (parsed.data.onlyWithMatch === false) filter['$or'] = [{ 'match.total_matches': 0 }, { match: null }];

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
      submissions: submissions.map(s =>
        sanitizeSubmissionForActor(s as unknown as Record<string, unknown>, request.user)
      )
    };
  });

  app.get('/submissions/:id/derivation', { config: { auth: true } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = IdParam.safeParse(request.params);
    if (!parsedParams.success || !isObjectId(parsedParams.data.id)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }

    if (!(request.user.actorType === 'user' && request.user.role === 'super_admin')) {
      return reply.code(403).send({ error: 'super_admin_only' });
    }

    const submission = await IntakeSubmission.findById(parsedParams.data.id).lean();
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
  });

  app.post('/companies', { config: { auth: true } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = CreateCompanyBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

    const name = parsed.data.name.trim();
    const code = await generateUniqueCompanyCode(parsed.data.code ?? name);

    const existsByName = await Company.findOne({ name }).lean();
    if (existsByName) return reply.code(409).send({ error: 'company_name_exists' });

    const created = await Company.create({
      name,
      code,
      status: parsed.data.status
    });

    return reply.code(201).send({ company: created });
  });

  app.get('/companies', { config: { auth: true } }, async () => {
    const companies = await Company.find({}).sort({ name: 1 }).lean();
    return { companies };
  });

  app.patch('/companies/:id', { config: { auth: true } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = IdParam.safeParse(request.params);
    const parsedBody = UpdateCompanyBody.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success || !isObjectId(parsedParams.data.id)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }

    const company = await Company.findById(parsedParams.data.id);
    if (!company) return reply.code(404).send({ error: 'company_not_found' });

    if (parsedBody.data.name !== undefined) company.set('name', parsedBody.data.name.trim());
    if (parsedBody.data.code !== undefined) {
      const normalized = normalizeCompanyCode(parsedBody.data.code);
      if (!normalized) return reply.code(400).send({ error: 'invalid_company_code' });
      const exists = await Company.findOne({ code: normalized, _id: { $ne: company._id } }).lean();
      if (exists) return reply.code(409).send({ error: 'company_code_exists' });
      company.set('code', normalized);
    }
    if (parsedBody.data.status !== undefined) company.set('status', parsedBody.data.status);

    await company.save();
    return { company };
  });
}
