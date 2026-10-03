import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectDiagnosisCandidates,
  UNSUPPORTED_DIAGNOSIS_PROJECTIONS,
} from '../dist/modules/diagnosis/diagnosis-candidate.registry.js';
import {
  calculateDiagnosisFindingOverlaps,
} from '../dist/modules/diagnosis/diagnosis-overlap.service.js';
import {
  buildDiagnosisRelationshipGraph,
} from '../dist/modules/diagnosis/diagnosis-relationship.service.js';
import {
  buildDiagnosisConsolidation,
} from '../dist/modules/diagnosis/diagnosis-consolidation.service.js';
import {
  buildDiagnosisRootCandidates,
} from '../dist/modules/diagnosis/diagnosis-root-cause.service.js';
import {
  buildDiagnosisRanking,
  materializeCurrentDiagnosisRanking,
} from '../dist/modules/diagnosis/diagnosis-ranking.service.js';

const CURRENT_VERSIONS = {
  taxonomyVersion: 'diagnostic-taxonomy-v1',
  synthesisPolicyVersion: 'diagnosis-synthesis-v1',
  calculationVersion: 'finding-materialization-v1',
  policyVersions: {
    eventIdentity: 'diagnosis-event-identity-v1',
    consolidation: 'diagnosis-consolidation-v1',
    ranking: 'diagnosis-ranking-v1',
  },
};

function pressureQualitySource({
  evidenceStrength = 'LOW',
  coverageStatus = 'COMPLETE',
  requiredCoveragePercent = 100,
  averageScoreLossDeltaCp = 70,
  materialCompositionWarning = true,
} = {}) {
  return {
    diagnosisId: 'TIME-002',
    policyVersion: 'time-pressure-quality-collapse-v1',
    timeBehaviorPolicyVersion: 'time-behavior-v1',
    timingDerivationVersion: 1,
    coverage: {
      status: coverageStatus,
      reason: coverageStatus === 'COMPLETE' ? null : 'fixture-partial-coverage',
      candidateGames: 12,
      timingEligibleGames: 12,
      timingCoveragePercent: 100,
      analysisCoveragePercent: requiredCoveragePercent,
    },
    comparison: {
      baseline: {
        eligibleMoves: 40,
        eligibleGames: 8,
        analysedMoves: 40,
        supportingGames: 8,
        requiredEvidenceCoveragePercent: requiredCoveragePercent,
        averageScoreLossCp: 20,
      },
      pressure: {
        eligibleMoves: 40,
        eligibleGames: 8,
        analysedMoves: 40,
        supportingGames: 8,
        requiredEvidenceCoveragePercent: requiredCoveragePercent,
        averageScoreLossCp: 20 + averageScoreLossDeltaCp,
      },
      averageScoreLossDeltaCp,
      majorErrorRateDeltaPercent: averageScoreLossDeltaCp > 0 ? 10 : 0,
      blunderRateDeltaPercent: averageScoreLossDeltaCp > 0 ? 5 : 0,
      evidenceStrength,
    },
    strata: [],
    analysisProvenance: {
      requirement: 'CURRENT_COMPLETE_SOURCE_SNAPSHOT',
      analysedRuns: 8,
      snapshotIds: ['phase-5-fixture'],
      analysisVersions: ['analysis-v1'],
      settingsHashes: ['settings-v1'],
      engines: [{ name: 'FixtureFish', version: '1' }],
    },
    ratingComposition: {
      status: materialCompositionWarning ? 'AVAILABLE' : 'UNAVAILABLE',
      reason: materialCompositionWarning ? null : 'fixture-unavailable',
      result: materialCompositionWarning
        ? { comparison: { materialCompositionWarning: true } }
        : null,
    },
    caveats: [],
  };
}

