import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDiagnosisConsolidation,
  materializeCurrentDiagnosisConsolidation,
} from '../dist/modules/diagnosis/diagnosis-consolidation.service.js';

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

function relationship(id, source, target, relationshipType) {
  return {
    id,
    sourceFindingId: source.id,
    targetFindingId: target.id,
    relationshipType,
    policyVersion: 'diagnosis-synthesis-v1',
    support: { fixture: true },
  };
}

function overlap(left, right, {
  material = true,
  calculable = true,
  intersectionEventCount = 3,
  leftEventCount = 4,
  rightEventCount = 5,
  sharedDistinctGames = 3,
} = {}) {
  const unionEventCount = leftEventCount + rightEventCount - intersectionEventCount;
  const smallerArm = Math.min(leftEventCount, rightEventCount);
  return {
    calculationVersion: 'diagnosis-overlap-v1',
    eventIdentityVersion: 'diagnosis-event-identity-v1',
    left: {
      id: left.id,
      findingKey: left.findingKey,
      diagnosisId: left.diagnosisId,
      coverage: {
        status: calculable ? 'COMPLETE' : 'PARTIAL',
        referenceCount: leftEventCount,
        identifiedReferenceCount: calculable ? leftEventCount : 0,
        uniqueEventCount: calculable ? leftEventCount : 0,
        referencedDistinctGames: calculable ? left.distinctGameCount : 0,
        referencedDistinctSessions: left.distinctSessionCount,
        declaredDistinctGames: left.distinctGameCount,
        declaredDistinctSessions: left.distinctSessionCount,
        gameSetComplete: calculable,
        eventIdentityComplete: calculable,
        sessionContextComplete: true,
      },
    },
    right: {
      id: right.id,
      findingKey: right.findingKey,
      diagnosisId: right.diagnosisId,
      coverage: {
        status: calculable ? 'COMPLETE' : 'PARTIAL',
        referenceCount: rightEventCount,
        identifiedReferenceCount: calculable ? rightEventCount : 0,
        uniqueEventCount: calculable ? rightEventCount : 0,
        referencedDistinctGames: calculable ? right.distinctGameCount : 0,
        referencedDistinctSessions: right.distinctSessionCount,
        declaredDistinctGames: right.distinctGameCount,
        declaredDistinctSessions: right.distinctSessionCount,
        gameSetComplete: calculable,
        eventIdentityComplete: calculable,
        sessionContextComplete: true,
      },
    },
    eventOverlap: {
      calculable,
      reason: calculable ? null : 'EVENT_IDENTITY_INCOMPLETE',
      leftEventCount: calculable ? leftEventCount : 0,
      rightEventCount: calculable ? rightEventCount : 0,
      intersectionEventCount: calculable ? intersectionEventCount : 0,
      unionEventCount: calculable ? unionEventCount : 0,
      leftOverlapRate: calculable ? intersectionEventCount / leftEventCount : null,
      rightOverlapRate: calculable ? intersectionEventCount / rightEventCount : null,
      smallerArmOverlapRate: calculable ? intersectionEventCount / smallerArm : null,
      jaccardRate: calculable ? intersectionEventCount / unionEventCount : null,
      sharedDistinctGames: calculable ? sharedDistinctGames : 0,
      sharedDistinctSessions: 0,
      largestSharedGameEventShare: calculable && sharedDistinctGames > 0
        ? 1 / sharedDistinctGames
        : null,
      material,
    },
    gameSetOverlap: {
      calculable,
      reason: calculable ? null : 'GAME_SET_INCOMPLETE',
      leftDistinctGames: left.distinctGameCount,
      rightDistinctGames: right.distinctGameCount,
      intersectionGameCount: calculable
        ? Math.min(left.distinctGameCount, right.distinctGameCount)
        : 0,
      unionGameCount: calculable
        ? Math.max(left.distinctGameCount, right.distinctGameCount)
        : 0,
      leftOverlapRate: calculable ? 1 : null,
      rightOverlapRate: calculable ? 1 : null,
      jaccardRate: calculable ? 1 : null,
      sharedDistinctSessions: 0,
    },
  };
}

function stateFor(result, findingId) {
  const state = result.find((item) => item.findingId === findingId);
  assert.ok(state, 'expected consolidation state for finding ' + findingId);
  return state;
}

