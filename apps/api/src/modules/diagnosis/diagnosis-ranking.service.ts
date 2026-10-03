import {
  DIAGNOSIS_CONSOLIDATION_POLICY_VERSION,
  DIAGNOSIS_EVIDENCE_POLICY,
  DIAGNOSIS_RANKING_POLICY_VERSION,
  DIAGNOSIS_RANKING_WEIGHTS,
  DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
  DIAGNOSIS_UNRESOLVED_MATERIAL_OVERLAP_MULTIPLIER,
  diagnosisEvidenceRankingMultiplier,
  normalizeDiagnosisRankingComponent,
  type DiagnosisEvidenceStrength,
  type DiagnosisRankingNormalizationSpec,
} from '@why-i-suck-at-chess/chess-domain';
import type {
  DiagnosisFindingSetSnapshot,
  DiagnosisFindingVersionTuple,
  PersistedDiagnosisFinding,
  PersistedDiagnosisFindingConsolidation,
  PersistedDiagnosisRootCandidateSupport,
} from './diagnosis-finding.types';
import type { DiagnosisFindingOverlapRepository } from './diagnosis-overlap.service';

export const DIAGNOSIS_RANKING_CALCULATION_VERSION = 'diagnosis-ranking-execution-v1' as const;

export type DiagnosisRankingComponentName = keyof typeof DIAGNOSIS_RANKING_WEIGHTS;

export interface DiagnosisRankingComponentValue {
  component: DiagnosisRankingComponentName;
  normalizationKey: string;
  rawValue: number;
  normalizedValue: number;
  weight: number;
  normalization: DiagnosisRankingNormalizationSpec;
  source: Readonly<Record<string, unknown>>;
}

export interface DiagnosisFindingRankingDraft {
  findingId: number;
  topLevelRanked: boolean;
  rankPosition: number | null;
  finalScore: number;
  weightedScore: number;
  evidenceMultiplier: number;
  overlapMultiplier: number;
  rankingPolicyVersion: typeof DIAGNOSIS_RANKING_POLICY_VERSION;
  components: readonly DiagnosisRankingComponentValue[];
  rawEffect: Readonly<Record<string, unknown>> | null;
  consolidationState: string;
  parentRootFindingIds: readonly number[];
  support: Readonly<Record<string, unknown>>;
}

export interface PersistedDiagnosisFindingRanking {
  id: number;
  findingSetId: number;
  findingId: number;
  topLevelRanked: boolean;
  rankPosition: number | null;
  finalScore: number;
  weightedScore: number;
  evidenceMultiplier: number;
  overlapMultiplier: number;
  rankingPolicyVersion: string;
  components: unknown;
  rawEffect: unknown;
  consolidationState: string;
  parentRootFindingIds: number[];
  support: unknown;
}

export interface DiagnosisRankingRepository extends DiagnosisFindingOverlapRepository {
  replaceCurrentRankings(
    appUserId: number,
    findingSetId: number,
    rankingPolicyVersion: typeof DIAGNOSIS_RANKING_POLICY_VERSION,
    rankings: readonly DiagnosisFindingRankingDraft[],
  ): Promise<readonly PersistedDiagnosisFindingRanking[]>;
}

export interface DiagnosisRankingBuildResult {
  rankings: readonly DiagnosisFindingRankingDraft[];
  topLevelFindingIds: readonly number[];
}

export interface DiagnosisRankingResult {
  findingSetId: number;
  scopeKey: string;
  calculationVersion: typeof DIAGNOSIS_RANKING_CALCULATION_VERSION;
  rankingPolicyVersion: typeof DIAGNOSIS_RANKING_POLICY_VERSION;
  rankings: readonly PersistedDiagnosisFindingRanking[];
}

interface EffectSeverityRule {
  key: string;
  metric: string;
  unit: string;
  direction: string;
  orientation: 'AS_IS' | 'NEGATE' | 'ABSOLUTE';
  upperAnchor: number;
}