function earlyTimeOveruseSource() {
  return {
    diagnosisId: 'TIME-004',
    policyVersion: 'early-time-overuse-v1',
    timeBehaviorPolicyVersion: 'time-behavior-v1',
    timingDerivationVersion: 1,
    definitions: {
      earlyPhase: 'OPENING',
      mechanism: 'EARLY_OVERUSE_TO_LATER_PRESSURE_TO_QUALITY',
    },
    coverage: {
      status: 'COMPLETE',
      earlyCoveragePercent: 100,
      laterPressureCoveragePercent: 100,
      qualityGameCoveragePercent: 100,
      qualityMoveCoveragePercent: 100,
    },
    chain: {
      earlyOveruseGames: 5,
      laterPressureGames: 5,
      completeChainGames: 5,
      averageLaterScoreLossDeltaCp: 70,
      evidenceStrength: 'LOW',
      mechanismStatus: 'ORDERED_ASSOCIATION',
    },
    games: [1, 2, 3, 4, 5].map((importedGameId, index) => ({
      importedGameId,
      exactTimeControlKey: '180+0',
      completeChain: true,
      early: {
        lastOpeningPly: 12,
        openingThinkTimeCentiseconds: 900 + index,
      },
      laterPressure: {
        enteredPressure: true,
        firstPressurePly: 30 + index,
      },
      laterQuality: {
        analysedMoves: 4,
        averageScoreLossCp: 90,
      },
    })),
    analysisProvenance: {
      requirement: 'CURRENT_COMPLETE_SOURCE_SNAPSHOT',
      analysedRuns: 5,
      snapshotIds: ['phase-5-fixture'],
      analysisVersions: ['analysis-v1'],
      settingsHashes: ['settings-v1'],
      engines: [{ name: 'FixtureFish', version: '1' }],
    },
    caveats: [],
  };
}

function ratingContextSource() {
  const bandCounts = {
    MUCH_WEAKER: 0,
    WEAKER: 1,
    EVEN: 4,
    STRONGER: 5,
    MUCH_STRONGER: 0,
  };
  const bandSharesPercent = {
    MUCH_WEAKER: 0,
    WEAKER: 10,
    EVEN: 40,
    STRONGER: 50,
    MUCH_STRONGER: 0,
  };
  return {
    diagnosisId: 'RATING-002',
    policyVersion: 'rating-context-composition-v1',
    timeBehaviorPolicyVersion: 'time-behavior-v1',
    coverage: {
      status: 'COMPLETE',
      reason: null,
      inputGames: 20,
      loadedOwnedGames: 20,
    },
    arms: {
      left: {
        inputGames: 10,
        ratingCoveredGames: 10,
        ratingCoveragePercent: 100,
        averageUserRating: 1600,
        averageOpponentRating: 1700,
        averageRatingDifference: -100,
        bandCounts,
        bandSharesPercent,
      },
      right: {
        inputGames: 10,
        ratingCoveredGames: 10,
        ratingCoveragePercent: 100,
        averageUserRating: 1600,
        averageOpponentRating: 1550,
        averageRatingDifference: 50,
        bandCounts: { ...bandCounts },
        bandSharesPercent: { ...bandSharesPercent },
      },
    },
    comparison: {
      meanRatingDifferenceDeltaPoints: -150,
      absoluteMeanRatingDifferenceDeltaPoints: 150,
      bandShareDeltaPercentagePoints: {
        MUCH_WEAKER: 0,
        WEAKER: 0,
        EVEN: 0,
        STRONGER: 0,
        MUCH_STRONGER: 0,
      },
      maxBandShareDeltaPercentagePoints: 0,
      evidenceStrength: 'LOW',
      materialCompositionWarning: true,
    },
    caveats: [],
  };
}

function sessionDeteriorationSource() {
  return {
    diagnosisId: 'SESSION-001',
    policyVersion: 'session-deterioration-v1',
    sessionizationPolicyVersion: 'session-v1',
    coverage: {
      status: 'COMPLETE',
      candidateGames: 20,
      sessionCoveredGames: 20,
    },
    comparison: {
      early: {
        analysedGames: 8,
        analysedSessions: 4,
        analysisCoveragePercent: 100,
      },
      late: {
        analysedGames: 8,
        analysedSessions: 4,
        analysisCoveragePercent: 100,
      },
      averageScoreLossDeltaCp: 30,
      majorErrorRateDeltaPercent: 8,
      blunderRateDeltaPercent: 4,
      evidenceStrength: 'LOW',
    },
    caveats: [],
  };
}

