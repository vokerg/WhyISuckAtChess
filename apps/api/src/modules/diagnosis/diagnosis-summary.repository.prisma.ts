import prisma from '../../prisma';

export interface DiagnosisSummaryEvidenceReferenceRow {
  referenceKey: string;
  referenceType: string;
  importedGameId: number | null;
  sourcePlyStart: number | null;
  sourcePlyEnd: number | null;
  eventIdentityKey: string | null;
}

export interface DiagnosisSummaryConsolidationRow {
  state: string;
  topLevelEligible: boolean;
  policyVersion: string;
}

export interface DiagnosisSummaryRankingRow {
  topLevelRanked: boolean;
  rankPosition: number | null;
  finalScore: number;
  rankingPolicyVersion: string;
  consolidationState: string;
}

export interface DiagnosisSummaryFindingRow {
  id: number;
  findingKey: string;
  diagnosisId: string;
  findingLevel: string;
  observationState: string;
  claimKey: string;
  sampleCount: number;
  distinctGameCount: number;
  distinctSessionCount: number;
  requiredEvidenceCoverage: number | null;
  evidenceStrength: string;
  effectMetric: string | null;
  effectValue: number | null;
  effectUnit: string | null;
  effectDirection: string | null;
  evidenceReferences: DiagnosisSummaryEvidenceReferenceRow[];
  consolidationState: DiagnosisSummaryConsolidationRow | null;
  rankingState: DiagnosisSummaryRankingRow | null;
}

export interface DiagnosisSummaryFindingSetRow {
  id: number;
  scopeKey: string;
  taxonomyVersion: string;
  synthesisPolicyVersion: string;
  calculationVersion: string;
  policyVersions: unknown;
  calculationAsOf: Date;
  // Conservative read-side invalidation until #129 provides an authoritative
  // persisted source watermark and durable diagnosis refresh.
  sourceFresh: boolean;
  findings: DiagnosisSummaryFindingRow[];
}

export interface DiagnosisSummaryRepository {
  findCurrent(
    appUserId: number,
    scopeKey: string,
  ): Promise<DiagnosisSummaryFindingSetRow | null>;
}

type DiagnosisSummaryDatabase = Pick<
  typeof prisma,
  'diagnosisFindingSet' | 'importRun' | 'importedGame' | 'gameAnalysisRun' | 'evidenceRun'
>;

export function createPrismaDiagnosisSummaryRepository(
  database: DiagnosisSummaryDatabase = prisma,
): DiagnosisSummaryRepository {
  return {
    async findCurrent(appUserId, scopeKey) {
      const row = await database.diagnosisFindingSet.findFirst({
        where: {
          appUserId,
          scopeKey,
          isCurrent: true,
          supersededAt: null,
        },
        orderBy: { id: 'desc' },
        select: {
          id: true,
          scopeKey: true,
          taxonomyVersion: true,
          synthesisPolicyVersion: true,
          calculationVersion: true,
          policyVersionsJson: true,
          calculationAsOf: true,
          findings: {
            orderBy: [{ diagnosisId: 'asc' }, { findingKey: 'asc' }],
            select: {
              id: true,
              findingKey: true,
              diagnosisId: true,
              findingLevel: true,
              observationState: true,
              claimKey: true,
              sampleCount: true,
              distinctGameCount: true,
              distinctSessionCount: true,
              requiredEvidenceCoverage: true,
              evidenceStrength: true,
              effectMetric: true,
              effectValue: true,
              effectUnit: true,
              effectDirection: true,
              evidenceReferences: {
                where: { representative: true },
                orderBy: { id: 'asc' },
                take: 3,
                select: {
                  referenceKey: true,
                  referenceType: true,
                  importedGameId: true,
                  sourcePlyStart: true,
                  sourcePlyEnd: true,
                  eventIdentityKey: true,
                },
              },
              consolidationState: {
                select: {
                  state: true,
                  topLevelEligible: true,
                  policyVersion: true,
                },
              },
              rankingState: {
                select: {
                  topLevelRanked: true,
                  rankPosition: true,
                  finalScore: true,
                  rankingPolicyVersion: true,
                  consolidationState: true,
                },
              },
            },
          },
        },
      });

      if (!row) return null;

      // A publication cannot remain readable after *any* owned import,
      // indexing, engine or detector run changes. Import completion alone
      // is not diagnosis completion; new queued work also invalidates a
      // published snapshot. These checks are conservative (not an atomic
      // scope-wide source-version fence) and do not trigger recalculation.
      const changedSince = { gt: row.calculationAsOf };
      const [importChanged, gameChanged, analysisChanged, evidenceChanged] = await Promise.all([
        database.importRun.findFirst({
          where: { appUserId, updatedAt: changedSince },
          select: { id: true },
        }),
        database.importedGame.findFirst({
          where: { appUserId, updatedAt: changedSince },
          select: { id: true },
        }),
        database.gameAnalysisRun.findFirst({
          where: { importedGame: { is: { appUserId } }, updatedAt: changedSince },
          select: { id: true },
        }),
        database.evidenceRun.findFirst({
          where: { importedGame: { is: { appUserId } }, updatedAt: changedSince },
          select: { id: true },
        }),
      ]);
      return {
        id: row.id,
        scopeKey: row.scopeKey,
        taxonomyVersion: row.taxonomyVersion,
        synthesisPolicyVersion: row.synthesisPolicyVersion,
        calculationVersion: row.calculationVersion,
        policyVersions: row.policyVersionsJson,
        calculationAsOf: row.calculationAsOf,
        sourceFresh: !importChanged && !gameChanged && !analysisChanged && !evidenceChanged,
        findings: row.findings,
      };
    },
  };
}

export const prismaDiagnosisSummaryRepository = createPrismaDiagnosisSummaryRepository();
