-- Phase 5 canonical diagnostic finding persistence.
-- Finding sets are immutable scope revisions. Recalculation publishes a new current
-- set and supersedes the previous one without mutating authoritative source evidence.

CREATE TABLE "DiagnosisFindingSet" (
    "id" SERIAL NOT NULL,
    "appUserId" INTEGER NOT NULL,
    "materializationKey" VARCHAR(64) NOT NULL,
    "scopeKey" VARCHAR(128) NOT NULL,
    "scopeJson" JSONB NOT NULL,
    "taxonomyVersion" VARCHAR(64) NOT NULL,
    "synthesisPolicyVersion" VARCHAR(64) NOT NULL,
    "calculationVersion" VARCHAR(64) NOT NULL,
    "policyVersionsJson" JSONB NOT NULL,
    "calculationAsOf" TIMESTAMP(3) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DiagnosisFindingSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiagnosisFinding" (
    "id" SERIAL NOT NULL,
    "findingSetId" INTEGER NOT NULL,
    "findingKey" VARCHAR(128) NOT NULL,
    "diagnosisId" VARCHAR(64) NOT NULL,
    "findingLevel" VARCHAR(32) NOT NULL,
    "observationState" VARCHAR(48) NOT NULL,
    "claimKey" VARCHAR(128) NOT NULL,
    "producerKey" VARCHAR(96) NOT NULL,
    "producerVersion" VARCHAR(64) NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "distinctGameCount" INTEGER NOT NULL,
    "distinctSessionCount" INTEGER NOT NULL,
    "requiredEvidenceCoverage" DOUBLE PRECISION,
    "evidenceStrength" VARCHAR(24) NOT NULL,
    "dimensionsJson" JSONB NOT NULL,
    "coverageJson" JSONB NOT NULL,
    "effectMetric" VARCHAR(96),
    "effectValue" DOUBLE PRECISION,
    "effectUnit" VARCHAR(48),
    "effectDirection" VARCHAR(32),
    "comparatorJson" JSONB,
    "sourceVersionsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiagnosisFinding_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiagnosisFinding_nonnegative_counts" CHECK (
      "sampleCount" >= 0 AND "distinctGameCount" >= 0 AND "distinctSessionCount" >= 0
    ),
    CONSTRAINT "DiagnosisFinding_coverage_range" CHECK (
      "requiredEvidenceCoverage" IS NULL
      OR ("requiredEvidenceCoverage" >= 0 AND "requiredEvidenceCoverage" <= 1)
    )
);

CREATE TABLE "DiagnosisFindingEvidenceReference" (
    "id" SERIAL NOT NULL,
    "findingId" INTEGER NOT NULL,
    "referenceKey" VARCHAR(128) NOT NULL,
    "referenceType" VARCHAR(48) NOT NULL,
    "importedGameId" INTEGER,
    "evidenceEventId" INTEGER,
    "sourceAnalysisRunId" INTEGER,
    "sourcePlyStart" INTEGER,
    "sourcePlyEnd" INTEGER,
    "sessionKey" VARCHAR(128),
    "eventIdentityKey" VARCHAR(192),
    "provenanceJson" JSONB NOT NULL,
    "representative" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiagnosisFindingEvidenceReference_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiagnosisFindingEvidenceReference_ply_range" CHECK (
      ("sourcePlyStart" IS NULL AND "sourcePlyEnd" IS NULL)
      OR (
        "sourcePlyStart" IS NOT NULL
        AND "sourcePlyStart" >= 1
        AND ("sourcePlyEnd" IS NULL OR "sourcePlyEnd" >= "sourcePlyStart")
      )
    )
);

CREATE TABLE "DiagnosisFindingRelationship" (
    "id" SERIAL NOT NULL,
    "findingSetId" INTEGER NOT NULL,
    "sourceFindingId" INTEGER NOT NULL,
    "targetFindingId" INTEGER NOT NULL,
    "relationshipType" VARCHAR(48) NOT NULL,
    "policyVersion" VARCHAR(64) NOT NULL,
    "supportJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiagnosisFindingRelationship_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiagnosisFindingRelationship_not_self" CHECK ("sourceFindingId" <> "targetFindingId")
);

