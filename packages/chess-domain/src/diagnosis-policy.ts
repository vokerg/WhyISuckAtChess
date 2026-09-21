export const DIAGNOSIS_SYNTHESIS_POLICY_VERSION = 'diagnosis-synthesis-v1' as const;
export const DIAGNOSIS_CONSOLIDATION_POLICY_VERSION = 'diagnosis-consolidation-v1' as const;
export const DIAGNOSIS_RANKING_POLICY_VERSION = 'diagnosis-ranking-v1' as const;
export const DIAGNOSIS_EVENT_IDENTITY_VERSION = 'diagnosis-event-identity-v1' as const;

export const DIAGNOSIS_FINDING_LEVELS = [
  'OBSERVATION',
  'MECHANISM',
  'CONTRIBUTING_CONDITION',
  'ROOT_CAUSE_CANDIDATE',
] as const;

export type DiagnosisFindingLevel = typeof DIAGNOSIS_FINDING_LEVELS[number];

export const DIAGNOSIS_EVIDENCE_STRENGTHS = [
  'INSUFFICIENT',
  'LOW',
  'MEDIUM',
  'HIGH',
] as const;

export type DiagnosisEvidenceStrength = typeof DIAGNOSIS_EVIDENCE_STRENGTHS[number];

export const DIAGNOSIS_RELATIONSHIP_TYPES = [
  'SPECIALIZES',
  'MANIFESTS_AS',
  'CONTRIBUTES_TO',
  'CONDITIONAL_ON',
  'EXPLAINS_OBSERVATION',
  'SHARES_EVENTS_WITH',
  'CONFOUNDED_BY',
] as const;

export type DiagnosisRelationshipType = typeof DIAGNOSIS_RELATIONSHIP_TYPES[number];

export const DIAGNOSIS_OBSERVATION_STATES = [
  'PROBLEM_DETECTED',
  'NOT_DETECTED_WITH_ADEQUATE_COVERAGE',
  'INSUFFICIENT_EVIDENCE',
  'REQUIRED_EVIDENCE_UNAVAILABLE',
] as const;

export type DiagnosisObservationState = typeof DIAGNOSIS_OBSERVATION_STATES[number];

export const DIAGNOSIS_EVIDENCE_POLICY = Object.freeze({
  minimumSupportingSample: 5,
  mediumSupportingSample: 15,
  highSupportingSample: 40,
  minimumRequiredEvidenceCoverage: 0.5,
  rootCandidateMinimumDistinctGames: 5,
  rootCandidateMaximumSingleGameEventShare: 0.5,
});

export const DIAGNOSIS_OVERLAP_POLICY = Object.freeze({
  minimumSharedEvents: 2,
  minimumSharedDistinctGames: 2,
  materialSmallerArmRate: 0.6,
});

export const DIAGNOSIS_BOUNDEDNESS_POLICY = Object.freeze({
  maxCurrentFindingsPerScope: 200,
  maxEvidenceEventReferencesPerFinding: 1000,
  maxRepresentativeExamplesPerFinding: 3,
});

export const DIAGNOSIS_RANKING_WEIGHTS = Object.freeze({
  frequency: 0.2,
  severity: 0.2,
  resultImpact: 0.15,
  recurrence: 0.15,
  evidence: 0.15,
  specificity: 0.05,
  conditionalConcentration: 0.05,
  recency: 0.05,
});

export type DiagnosisRankingDimension = keyof typeof DIAGNOSIS_RANKING_WEIGHTS;

export const DIAGNOSIS_RANKING_NORMALIZATION_METHODS = [
  'IDENTITY_0_1',
  'LINEAR_CLAMP',
] as const;

export type DiagnosisRankingNormalizationMethod =
  typeof DIAGNOSIS_RANKING_NORMALIZATION_METHODS[number];

export type DiagnosisRankingNormalizationSpec =
  | Readonly<{
      key: string;
      method: 'IDENTITY_0_1';
    }>
  | Readonly<{
      key: string;
      method: 'LINEAR_CLAMP';
      lowerAnchor: number;
      upperAnchor: number;
      direction: 'ASCENDING' | 'DESCENDING';
    }>;

