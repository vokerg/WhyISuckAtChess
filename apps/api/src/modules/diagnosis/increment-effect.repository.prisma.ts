import type { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import {
  INCREMENT_EFFECT_MAX_CANDIDATE_GAMES,
  type IncrementEffectAnalysisRun,
  type IncrementEffectRepository,
  type IncrementEffectScope,
  type IncrementEffectSourceGame,
} from './increment-effect.service';

function buildWhere(
  appUserId: number,
  scope: IncrementEffectScope,
): Prisma.ImportedGameWhereInput {
  const startedAt = {
    ...(scope.from ? { gte: scope.from } : {}),
    ...(scope.to ? { lt: scope.to } : {}),
  };

  return {
    appUserId,
    ...(scope.from || scope.to ? { startedAt } : {}),
  };
}

function currentCompleteAnalysis(
  plyIndexedAt: Date | null,
  plyIndexStatus: string,
  run: {
    id: number;
    snapshotId: string;
    analysisVersion: string;
    settingsHash: string;
    sourcePlyIndexedAt: Date | null;
    engineName: string | null;
    engineVersion: string | null;
    status: string;
    coverageStatus: string;
  } | null,
): IncrementEffectAnalysisRun | null {
  if (
    !run
    || plyIndexStatus !== 'INDEXED'
    || !plyIndexedAt
    || run.status !== 'SUCCEEDED'
    || run.coverageStatus !== 'COMPLETE'
    || !run.sourcePlyIndexedAt
    || run.sourcePlyIndexedAt.getTime() !== plyIndexedAt.getTime()
  ) {
    return null;
  }

  return {
    runId: run.id,
    snapshotId: run.snapshotId,
    analysisVersion: run.analysisVersion,
    settingsHash: run.settingsHash,
    engineName: run.engineName,
    engineVersion: run.engineVersion,
  };
}

export const prismaIncrementEffectRepository: IncrementEffectRepository = {
  async countCandidates(appUserId, scope) {
    return prisma.importedGame.count({
      where: buildWhere(appUserId, scope),
    });
  },

  async loadCandidates(appUserId, scope) {
    const rows = await prisma.importedGame.findMany({
      where: buildWhere(appUserId, scope),
      orderBy: [
        { startedAt: { sort: 'asc', nulls: 'last' } },
        { id: 'asc' },
      ],
      take: INCREMENT_EFFECT_MAX_CANDIDATE_GAMES + 1,
      select: {
        id: true,
        variant: true,
        speedCategory: true,
        exactTimeControlKey: true,
        timeControlInitial: true,
        timeControlIncrement: true,
        resultForUser: true,
        timingDerivationVersion: true,
        plyIndexStatus: true,
        plyIndexedAt: true,
        plies: {
          where: { isUserMove: true },
          orderBy: { plyNumber: 'asc' },
          select: {
            plyNumber: true,
            clockBeforeMoveCentiseconds: true,
            timingDerivationVersion: true,
            timingDerivationStatus: true,
            timingReliabilityFlags: true,
            scoreLossCp: true,
            classificationCode: true,
            engineAnalysisRun: {
              select: {
                id: true,
                snapshotId: true,
                analysisVersion: true,
                settingsHash: true,
                sourcePlyIndexedAt: true,
                engineName: true,
                engineVersion: true,
                status: true,
                coverageStatus: true,
              },
            },
          },
        },
      },
    });

    return rows.map<IncrementEffectSourceGame>((row) => ({
      importedGameId: row.id,
      variant: row.variant,
      speedCategory: row.speedCategory,
      exactTimeControlKey: row.exactTimeControlKey,
      timeControlInitial: row.timeControlInitial,
      timeControlIncrement: row.timeControlIncrement,
      resultForUser: row.resultForUser,
      timingDerivationVersion: row.timingDerivationVersion,
      userMoves: row.plies.map((ply) => ({
        plyNumber: ply.plyNumber,
        clockBeforeMoveCentiseconds: ply.clockBeforeMoveCentiseconds,
        timingDerivationVersion: ply.timingDerivationVersion,
        timingDerivationStatus: ply.timingDerivationStatus,
        timingReliabilityFlags: ply.timingReliabilityFlags,
        phase: null,
        scoreLossCp: ply.scoreLossCp,
        classificationCode: ply.classificationCode,
        analysis: currentCompleteAnalysis(
          row.plyIndexedAt,
          row.plyIndexStatus,
          ply.engineAnalysisRun,
        ),
      })),
    }));
  },
};