function overlongSessionSource() {
  const candidate = {
    threshold: 6,
    coverage: {
      analysedComparableSessions: 4,
    },
    comparison: {
      preThreshold: {
        analysedGames: 8,
        analysedSessions: 4,
        analysisCoveragePercent: 100,
      },
      thresholdAndLater: {
        analysedGames: 8,
        analysedSessions: 4,
        analysisCoveragePercent: 100,
      },
      averageScoreLossDeltaCp: 25,
      majorErrorRateDeltaPercent: 6,
      blunderRateDeltaPercent: 3,
      evidenceStrength: 'LOW',
      supported: true,
    },
  };
  return {
    diagnosisId: 'SESSION-003',
    policyVersion: 'overlong-session-stopping-point-v1',
    sessionizationPolicyVersion: 'session-v1',
    candidateThresholds: [4, 5, 6, 7, 8, 9, 10],
    selectedThreshold: 6,
    coverage: {
      status: 'COMPLETE',
      analysisCoveragePercent: 100,
    },
    candidates: [candidate],
    caveats: [],
  };
}

function persistedReference(reference, id) {
  return {
    id,
    referenceKey: reference.referenceKey,
    referenceType: reference.referenceType,
    importedGameId: reference.importedGameId ?? null,
    evidenceEventId: reference.evidenceEventId ?? null,
    sourceAnalysisRunId: reference.sourceAnalysisRunId ?? null,
    sourcePlyStart: reference.sourcePlyStart ?? null,
    sourcePlyEnd: reference.sourcePlyEnd ?? null,
    sessionKey: reference.sessionKey ?? null,
    eventIdentityKey: reference.eventIdentityKey ?? null,
    provenance: reference.provenance ?? {},
    representative: reference.representative ?? false,
  };
}

function persistDraft(draft, id) {
  return {
    ...draft,
    id,
    evidenceReferences: draft.evidenceReferences.map(
      (reference, index) => persistedReference(reference, id * 1000 + index + 1),
    ),
  };
}

function eventReference(findingKey, gameId, discriminator = 1, sessionKey = null) {
  return persistedReference({
    referenceKey: findingKey + '-game-' + gameId + '-' + discriminator,
    referenceType: 'IMPORTED_GAME',
    importedGameId: gameId,
    sessionKey,
    eventIdentityKey:
      'diagnosis-event-identity-v1|game|g:' + gameId
      + '|k:PHASE5_ACCEPTANCE_SHARED_EVENT|v:v1|d:' + discriminator,
    provenance: { fixture: true, gameId, discriminator },
    representative: discriminator <= 3,
  }, gameId * 100 + discriminator);
}

function manualFinding({
  id,
  findingKey,
  diagnosisId,
  findingLevel,
  effectMetric = 'average-score-loss',
  effectValue = 80,
  effectUnit = 'CENTIPAWNS',
  effectDirection = 'HIGHER_IS_WORSE',
  gameIds = [],
}) {
  return {
    id,
    findingKey,
    diagnosisId,
    findingLevel,
    observationState: 'PROBLEM_DETECTED',
    claimKey: 'phase5.fixture.' + diagnosisId.toLowerCase(),
    producerKey: 'phase-5-acceptance-fixture',
    producerVersion: 'v1',
    sampleCount: Math.max(5, gameIds.length),
    distinctGameCount: Math.max(5, gameIds.length),
    distinctSessionCount: 0,
    requiredEvidenceCoverage: 1,
    evidenceStrength: 'LOW',
    dimensions: {},
    coverage: {},
    effect: {
      metric: effectMetric,
      value: effectValue,
      unit: effectUnit,
      direction: effectDirection,
      comparator: null,
    },
    sourceVersions: { fixture: 'v1' },
    evidenceReferences: gameIds.map(
      (gameId, index) => eventReference(findingKey, gameId, 1, 'fixture-session-' + (index % 3)),
    ),
  };
}

function materializeHierarchy(findings) {
  const overlaps = calculateDiagnosisFindingOverlaps(findings);
  const relationships = buildDiagnosisRelationshipGraph(findings, overlaps).map(
    (relationship, index) => ({ id: index + 1, ...relationship }),
  );
  const consolidations = buildDiagnosisConsolidation(
    findings,
    relationships,
    overlaps,
  ).map((consolidation, index) => ({ id: index + 1, ...consolidation }));
  return { overlaps, relationships, consolidations };
}