test('specific mechanism suppresses a materially overlapping generic observation without deleting either finding', () => {
  const mechanism = finding(1, 'TACT-004', { findingKey: 'hanging-material' });
  const generic = finding(2, 'TACT-006', {
    findingKey: 'tactical-error-rate',
    findingLevel: 'OBSERVATION',
  });

  const result = buildDiagnosisConsolidation(
    [generic, mechanism],
    [relationship(10, mechanism, generic, 'SPECIALIZES')],
    [overlap(mechanism, generic)],
  );

  const mechanismState = stateFor(result, mechanism.id);
  const genericState = stateFor(result, generic.id);

  assert.equal(mechanismState.topLevelEligible, true);
  assert.equal(mechanismState.state, 'TOP_LEVEL');
  assert.equal(genericState.topLevelEligible, false);
  assert.equal(genericState.state, 'SUPPRESSED_DRILLDOWN');
  assert.equal(genericState.representativeFindingId, mechanism.id);
  assert.deepEqual(
    genericState.reasonKeys,
    ['SPECIFIC_MECHANISM_SPECIALIZES_GENERIC_FINDING'],
  );
  assert.equal(genericState.support.overlap.material, true);
  assert.equal(genericState.clusterKey, mechanismState.clusterKey);
  assert.equal(result.length, 2, 'consolidation must retain one state per source finding');
});

test('partial overlap does not allow a specific mechanism to suppress a generic finding', () => {
  const mechanism = finding(1, 'TACT-004');
  const generic = finding(2, 'TACT-006', { findingLevel: 'OBSERVATION' });

  const result = buildDiagnosisConsolidation(
    [mechanism, generic],
    [relationship(10, mechanism, generic, 'SPECIALIZES')],
    [overlap(mechanism, generic, {
      material: false,
      intersectionEventCount: 1,
      sharedDistinctGames: 1,
    })],
  );

  assert.equal(stateFor(result, mechanism.id).state, 'TOP_LEVEL');
  assert.equal(stateFor(result, generic.id).state, 'TOP_LEVEL');
});

test('EXPLAINS_OBSERVATION requires material overlap before demoting the observation', () => {
  const mechanism = finding(1, 'TIME-004', { findingKey: 'early-overuse' });
  const observation = finding(2, 'TIME-001', {
    findingKey: 'frequent-pressure',
    findingLevel: 'OBSERVATION',
  });

  const result = buildDiagnosisConsolidation(
    [mechanism, observation],
    [relationship(10, mechanism, observation, 'EXPLAINS_OBSERVATION')],
    [overlap(mechanism, observation)],
  );

  const observationState = stateFor(result, observation.id);
  assert.equal(observationState.state, 'SUPPRESSED_DRILLDOWN');
  assert.equal(observationState.representativeFindingId, mechanism.id);
  assert.deepEqual(
    observationState.reasonKeys,
    ['SPECIFIC_MECHANISM_EXPLAINS_OBSERVATION'],
  );
});

test('material contextual conditions remain top-level and unresolved overlap stays explicit', () => {
  const mechanism = finding(1, 'TACT-004', { findingKey: 'hanging-material' });
  const condition = finding(2, 'TIME-002', {
    findingKey: 'pressure-collapse',
    findingLevel: 'CONTRIBUTING_CONDITION',
  });

  const result = buildDiagnosisConsolidation(
    [condition, mechanism],
    [relationship(10, mechanism, condition, 'CONDITIONAL_ON')],
    [overlap(mechanism, condition)],
  );

  const conditionState = stateFor(result, condition.id);
  const mechanismState = stateFor(result, mechanism.id);

  assert.equal(conditionState.topLevelEligible, true);
  assert.equal(conditionState.state, 'TOP_LEVEL_MATERIAL_OVERLAP');
  assert.ok(conditionState.reasonKeys.includes('MATERIAL_CONTEXT_RETAINED'));
  assert.ok(conditionState.reasonKeys.includes('UNRESOLVED_MATERIAL_OVERLAP'));
  assert.deepEqual(conditionState.support.retainedContextRelationshipIds, [10]);
  assert.equal(mechanismState.state, 'TOP_LEVEL_MATERIAL_OVERLAP');
  assert.equal(mechanismState.representativeFindingId, null);
});

test('unrelated supported findings stay separate and top-level eligible', () => {
  const left = finding(1, 'TIME-003', { findingKey: 'played-too-fast' });
  const right = finding(2, 'OPEN-002', { findingKey: 'opening-error' });

  const result = buildDiagnosisConsolidation([right, left], [], []);

  const leftState = stateFor(result, left.id);
  const rightState = stateFor(result, right.id);
  assert.equal(leftState.state, 'TOP_LEVEL');
  assert.equal(rightState.state, 'TOP_LEVEL');
  assert.notEqual(leftState.clusterKey, rightState.clusterKey);
});