export const DIAGNOSIS_EVIDENCE_RANKING_MULTIPLIER = Object.freeze({
  INSUFFICIENT: 0,
  LOW: 0.55,
  MEDIUM: 0.8,
  HIGH: 1,
} satisfies Readonly<Record<DiagnosisEvidenceStrength, number>>);

export const DIAGNOSIS_UNRESOLVED_MATERIAL_OVERLAP_MULTIPLIER = 0.75 as const;

export interface DiagnosisRankingComponents {
  frequency: number;
  severity: number;
  evidence: number;
  resultImpact?: number | null;
  recurrence?: number | null;
  specificity?: number | null;
  conditionalConcentration?: number | null;
  recency?: number | null;
}

export interface DiagnosisEventOverlapSummary {
  calculable: boolean;
  leftEventCount: number;
  rightEventCount: number;
  intersectionEventCount: number;
  sharedDistinctGames: number;
  sharedDistinctSessions?: number | null;
}

export interface DiagnosisRootCauseThemePolicy {
  key: string;
  mechanismDiagnosisIds: readonly string[];
  conditionOrObservationDiagnosisIds: readonly string[];
  minimumDistinctGames: number;
  minimumDistinctSessions: number;
}

export const DIAGNOSIS_ROOT_CAUSE_THEME_REGISTRY = Object.freeze([
  Object.freeze({
    key: 'CLOCK_MANAGEMENT_DRIVING_TACTICAL_COLLAPSE',
    mechanismDiagnosisIds: Object.freeze([
      'TACT-001',
      'TACT-002',
      'TACT-003',
      'TACT-004',
      'TACT-005',
      'TIME-003',
      'TIME-004',
    ]),
    conditionOrObservationDiagnosisIds: Object.freeze([
      'TIME-001',
      'TIME-002',
      'TIME-005',
      'TIME-006',
    ]),
    minimumDistinctGames: 5,
    minimumDistinctSessions: 0,
  }),
  Object.freeze({
    key: 'LATE_SESSION_TACTICAL_DETERIORATION',
    mechanismDiagnosisIds: Object.freeze([
      'TACT-001',
      'TACT-002',
      'TACT-003',
      'TACT-004',
      'TACT-005',
    ]),
    conditionOrObservationDiagnosisIds: Object.freeze([
      'SESSION-001',
      'SESSION-002',
    ]),
    minimumDistinctGames: 5,
    minimumDistinctSessions: 3,
  }),
] satisfies readonly DiagnosisRootCauseThemePolicy[]);

export const DIAGNOSIS_POLICY_REGISTRY = Object.freeze({
  versions: Object.freeze({
    synthesis: DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
    consolidation: DIAGNOSIS_CONSOLIDATION_POLICY_VERSION,
    ranking: DIAGNOSIS_RANKING_POLICY_VERSION,
    eventIdentity: DIAGNOSIS_EVENT_IDENTITY_VERSION,
  }),
  findingLevels: DIAGNOSIS_FINDING_LEVELS,
  relationshipTypes: DIAGNOSIS_RELATIONSHIP_TYPES,
  observationStates: DIAGNOSIS_OBSERVATION_STATES,
  evidence: DIAGNOSIS_EVIDENCE_POLICY,
  overlap: DIAGNOSIS_OVERLAP_POLICY,
  boundedness: DIAGNOSIS_BOUNDEDNESS_POLICY,
  rankingWeights: DIAGNOSIS_RANKING_WEIGHTS,
  rankingNormalizationMethods: DIAGNOSIS_RANKING_NORMALIZATION_METHODS,
  evidenceRankingMultiplier: DIAGNOSIS_EVIDENCE_RANKING_MULTIPLIER,
  unresolvedMaterialOverlapMultiplier: DIAGNOSIS_UNRESOLVED_MATERIAL_OVERLAP_MULTIPLIER,
  rootCauseThemes: DIAGNOSIS_ROOT_CAUSE_THEME_REGISTRY,
});

