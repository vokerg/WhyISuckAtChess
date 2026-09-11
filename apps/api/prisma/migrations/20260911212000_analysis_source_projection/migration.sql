-- Tie every new game-analysis run to the exact published ply projection it analyses.
-- Existing runs predate this provenance token, so their source projection cannot be proven.
-- Leave terminal legacy rows with NULL provenance so consumers ignore them and the current
-- projection becomes eligible for one safe re-analysis.
ALTER TABLE "GameAnalysisRun"
ADD COLUMN "sourcePlyIndexedAt" TIMESTAMP(3);

-- A legacy active run cannot safely continue after this migration because its source
-- projection is unknown. Supersede it rather than allowing it to block current work.
UPDATE "GameAnalysisRun"
SET
    "status" = 'SUPERSEDED',
    "coverageStatus" = 'INCOMPLETE',
    "cancelRequestedAt" = CURRENT_TIMESTAMP,
    "completedAt" = CURRENT_TIMESTAMP,
    "workerId" = NULL,
    "claimToken" = NULL
WHERE "status" IN ('QUEUED', 'RUNNING', 'RETRY_WAIT');

DROP INDEX IF EXISTS "GameAnalysisRun_importedGameId_analysisVersion_settingsHash_idx";

CREATE INDEX "GameAnalysisRun_source_snapshot_idx"
ON "GameAnalysisRun"("importedGameId", "analysisVersion", "settingsHash", "sourcePlyIndexedAt");
