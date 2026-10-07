import assert from 'node:assert/strict';
import test from 'node:test';
import { timeControlComparisonResponseSchema } from '@why-i-suck-at-chess/contracts';
import { buildApp } from '../dist/app.js';
import {
  createTimeControlComparisonService,
  TIME_CONTROL_COMPARISON_ITEM_LIMIT,
  TIME_CONTROL_COMPARISON_EXACT_CONTROL_LIMIT,
} from '../dist/modules/diagnosis/time-control-comparison.service.js';

function exactArm(index = 0) {
  return {
    exactTimeControlKey: '180+' + index,
    initialSeconds: 180,
    incrementSeconds: index,
    eligibleGames: 8,
    resultCoveredGames: 8,
    resultCoveragePercent: 100,
    wins: 3,
    draws: 2,
    losses: 3,
    scorePercent: 50,
    resultEvidenceStrength: 'MEDIUM',
    analysedGames: 8,
    analysisCoveragePercent: 100,
    analysedUserMoves: 160,
    averageScoreLossCp: 72,
    majorErrorRatePercent: 12,
    blunderRatePercent: 6,
    qualityEvidenceStrength: 'MEDIUM',
    speedCategories: ['blitz'],
  };
}

function exactComparison(index) {
  return {
    status: 'AVAILABLE',
    reason: null,
    target: exactArm(index),
    comparatorDefinition: {
      initialSeconds: 180,
      requiresDifferentIncrement: true,
      broadSpeedFallback: false,
      selectionRule:
        'STRONGEST_RESULT_EVIDENCE_THEN_LARGEST_RESULT_SAMPLE_THEN_NEAREST_INCREMENT_THEN_KEY',
      eligibleComparatorControls: 1,
    },
    comparator: exactArm(index + 1),
    deltas: {
      scorePercentagePoints: -10,
      averageScoreLossCp: 20,
      majorErrorRatePercentagePoints: 3,
      blunderRatePercentagePoints: 2,
    },
    evidenceStrength: { result: 'MEDIUM', quality: 'LOW' },
    ratingComposition: {
      status: 'AVAILABLE',
      reason: null,
      result: {
        comparison: { materialCompositionWarning: index % 2 === 0 },
      },
    },
  };
}

function incrementArm(prefix, incrementSeconds) {
  return {
    games: 8,
    exactControls: Array.from(
      { length: TIME_CONTROL_COMPARISON_EXACT_CONTROL_LIMIT + 2 },
      (_, index) => ({
        exactTimeControlKey: prefix + '-' + index,
        incrementSeconds,
        games: 1,
      }),
    ),
    resultCoveredGames: 8,
    resultCoveragePercent: 100,
    wins: 3,
    draws: 2,
    losses: 3,
    scorePercent: 50,
    analysedGames: 8,
    analysisCoveragePercent: 100,
    analysedUserMoves: 160,
    averageScoreLossCp: 72,
    majorErrorRatePercent: 12,
    blunderRatePercent: 6,
    pressure: {
      timingCoveredGames: 8,
      timingCoveragePercent: 100,
      eligibleUserDecisions: 160,
      pressureMoves: 20,
      pressureMoveRatePercent: 12.5,
      pressureEnteringGames: 3,
      pressureEntryRatePercent: 37.5,
    },
    evidenceStrength: {
      result: 'MEDIUM',
      quality: 'MEDIUM',
      timing: 'MEDIUM',
    },
  };
}

function incrementStratum(index) {
  return {
    initialSeconds: 180 + index,
    noIncrement: incrementArm('no-' + index, 0),
    increment: incrementArm('inc-' + index, 2),
    deltas: {
      scorePercentagePoints: 10,
      averageScoreLossCp: -20,
      majorErrorRatePercentagePoints: -3,
      blunderRatePercentagePoints: -2,
      pressureMoveRatePercentagePoints: -5,
      pressureEntryRatePercentagePoints: -10,
    },
    evidenceStrength: {
      result: 'MEDIUM',
      quality: 'LOW',
      timing: 'MEDIUM',
    },
    ratingComposition: {
      status: 'AVAILABLE',
      reason: null,
      result: {
        comparison: { materialCompositionWarning: false },
      },
    },
  };
}

function aggregateDependencies(calls) {
  return {
    async getExactTimeControl(appUserId, scope) {
      calls.push(['exact', appUserId, scope]);
      return {
        diagnosisId: 'TIME-005',
        policyVersion: 'exact-time-control-underperformance-v1',
        timeBehaviorPolicyVersion: 'time-behavior-v1',
        coverage: {
          status: 'COMPLETE',
          reason: null,
          candidateGames: 60,
          supportedGames: 60,
          unsupportedGames: 0,
          missingExactControlGames: 0,
          inconsistentControlIdentityGames: 0,
          eligibleGames: 60,
          exactControls: 30,
          controlsWithComparator: 30,
          controlsWithoutComparator: 0,
          resultCoveredGames: 60,
          resultCoveragePercent: 100,
          analysedGames: 60,
          analysisCoveragePercent: 100,
          maxCandidateGames: 5000,
        },
        comparisons: Array.from({ length: 30 }, (_, index) => exactComparison(index)),
        caveats: Array.from({ length: 22 }, (_, index) => 'exact caveat ' + index),
      };
    },
    async getIncrementEffect(appUserId, scope) {
      calls.push(['increment', appUserId, scope]);
      return {
        diagnosisId: 'TIME-006',
        policyVersion: 'increment-effect-v1',
        timeBehaviorPolicyVersion: 'time-behavior-v1',
        timingDerivationVersion: 1,
        coverage: {
          status: 'PARTIAL',
          reason: 'some-initial-time-strata-unmatched',
          candidateGames: 60,
          supportedGames: 60,
          unsupportedGames: 0,
          missingControlIdentityGames: 0,
          inconsistentControlIdentityGames: 0,
          eligibleGames: 60,
          matchedGames: 50,
          unmatchedGames: 10,
          matchedInitialTimeStrata: 30,
          unmatchedInitialTimeStrata: 1,
          resultCoveredGames: 50,
          resultCoveragePercent: 100,
          analysedGames: 50,
          analysisCoveragePercent: 100,
          timingCoveredGames: 50,
          timingCoveragePercent: 100,
          maxCandidateGames: 5000,
        },
        strata: Array.from({ length: 30 }, (_, index) => incrementStratum(index)),
        caveats: Array.from({ length: 22 }, (_, index) => 'increment caveat ' + index),
      };
    },
  };
}

