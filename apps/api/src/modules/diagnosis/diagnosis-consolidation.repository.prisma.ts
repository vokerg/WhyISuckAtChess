import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import type { PersistedDiagnosisFindingConsolidation } from './diagnosis-finding.types';
import { prismaDiagnosisFindingOverlapRepository } from './diagnosis-overlap.repository.prisma';
import type {
  DiagnosisConsolidationRepository,
  DiagnosisFindingConsolidationDraft,
} from './diagnosis-consolidation.service';

type TransactionClient = Prisma.TransactionClient;

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function mapConsolidation(row: {
  id: number;
  findingId: number;
  representativeFindingId: number | null;
  state: string;
  topLevelEligible: boolean;
  clusterKey: string;
  reasonKeys: string[];
  policyVersion: string;
  supportJson: Prisma.JsonValue;
}): PersistedDiagnosisFindingConsolidation {
  return {
    id: row.id,
    findingId: row.findingId,
    representativeFindingId: row.representativeFindingId,
    state: row.state,
    topLevelEligible: row.topLevelEligible,
    clusterKey: row.clusterKey,
    reasonKeys: row.reasonKeys,
    policyVersion: row.policyVersion,
    support: row.supportJson,
  };
}

function assertUniqueDrafts(
  findingIds: ReadonlySet<number>,
  drafts: readonly DiagnosisFindingConsolidationDraft[],
): void {
  if (drafts.length !== findingIds.size) {
    throw new Error('Diagnosis consolidation must provide exactly one state for every current finding.');
  }

  const seen = new Set<number>();
  for (const draft of drafts) {
    if (!findingIds.has(draft.findingId)) {
      throw new Error('Diagnosis consolidation references a finding outside the current set.');
    }
    if (seen.has(draft.findingId)) {
      throw new Error('Diagnosis consolidation contains duplicate finding state.');
    }
    seen.add(draft.findingId);

    if (
      draft.representativeFindingId !== null
      && !findingIds.has(draft.representativeFindingId)
    ) {
      throw new Error('Diagnosis consolidation representative is outside the current set.');
    }
    if (draft.representativeFindingId === draft.findingId) {
      throw new Error('Diagnosis consolidation cannot represent a finding with itself.');
    }
    if (draft.clusterKey.length === 0 || draft.clusterKey.length > 160) {
      throw new RangeError('Diagnosis consolidation clusterKey must contain 1-160 characters.');
    }
  }
}

async function loadConsolidations(
  tx: TransactionClient,
  findingSetId: number,
): Promise<readonly PersistedDiagnosisFindingConsolidation[]> {
  const rows = await tx.diagnosisFindingConsolidation.findMany({
    where: { findingSetId },
    orderBy: [{ findingId: 'asc' }],
  });
  return rows.map(mapConsolidation);
}

export const prismaDiagnosisConsolidationRepository: DiagnosisConsolidationRepository = {
  ...prismaDiagnosisFindingOverlapRepository,

  async replaceCurrentConsolidations(
    appUserId,
    findingSetId,
    policyVersion,
    consolidations,
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
        throw new Error('Diagnosis consolidation finding set is outside the owned player scope.');
      }
      if (!findingSet.isCurrent || findingSet.supersededAt !== null) {
        throw new Error('Diagnosis consolidation cannot replace state on a stale finding set.');
      }

      const findingIds = new Set(findingSet.findings.map((finding) => finding.id));
      assertUniqueDrafts(findingIds, consolidations);

      await tx.diagnosisFindingConsolidation.deleteMany({
        where: { findingSetId },
      });
      if (consolidations.length > 0) {
        await tx.diagnosisFindingConsolidation.createMany({
          data: consolidations.map((draft) => ({
            findingSetId,
            findingId: draft.findingId,
            representativeFindingId: draft.representativeFindingId,
            state: draft.state,
            topLevelEligible: draft.topLevelEligible,
            clusterKey: draft.clusterKey,
            reasonKeys: [...draft.reasonKeys],
            policyVersion,
            supportJson: jsonValue(draft.support),
          })),
        });
      }

      return loadConsolidations(tx, findingSetId);
    });
  },
};