test('ambiguous specific mechanisms use stable lexical tie-breaking and retain all alternatives', () => {
  const first = finding(1, 'TACT-004', { findingKey: 'a-specific-mechanism' });
  const second = finding(2, 'TACT-003', { findingKey: 'b-specific-mechanism' });
  const generic = finding(3, 'TACT-006', {
    findingKey: 'generic-tactical-rate',
    findingLevel: 'OBSERVATION',
  });

  const relationships = [
    relationship(11, second, generic, 'SPECIALIZES'),
    relationship(10, first, generic, 'SPECIALIZES'),
  ];
  const overlaps = [
    overlap(second, generic),
    overlap(first, generic),
  ];

  const forward = buildDiagnosisConsolidation(
    [generic, second, first],
    relationships,
    overlaps,
  );
  const reverse = buildDiagnosisConsolidation(
    [first, second, generic],
    [...relationships].reverse(),
    [...overlaps].reverse(),
  );

  assert.deepEqual(forward, reverse);
  const genericState = stateFor(forward, generic.id);
  assert.equal(genericState.representativeFindingId, first.id);
  assert.deepEqual(
    genericState.support.alternativeRepresentativeFindingIds,
    [first.id, second.id],
  );
  assert.equal(
    stateFor(forward, first.id).clusterKey,
    stateFor(forward, second.id).clusterKey,
  );
  assert.equal(
    stateFor(forward, first.id).clusterKey,
    genericState.clusterKey,
  );
});

test('unavailable event identity fails closed instead of suppressing a generic finding', () => {
  const mechanism = finding(1, 'TACT-004');
  const generic = finding(2, 'TACT-006', { findingLevel: 'OBSERVATION' });

  const result = buildDiagnosisConsolidation(
    [mechanism, generic],
    [relationship(10, mechanism, generic, 'SPECIALIZES')],
    [overlap(mechanism, generic, {
      material: false,
      calculable: false,
      intersectionEventCount: 0,
      sharedDistinctGames: 0,
    })],
  );

  assert.equal(stateFor(result, mechanism.id).state, 'TOP_LEVEL');
  assert.equal(stateFor(result, generic.id).state, 'TOP_LEVEL');
});

test('insufficient or non-detected source findings are explicitly ineligible', () => {
  const insufficient = finding(1, 'TIME-003', {
    evidenceStrength: 'INSUFFICIENT',
  });
  const lowCoverage = finding(2, 'TIME-004', {
    requiredEvidenceCoverage: 0.49,
  });
  const notDetected = finding(3, 'TIME-001', {
    findingLevel: 'OBSERVATION',
    observationState: 'NOT_DETECTED_WITH_ADEQUATE_COVERAGE',
  });

  const result = buildDiagnosisConsolidation(
    [notDetected, lowCoverage, insufficient],
    [],
    [],
  );

  for (const source of [insufficient, lowCoverage, notDetected]) {
    const state = stateFor(result, source.id);
    assert.equal(state.state, 'INELIGIBLE');
    assert.equal(state.topLevelEligible, false);
    assert.deepEqual(state.reasonKeys, ['SOURCE_FINDING_NOT_SUPPORTED']);
  }
});

test('current-scope materialization replaces consolidation state and rejects stale versions/scopes', async () => {
  const left = finding(21, 'TIME-003');
  const right = finding(22, 'TIME-002', {
    findingLevel: 'CONTRIBUTING_CONDITION',
  });
  const versions = {
    taxonomyVersion: 'taxonomy-v1',
    synthesisPolicyVersion: 'diagnosis-synthesis-v1',
    calculationVersion: 'calculation-v1',
    policyVersions: {
      eventIdentity: 'diagnosis-event-identity-v1',
      consolidation: 'diagnosis-consolidation-v1',
    },
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
        calculationAsOf: new Date('2026-10-03T10:00:00Z'),
        isCurrent: true,
        supersededAt: null,
        findings: [left, right],
        relationships: [],
        consolidations: [],
      };
    },
    async assertCurrentSourceReferences(appUserId, snapshot) {
      sourceChecks += 1;
      assert.equal(appUserId, 7);
      assert.equal(snapshot.id, 99);
    },
    async replaceCurrentConsolidations(
      appUserId,
      findingSetId,
      policyVersion,
      consolidations,
    ) {
      assert.equal(appUserId, 7);
      assert.equal(findingSetId, 99);
      assert.equal(policyVersion, 'diagnosis-consolidation-v1');
      persisted = consolidations;
      return consolidations.map((entry, index) => ({
        id: index + 1,
        ...entry,
      }));
    },
  };

  const result = await materializeCurrentDiagnosisConsolidation(
    7,
    'scope-a',
    versions,
    repository,
  );
  assert.equal(sourceChecks, 1);
  assert.ok(persisted);
  assert.equal(result.findingSetId, 99);
  assert.equal(result.policyVersion, 'diagnosis-consolidation-v1');
  assert.equal(result.consolidations.length, 2);

  await assert.rejects(
    materializeCurrentDiagnosisConsolidation(
      7,
      'scope-a',
      {
        ...versions,
        policyVersions: {
          ...versions.policyVersions,
          consolidation: 'diagnosis-consolidation-v0',
        },
      },
      repository,
    ),
    /current consolidation-policy version/,
  );

  await assert.rejects(
    materializeCurrentDiagnosisConsolidation(
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
    /unavailable for consolidation/,
  );
});
