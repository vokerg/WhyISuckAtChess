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
  findings: DiagnosisSummaryFindingRow[];
}

export interface DiagnosisSummaryRepository {
  findCurrent(
    appUserId: number,
    scopeKey: string,
  ): Promise<DiagnosisSummaryFindingSetRow | null>;
}

type DiagnosisSummaryDatabase = Pick<typeof prisma, 'diagnosisFindingSet'>;

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
      return {
        id: row.id,
        scopeKey: row.scopeKey,
        taxonomyVersion: row.taxonomyVersion,
        synthesisPolicyVersion: row.synthesisPolicyVersion,
        calculationVersion: row.calculationVersion,
        policyVersions: row.policyVersionsJson,
        calculationAsOf: row.calculationAsOf,
        findings: row.findings,
      };
    },
  };
}

export const prismaDiagnosisSummaryRepository = createPrismaDiagnosisSummaryRepository();