export function diagnosisEvidenceRankingMultiplier(
  strength: DiagnosisEvidenceStrength,
): number {
  return DIAGNOSIS_EVIDENCE_RANKING_MULTIPLIER[strength];
}

export function normalizeDiagnosisRankingComponent(
  value: number,
  spec: DiagnosisRankingNormalizationSpec,
): number {
  if (!Number.isFinite(value)) {
    throw new Error('Diagnosis ranking normalization value must be finite');
  }

  if (spec.method === 'IDENTITY_0_1') {
    if (value < 0 || value > 1) {
      throw new Error('Diagnosis IDENTITY_0_1 value must be in [0, 1]');
    }
    return value;
  }

  if (
    !Number.isFinite(spec.lowerAnchor)
    || !Number.isFinite(spec.upperAnchor)
    || spec.upperAnchor <= spec.lowerAnchor
  ) {
    throw new Error('Diagnosis LINEAR_CLAMP anchors must be finite and increasing');
  }

  const ascending = Math.min(
    1,
    Math.max(0, (value - spec.lowerAnchor) / (spec.upperAnchor - spec.lowerAnchor)),
  );
  return spec.direction === 'ASCENDING' ? ascending : 1 - ascending;
}

export function diagnosisSmallerArmOverlapRate(
  overlap: DiagnosisEventOverlapSummary,
): number | null {
  if (!overlap.calculable) return null;
  const denominator = Math.min(overlap.leftEventCount, overlap.rightEventCount);
  if (denominator <= 0) return null;
  return overlap.intersectionEventCount / denominator;
}

export function isMaterialDiagnosisEventOverlap(
  overlap: DiagnosisEventOverlapSummary,
): boolean {
  const rate = diagnosisSmallerArmOverlapRate(overlap);
  return (
    rate !== null
    && overlap.intersectionEventCount >= DIAGNOSIS_OVERLAP_POLICY.minimumSharedEvents
    && overlap.sharedDistinctGames >= DIAGNOSIS_OVERLAP_POLICY.minimumSharedDistinctGames
    && rate >= DIAGNOSIS_OVERLAP_POLICY.materialSmallerArmRate
  );
}

export function assertDiagnosisPolicyInvariants(): void {
  const weightSum = Object.values(DIAGNOSIS_RANKING_WEIGHTS)
    .reduce((sum, value) => sum + value, 0);
  if (Math.abs(weightSum - 1) > Number.EPSILON * 16) {
    throw new Error('Diagnosis ranking weights must sum to 1');
  }

  if (
    DIAGNOSIS_OVERLAP_POLICY.materialSmallerArmRate <= 0
    || DIAGNOSIS_OVERLAP_POLICY.materialSmallerArmRate > 1
  ) {
    throw new Error('Diagnosis material overlap rate must be in (0, 1]');
  }

  if (
    DIAGNOSIS_EVIDENCE_POLICY.minimumRequiredEvidenceCoverage <= 0
    || DIAGNOSIS_EVIDENCE_POLICY.minimumRequiredEvidenceCoverage > 1
  ) {
    throw new Error('Diagnosis required-evidence coverage must be in (0, 1]');
  }

  const rootThemeKeys = DIAGNOSIS_ROOT_CAUSE_THEME_REGISTRY.map((theme) => theme.key);
  if (new Set(rootThemeKeys).size !== rootThemeKeys.length) {
    throw new Error('Diagnosis root-cause theme keys must be unique');
  }

  for (const theme of DIAGNOSIS_ROOT_CAUSE_THEME_REGISTRY) {
    if (
      theme.minimumDistinctGames < DIAGNOSIS_EVIDENCE_POLICY.rootCandidateMinimumDistinctGames
      || theme.mechanismDiagnosisIds.length === 0
      || theme.conditionOrObservationDiagnosisIds.length === 0
    ) {
      throw new Error('Diagnosis root-cause theme registry violates promotion policy');
    }
  }
}

assertDiagnosisPolicyInvariants();
