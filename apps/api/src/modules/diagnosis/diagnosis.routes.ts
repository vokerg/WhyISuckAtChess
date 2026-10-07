import {
  diagnosisDrillDownParamsSchema,
  diagnosisDrillDownQuerySchema,
  diagnosisDrillDownResponseSchema,
  diagnosisSummaryQuerySchema,
  diagnosisSummaryResponseSchema,
  timeControlComparisonQuerySchema,
  timeControlComparisonResponseSchema,
} from '@why-i-suck-at-chess/contracts';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/request-auth';
import {
  diagnosisDrillDownService,
  type DiagnosisDrillDownService,
} from './diagnosis-drill-down.service';
import {
  diagnosisSummaryService,
  type DiagnosisSummaryService,
} from './diagnosis-summary.service';
import {
  timeControlComparisonService,
  type TimeControlComparisonService,
} from './time-control-comparison.service';

export async function registerDiagnosisRoutes(
  app: FastifyInstance,
  summaryService: DiagnosisSummaryService = diagnosisSummaryService,
  drillDownService: DiagnosisDrillDownService = diagnosisDrillDownService,
  comparisonService: TimeControlComparisonService = timeControlComparisonService,
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

    const summary = await summaryService.getSummary(auth.userId, parsedQuery.data.scopeKey);
    return diagnosisSummaryResponseSchema.parse(summary);
  });

  app.get('/api/diagnosis/time-controls', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;

    const parsedQuery = timeControlComparisonQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: 'Invalid time-control comparison query',
        issues: parsedQuery.error.issues,
      });
    }

    const comparison = await comparisonService.getComparison(auth.userId, parsedQuery.data);
    return timeControlComparisonResponseSchema.parse(comparison);
  });

  app.get('/api/diagnosis/findings/:findingId', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;

    const parsedParams = diagnosisDrillDownParamsSchema.safeParse(request.params);
    const parsedQuery = diagnosisDrillDownQuerySchema.safeParse(request.query);
    if (!parsedParams.success || !parsedQuery.success) {
      return reply.code(400).send({
        error: 'Invalid diagnosis drill-down request',
        issues: [
          ...(parsedParams.success ? [] : parsedParams.error.issues),
          ...(parsedQuery.success ? [] : parsedQuery.error.issues),
        ],
      });
    }

    const detail = await drillDownService.getFinding(
      auth.userId,
      parsedQuery.data.scopeKey,
      parsedParams.data.findingId,
    );
    return diagnosisDrillDownResponseSchema.parse(detail);
  });
}
