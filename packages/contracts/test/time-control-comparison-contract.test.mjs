import assert from 'node:assert/strict';
import test from 'node:test';
import {
  timeControlComparisonQuerySchema,
  timeControlComparisonResponseSchema,
} from '../dist/index.js';

function arm(key, incrementSeconds) {
  return {
    exactTimeControlKey: key,
    initialSeconds: 180,
    incrementSeconds,
    eligibleGames: 8,
    resultCoveredGames: 8,
    scorePercent: incrementSeconds === 0 ? 42 : 61,
    analysedGames: 7,
    averageScoreLossCp: incrementSeconds === 0 ? 96 : 62,
    majorErrorRatePercent: 14,
    blunderRatePercent: 7,
    resultEvidenceStrength: 'MEDIUM',
    qualityEvidenceStrength: 'LOW',
  };
}

function incrementArm(key, incrementSeconds) {
  return {
    games: 8,
    exactControls: {
      total: 1,
      returned: 1,
      truncated: false,
      items: [{ exactTimeControlKey: key, incrementSeconds, games: 8 }],
    },
    resultCoveredGames: 8,
    scorePercent: incrementSeconds === 0 ? 42 : 61,
    analysedGames: 7,
    averageScoreLossCp: incrementSeconds === 0 ? 96 : 62,
    majorErrorRatePercent: 14,
    blunderRatePercent: 7,
    pressure: {
      timingCoveredGames: 7,
      timingCoveragePercent: 87.5,
      pressureMoveRatePercent: incrementSeconds === 0 ? 21 : 12,
      pressureEntryRatePercent: incrementSeconds === 0 ? 50 : 25,
    },
    evidenceStrength: {
      result: 'MEDIUM',
      quality: 'LOW',
      timing: 'LOW',
    },
  };
}

function response() {
  return {
    scope: {
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
    },
    exactControl: {
      diagnosisId: 'TIME-005',
      policyVersion: 'exact-time-control-underperformance-v1',
      timeBehaviorPolicyVersion: 'time-behavior-v1',
      coverage: {
        status: 'PARTIAL',
        reason: 'engine-analysis-incomplete',
        candidateGames: 16,
        eligibleGames: 16,
        exactControls: 2,
        controlsWithComparator: 2,
        resultCoveragePercent: 100,
        analysisCoveragePercent: 87.5,
      },
      comparisonCount: { total: 2, returned: 2, truncated: false },
      comparisons: [{
        status: 'AVAILABLE',
        reason: null,
        target: arm('180+0', 0),
        comparator: arm('180+2', 2),
        deltas: {
          scorePercentagePoints: -19,
          averageScoreLossCp: 34,
          majorErrorRatePercentagePoints: 0,
          blunderRatePercentagePoints: 0,
        },
        evidenceStrength: { result: 'MEDIUM', quality: 'LOW' },
        ratingComposition: {
          status: 'AVAILABLE',
          reason: null,
          materialCompositionWarning: false,
        },
      }],
      caveats: {
        total: 1,
        returned: 1,
        truncated: false,
        items: ['Observational comparison only.'],
      },
    },
    incrementEffect: {
      diagnosisId: 'TIME-006',
      policyVersion: 'increment-effect-v1',
      timeBehaviorPolicyVersion: 'time-behavior-v1',
      timingDerivationVersion: 1,
      coverage: {
        status: 'PARTIAL',
        reason: 'engine-analysis-incomplete',
        candidateGames: 16,
        eligibleGames: 16,
        matchedGames: 16,
        unmatchedGames: 0,
        matchedInitialTimeStrata: 1,
        resultCoveragePercent: 100,
        analysisCoveragePercent: 87.5,
        timingCoveragePercent: 87.5,
      },
      stratumCount: { total: 1, returned: 1, truncated: false },
      strata: [{
        initialSeconds: 180,
        noIncrement: incrementArm('180+0', 0),
        increment: incrementArm('180+2', 2),
        deltas: {
          scorePercentagePoints: 19,
          averageScoreLossCp: -34,
          majorErrorRatePercentagePoints: 0,
          blunderRatePercentagePoints: 0,
          pressureMoveRatePercentagePoints: -9,
          pressureEntryRatePercentagePoints: -25,
        },
        evidenceStrength: {
          result: 'MEDIUM',
          quality: 'LOW',
          timing: 'LOW',
        },
        ratingComposition: {
          status: 'AVAILABLE',
          reason: null,
          materialCompositionWarning: false,
        },
      }],
      caveats: {
        total: 1,
        returned: 1,
        truncated: false,
        items: ['Deltas are increment minus no-increment.'],
      },
    },
  };
}

test('time-control comparison query accepts optional half-open UTC bounds', () => {
  assert.deepEqual(timeControlComparisonQuerySchema.parse({}), {});
  assert.deepEqual(
    timeControlComparisonQuerySchema.parse({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
    }),
    {
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
    },
  );
  assert.equal(
    timeControlComparisonQuerySchema.safeParse({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
    }).success,
    false,
  );
  assert.equal(
    timeControlComparisonQuerySchema.safeParse({ from: 'not-a-date' }).success,
    false,
  );
  assert.equal(
    timeControlComparisonQuerySchema.safeParse({ extra: true }).success,
    false,
  );
});

test('time-control comparison response preserves exact controls and matched increment strata', () => {
  const fixture = response();
  assert.deepEqual(timeControlComparisonResponseSchema.parse(fixture), fixture);
  assert.equal(fixture.exactControl.comparisons[0].target.exactTimeControlKey, '180+0');
  assert.equal(fixture.exactControl.comparisons[0].comparator.exactTimeControlKey, '180+2');
  assert.equal(fixture.incrementEffect.strata[0].noIncrement.exactControls.items[0].exactTimeControlKey, '180+0');
  assert.equal(fixture.incrementEffect.strata[0].increment.exactControls.items[0].exactTimeControlKey, '180+2');
});

test('time-control comparison response is strict and enforces collection caps', () => {
  const fixture = response();
  assert.equal(
    timeControlComparisonResponseSchema.safeParse({
      ...fixture,
      internalGameIds: [1, 2, 3],
    }).success,
    false,
  );

  assert.equal(
    timeControlComparisonResponseSchema.safeParse({
      ...fixture,
      exactControl: {
        ...fixture.exactControl,
        comparisons: Array.from(
          { length: 26 },
          () => fixture.exactControl.comparisons[0],
        ),
      },
    }).success,
    false,
  );

  assert.equal(
    timeControlComparisonResponseSchema.safeParse({
      ...fixture,
      incrementEffect: {
        ...fixture.incrementEffect,
        strata: [{
          ...fixture.incrementEffect.strata[0],
          increment: {
            ...fixture.incrementEffect.strata[0].increment,
            exactControls: {
              total: 13,
              returned: 13,
              truncated: false,
              items: Array.from(
                { length: 13 },
                (_, index) => ({
                  exactTimeControlKey: '180+' + (index + 1),
                  incrementSeconds: index + 1,
                  games: 1,
                }),
              ),
            },
          },
        }],
      },
    }).success,
    false,
  );
});
