-- Durable, reproducible Stockfish snapshots. A snapshot is the freshness boundary;
-- downstream stages must consume one completed run rather than mixing result rows.
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
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workerId" VARCHAR(128),
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

CREATE TABLE "StockfishPositionAnalysis" (
    "id" SERIAL NOT NULL,
    "analysisRunId" INTEGER NOT NULL,
    "positionId" INTEGER NOT NULL,
    "engineName" VARCHAR(128) NOT NULL,
    "engineVersion" VARCHAR(64) NOT NULL,
    "settingsHash" VARCHAR(64) NOT NULL,
    "depth" INTEGER NOT NULL,
    "scoreCp" INTEGER,
    "mateIn" INTEGER,
    "bestMove" VARCHAR(16),
    "bestPv" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "multiPvJson" JSONB NOT NULL,
    "rawInfoJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StockfishPositionAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameAnalysisRun_snapshotId_key" ON "GameAnalysisRun"("snapshotId");
CREATE INDEX "GameAnalysisRun_status_runAfter_idx" ON "GameAnalysisRun"("status", "runAfter");
CREATE INDEX "GameAnalysisRun_importedGameId_status_createdAt_idx" ON "GameAnalysisRun"("importedGameId", "status", "createdAt");
CREATE INDEX "GameAnalysisRun_importedGameId_analysisVersion_settingsHash_idx" ON "GameAnalysisRun"("importedGameId", "analysisVersion", "settingsHash");

-- Prisma cannot express a partial unique index. This is the database-level guard
-- for the default single-active-run workflow.
CREATE UNIQUE INDEX "GameAnalysisRun_one_active_per_game_idx"
ON "GameAnalysisRun"("importedGameId")
WHERE "status" IN ('QUEUED', 'RUNNING', 'RETRY_WAIT');

CREATE UNIQUE INDEX "StockfishPositionAnalysis_analysisRunId_positionId_key"
ON "StockfishPositionAnalysis"("analysisRunId", "positionId");
CREATE INDEX "StockfishPositionAnalysis_positionId_idx" ON "StockfishPositionAnalysis"("positionId");

ALTER TABLE "GameAnalysisRun"
ADD CONSTRAINT "GameAnalysisRun_importedGameId_fkey"
FOREIGN KEY ("importedGameId") REFERENCES "ImportedGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockfishPositionAnalysis"
ADD CONSTRAINT "StockfishPositionAnalysis_analysisRunId_fkey"
FOREIGN KEY ("analysisRunId") REFERENCES "GameAnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockfishPositionAnalysis"
ADD CONSTRAINT "StockfishPositionAnalysis_positionId_fkey"
FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
