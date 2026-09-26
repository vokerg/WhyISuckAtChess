import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANONICAL_DIAGNOSIS_IDS_V1,
  DIAGNOSIS_CANDIDATE_PRODUCERS,
  UNSUPPORTED_DIAGNOSIS_PROJECTIONS,
  assertDiagnosisCandidateRegistryInvariants,
  projectDiagnosisCandidates,
} from '../dist/modules/diagnosis/diagnosis-candidate.registry.js';

test('candidate registry owns or explicitly defers every canonical diagnosis exactly once', () => {
  assert.doesNotThrow(() => assertDiagnosisCandidateRegistryInvariants());

  const supported = Object.values(DIAGNOSIS_CANDIDATE_PRODUCERS)
    .flatMap((producer) => producer.diagnosisIds);
  const unsupported = UNSUPPORTED_DIAGNOSIS_PROJECTIONS.map((item) => item.diagnosisId);
  assert.deepEqual(
    [...new Set([...supported, ...unsupported])].sort(),
    [...CANONICAL_DIAGNOSIS_IDS_V1].sort(),
  );
  assert.equal(new Set(supported).size, supported.length);
  assert.equal(new Set(unsupported).size, unsupported.length);
  assert.ok(
    UNSUPPORTED_DIAGNOSIS_PROJECTIONS.some((item) => item.diagnosisId === 'TACT-004'),
    'per-game hanging-material evidence must not be promoted without a recurrence aggregate',
  );
});

test('opening recurrence projects a canonical chess mechanism with representative source references', () => {
  const candidates = projectDiagnosisCandidates('openingRecurrence', {
    coverage: {
      status: 'COMPLETE',
      reason: null,
      eligibleGames: 20,
      analysedGames: 18,
      analysisCoveragePct: 90,
      sampleEvents: 12,
      maxCandidateGames: 5000,
      minAnalysedGames: 5,
      minAnalysisCoveragePct: 50,
    },
    findings: [{
      key: 'repeated-early-move-white-101-e2e4',
      type: 'REPEATED_EARLY_MOVE_ERROR',
      measurements: {
        distinctGames: 6,
        analysedMoveCount: 6,
        averageScoreLossCp: 82.5,
        maxScoreLossCp: 160,
      },
      details: {
        userColor: 'WHITE',
        positionId: 101,
        moveUci: 'e2e4',
        evidenceStrength: 'LOW',
        openingNames: ['Fixture Opening'],
        openingEcos: ['C20'],
        supportingGames: [
          {
            importedGameId: 11,
            evidenceEventId: 1011,
            sourceAnalysisRunId: 2011,
            providerGameId: 'fixture-11',
            plyNumber: 7,
            positionId: 101,
            moveUci: 'e2e4',
            scoreLossCp: 120,
            userEvalCp: -80,
            speedCategory: 'blitz',
          },
          {
            importedGameId: 12,
            evidenceEventId: 1012,
            sourceAnalysisRunId: 2012,
            providerGameId: 'fixture-12',
            plyNumber: 7,
            positionId: 101,
            moveUci: 'e2e4',
            scoreLossCp: 90,
            userEvalCp: -60,
            speedCategory: 'blitz',
          },
        ],
      },
    }],
  });

  const finding = candidates.find((candidate) => candidate.diagnosisId === 'OPEN-002');
  assert.ok(finding);
  assert.equal(finding.findingLevel, 'MECHANISM');
  assert.equal(finding.observationState, 'PROBLEM_DETECTED');
  assert.equal(finding.evidenceStrength, 'LOW');
  assert.equal(finding.distinctGameCount, 6);
  assert.equal(finding.requiredEvidenceCoverage, 0.9);
  assert.equal(finding.effect.metric, 'average-score-loss');
  assert.equal(finding.effect.value, 82.5);
  assert.equal(finding.evidenceReferences.length, 2);
  assert.equal(finding.evidenceReferences[0].importedGameId, 11);
  assert.equal(finding.evidenceReferences[0].evidenceEventId, 1011);
  assert.equal(finding.evidenceReferences[0].sourceAnalysisRunId, 2011);
  assert.equal(
    finding.evidenceReferences[0].eventIdentityKey,
    'diagnosis-event-identity-v1|ply|g:11|p:7|k:OPENING_MOVE_QUALITY_SAMPLE|v:opening-v1',
  );
  assert.equal(finding.evidenceReferences[0].representative, true);

  const absentBadPosition = candidates.find((candidate) => candidate.diagnosisId === 'OPEN-003');
  assert.ok(absentBadPosition);
  assert.equal(absentBadPosition.observationState, 'NOT_DETECTED_WITH_ADEQUATE_COVERAGE');
});

