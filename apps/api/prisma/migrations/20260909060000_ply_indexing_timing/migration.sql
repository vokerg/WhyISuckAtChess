-- Add indexing/timing publication state to imported games.
ALTER TABLE "ImportedGame"
  ADD COLUMN "plyIndexStatus" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "plyIndexPolicyVersion" INTEGER,
  ADD COLUMN "plyIndexedAt" TIMESTAMP(3),
  ADD COLUMN "plyIndexError" TEXT,
  ADD COLUMN "indexedRawClockStateCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "clockAlignmentStatus" VARCHAR(24) NOT NULL DEFAULT 'UNAVAILABLE',
  ADD COLUMN "clockAlignmentVersion" INTEGER,
  ADD COLUMN "alignedClockPlyCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "timingDerivationVersion" INTEGER,
  ADD COLUMN "derivedTimingPlyCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "timingCoverageStatus" VARCHAR(24) NOT NULL DEFAULT 'UNAVAILABLE';

CREATE INDEX "ImportedGame_plyIndexStatus_updatedAt_idx"
  ON "ImportedGame"("plyIndexStatus", "updatedAt");

CREATE TABLE "Position" (
  "id" SERIAL NOT NULL,
  "positionKey" BYTEA NOT NULL,
  "normalizedFen" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Position_positionKey_key" ON "Position"("positionKey");
CREATE UNIQUE INDEX "Position_normalizedFen_key" ON "Position"("normalizedFen");

CREATE TABLE "ImportedGamePly" (
  "importedGameId" INTEGER NOT NULL,
  "plyNumber" INTEGER NOT NULL,
  "beforePositionId" INTEGER NOT NULL,
  "afterPositionId" INTEGER NOT NULL,
  "moveUci" VARCHAR(16) NOT NULL,
  "moverColor" VARCHAR(8) NOT NULL,
  "isUserMove" BOOLEAN NOT NULL,
  "sourceClockOrdinal" INTEGER,
  "sourceClockAfterCentiseconds" INTEGER,
  "sourceClockSemantics" VARCHAR(40),
  "clockAlignmentVersion" INTEGER,
  "clockBeforeMoveCentiseconds" INTEGER,
  "effectiveIncrementCentiseconds" INTEGER,
  "clockDeltaMoveTimeCentiseconds" INTEGER,
  "beforeClockProvenance" VARCHAR(40) NOT NULL DEFAULT 'UNAVAILABLE',
  "incrementProvenance" VARCHAR(40) NOT NULL DEFAULT 'UNAVAILABLE',
  "timingDerivationVersion" INTEGER,
  "timingDerivationStatus" VARCHAR(24) NOT NULL DEFAULT 'UNAVAILABLE',
  "timingReliabilityFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "timingUnavailableReason" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportedGamePly_pkey" PRIMARY KEY ("importedGameId", "plyNumber")
);

CREATE INDEX "ImportedGamePly_beforePositionId_idx" ON "ImportedGamePly"("beforePositionId");
CREATE INDEX "ImportedGamePly_afterPositionId_idx" ON "ImportedGamePly"("afterPositionId");
CREATE INDEX "ImportedGamePly_importedGameId_timingDerivationStatus_idx"
  ON "ImportedGamePly"("importedGameId", "timingDerivationStatus");

CREATE TABLE "TerminalClockSourceFact" (
  "id" SERIAL NOT NULL,
  "importedGameId" INTEGER NOT NULL,
  "sourceOrdinal" INTEGER NOT NULL,
  "activeColor" VARCHAR(8) NOT NULL,
  "valueCentiseconds" INTEGER NOT NULL,
  "semantics" VARCHAR(48) NOT NULL,
  "alignmentVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TerminalClockSourceFact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TerminalClockSourceFact_importedGameId_sourceOrdinal_key"
  ON "TerminalClockSourceFact"("importedGameId", "sourceOrdinal");
CREATE INDEX "TerminalClockSourceFact_importedGameId_idx"
  ON "TerminalClockSourceFact"("importedGameId");

ALTER TABLE "ImportedGamePly"
  ADD CONSTRAINT "ImportedGamePly_importedGameId_fkey"
  FOREIGN KEY ("importedGameId") REFERENCES "ImportedGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportedGamePly"
  ADD CONSTRAINT "ImportedGamePly_beforePositionId_fkey"
  FOREIGN KEY ("beforePositionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImportedGamePly"
  ADD CONSTRAINT "ImportedGamePly_afterPositionId_fkey"
  FOREIGN KEY ("afterPositionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TerminalClockSourceFact"
  ADD CONSTRAINT "TerminalClockSourceFact_importedGameId_fkey"
  FOREIGN KEY ("importedGameId") REFERENCES "ImportedGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
