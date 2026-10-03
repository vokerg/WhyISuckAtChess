-- Phase 5 deterministic diagnosis ranking.
-- Ranking rows are derived state scoped to one immutable canonical finding set.

CREATE TABLE "DiagnosisFindingRanking" (
    "id" SERIAL NOT NULL,
    "findingSetId" INTEGER NOT NULL,
    "findingId" INTEGER NOT NULL,
    "topLevelRanked" BOOLEAN NOT NULL,
    "rankPosition" INTEGER,
    "finalScore" DOUBLE PRECISION NOT NULL,
    "weightedScore" DOUBLE PRECISION NOT NULL,
    "evidenceMultiplier" DOUBLE PRECISION NOT NULL,
    "overlapMultiplier" DOUBLE PRECISION NOT NULL,
    "rankingPolicyVersion" VARCHAR(64) NOT NULL,
    "componentsJson" JSONB NOT NULL,
    "rawEffectJson" JSONB,
    "consolidationState" VARCHAR(48) NOT NULL,
    "parentRootFindingIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "supportJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiagnosisFindingRanking_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiagnosisFindingRanking_rank_position_positive" CHECK (
      "rankPosition" IS NULL OR "rankPosition" > 0
    ),
    CONSTRAINT "DiagnosisFindingRanking_score_bounds" CHECK (
      "finalScore" >= 0 AND "finalScore" <= 1
      AND "weightedScore" >= 0 AND "weightedScore" <= 1
      AND "evidenceMultiplier" >= 0 AND "evidenceMultiplier" <= 1
      AND "overlapMultiplier" >= 0 AND "overlapMultiplier" <= 1
    ),
    CONSTRAINT "DiagnosisFindingRanking_top_level_position" CHECK (
      ("topLevelRanked" = TRUE AND "rankPosition" IS NOT NULL)
      OR ("topLevelRanked" = FALSE AND "rankPosition" IS NULL)
    )
);

CREATE UNIQUE INDEX "DiagnosisFindingRanking_findingId_key"
ON "DiagnosisFindingRanking"("findingId");

CREATE INDEX "DiagnosisFindingRanking_findingSetId_topLevelRanked_rankPosition_idx"
ON "DiagnosisFindingRanking"("findingSetId", "topLevelRanked", "rankPosition");

ALTER TABLE "DiagnosisFindingRanking"
ADD CONSTRAINT "DiagnosisFindingRanking_findingSetId_fkey"
FOREIGN KEY ("findingSetId") REFERENCES "DiagnosisFindingSet"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiagnosisFindingRanking"
ADD CONSTRAINT "DiagnosisFindingRanking_findingId_fkey"
FOREIGN KEY ("findingId") REFERENCES "DiagnosisFinding"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