test('timing comparison keeps source insufficiency instead of upgrading a large raw delta', () => {
  const [finding] = projectDiagnosisCandidates('timePressureQualityCollapse', {
    diagnosisId: 'TIME-002',
    policyVersion: 'time-pressure-quality-collapse-v1',
    timeBehaviorPolicyVersion: 'time-behavior-v1',
    timingDerivationVersion: 1,
    coverage: {
      status: 'PARTIAL',
      reason: 'engine-analysis-unavailable-in-comparison-arm',
      candidateGames: 12,
      timingEligibleGames: 12,
      unsupportedGames: 0,
      timingEligibleUserDecisions: 100,
      timingCoveredUserDecisions: 100,
      timingCoveragePercent: 100,
      contextEligibleUserDecisions: 100,
      contextCoveragePercent: 100,
      missingExactControlMoves: 0,
      missingPhaseMoves: 0,
      matchedUserDecisions: 80,
      matchingCoveragePercent: 80,
      matchedStrata: 2,
      unmatchedBaselineMoves: 10,
      unmatchedPressureMoves: 10,
      analysedMatchedUserDecisions: 20,
      analysisCoveragePercent: 25,
      maxCandidateGames: 5000,
    },
    comparison: {
      baseline: {
        eligibleMoves: 40,
        eligibleGames: 8,
        analysedMoves: 10,
        supportingGames: 3,
        analysisCoveragePercent: 25,
        requiredEvidenceCoveragePercent: 25,
        averageScoreLossCp: 20,
        majorErrorRatePercent: 2,
        blunderRatePercent: 1,
      },
      pressure: {
        eligibleMoves: 40,
        eligibleGames: 8,
        analysedMoves: 10,
        supportingGames: 3,
        analysisCoveragePercent: 25,
        requiredEvidenceCoveragePercent: 25,
        averageScoreLossCp: 220,
        majorErrorRatePercent: 20,
        blunderRatePercent: 12,
      },
      averageScoreLossDeltaCp: 200,
      majorErrorRateDeltaPercent: 18,
      blunderRateDeltaPercent: 11,
      evidenceStrength: 'INSUFFICIENT',
    },
    strata: [],
    analysisProvenance: {
      requirement: 'CURRENT_COMPLETE_SOURCE_SNAPSHOT',
      analysedRuns: 3,
      snapshotIds: ['snapshot-a'],
      analysisVersions: ['analysis-v1'],
      settingsHashes: ['settings-a'],
      engines: [{ name: 'FixtureFish', version: '1' }],
    },
    ratingComposition: {
      status: 'UNAVAILABLE',
      reason: 'fixture',
      result: null,
    },
    caveats: [],
  });

  assert.equal(finding.diagnosisId, 'TIME-002');
  assert.equal(finding.findingLevel, 'CONTRIBUTING_CONDITION');
  assert.equal(finding.observationState, 'INSUFFICIENT_EVIDENCE');
  assert.equal(finding.evidenceStrength, 'INSUFFICIENT');
  assert.equal(finding.requiredEvidenceCoverage, 0.25);
  assert.equal(finding.effect.value, 200);
  assert.equal(finding.sourceVersions.analysis.requirement, 'CURRENT_COMPLETE_SOURCE_SNAPSHOT');
});

