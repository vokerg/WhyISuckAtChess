import type { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import { createPrismaOpeningRecurrenceRepository } from '../evidence/opening-recurrence.repository.prisma';
import { getOpeningRecurrenceEvidence } from '../evidence/opening-recurrence.service';
import { createPrismaSessionizationRepository } from '../sessions/sessionization.repository.prisma';
import { projectDiagnosisCandidates } from './diagnosis-candidate.registry';
import { createPrismaSessionDeteriorationRepository } from './session-deterioration.repository.prisma';
import { getSessionDeterioration } from './session-deterioration.service';
import { getLossStreakDeterioration } from './loss-streak-deterioration.service';
import { getOverlongSessionStoppingPoint } from './overlong-session-stopping-point.service';
import { createPrismaTimePressureExposureRepository } from './time-pressure-exposure.repository.prisma';
import { getTimePressureExposure } from './time-pressure-exposure.service';
import { createPrismaTimePressureQualityRepository } from './time-pressure-quality-collapse.repository.prisma';
import { getTimePressureQualityCollapse } from './time-pressure-quality-collapse.service';
import { createPrismaPlayedTooFastRepository } from './played-too-fast.repository.prisma';
import { getPlayedTooFast } from './played-too-fast.service';
import { createPrismaEarlyTimeOveruseRepository } from './early-time-overuse.repository.prisma';
import { getEarlyTimeOveruse } from './early-time-overuse.service';
import { createPrismaExactTimeControlRepository } from './exact-time-control-underperformance.repository.prisma';
import { getExactTimeControlUnderperformance } from './exact-time-control-underperformance.service';
import { createPrismaIncrementEffectRepository } from './increment-effect.repository.prisma';
import { getIncrementEffect } from './increment-effect.service';
import { createPrismaOpponentMoveSpeedEffectRepository } from './opponent-move-speed-effect.repository.prisma';
import { getOpponentMoveSpeedEffect } from './opponent-move-speed-effect.service';
import { createPrismaOpponentStrengthEffectRepository } from './opponent-strength-effect.repository.prisma';
import { getOpponentStrengthEffect } from './opponent-strength-effect.service';
import { createPrismaRatingContextCompositionRepository } from './rating-context-composition.repository.prisma';
import { createPrismaDiagnosisFindingRepository } from './diagnosis-finding.repository.prisma';
import { createPrismaDiagnosisFindingOverlapRepository } from './diagnosis-overlap.repository.prisma';
import { createPrismaDiagnosisRelationshipRepository } from './diagnosis-relationship.repository.prisma';
import { createPrismaDiagnosisConsolidationRepository } from './diagnosis-consolidation.repository.prisma';
import { createPrismaDiagnosisRankingRepository } from './diagnosis-ranking.repository.prisma';
import { replaceCurrentDiagnosisFindingScope } from './diagnosis-finding.service';
import { getCurrentDiagnosisFindingOverlaps } from './diagnosis-overlap.service';
import { materializeCurrentDiagnosisRelationshipGraph } from './diagnosis-relationship.service';
import { materializeCurrentDiagnosisConsolidation } from './diagnosis-consolidation.service';
import { materializeCurrentDiagnosisRootCandidates } from './diagnosis-root-cause.service';
import { materializeCurrentDiagnosisRanking } from './diagnosis-ranking.service';
import { diagnosisMaterializationVersions as versions } from './diagnosis-materialization.versions';
import type { RatingContextCompositionResult } from './rating-context-composition.service';
import type { DiagnosisFindingDraft } from './diagnosis-finding.types';
import type { DiagnosisSourceSnapshot } from './diagnosis-source.repository.prisma';

// Repositories retain their standalone transaction behavior. Inside the worker's
// outer serializable publication transaction, their callbacks share that client.
export function diagnosisTransactionDatabase(tx: Prisma.TransactionClient): typeof prisma {
  return new Proxy(tx, {
    get(target, key) {
      if (key === '$transaction') return (callback: (client: Prisma.TransactionClient) => unknown) => callback(tx);
      return Reflect.get(target, key);
    },
  }) as typeof prisma;
}

export async function materializeDiagnosis(
  appUserId: number,
  source: DiagnosisSourceSnapshot,
  calculationAsOf: Date,
  database: typeof prisma,
): Promise<number> {
  const scopeKey = 'overall';
  const completed = await database.diagnosisFindingSet.findFirst({
    where: { appUserId, scopeKey, isCurrent: true, supersededAt: null,
      scopeJson: { path: ['sourceKey'], equals: source.key },
      taxonomyVersion: versions.taxonomyVersion, synthesisPolicyVersion: versions.synthesisPolicyVersion,
      calculationVersion: versions.calculationVersion,
      policyVersionsJson: { equals: JSON.parse(JSON.stringify(versions.policyVersions)) },
    },
    select: { id: true, _count: { select: { findings: true } }, consolidations: { select: { findingId: true, topLevelEligible: true } }, rankings: { select: { findingId: true, rankingPolicyVersion: true } } },
  });
  if (completed && completed._count.findings === completed.consolidations.length
    && completed.consolidations.every((row) => !row.topLevelEligible || completed.rankings.some((ranking) => ranking.findingId === row.findingId && ranking.rankingPolicyVersion === versions.policyVersions.ranking))) return completed.id;
  const rating = createPrismaRatingContextCompositionRepository(database);
  const sessions = createPrismaSessionizationRepository(database);
  const quality = createPrismaSessionDeteriorationRepository(database);
  const findings: DiagnosisFindingDraft[] = [];
  // Sequential calls keep memory and database concurrency bounded. Every
  // producer retains its accepted 5,000-game limit and missing-evidence policy.
  findings.push(...projectDiagnosisCandidates('openingRecurrence', await getOpeningRecurrenceEvidence(appUserId, createPrismaOpeningRecurrenceRepository(database))));
  findings.push(...projectDiagnosisCandidates('timePressureExposure', await getTimePressureExposure(appUserId, {}, createPrismaTimePressureExposureRepository(database))));
  findings.push(...projectDiagnosisCandidates('timePressureQualityCollapse', await getTimePressureQualityCollapse(appUserId, {}, createPrismaTimePressureQualityRepository(database), rating)));
  findings.push(...projectDiagnosisCandidates('playedTooFast', await getPlayedTooFast(appUserId, {}, createPrismaPlayedTooFastRepository(database))));
  findings.push(...projectDiagnosisCandidates('earlyTimeOveruse', await getEarlyTimeOveruse(appUserId, {}, createPrismaEarlyTimeOveruseRepository(database))));
  findings.push(...projectDiagnosisCandidates('exactTimeControlUnderperformance', await getExactTimeControlUnderperformance(appUserId, {}, createPrismaExactTimeControlRepository(database), rating)));
  findings.push(...projectDiagnosisCandidates('incrementEffect', await getIncrementEffect(appUserId, {}, createPrismaIncrementEffectRepository(database), rating)));
  findings.push(...projectDiagnosisCandidates('opponentMoveSpeedEffect', await getOpponentMoveSpeedEffect(appUserId, {}, createPrismaOpponentMoveSpeedEffectRepository(database), rating)));
  findings.push(...projectDiagnosisCandidates('opponentStrengthEffect', await getOpponentStrengthEffect(appUserId, {}, createPrismaOpponentStrengthEffectRepository(database))));
  findings.push(...projectDiagnosisCandidates('sessionDeterioration', await getSessionDeterioration(appUserId, {}, sessions, quality)));
  findings.push(...projectDiagnosisCandidates('lossStreakDeterioration', await getLossStreakDeterioration(appUserId, {}, sessions, quality)));
  findings.push(...projectDiagnosisCandidates('overlongSessionStoppingPoint', await getOverlongSessionStoppingPoint(appUserId, {}, sessions, quality)));
  // Each RATING-002 uses the producer's real disjoint comparison arms. Keep
  // its association explicit so one comparison's confounder cannot be attached
  // to a different comparison by the relationship graph.
  for (const finding of [...findings]) {
    const context = finding.coverage.ratingComposition as { result?: RatingContextCompositionResult | null } | undefined;
    if (!context?.result) continue;
    for (const projected of projectDiagnosisCandidates('ratingContextComposition', context.result)) {
      findings.push({
        ...projected,
        findingKey: 'rating-002-' + finding.findingKey,
        dimensions: { ...projected.dimensions, comparisonFindingKey: finding.findingKey },
      });
    }
  }
  await replaceCurrentDiagnosisFindingScope(appUserId, {
    ...versions,
    materializationKey: source.key,
    scopeKey,
    scope: { kind: 'OVERALL', sourceKey: source.key, sourceGames: source.games },
    calculationAsOf,
    findings,
  }, createPrismaDiagnosisFindingRepository(database));
  const overlap = createPrismaDiagnosisFindingOverlapRepository(database);
  const relationships = createPrismaDiagnosisRelationshipRepository(database);
  const consolidation = createPrismaDiagnosisConsolidationRepository(database);
  await getCurrentDiagnosisFindingOverlaps(appUserId, scopeKey, versions, overlap);
  await materializeCurrentDiagnosisRelationshipGraph(appUserId, scopeKey, versions, relationships);
  await materializeCurrentDiagnosisConsolidation(appUserId, scopeKey, versions, consolidation);
  const roots = await materializeCurrentDiagnosisRootCandidates(appUserId, scopeKey, versions, overlap);
  if (roots.requiresHierarchyRefresh) {
    await getCurrentDiagnosisFindingOverlaps(appUserId, scopeKey, versions, overlap);
    await materializeCurrentDiagnosisRelationshipGraph(appUserId, scopeKey, versions, relationships);
    await materializeCurrentDiagnosisConsolidation(appUserId, scopeKey, versions, consolidation);
  }
  const ranking = await materializeCurrentDiagnosisRanking(appUserId, scopeKey, versions, createPrismaDiagnosisRankingRepository(database));
  return ranking.findingSetId;
}