function snapshot({
  id,
  findings,
  relationships,
  consolidations,
  rootSupports = [],
  overrides = {},
}) {
  return {
    id,
    appUserId: 7,
    materializationKey: 'phase-5-acceptance-' + id,
    scopeKey: 'phase-5-acceptance',
    scope: { account: 'fixture' },
    ...CURRENT_VERSIONS,
    calculationAsOf: new Date('2026-10-03T15:00:00Z'),
    isCurrent: true,
    supersededAt: null,
    findings,
    relationships,
    consolidations,
    rootSupports,
    ...overrides,
  };
}

function persistRootRevision(sourceSnapshot, build) {
  let nextFindingId = Math.max(...sourceSnapshot.findings.map((finding) => finding.id)) + 1;
  const roots = build.findings.map((draft) => persistDraft(draft, nextFindingId++));
  const findings = [...sourceSnapshot.findings, ...roots];
  const byKey = new Map(findings.map((finding) => [finding.findingKey, finding]));
  const rootSupports = build.supports.map((support, index) => {
    const root = byKey.get(support.rootFindingKey);
    const child = byKey.get(support.supportingFindingKey);
    assert.ok(root, 'missing persisted root for support');
    assert.ok(child, 'missing persisted child for support');
    return {
      id: index + 1,
      rootFindingId: root.id,
      supportingFindingId: child.id,
      role: support.role,
      support: support.support,
    };
  });
  const hierarchy = materializeHierarchy(findings);
  return snapshot({
    id: sourceSnapshot.id + 1,
    findings,
    relationships: hierarchy.relationships,
    consolidations: hierarchy.consolidations,
    rootSupports,
  });
}

function byDiagnosis(findings, diagnosisId) {
  const finding = findings.find((candidate) => candidate.diagnosisId === diagnosisId);
  assert.ok(finding, 'missing finding ' + diagnosisId);
  return finding;
}