test('TIME-002 exposes the worsening quality metric that actually supports detection', () => {
  const [finding] = projectDiagnosisCandidates('timePressureQualityCollapse', {
    diagnosisId: 'TIME-002',
    policyVersion: 'time-pressure-quality-collapse-v1',
    timeBehaviorPolicyVersion: 'time-behavior-v1',
    timingDerivationVersion: 1,
    coverage: {
      status: 'COMPLETE',
      reason: null,
      candidateGames: 12,
      timingEligibleGames: 12,
      unsupportedGames: 0,
      timingEligibleUserDecisions: 100,
      timingCoveredUserDecisions: 100,
      timingCoveragePercent: 100,
      contextEligibleUserDecisions: 100,
      contextCoveragePercent: 100,
      missingExactControlMoves: 0,
      missingPhaseMoves: 0,
      matchedUserDecisions: 80,
      matchingCoveragePercent: 80,
      matchedStrata: 2,
      unmatchedBaselineMoves: 10,
      unmatchedPressureMoves: 10,
      analysedMatchedUserDecisions: 80,
      analysisCoveragePercent: 100,
      maxCandidateGames: 5000,
    },
    comparison: {
      baseline: {
        eligibleMoves: 40,
        eligibleGames: 8,
        analysedMoves: 40,
        supportingGames: 8,
        analysisCoveragePercent: 100,
        requiredEvidenceCoveragePercent: 100,
        averageScoreLossCp: 50,
        majorErrorRatePercent: 2,
        blunderRatePercent: 1,
      },
      pressure: {
        eligibleMoves: 40,
        eligibleGames: 8,
        analysedMoves: 40,
        supportingGames: 8,
        analysisCoveragePercent: 100,
        requiredEvidenceCoveragePercent: 100,
        averageScoreLossCp: 40,
        majorErrorRatePercent: 7,
        blunderRatePercent: 1,
      },
      averageScoreLossDeltaCp: -10,
      majorErrorRateDeltaPercent: 5,
      blunderRateDeltaPercent: 0,
      evidenceStrength: 'LOW',
    },
    strata: [],
    analysisProvenance: {
      requirement: 'CURRENT_COMPLETE_SOURCE_SNAPSHOT',
      analysedRuns: 8,
      snapshotIds: ['snapshot-a'],
      analysisVersions: ['analysis-v1'],
      settingsHashes: ['settings-a'],
      engines: [{ name: 'FixtureFish', version: '1' }],
    },
    ratingComposition: {
      status: 'UNAVAILABLE',
      reason: 'fixture',
      result: null,
    },
    caveats: [],
  });

  assert.equal(finding.observationState, 'PROBLEM_DETECTED');
  assert.equal(finding.effect.metric, 'major-error-rate-delta');
  assert.equal(finding.effect.value, 5);
  assert.equal(finding.effect.direction, 'HIGHER_IS_WORSE');
});

test('session deterioration exposes the worsening quality metric that supports detection', () => {
  const [finding] = projectDiagnosisCandidates('sessionDeterioration', {
    diagnosisId: 'SESSION-001',
    policyVersion: 'session-deterioration-v1',
    sessionizationPolicyVersion: 'session-v1',
    coverage: {
      status: 'COMPLETE',
      reason: null,
      candidateGames: 24,
      sessionCoveredGames: 24,
      sessionUncoveredGames: 0,
      analysedGames: 24,
      analysisCoveragePercent: 100,
    },
    comparison: {
      early: {
        eligibleGames: 12,
        analysedGames: 12,
        eligibleSessions: 6,
        analysedSessions: 6,
        analysisCoveragePercent: 100,
        analysedUserMoves: 240,
        averageScoreLossCp: 50,
        majorErrorRatePercent: 4,
        blunderRatePercent: 2,
      },
      late: {
        eligibleGames: 12,
        analysedGames: 12,
        eligibleSessions: 6,
        analysedSessions: 6,
        analysisCoveragePercent: 100,
        analysedUserMoves: 220,
        averageScoreLossCp: 45,
        majorErrorRatePercent: 8,
        blunderRatePercent: 2,
      },
      averageScoreLossDeltaCp: -5,
      majorErrorRateDeltaPercent: 4,
      blunderRateDeltaPercent: 0,
      evidenceStrength: 'LOW',
    },
    caveats: [],
  });

  assert.equal(finding.observationState, 'PROBLEM_DETECTED');
  assert.equal(finding.effect.metric, 'major-error-rate-delta');
  assert.equal(finding.effect.value, 4);
  assert.equal(finding.effect.direction, 'HIGHER_IS_WORSE');
});

