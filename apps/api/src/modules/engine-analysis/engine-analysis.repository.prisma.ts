import { randomUUID } from 'node:crypto';
import { Prisma, type GameAnalysisRun } from '@prisma/client';
import prisma from '../../prisma';
import type {
  StockfishPositionAnalysis,
  StockfishPvLine,
  StockfishSettings,
} from './stockfish.adapter';

const ACTIVE_STATUSES = ['QUEUED', 'RUNNING', 'RETRY_WAIT'] as const;

export interface AnalysisRunClaim {
  id: number;
  importedGameId: number;
  snapshotId: string;
  attempts: number;
  maxAttempts: number;
  analysisVersion: string;
  settingsHash: string;
  sourcePlyIndexedAt: Date;
  workerId: string;
  claimToken: string;
}

export interface AnalysisPositionWork {
  positionId: number;
  normalizedFen: string;
}

export interface AnalysisPlyWork {
  plyNumber: number;
  beforePositionId: number;
  afterPositionId: number;
  moveUci: string;
  moverColor: string;
}

export interface AnalysisGameWork {
  positions: AnalysisPositionWork[];
  plies: AnalysisPlyWork[];
}

export interface CachedPositionAnalysis extends StockfishPositionAnalysis {
  positionId: number;
}

export interface AnalysisRepository {
  enqueueEligibleGame(input: {
    analysisVersion: string;
    settingsHash: string;
    settings: StockfishSettings;
  }): Promise<number | null>;
  recoverStaleRuns(staleBefore: Date): Promise<number>;
  claimNext(workerId: string): Promise<AnalysisRunClaim | null>;
  recordEngineIdentity(
    run: AnalysisRunClaim,
    engineName: string,
    engineVersion: string,
  ): Promise<boolean>;
  loadGameWork(run: AnalysisRunClaim): Promise<AnalysisGameWork>;
  loadCachedPositionAnalyses(input: {
    positionIds: number[];
    analysisVersion: string;
    settingsHash: string;
    engineName: string;
    engineVersion: string;
  }): Promise<CachedPositionAnalysis[]>;
  initializeProgress(
    run: AnalysisRunClaim,
    input: {
      positionsTotal: number;
      pliesTotal: number;
      cacheHits: number;
      cacheMisses: number;
    },
  ): Promise<boolean>;
  persistBatch(
    run: AnalysisRunClaim,
    input: {
      engineName: string;
      engineVersion: string;
      positionResults: Array<{ positionId: number; analysis: StockfishPositionAnalysis }>;
      plyResults: Array<{ plyNumber: number; scoreLossCp: number; classificationCode: number }>;
      positionsDone: number;
      pliesDone: number;
    },
  ): Promise<boolean>;
  markSucceeded(run: AnalysisRunClaim): Promise<boolean>;
  markFailure(run: AnalysisRunClaim, error: string): Promise<void>;
  requestReanalysis(input: {
    importedGameId: number;
    analysisVersion: string;
    settingsHash: string;
    settings: StockfishSettings;
  }): Promise<number>;
}

function retryDelayMs(attempts: number): number {
  return Math.min(60_000, 1_000 * (2 ** Math.max(0, attempts - 1)));
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2002';
}

async function createRun(
  tx: Prisma.TransactionClient,
  input: {
    importedGameId: number;
    analysisVersion: string;
    settingsHash: string;
    settings: StockfishSettings;
    sourcePlyIndexedAt: Date;
  },
): Promise<GameAnalysisRun> {
  return tx.gameAnalysisRun.create({
    data: {
      importedGameId: input.importedGameId,
      analysisVersion: input.analysisVersion,
      settingsHash: input.settingsHash,
      settingsJson: input.settings as unknown as Prisma.InputJsonValue,
      sourcePlyIndexedAt: input.sourcePlyIndexedAt,
    },
  });
}

