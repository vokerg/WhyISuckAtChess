-- Durable, reproducible whole-game analysis runs. Downstream consumers only treat
-- a completed run with COMPLETE coverage as authoritative game-specific evidence.
CREATE TABLE "GameAnalysisRun" (
    "id" SERIAL NOT NULL,
    "importedGameId" INTEGER NOT NULL,
    "snapshotId" VARCHAR(32) NOT NULL,
    "analysisVersion" VARCHAR(64) NOT NULL,
    "settingsHash" VARCHAR(64) NOT NULL,
    "settingsJson" JSONB NOT NULL,
    "engineName" VARCHAR(128),
    "engineVersion" VARCHAR(64),
    "status" VARCHAR(24) NOT NULL DEFAULT 'QUEUED',
    "coverageStatus" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    "positionsTotal" INTEGER NOT NULL DEFAULT 0,
    "positionsDone" INTEGER NOT NULL DEFAULT 0,
    "pliesTotal" INTEGER NOT NULL DEFAULT 0,
    "pliesDone" INTEGER NOT NULL DEFAULT 0,
    "cacheHits" INTEGER NOT NULL DEFAULT 0,
    "cacheMisses" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workerId" VARCHAR(128),
    "claimToken" VARCHAR(64),
    "claimedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GameAnalysisRun_pkey" PRIMARY KEY ("id")
);

-- Reusable immutable position evidence. Game runs reference this evidence by the
-- same position + policy/config + engine provenance tuple rather than owning copies.
CREATE TABLE "StockfishPositionAnalysis" (
    "id" SERIAL NOT NULL,
    "positionId" INTEGER NOT NULL,
    "analysisVersion" VARCHAR(64) NOT NULL,
    "engineName" VARCHAR(128) NOT NULL,
    "engineVersion" VARCHAR(64) NOT NULL,
    "settingsHash" VARCHAR(64) NOT NULL,
    "depth" INTEGER NOT NULL,
    "scoreCpWhite" INTEGER,
    "mateWhite" INTEGER,
    "bestMove" VARCHAR(16),
    "bestPv" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "multiPvJson" JSONB NOT NULL,
    "rawInfoJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockfishPositionAnalysis_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ImportedGamePly"
ADD COLUMN "engineAnalysisRunId" INTEGER,
ADD COLUMN "scoreLossCp" INTEGER,
ADD COLUMN "classificationCode" INTEGER;

CREATE UNIQUE INDEX "GameAnalysisRun_snapshotId_key" ON "GameAnalysisRun"("snapshotId");
CREATE INDEX "GameAnalysisRun_status_runAfter_idx" ON "GameAnalysisRun"("status", "runAfter");
CREATE INDEX "GameAnalysisRun_importedGameId_status_createdAt_idx" ON "GameAnalysisRun"("importedGameId", "status", "createdAt");
CREATE INDEX "GameAnalysisRun_importedGameId_analysisVersion_settingsHash_idx" ON "GameAnalysisRun"("importedGameId", "analysisVersion", "settingsHash");

-- Prisma cannot express this partial unique index. It is the database-level guard
-- for the default single-active-run workflow.
CREATE UNIQUE INDEX "GameAnalysisRun_one_active_per_game_idx"
ON "GameAnalysisRun"("importedGameId")
WHERE "status" IN ('QUEUED', 'RUNNING', 'RETRY_WAIT');

CREATE UNIQUE INDEX "StockfishPositionAnalysis_cache_key"
ON "StockfishPositionAnalysis"("positionId", "analysisVersion", "settingsHash", "engineName", "engineVersion");
CREATE INDEX "StockfishPositionAnalysis_provenance_idx"
ON "StockfishPositionAnalysis"("analysisVersion", "settingsHash", "engineName", "engineVersion");
CREATE INDEX "ImportedGamePly_engineAnalysisRunId_idx" ON "ImportedGamePly"("engineAnalysisRunId");

ALTER TABLE "GameAnalysisRun"
ADD CONSTRAINT "GameAnalysisRun_importedGameId_fkey"
FOREIGN KEY ("importedGameId") REFERENCES "ImportedGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockfishPositionAnalysis"
ADD CONSTRAINT "StockfishPositionAnalysis_positionId_fkey"
FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ImportedGamePly"
ADD CONSTRAINT "ImportedGamePly_engineAnalysisRunId_fkey"
FOREIGN KEY ("engineAnalysisRunId") REFERENCES "GameAnalysisRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
