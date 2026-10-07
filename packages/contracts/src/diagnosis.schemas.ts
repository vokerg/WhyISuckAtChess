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


export const timeControlComparisonQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
}).strict().superRefine((value, context) => {
  if (value.from && value.to && Date.parse(value.from) >= Date.parse(value.to)) {
    context.addIssue({
      code: 'custom',
      message: '"from" must be earlier than "to".',
      path: ['from'],
    });
  }
});

export type TimeControlComparisonQuery = z.output<typeof timeControlComparisonQuerySchema>;

const timeControlComparisonCoverageStatusSchema = z.enum([
  'COMPLETE',
  'PARTIAL',
  'UNAVAILABLE',
]);

const timeControlCollectionMetaSchema = z.object({
  total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  truncated: z.boolean(),
}).strict();

const timeControlCaveatCollectionSchema = timeControlCollectionMetaSchema.extend({
  items: z.array(z.string().min(1)).max(20),
}).strict();

const timeControlRatingDisclosureSchema = z.object({
  status: z.enum(['AVAILABLE', 'UNAVAILABLE']),
  reason: z.string().min(1).nullable(),
  materialCompositionWarning: z.boolean().nullable(),
}).strict();

const exactTimeControlArmSummarySchema = z.object({
  exactTimeControlKey: z.string().min(1),
  initialSeconds: z.number().int().nonnegative(),
  incrementSeconds: z.number().int().nonnegative(),
  eligibleGames: z.number().int().nonnegative(),
  resultCoveredGames: z.number().int().nonnegative(),
  scorePercent: z.number().min(0).max(100).nullable(),
  analysedGames: z.number().int().nonnegative(),
  averageScoreLossCp: z.number().nonnegative().nullable(),
  majorErrorRatePercent: z.number().min(0).max(100).nullable(),
  blunderRatePercent: z.number().min(0).max(100).nullable(),
  resultEvidenceStrength: diagnosisEvidenceStrengthSchema,
  qualityEvidenceStrength: diagnosisEvidenceStrengthSchema,
}).strict();

const timeControlDeltaSchema = z.object({
  scorePercentagePoints: z.number().finite().nullable(),
  averageScoreLossCp: z.number().finite().nullable(),
  majorErrorRatePercentagePoints: z.number().finite().nullable(),
  blunderRatePercentagePoints: z.number().finite().nullable(),
}).strict();

const exactTimeControlComparisonItemSchema = z.object({
  status: z.enum(['AVAILABLE', 'UNAVAILABLE']),
  reason: z.string().min(1).nullable(),
  target: exactTimeControlArmSummarySchema,
  comparator: exactTimeControlArmSummarySchema.nullable(),
  deltas: timeControlDeltaSchema,
  evidenceStrength: z.object({
    result: diagnosisEvidenceStrengthSchema,
    quality: diagnosisEvidenceStrengthSchema,
  }).strict(),
  ratingComposition: timeControlRatingDisclosureSchema,
}).strict();

const exactTimeControlComparisonSectionSchema = z.object({
  diagnosisId: z.literal('TIME-005'),
  policyVersion: z.string().min(1),
  timeBehaviorPolicyVersion: z.string().min(1),
  coverage: z.object({
    status: timeControlComparisonCoverageStatusSchema,
    reason: z.string().min(1).nullable(),
    candidateGames: z.number().int().nonnegative(),
    eligibleGames: z.number().int().nonnegative(),
    exactControls: z.number().int().nonnegative(),
    controlsWithComparator: z.number().int().nonnegative(),
    resultCoveragePercent: z.number().min(0).max(100).nullable(),
    analysisCoveragePercent: z.number().min(0).max(100).nullable(),
  }).strict(),
  comparisonCount: timeControlCollectionMetaSchema,
  comparisons: z.array(exactTimeControlComparisonItemSchema).max(25),
  caveats: timeControlCaveatCollectionSchema,
}).strict();

const incrementExactControlSchema = z.object({
  exactTimeControlKey: z.string().min(1),
  incrementSeconds: z.number().int().nonnegative(),
  games: z.number().int().nonnegative(),
}).strict();

const incrementArmSummarySchema = z.object({
  games: z.number().int().nonnegative(),
  exactControls: z.object({
    total: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    truncated: z.boolean(),
    items: z.array(incrementExactControlSchema).max(12),
  }).strict(),
  resultCoveredGames: z.number().int().nonnegative(),
  scorePercent: z.number().min(0).max(100).nullable(),
  analysedGames: z.number().int().nonnegative(),
  averageScoreLossCp: z.number().nonnegative().nullable(),
  majorErrorRatePercent: z.number().min(0).max(100).nullable(),
  blunderRatePercent: z.number().min(0).max(100).nullable(),
  pressure: z.object({
    timingCoveredGames: z.number().int().nonnegative(),
    timingCoveragePercent: z.number().min(0).max(100).nullable(),
    pressureMoveRatePercent: z.number().min(0).max(100).nullable(),
    pressureEntryRatePercent: z.number().min(0).max(100).nullable(),
  }).strict(),
  evidenceStrength: z.object({
    result: diagnosisEvidenceStrengthSchema,
    quality: diagnosisEvidenceStrengthSchema,
    timing: diagnosisEvidenceStrengthSchema,
  }).strict(),
}).strict();

const incrementStratumSchema = z.object({
  initialSeconds: z.number().int().nonnegative(),
  noIncrement: incrementArmSummarySchema,
  increment: incrementArmSummarySchema,
  deltas: timeControlDeltaSchema.extend({
    pressureMoveRatePercentagePoints: z.number().finite().nullable(),
    pressureEntryRatePercentagePoints: z.number().finite().nullable(),
  }).strict(),
  evidenceStrength: z.object({
    result: diagnosisEvidenceStrengthSchema,
    quality: diagnosisEvidenceStrengthSchema,
    timing: diagnosisEvidenceStrengthSchema,
  }).strict(),
  ratingComposition: timeControlRatingDisclosureSchema,
}).strict();

const incrementEffectSectionSchema = z.object({
  diagnosisId: z.literal('TIME-006'),
  policyVersion: z.string().min(1),
  timeBehaviorPolicyVersion: z.string().min(1),
  timingDerivationVersion: z.number().int().positive(),
  coverage: z.object({
    status: timeControlComparisonCoverageStatusSchema,
    reason: z.string().min(1).nullable(),
    candidateGames: z.number().int().nonnegative(),
    eligibleGames: z.number().int().nonnegative(),
    matchedGames: z.number().int().nonnegative(),
    unmatchedGames: z.number().int().nonnegative(),
    matchedInitialTimeStrata: z.number().int().nonnegative(),
    resultCoveragePercent: z.number().min(0).max(100).nullable(),
    analysisCoveragePercent: z.number().min(0).max(100).nullable(),
    timingCoveragePercent: z.number().min(0).max(100).nullable(),
  }).strict(),
  stratumCount: timeControlCollectionMetaSchema,
  strata: z.array(incrementStratumSchema).max(25),
  caveats: timeControlCaveatCollectionSchema,
}).strict();

export const timeControlComparisonResponseSchema = z.object({
  scope: z.object({
    from: z.iso.datetime({ offset: true }).nullable(),
    to: z.iso.datetime({ offset: true }).nullable(),
  }).strict(),
  exactControl: exactTimeControlComparisonSectionSchema,
  incrementEffect: incrementEffectSectionSchema,
}).strict();

export type TimeControlComparisonResponse = z.output<
  typeof timeControlComparisonResponseSchema
>;
