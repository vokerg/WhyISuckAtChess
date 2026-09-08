import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/request-auth';
import { LichessImportRequestSchema } from '@why-i-suck-at-chess/contracts';
import type { LichessAccountImportService } from './account-import.service';
import { toImportRunResponse } from './account-import.service';

export async function registerAccountImportRoutes(app: FastifyInstance, service: LichessAccountImportService): Promise<void> {
  app.post('/api/me/imports/lichess', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    const parsed = LichessImportRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: 'Invalid import request.', issues: parsed.error.issues });

    try {
      const run = await service.requestImport(auth.userId, {
        ...(parsed.data.from ? { from: new Date(parsed.data.from) } : {}),
        ...(parsed.data.to ? { to: new Date(parsed.data.to) } : {}),
        ...(parsed.data.rated === undefined ? {} : { rated: parsed.data.rated }),
      });
      return reply.code(202).send({ importRun: toImportRunResponse(run) });
    } catch (error) {
      if (error instanceof Error && error.name === 'ActiveImportRunError') return reply.code(409).send({ message: error.message });
      throw error;
    }
  });

  app.get<{ Params: { runId: string } }>('/api/me/imports/:runId', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    const runId = Number(request.params.runId);
    if (!Number.isInteger(runId) || runId < 1) return reply.code(400).send({ message: 'Invalid import run id.' });
    const run = await service.getRun(auth.userId, runId);
    if (!run) return reply.code(404).send({ message: 'Import run not found.' });
    return { importRun: toImportRunResponse(run) };
  });

  app.post<{ Params: { runId: string } }>('/api/me/imports/:runId/cancel', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    const runId = Number(request.params.runId);
    if (!Number.isInteger(runId) || runId < 1) return reply.code(400).send({ message: 'Invalid import run id.' });
    const run = await service.cancelRun(auth.userId, runId);
    if (!run) return reply.code(404).send({ message: 'Import run not found.' });
    return { importRun: toImportRunResponse(run) };
  });
}
