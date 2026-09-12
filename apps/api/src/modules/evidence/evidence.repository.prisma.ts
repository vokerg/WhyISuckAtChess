import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import type {
  EvidenceDetectorIdentity,
  EvidenceDetectorResult,
  EvidenceFindingDraft,
  EvidenceInputSnapshot,
  EvidenceMultiPvLineSnapshot,
  EvidenceRunClaim,
} from './evidence.types';


interface EligibleEvidenceSource {
  importedGameId: number;
  sourcePlyIndexedAt: Date;
  sourceAnalysisRunId: number | null;
  sourceAnalysisSnapshotId: string | null;
}

export interface CurrentEvidenceEvent {
  id: number;
  evidenceKey: string;
  findingKey: string;
  evidenceType: string;
  availability: string;
  sourcePlyStart: number | null;
  sourcePlyEnd: number | null;
  sourcePositionId: number | null;
  measurements: unknown;
  details: unknown;
  unavailableReason: string | null;
}

export interface CurrentEvidenceRun {
  id: number;
  detectorKey: string;
  detectorVersion: string;
  coverageStatus: string;
  coverage: unknown;
  sourcePlyIndexedAt: Date;
  sourceAnalysisRunId: number | null;
  sourceAnalysisSnapshotId: string | null;
  events: CurrentEvidenceEvent[];
}

export interface EvidenceRepository {
  enqueueEligibleRun(detector: EvidenceDetectorIdentity): Promise<number | null>;
  recoverStaleRuns(staleBefore: Date): Promise<number>;
  claimNext(
    workerId: string,
    detectors: EvidenceDetectorIdentity[],
  ): Promise<EvidenceRunClaim | null>;
  loadSnapshot(run: EvidenceRunClaim): Promise<EvidenceInputSnapshot>;
  completeRun(
    run: EvidenceRunClaim,
    result: EvidenceDetectorResult,
  ): Promise<boolean>;
  markFailure(run: EvidenceRunClaim, error: string): Promise<void>;
  listCurrentEvidenceForGame(importedGameId: number): Promise<CurrentEvidenceRun[]>;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2002';
}

function retryDelayMs(attempts: number): number {
  return Math.min(60_000, 1_000 * (2 ** Math.max(0, attempts - 1)));
}

function sameInstant(left: Date | null, right: Date): boolean {
  return left !== null && left.getTime() === right.getTime();
}

function workKeyForSource(
  detector: EvidenceDetectorIdentity,
  source: EligibleEvidenceSource,
): string {
  return createHash('sha256')
    .update([
      source.importedGameId,
      detector.key,
      detector.version,
      source.sourcePlyIndexedAt.toISOString(),
      source.sourceAnalysisSnapshotId ?? '-',
    ].join('|'))
    .digest('hex');
}

