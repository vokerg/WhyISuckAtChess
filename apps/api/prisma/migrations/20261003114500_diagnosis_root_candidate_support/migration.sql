-- Phase 5 deterministic root-cause synthesis support links.
-- Synthesized roots remain canonical DiagnosisFinding rows. This table keeps
-- durable same-revision links to every supporting canonical finding.

CREATE TABLE "DiagnosisRootCandidateSupport" (
    "id" SERIAL NOT NULL,
    "findingSetId" INTEGER NOT NULL,
    "rootFindingId" INTEGER NOT NULL,
    "supportingFindingId" INTEGER NOT NULL,
    "role" VARCHAR(48) NOT NULL,
    "supportJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiagnosisRootCandidateSupport_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiagnosisRootCandidateSupport_not_self" CHECK (
      "rootFindingId" <> "supportingFindingId"
    ),
    CONSTRAINT "DiagnosisRootCandidateSupport_role" CHECK (
      "role" IN ('MECHANISM', 'CONDITION_OR_OBSERVATION', 'ADDITIONAL_SUPPORT')
    )
);

CREATE UNIQUE INDEX "DiagnosisRootCandidateSupport_root_supporting_key"
ON "DiagnosisRootCandidateSupport"("rootFindingId", "supportingFindingId");

CREATE INDEX "DiagnosisRootCandidateSupport_findingSetId_idx"
ON "DiagnosisRootCandidateSupport"("findingSetId");

CREATE INDEX "DiagnosisRootCandidateSupport_supportingFindingId_idx"
ON "DiagnosisRootCandidateSupport"("supportingFindingId");

ALTER TABLE "DiagnosisRootCandidateSupport"
ADD CONSTRAINT "DiagnosisRootCandidateSupport_findingSetId_fkey"
FOREIGN KEY ("findingSetId") REFERENCES "DiagnosisFindingSet"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiagnosisRootCandidateSupport"
ADD CONSTRAINT "DiagnosisRootCandidateSupport_rootFindingId_fkey"
FOREIGN KEY ("rootFindingId") REFERENCES "DiagnosisFinding"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiagnosisRootCandidateSupport"
ADD CONSTRAINT "DiagnosisRootCandidateSupport_supportingFindingId_fkey"
FOREIGN KEY ("supportingFindingId") REFERENCES "DiagnosisFinding"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