const EFFECT_SEVERITY_RULES: readonly EffectSeverityRule[] = Object.freeze([
  Object.freeze({
    key: 'severity.average-score-loss-cp.v1',
    metric: 'average-score-loss',
    unit: 'CENTIPAWNS',
    direction: 'HIGHER_IS_WORSE',
    orientation: 'AS_IS',
    upperAnchor: 150,
  }),
  Object.freeze({
    key: 'severity.average-user-evaluation-cp.v1',
    metric: 'average-user-evaluation',
    unit: 'CENTIPAWNS',
    direction: 'LOWER_IS_WORSE',
    orientation: 'NEGATE',
    upperAnchor: 150,
  }),
  Object.freeze({
    key: 'severity.pressure-entry-rate-percent.v1',
    metric: 'pressure-entry-rate',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_WORSE',
    orientation: 'AS_IS',
    upperAnchor: 100,
  }),
  Object.freeze({
    key: 'severity.average-score-loss-delta-cp.v1',
    metric: 'average-score-loss-delta',
    unit: 'CENTIPAWNS',
    direction: 'HIGHER_IS_WORSE',
    orientation: 'AS_IS',
    upperAnchor: 100,
  }),
  Object.freeze({
    key: 'severity.average-score-loss-delta-context-cp.v1',
    metric: 'average-score-loss-delta',
    unit: 'CENTIPAWNS',
    direction: 'CONTEXT_DIFFERENCE',
    orientation: 'ABSOLUTE',
    upperAnchor: 100,
  }),
  Object.freeze({
    key: 'severity.later-average-score-loss-delta-cp.v1',
    metric: 'later-average-score-loss-delta',
    unit: 'CENTIPAWNS',
    direction: 'HIGHER_IS_WORSE',
    orientation: 'AS_IS',
    upperAnchor: 100,
  }),
  Object.freeze({
    key: 'severity.major-error-rate-delta-pp.v1',
    metric: 'major-error-rate-delta',
    unit: 'PERCENTAGE_POINTS',
    direction: 'HIGHER_IS_WORSE',
    orientation: 'AS_IS',
    upperAnchor: 25,
  }),
  Object.freeze({
    key: 'severity.major-error-rate-delta-context-pp.v1',
    metric: 'major-error-rate-delta',
    unit: 'PERCENTAGE_POINTS',
    direction: 'CONTEXT_DIFFERENCE',
    orientation: 'ABSOLUTE',
    upperAnchor: 25,
  }),
  Object.freeze({
    key: 'severity.blunder-rate-delta-pp.v1',
    metric: 'blunder-rate-delta',
    unit: 'PERCENTAGE_POINTS',
    direction: 'HIGHER_IS_WORSE',
    orientation: 'AS_IS',
    upperAnchor: 20,
  }),
  Object.freeze({
    key: 'severity.blunder-rate-delta-context-pp.v1',
    metric: 'blunder-rate-delta',
    unit: 'PERCENTAGE_POINTS',
    direction: 'CONTEXT_DIFFERENCE',
    orientation: 'ABSOLUTE',
    upperAnchor: 20,
  }),
  Object.freeze({
    key: 'severity.score-delta-lower-is-worse-pp.v1',
    metric: 'score-percentage-point-delta',
    unit: 'PERCENTAGE_POINTS',
    direction: 'LOWER_IS_WORSE',
    orientation: 'NEGATE',
    upperAnchor: 25,
  }),
  Object.freeze({
    key: 'severity.score-delta-context-pp.v1',
    metric: 'score-percentage-point-delta',
    unit: 'PERCENTAGE_POINTS',
    direction: 'CONTEXT_DIFFERENCE',
    orientation: 'ABSOLUTE',
    upperAnchor: 25,
  }),
  Object.freeze({
    key: 'severity.pressure-move-rate-context-pp.v1',
    metric: 'pressure-move-rate-delta',
    unit: 'PERCENTAGE_POINTS',
    direction: 'CONTEXT_DIFFERENCE',
    orientation: 'ABSOLUTE',
    upperAnchor: 25,
  }),
  Object.freeze({
    key: 'severity.pressure-entry-rate-context-pp.v1',
    metric: 'pressure-entry-rate-delta',
    unit: 'PERCENTAGE_POINTS',
    direction: 'CONTEXT_DIFFERENCE',
    orientation: 'ABSOLUTE',
    upperAnchor: 25,
  }),
  Object.freeze({
    key: 'severity.response-time-context-cs.v1',
    metric: 'average-response-time-delta',
    unit: 'CENTISECONDS',
    direction: 'CONTEXT_DIFFERENCE',
    orientation: 'ABSOLUTE',
    upperAnchor: 300,
  }),
  Object.freeze({
    key: 'severity.rating-composition-points.v1',
    metric: 'absolute-mean-rating-difference-delta',
    unit: 'RATING_POINTS',
    direction: 'HIGHER_IS_MORE_CONFOUNDING',
    orientation: 'AS_IS',
    upperAnchor: 200,
  }),
]);

