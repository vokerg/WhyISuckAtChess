import { CURRENT_DIAGNOSIS_ANALYSIS, currentDiagnosisAnalysisSql, type DiagnosisAnalysisIdentity } from './diagnosis-analysis-source';
import { MoveClassificationCode } from '@why-i-suck-at-chess/chess-domain';
import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import type {
  SessionGameQualityRepository,
  SessionGameQuality,
} from './session-deterioration.service';

export function createPrismaSessionDeteriorationRepository(database: typeof prisma = prisma, identity: DiagnosisAnalysisIdentity | null = CURRENT_DIAGNOSIS_ANALYSIS): SessionGameQualityRepository {
  return {
  async loadGameQuality(appUserId, importedGameIds) {
    if (importedGameIds.length === 0) return [];

    return database.$queryRaw<SessionGameQuality[]>(Prisma.sql`
      SELECT
        game."id" AS "importedGameId",
        game."exactTimeControlKey" AS "exactTimeControlKey",
        COUNT(*) FILTER (
          WHERE analysis."id" IS NOT NULL
            AND ply."scoreLossCp" IS NOT NULL
        )::int AS "analysedUserMoves",
        (
          AVG(ply."scoreLossCp") FILTER (
            WHERE analysis."id" IS NOT NULL
              AND ply."scoreLossCp" IS NOT NULL
          )
        )::double precision AS "averageScoreLossCp",
        COUNT(*) FILTER (
          WHERE analysis."id" IS NOT NULL
            AND ply."scoreLossCp" IS NOT NULL
            AND ply."classificationCode" IN (
              ${MoveClassificationCode.Mistake},
              ${MoveClassificationCode.Blunder}
            )
        )::int AS "majorErrorMoves",
        COUNT(*) FILTER (
          WHERE analysis."id" IS NOT NULL
            AND ply."scoreLossCp" IS NOT NULL
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
       AND analysis."status" = 'SUCCEEDED'
       AND analysis."coverageStatus" = 'COMPLETE'
       AND analysis."sourcePlyIndexedAt" = game."plyIndexedAt"
       ${currentDiagnosisAnalysisSql(identity)}
      WHERE game."appUserId" = ${appUserId}
        AND game."id" IN (${Prisma.join([...importedGameIds])})
      GROUP BY game."id", game."exactTimeControlKey"
      ORDER BY game."id" ASC
    `);
  },
};
}

export const prismaSessionDeteriorationRepository = createPrismaSessionDeteriorationRepository();
