import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DIAGNOSIS_RELATIONSHIP_GRAPH_VERSION,
  buildDiagnosisRelationshipGraph,
  materializeCurrentDiagnosisRelationshipGraph,
} from '../dist/modules/diagnosis/diagnosis-relationship.service.js';

function finding(id, diagnosisId, overrides = {}) {
  return {
    id,
    findingKey: overrides.findingKey ?? diagnosisId.toLowerCase() + '-' + id,
    diagnosisId,
    findingLevel: overrides.findingLevel ?? 'MECHANISM',
    observationState: overrides.observationState ?? 'PROBLEM_DETECTED',
    claimKey: overrides.claimKey ?? 'fixture.' + diagnosisId.toLowerCase(),
    producerKey: overrides.producerKey ?? 'fixture',
    producerVersion: overrides.producerVersion ?? 'fixture-v1',
    sampleCount: overrides.sampleCount ?? 10,
    distinctGameCount: overrides.distinctGameCount ?? 5,
    distinctSessionCount: overrides.distinctSessionCount ?? 0,
    requiredEvidenceCoverage: overrides.requiredEvidenceCoverage ?? 1,
    evidenceStrength: overrides.evidenceStrength ?? 'LOW',
    dimensions: overrides.dimensions ?? {},
    coverage: overrides.coverage ?? {},
    effect: overrides.effect ?? null,
    sourceVersions: overrides.sourceVersions ?? { fixture: 'v1' },
    evidenceReferences: overrides.evidenceReferences ?? [],
  };
}

function overlap(left, right, {
  material = true,
  intersectionEventCount = 3,
  leftEventCount = 4,
  rightEventCount = 5,
  sharedDistinctGames = 3,
} = {}) {
  const unionEventCount = leftEventCount + rightEventCount - intersectionEventCount;
  return {
    calculationVersion: 'diagnosis-overlap-v1',
    eventIdentityVersion: 'diagnosis-event-identity-v1',
    left: {
      id: left.id,
      findingKey: left.findingKey,
      diagnosisId: left.diagnosisId,
      coverage: {
        status: 'COMPLETE',
        referenceCount: leftEventCount,
        identifiedReferenceCount: leftEventCount,
        uniqueEventCount: leftEventCount,
        referencedDistinctGames: left.distinctGameCount,
        referencedDistinctSessions: left.distinctSessionCount,
        declaredDistinctGames: left.distinctGameCount,
        declaredDistinctSessions: left.distinctSessionCount,
        gameSetComplete: true,
        eventIdentityComplete: true,
        sessionContextComplete: true,
      },
    },
    right: {
      id: right.id,
      findingKey: right.findingKey,
      diagnosisId: right.diagnosisId,
      coverage: {
        status: 'COMPLETE',
        referenceCount: rightEventCount,
        identifiedReferenceCount: rightEventCount,
        uniqueEventCount: rightEventCount,
        referencedDistinctGames: right.distinctGameCount,
        referencedDistinctSessions: right.distinctSessionCount,
        declaredDistinctGames: right.distinctGameCount,
        declaredDistinctSessions: right.distinctSessionCount,
        gameSetComplete: true,
        eventIdentityComplete: true,
        sessionContextComplete: true,
      },
    },
    eventOverlap: {
      calculable: true,
      reason: null,
      leftEventCount,
      rightEventCount,
      intersectionEventCount,
      unionEventCount,
      leftOverlapRate: intersectionEventCount / leftEventCount,
      rightOverlapRate: intersectionEventCount / rightEventCount,
      smallerArmOverlapRate: intersectionEventCount / Math.min(leftEventCount, rightEventCount),
      jaccardRate: intersectionEventCount / unionEventCount,
      sharedDistinctGames,
      sharedDistinctSessions: 0,
      largestSharedGameEventShare: 1 / sharedDistinctGames,
      material,
    },
    gameSetOverlap: {
      calculable: true,
      reason: null,
      leftDistinctGames: left.distinctGameCount,
      rightDistinctGames: right.distinctGameCount,
      intersectionGameCount: Math.min(left.distinctGameCount, right.distinctGameCount),
      unionGameCount: Math.max(left.distinctGameCount, right.distinctGameCount),
      leftOverlapRate: 1,
      rightOverlapRate: 1,
      jaccardRate: 1,
      sharedDistinctSessions: 0,
    },
  };
}

function edgeTypes(edges) {
  return new Set(edges.map((edge) => edge.relationshipType));
}