const FREQUENCY_NORMALIZATION: DiagnosisRankingNormalizationSpec = Object.freeze({
  key: 'frequency.distinct-games.5-40.v1',
  method: 'LINEAR_CLAMP',
  lowerAnchor: DIAGNOSIS_EVIDENCE_POLICY.minimumSupportingSample,
  upperAnchor: DIAGNOSIS_EVIDENCE_POLICY.highSupportingSample,
  direction: 'ASCENDING',
});

const EVIDENCE_NORMALIZATION: DiagnosisRankingNormalizationSpec = Object.freeze({
  key: 'evidence.required-coverage.v1',
  method: 'IDENTITY_0_1',
});

const RECURRENCE_NORMALIZATION: DiagnosisRankingNormalizationSpec = Object.freeze({
  key: 'recurrence.distinct-sessions.1-5.v1',
  method: 'LINEAR_CLAMP',
  lowerAnchor: 1,
  upperAnchor: 5,
  direction: 'ASCENDING',
});

const SPECIFICITY_NORMALIZATION: DiagnosisRankingNormalizationSpec = Object.freeze({
  key: 'specificity.finding-level.v1',
  method: 'IDENTITY_0_1',
});

const ROOT_SEVERITY_NORMALIZATION: DiagnosisRankingNormalizationSpec = Object.freeze({
  key: 'severity.root-mandatory-child-max.v1',
  method: 'IDENTITY_0_1',
});

const EVIDENCE_ORDER: Readonly<Record<DiagnosisEvidenceStrength, number>> = Object.freeze({
  INSUFFICIENT: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
});

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asEvidenceStrength(value: string): DiagnosisEvidenceStrength {
  if (value === 'INSUFFICIENT' || value === 'LOW' || value === 'MEDIUM' || value === 'HIGH') {
    return value;
  }
  throw new Error('Diagnosis ranking encountered an unsupported evidence strength.');
}

function stableFindingOrder(left: PersistedDiagnosisFinding, right: PersistedDiagnosisFinding): number {
  const diagnosisOrder = left.diagnosisId.localeCompare(right.diagnosisId);
  if (diagnosisOrder !== 0) return diagnosisOrder;
  return left.findingKey.localeCompare(right.findingKey);
}

function component(
  componentName: DiagnosisRankingComponentName,
  rawValue: number,
  normalization: DiagnosisRankingNormalizationSpec,
  source: Readonly<Record<string, unknown>>,
): DiagnosisRankingComponentValue {
  return {
    component: componentName,
    normalizationKey: normalization.key,
    rawValue,
    normalizedValue: normalizeDiagnosisRankingComponent(rawValue, normalization),
    weight: DIAGNOSIS_RANKING_WEIGHTS[componentName],
    normalization,
    source,
  };
}

function orientedEffectValue(value: number, rule: EffectSeverityRule): number {
  if (!Number.isFinite(value)) throw new Error('Diagnosis ranking effect value must be finite.');
  if (rule.orientation === 'ABSOLUTE') return Math.abs(value);
  if (rule.orientation === 'NEGATE') return Math.max(0, -value);
  return Math.max(0, value);
}

function effectSeverity(
  finding: PersistedDiagnosisFinding,
): DiagnosisRankingComponentValue | null {
  const effect = finding.effect;
  if (!effect) return null;
  const rule = EFFECT_SEVERITY_RULES.find((candidate) => (
    candidate.metric === effect.metric
    && candidate.unit === effect.unit
    && candidate.direction === effect.direction
  ));
  if (!rule) {
    throw new Error(
      'Diagnosis ranking has no registered severity normalization for '
      + finding.diagnosisId + '/' + effect.metric + '/' + effect.unit + '/' + effect.direction + '.',
    );
  }
  const normalization: DiagnosisRankingNormalizationSpec = {
    key: rule.key,
    method: 'LINEAR_CLAMP',
    lowerAnchor: 0,
    upperAnchor: rule.upperAnchor,
    direction: 'ASCENDING',
  };
  const rawValue = orientedEffectValue(effect.value, rule);
  return component('severity', rawValue, normalization, {
    diagnosisId: finding.diagnosisId,
    findingKey: finding.findingKey,
    sourceMetric: effect.metric,
    sourceUnit: effect.unit,
    sourceDirection: effect.direction,
    originalValue: effect.value,
    orientation: rule.orientation,
  });
}

