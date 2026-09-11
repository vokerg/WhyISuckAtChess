-- Tie every game-analysis run to the exact published ply projection it analysed.
-- Historical rows are backfilled only when the game's current projection is still known;
-- NULL therefore means legacy/unknown provenance and is never eligible for new worker claims.
ALTER TABLE "GameAnalysisRun"
ADD COLUMN "sourcePlyIndexedAt" TIMESTAMP(3);

UPDATE "GameAnalysisRun" AS run
SET "sourcePlyIndexedAt" = game."plyIndexedAt"
FROM "ImportedGame" AS game
WHERE run."importedGameId" = game."id"
  AND game."plyIndexStatus" = 'INDEXED'
  AND game."plyIndexedAt" IS NOT NULL;

DROP INDEX IF EXISTS "GameAnalysisRun_importedGameId_analysisVersion_settingsHash_idx";

CREATE INDEX "GameAnalysisRun_source_snapshot_idx"
ON "GameAnalysisRun"("importedGameId", "analysisVersion", "settingsHash", "sourcePlyIndexedAt");
