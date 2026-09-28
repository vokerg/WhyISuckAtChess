import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import { prismaDiagnosisFindingOverlapRepository } from './diagnosis-overlap.repository.prisma';
import type {
  DiagnosisRelationshipEdgeDraft,
  DiagnosisRelationshipRepository,
} from './diagnosis-relationship.service';

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function relationshipKey(relationship: {
  relationshipType: string;
  sourceFindingId: number;
  targetFindingId: number;
}): string {
  return [
    relationship.relationshipType,
    String(relationship.sourceFindingId).padStart(12, '0'),
    String(relationship.targetFindingId).padStart(12, '0'),
  ].join('|');
}

function assertUniqueRelationships(
  relationships: readonly DiagnosisRelationshipEdgeDraft[],
): void {
  const keys = relationships.map(relationshipKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error('Diagnosis relationship graph contains duplicate edges.');
  }
}

export const prismaDiagnosisRelationshipRepository: DiagnosisRelationshipRepository = {
  ...prismaDiagnosisFindingOverlapRepository,

  async replaceCurrentRelationships(appUserId, findingSetId, policyVersion, relationships) {
    assertUniqueRelationships(relationships);

    return prisma.$transaction(async (tx) => {
      const findingSet = await tx.diagnosisFindingSet.findFirst({
        where: {
          id: findingSetId,
          appUserId,
          isCurrent: true,
          supersededAt: null,
          synthesisPolicyVersion: policyVersion,
        },
        select: {
          id: true,
          findings: {
            select: { id: true },
          },
        },
      });
      if (!findingSet) {
        throw new Error('Diagnosis relationship target set is not current for this owner/policy.');
      }

      const currentFindingIds = new Set(findingSet.findings.map((finding) => finding.id));
      for (const relationship of relationships) {
        if (
          !currentFindingIds.has(relationship.sourceFindingId)
          || !currentFindingIds.has(relationship.targetFindingId)
        ) {
          throw new Error('Diagnosis relationship endpoint is outside the current finding set.');
        }
      }

      await tx.diagnosisFindingRelationship.deleteMany({
        where: { findingSetId },
      });

      if (relationships.length > 0) {
        await tx.diagnosisFindingRelationship.createMany({
          data: relationships.map((relationship) => ({
            findingSetId,
            sourceFindingId: relationship.sourceFindingId,
            targetFindingId: relationship.targetFindingId,
            relationshipType: relationship.relationshipType,
            policyVersion: relationship.policyVersion,
            supportJson: jsonValue(relationship.support),
          })),
        });
      }

      const rows = await tx.diagnosisFindingRelationship.findMany({
        where: { findingSetId },
        orderBy: [
          { relationshipType: 'asc' },
          { sourceFindingId: 'asc' },
          { targetFindingId: 'asc' },
        ],
      });

      return rows.map((relationship) => ({
        id: relationship.id,
        sourceFindingId: relationship.sourceFindingId,
        targetFindingId: relationship.targetFindingId,
        relationshipType: relationship.relationshipType,
        policyVersion: relationship.policyVersion,
        support: relationship.supportJson,
      }));
    });
  },
};