function specificityValue(finding: PersistedDiagnosisFinding): number {
  if (finding.findingLevel === 'MECHANISM' || finding.findingLevel === 'ROOT_CAUSE_CANDIDATE') {
    return 1;
  }
  if (finding.findingLevel === 'CONTRIBUTING_CONDITION') return 0.75;
  if (finding.findingLevel === 'OBSERVATION') return 0.5;
  throw new Error('Diagnosis ranking encountered an unsupported finding level.');
}

function validateHierarchy(
  snapshot: DiagnosisFindingSetSnapshot,
): ReadonlyMap<number, PersistedDiagnosisFindingConsolidation> {
  if (snapshot.consolidations.length !== snapshot.findings.length) {
    throw new Error('Diagnosis ranking requires a complete current consolidation state.');
  }
  const ids = new Set(snapshot.findings.map((finding) => finding.id));
  const result = new Map<number, PersistedDiagnosisFindingConsolidation>();
  for (const consolidation of snapshot.consolidations) {
    if (!ids.has(consolidation.findingId) || result.has(consolidation.findingId)) {
      throw new Error('Diagnosis ranking consolidation state is inconsistent with the current set.');
    }
    if (consolidation.policyVersion !== DIAGNOSIS_CONSOLIDATION_POLICY_VERSION) {
      throw new Error('Diagnosis ranking cannot consume a stale consolidation policy version.');
    }
    result.set(consolidation.findingId, consolidation);
  }
  return result;
}

function validateRootSupports(
  snapshot: DiagnosisFindingSetSnapshot,
): ReadonlyMap<number, readonly PersistedDiagnosisRootCandidateSupport[]> {
  const findingsById = new Map(snapshot.findings.map((finding) => [finding.id, finding]));
  const byRoot = new Map<number, PersistedDiagnosisRootCandidateSupport[]>();
  const pairs = new Set<string>();
  for (const support of snapshot.rootSupports) {
    const root = findingsById.get(support.rootFindingId);
    const child = findingsById.get(support.supportingFindingId);
    if (!root || !child || root.findingLevel !== 'ROOT_CAUSE_CANDIDATE') {
      throw new Error('Diagnosis ranking root support is inconsistent with the current finding set.');
    }
    const pair = String(support.rootFindingId) + '|' + String(support.supportingFindingId);
    if (pairs.has(pair)) throw new Error('Diagnosis ranking root support contains a duplicate pair.');
    pairs.add(pair);
    const current = byRoot.get(support.rootFindingId) ?? [];
    current.push(support);
    byRoot.set(support.rootFindingId, current);
  }
  for (const [rootId, supports] of byRoot) {
    byRoot.set(rootId, [...supports].sort((left, right) => {
      const roleOrder = left.role.localeCompare(right.role);
      return roleOrder !== 0 ? roleOrder : left.supportingFindingId - right.supportingFindingId;
    }));
  }
  return byRoot;
}

function supportedTopLevel(
  finding: PersistedDiagnosisFinding,
  consolidation: PersistedDiagnosisFindingConsolidation,
): boolean {
  return (
    consolidation.topLevelEligible
    && finding.observationState === 'PROBLEM_DETECTED'
    && finding.requiredEvidenceCoverage !== null
    && finding.requiredEvidenceCoverage >= DIAGNOSIS_EVIDENCE_POLICY.minimumRequiredEvidenceCoverage
    && asEvidenceStrength(finding.evidenceStrength) !== 'INSUFFICIENT'
  );
}

