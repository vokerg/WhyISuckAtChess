import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/request-auth';
import { LichessImportRequestSchema } from '@why-i-suck-at-chess/contracts';
import { LichessCredentialUnavailableError } from '../lichess/lichess-connection.service';
import { ActiveImportRunError } from './account-import.repository.prisma';
import type { LichessAccountImportService } from './account-import.service';
import { toImportRunResponse } from './account-import.service';

export async function registerAccountImportRoutes(app: FastifyInstance, service: LichessAccountImportService): Promise<void> {
  app.post('/api/me/imports/lichess', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    const parsed = LichessImportRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: 'Invalid import request.', issues: parsed.error.issues });

    if (parsed.data.from && parsed.data.to && Date.parse(parsed.data.to) <= Date.parse(parsed.data.from)) {
      return reply.code(400).send({ code: 'INVALID_RANGE', message: 'Import end must be after import start.' });
    }

    try {
      const run = await service.requestImport(auth.userId, {
        ...(parsed.data.from ? { from: new Date(parsed.data.from) } : {}),
        ...(parsed.data.to ? { to: new Date(parsed.data.to) } : {}),
        ...(parsed.data.rated === undefined ? {} : { rated: parsed.data.rated }),
      });
      return reply.code(202).send({ importRun: toImportRunResponse(run) });
    } catch (error) {
      if (error instanceof ActiveImportRunError) {
        return reply.code(409).send({ code: 'ACTIVE_IMPORT', message: 'An import is already active.' });
      }
      if (error instanceof LichessCredentialUnavailableError) {
        return reply.code(409).send({
          code: 'LICHESS_RECONNECT_REQUIRED',
          credentialState: error.reason,
          message: 'Connect or reconnect Lichess before importing.',
        });
      }
      if (error instanceof Error && error.message === 'Import end must be after import start.') {
        return reply.code(400).send({ code: 'INVALID_RANGE', message: error.message });
      }
      throw error;
    }
  });

  app.get('/api/me/imports/lichess/latest', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    reply.header('Cache-Control', 'private, no-store');
    const run = await service.getLatestRun(auth.userId);
    return { importRun: run ? toImportRunResponse(run) : null };
  });

  app.get<{ Params: { runId: string } }>('/api/me/imports/:runId', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    const runId = Number(request.params.runId);
    if (!Number.isSafeInteger(runId) || runId < 1) return reply.code(400).send({ message: 'Invalid import run id.' });
    reply.header('Cache-Control', 'private, no-store');
    const run = await service.getRun(auth.userId, runId);
    if (!run) return reply.code(404).send({ message: 'Import run not found.' });
    return { importRun: toImportRunResponse(run) };
  });

  app.post<{ Params: { runId: string } }>('/api/me/imports/:runId/cancel', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    const runId = Number(request.params.runId);
    if (!Number.isSafeInteger(runId) || runId < 1) return reply.code(400).send({ message: 'Invalid import run id.' });
    const run = await service.cancelRun(auth.userId, runId);
    if (!run) return reply.code(404).send({ message: 'Import run not found.' });
    return { importRun: toImportRunResponse(run) };
  });
}