function evidenceKeyForFinding(workKey: string, findingKey: string): string {
  return createHash('sha256')
    .update(workKey + '|' + findingKey)
    .digest('hex');
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function eligibleSource(
  tx: Prisma.TransactionClient,
  detector: EvidenceDetectorIdentity,
): Promise<EligibleEvidenceSource | null> {
  if (detector.requiresCompleteAnalysis) {
    const rows = await tx.$queryRaw<EligibleEvidenceSource[]>(Prisma.sql`
      SELECT
        game."id" AS "importedGameId",
        game."plyIndexedAt" AS "sourcePlyIndexedAt",
        analysis."id" AS "sourceAnalysisRunId",
        analysis."snapshotId" AS "sourceAnalysisSnapshotId"
      FROM "ImportedGame" AS game
      JOIN LATERAL (
        SELECT run."id", run."snapshotId"
        FROM "GameAnalysisRun" AS run
        WHERE run."importedGameId" = game."id"
          AND run."status" = 'SUCCEEDED'
          AND run."coverageStatus" = 'COMPLETE'
          AND run."sourcePlyIndexedAt" = game."plyIndexedAt"
          AND EXISTS (
            SELECT 1
            FROM "ImportedGamePly" AS ply
            WHERE ply."importedGameId" = game."id"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "ImportedGamePly" AS mismatch
            WHERE mismatch."importedGameId" = game."id"
              AND mismatch."engineAnalysisRunId" IS DISTINCT FROM run."id"
          )
        ORDER BY run."completedAt" DESC NULLS LAST, run."id" DESC
        LIMIT 1
      ) AS analysis ON TRUE
      WHERE game."provider" = 'LICHESS'
        AND game."plyIndexStatus" = 'INDEXED'
        AND game."plyIndexedAt" IS NOT NULL
        AND game."speedCategory" IN ('bullet', 'blitz', 'rapid')
        AND (game."variant" IS NULL OR game."variant" IN ('chess', 'standard'))
        AND NOT EXISTS (
          SELECT 1
          FROM "EvidenceRun" AS prior
          WHERE prior."importedGameId" = game."id"
            AND prior."detectorKey" = ${detector.key}
            AND prior."detectorVersion" = ${detector.version}
            AND prior."sourcePlyIndexedAt" = game."plyIndexedAt"
            AND prior."sourceAnalysisRunId" = analysis."id"
        )
      ORDER BY game."id" ASC
      LIMIT 1
      FOR UPDATE OF game SKIP LOCKED
    `);
    return rows[0] ?? null;
  }

  if (detector.refreshOnCompleteAnalysis) {
    const rows = await tx.$queryRaw<EligibleEvidenceSource[]>(Prisma.sql`
      SELECT
        game."id" AS "importedGameId",
        game."plyIndexedAt" AS "sourcePlyIndexedAt",
        analysis."id" AS "sourceAnalysisRunId",
        analysis."snapshotId" AS "sourceAnalysisSnapshotId"
      FROM "ImportedGame" AS game
      LEFT JOIN LATERAL (
        SELECT run."id", run."snapshotId"
        FROM "GameAnalysisRun" AS run
        WHERE run."importedGameId" = game."id"
          AND run."status" = 'SUCCEEDED'
          AND run."coverageStatus" = 'COMPLETE'
          AND run."sourcePlyIndexedAt" = game."plyIndexedAt"
          AND NOT EXISTS (
            SELECT 1
            FROM "ImportedGamePly" AS mismatch
            WHERE mismatch."importedGameId" = game."id"
              AND mismatch."engineAnalysisRunId" IS DISTINCT FROM run."id"
          )
        ORDER BY run."completedAt" DESC NULLS LAST, run."id" DESC
        LIMIT 1
      ) AS analysis ON TRUE
      WHERE game."provider" = 'LICHESS'
        AND game."plyIndexStatus" = 'INDEXED'
        AND game."plyIndexedAt" IS NOT NULL
        AND game."speedCategory" IN ('bullet', 'blitz', 'rapid')
        AND (game."variant" IS NULL OR game."variant" IN ('chess', 'standard'))
        AND EXISTS (
          SELECT 1
          FROM "ImportedGamePly" AS ply
          WHERE ply."importedGameId" = game."id"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "EvidenceRun" AS prior
          WHERE prior."importedGameId" = game."id"
            AND prior."detectorKey" = ${detector.key}
            AND prior."detectorVersion" = ${detector.version}
            AND prior."sourcePlyIndexedAt" = game."plyIndexedAt"
            AND prior."sourceAnalysisRunId" IS NOT DISTINCT FROM analysis."id"
        )
      ORDER BY game."id" ASC
      LIMIT 1
      FOR UPDATE OF game SKIP LOCKED
    `);
    return rows[0] ?? null;
  }

  const rows = await tx.$queryRaw<EligibleEvidenceSource[]>(Prisma.sql`
    SELECT
      game."id" AS "importedGameId",
      game."plyIndexedAt" AS "sourcePlyIndexedAt",
      NULL::integer AS "sourceAnalysisRunId",
      NULL::text AS "sourceAnalysisSnapshotId"
    FROM "ImportedGame" AS game
    WHERE game."provider" = 'LICHESS'
      AND game."plyIndexStatus" = 'INDEXED'
      AND game."plyIndexedAt" IS NOT NULL
      AND game."speedCategory" IN ('bullet', 'blitz', 'rapid')
      AND (game."variant" IS NULL OR game."variant" IN ('chess', 'standard'))
      AND EXISTS (
        SELECT 1
        FROM "ImportedGamePly" AS ply
        WHERE ply."importedGameId" = game."id"
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "EvidenceRun" AS prior
        WHERE prior."importedGameId" = game."id"
          AND prior."detectorKey" = ${detector.key}
          AND prior."detectorVersion" = ${detector.version}
          AND prior."sourcePlyIndexedAt" = game."plyIndexedAt"
          AND prior."sourceAnalysisRunId" IS NULL
      )
    ORDER BY game."id" ASC
    LIMIT 1
    FOR UPDATE OF game SKIP LOCKED
  `);
  return rows[0] ?? null;
}

async function sourceIsCurrent(
  tx: Prisma.TransactionClient,
  run: {
    importedGameId: number;
    detectorKey: string;
    sourcePlyIndexedAt: Date;
    sourceAnalysisRunId: number | null;
    sourceAnalysisSnapshotId: string | null;
  },
): Promise<boolean> {
  const game = await tx.importedGame.findUnique({
    where: { id: run.importedGameId },
    select: {
      plyIndexStatus: true,
      plyIndexedAt: true,
      _count: { select: { plies: true } },
    },
  });
  if (
    !game
    || game.plyIndexStatus !== 'INDEXED'
    || !sameInstant(game.plyIndexedAt, run.sourcePlyIndexedAt)
    || game._count.plies === 0
  ) {
    return false;
  }

  if (run.sourceAnalysisSnapshotId === null) {
    if (run.sourceAnalysisRunId !== null) return false;

    // Board-only runs are useful until an analysis-backed projection is successfully
    // published. Once that happens, a late board-only worker must never make its
    // older incomplete projection current again.
    const analysisBackedCurrent = await tx.evidenceRun.findFirst({
      where: {
        importedGameId: run.importedGameId,
        detectorKey: run.detectorKey,
        sourcePlyIndexedAt: run.sourcePlyIndexedAt,
        sourceAnalysisRunId: { not: null },
        status: 'SUCCEEDED',
        isCurrent: true,
      },
      select: { id: true },
    });
    return analysisBackedCurrent === null;
  }
  if (run.sourceAnalysisRunId === null) return false;

  const analysis = await tx.gameAnalysisRun.findUnique({
    where: { id: run.sourceAnalysisRunId },
    select: {
      importedGameId: true,
      snapshotId: true,
      sourcePlyIndexedAt: true,
      status: true,
      coverageStatus: true,
    },
  });
  if (
    !analysis
    || analysis.importedGameId !== run.importedGameId
    || analysis.snapshotId !== run.sourceAnalysisSnapshotId
    || analysis.status !== 'SUCCEEDED'
    || analysis.coverageStatus !== 'COMPLETE'
    || !sameInstant(analysis.sourcePlyIndexedAt, run.sourcePlyIndexedAt)
  ) {
    return false;
  }

  const mismatchedPlies = await tx.importedGamePly.count({
    where: {
      importedGameId: run.importedGameId,
      OR: [
        { engineAnalysisRunId: null },
        { engineAnalysisRunId: { not: run.sourceAnalysisRunId } },
      ],
    },
  });
  return mismatchedPlies === 0;
}

async function activeClaim(
  tx: Prisma.TransactionClient,
  run: EvidenceRunClaim,
): Promise<boolean> {
  const stored = await tx.evidenceRun.findFirst({
    where: {
      id: run.id,
      status: 'RUNNING',
      claimToken: run.claimToken,
      workerId: run.workerId,
      cancelRequestedAt: null,
      sourcePlyIndexedAt: run.sourcePlyIndexedAt,
      sourceAnalysisRunId: run.sourceAnalysisRunId,
    },
    select: {
      importedGameId: true,
      detectorKey: true,
      sourcePlyIndexedAt: true,
      sourceAnalysisRunId: true,
      sourceAnalysisSnapshotId: true,
    },
  });
  return stored !== null && sourceIsCurrent(tx, stored);
}

function findingData(
  run: EvidenceRunClaim,
  finding: EvidenceFindingDraft,
) {
  return {
    evidenceKey: evidenceKeyForFinding(run.workKey, finding.key),
    findingKey: finding.key,
    evidenceType: finding.type,
    availability: finding.availability ?? 'PRESENT',
    sourcePlyStart: finding.source?.startPly ?? null,
    sourcePlyEnd: finding.source?.endPly ?? null,
    sourcePositionId: finding.source?.positionId ?? null,
    measurementsJson: jsonValue(finding.measurements),
    detailsJson: jsonValue(finding.details ?? {}),
    unavailableReason: finding.unavailableReason ?? null,
  };
}

export const prismaEvidenceRepository: EvidenceRepository = {
  async enqueueEligibleRun(detector) {
    try {
      return await prisma.$transaction(async (tx) => {
        const source = await eligibleSource(tx, detector);
        if (!source) return null;
        const workKey = workKeyForSource(detector, source);
        const existing = await tx.evidenceRun.findUnique({
          where: { workKey },
          select: { id: true },
        });
        if (existing) return null;

        const run = await tx.evidenceRun.create({
          data: {
            importedGameId: source.importedGameId,
            detectorKey: detector.key,
            detectorVersion: detector.version,
            workKey,
            sourcePlyIndexedAt: source.sourcePlyIndexedAt,
            sourceAnalysisRunId: source.sourceAnalysisRunId,
            sourceAnalysisSnapshotId: source.sourceAnalysisSnapshotId,
          },
        });
        return run.id;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return null;
      throw error;
    }
  },

  async recoverStaleRuns(staleBefore) {
    const staleRuns = await prisma.evidenceRun.findMany({
      where: {
        status: 'RUNNING',
        OR: [
          { heartbeatAt: null },
          { heartbeatAt: { lt: staleBefore } },
        ],
      },
      select: {
        id: true,
        attempts: true,
        maxAttempts: true,
        claimToken: true,
      },
    });

    let recovered = 0;
    for (const stale of staleRuns) {
      const terminal = stale.attempts >= stale.maxAttempts;
      const updated = await prisma.evidenceRun.updateMany({
        where: {
          id: stale.id,
          status: 'RUNNING',
          claimToken: stale.claimToken,
          OR: [
            { heartbeatAt: null },
            { heartbeatAt: { lt: staleBefore } },
          ],
        },
        data: terminal
          ? {
              status: 'FAILED',
              coverageStatus: 'INCOMPLETE',
              error: 'Worker lease expired before evidence detection completed.',
              completedAt: new Date(),
              workerId: null,
              claimToken: null,
              isCurrent: false,
            }
          : {
              status: 'RETRY_WAIT',
              coverageStatus: 'PENDING',
              error: 'Worker lease expired before evidence detection completed.',
              runAfter: new Date(),
              claimedAt: null,
              heartbeatAt: null,
              workerId: null,
              claimToken: null,
              isCurrent: false,
            },
      });
      recovered += updated.count;
    }
    return recovered;
  },

  async claimNext(workerId, detectors) {
    if (detectors.length === 0) return null;

    return prisma.$transaction(async (tx) => {
      for (let skipped = 0; skipped < 10; skipped += 1) {
        const now = new Date();
        const candidate = await tx.evidenceRun.findFirst({
          where: {
            status: { in: ['QUEUED', 'RETRY_WAIT'] },
            runAfter: { lte: now },
            cancelRequestedAt: null,
            OR: detectors.map((detector) => ({
              detectorKey: detector.key,
              detectorVersion: detector.version,
            })),
          },
          orderBy: [{ runAfter: 'asc' }, { id: 'asc' }],
        });
        if (!candidate) return null;

        if (!await sourceIsCurrent(tx, candidate)) {
          await tx.evidenceRun.updateMany({
            where: { id: candidate.id, status: candidate.status },
            data: {
              status: 'SUPERSEDED',
              coverageStatus: 'INCOMPLETE',
              cancelRequestedAt: now,
              completedAt: now,
              workerId: null,
              claimToken: null,
              isCurrent: false,
              supersededAt: now,
            },
          });
          continue;
        }

        const claimToken = randomUUID();
        const claimed = await tx.evidenceRun.updateMany({
          where: {
            id: candidate.id,
            status: candidate.status,
            cancelRequestedAt: null,
          },
          data: {
            status: 'RUNNING',
            coverageStatus: 'PENDING',
            attempts: { increment: 1 },
            startedAt: candidate.startedAt ?? now,
            claimedAt: now,
            heartbeatAt: now,
            workerId,
            claimToken,
            error: null,
            completedAt: null,
            isCurrent: false,
          },
        });
        if (claimed.count !== 1) continue;

        const run = await tx.evidenceRun.findUniqueOrThrow({
          where: { id: candidate.id },
        });
        return {
          id: run.id,
          importedGameId: run.importedGameId,
          detectorKey: run.detectorKey,
          detectorVersion: run.detectorVersion,
          workKey: run.workKey,
          sourcePlyIndexedAt: run.sourcePlyIndexedAt,
          sourceAnalysisRunId: run.sourceAnalysisRunId,
          sourceAnalysisSnapshotId: run.sourceAnalysisSnapshotId,
          attempts: run.attempts,
          maxAttempts: run.maxAttempts,
          workerId,
          claimToken,
        };
      }
      return null;
    });
  },

  async loadSnapshot(run) {
    return prisma.$transaction(async (tx) => {
      if (!await activeClaim(tx, run)) {
        throw new Error('Evidence source projection changed while work was in flight');
      }

      const game = await tx.importedGame.findUniqueOrThrow({
        where: { id: run.importedGameId },
        select: {
          id: true,
          appUserId: true,
          provider: true,
          providerGameId: true,
          userColor: true,
          resultForUser: true,
          speedCategory: true,
          variant: true,
          timeControlInitial: true,
          timeControlIncrement: true,
          exactTimeControlKey: true,
          openingName: true,
          openingEco: true,
          plyIndexPolicyVersion: true,
          clockAlignmentVersion: true,
          timingDerivationVersion: true,
          timingCoverageStatus: true,
          plies: {
            orderBy: { plyNumber: 'asc' },
            select: {
              plyNumber: true,
              beforePositionId: true,
              beforePosition: {
                select: { id: true, normalizedFen: true },
              },
              afterPositionId: true,
              afterPosition: {
                select: { id: true, normalizedFen: true },
              },
              moveUci: true,
              moverColor: true,
              isUserMove: true,
              sourceClockOrdinal: true,
              sourceClockAfterCentiseconds: true,
              sourceClockSemantics: true,
              clockBeforeMoveCentiseconds: true,
              effectiveIncrementCentiseconds: true,
              clockDeltaMoveTimeCentiseconds: true,
              beforeClockProvenance: true,
              incrementProvenance: true,
              timingDerivationVersion: true,
              timingDerivationStatus: true,
              timingReliabilityFlags: true,
              timingUnavailableReason: true,
              engineAnalysisRunId: true,
              scoreLossCp: true,
              classificationCode: true,
            },
          },
        },
      });

      const positionMap = new Map<number, { id: number; normalizedFen: string }>();
      for (const ply of game.plies) {
        positionMap.set(ply.beforePosition.id, ply.beforePosition);
        positionMap.set(ply.afterPosition.id, ply.afterPosition);
      }

      const analysisRun = run.sourceAnalysisRunId === null
        ? null
        : await tx.gameAnalysisRun.findUniqueOrThrow({
            where: { id: run.sourceAnalysisRunId },
            select: {
              id: true,
              snapshotId: true,
              analysisVersion: true,
              settingsHash: true,
              engineName: true,
              engineVersion: true,
            },
          });

      let analysisByPosition = new Map<number, {
        depth: number;
        scoreCpWhite: number | null;
        mateWhite: number | null;
        bestMove: string | null;
        bestPv: string[];
        multiPv: EvidenceMultiPvLineSnapshot[];
      }>();
      if (analysisRun) {
        if (!analysisRun.engineName || !analysisRun.engineVersion) {
          throw new Error('Complete evidence source analysis is missing engine identity');
        }
        const rows = await tx.stockfishPositionAnalysis.findMany({
          where: {
            positionId: { in: [...positionMap.keys()] },
            analysisVersion: analysisRun.analysisVersion,
            settingsHash: analysisRun.settingsHash,
            engineName: analysisRun.engineName,
            engineVersion: analysisRun.engineVersion,
          },
          select: {
            positionId: true,
            depth: true,
            scoreCpWhite: true,
            mateWhite: true,
            bestMove: true,
            bestPv: true,
            multiPvJson: true,
          },
        });
        analysisByPosition = new Map(rows.map((row) => [
          row.positionId,
          {
            depth: row.depth,
            scoreCpWhite: row.scoreCpWhite,
            mateWhite: row.mateWhite,
            bestMove: row.bestMove,
            bestPv: row.bestPv,
            multiPv: Array.isArray(row.multiPvJson)
              ? row.multiPvJson as unknown as EvidenceMultiPvLineSnapshot[]
              : [],
          },
        ]));
        if (analysisByPosition.size !== positionMap.size) {
          throw new Error('Complete evidence source analysis is missing cached position evidence');
        }
      }

      return {
        game: {
          id: game.id,
          appUserId: game.appUserId,
          provider: game.provider,
          providerGameId: game.providerGameId,
          userColor: game.userColor,
          resultForUser: game.resultForUser,
          speedCategory: game.speedCategory,
          variant: game.variant,
          timeControlInitial: game.timeControlInitial,
          timeControlIncrement: game.timeControlIncrement,
          exactTimeControlKey: game.exactTimeControlKey,
          openingName: game.openingName,
          openingEco: game.openingEco,
        },
        provenance: {
          sourcePlyIndexedAt: run.sourcePlyIndexedAt,
          plyIndexPolicyVersion: game.plyIndexPolicyVersion,
          clockAlignmentVersion: game.clockAlignmentVersion,
          timingDerivationVersion: game.timingDerivationVersion,
          timingCoverageStatus: game.timingCoverageStatus,
          analysis: analysisRun
            ? {
                runId: analysisRun.id,
                snapshotId: analysisRun.snapshotId,
                analysisVersion: analysisRun.analysisVersion,
                settingsHash: analysisRun.settingsHash,
                engineName: analysisRun.engineName!,
                engineVersion: analysisRun.engineVersion!,
              }
            : null,
        },
        positions: [...positionMap.values()]
          .sort((left, right) => left.id - right.id)
          .map((position) => ({
            ...position,
            analysis: analysisByPosition.get(position.id) ?? null,
          })),
        plies: game.plies.map((ply) => ({
          plyNumber: ply.plyNumber,
          beforePositionId: ply.beforePositionId,
          afterPositionId: ply.afterPositionId,
          moveUci: ply.moveUci,
          moverColor: ply.moverColor,
          isUserMove: ply.isUserMove,
          sourceClockOrdinal: ply.sourceClockOrdinal,
          sourceClockAfterCentiseconds: ply.sourceClockAfterCentiseconds,
          sourceClockSemantics: ply.sourceClockSemantics,
          clockBeforeMoveCentiseconds: ply.clockBeforeMoveCentiseconds,
          effectiveIncrementCentiseconds: ply.effectiveIncrementCentiseconds,
          clockDeltaMoveTimeCentiseconds: ply.clockDeltaMoveTimeCentiseconds,
          beforeClockProvenance: ply.beforeClockProvenance,
          incrementProvenance: ply.incrementProvenance,
          timingDerivationVersion: ply.timingDerivationVersion,
          timingDerivationStatus: ply.timingDerivationStatus,
          timingReliabilityFlags: ply.timingReliabilityFlags,
          timingUnavailableReason: ply.timingUnavailableReason,
          engineAnalysisRunId: analysisRun ? ply.engineAnalysisRunId : null,
          scoreLossCp: analysisRun ? ply.scoreLossCp : null,
          classificationCode: analysisRun ? ply.classificationCode : null,
        })),
      };
    });
  },

  async completeRun(run, result) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Serialize evidence publication for a game and freeze its source ply rows
        // while provenance is checked and the current pointer is switched.
        await tx.$queryRaw(Prisma.sql`
          SELECT "id"
          FROM "ImportedGame"
          WHERE "id" = ${run.importedGameId}
          FOR UPDATE
        `);
        await tx.$queryRaw(Prisma.sql`
          SELECT "plyNumber"
          FROM "ImportedGamePly"
          WHERE "importedGameId" = ${run.importedGameId}
          ORDER BY "plyNumber"
          FOR UPDATE
        `);
        if (!await activeClaim(tx, run)) return false;

        await tx.evidenceEvent.deleteMany({ where: { runId: run.id } });
        if (result.findings.length > 0) {
          await tx.evidenceEvent.createMany({
            data: result.findings.map((finding) => ({
              runId: run.id,
              ...findingData(run, finding),
            })),
          });
        }

        const now = new Date();
        await tx.evidenceRun.updateMany({
          where: {
            importedGameId: run.importedGameId,
            detectorKey: run.detectorKey,
            isCurrent: true,
            id: { not: run.id },
          },
          data: {
            isCurrent: false,
            supersededAt: now,
          },
        });

        const updated = await tx.evidenceRun.updateMany({
          where: {
            id: run.id,
            status: 'RUNNING',
            claimToken: run.claimToken,
            workerId: run.workerId,
            cancelRequestedAt: null,
            importedGame: {
              plyIndexStatus: 'INDEXED',
              plyIndexedAt: run.sourcePlyIndexedAt,
            },
          },
          data: {
            status: 'SUCCEEDED',
            coverageStatus: result.coverage.status,
            coverageJson: jsonValue(result.coverage),
            heartbeatAt: now,
            completedAt: now,
            workerId: null,
            claimToken: null,
            error: null,
            isCurrent: true,
            supersededAt: null,
          },
        });
        if (updated.count !== 1) {
          throw new Error('Evidence source projection changed before completion');
        }
        return true;
      });
    } catch (error) {
      if (
        error instanceof Error
        && error.message === 'Evidence source projection changed before completion'
      ) {
        return false;
      }
      throw error;
    }
  },

  async markFailure(run, error) {
    await prisma.$transaction(async (tx) => {
      const stored = await tx.evidenceRun.findFirst({
        where: {
          id: run.id,
          status: 'RUNNING',
          claimToken: run.claimToken,
          workerId: run.workerId,
        },
      });
      if (!stored) return;

      const now = new Date();
      if (!await sourceIsCurrent(tx, stored)) {
        await tx.evidenceRun.updateMany({
          where: {
            id: run.id,
            status: 'RUNNING',
            claimToken: run.claimToken,
          },
          data: {
            status: 'SUPERSEDED',
            coverageStatus: 'INCOMPLETE',
            cancelRequestedAt: now,
            completedAt: now,
            workerId: null,
            claimToken: null,
            isCurrent: false,
            supersededAt: now,
            error,
          },
        });
        return;
      }

      const terminal = run.attempts >= run.maxAttempts;
      await tx.evidenceRun.updateMany({
        where: {
          id: run.id,
          status: 'RUNNING',
          claimToken: run.claimToken,
          workerId: run.workerId,
        },
        data: terminal
          ? {
              status: 'FAILED',
              coverageStatus: 'INCOMPLETE',
              error,
              completedAt: now,
              heartbeatAt: now,
              workerId: null,
              claimToken: null,
              isCurrent: false,
            }
          : {
              status: 'RETRY_WAIT',
              coverageStatus: 'PENDING',
              error,
              runAfter: new Date(Date.now() + retryDelayMs(run.attempts)),
              claimedAt: null,
              heartbeatAt: null,
              workerId: null,
              claimToken: null,
              isCurrent: false,
            },
      });
    });
  },

  async listCurrentEvidenceForGame(importedGameId) {
    return prisma.$transaction(async (tx) => {
      const game = await tx.importedGame.findUnique({
        where: { id: importedGameId },
        select: { plyIndexStatus: true, plyIndexedAt: true },
      });
      if (!game || game.plyIndexStatus !== 'INDEXED' || !game.plyIndexedAt) return [];

      const runs = await tx.evidenceRun.findMany({
        where: {
          importedGameId,
          status: 'SUCCEEDED',
          isCurrent: true,
          sourcePlyIndexedAt: game.plyIndexedAt,
        },
        orderBy: [{ detectorKey: 'asc' }, { id: 'desc' }],
        include: {
          events: {
            orderBy: [{ sourcePlyStart: 'asc' }, { id: 'asc' }],
          },
        },
      });

      const current: CurrentEvidenceRun[] = [];
      for (const run of runs) {
        if (!await sourceIsCurrent(tx, run)) continue;
        current.push({
          id: run.id,
          detectorKey: run.detectorKey,
          detectorVersion: run.detectorVersion,
          coverageStatus: run.coverageStatus,
          coverage: run.coverageJson,
          sourcePlyIndexedAt: run.sourcePlyIndexedAt,
          sourceAnalysisRunId: run.sourceAnalysisRunId,
          sourceAnalysisSnapshotId: run.sourceAnalysisSnapshotId,
          events: run.events.map((event) => ({
            id: event.id,
            evidenceKey: event.evidenceKey,
            findingKey: event.findingKey,
            evidenceType: event.evidenceType,
            availability: event.availability,
            sourcePlyStart: event.sourcePlyStart,
            sourcePlyEnd: event.sourcePlyEnd,
            sourcePositionId: event.sourcePositionId,
            measurements: event.measurementsJson,
            details: event.detailsJson,
            unavailableReason: event.unavailableReason,
          })),
        });
      }
      return current;
    });
  },
};
