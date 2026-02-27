import type { App } from '../app.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { Client } from '../models/Client.js';
import { IntakeSubmission } from '../models/IntakeSubmission.js';
import { normalizeIntakePayload } from '../utils/intake-normalizer.js';
import { findMatchingStudies } from '../services/study-matcher.js';

const IntakeBodySchema = z.record(z.any());

function hasScope(scopes: string[], needed: string) {
  return scopes.includes(needed);
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
      return new RegExp(p.path).test(url);
    } catch {
      return false;
    }
  });
}

async function authorizeWebhookRequest(app: App, request: FastifyRequest, body: Record<string, unknown>) {
  const authHeader = request.headers.authorization;

  if (authHeader) {
    await app.authenticate(request);
    if (!request.user.isAdmin) {
      if (!hasScope(request.user.scopes, 'write')) {
        return { ok: false as const, code: 403, error: 'insufficient_scopes' };
      }
      const allowed = isAllowedByPermissions(request.user.perms, request.method, request.url);
      if (!allowed) return { ok: false as const, code: 403, error: 'not_allowed' };
    }
    return { ok: true as const };
  }

  const clientId = String(body.client_id ?? body.clientId ?? '').trim();
  const clientSecret = String(body.client_secret ?? body.clientSecret ?? '').trim();
  if (!clientId || !clientSecret) {
    return { ok: false as const, code: 401, error: 'missing_client_credentials' };
  }

  const client = await Client.findOne({ clientId }).lean();
  if (!client || client.status !== 'active') {
    return { ok: false as const, code: 401, error: 'invalid_client' };
  }

  const ok = await bcrypt.compare(clientSecret, client.secretHash);
  if (!ok) return { ok: false as const, code: 401, error: 'invalid_client' };

  if (!client.isAdmin && !hasScope(client.scopes || [], 'write')) {
    return { ok: false as const, code: 403, error: 'insufficient_scopes' };
  }

  if (!client.isAdmin) {
    const allowed = isAllowedByPermissions(client.permissions || [], request.method, request.url);
    if (!allowed) return { ok: false as const, code: 403, error: 'not_allowed' };
  }

  return { ok: true as const };
}

function sanitizeRawPayload(payload: Record<string, unknown>) {
  const out = { ...payload };
  delete out.client_id;
  delete out.client_secret;
  delete out.clientId;
  delete out.clientSecret;
  return out;
}

function normalizeCenter(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function intersectsCenters(studyCenters: unknown, selectedCenters: string[]) {
  if (!Array.isArray(studyCenters) || selectedCenters.length === 0) return false;
  const s = studyCenters.map(normalizeCenter);
  return selectedCenters.some(c => s.includes(normalizeCenter(c)));
}

export async function intakeRoutes(app: App) {
  app.post('/filtroclientes', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = IntakeBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

    const rawBody = parsed.data;
    const auth = await authorizeWebhookRequest(app, request, rawBody);
    if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });

    const rawPayload = sanitizeRawPayload(rawBody);
    const normalized = normalizeIntakePayload(rawPayload);
    const [match, allCentersMatch] = await Promise.all([
      findMatchingStudies(normalized),
      findMatchingStudies(normalized, { centersOverride: null })
    ]);
    const matchDebug = (match as { debug?: unknown }).debug ?? null;
    const selectedCenters = normalized.centro ?? [];

    const otherCenterStudies = (allCentersMatch.studies ?? []).filter(study => {
      return !intersectsCenters((study as { centros_protocolo?: unknown }).centros_protocolo, selectedCenters);
    });

    const matchCrossCenter = {
      total_matches_current_center: match.total_matches,
      total_matches_all_centers: allCentersMatch.total_matches,
      total_matches_other_centers: otherCenterStudies.length,
      studies_other_centers: otherCenterStudies
    };

    const saved = await IntakeSubmission.create({
      source: 'filtroclientes',
      sourceUserId: normalized.user_id,
      sourceUserRef: normalized.user_ref,
      companyCodes: normalized.centro,
      rawPayload,
      normalized,
      match,
      matchCrossCenter,
      matchDebug
    });

    const canExposeCrossCenter =
      request.user?.actorType === 'user' && request.user?.role === 'super_admin';

    return reply.code(201).send({
      ok: true,
      id: saved._id,
      normalized,
      match,
      ...(canExposeCrossCenter ? { matchCrossCenter } : {})
    });
  });
}
