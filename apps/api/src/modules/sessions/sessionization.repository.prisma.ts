import type { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import {
  SESSIONIZATION_MAX_CANDIDATE_GAMES,
  type SessionizationRepository,
  type SessionizationScope,
  type SessionSourceGame,
} from './sessionization.service';

function buildWhere(
  appUserId: number,
  scope: SessionizationScope,
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

async function countCandidates(
  appUserId: number,
  scope: SessionizationScope,
): Promise<number> {
  return prisma.importedGame.count({
    where: buildWhere(appUserId, scope),
  });
}

async function loadCandidates(
  appUserId: number,
  scope: SessionizationScope,
): Promise<SessionSourceGame[]> {
  const rows = await prisma.importedGame.findMany({
    where: buildWhere(appUserId, scope),
    orderBy: [
      { startedAt: { sort: 'asc', nulls: 'last' } },
      { id: 'asc' },
    ],
    take: SESSIONIZATION_MAX_CANDIDATE_GAMES,
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      resultForUser: true,
    },
  });

  return rows.map((row) => ({
    importedGameId: row.id,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    resultForUser: row.resultForUser,
  }));
}

export const prismaSessionizationRepository: SessionizationRepository = {
  countCandidates,
  loadCandidates,
};
