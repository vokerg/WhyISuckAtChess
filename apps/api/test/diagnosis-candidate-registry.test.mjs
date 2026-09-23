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