test('comparison service composes accepted aggregates and caps product collections', async () => {
  const calls = [];
  const service = createTimeControlComparisonService(aggregateDependencies(calls));
  const response = await service.getComparison(47, {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-10-01T00:00:00.000Z',
  });

  timeControlComparisonResponseSchema.parse(response);
  assert.deepEqual(
    calls.map(([name, userId, scope]) => [
      name,
      userId,
      scope.from?.toISOString(),
      scope.to?.toISOString(),
    ]),
    [
      ['exact', 47, '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'],
      ['increment', 47, '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'],
    ],
  );
  assert.deepEqual(response.exactControl.comparisonCount, {
    total: 30,
    returned: TIME_CONTROL_COMPARISON_ITEM_LIMIT,
    truncated: true,
  });
  assert.deepEqual(response.incrementEffect.stratumCount, {
    total: 30,
    returned: TIME_CONTROL_COMPARISON_ITEM_LIMIT,
    truncated: true,
  });
  assert.equal(
    response.incrementEffect.strata[0].increment.exactControls.items.length,
    TIME_CONTROL_COMPARISON_EXACT_CONTROL_LIMIT,
  );
  assert.equal(
    response.incrementEffect.strata[0].increment.exactControls.truncated,
    true,
  );
  assert.deepEqual(
    {
      total: response.exactControl.caveats.total,
      returned: response.exactControl.caveats.returned,
      truncated: response.exactControl.caveats.truncated,
    },
    { total: 22, returned: 20, truncated: true },
  );
  assert.deepEqual(
    {
      total: response.incrementEffect.caveats.total,
      returned: response.incrementEffect.caveats.returned,
      truncated: response.incrementEffect.caveats.truncated,
    },
    { total: 22, returned: 20, truncated: true },
  );
  assert.equal(response.exactControl.caveats.items.length, 20);
  assert.equal(response.incrementEffect.caveats.items.length, 20);
  assert.equal(
    response.exactControl.comparisons[0].ratingComposition.materialCompositionWarning,
    true,
  );
});

test('HTTP time-control comparison route forwards authenticated owner and validates range', async () => {
  const calls = [];
  const stubResponse = {
    scope: { from: null, to: null },
    exactControl: {
      diagnosisId: 'TIME-005',
      policyVersion: 'exact-time-control-underperformance-v1',
      timeBehaviorPolicyVersion: 'time-behavior-v1',
      coverage: {
        status: 'UNAVAILABLE',
        reason: 'no-candidate-games',
        candidateGames: 0,
        eligibleGames: 0,
        exactControls: 0,
        controlsWithComparator: 0,
        resultCoveragePercent: null,
        analysisCoveragePercent: null,
      },
      comparisonCount: { total: 0, returned: 0, truncated: false },
      comparisons: [],
      caveats: {
        total: 1,
        returned: 1,
        truncated: false,
        items: ['No exact-time-control comparison is available.'],
      },
    },
    incrementEffect: {
      diagnosisId: 'TIME-006',
      policyVersion: 'increment-effect-v1',
      timeBehaviorPolicyVersion: 'time-behavior-v1',
      timingDerivationVersion: 1,
      coverage: {
        status: 'UNAVAILABLE',
        reason: 'no-candidate-games',
        candidateGames: 0,
        eligibleGames: 0,
        matchedGames: 0,
        unmatchedGames: 0,
        matchedInitialTimeStrata: 0,
        resultCoveragePercent: null,
        analysisCoveragePercent: null,
        timingCoveragePercent: null,
      },
      stratumCount: { total: 0, returned: 0, truncated: false },
      strata: [],
      caveats: {
        total: 1,
        returned: 1,
        truncated: false,
        items: ['No increment comparison is available.'],
      },
    },
  };

  const app = await buildApp({
    prisma: { $disconnect: async () => undefined },
    authConfig: { mode: 'dev-single-user' },
    currentUserService: {
      async resolveDevUser() {
        return {
          auth: {
            userId: 314,
            provider: 'dev',
            externalSubject: 'time-control-read-model-test',
          },
        };
      },
      async resolveExternalUser() {
        throw new Error('not used in dev mode');
      },
    },
    timeControlComparisonService: {
      async getComparison(userId, query) {
        calls.push([userId, query]);
        return {
          ...stubResponse,
          scope: {
            from: query.from ?? null,
            to: query.to ?? null,
          },
        };
      },
    },
  });

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/diagnosis/time-controls?from=2026-09-01T00%3A00%3A00.000Z&to=2026-10-01T00%3A00%3A00.000Z',
    });
    assert.equal(response.statusCode, 200);
    timeControlComparisonResponseSchema.parse(response.json());

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/diagnosis/time-controls?from=2026-10-01T00%3A00%3A00.000Z&to=2026-09-01T00%3A00%3A00.000Z',
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await app.close();
  }

  assert.deepEqual(calls, [[314, {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-10-01T00:00:00.000Z',
  }]]);
});
