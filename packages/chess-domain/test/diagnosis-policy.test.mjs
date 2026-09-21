import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DIAGNOSIS_EVIDENCE_RANKING_MULTIPLIER,
  DIAGNOSIS_POLICY_REGISTRY,
  DIAGNOSIS_RANKING_WEIGHTS,
  assertDiagnosisPolicyInvariants,
  diagnosisEvidenceRankingMultiplier,
  diagnosisSmallerArmOverlapRate,
  isMaterialDiagnosisEventOverlap,
  normalizeDiagnosisRankingComponent,
} from '../dist/index.js';

test('Phase 5 diagnosis policy registry keeps stable versioned semantics', () => {
  assert.deepEqual(DIAGNOSIS_POLICY_REGISTRY.versions, {
    synthesis: 'diagnosis-synthesis-v1',
    consolidation: 'diagnosis-consolidation-v1',
    ranking: 'diagnosis-ranking-v1',
    eventIdentity: 'diagnosis-event-identity-v1',
  });
  assert.deepEqual(DIAGNOSIS_POLICY_REGISTRY.relationshipTypes, [
    'SPECIALIZES',
    'MANIFESTS_AS',
    'CONTRIBUTES_TO',
    'CONDITIONAL_ON',
    'EXPLAINS_OBSERVATION',
    'SHARES_EVENTS_WITH',
    'CONFOUNDED_BY',
  ]);
  assert.deepEqual(
    DIAGNOSIS_POLICY_REGISTRY.rootCauseThemes.map((theme) => theme.key),
    [
      'CLOCK_MANAGEMENT_DRIVING_TACTICAL_COLLAPSE',
      'LATE_SESSION_TACTICAL_DETERIORATION',
    ],
  );
  assert.deepEqual(
    DIAGNOSIS_POLICY_REGISTRY.rootCauseThemes[1].conditionOrObservationDiagnosisIds,
    ['SESSION-001', 'SESSION-002'],
  );
  assert.equal(DIAGNOSIS_POLICY_REGISTRY.overlap.materialSmallerArmRate, 0.6);
  assert.equal(DIAGNOSIS_POLICY_REGISTRY.evidence.minimumRequiredEvidenceCoverage, 0.5);
});

test('ranking weights and evidence multipliers are deterministic and fail closed', () => {
  assertDiagnosisPolicyInvariants();
  const weightSum = Object.values(DIAGNOSIS_RANKING_WEIGHTS)
    .reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(weightSum - 1) < 1e-12);
  assert.deepEqual(DIAGNOSIS_EVIDENCE_RANKING_MULTIPLIER, {
    INSUFFICIENT: 0,
    LOW: 0.55,
    MEDIUM: 0.8,
    HIGH: 1,
  });
  assert.equal(diagnosisEvidenceRankingMultiplier('INSUFFICIENT'), 0);
  assert.equal(diagnosisEvidenceRankingMultiplier('HIGH'), 1);
});

test('ranking normalization is explicit, bounded, and fail-closed', () => {
  assert.equal(normalizeDiagnosisRankingComponent(0.7, {
    key: 'already-bounded-v1',
    method: 'IDENTITY_0_1',
  }), 0.7);
  assert.equal(normalizeDiagnosisRankingComponent(15, {
    key: 'example-linear-v1',
    method: 'LINEAR_CLAMP',
    lowerAnchor: 10,
    upperAnchor: 20,
    direction: 'ASCENDING',
  }), 0.5);
  assert.equal(normalizeDiagnosisRankingComponent(25, {
    key: 'example-linear-v1',
    method: 'LINEAR_CLAMP',
    lowerAnchor: 10,
    upperAnchor: 20,
    direction: 'ASCENDING',
  }), 1);
  assert.equal(normalizeDiagnosisRankingComponent(12, {
    key: 'example-descending-v1',
    method: 'LINEAR_CLAMP',
    lowerAnchor: 10,
    upperAnchor: 20,
    direction: 'DESCENDING',
  }), 0.8);
  assert.throws(() => normalizeDiagnosisRankingComponent(1.1, {
    key: 'invalid-bounded-v1',
    method: 'IDENTITY_0_1',
  }));
  assert.throws(() => normalizeDiagnosisRankingComponent(5, {
    key: 'invalid-linear-v1',
    method: 'LINEAR_CLAMP',
    lowerAnchor: 10,
    upperAnchor: 10,
    direction: 'ASCENDING',
  }));
});

test('material event overlap requires repeated shared evidence across games', () => {
  const material = {
    calculable: true,
    leftEventCount: 5,
    rightEventCount: 4,
    intersectionEventCount: 3,
    sharedDistinctGames: 3,
  };
  assert.equal(diagnosisSmallerArmOverlapRate(material), 0.75);
  assert.equal(isMaterialDiagnosisEventOverlap(material), true);

  assert.equal(isMaterialDiagnosisEventOverlap({
    ...material,
    intersectionEventCount: 1,
    sharedDistinctGames: 1,
  }), false);
  assert.equal(isMaterialDiagnosisEventOverlap({
    ...material,
    calculable: false,
  }), false);
});