test('graph implements the complete typed relationship vocabulary with deterministic directions', () => {
  const tactical = finding(10, 'TACT-004', { findingKey: 'tactical-hanging' });
  const tacticalRate = finding(11, 'TACT-006', {
    findingKey: 'tactical-rate',
    findingLevel: 'OBSERVATION',
  });
  const pressureQuality = finding(12, 'TIME-002', {
    findingKey: 'pressure-quality',
    findingLevel: 'CONTRIBUTING_CONDITION',
  });
  const earlyOveruse = finding(13, 'TIME-004', { findingKey: 'early-overuse' });
  const pressureExposure = finding(14, 'TIME-001', {
    findingKey: 'pressure-exposure',
    findingLevel: 'OBSERVATION',
  });
  const sessionRoot = finding(15, 'SESSION-003', {
    findingKey: 'session-root',
    findingLevel: 'ROOT_CAUSE_CANDIDATE',
  });
  const lateSession = finding(16, 'SESSION-001', {
    findingKey: 'late-session',
    findingLevel: 'CONTRIBUTING_CONDITION',
  });
  const exactControl = finding(17, 'TIME-005', {
    findingKey: 'exact-control',
    findingLevel: 'OBSERVATION',
    coverage: {
      ratingComposition: {
        status: 'AVAILABLE',
        result: {
          comparison: { materialCompositionWarning: true },
        },
      },
    },
  });
  const ratingConfounder = finding(18, 'RATING-002', {
    findingKey: 'rating-confounder',
    findingLevel: 'OBSERVATION',
    effect: {
      metric: 'absolute-mean-rating-difference-delta',
      value: 150,
      unit: 'RATING_POINTS',
      direction: 'HIGHER_IS_MORE_DIFFERENT',
      comparator: null,
    },
  });

  const edges = buildDiagnosisRelationshipGraph(
    [
      tactical,
      tacticalRate,
      pressureQuality,
      earlyOveruse,
      pressureExposure,
      sessionRoot,
      lateSession,
      exactControl,
      ratingConfounder,
    ],
    [overlap(tactical, pressureQuality)],
  );

  assert.deepEqual(
    edgeTypes(edges),
    new Set([
      'SPECIALIZES',
      'MANIFESTS_AS',
      'CONTRIBUTES_TO',
      'CONDITIONAL_ON',
      'EXPLAINS_OBSERVATION',
      'SHARES_EVENTS_WITH',
      'CONFOUNDED_BY',
    ]),
  );

  assert.ok(edges.some((edge) => (
    edge.relationshipType === 'SPECIALIZES'
    && edge.sourceFindingId === tactical.id
    && edge.targetFindingId === tacticalRate.id
  )));
  assert.ok(edges.some((edge) => (
    edge.relationshipType === 'CONDITIONAL_ON'
    && edge.sourceFindingId === tactical.id
    && edge.targetFindingId === pressureQuality.id
  )));
  assert.ok(edges.some((edge) => (
    edge.relationshipType === 'CONTRIBUTES_TO'
    && edge.sourceFindingId === earlyOveruse.id
    && edge.targetFindingId === pressureQuality.id
  )));
  assert.ok(edges.some((edge) => (
    edge.relationshipType === 'EXPLAINS_OBSERVATION'
    && edge.sourceFindingId === earlyOveruse.id
    && edge.targetFindingId === pressureExposure.id
  )));
  assert.ok(edges.some((edge) => (
    edge.relationshipType === 'MANIFESTS_AS'
    && edge.sourceFindingId === sessionRoot.id
    && edge.targetFindingId === lateSession.id
  )));
  assert.ok(edges.some((edge) => (
    edge.relationshipType === 'CONFOUNDED_BY'
    && edge.sourceFindingId === exactControl.id
    && edge.targetFindingId === ratingConfounder.id
  )));

  const shared = edges.find((edge) => edge.relationshipType === 'SHARES_EVENTS_WITH');
  assert.ok(shared);
  assert.equal(shared.sourceFindingId, pressureQuality.id);
  assert.equal(shared.targetFindingId, tactical.id);
  assert.equal(shared.support.overlap.calculationVersion, 'diagnosis-overlap-v1');
  assert.equal(shared.support.overlap.material, true);

  for (const edge of edges) {
    assert.equal(edge.policyVersion, 'diagnosis-synthesis-v1');
    assert.equal(edge.support.graphVersion, DIAGNOSIS_RELATIONSHIP_GRAPH_VERSION);
  }
});

