-- CreateTable
CREATE TABLE "ImportedGame" (
    "id" SERIAL NOT NULL,
    "appUserId" INTEGER NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "providerGameId" VARCHAR(128) NOT NULL,
    "providerUrl" TEXT,
    "source" VARCHAR(64) NOT NULL DEFAULT 'LICHESS_API',
    "connectedLichessUserId" VARCHAR(64) NOT NULL,
    "connectedLichessUsername" VARCHAR(64) NOT NULL,
    "pgn" TEXT,
    "rated" BOOLEAN,
    "variant" VARCHAR(32),
    "speedCategory" VARCHAR(32),
    "performanceCategory" VARCHAR(32),
    "timeControlRaw" TEXT,
    "timeControlInitial" INTEGER,
    "timeControlIncrement" INTEGER,
    "timeControlSource" VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN',
    "exactTimeControlKey" VARCHAR(128),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "whiteUsername" TEXT,
    "blackUsername" TEXT,
    "whiteRating" INTEGER,
    "blackRating" INTEGER,
    "userColor" VARCHAR(8),
    "opponentUsername" TEXT,
    "result" VARCHAR(16),
    "resultForUser" VARCHAR(16),
    "status" VARCHAR(32),
    "openingName" TEXT,
    "openingEco" VARCHAR(16),
    "rawClockPresence" VARCHAR(16) NOT NULL DEFAULT 'ABSENT',
    "rawClockStateCount" INTEGER NOT NULL DEFAULT 0,
    "rawClockUnit" VARCHAR(24) NOT NULL DEFAULT 'CENTISECONDS',
    "rawClockAnomalies" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportedGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LichessClockState" (
    "id" SERIAL NOT NULL,
    "importedGameId" INTEGER NOT NULL,
    "provider" VARCHAR(32) NOT NULL DEFAULT 'LICHESS',
    "sourceOrdinal" INTEGER NOT NULL,
    "valueCentiseconds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LichessClockState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" SERIAL NOT NULL,
    "appUserId" INTEGER NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "mode" VARCHAR(32) NOT NULL DEFAULT 'BOUNDED_INITIAL',
    "source" VARCHAR(64) NOT NULL DEFAULT 'LICHESS_API',
    "status" VARCHAR(24) NOT NULL DEFAULT 'QUEUED',
    "scopeVersion" INTEGER NOT NULL DEFAULT 1,
    "scopeHash" VARCHAR(64) NOT NULL,
    "scopeJson" JSONB NOT NULL,
    "requestedFrom" TIMESTAMP(3) NOT NULL,
    "requestedTo" TIMESTAMP(3) NOT NULL,
    "lichessUserIdSnapshot" VARCHAR(64) NOT NULL,
    "lichessUsernameSnapshot" VARCHAR(64) NOT NULL,
    "checkpointJson" JSONB,
    "windowsTotal" INTEGER NOT NULL DEFAULT 0,
    "windowsCompleted" INTEGER NOT NULL DEFAULT 0,
    "gamesSeen" INTEGER NOT NULL DEFAULT 0,
    "gamesMatchedScope" INTEGER NOT NULL DEFAULT 0,
    "gamesImported" INTEGER NOT NULL DEFAULT 0,
    "gamesDuplicate" INTEGER NOT NULL DEFAULT 0,
    "gamesUpdated" INTEGER NOT NULL DEFAULT 0,
    "gamesSkipped" INTEGER NOT NULL DEFAULT 0,
    "gamesSkippedOutOfScope" INTEGER NOT NULL DEFAULT 0,
    "gamesFailed" INTEGER NOT NULL DEFAULT 0,
    "lastProgressAt" TIMESTAMP(3),
    "workKey" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "rateLimitUntil" TIMESTAMP(3),
    "errorCode" VARCHAR(64),
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountImportCoverage" (
    "id" SERIAL NOT NULL,
    "appUserId" INTEGER NOT NULL,
    "scopeVersion" INTEGER NOT NULL,
    "scopeHash" VARCHAR(64) NOT NULL,
    "scopeJson" JSONB NOT NULL,
    "coveredFrom" TIMESTAMP(3),
    "coveredThrough" TIMESTAMP(3),
    "lastCompletedImportRunId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountImportCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportedGame_appUserId_startedAt_idx" ON "ImportedGame"("appUserId", "startedAt");

-- CreateIndex
CREATE INDEX "ImportedGame_appUserId_provider_connectedLichessUserId_idx" ON "ImportedGame"("appUserId", "provider", "connectedLichessUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedGame_appUserId_provider_providerGameId_key" ON "ImportedGame"("appUserId", "provider", "providerGameId");

-- CreateIndex
CREATE INDEX "LichessClockState_importedGameId_sourceOrdinal_idx" ON "LichessClockState"("importedGameId", "sourceOrdinal");

-- CreateIndex
CREATE UNIQUE INDEX "LichessClockState_importedGameId_sourceOrdinal_key" ON "LichessClockState"("importedGameId", "sourceOrdinal");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRun_workKey_key" ON "ImportRun"("workKey");

-- CreateIndex
CREATE INDEX "ImportRun_appUserId_status_createdAt_idx" ON "ImportRun"("appUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ImportRun_status_heartbeatAt_idx" ON "ImportRun"("status", "heartbeatAt");

-- CreateIndex
CREATE INDEX "AccountImportCoverage_appUserId_coveredThrough_idx" ON "AccountImportCoverage"("appUserId", "coveredThrough");

-- CreateIndex
CREATE UNIQUE INDEX "AccountImportCoverage_appUserId_scopeHash_key" ON "AccountImportCoverage"("appUserId", "scopeHash");

-- AddForeignKey
ALTER TABLE "ImportedGame" ADD CONSTRAINT "ImportedGame_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LichessClockState" ADD CONSTRAINT "LichessClockState_importedGameId_fkey" FOREIGN KEY ("importedGameId") REFERENCES "ImportedGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountImportCoverage" ADD CONSTRAINT "AccountImportCoverage_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
