import { Prisma } from '@prisma/client';
import { DIAGNOSIS_RANKING_POLICY_VERSION } from '@why-i-suck-at-chess/chess-domain';
import prisma from '../../prisma';
import { prismaDiagnosisFindingOverlapRepository } from './diagnosis-overlap.repository.prisma';
import type {
  DiagnosisFindingRankingDraft,
  DiagnosisRankingRepository,
  PersistedDiagnosisFindingRanking,
} from './diagnosis-ranking.service';

type TransactionClient = Prisma.TransactionClient;

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function finiteUnitInterval(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(field + ' must be finite and in [0, 1].');
  }
}

function assertDrafts(
  findingIds: ReadonlySet<number>,
  policyVersion: string,
  drafts: readonly DiagnosisFindingRankingDraft[],
): void {
  if (policyVersion !== DIAGNOSIS_RANKING_POLICY_VERSION) {
    throw new Error('Diagnosis ranking repository only supports the current ranking policy.');
  }

  const seen = new Set<number>();
  const positions = new Set<number>();
  for (const draft of drafts) {
    if (!findingIds.has(draft.findingId)) {
      throw new Error('Diagnosis ranking references a finding outside the current set.');
    }
    if (seen.has(draft.findingId)) {
      throw new Error('Diagnosis ranking contains a duplicate finding row.');
    }
    seen.add(draft.findingId);

    if (draft.rankingPolicyVersion !== policyVersion) {
      throw new Error('Diagnosis ranking draft uses a stale ranking policy version.');
    }

    finiteUnitInterval(draft.finalScore, 'finalScore');
    finiteUnitInterval(draft.weightedScore, 'weightedScore');
    finiteUnitInterval(draft.evidenceMultiplier, 'evidenceMultiplier');
    finiteUnitInterval(draft.overlapMultiplier, 'overlapMultiplier');

    if (draft.topLevelRanked) {
      if (!Number.isSafeInteger(draft.rankPosition) || (draft.rankPosition ?? 0) <= 0) {
        throw new Error('Top-level diagnosis ranking rows require a positive rank position.');
      }
      if (positions.has(draft.rankPosition as number)) {
        throw new Error('Diagnosis ranking contains a duplicate top-level position.');
      }
      positions.add(draft.rankPosition as number);
    } else if (draft.rankPosition !== null) {
      throw new Error('Drill-down diagnosis ranking rows cannot have a rank position.');
    }

    for (const parentId of draft.parentRootFindingIds) {
      if (!findingIds.has(parentId) || parentId === draft.findingId) {
        throw new Error('Diagnosis ranking parent root is invalid for the current finding set.');
      }
    }

    jsonValue(draft.components);
    if (draft.rawEffect !== null) jsonValue(draft.rawEffect);
    jsonValue(draft.support);
  }

  const expectedPositions = [...positions].sort((left, right) => left - right);
  for (let index = 0; index < expectedPositions.length; index += 1) {
    if (expectedPositions[index] !== index + 1) {
      throw new Error('Diagnosis ranking top-level positions must be contiguous from one.');
    }
  }
}

function mapRanking(row: {
  id: number;
  findingSetId: number;
  findingId: number;
  topLevelRanked: boolean;
  rankPosition: number | null;
  finalScore: number;
  weightedScore: number;
  evidenceMultiplier: number;
  overlapMultiplier: number;
  rankingPolicyVersion: string;
  componentsJson: Prisma.JsonValue;
  rawEffectJson: Prisma.JsonValue | null;
  consolidationState: string;
  parentRootFindingIds: number[];
  supportJson: Prisma.JsonValue;
}): PersistedDiagnosisFindingRanking {
  return {
    id: row.id,
    findingSetId: row.findingSetId,
    findingId: row.findingId,
    topLevelRanked: row.topLevelRanked,
    rankPosition: row.rankPosition,
    finalScore: row.finalScore,
    weightedScore: row.weightedScore,
    evidenceMultiplier: row.evidenceMultiplier,
    overlapMultiplier: row.overlapMultiplier,
    rankingPolicyVersion: row.rankingPolicyVersion,
    components: row.componentsJson,
    rawEffect: row.rawEffectJson,
    consolidationState: row.consolidationState,
    parentRootFindingIds: row.parentRootFindingIds,
    support: row.supportJson,
  };
}

async function loadRankings(
  tx: TransactionClient,
  findingSetId: number,
): Promise<readonly PersistedDiagnosisFindingRanking[]> {
  const rows = await tx.diagnosisFindingRanking.findMany({
    where: { findingSetId },
    orderBy: [
      { topLevelRanked: 'desc' },
      { rankPosition: 'asc' },
      { findingId: 'asc' },
    ],
  });
  return rows.map(mapRanking);
}

export const prismaDiagnosisRankingRepository: DiagnosisRankingRepository = {
  ...prismaDiagnosisFindingOverlapRepository,

  async replaceCurrentRankings(
    appUserId,
    findingSetId,
    rankingPolicyVersion,
    rankings,
  ) {
    return prisma.$transaction(async (tx) => {
      const findingSet = await tx.diagnosisFindingSet.findUnique({
        where: { id: findingSetId },
        select: {
          appUserId: true,
          isCurrent: true,
          supersededAt: true,
          findings: { select: { id: true } },
        },
      });
      if (!findingSet || findingSet.appUserId !== appUserId) {
        throw new Error('Diagnosis ranking finding set is outside the owned player scope.');
      }
      if (!findingSet.isCurrent || findingSet.supersededAt !== null) {
        throw new Error('Diagnosis ranking cannot replace state on a stale finding set.');
      }

      const findingIds = new Set(findingSet.findings.map((finding) => finding.id));
      assertDrafts(findingIds, rankingPolicyVersion, rankings);

      await tx.diagnosisFindingRanking.deleteMany({
        where: { findingSetId },
      });

      if (rankings.length > 0) {
        await tx.diagnosisFindingRanking.createMany({
          data: rankings.map((draft) => ({
            findingSetId,
            findingId: draft.findingId,
            topLevelRanked: draft.topLevelRanked,
            rankPosition: draft.rankPosition,
            finalScore: draft.finalScore,
            weightedScore: draft.weightedScore,
            evidenceMultiplier: draft.evidenceMultiplier,
            overlapMultiplier: draft.overlapMultiplier,
            rankingPolicyVersion: draft.rankingPolicyVersion,
            componentsJson: jsonValue(draft.components),
            rawEffectJson: draft.rawEffect === null
              ? Prisma.DbNull
              : jsonValue(draft.rawEffect),
            consolidationState: draft.consolidationState,
            parentRootFindingIds: [...draft.parentRootFindingIds],
            supportJson: jsonValue(draft.support),
          })),
        });
      }

      return loadRankings(tx, findingSetId);
    });
  },
};
