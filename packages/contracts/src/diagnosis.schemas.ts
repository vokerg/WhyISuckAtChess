import { z } from 'zod';

export const diagnosisSummaryQuerySchema = z.object({
  scopeKey: z.string().min(1).max(128),
}).strict();

export type DiagnosisSummaryQuery = z.output<typeof diagnosisSummaryQuerySchema>;

export const diagnosisFindingLevelSchema = z.enum([
  'OBSERVATION',
  'MECHANISM',
  'CONTRIBUTING_CONDITION',
  'ROOT_CAUSE_CANDIDATE',
]);

export const diagnosisObservationStateSchema = z.enum([
  'PROBLEM_DETECTED',
  'NOT_DETECTED_WITH_ADEQUATE_COVERAGE',
  'INSUFFICIENT_EVIDENCE',
  'REQUIRED_EVIDENCE_UNAVAILABLE',
]);

export const diagnosisEvidenceStrengthSchema = z.enum([
  'INSUFFICIENT',
  'LOW',
  'MEDIUM',
  'HIGH',
]);

export const diagnosisSummaryRepresentativeEvidenceSchema = z.object({
  referenceKey: z.string().min(1),
  referenceType: z.string().min(1),
  importedGameId: z.number().int().positive().nullable(),
  sourcePlyStart: z.number().int().positive().nullable(),
  sourcePlyEnd: z.number().int().positive().nullable(),
  eventIdentityKey: z.string().min(1).nullable(),
}).strict();

export const diagnosisSummaryEffectSchema = z.object({
  metric: z.string().min(1),
  value: z.number().finite(),
  unit: z.string().min(1),
  direction: z.string().min(1),
}).strict();

export const diagnosisSummaryItemSchema = z.object({
  findingId: z.number().int().positive(),
  findingKey: z.string().min(1),
  diagnosisId: z.string().min(1),
  findingLevel: diagnosisFindingLevelSchema,
  observationState: diagnosisObservationStateSchema,
  claimKey: z.string().min(1),
  evidenceStrength: diagnosisEvidenceStrengthSchema,
  sampleCount: z.number().int().nonnegative(),
  distinctGameCount: z.number().int().nonnegative(),
  distinctSessionCount: z.number().int().nonnegative(),
  requiredEvidenceCoverage: z.number().min(0).max(1).nullable(),
  effect: diagnosisSummaryEffectSchema.nullable(),
  consolidationState: z.string().min(1),
  rankPosition: z.number().int().positive(),
  finalScore: z.number().min(0).max(1),
  representativeEvidence: z.array(diagnosisSummaryRepresentativeEvidenceSchema).max(3),
}).strict();

export const diagnosisSummaryUnavailableReasonSchema = z.enum([
  'NO_CURRENT_DIAGNOSIS',
  'HIERARCHY_INCOMPLETE',
  'RANKING_INCOMPLETE',
  'RANKING_STALE',
]);

export const diagnosisSummaryAvailableSchema = z.object({
  status: z.literal('AVAILABLE'),
  scopeKey: z.string().min(1).max(128),
  findingSetId: z.number().int().positive(),
  calculationAsOf: z.iso.datetime({ offset: true }),
  versions: z.object({
    taxonomy: z.string().min(1),
    synthesis: z.string().min(1),
    calculation: z.string().min(1),
    ranking: z.string().min(1),
  }).strict(),
  items: z.array(diagnosisSummaryItemSchema),
}).strict();

export const diagnosisSummaryUnavailableSchema = z.object({
  status: z.literal('UNAVAILABLE'),
  scopeKey: z.string().min(1).max(128),
  reason: diagnosisSummaryUnavailableReasonSchema,
}).strict();

export const diagnosisSummaryResponseSchema = z.discriminatedUnion('status', [
  diagnosisSummaryAvailableSchema,
  diagnosisSummaryUnavailableSchema,
]);

export type DiagnosisSummaryRepresentativeEvidence = z.output<
  typeof diagnosisSummaryRepresentativeEvidenceSchema
>;
export type DiagnosisSummaryItem = z.output<typeof diagnosisSummaryItemSchema>;
export type DiagnosisSummaryResponse = z.output<typeof diagnosisSummaryResponseSchema>;

export const diagnosisDrillDownParamsSchema = z.object({
  findingId: z.coerce.number().int().positive(),
}).strict();

export type DiagnosisDrillDownParams = z.output<typeof diagnosisDrillDownParamsSchema>;

export const diagnosisDrillDownQuerySchema = diagnosisSummaryQuerySchema;
export type DiagnosisDrillDownQuery = z.output<typeof diagnosisDrillDownQuerySchema>;

export const diagnosisDrillDownSupportRoleSchema = z.enum([
  'MECHANISM',
  'CONDITION_OR_OBSERVATION',
  'ADDITIONAL_SUPPORT',
]);

export const diagnosisDrillDownSupportingFindingSchema = diagnosisSummaryItemSchema
  .omit({ rankPosition: true })
  .extend({
    supportRole: diagnosisDrillDownSupportRoleSchema,
  })
  .strict();

export const diagnosisDrillDownUnavailableReasonSchema = z.enum([
  'NO_CURRENT_DIAGNOSIS',
  'HIERARCHY_INCOMPLETE',
  'RANKING_INCOMPLETE',
  'RANKING_STALE',
  'FINDING_NOT_FOUND',
]);

export const diagnosisDrillDownAvailableSchema = z.object({
  status: z.literal('AVAILABLE'),
  scopeKey: z.string().min(1).max(128),
  findingSetId: z.number().int().positive(),
  calculationAsOf: z.iso.datetime({ offset: true }),
  versions: z.object({
    taxonomy: z.string().min(1),
    synthesis: z.string().min(1),
    calculation: z.string().min(1),
    ranking: z.string().min(1),
  }).strict(),
  finding: diagnosisSummaryItemSchema,
  supportingFindings: z.array(diagnosisDrillDownSupportingFindingSchema).max(200),
}).strict();

export const diagnosisDrillDownUnavailableSchema = z.object({
  status: z.literal('UNAVAILABLE'),
  scopeKey: z.string().min(1).max(128),
  reason: diagnosisDrillDownUnavailableReasonSchema,
}).strict();

export const diagnosisDrillDownResponseSchema = z.discriminatedUnion('status', [
  diagnosisDrillDownAvailableSchema,
  diagnosisDrillDownUnavailableSchema,
]);

export type DiagnosisDrillDownSupportRole = z.output<typeof diagnosisDrillDownSupportRoleSchema>;
export type DiagnosisDrillDownSupportingFinding = z.output<
  typeof diagnosisDrillDownSupportingFindingSchema
>;
export type DiagnosisDrillDownResponse = z.output<typeof diagnosisDrillDownResponseSchema>;
