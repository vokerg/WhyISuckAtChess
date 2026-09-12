-- Phase 3 deterministic evidence substrate.
-- Evidence runs are immutable historical provenance records. "isCurrent" is only a
-- convenience pointer; consumers must still verify source/index/analysis freshness.

CREATE TABLE "EvidenceRun" (
    "id" SERIAL NOT NULL,
    "importedGameId" INTEGER NOT NULL,
    "detectorKey" VARCHAR(64) NOT NULL,
    "detectorVersion" VARCHAR(64) NOT NULL,
    "workKey" VARCHAR(64) NOT NULL,
    "sourcePlyIndexedAt" TIMESTAMP(3) NOT NULL,
    "sourceAnalysisRunId" INTEGER,
    "sourceAnalysisSnapshotId" VARCHAR(32),
    "status" VARCHAR(24) NOT NULL DEFAULT 'QUEUED',
    "coverageStatus" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    "coverageJson" JSONB,
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
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EvidenceRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvidenceEvent" (
    "id" SERIAL NOT NULL,
    "evidenceKey" VARCHAR(64) NOT NULL,
    "runId" INTEGER NOT NULL,
    "findingKey" VARCHAR(128) NOT NULL,
    "evidenceType" VARCHAR(96) NOT NULL,
    "availability" VARCHAR(24) NOT NULL DEFAULT 'PRESENT',
    "sourcePlyStart" INTEGER,
    "sourcePlyEnd" INTEGER,
    "sourcePositionId" INTEGER,
    "measurementsJson" JSONB NOT NULL,
    "detailsJson" JSONB NOT NULL,
    "unavailableReason" VARCHAR(256),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EvidenceRun_workKey_key"
ON "EvidenceRun"("workKey");

CREATE INDEX "EvidenceRun_status_runAfter_idx"
ON "EvidenceRun"("status", "runAfter");

CREATE INDEX "EvidenceRun_importedGameId_detectorKey_isCurrent_idx"
ON "EvidenceRun"("importedGameId", "detectorKey", "isCurrent");

CREATE INDEX "EvidenceRun_source_projection_idx"
ON "EvidenceRun"("importedGameId", "detectorKey", "detectorVersion", "sourcePlyIndexedAt");

CREATE INDEX "EvidenceRun_sourceAnalysisRunId_idx"
ON "EvidenceRun"("sourceAnalysisRunId");

CREATE UNIQUE INDEX "EvidenceEvent_evidenceKey_key"
ON "EvidenceEvent"("evidenceKey");

CREATE UNIQUE INDEX "EvidenceEvent_runId_findingKey_key"
ON "EvidenceEvent"("runId", "findingKey");

CREATE INDEX "EvidenceEvent_runId_evidenceType_idx"
ON "EvidenceEvent"("runId", "evidenceType");

CREATE INDEX "EvidenceEvent_sourcePositionId_idx"
ON "EvidenceEvent"("sourcePositionId");

ALTER TABLE "EvidenceRun"
ADD CONSTRAINT "EvidenceRun_importedGameId_fkey"
FOREIGN KEY ("importedGameId") REFERENCES "ImportedGame"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EvidenceRun"
ADD CONSTRAINT "EvidenceRun_sourceAnalysisRunId_fkey"
FOREIGN KEY ("sourceAnalysisRunId") REFERENCES "GameAnalysisRun"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EvidenceEvent"
ADD CONSTRAINT "EvidenceEvent_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "EvidenceRun"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EvidenceEvent"
ADD CONSTRAINT "EvidenceEvent_sourcePositionId_fkey"
FOREIGN KEY ("sourcePositionId") REFERENCES "Position"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