test('session comparison projects recurrence across distinct sessions without inventing event ids', () => {
  const [finding] = projectDiagnosisCandidates('sessionDeterioration', {
    diagnosisId: 'SESSION-001',
    policyVersion: 'session-deterioration-v1',
    sessionizationPolicyVersion: 'session-v1',
    coverage: {
      status: 'COMPLETE',
      reason: null,
      candidateGames: 24,
      sessionCoveredGames: 24,
      sessionUncoveredGames: 0,
      analysedGames: 24,
      analysisCoveragePercent: 100,
    },
    comparison: {
      early: {
        eligibleGames: 12,
        analysedGames: 12,
        eligibleSessions: 6,
        analysedSessions: 6,
        analysisCoveragePercent: 100,
        analysedUserMoves: 240,
        averageScoreLossCp: 30,
        majorErrorRatePercent: 4,
        blunderRatePercent: 2,
      },
      late: {
        eligibleGames: 12,
        analysedGames: 12,
        eligibleSessions: 6,
        analysedSessions: 6,
        analysisCoveragePercent: 100,
        analysedUserMoves: 220,
        averageScoreLossCp: 48,
        majorErrorRatePercent: 8,
        blunderRatePercent: 5,
      },
      averageScoreLossDeltaCp: 18,
      majorErrorRateDeltaPercent: 4,
      blunderRateDeltaPercent: 3,
      evidenceStrength: 'LOW',
    },
    caveats: [],
  });

  assert.equal(finding.observationState, 'PROBLEM_DETECTED');
  assert.equal(finding.distinctGameCount, 12);
  assert.equal(finding.distinctSessionCount, 6);
  assert.equal(finding.evidenceReferences.length, 0);
  assert.equal(
    finding.coverage.sourceReferenceStatus,
    'SOURCE_AGGREGATE_DOES_NOT_EXPOSE_GAME_IDS',
  );
});

test('rating composition warning remains an explicit confounder finding', () => {
  const bandCounts = {
    MUCH_WEAKER: 0,
    WEAKER: 1,
    EVEN: 4,
    STRONGER: 5,
    MUCH_STRONGER: 0,
  };
  const bandShares = {
    MUCH_WEAKER: 0,
    WEAKER: 10,
    EVEN: 40,
    STRONGER: 50,
    MUCH_STRONGER: 0,
  };
  const [finding] = projectDiagnosisCandidates('ratingContextComposition', {
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
        bandSharesPercent: bandShares,
      },
      right: {
        inputGames: 10,
        ratingCoveredGames: 10,
        ratingCoveragePercent: 100,
        averageUserRating: 1600,
        averageOpponentRating: 1550,
        averageRatingDifference: 50,
        bandCounts: { ...bandCounts },
        bandSharesPercent: { ...bandShares },
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
  });

  assert.equal(finding.diagnosisId, 'RATING-002');
  assert.equal(finding.findingLevel, 'OBSERVATION');
  assert.equal(finding.observationState, 'PROBLEM_DETECTED');
  assert.equal(finding.effect.metric, 'absolute-mean-rating-difference-delta');
  assert.equal(finding.effect.value, 150);
});