function rootSeverity(
  root: PersistedDiagnosisFinding,
  supports: readonly PersistedDiagnosisRootCandidateSupport[],
  findingsById: ReadonlyMap<number, PersistedDiagnosisFinding>,
): DiagnosisRankingComponentValue {
  const mandatory = supports.filter((support) => (
    support.role === 'MECHANISM' || support.role === 'CONDITION_OR_OBSERVATION'
  ));
  if (mandatory.length === 0) {
    throw new Error('Synthesized root ranking requires mandatory supporting findings.');
  }
  if (
    !mandatory.some((support) => support.role === 'MECHANISM')
    || !mandatory.some((support) => support.role === 'CONDITION_OR_OBSERVATION')
  ) {
    throw new Error('Synthesized root ranking requires both mechanism and context support.');
  }

  const childScores = mandatory.map((support) => {
    const child = findingsById.get(support.supportingFindingId);
    if (!child) throw new Error('Root severity support references a missing child finding.');
    const severity = effectSeverity(child);
    if (!severity) {
      throw new Error(
        'Synthesized root mandatory child is missing a rankable severity effect: ' + child.findingKey,
      );
    }
    return {
      findingId: child.id,
      findingKey: child.findingKey,
      diagnosisId: child.diagnosisId,
      normalizedSeverity: severity.normalizedValue,
      normalizationKey: severity.normalizationKey,
      rawEffect: child.effect,
    };
  });
  const rawValue = Math.max(...childScores.map((child) => child.normalizedSeverity));
  return component('severity', rawValue, ROOT_SEVERITY_NORMALIZATION, {
    diagnosisId: root.diagnosisId,
    findingKey: root.findingKey,
    aggregation: 'MAX_MANDATORY_CHILD_NORMALIZED_SEVERITY',
    children: childScores,
  });
}

function rankingComponents(
  finding: PersistedDiagnosisFinding,
  rootSupports: readonly PersistedDiagnosisRootCandidateSupport[],
  findingsById: ReadonlyMap<number, PersistedDiagnosisFinding>,
): DiagnosisRankingComponentValue[] {
  if (finding.requiredEvidenceCoverage === null) {
    throw new Error('Rankable finding is missing required-evidence coverage: ' + finding.findingKey);
  }

  const result: DiagnosisRankingComponentValue[] = [
    component('frequency', finding.distinctGameCount, FREQUENCY_NORMALIZATION, {
      sourceField: 'distinctGameCount',
      sourceUnit: 'GAMES',
      diagnosisId: finding.diagnosisId,
    }),
  ];

  const severity = (
    finding.findingLevel === 'ROOT_CAUSE_CANDIDATE'
    && finding.producerKey === 'diagnosis-root-synthesis'
  )
    ? rootSeverity(finding, rootSupports, findingsById)
    : effectSeverity(finding);
  if (!severity) {
    throw new Error('Rankable finding is missing a registered severity effect: ' + finding.findingKey);
  }
  result.push(severity);

  result.push(component(
    'evidence',
    finding.requiredEvidenceCoverage,
    EVIDENCE_NORMALIZATION,
    {
      sourceField: 'requiredEvidenceCoverage',
      sourceUnit: 'FRACTION',
      diagnosisId: finding.diagnosisId,
    },
  ));

  if (finding.distinctSessionCount > 0) {
    result.push(component(
      'recurrence',
      finding.distinctSessionCount,
      RECURRENCE_NORMALIZATION,
      {
        sourceField: 'distinctSessionCount',
        sourceUnit: 'SESSIONS',
        diagnosisId: finding.diagnosisId,
      },
    ));
  }

  const specificity = specificityValue(finding);
  result.push(component('specificity', specificity, SPECIFICITY_NORMALIZATION, {
    sourceField: 'findingLevel',
    sourceValue: finding.findingLevel,
    diagnosisId: finding.diagnosisId,
  }));

  return result;
}

function weightedScore(components: readonly DiagnosisRankingComponentValue[]): number {
  const required = new Set<DiagnosisRankingComponentName>(['frequency', 'severity', 'evidence']);
  for (const name of required) {
    if (!components.some((item) => item.component === name)) {
      throw new Error('Diagnosis ranking is missing required component ' + name + '.');
    }
  }
  const denominator = components.reduce((sum, item) => sum + item.weight, 0);
  if (!(denominator > 0)) throw new Error('Diagnosis ranking component weight denominator is empty.');
  return components.reduce(
    (sum, item) => sum + item.normalizedValue * item.weight,
    0,
  ) / denominator;
}

function overlapMultiplier(consolidation: PersistedDiagnosisFindingConsolidation): number {
  return (
    consolidation.state === 'TOP_LEVEL_MATERIAL_OVERLAP'
    || consolidation.reasonKeys.includes('UNRESOLVED_MATERIAL_OVERLAP')
  )
    ? DIAGNOSIS_UNRESOLVED_MATERIAL_OVERLAP_MULTIPLIER
    : 1;
}

function numericArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const result = value.filter(
    (item): item is number => Number.isSafeInteger(item) && Number(item) > 0,
  );
  return [...new Set(result)].sort((left, right) => left - right);
}