test('Phase 5 composes projected evidence into consolidated roots and deterministic ranking', () => {
  const projectedDrafts = [
    ...projectDiagnosisCandidates('earlyTimeOveruse', earlyTimeOveruseSource()),
    ...projectDiagnosisCandidates('timePressureQualityCollapse', pressureQualitySource()),
    ...projectDiagnosisCandidates('ratingContextComposition', ratingContextSource()),
    ...projectDiagnosisCandidates('sessionDeterioration', sessionDeteriorationSource()),
    ...projectDiagnosisCandidates('overlongSessionStoppingPoint', overlongSessionSource()),
  ];

  const projected = projectedDrafts.map((draft, index) => persistDraft(draft, index + 1));
  const time004 = byDiagnosis(projected, 'TIME-004');
  const time002 = byDiagnosis(projected, 'TIME-002');
  const rating002 = byDiagnosis(projected, 'RATING-002');
  const session001 = byDiagnosis(projected, 'SESSION-001');
  const session003 = byDiagnosis(projected, 'SESSION-003');

  assert.equal(time004.observationState, 'PROBLEM_DETECTED');
  assert.equal(time004.evidenceReferences.length, 5);
  assert.equal(time004.evidenceReferences[0].importedGameId, 1);
  assert.match(time004.evidenceReferences[0].eventIdentityKey, /^diagnosis-event-identity-v1\|game\|/);
  assert.equal(
    time002.coverage.ratingComposition.result.comparison.materialCompositionWarning,
    true,
  );

  const tacticalSpecific = manualFinding({
    id: 20,
    findingKey: 'tact-001-shared-events',
    diagnosisId: 'TACT-001',
    findingLevel: 'MECHANISM',
    gameIds: [21, 22, 23, 24, 25],
  });
  const tacticalGeneric = manualFinding({
    id: 21,
    findingKey: 'tact-006-shared-events',
    diagnosisId: 'TACT-006',
    findingLevel: 'OBSERVATION',
    gameIds: [21, 22, 23, 24, 25],
  });
  const unrelatedOpening = manualFinding({
    id: 22,
    findingKey: 'open-002-unrelated',
    diagnosisId: 'OPEN-002',
    findingLevel: 'MECHANISM',
    effectValue: 55,
    gameIds: [41, 42, 43, 44, 45],
  });

  const leafFindings = [
    ...projected,
    tacticalSpecific,
    tacticalGeneric,
    unrelatedOpening,
  ];
  const leafHierarchy = materializeHierarchy(leafFindings);
  const leafSnapshot = snapshot({
    id: 100,
    findings: leafFindings,
    relationships: leafHierarchy.relationships,
    consolidations: leafHierarchy.consolidations,
  });

  assert.ok(leafHierarchy.relationships.some((relationship) => (
    relationship.sourceFindingId === time004.id
    && relationship.targetFindingId === time002.id
    && relationship.relationshipType === 'CONTRIBUTES_TO'
  )));
  assert.ok(leafHierarchy.relationships.some((relationship) => (
    relationship.sourceFindingId === time002.id
    && relationship.targetFindingId === rating002.id
    && relationship.relationshipType === 'CONFOUNDED_BY'
  )));
  assert.ok(leafHierarchy.relationships.some((relationship) => (
    relationship.sourceFindingId === session003.id
    && relationship.targetFindingId === session001.id
    && relationship.relationshipType === 'MANIFESTS_AS'
  )));
  assert.ok(leafHierarchy.relationships.some((relationship) => (
    relationship.sourceFindingId === tacticalSpecific.id
    && relationship.targetFindingId === tacticalGeneric.id
    && relationship.relationshipType === 'SPECIALIZES'
  )));

  const tacticalGenericConsolidation = leafHierarchy.consolidations.find(
    (consolidation) => consolidation.findingId === tacticalGeneric.id,
  );
  assert.equal(tacticalGenericConsolidation?.state, 'SUPPRESSED_DRILLDOWN');
  assert.equal(tacticalGenericConsolidation?.topLevelEligible, false);

  const time002Consolidation = leafHierarchy.consolidations.find(
    (consolidation) => consolidation.findingId === time002.id,
  );
  assert.ok(time002Consolidation?.support.confounderFindingIds.includes(rating002.id));

  const roots = buildDiagnosisRootCandidates(leafSnapshot);
  assert.deepEqual(
    roots.findings.map((finding) => finding.diagnosisId),
    ['CLOCK_MANAGEMENT_DRIVING_TACTICAL_COLLAPSE'],
  );
  assert.deepEqual(
    roots.supports.map((support) => [support.supportingFindingKey, support.role]),
    [
      [time002.findingKey, 'CONDITION_OR_OBSERVATION'],
      [time004.findingKey, 'MECHANISM'],
    ].sort((left, right) => left[0].localeCompare(right[0])),
  );

  const rootSnapshot = persistRootRevision(leafSnapshot, roots);
  const root = byDiagnosis(
    rootSnapshot.findings,
    'CLOCK_MANAGEMENT_DRIVING_TACTICAL_COLLAPSE',
  );
  const rootConsolidation = rootSnapshot.consolidations.find(
    (consolidation) => consolidation.findingId === root.id,
  );
  assert.equal(rootConsolidation?.state, 'TOP_LEVEL');
  assert.ok(!rootConsolidation?.reasonKeys.includes('UNRESOLVED_MATERIAL_OVERLAP'));

  const rootChildOverlap = calculateDiagnosisFindingOverlaps(rootSnapshot.findings).find(
    (overlap) => new Set([overlap.left.id, overlap.right.id]).has(root.id)
      && new Set([overlap.left.id, overlap.right.id]).has(time004.id),
  );
  assert.equal(rootChildOverlap?.eventOverlap.material, true);

  const ranking = buildDiagnosisRanking(rootSnapshot);
  const rootRank = ranking.rankings.find((row) => row.findingId === root.id);
  const time004Rank = ranking.rankings.find((row) => row.findingId === time004.id);
  const time002Rank = ranking.rankings.find((row) => row.findingId === time002.id);
  const tacticalGenericRank = ranking.rankings.find((row) => row.findingId === tacticalGeneric.id);
  const openingRank = ranking.rankings.find((row) => row.findingId === unrelatedOpening.id);
  const session003Rank = ranking.rankings.find((row) => row.findingId === session003.id);

  assert.equal(rootRank?.topLevelRanked, true);
  assert.equal(rootRank?.overlapMultiplier, 1);
  assert.ok((rootRank?.rankPosition ?? 0) > 0);
  assert.equal(time004Rank?.topLevelRanked, false);
  assert.equal(time004Rank?.rankPosition, null);
  assert.deepEqual(time004Rank?.parentRootFindingIds, [root.id]);
  assert.equal(time002Rank?.topLevelRanked, false);
  assert.ok(time002Rank?.support.confounderFindingIds.includes(rating002.id));
  assert.equal(tacticalGenericRank, undefined);
  assert.equal(openingRank?.topLevelRanked, true);
  assert.equal(session003Rank?.topLevelRanked, true);

  const topLevelPositions = ranking.rankings
    .filter((row) => row.topLevelRanked)
    .map((row) => row.rankPosition);
  assert.deepEqual(
    topLevelPositions,
    Array.from({ length: topLevelPositions.length }, (_, index) => index + 1),
  );

  assert.deepEqual(buildDiagnosisRanking(rootSnapshot), ranking);
});

