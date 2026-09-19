import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TIME_BEHAVIOR_POLICY_VERSION,
  TIME_EARLY_PHASE,
  TIME_EARLY_OVERUSE_MEDIAN_MULTIPLIER,
  TIME_FAST_OPPONENT_SEQUENCE_LENGTH,
  classifyMoveSpeed,
  classifyRatingDifference,
  classifyRemainingClock,
  comparativeTimingBehaviorEvidenceStrength,
  isAmpleClock,
  isMaterialRatingCompositionDifference,
  isPressureClock,
  timingBehaviorEvidenceStrength,
  timingBehaviorPercentage,
} from '../dist/modules/timing/time-behavior-policy.js';

test('time behavior policy exposes one versioned shared contract', () => {
  assert.equal(TIME_BEHAVIOR_POLICY_VERSION, 'time-behavior-v1');
  assert.equal(TIME_EARLY_PHASE, 'OPENING');
  assert.equal(TIME_EARLY_OVERUSE_MEDIAN_MULTIPLIER, 1.5);
  assert.equal(TIME_FAST_OPPONENT_SEQUENCE_LENGTH, 2);
});

test('remaining-clock pressure boundaries are inclusive and null-safe', () => {
  assert.equal(classifyRemainingClock(0), 'CRITICAL');
  assert.equal(classifyRemainingClock(1_000), 'CRITICAL');
  assert.equal(classifyRemainingClock(1_001), 'PRESSURE');
  assert.equal(classifyRemainingClock(3_000), 'PRESSURE');
  assert.equal(classifyRemainingClock(3_001), 'NORMAL');
  assert.equal(classifyRemainingClock(-1), null);
  assert.equal(classifyRemainingClock(null), null);
  assert.equal(isPressureClock(3_000), true);
  assert.equal(isPressureClock(3_001), false);
});

test('ample clock uses the larger of the absolute floor and initial-time fraction', () => {
  assert.equal(isAmpleClock(4_499, 6_000), false);
  assert.equal(isAmpleClock(4_500, 6_000), true);
  assert.equal(isAmpleClock(4_499, 18_000), false);
  assert.equal(isAmpleClock(4_500, 18_000), true);
  assert.equal(isAmpleClock(14_999, 60_000), false);
  assert.equal(isAmpleClock(15_000, 60_000), true);
  assert.equal(isAmpleClock(null, 18_000), null);
  assert.equal(isAmpleClock(5_000, null), null);
});

test('fast-move classification uses the same one-second boundary for user and opponent policy consumers', () => {
  assert.equal(classifyMoveSpeed(0), 'FAST');
  assert.equal(classifyMoveSpeed(100), 'FAST');
  assert.equal(classifyMoveSpeed(101), 'NORMAL');
  assert.equal(classifyMoveSpeed(-1), null);
});

test('rating-difference bands use opponent rating minus user rating with deterministic boundaries', () => {
  assert.equal(classifyRatingDifference(-200), 'MUCH_WEAKER');
  assert.equal(classifyRatingDifference(-199), 'WEAKER');
  assert.equal(classifyRatingDifference(-100), 'WEAKER');
  assert.equal(classifyRatingDifference(-99), 'EVEN');
  assert.equal(classifyRatingDifference(99), 'EVEN');
  assert.equal(classifyRatingDifference(100), 'STRONGER');
  assert.equal(classifyRatingDifference(199), 'STRONGER');
  assert.equal(classifyRatingDifference(200), 'MUCH_STRONGER');
  assert.equal(classifyRatingDifference(null), null);
});

test('evidence strength applies the 50 percent coverage gate and 5/15/40 supporting-game thresholds', () => {
  assert.equal(timingBehaviorEvidenceStrength({
    supportingGames: 40,
    requiredEvidenceCoveragePercent: 49.9,
  }), 'INSUFFICIENT');
  assert.equal(timingBehaviorEvidenceStrength({
    supportingGames: 4,
    requiredEvidenceCoveragePercent: 100,
  }), 'INSUFFICIENT');
  assert.equal(timingBehaviorEvidenceStrength({
    supportingGames: 5,
    requiredEvidenceCoveragePercent: 50,
  }), 'LOW');
  assert.equal(timingBehaviorEvidenceStrength({
    supportingGames: 15,
    requiredEvidenceCoveragePercent: 50,
  }), 'MEDIUM');
  assert.equal(timingBehaviorEvidenceStrength({
    supportingGames: 40,
    requiredEvidenceCoveragePercent: 50,
  }), 'HIGH');

  assert.equal(comparativeTimingBehaviorEvidenceStrength(
    { supportingGames: 40, requiredEvidenceCoveragePercent: 100 },
    { supportingGames: 14, requiredEvidenceCoveragePercent: 100 },
  ), 'LOW');
});

test('rating-composition warning thresholds and metric rounding are deterministic', () => {
  assert.equal(isMaterialRatingCompositionDifference({
    meanRatingDifferenceDeltaPoints: 99.9,
    maxBandShareDeltaPercentagePoints: 19.9,
  }), false);
  assert.equal(isMaterialRatingCompositionDifference({
    meanRatingDifferenceDeltaPoints: -100,
    maxBandShareDeltaPercentagePoints: 0,
  }), true);
  assert.equal(isMaterialRatingCompositionDifference({
    meanRatingDifferenceDeltaPoints: 0,
    maxBandShareDeltaPercentagePoints: 20,
  }), true);
  assert.equal(isMaterialRatingCompositionDifference({
    meanRatingDifferenceDeltaPoints: null,
    maxBandShareDeltaPercentagePoints: null,
  }), null);
  assert.equal(timingBehaviorPercentage(1, 3), 33.3);
  assert.equal(timingBehaviorPercentage(0, 0), null);
});