function confounderFindingIds(consolidation: PersistedDiagnosisFindingConsolidation): number[] {
  if (!isRecord(consolidation.support)) return [];
  return numericArray(consolidation.support.confounderFindingIds);
}

function compareRanking(
  left: DiagnosisFindingRankingDraft,
  right: DiagnosisFindingRankingDraft,
  findingsById: ReadonlyMap<number, PersistedDiagnosisFinding>,
): number {
  if (left.finalScore !== right.finalScore) return right.finalScore - left.finalScore;
  const leftFinding = findingsById.get(left.findingId);
  const rightFinding = findingsById.get(right.findingId);
  if (!leftFinding || !rightFinding) throw new Error('Ranking tie-break references a missing finding.');
  const evidenceOrder = EVIDENCE_ORDER[asEvidenceStrength(rightFinding.evidenceStrength)]
    - EVIDENCE_ORDER[asEvidenceStrength(leftFinding.evidenceStrength)];
  if (evidenceOrder !== 0) return evidenceOrder;
  if (leftFinding.distinctGameCount !== rightFinding.distinctGameCount) {
    return rightFinding.distinctGameCount - leftFinding.distinctGameCount;
  }
  const diagnosisOrder = leftFinding.diagnosisId.localeCompare(rightFinding.diagnosisId);
  if (diagnosisOrder !== 0) return diagnosisOrder;
  return leftFinding.findingKey.localeCompare(rightFinding.findingKey);
}

export function buildDiagnosisRanking(
  snapshot: DiagnosisFindingSetSnapshot,
): DiagnosisRankingBuildResult {
  if (!snapshot.isCurrent || snapshot.supersededAt !== null) {
    throw new Error('Diagnosis ranking requires a current canonical finding set.');
  }
  if (snapshot.synthesisPolicyVersion !== DIAGNOSIS_SYNTHESIS_POLICY_VERSION) {
    throw new Error('Diagnosis ranking only supports the current synthesis-policy version.');
  }

  const consolidationByFindingId = validateHierarchy(snapshot);
  const rootSupportsByRootId = validateRootSupports(snapshot);
  const findingsById = new Map(snapshot.findings.map((finding) => [finding.id, finding]));

  const eligible = snapshot.findings
    .filter((finding) => {
      const consolidation = consolidationByFindingId.get(finding.id);
      return consolidation ? supportedTopLevel(finding, consolidation) : false;
    })
    .sort(stableFindingOrder);

  const eligibleIds = new Set(eligible.map((finding) => finding.id));
  const supportedSynthesizedRootIds = new Set<number>();
  for (const finding of eligible) {
    if (
      finding.findingLevel === 'ROOT_CAUSE_CANDIDATE'
      && finding.producerKey === 'diagnosis-root-synthesis'
    ) {
      const supports = rootSupportsByRootId.get(finding.id) ?? [];
      rootSeverity(finding, supports, findingsById);
      supportedSynthesizedRootIds.add(finding.id);
    }
  }

  const parentRootIdsByFindingId = new Map<number, number[]>();
  for (const rootId of supportedSynthesizedRootIds) {
    for (const support of rootSupportsByRootId.get(rootId) ?? []) {
      if (!eligibleIds.has(support.supportingFindingId)) continue;
      const current = parentRootIdsByFindingId.get(support.supportingFindingId) ?? [];
      current.push(rootId);
      parentRootIdsByFindingId.set(
        support.supportingFindingId,
        [...new Set(current)].sort((left, right) => left - right),
      );
    }
  }

  const drafts: DiagnosisFindingRankingDraft[] = eligible.map((finding) => {
    const consolidation = consolidationByFindingId.get(finding.id);
    if (!consolidation) throw new Error('Eligible ranking finding is missing consolidation state.');
    const components = rankingComponents(
      finding,
      rootSupportsByRootId.get(finding.id) ?? [],
      findingsById,
    );
    const weighted = weightedScore(components);
    const evidenceMultiplier = diagnosisEvidenceRankingMultiplier(
      asEvidenceStrength(finding.evidenceStrength),
    );
    const overlap = overlapMultiplier(consolidation);
    const parents = parentRootIdsByFindingId.get(finding.id) ?? [];
    const topLevelRanked = parents.length === 0;
    const finalScore = weighted * evidenceMultiplier * overlap;
    if (!Number.isFinite(finalScore) || finalScore < 0 || finalScore > 1) {
      throw new Error('Diagnosis ranking produced an invalid final score.');
    }
    return {
      findingId: finding.id,
      topLevelRanked,
      rankPosition: null,
      finalScore,
      weightedScore: weighted,
      evidenceMultiplier,
      overlapMultiplier: overlap,
      rankingPolicyVersion: DIAGNOSIS_RANKING_POLICY_VERSION,
      components,
      rawEffect: finding.effect
        ? {
            metric: finding.effect.metric,
            value: finding.effect.value,
            unit: finding.effect.unit,
            direction: finding.effect.direction,
            comparator: finding.effect.comparator,
          }
        : null,
      consolidationState: consolidation.state,
      parentRootFindingIds: parents,
      support: {
        findingKey: finding.findingKey,
        diagnosisId: finding.diagnosisId,
        findingLevel: finding.findingLevel,
        evidenceStrength: finding.evidenceStrength,
        requiredEvidenceCoverage: finding.requiredEvidenceCoverage,
        distinctGameCount: finding.distinctGameCount,
        distinctSessionCount: finding.distinctSessionCount,
        clusterKey: consolidation.clusterKey,
        consolidationReasonKeys: consolidation.reasonKeys,
        confounderFindingIds: confounderFindingIds(consolidation),
        rootSupportChildFindingIds: (rootSupportsByRootId.get(finding.id) ?? [])
          .map((support) => support.supportingFindingId)
          .sort((left, right) => left - right),
        calculationVersion: DIAGNOSIS_RANKING_CALCULATION_VERSION,
      },
    };
  });

  const topLevel = drafts
    .filter((draft) => draft.topLevelRanked)
    .sort((left, right) => compareRanking(left, right, findingsById));
  topLevel.forEach((draft, index) => {
    draft.rankPosition = index + 1;
  });

  const childRows = drafts
    .filter((draft) => !draft.topLevelRanked)
    .sort((left, right) => compareRanking(left, right, findingsById));

  return {
    rankings: [...topLevel, ...childRows],
    topLevelFindingIds: topLevel.map((draft) => draft.findingId),
  };
}

