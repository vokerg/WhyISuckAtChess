import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import type {
  DiagnosisFindingRepository,
  DiagnosisFindingSetDraft,
  DiagnosisFindingSetSnapshot,
  PersistedDiagnosisFinding,
} from './diagnosis-finding.types';

type TransactionClient = Prisma.TransactionClient;

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function loadSet(
  client: TransactionClient | typeof prisma,
  id: number,
): Promise<DiagnosisFindingSetSnapshot> {
  const row = await client.diagnosisFindingSet.findUniqueOrThrow({
    where: { id },
    include: {
      findings: {
        orderBy: [{ diagnosisId: 'asc' }, { findingKey: 'asc' }],
        include: {
          evidenceReferences: {
            orderBy: [{ representative: 'desc' }, { id: 'asc' }],
          },
        },
      },
      relationships: {
        orderBy: { id: 'asc' },
      },
    },
  });

  return {
    id: row.id,
    appUserId: row.appUserId,
    materializationKey: row.materializationKey,
    scopeKey: row.scopeKey,
    scope: row.scopeJson,
    taxonomyVersion: row.taxonomyVersion,
    synthesisPolicyVersion: row.synthesisPolicyVersion,
    calculationVersion: row.calculationVersion,
    policyVersions: row.policyVersionsJson,
    calculationAsOf: row.calculationAsOf,
    isCurrent: row.isCurrent,
    supersededAt: row.supersededAt,
    findings: row.findings.map<PersistedDiagnosisFinding>((finding) => ({
      id: finding.id,
      findingKey: finding.findingKey,
      diagnosisId: finding.diagnosisId,
      findingLevel: finding.findingLevel,
      observationState: finding.observationState,
      claimKey: finding.claimKey,
      producerKey: finding.producerKey,
      producerVersion: finding.producerVersion,
      sampleCount: finding.sampleCount,
      distinctGameCount: finding.distinctGameCount,
      distinctSessionCount: finding.distinctSessionCount,
      requiredEvidenceCoverage: finding.requiredEvidenceCoverage,
      evidenceStrength: finding.evidenceStrength,
      dimensions: finding.dimensionsJson,
      coverage: finding.coverageJson,
      effect: (
        finding.effectMetric !== null
        && finding.effectValue !== null
        && finding.effectUnit !== null
        && finding.effectDirection !== null
      )
        ? {
            metric: finding.effectMetric,
            value: finding.effectValue,
            unit: finding.effectUnit,
            direction: finding.effectDirection,
            comparator: finding.comparatorJson,
          }
        : null,
      sourceVersions: finding.sourceVersionsJson,
      evidenceReferences: finding.evidenceReferences.map((reference) => ({
        id: reference.id,
        referenceKey: reference.referenceKey,
        referenceType: reference.referenceType,
        importedGameId: reference.importedGameId,
        evidenceEventId: reference.evidenceEventId,
        sourceAnalysisRunId: reference.sourceAnalysisRunId,
        sourcePlyStart: reference.sourcePlyStart,
        sourcePlyEnd: reference.sourcePlyEnd,
        sessionKey: reference.sessionKey,
        eventIdentityKey: reference.eventIdentityKey,
        provenance: reference.provenanceJson,
        representative: reference.representative,
      })),
    })),
    relationships: row.relationships.map((relationship) => ({
      id: relationship.id,
      sourceFindingId: relationship.sourceFindingId,
      targetFindingId: relationship.targetFindingId,
      relationshipType: relationship.relationshipType,
      policyVersion: relationship.policyVersion,
      support: relationship.supportJson,
    })),
  };
}

async function assertSourceOwnership(
  tx: TransactionClient,
  appUserId: number,
  draft: DiagnosisFindingSetDraft,
): Promise<void> {
  const references = draft.findings.flatMap((finding) => finding.evidenceReferences);
  const directGameIds = references.flatMap((reference) => (
    reference.importedGameId ? [reference.importedGameId] : []
  ));
  const eventIds = [...new Set(references.flatMap((reference) => (
    reference.evidenceEventId ? [reference.evidenceEventId] : []
  )))];
  const analysisRunIds = [...new Set(references.flatMap((reference) => (
    reference.sourceAnalysisRunId ? [reference.sourceAnalysisRunId] : []
  )))];

  const eventRows = eventIds.length === 0
    ? []
    : await tx.evidenceEvent.findMany({
        where: { id: { in: eventIds } },
        select: {
          id: true,
          run: {
            select: {
              importedGameId: true,
              status: true,
              isCurrent: true,
            },
          },
        },
      });
  if (eventRows.length !== eventIds.length) {
    throw new Error('Diagnosis finding references a missing evidence event.');
  }
  const eventGame = new Map(eventRows.map((row) => [row.id, row.run.importedGameId]));
  if (eventRows.some((row) => row.run.status !== 'SUCCEEDED' || !row.run.isCurrent)) {
    throw new Error('Diagnosis finding references evidence that is not current and succeeded.');
  }

  const analysisRows = analysisRunIds.length === 0
    ? []
    : await tx.gameAnalysisRun.findMany({
        where: { id: { in: analysisRunIds } },
        select: {
          id: true,
          importedGameId: true,
        },
      });
  if (analysisRows.length !== analysisRunIds.length) {
    throw new Error('Diagnosis finding references a missing analysis run.');
  }
  const analysisGame = new Map(analysisRows.map((row) => [row.id, row.importedGameId]));

  const allGameIds = new Set<number>(directGameIds);
  for (const importedGameId of eventGame.values()) allGameIds.add(importedGameId);
  for (const importedGameId of analysisGame.values()) allGameIds.add(importedGameId);

  if (allGameIds.size > 0) {
    const ownedGames = await tx.importedGame.count({
      where: {
        appUserId,
        id: { in: [...allGameIds] },
      },
    });
    if (ownedGames !== allGameIds.size) {
      throw new Error('Diagnosis finding source reference is outside the owned player scope.');
    }
  }

  for (const reference of references) {
    const sourceGameIds = new Set<number>();
    if (reference.importedGameId) sourceGameIds.add(reference.importedGameId);
    if (reference.evidenceEventId) {
      const sourceGameId = eventGame.get(reference.evidenceEventId);
      if (sourceGameId) sourceGameIds.add(sourceGameId);
    }
    if (reference.sourceAnalysisRunId) {
      const sourceGameId = analysisGame.get(reference.sourceAnalysisRunId);
      if (sourceGameId) sourceGameIds.add(sourceGameId);
    }
    if (sourceGameIds.size > 1) {
      throw new Error(
        `Diagnosis reference ${reference.referenceKey} combines sources from different games.`,
      );
    }
  }
}

