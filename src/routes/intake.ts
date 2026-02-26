import type { App } from '../app.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { IntakeSubmission } from '../models/IntakeSubmission.js';
import { normalizeIntakePayload } from '../utils/intake-normalizer.js';

const IntakeBodySchema = z.record(z.any());

export async function intakeRoutes(app: App) {
  app.post(
    '/qillform',
    {
      config: { auth: true, scopes: ['write'], permissions: true }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = IntakeBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

      const rawPayload = parsed.data;
      const normalized = normalizeIntakePayload(rawPayload);

      const saved = await IntakeSubmission.create({
        source: 'qillform',
        rawPayload,
        normalized
      });

      return reply.code(201).send({
        ok: true,
        id: saved._id,
        normalized
      });
    }
  );
}
