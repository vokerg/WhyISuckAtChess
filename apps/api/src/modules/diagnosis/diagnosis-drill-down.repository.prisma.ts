import prisma from '../../prisma';

export interface DiagnosisDrillDownEvidenceReferenceRow {
  referenceKey: string;
  referenceType: string;
  importedGameId: number | null;
  sourcePlyStart: number | null;
  sourcePlyEnd: number | null;
  eventIdentityKey: string | null;
}

export interface DiagnosisDrillDownConsolidationRow {
  state: string;
  policyVersion: string;
}

export interface DiagnosisDrillDownFindingRow {
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
  evidenceReferences: DiagnosisDrillDownEvidenceReferenceRow[];
  consolidationState: DiagnosisDrillDownConsolidationRow | null;
  supportRoles: string[];
}

export interface DiagnosisDrillDownRankingRow {
  findingId: number;
  finalScore: number;
  rankingPolicyVersion: string;
  consolidationState: string;
  parentRootFindingIds: number[];
  finding: DiagnosisDrillDownFindingRow;
}

export interface DiagnosisDrillDownRepository {
  findSupportingRankings(
    appUserId: number,
    findingSetId: number,
    scopeKey: string,
    parentFindingId: number,
  ): Promise<DiagnosisDrillDownRankingRow[] | null>;
}

type DiagnosisDrillDownDatabase = Pick<typeof prisma, 'diagnosisFindingSet'>;

export function createPrismaDiagnosisDrillDownRepository(
  database: DiagnosisDrillDownDatabase = prisma,
): DiagnosisDrillDownRepository {
  return {
    async findSupportingRankings(appUserId, findingSetId, scopeKey, parentFindingId) {
      const row = await database.diagnosisFindingSet.findFirst({
        where: {
          id: findingSetId,
          appUserId,
          scopeKey,
          isCurrent: true,
          supersededAt: null,
        },
        select: {
          rankings: {
            where: {
              topLevelRanked: false,
              parentRootFindingIds: { has: parentFindingId },
              finding: { is: { findingSetId } },
            },
            orderBy: [
              { finalScore: 'desc' },
              { findingId: 'asc' },
            ],
            select: {
              findingId: true,
              finalScore: true,
              rankingPolicyVersion: true,
              consolidationState: true,
              parentRootFindingIds: true,
              finding: {
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
                      policyVersion: true,
                    },
                  },
                  supportsRootCandidates: {
                    where: { rootFindingId: parentFindingId, findingSetId },
                    orderBy: { id: 'asc' },
                    take: 2,
                    select: { role: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!row) return null;
      return row.rankings.map((ranking) => ({
        findingId: ranking.findingId,
        finalScore: ranking.finalScore,
        rankingPolicyVersion: ranking.rankingPolicyVersion,
        consolidationState: ranking.consolidationState,
        parentRootFindingIds: ranking.parentRootFindingIds,
        finding: {
          id: ranking.finding.id,
          findingKey: ranking.finding.findingKey,
          diagnosisId: ranking.finding.diagnosisId,
          findingLevel: ranking.finding.findingLevel,
          observationState: ranking.finding.observationState,
          claimKey: ranking.finding.claimKey,
          sampleCount: ranking.finding.sampleCount,
          distinctGameCount: ranking.finding.distinctGameCount,
          distinctSessionCount: ranking.finding.distinctSessionCount,
          requiredEvidenceCoverage: ranking.finding.requiredEvidenceCoverage,
          evidenceStrength: ranking.finding.evidenceStrength,
          effectMetric: ranking.finding.effectMetric,
          effectValue: ranking.finding.effectValue,
          effectUnit: ranking.finding.effectUnit,
          effectDirection: ranking.finding.effectDirection,
          evidenceReferences: ranking.finding.evidenceReferences,
          consolidationState: ranking.finding.consolidationState,
          supportRoles: ranking.finding.supportsRootCandidates.map((support) => support.role),
        },
      }));
    },
  };
}

export const prismaDiagnosisDrillDownRepository = createPrismaDiagnosisDrillDownRepository();