CREATE UNIQUE INDEX "DiagnosisFindingSet_appUserId_materializationKey_key"
ON "DiagnosisFindingSet"("appUserId", "materializationKey");

CREATE INDEX "DiagnosisFindingSet_appUserId_scopeKey_createdAt_idx"
ON "DiagnosisFindingSet"("appUserId", "scopeKey", "createdAt");

CREATE UNIQUE INDEX "DiagnosisFindingSet_one_current_scope_idx"
ON "DiagnosisFindingSet"("appUserId", "scopeKey")
WHERE "isCurrent" = true;

CREATE UNIQUE INDEX "DiagnosisFinding_findingSetId_findingKey_key"
ON "DiagnosisFinding"("findingSetId", "findingKey");

CREATE INDEX "DiagnosisFinding_findingSetId_diagnosisId_idx"
ON "DiagnosisFinding"("findingSetId", "diagnosisId");

CREATE UNIQUE INDEX "DiagnosisFindingEvidenceReference_findingId_referenceKey_key"
ON "DiagnosisFindingEvidenceReference"("findingId", "referenceKey");

CREATE INDEX "DiagnosisFindingEvidenceReference_importedGameId_idx"
ON "DiagnosisFindingEvidenceReference"("importedGameId");

CREATE INDEX "DiagnosisFindingEvidenceReference_evidenceEventId_idx"
ON "DiagnosisFindingEvidenceReference"("evidenceEventId");

CREATE INDEX "DiagnosisFindingEvidenceReference_sourceAnalysisRunId_idx"
ON "DiagnosisFindingEvidenceReference"("sourceAnalysisRunId");

CREATE INDEX "DiagnosisFindingEvidenceReference_eventIdentityKey_idx"
ON "DiagnosisFindingEvidenceReference"("eventIdentityKey");

CREATE UNIQUE INDEX "DiagnosisFindingRelationship_set_source_target_type_key"
ON "DiagnosisFindingRelationship"("findingSetId", "sourceFindingId", "targetFindingId", "relationshipType");

CREATE INDEX "DiagnosisFindingRelationship_sourceFindingId_idx"
ON "DiagnosisFindingRelationship"("sourceFindingId");

CREATE INDEX "DiagnosisFindingRelationship_targetFindingId_idx"
ON "DiagnosisFindingRelationship"("targetFindingId");

ALTER TABLE "DiagnosisFindingSet"
ADD CONSTRAINT "DiagnosisFindingSet_appUserId_fkey"
FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiagnosisFinding"
ADD CONSTRAINT "DiagnosisFinding_findingSetId_fkey"
FOREIGN KEY ("findingSetId") REFERENCES "DiagnosisFindingSet"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiagnosisFindingEvidenceReference"
ADD CONSTRAINT "DiagnosisFindingEvidenceReference_findingId_fkey"
FOREIGN KEY ("findingId") REFERENCES "DiagnosisFinding"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiagnosisFindingEvidenceReference"
ADD CONSTRAINT "DiagnosisFindingEvidenceReference_importedGameId_fkey"
FOREIGN KEY ("importedGameId") REFERENCES "ImportedGame"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DiagnosisFindingEvidenceReference"
ADD CONSTRAINT "DiagnosisFindingEvidenceReference_evidenceEventId_fkey"
FOREIGN KEY ("evidenceEventId") REFERENCES "EvidenceEvent"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DiagnosisFindingEvidenceReference"
ADD CONSTRAINT "DiagnosisFindingEvidenceReference_sourceAnalysisRunId_fkey"
FOREIGN KEY ("sourceAnalysisRunId") REFERENCES "GameAnalysisRun"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DiagnosisFindingRelationship"
ADD CONSTRAINT "DiagnosisFindingRelationship_findingSetId_fkey"
FOREIGN KEY ("findingSetId") REFERENCES "DiagnosisFindingSet"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiagnosisFindingRelationship"
ADD CONSTRAINT "DiagnosisFindingRelationship_sourceFindingId_fkey"
FOREIGN KEY ("sourceFindingId") REFERENCES "DiagnosisFinding"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiagnosisFindingRelationship"
ADD CONSTRAINT "DiagnosisFindingRelationship_targetFindingId_fkey"
FOREIGN KEY ("targetFindingId") REFERENCES "DiagnosisFinding"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
