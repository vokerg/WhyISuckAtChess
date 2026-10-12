import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import { evidenceDetectors } from '../evidence/evidence.registry';
import { diagnosisMaterializationVersions } from './diagnosis-materialization.versions';

export interface DiagnosisSourceSnapshot {
  key: string;
  games: number;
  imports: number;
  pending: boolean;
  latestChange: Date | null;
}

// All accepted ingestion/index/analysis/evidence mutations advance updatedAt.
// Sum per-row hashes (rather than just MAX(updatedAt)) detects changes to any
// owned row, including deletion. The database returns four compact aggregates.
export async function loadDiagnosisSourceSnapshot(
  appUserId: number,
  database: Pick<typeof prisma, '$queryRaw'> = prisma,
): Promise<DiagnosisSourceSnapshot> {
  const rows = await database.$queryRaw<{
    kind: string; count: bigint; checksum: string; latest: Date | null; pending: boolean;
  }[]>(Prisma.sql`
    WITH owned_games AS (SELECT "id", "updatedAt", "plyIndexStatus", "plyIndexedAt" FROM "ImportedGame" WHERE "appUserId" = ${appUserId}),
    sources AS (
      SELECT 'games' AS kind, "id", "updatedAt", "plyIndexStatus" IN ('PENDING','INDEXING') AS pending FROM owned_games
      UNION ALL SELECT 'imports', "id", "updatedAt", "status" IN ('QUEUED','RUNNING','RETRY_WAIT','CANCEL_REQUESTED') FROM "ImportRun" WHERE "appUserId" = ${appUserId}
      UNION ALL SELECT 'analysis', r."id", r."updatedAt", r."status" IN ('QUEUED','RUNNING','RETRY_WAIT','CANCEL_REQUESTED')
        AND r."sourcePlyIndexedAt" = g."plyIndexedAt"
        AND EXISTS (SELECT 1 FROM "ImportedGamePly" p WHERE p."importedGameId" = g."id")
        AND r."analysisVersion" = ${String(diagnosisMaterializationVersions.policyVersions.analysis)}
        AND r."settingsHash" = ${String(diagnosisMaterializationVersions.policyVersions.settings)}
        AND r."id" = (SELECT latest."id" FROM "GameAnalysisRun" latest WHERE latest."importedGameId" = g."id"
          AND latest."sourcePlyIndexedAt" = g."plyIndexedAt" AND latest."analysisVersion" = r."analysisVersion" AND latest."settingsHash" = r."settingsHash"
          ORDER BY latest."createdAt" DESC, latest."id" DESC LIMIT 1)
        FROM "GameAnalysisRun" r JOIN owned_games g ON g."id" = r."importedGameId"
      UNION ALL SELECT 'evidence', r."id", r."updatedAt", r."status" IN ('QUEUED','RUNNING','RETRY_WAIT','CANCEL_REQUESTED')
        AND r."sourcePlyIndexedAt" = g."plyIndexedAt"
        AND EXISTS (SELECT 1 FROM "ImportedGamePly" p WHERE p."importedGameId" = g."id")
        AND EXISTS (SELECT 1 FROM jsonb_to_recordset(${JSON.stringify(evidenceDetectors.map((d) => ({ key:d.key,version:d.version, needsAnalysis:d.requiresCompleteAnalysis, refresh:d.refreshOnCompleteAnalysis === true })))}::jsonb) AS d(key text, version text, "needsAnalysis" boolean, refresh boolean)
          WHERE d.key = r."detectorKey" AND d.version = r."detectorVersion"
            AND (NOT (d."needsAnalysis" OR d.refresh)
              OR r."sourceAnalysisRunId" IS NOT DISTINCT FROM (SELECT CASE WHEN latest."status" = 'SUCCEEDED' AND latest."coverageStatus" = 'COMPLETE' THEN latest."id" END
                FROM "GameAnalysisRun" latest WHERE latest."importedGameId" = g."id" AND latest."sourcePlyIndexedAt" = g."plyIndexedAt"
                  AND latest."analysisVersion" = ${String(diagnosisMaterializationVersions.policyVersions.analysis)}
                  AND latest."settingsHash" = ${String(diagnosisMaterializationVersions.policyVersions.settings)}
                ORDER BY latest."createdAt" DESC, latest."id" DESC LIMIT 1)))
        FROM "EvidenceRun" r JOIN owned_games g ON g."id" = r."importedGameId"
    )
    SELECT kind, COUNT(*) AS count,
      COALESCE(SUM(hashtextextended("id"::text || ':' || "updatedAt"::text, 0)::numeric), 0)::text AS checksum,
      MAX("updatedAt") AS latest, COALESCE(BOOL_OR(pending), false) AS pending
    FROM sources GROUP BY kind ORDER BY kind
  `);
  // A quiet queue is insufficient: enqueueEligibleGame/detector scheduling
  // is incremental. Fence source rows still waiting to be scheduled as well.
  const [readiness] = await database.$queryRaw<{ pending: boolean }[]>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1 FROM "ImportedGame" g
      WHERE g."appUserId" = ${appUserId} AND g."plyIndexStatus" = 'INDEXED'
        AND (g."variant" IS NULL OR g."variant" IN ('standard','chess')) AND g."speedCategory" IN ('bullet','blitz','rapid')
        AND EXISTS (SELECT 1 FROM "ImportedGamePly" p WHERE p."importedGameId" = g."id")
        AND (
          NOT EXISTS (SELECT 1 FROM "GameAnalysisRun" a WHERE a."importedGameId" = g."id"
            AND a."sourcePlyIndexedAt" = g."plyIndexedAt"
            AND a."analysisVersion" = ${String(diagnosisMaterializationVersions.policyVersions.analysis)}
            AND a."settingsHash" = ${String(diagnosisMaterializationVersions.policyVersions.settings)}
            AND a."status" IN ('SUCCEEDED','FAILED','CANCELLED')
            AND a."id" = (SELECT latest."id" FROM "GameAnalysisRun" latest WHERE latest."importedGameId" = g."id"
              AND latest."sourcePlyIndexedAt" = g."plyIndexedAt" AND latest."analysisVersion" = a."analysisVersion" AND latest."settingsHash" = a."settingsHash"
              ORDER BY latest."createdAt" DESC, latest."id" DESC LIMIT 1))
          OR EXISTS (
            SELECT 1 FROM jsonb_to_recordset(${JSON.stringify(evidenceDetectors.map((d) => ({ key: d.key, version: d.version, needsAnalysis: d.requiresCompleteAnalysis, refresh: d.refreshOnCompleteAnalysis === true })))}::jsonb)
              AS d(key text, version text, "needsAnalysis" boolean, refresh boolean)
            WHERE (NOT d."needsAnalysis" OR EXISTS (SELECT 1 FROM "GameAnalysisRun" a
              WHERE a."importedGameId" = g."id" AND a."sourcePlyIndexedAt" = g."plyIndexedAt"
                AND a."analysisVersion" = ${String(diagnosisMaterializationVersions.policyVersions.analysis)}
                AND a."settingsHash" = ${String(diagnosisMaterializationVersions.policyVersions.settings)}
                AND a."status" = 'SUCCEEDED' AND a."coverageStatus" = 'COMPLETE'
                AND a."id" = (SELECT latest."id" FROM "GameAnalysisRun" latest WHERE latest."importedGameId" = g."id"
                  AND latest."sourcePlyIndexedAt" = g."plyIndexedAt" AND latest."analysisVersion" = a."analysisVersion" AND latest."settingsHash" = a."settingsHash"
                  ORDER BY latest."createdAt" DESC, latest."id" DESC LIMIT 1)))
              AND NOT EXISTS (SELECT 1 FROM "EvidenceRun" e WHERE e."importedGameId" = g."id"
                AND e."sourcePlyIndexedAt" = g."plyIndexedAt" AND e."detectorKey" = d.key AND e."detectorVersion" = d.version
                AND e."status" IN ('SUCCEEDED','FAILED','CANCELLED')
                AND (NOT (d."needsAnalysis" OR d.refresh)
                  OR e."sourceAnalysisRunId" IS NOT DISTINCT FROM (SELECT CASE WHEN a."status" = 'SUCCEEDED' AND a."coverageStatus" = 'COMPLETE' THEN a."id" END FROM "GameAnalysisRun" a
                    WHERE a."importedGameId" = g."id" AND a."sourcePlyIndexedAt" = g."plyIndexedAt"
                      AND a."analysisVersion" = ${String(diagnosisMaterializationVersions.policyVersions.analysis)}
                      AND a."settingsHash" = ${String(diagnosisMaterializationVersions.policyVersions.settings)}
                      ORDER BY a."createdAt" DESC, a."id" DESC LIMIT 1)))
          )
        )
    ) AS pending
  `);
  return {
    key: createHash('sha256').update(JSON.stringify({
      versions: diagnosisMaterializationVersions,
      readiness,
      rows: rows.map((row) => ({ ...row, count: row.count.toString() })),
    })).digest('hex'),
    imports: Number(rows.find((row) => row.kind === 'imports')?.count ?? 0),
    games: Number(rows.find((row) => row.kind === 'games')?.count ?? 0),
    pending: readiness.pending || rows.some((row) => row.pending),
    latestChange: rows.reduce<Date | null>((latest, row) =>
      row.latest && (!latest || row.latest > latest) ? row.latest : latest, null),
  };
}