export async function materializeCurrentDiagnosisRanking(
  appUserId: number,
  scopeKey: string,
  versions: DiagnosisFindingVersionTuple,
  repository: DiagnosisRankingRepository,
): Promise<DiagnosisRankingResult> {
  if (!Number.isSafeInteger(appUserId) || appUserId <= 0) {
    throw new RangeError('appUserId must be a positive safe integer.');
  }
  if (scopeKey.length === 0 || scopeKey.length > 128) {
    throw new RangeError('scopeKey must contain 1-128 characters.');
  }
  if (versions.synthesisPolicyVersion !== DIAGNOSIS_SYNTHESIS_POLICY_VERSION) {
    throw new Error('Diagnosis ranking only supports the current synthesis-policy version.');
  }
  if (!isRecord(versions.policyVersions)) {
    throw new Error('Diagnosis ranking requires an inspectable policy-version tuple.');
  }
  if (versions.policyVersions.consolidation !== DIAGNOSIS_CONSOLIDATION_POLICY_VERSION) {
    throw new Error('Diagnosis ranking only supports the current consolidation-policy version.');
  }
  if (versions.policyVersions.ranking !== DIAGNOSIS_RANKING_POLICY_VERSION) {
    throw new Error('Diagnosis ranking only supports the current ranking-policy version.');
  }

  const snapshot = await repository.getCurrentScope(appUserId, scopeKey, versions);
  if (!snapshot || !snapshot.isCurrent || snapshot.supersededAt !== null) {
    throw new Error('Current diagnosis finding scope is unavailable for ranking.');
  }
  await repository.assertCurrentSourceReferences(appUserId, snapshot);

  const build = buildDiagnosisRanking(snapshot);
  const rankings = await repository.replaceCurrentRankings(
    appUserId,
    snapshot.id,
    DIAGNOSIS_RANKING_POLICY_VERSION,
    build.rankings,
  );
  return {
    findingSetId: snapshot.id,
    scopeKey: snapshot.scopeKey,
    calculationVersion: DIAGNOSIS_RANKING_CALCULATION_VERSION,
    rankingPolicyVersion: DIAGNOSIS_RANKING_POLICY_VERSION,
    rankings,
  };
}