test('TIME-007 preserves supported timing evidence when quality evidence is unavailable', () => {
  const [finding] = projectDiagnosisCandidates('opponentMoveSpeedEffect', {
    diagnosisId: 'TIME-007',
    policyVersion: 'opponent-move-speed-effect-v1',
    timeBehaviorPolicyVersion: 'time-behavior-v1',
    timingDerivationVersion: 1,
    definitions: {},
    coverage: {
      status: 'COMPLETE',
      reason: null,
    },
    recurrence: {},
    comparison: {
      baseline: {
        eligibleResponses: 24,
        eligibleGames: 8,
        requiredTimingCoveragePercent: 100,
        requiredQualityCoveragePercent: 0,
      },
      exposed: {
        eligibleResponses: 24,
        eligibleGames: 8,
        requiredTimingCoveragePercent: 100,
        requiredQualityCoveragePercent: 0,
      },
      averageResponseTimeDeltaCentiseconds: -75,
      averageScoreLossDeltaCp: null,
      majorErrorRateDeltaPercent: null,
      blunderRateDeltaPercent: null,
      evidenceStrength: {
        timing: 'LOW',
        quality: 'INSUFFICIENT',
      },
    },
    phaseComposition: {},
    strata: [],
    analysisProvenance: {
      requirement: 'CURRENT_COMPLETE_SOURCE_SNAPSHOT',
      analysedRuns: 0,
      snapshotIds: [],
      analysisVersions: [],
      settingsHashes: [],
      engines: [],
    },
    ratingComposition: {
      status: 'UNAVAILABLE',
      reason: 'quality-unavailable-fixture',
      result: null,
    },
    caveats: [],
  });

  assert.equal(finding.observationState, 'PROBLEM_DETECTED');
  assert.equal(finding.producerVersion, 'diagnosis-candidate-projection-v1');
  assert.equal(finding.evidenceStrength, 'LOW');
  assert.equal(finding.requiredEvidenceCoverage, 1);
  assert.equal(finding.effect.metric, 'average-response-time-delta');
  assert.equal(finding.effect.value, -75);
});


test('TIME-005 exposes the worsening quality metric that supports detection', () => {
  const target = {
    exactTimeControlKey: '180+0',
    initialSeconds: 180,
    incrementSeconds: 0,
    eligibleGames: 8,
    resultCoveragePercent: 100,
    analysisCoveragePercent: 100,
  };
  const comparator = {
    exactTimeControlKey: '180+2',
    initialSeconds: 180,
    incrementSeconds: 2,
    eligibleGames: 8,
    resultCoveragePercent: 100,
    analysisCoveragePercent: 100,
  };

  const [finding] = projectDiagnosisCandidates('exactTimeControlUnderperformance', {
    diagnosisId: 'TIME-005',
    policyVersion: 'exact-time-control-underperformance-v1',
    timeBehaviorPolicyVersion: 'time-behavior-v1',
    coverage: {
      status: 'COMPLETE',
      resultCoveragePercent: 100,
      analysisCoveragePercent: 100,
    },
    comparisons: [{
      status: 'AVAILABLE',
      reason: null,
      target,
      comparatorDefinition: {
        initialSeconds: 180,
        requiresDifferentIncrement: true,
        broadSpeedFallback: false,
        selectionRule: 'STRONGEST_RESULT_EVIDENCE_THEN_LARGEST_RESULT_SAMPLE_THEN_NEAREST_INCREMENT_THEN_KEY',
        eligibleComparatorControls: 1,
      },
      comparator,
      deltas: {
        scorePercentagePoints: null,
        averageScoreLossCp: -10,
        majorErrorRatePercentagePoints: 5,
        blunderRatePercentagePoints: 0,
      },
      evidenceStrength: {
        result: 'INSUFFICIENT',
        quality: 'LOW',
      },
      ratingComposition: {
        status: 'UNAVAILABLE',
        reason: 'fixture',
        result: null,
      },
    }],
    caveats: [],
  });

  assert.equal(finding.observationState, 'PROBLEM_DETECTED');
  assert.equal(finding.evidenceStrength, 'LOW');
  assert.equal(finding.effect.metric, 'major-error-rate-delta');
  assert.equal(finding.effect.value, 5);
});
