import { Prisma, type GameAnalysisRun } from '@prisma/client';
import prisma from '../../prisma';
import type { StockfishPositionAnalysis, StockfishSettings } from './stockfish.adapter';

const ACTIVE_STATUSES = ['QUEUED', 'RUNNING', 'RETRY_WAIT'] as const;

export interface AnalysisRunClaim {
  id: number;
  importedGameId: number;
  snapshotId: string;
  attempts: number;
  maxAttempts: number;
  settingsHash: string;
}

export interface AnalysisPositionWork {
  positionId: number;
  normalizedFen: string;
}

export interface AnalysisRepository {
  enqueueEligibleGame(input: { analysisVersion: string; settingsHash: string; settings: StockfishSettings }): Promise<number | null>;
  claimNext(workerId: string): Promise<AnalysisRunClaim | null>;
  recordEngineIdentity(runId: number, engineName: string, engineVersion: string): Promise<boolean>;
  loadPositions(runId: number): Promise<AnalysisPositionWork[]>;
  persistPositionResult(input: {
    runId: number;
    positionId: number;
    engineName: string;
    engineVersion: string;
    settingsHash: string;
    analysis: StockfishPositionAnalysis;
  }): Promise<boolean>;
  markSucceeded(runId: number): Promise<void>;
  markFailure(run: AnalysisRunClaim, error: string): Promise<void>;
  requestReanalysis(input: { importedGameId: number; analysisVersion: string; settingsHash: string; settings: StockfishSettings }): Promise<number>;
}

function retryDelayMs(attempts: number): number {
  return Math.min(60_000, 1_000 * (2 ** Math.max(0, attempts - 1)));
}

async function createRun(
  tx: Prisma.TransactionClient,
  input: { importedGameId: number; analysisVersion: string; settingsHash: string; settings: StockfishSettings },
): Promise<GameAnalysisRun> {
  return tx.gameAnalysisRun.create({
    data: {
      importedGameId: input.importedGameId,
      analysisVersion: input.analysisVersion,
      settingsHash: input.settingsHash,
      settingsJson: input.settings as unknown as Prisma.InputJsonValue,
    },
  });
}

export const prismaAnalysisRepository: AnalysisRepository = {
  async enqueueEligibleGame(input) {
    return prisma.$transaction(async (tx) => {
      const game = await tx.importedGame.findFirst({
        where: {
          plyIndexStatus: 'INDEXED',
          plies: { some: {} },
          analysisRuns: {
            none: {
              analysisVersion: input.analysisVersion,
              settingsHash: input.settingsHash,
            },
          },
        },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      if (!game) return null;
      const run = await createRun(tx, { ...input, importedGameId: game.id });
      return run.id;
    });
  },

  async claimNext(workerId) {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const candidate = await tx.gameAnalysisRun.findFirst({
        where: {
          status: { in: ['QUEUED', 'RETRY_WAIT'] },
          runAfter: { lte: now },
          cancelRequestedAt: null,
        },
        orderBy: [{ runAfter: 'asc' }, { id: 'asc' }],
      });
      if (!candidate) return null;
      const claimed = await tx.gameAnalysisRun.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status,
          cancelRequestedAt: null,
        },
        data: {
          status: 'RUNNING',
          attempts: { increment: 1 },
          claimedAt: now,
          heartbeatAt: now,
          workerId,
          error: null,
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
        settingsHash: run.settingsHash,
      };
    });
  },

  async recordEngineIdentity(runId, engineName, engineVersion) {
    const updated = await prisma.gameAnalysisRun.updateMany({
      where: { id: runId, status: 'RUNNING', cancelRequestedAt: null },
      data: { engineName, engineVersion, heartbeatAt: new Date() },
    });
    return updated.count === 1;
  },

  async loadPositions(runId) {
    const run = await prisma.gameAnalysisRun.findUnique({
      where: { id: runId },
      select: {
        importedGame: {
          select: {
            plies: {
              orderBy: { plyNumber: 'asc' },
              select: {
                beforePosition: { select: { id: true, normalizedFen: true } },
                afterPosition: { select: { id: true, normalizedFen: true } },
              },
            },
          },
        },
      },
    });
    if (!run) throw new Error(`Analysis run ${runId} no longer exists`);
    const positions = new Map<number, AnalysisPositionWork>();
    for (const ply of run.importedGame.plies) {
      positions.set(ply.beforePosition.id, ply.beforePosition);
      positions.set(ply.afterPosition.id, ply.afterPosition);
    }
    return [...positions.values()];
  },

  async persistPositionResult(input) {
    return prisma.$transaction(async (tx) => {
      const run = await tx.gameAnalysisRun.findUnique({
        where: { id: input.runId },
        select: { status: true, cancelRequestedAt: true },
      });
      if (!run || run.status !== 'RUNNING' || run.cancelRequestedAt) return false;
      await tx.stockfishPositionAnalysis.upsert({
        where: {
          analysisRunId_positionId: {
            analysisRunId: input.runId,
            positionId: input.positionId,
          },
        },
        create: {
          analysisRunId: input.runId,
          positionId: input.positionId,
          engineName: input.engineName,
          engineVersion: input.engineVersion,
          settingsHash: input.settingsHash,
          depth: input.analysis.depth,
          scoreCp: input.analysis.scoreCp,
          mateIn: input.analysis.mateIn,
          bestMove: input.analysis.bestMove,
          bestPv: input.analysis.bestPv,
          multiPvJson: input.analysis.multiPv as unknown as Prisma.InputJsonValue,
          rawInfoJson: input.analysis.rawInfo as unknown as Prisma.InputJsonValue,
        },
        update: {
          engineName: input.engineName,
          engineVersion: input.engineVersion,
          settingsHash: input.settingsHash,
          depth: input.analysis.depth,
          scoreCp: input.analysis.scoreCp,
          mateIn: input.analysis.mateIn,
          bestMove: input.analysis.bestMove,
          bestPv: input.analysis.bestPv,
          multiPvJson: input.analysis.multiPv as unknown as Prisma.InputJsonValue,
          rawInfoJson: input.analysis.rawInfo as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.gameAnalysisRun.update({ where: { id: input.runId }, data: { heartbeatAt: new Date() } });
      return true;
    });
  },

  async markSucceeded(runId) {
    await prisma.gameAnalysisRun.updateMany({
      where: { id: runId, status: 'RUNNING', cancelRequestedAt: null },
      data: { status: 'SUCCEEDED', completedAt: new Date(), heartbeatAt: new Date(), workerId: null },
    });
  },

  async markFailure(run, error) {
    const terminal = run.attempts >= run.maxAttempts;
    await prisma.gameAnalysisRun.updateMany({
      where: { id: run.id, status: 'RUNNING' },
      data: terminal
        ? { status: 'FAILED', error, completedAt: new Date(), workerId: null }
        : {
            status: 'RETRY_WAIT',
            error,
            runAfter: new Date(Date.now() + retryDelayMs(run.attempts)),
            claimedAt: null,
            heartbeatAt: null,
            workerId: null,
          },
    });
  },

  async requestReanalysis(input) {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.gameAnalysisRun.updateMany({
        where: { importedGameId: input.importedGameId, status: { in: [...ACTIVE_STATUSES] } },
        data: { status: 'SUPERSEDED', cancelRequestedAt: now, completedAt: now, workerId: null },
      });
      const run = await createRun(tx, input);
      return run.id;
    });
  },
};