function jsonPvLines(value: Prisma.JsonValue): StockfishPvLine[] {
  return Array.isArray(value) ? value as unknown as StockfishPvLine[] : [];
}

function jsonRawInfo(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

async function currentClaim(
  tx: Prisma.TransactionClient,
  run: AnalysisRunClaim,
) {
  return tx.gameAnalysisRun.findFirst({
    where: {
      id: run.id,
      status: 'RUNNING',
      claimToken: run.claimToken,
      sourcePlyIndexedAt: run.sourcePlyIndexedAt,
      cancelRequestedAt: null,
      importedGame: {
        plyIndexStatus: 'INDEXED',
        plyIndexedAt: run.sourcePlyIndexedAt,
      },
    },
  });
}

export const prismaAnalysisRepository: AnalysisRepository = {
  async enqueueEligibleGame(input) {
    try {
      return await prisma.$transaction(async (tx) => {
        const candidates = await tx.$queryRaw<Array<{
          id: number;
          sourcePlyIndexedAt: Date;
        }>>(Prisma.sql`
          SELECT game."id", game."plyIndexedAt" AS "sourcePlyIndexedAt"
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
              FROM "GameAnalysisRun" AS active
              WHERE active."importedGameId" = game."id"
                AND active."status" IN ('QUEUED', 'RUNNING', 'RETRY_WAIT')
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "GameAnalysisRun" AS prior
              WHERE prior."importedGameId" = game."id"
                AND prior."analysisVersion" = ${input.analysisVersion}
                AND prior."settingsHash" = ${input.settingsHash}
                AND prior."sourcePlyIndexedAt" = game."plyIndexedAt"
            )
          ORDER BY game."id" ASC
          LIMIT 1
          FOR UPDATE OF game SKIP LOCKED
        `);
        const game = candidates[0];
        if (!game) return null;

        const run = await createRun(tx, {
          ...input,
          importedGameId: game.id,
          sourcePlyIndexedAt: game.sourcePlyIndexedAt,
        });
        return run.id;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return null;
      throw error;
    }
  },
  async recoverStaleRuns(staleBefore) {
    const staleRuns = await prisma.gameAnalysisRun.findMany({
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
        positionsDone: true,
        pliesDone: true,
        claimToken: true,
      },
    });

    let recovered = 0;
    for (const stale of staleRuns) {
      const terminal = stale.attempts >= stale.maxAttempts;
      const hasCoverage = stale.positionsDone > 0 || stale.pliesDone > 0;
      const updated = await prisma.gameAnalysisRun.updateMany({
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
              coverageStatus: hasCoverage ? 'PARTIAL' : 'UNAVAILABLE',
              error: 'Worker lease expired before analysis completed.',
              completedAt: new Date(),
              workerId: null,
              claimToken: null,
            }
          : {
              status: 'RETRY_WAIT',
              coverageStatus: hasCoverage ? 'PARTIAL' : 'PENDING',
              error: 'Worker lease expired before analysis completed.',
              runAfter: new Date(),
              claimedAt: null,
              heartbeatAt: null,
              workerId: null,
              claimToken: null,
            },
      });
      recovered += updated.count;
    }
    return recovered;
  },

  async claimNext(workerId) {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const candidate = await tx.gameAnalysisRun.findFirst({
        where: {
          status: { in: ['QUEUED', 'RETRY_WAIT'] },
          runAfter: { lte: now },
          cancelRequestedAt: null,
          sourcePlyIndexedAt: { not: null },
        },
        orderBy: [{ runAfter: 'asc' }, { id: 'asc' }],
        include: {
          importedGame: {
            select: { plyIndexStatus: true, plyIndexedAt: true },
          },
        },
      });
      if (!candidate) return null;

      const sourceIsCurrent = candidate.importedGame.plyIndexStatus === 'INDEXED'
        && candidate.importedGame.plyIndexedAt?.getTime() === candidate.sourcePlyIndexedAt?.getTime();
      if (!sourceIsCurrent) {
        await tx.gameAnalysisRun.updateMany({
          where: { id: candidate.id, status: candidate.status },
          data: {
            status: 'SUPERSEDED',
            coverageStatus: 'INCOMPLETE',
            cancelRequestedAt: now,
            completedAt: now,
            workerId: null,
            claimToken: null,
          },
        });
        return null;
      }

      const claimToken = randomUUID();
      const claimed = await tx.gameAnalysisRun.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status,
          sourcePlyIndexedAt: candidate.sourcePlyIndexedAt,
          cancelRequestedAt: null,
          importedGame: {
            plyIndexStatus: 'INDEXED',
            plyIndexedAt: candidate.sourcePlyIndexedAt,
          },
        },
        data: {
          status: 'RUNNING',
          coverageStatus: candidate.positionsDone > 0 || candidate.pliesDone > 0 ? 'PARTIAL' : 'PENDING',
          attempts: { increment: 1 },
          startedAt: candidate.startedAt ?? now,
          claimedAt: now,
          heartbeatAt: now,
          workerId,
          claimToken,
          error: null,
          completedAt: null,
        },
      });
      if (claimed.count !== 1) return null;

      const run = await tx.gameAnalysisRun.findUniqueOrThrow({ where: { id: candidate.id } });
      return {
        id: run.id,
        importedGameId: run.importedGameId,
        snapshotId: run.snapshotId,
        attempts: run.attempts,
        maxAttempts: run.maxAttempts,
        analysisVersion: run.analysisVersion,
        settingsHash: run.settingsHash,
        sourcePlyIndexedAt: run.sourcePlyIndexedAt!,
        workerId,
        claimToken,
      };
    });
  },

  async recordEngineIdentity(run, engineName, engineVersion) {
    const updated = await prisma.gameAnalysisRun.updateMany({
      where: {
        id: run.id,
        status: 'RUNNING',
        claimToken: run.claimToken,
        sourcePlyIndexedAt: run.sourcePlyIndexedAt,
        cancelRequestedAt: null,
        importedGame: {
          plyIndexStatus: 'INDEXED',
          plyIndexedAt: run.sourcePlyIndexedAt,
        },
      },
      data: { engineName, engineVersion, heartbeatAt: new Date() },
    });
    return updated.count === 1;
  },

  async loadGameWork(run) {
    const storedRun = await prisma.gameAnalysisRun.findFirst({
      where: {
        id: run.id,
        sourcePlyIndexedAt: run.sourcePlyIndexedAt,
        importedGame: {
          plyIndexStatus: 'INDEXED',
          plyIndexedAt: run.sourcePlyIndexedAt,
        },
      },
      select: {
        importedGame: {
          select: {
            plies: {
              orderBy: { plyNumber: 'asc' },
              select: {
                plyNumber: true,
                moveUci: true,
                moverColor: true,
                beforePosition: { select: { id: true, normalizedFen: true } },
                afterPosition: { select: { id: true, normalizedFen: true } },
              },
            },
          },
        },
      },
    });
    if (!storedRun) {
      throw new Error('Analysis source ply projection changed while work was in flight');
    }

    const positions = new Map<number, AnalysisPositionWork>();
    const plies: AnalysisPlyWork[] = [];
    for (const ply of storedRun.importedGame.plies) {
      positions.set(ply.beforePosition.id, {
        positionId: ply.beforePosition.id,
        normalizedFen: ply.beforePosition.normalizedFen,
      });
      positions.set(ply.afterPosition.id, {
        positionId: ply.afterPosition.id,
        normalizedFen: ply.afterPosition.normalizedFen,
      });
      plies.push({
        plyNumber: ply.plyNumber,
        beforePositionId: ply.beforePosition.id,
        afterPositionId: ply.afterPosition.id,
        moveUci: ply.moveUci,
        moverColor: ply.moverColor,
      });
    }
    return { positions: [...positions.values()], plies };
  },
  async loadCachedPositionAnalyses(input) {
    if (input.positionIds.length === 0) return [];
    const rows = await prisma.stockfishPositionAnalysis.findMany({
      where: {
        positionId: { in: input.positionIds },
        analysisVersion: input.analysisVersion,
        settingsHash: input.settingsHash,
        engineName: input.engineName,
        engineVersion: input.engineVersion,
      },
    });
    return rows.map((row) => ({
      positionId: row.positionId,
      depth: row.depth,
      scoreCpWhite: row.scoreCpWhite,
      mateWhite: row.mateWhite,
      bestMove: row.bestMove,
      bestPv: row.bestPv,
      multiPv: jsonPvLines(row.multiPvJson),
      rawInfo: jsonRawInfo(row.rawInfoJson),
    }));
  },

  async initializeProgress(run, input) {
    const updated = await prisma.gameAnalysisRun.updateMany({
      where: {
        id: run.id,
        status: 'RUNNING',
        claimToken: run.claimToken,
        sourcePlyIndexedAt: run.sourcePlyIndexedAt,
        cancelRequestedAt: null,
        importedGame: {
          plyIndexStatus: 'INDEXED',
          plyIndexedAt: run.sourcePlyIndexedAt,
        },
      },
      data: {
        positionsTotal: input.positionsTotal,
        positionsDone: input.cacheHits,
        pliesTotal: input.pliesTotal,
        pliesDone: 0,
        cacheHits: input.cacheHits,
        cacheMisses: input.cacheMisses,
        coverageStatus: input.cacheHits > 0 ? 'PARTIAL' : 'PENDING',
        heartbeatAt: new Date(),
      },
    });
    return updated.count === 1;
  },

  async persistBatch(run, input) {
    return prisma.$transaction(async (tx) => {
      const active = await currentClaim(tx, run);
      if (!active) return false;

      if (input.positionResults.length > 0) {
        await tx.stockfishPositionAnalysis.createMany({
          data: input.positionResults.map(({ positionId, analysis }) => ({
            positionId,
            analysisVersion: run.analysisVersion,
            engineName: input.engineName,
            engineVersion: input.engineVersion,
            settingsHash: run.settingsHash,
            depth: analysis.depth,
            scoreCpWhite: analysis.scoreCpWhite,
            mateWhite: analysis.mateWhite,
            bestMove: analysis.bestMove,
            bestPv: analysis.bestPv,
            multiPvJson: analysis.multiPv as unknown as Prisma.InputJsonValue,
            rawInfoJson: analysis.rawInfo as unknown as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        });
      }

      for (const ply of input.plyResults) {
        const updated = await tx.importedGamePly.updateMany({
          where: {
            importedGameId: run.importedGameId,
            plyNumber: ply.plyNumber,
          },
          data: {
            engineAnalysisRunId: run.id,
            scoreLossCp: ply.scoreLossCp,
            classificationCode: ply.classificationCode,
          },
        });
        if (updated.count !== 1) {
          throw new Error('Could not persist analysis for ply ' + ply.plyNumber);
        }
      }

      const progress = await tx.gameAnalysisRun.updateMany({
        where: {
          id: run.id,
          status: 'RUNNING',
          claimToken: run.claimToken,
          sourcePlyIndexedAt: run.sourcePlyIndexedAt,
          cancelRequestedAt: null,
          importedGame: {
            plyIndexStatus: 'INDEXED',
            plyIndexedAt: run.sourcePlyIndexedAt,
          },
        },
        data: {
          positionsDone: input.positionsDone,
          pliesDone: input.pliesDone,
          coverageStatus: input.positionsDone > 0 || input.pliesDone > 0 ? 'PARTIAL' : 'PENDING',
          heartbeatAt: new Date(),
        },
      });
      return progress.count === 1;
    });
  },

  async markSucceeded(run) {
    return prisma.$transaction(async (tx) => {
      const current = await currentClaim(tx, run);
      if (!current) return false;
      if (
        current.positionsTotal <= 0
        || current.pliesTotal <= 0
        || current.positionsDone !== current.positionsTotal
        || current.pliesDone !== current.pliesTotal
      ) {
        throw new Error(
          'Analysis run ' + run.id + ' cannot succeed with incomplete coverage '
          + '(' + current.positionsDone + '/' + current.positionsTotal + ' positions, '
          + current.pliesDone + '/' + current.pliesTotal + ' plies)',
        );
      }

      const updated = await tx.gameAnalysisRun.updateMany({
        where: {
          id: run.id,
          status: 'RUNNING',
          claimToken: run.claimToken,
          sourcePlyIndexedAt: run.sourcePlyIndexedAt,
          cancelRequestedAt: null,
          importedGame: {
            plyIndexStatus: 'INDEXED',
            plyIndexedAt: run.sourcePlyIndexedAt,
          },
        },
        data: {
          status: 'SUCCEEDED',
          coverageStatus: 'COMPLETE',
          completedAt: new Date(),
          heartbeatAt: new Date(),
          workerId: null,
          claimToken: null,
        },
      });
      return updated.count === 1;
    });
  },

  async markFailure(run, error) {
    const current = await prisma.gameAnalysisRun.findFirst({
      where: {
        id: run.id,
        status: 'RUNNING',
        claimToken: run.claimToken,
        sourcePlyIndexedAt: run.sourcePlyIndexedAt,
        importedGame: {
          plyIndexStatus: 'INDEXED',
          plyIndexedAt: run.sourcePlyIndexedAt,
        },
      },
      select: {
        positionsDone: true,
        pliesDone: true,
      },
    });
    if (!current) return;

    const terminal = run.attempts >= run.maxAttempts;
    const hasCoverage = current.positionsDone > 0 || current.pliesDone > 0;
    await prisma.gameAnalysisRun.updateMany({
      where: {
        id: run.id,
        status: 'RUNNING',
        claimToken: run.claimToken,
        sourcePlyIndexedAt: run.sourcePlyIndexedAt,
        importedGame: {
          plyIndexStatus: 'INDEXED',
          plyIndexedAt: run.sourcePlyIndexedAt,
        },
      },
      data: terminal
        ? {
            status: 'FAILED',
            coverageStatus: hasCoverage ? 'PARTIAL' : 'UNAVAILABLE',
            error,
            completedAt: new Date(),
            workerId: null,
            claimToken: null,
          }
        : {
            status: 'RETRY_WAIT',
            coverageStatus: hasCoverage ? 'PARTIAL' : 'PENDING',
            error,
            runAfter: new Date(Date.now() + retryDelayMs(run.attempts)),
            claimedAt: null,
            heartbeatAt: null,
            workerId: null,
            claimToken: null,
          },
    });
  },

  async requestReanalysis(input) {
    return prisma.$transaction(async (tx) => {
      const game = await tx.importedGame.findUnique({
        where: { id: input.importedGameId },
        select: { plyIndexStatus: true, plyIndexedAt: true },
      });
      if (!game || game.plyIndexStatus !== 'INDEXED' || !game.plyIndexedAt) {
        throw new Error('Imported game must have a current indexed ply projection before analysis');
      }

      const now = new Date();
      await tx.gameAnalysisRun.updateMany({
        where: {
          importedGameId: input.importedGameId,
          status: { in: [...ACTIVE_STATUSES] },
        },
        data: {
          status: 'SUPERSEDED',
          coverageStatus: 'INCOMPLETE',
          cancelRequestedAt: now,
          completedAt: now,
          workerId: null,
          claimToken: null,
        },
      });
      const run = await createRun(tx, {
        ...input,
        sourcePlyIndexedAt: game.plyIndexedAt,
      });
      return run.id;
    });
  }
};
