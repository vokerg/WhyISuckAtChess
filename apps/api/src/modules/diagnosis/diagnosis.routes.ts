import {
  diagnosisSummaryQuerySchema,
  diagnosisSummaryResponseSchema,
} from '@why-i-suck-at-chess/contracts';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/request-auth';
import {
  diagnosisSummaryService,
  type DiagnosisSummaryService,
} from './diagnosis-summary.service';

export async function registerDiagnosisRoutes(
  app: FastifyInstance,
  service: DiagnosisSummaryService = diagnosisSummaryService,
): Promise<void> {
  app.get('/api/diagnosis/summary', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;

    const parsedQuery = diagnosisSummaryQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: 'Invalid diagnosis summary query',
        issues: parsedQuery.error.issues,
      });
    }

    const summary = await service.getSummary(auth.userId, parsedQuery.data.scopeKey);
    return diagnosisSummaryResponseSchema.parse(summary);
  });
}
