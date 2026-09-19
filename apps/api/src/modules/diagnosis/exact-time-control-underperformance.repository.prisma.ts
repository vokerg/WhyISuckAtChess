import { MoveClassificationCode } from '@why-i-suck-at-chess/chess-domain';
import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import {
  EXACT_TIME_CONTROL_MAX_CANDIDATE_GAMES,
  type ExactTimeControlRepository,
  type ExactTimeControlScope,
  type ExactTimeControlSourceGame,
} from './exact-time-control-underperformance.service';

function buildWhere(
  appUserId: number,
  scope: ExactTimeControlScope,
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

function queryConditions(
  appUserId: number,
  scope: ExactTimeControlScope,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`game."appUserId" = ${appUserId}`];
  if (scope.from) conditions.push(Prisma.sql`game."startedAt" >= ${scope.from}`);
  if (scope.to) conditions.push(Prisma.sql`game."startedAt" < ${scope.to}`);
  return Prisma.join(conditions, ' AND ');
}

export const prismaExactTimeControlRepository: ExactTimeControlRepository = {
  async countCandidates(appUserId, scope) {
    return prisma.importedGame.count({
      where: buildWhere(appUserId, scope),
    });
  },

  async loadCandidates(appUserId, scope) {
    return prisma.$queryRaw<ExactTimeControlSourceGame[]>(Prisma.sql`
      SELECT
        game."id" AS "importedGameId",
        game."variant" AS "variant",
        game."speedCategory" AS "speedCategory",
        game."exactTimeControlKey" AS "exactTimeControlKey",
        game."timeControlInitial" AS "timeControlInitial",
        game."timeControlIncrement" AS "timeControlIncrement",
        game."resultForUser" AS "resultForUser",
        COUNT(*) FILTER (
          WHERE analysis."id" IS NOT NULL
            AND ply."scoreLossCp" IS NOT NULL
            AND ply."scoreLossCp" >= 0
        )::int AS "analysedUserMoves",
        (
          SUM(ply."scoreLossCp") FILTER (
            WHERE analysis."id" IS NOT NULL
              AND ply."scoreLossCp" IS NOT NULL
              AND ply."scoreLossCp" >= 0
          )
        )::double precision AS "scoreLossTotalCp",
        COUNT(*) FILTER (
          WHERE analysis."id" IS NOT NULL
            AND ply."scoreLossCp" IS NOT NULL
            AND ply."scoreLossCp" >= 0
            AND ply."classificationCode" IN (
              ${MoveClassificationCode.Mistake},
              ${MoveClassificationCode.Blunder}
            )
        )::int AS "majorErrorMoves",
        COUNT(*) FILTER (
          WHERE analysis."id" IS NOT NULL
            AND ply."scoreLossCp" IS NOT NULL
            AND ply."scoreLossCp" >= 0
            AND ply."classificationCode" = ${MoveClassificationCode.Blunder}
        )::int AS "blunderMoves"
      FROM "ImportedGame" AS game
      LEFT JOIN "ImportedGamePly" AS ply
        ON ply."importedGameId" = game."id"
       AND ply."isUserMove" = TRUE
      LEFT JOIN "GameAnalysisRun" AS analysis
        ON analysis."id" = ply."engineAnalysisRunId"
       AND analysis."importedGameId" = game."id"
       AND game."plyIndexStatus" = 'INDEXED'
       AND game."plyIndexedAt" IS NOT NULL
       AND analysis."status" = 'SUCCEEDED'
       AND analysis."coverageStatus" = 'COMPLETE'
       AND analysis."sourcePlyIndexedAt" = game."plyIndexedAt"
      WHERE ${queryConditions(appUserId, scope)}
      GROUP BY
        game."id",
        game."variant",
        game."speedCategory",
        game."exactTimeControlKey",
        game."timeControlInitial",
        game."timeControlIncrement",
        game."resultForUser",
        game."startedAt"
      ORDER BY game."startedAt" ASC NULLS LAST, game."id" ASC
      LIMIT ${EXACT_TIME_CONTROL_MAX_CANDIDATE_GAMES + 1}
    `);
  },
};
