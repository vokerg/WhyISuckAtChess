import { Prisma } from '@prisma/client';
import prisma from '../../prisma';

export { CURRENT_DIAGNOSIS_ANALYSIS, type DiagnosisAnalysisIdentity } from '../engine-analysis/current-analysis-identity';
import { CURRENT_DIAGNOSIS_ANALYSIS, type DiagnosisAnalysisIdentity } from '../engine-analysis/current-analysis-identity';

// Alias contract: aggregate SQL uses game and analysis. The newest attempt for
// the current index/policy supersedes old successful evidence even if it failed.
export function currentDiagnosisAnalysisSql(identity: DiagnosisAnalysisIdentity | null): Prisma.Sql {
  if (!identity) return Prisma.empty;
  return Prisma.sql`AND analysis."analysisVersion" = ${identity.analysisVersion}
    AND analysis."settingsHash" = ${identity.settingsHash}
    AND analysis."id" = (SELECT newest."id" FROM "GameAnalysisRun" newest
      WHERE newest."importedGameId" = game."id" AND newest."sourcePlyIndexedAt" = game."plyIndexedAt"
        AND newest."analysisVersion" = ${identity.analysisVersion} AND newest."settingsHash" = ${identity.settingsHash}
      ORDER BY newest."createdAt" DESC, newest."id" DESC LIMIT 1)`;
}

export async function loadCurrentDiagnosisAnalysisIds(
  database: Pick<typeof prisma, '$queryRaw'>,
  appUserId: number,
  gameIds: readonly number[],
  identity: DiagnosisAnalysisIdentity | null,
): Promise<Map<number, number> | null> {
  if (!identity) return null;
  if (!gameIds.length) return new Map();
  if (gameIds.length > 5001) throw new RangeError('Diagnosis analysis source exceeds candidate bound.');
  const rows = await database.$queryRaw<{ importedGameId: number; id: number }[]>(Prisma.sql`
    SELECT game."id" AS "importedGameId", analysis."id"
    FROM "ImportedGame" game JOIN "GameAnalysisRun" analysis ON analysis."importedGameId" = game."id"
    WHERE game."appUserId" = ${appUserId} AND game."id" IN (${Prisma.join([...gameIds])})
      AND analysis."sourcePlyIndexedAt" = game."plyIndexedAt"
      AND analysis."status" = 'SUCCEEDED' AND analysis."coverageStatus" = 'COMPLETE'
      ${currentDiagnosisAnalysisSql(identity)}
  `);
  return new Map(rows.map((row) => [row.importedGameId, row.id]));
}
