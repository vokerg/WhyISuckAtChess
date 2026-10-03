-- Phase 5 deterministic diagnosis consolidation.
-- Consolidation is derived hierarchy state attached to an immutable finding-set
-- revision. It never deletes or rewrites the underlying canonical findings or
-- their source evidence.

CREATE TABLE "DiagnosisFindingConsolidation" (
    "id" SERIAL NOT NULL,
    "findingSetId" INTEGER NOT NULL,
    "findingId" INTEGER NOT NULL,
    "representativeFindingId" INTEGER,
    "state" VARCHAR(48) NOT NULL,
    "topLevelEligible" BOOLEAN NOT NULL,
    "clusterKey" VARCHAR(160) NOT NULL,
    "reasonKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "policyVersion" VARCHAR(64) NOT NULL,
    "supportJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiagnosisFindingConsolidation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiagnosisFindingConsolidation_not_self" CHECK (
      "representativeFindingId" IS NULL OR "representativeFindingId" <> "findingId"
    ),
    CONSTRAINT "DiagnosisFindingConsolidation_state_shape" CHECK (
      (
        "state" IN ('TOP_LEVEL', 'TOP_LEVEL_MATERIAL_OVERLAP')
        AND "topLevelEligible" = true
        AND "representativeFindingId" IS NULL
      )
      OR (
        "state" = 'SUPPRESSED_DRILLDOWN'
        AND "topLevelEligible" = false
        AND "representativeFindingId" IS NOT NULL
      )
      OR (
        "state" = 'INELIGIBLE'
        AND "topLevelEligible" = false
        AND "representativeFindingId" IS NULL
      )
    )
);

CREATE UNIQUE INDEX "DiagnosisFindingConsolidation_findingId_key"
ON "DiagnosisFindingConsolidation"("findingId");

CREATE INDEX "DiagnosisFindingConsolidation_findingSetId_idx"
ON "DiagnosisFindingConsolidation"("findingSetId");

CREATE INDEX "DiagnosisFindingConsolidation_representativeFindingId_idx"
ON "DiagnosisFindingConsolidation"("representativeFindingId");

ALTER TABLE "DiagnosisFindingConsolidation"
ADD CONSTRAINT "DiagnosisFindingConsolidation_findingSetId_fkey"
FOREIGN KEY ("findingSetId") REFERENCES "DiagnosisFindingSet"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiagnosisFindingConsolidation"
ADD CONSTRAINT "DiagnosisFindingConsolidation_findingId_fkey"
FOREIGN KEY ("findingId") REFERENCES "DiagnosisFinding"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiagnosisFindingConsolidation"
ADD CONSTRAINT "DiagnosisFindingConsolidation_representativeFindingId_fkey"
FOREIGN KEY ("representativeFindingId") REFERENCES "DiagnosisFinding"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
