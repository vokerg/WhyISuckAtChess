import { MoveClassificationCode } from '@why-i-suck-at-chess/chess-domain';
import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import {
  OPPONENT_STRENGTH_EFFECT_MAX_CANDIDATE_GAMES,
  type OpponentStrengthEffectRepository,
  type OpponentStrengthEffectScope,
  type OpponentStrengthEffectSourceGame,
} from './opponent-strength-effect.service';

function buildWhere(
  appUserId: number,
  scope: OpponentStrengthEffectScope,
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
  scope: OpponentStrengthEffectScope,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`game."appUserId" = ${appUserId}`];
  if (scope.from) conditions.push(Prisma.sql`game."startedAt" >= ${scope.from}`);
  if (scope.to) conditions.push(Prisma.sql`game."startedAt" < ${scope.to}`);
  return Prisma.join(conditions, ' AND ');
}

export const prismaOpponentStrengthEffectRepository: OpponentStrengthEffectRepository = {
  async countCandidates(appUserId, scope) {
    return prisma.importedGame.count({
      where: buildWhere(appUserId, scope),
    });
  },

  async loadCandidates(appUserId, scope) {
    return prisma.$queryRaw<OpponentStrengthEffectSourceGame[]>(Prisma.sql`
      SELECT
        game."id" AS "importedGameId",
        game."variant" AS "variant",
        game."speedCategory" AS "speedCategory",
        game."exactTimeControlKey" AS "exactTimeControlKey",
        CASE
          WHEN game."userColor" = 'WHITE' THEN game."whiteRating"
          WHEN game."userColor" = 'BLACK' THEN game."blackRating"
          ELSE NULL
        END AS "userRating",
        CASE
          WHEN game."userColor" = 'WHITE' THEN game."blackRating"
          WHEN game."userColor" = 'BLACK' THEN game."whiteRating"
          ELSE NULL
        END AS "opponentRating",
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
        game."userColor",
        game."whiteRating",
        game."blackRating",
        game."resultForUser",
        game."startedAt"
      ORDER BY game."startedAt" ASC NULLS LAST, game."id" ASC
      LIMIT ${OPPONENT_STRENGTH_EFFECT_MAX_CANDIDATE_GAMES + 1}
    `);
  },
};