test('Phase 5 keeps sparse evidence distinct from adequate no-effect evidence and documents deferred breadth', () => {
  const [sparse] = projectDiagnosisCandidates(
    'timePressureQualityCollapse',
    pressureQualitySource({
      evidenceStrength: 'INSUFFICIENT',
      coverageStatus: 'PARTIAL',
      requiredCoveragePercent: 25,
      averageScoreLossDeltaCp: 200,
      materialCompositionWarning: false,
    }),
  );
  const [neutral] = projectDiagnosisCandidates(
    'timePressureQualityCollapse',
    pressureQualitySource({
      evidenceStrength: 'LOW',
      coverageStatus: 'COMPLETE',
      requiredCoveragePercent: 100,
      averageScoreLossDeltaCp: 0,
      materialCompositionWarning: false,
    }),
  );

  assert.equal(sparse.observationState, 'INSUFFICIENT_EVIDENCE');
  assert.equal(sparse.requiredEvidenceCoverage, 0.25);
  assert.equal(neutral.observationState, 'NOT_DETECTED_WITH_ADEQUATE_COVERAGE');

  const persistedSparse = persistDraft(sparse, 1);
  const hierarchy = materializeHierarchy([persistedSparse]);
  assert.equal(hierarchy.consolidations[0].state, 'INELIGIBLE');
  const sparseRanking = buildDiagnosisRanking(snapshot({
    id: 200,
    findings: [persistedSparse],
    relationships: hierarchy.relationships,
    consolidations: hierarchy.consolidations,
  }));
  assert.deepEqual(sparseRanking.rankings, []);

  const cal001 = UNSUPPORTED_DIAGNOSIS_PROJECTIONS.find(
    (item) => item.diagnosisId === 'CAL-001',
  );
  assert.ok(cal001);
  assert.match(cal001.reason, /IANA timezone/);
});

test('Phase 5 rejects stale revisions and stale policy tuples before ranking recalculation', async () => {
  const projected = [
    ...projectDiagnosisCandidates('earlyTimeOveruse', earlyTimeOveruseSource()),
    ...projectDiagnosisCandidates(
      'timePressureQualityCollapse',
      pressureQualitySource({ materialCompositionWarning: false }),
    ),
  ].map((draft, index) => persistDraft(draft, index + 1));
  const hierarchy = materializeHierarchy(projected);
  const current = snapshot({
    id: 300,
    findings: projected,
    relationships: hierarchy.relationships,
    consolidations: hierarchy.consolidations,
  });

  assert.throws(
    () => buildDiagnosisRootCandidates({
      ...current,
      synthesisPolicyVersion: 'diagnosis-synthesis-v0',
    }),
    /current synthesis-policy version/,
  );

  assert.throws(
    () => buildDiagnosisRanking({
      ...current,
      isCurrent: false,
      supersededAt: new Date('2026-10-03T15:05:00Z'),
    }),
    /current canonical finding set/,
  );

  let repositoryCalled = false;
  const repository = {
    async getCurrentScope() {
      repositoryCalled = true;
      return current;
    },
    async assertCurrentSourceReferences() {
      repositoryCalled = true;
    },
    async replaceCurrentRankings() {
      repositoryCalled = true;
      return [];
    },
  };

  await assert.rejects(
    materializeCurrentDiagnosisRanking(
      7,
      'phase-5-acceptance',
      {
        ...CURRENT_VERSIONS,
        policyVersions: {
          ...CURRENT_VERSIONS.policyVersions,
          ranking: 'diagnosis-ranking-v0',
        },
      },
      repository,
    ),
    /current ranking-policy version/,
  );
  assert.equal(repositoryCalled, false);
});