test('conditional and shared-event edges fail closed without material #84 overlap', () => {
  const tactical = finding(1, 'TACT-004');
  const pressureQuality = finding(2, 'TIME-002', { findingLevel: 'CONTRIBUTING_CONDITION' });
  const edges = buildDiagnosisRelationshipGraph(
    [tactical, pressureQuality],
    [overlap(tactical, pressureQuality, { material: false, intersectionEventCount: 1, sharedDistinctGames: 1 })],
  );

  assert.equal(edges.some((edge) => edge.relationshipType === 'CONDITIONAL_ON'), false);
  assert.equal(edges.some((edge) => edge.relationshipType === 'SHARES_EVENTS_WITH'), false);
});

test('rating confounding requires explicit upstream composition evidence', () => {
  const exactControl = finding(1, 'TIME-005', {
    findingLevel: 'OBSERVATION',
    coverage: { ratingComposition: { status: 'AVAILABLE' } },
  });
  const ratingConfounder = finding(2, 'RATING-002', { findingLevel: 'OBSERVATION' });

  const edges = buildDiagnosisRelationshipGraph([exactControl, ratingConfounder], []);
  assert.equal(edges.some((edge) => edge.relationshipType === 'CONFOUNDED_BY'), false);
});

test('non-detected findings are not graph endpoints', () => {
  const mechanism = finding(1, 'TIME-004', {
    observationState: 'NOT_DETECTED_WITH_ADEQUATE_COVERAGE',
  });
  const observation = finding(2, 'TIME-001', { findingLevel: 'OBSERVATION' });

  assert.deepEqual(buildDiagnosisRelationshipGraph([mechanism, observation], []), []);
});

test('graph generation is idempotent for the same current finding set and overlap input', () => {
  const mechanism = finding(2, 'TIME-004', { findingKey: 'mechanism' });
  const condition = finding(1, 'TIME-002', {
    findingKey: 'condition',
    findingLevel: 'CONTRIBUTING_CONDITION',
  });
  const first = buildDiagnosisRelationshipGraph([mechanism, condition], []);
  const second = buildDiagnosisRelationshipGraph([condition, mechanism], []);
  assert.deepEqual(first, second);
});

test('current-scope materialization rejects stale scopes and persists only current endpoints', async () => {
  const left = finding(21, 'TIME-004');
  const right = finding(22, 'TIME-002', { findingLevel: 'CONTRIBUTING_CONDITION' });
  const versions = {
    taxonomyVersion: 'taxonomy-v1',
    synthesisPolicyVersion: 'diagnosis-synthesis-v1',
    calculationVersion: 'calculation-v1',
    policyVersions: { eventIdentity: 'diagnosis-event-identity-v1' },
  };
  let sourceChecks = 0;
  let persisted = null;
  const repository = {
    async getCurrentScope() {
      return {
        id: 99,
        appUserId: 7,
        materializationKey: 'materialization',
        scopeKey: 'scope-a',
        scope: {},
        taxonomyVersion: versions.taxonomyVersion,
        synthesisPolicyVersion: versions.synthesisPolicyVersion,
        calculationVersion: versions.calculationVersion,
        policyVersions: versions.policyVersions,
        calculationAsOf: new Date('2026-09-27T00:00:00Z'),
        isCurrent: true,
        supersededAt: null,
        findings: [left, right],
        relationships: [],
      };
    },
    async assertCurrentSourceReferences(appUserId, snapshot) {
      sourceChecks += 1;
      assert.equal(appUserId, 7);
      assert.equal(snapshot.id, 99);
    },
    async replaceCurrentRelationships(appUserId, findingSetId, policyVersion, relationships) {
      assert.equal(appUserId, 7);
      assert.equal(findingSetId, 99);
      assert.equal(policyVersion, 'diagnosis-synthesis-v1');
      persisted = relationships;
      return relationships.map((relationship, index) => ({
        id: index + 1,
        ...relationship,
      }));
    },
  };

  const result = await materializeCurrentDiagnosisRelationshipGraph(
    7,
    'scope-a',
    versions,
    repository,
  );
  assert.equal(sourceChecks, 1);
  assert.ok(persisted);
  assert.equal(result.findingSetId, 99);
  assert.equal(result.graphVersion, 'diagnosis-relationship-graph-v1');
  assert.ok(result.relationships.every((edge) => [21, 22].includes(edge.sourceFindingId)));
  assert.ok(result.relationships.every((edge) => [21, 22].includes(edge.targetFindingId)));

  await assert.rejects(
    materializeCurrentDiagnosisRelationshipGraph(
      7,
      'scope-a',
      versions,
      {
        ...repository,
        async getCurrentScope() {
          return null;
        },
      },
    ),
    /unavailable for relationship synthesis/,
  );
});
