import type { App } from '../app.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { IntakeSubmission } from '../models/IntakeSubmission.js';
import { normalizeIntakePayload } from '../utils/intake-normalizer.js';
import { findMatchingStudies } from '../services/study-matcher.js';

const IntakeBodySchema = z.record(z.any());

export async function intakeRoutes(app: App) {
  app.post(
    '/filtroclientes',
    {
      config: { auth: true, scopes: ['write'], permissions: true }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = IntakeBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

      const rawPayload = parsed.data;
      const normalized = normalizeIntakePayload(rawPayload);
      const match = await findMatchingStudies(normalized);

      const saved = await IntakeSubmission.create({
        source: 'filtroclientes',
        sourceUserId: normalized.user_id,
        companyCodes: normalized.centro,
        rawPayload,
        normalized,
        match
      });

      return reply.code(201).send({
        ok: true,
        id: saved._id,
        normalized,
        match
      });
    }
  );
}