async function createFindingSet(
  tx: TransactionClient,
  appUserId: number,
  draft: DiagnosisFindingSetDraft,
): Promise<number> {
  const set = await tx.diagnosisFindingSet.create({
    data: {
      appUserId,
      materializationKey: draft.materializationKey,
      scopeKey: draft.scopeKey,
      scopeJson: jsonValue(draft.scope),
      taxonomyVersion: draft.taxonomyVersion,
      synthesisPolicyVersion: draft.synthesisPolicyVersion,
      calculationVersion: draft.calculationVersion,
      policyVersionsJson: jsonValue(draft.policyVersions),
      calculationAsOf: draft.calculationAsOf,
      isCurrent: true,
    },
    select: { id: true },
  });

  for (const finding of draft.findings) {
    const created = await tx.diagnosisFinding.create({
      data: {
        findingSetId: set.id,
        findingKey: finding.findingKey,
        diagnosisId: finding.diagnosisId,
        findingLevel: finding.findingLevel,
        observationState: finding.observationState,
        claimKey: finding.claimKey,
        producerKey: finding.producerKey,
        producerVersion: finding.producerVersion,
        sampleCount: finding.sampleCount,
        distinctGameCount: finding.distinctGameCount,
        distinctSessionCount: finding.distinctSessionCount,
        requiredEvidenceCoverage: finding.requiredEvidenceCoverage,
        evidenceStrength: finding.evidenceStrength,
        dimensionsJson: jsonValue(finding.dimensions),
        coverageJson: jsonValue(finding.coverage),
        effectMetric: finding.effect?.metric ?? null,
        effectValue: finding.effect?.value ?? null,
        effectUnit: finding.effect?.unit ?? null,
        effectDirection: finding.effect?.direction ?? null,
        ...(finding.effect?.comparator
          ? { comparatorJson: jsonValue(finding.effect.comparator) }
          : {}),
        sourceVersionsJson: jsonValue(finding.sourceVersions),
      },
      select: { id: true },
    });

    if (finding.evidenceReferences.length > 0) {
      await tx.diagnosisFindingEvidenceReference.createMany({
        data: finding.evidenceReferences.map((reference) => ({
          findingId: created.id,
          referenceKey: reference.referenceKey,
          referenceType: reference.referenceType,
          importedGameId: reference.importedGameId ?? null,
          evidenceEventId: reference.evidenceEventId ?? null,
          sourceAnalysisRunId: reference.sourceAnalysisRunId ?? null,
          sourcePlyStart: reference.sourcePlyStart ?? null,
          sourcePlyEnd: reference.sourcePlyEnd ?? null,
          sessionKey: reference.sessionKey ?? null,
          eventIdentityKey: reference.eventIdentityKey ?? null,
          provenanceJson: jsonValue(reference.provenance),
          representative: reference.representative ?? false,
        })),
      });
    }
  }

  return set.id;
}

export const prismaDiagnosisFindingRepository: DiagnosisFindingRepository = {
  async replaceCurrentScope(appUserId, draft) {
    return prisma.$transaction(async (tx) => {
      const userExists = await tx.appUser.findUnique({
        where: { id: appUserId },
        select: { id: true },
      });
      if (!userExists) {
        throw new Error('Diagnosis finding owner does not exist.');
      }

      const repeated = await tx.diagnosisFindingSet.findUnique({
        where: { materializationKey: draft.materializationKey },
        select: {
          id: true,
          appUserId: true,
          scopeKey: true,
          isCurrent: true,
        },
      });
      if (repeated) {
        if (repeated.appUserId !== appUserId || repeated.scopeKey !== draft.scopeKey) {
          throw new Error('Diagnosis materialization key belongs to another owner or scope.');
        }
        if (!repeated.isCurrent) {
          throw new Error('Diagnosis materialization key has already been superseded.');
        }
        return loadSet(tx, repeated.id);
      }

      await assertSourceOwnership(tx, appUserId, draft);

      const supersededAt = new Date();
      await tx.diagnosisFindingSet.updateMany({
        where: {
          appUserId,
          scopeKey: draft.scopeKey,
          isCurrent: true,
        },
        data: {
          isCurrent: false,
          supersededAt,
        },
      });

      const id = await createFindingSet(tx, appUserId, draft);
      return loadSet(tx, id);
    });
  },

  async getCurrentScope(appUserId, scopeKey) {
    const current = await prisma.diagnosisFindingSet.findFirst({
      where: {
        appUserId,
        scopeKey,
        isCurrent: true,
      },
      select: { id: true },
    });
    return current ? loadSet(prisma, current.id) : null;
  },
};
