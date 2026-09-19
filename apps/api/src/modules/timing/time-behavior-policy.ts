export const TIME_BEHAVIOR_POLICY_VERSION = 'time-behavior-v1';

export const TIME_PRESSURE_THRESHOLD_CENTISECONDS = 3_000;
export const TIME_CRITICAL_THRESHOLD_CENTISECONDS = 1_000;
export const TIME_AMPLE_CLOCK_MIN_CENTISECONDS = 4_500;
export const TIME_AMPLE_CLOCK_INITIAL_FRACTION = 0.25;
export const TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS = 100;
export const TIME_FAST_OPPONENT_SEQUENCE_LENGTH = 2;
export const TIME_EARLY_PHASE = 'OPENING' as const;
export const TIME_EARLY_OVERUSE_MEDIAN_MULTIPLIER = 1.5;

export const TIME_BEHAVIOR_MIN_REQUIRED_COVERAGE_PERCENT = 50;
export const TIME_BEHAVIOR_LOW_EVIDENCE_GAMES = 5;
export const TIME_BEHAVIOR_MEDIUM_EVIDENCE_GAMES = 15;
export const TIME_BEHAVIOR_HIGH_EVIDENCE_GAMES = 40;

export const RATING_COMPOSITION_MEAN_DELTA_WARNING_POINTS = 100;
export const RATING_COMPOSITION_BAND_SHARE_DELTA_WARNING_PERCENTAGE_POINTS = 20;

export type RemainingClockBand = 'CRITICAL' | 'PRESSURE' | 'NORMAL';
export type MoveSpeedBand = 'FAST' | 'NORMAL';
export type TimingBehaviorEvidenceStrength = 'INSUFFICIENT' | 'LOW' | 'MEDIUM' | 'HIGH';
export type RatingDifferenceBand =
  | 'MUCH_WEAKER'
  | 'WEAKER'
  | 'EVEN'
  | 'STRONGER'
  | 'MUCH_STRONGER';

export interface TimingBehaviorEvidenceArm {
  supportingGames: number;
  requiredEvidenceCoveragePercent: number | null;
}

function isNonNegativeFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function roundTimingBehaviorMetric(value: number): number {
  return Math.round(value * 10) / 10;
}

export function timingBehaviorPercentage(
  numerator: number,
  denominator: number,
): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return roundTimingBehaviorMetric((numerator / denominator) * 100);
}

export function classifyRemainingClock(
  remainingCentiseconds: number | null | undefined,
): RemainingClockBand | null {
  if (!isNonNegativeFinite(remainingCentiseconds)) return null;
  if (remainingCentiseconds <= TIME_CRITICAL_THRESHOLD_CENTISECONDS) return 'CRITICAL';
  if (remainingCentiseconds <= TIME_PRESSURE_THRESHOLD_CENTISECONDS) return 'PRESSURE';
  return 'NORMAL';
}

export function isPressureClock(
  remainingCentiseconds: number | null | undefined,
): boolean | null {
  const band = classifyRemainingClock(remainingCentiseconds);
  return band === null ? null : band !== 'NORMAL';
}

export function isAmpleClock(
  remainingCentiseconds: number | null | undefined,
  initialTimeCentiseconds: number | null | undefined,
): boolean | null {
  if (
    !isNonNegativeFinite(remainingCentiseconds)
    || !isNonNegativeFinite(initialTimeCentiseconds)
    || initialTimeCentiseconds === 0
  ) {
    return null;
  }

  const threshold = Math.max(
    TIME_AMPLE_CLOCK_MIN_CENTISECONDS,
    initialTimeCentiseconds * TIME_AMPLE_CLOCK_INITIAL_FRACTION,
  );
  return remainingCentiseconds >= threshold;
}

export function classifyMoveSpeed(
  moveTimeCentiseconds: number | null | undefined,
): MoveSpeedBand | null {
  if (!isNonNegativeFinite(moveTimeCentiseconds)) return null;
  return moveTimeCentiseconds <= TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS ? 'FAST' : 'NORMAL';
}

export function classifyRatingDifference(
  opponentMinusUserRating: number | null | undefined,
): RatingDifferenceBand | null {
  if (typeof opponentMinusUserRating !== 'number' || !Number.isFinite(opponentMinusUserRating)) {
    return null;
  }
  if (opponentMinusUserRating <= -200) return 'MUCH_WEAKER';
  if (opponentMinusUserRating <= -100) return 'WEAKER';
  if (opponentMinusUserRating < 100) return 'EVEN';
  if (opponentMinusUserRating < 200) return 'STRONGER';
  return 'MUCH_STRONGER';
}

export function timingBehaviorEvidenceStrength(
  arm: TimingBehaviorEvidenceArm,
): TimingBehaviorEvidenceStrength {
  if (
    arm.requiredEvidenceCoveragePercent === null
    || !Number.isFinite(arm.requiredEvidenceCoveragePercent)
    || arm.requiredEvidenceCoveragePercent < TIME_BEHAVIOR_MIN_REQUIRED_COVERAGE_PERCENT
    || arm.supportingGames < TIME_BEHAVIOR_LOW_EVIDENCE_GAMES
  ) {
    return 'INSUFFICIENT';
  }
  if (arm.supportingGames < TIME_BEHAVIOR_MEDIUM_EVIDENCE_GAMES) return 'LOW';
  if (arm.supportingGames < TIME_BEHAVIOR_HIGH_EVIDENCE_GAMES) return 'MEDIUM';
  return 'HIGH';
}

export function comparativeTimingBehaviorEvidenceStrength(
  left: TimingBehaviorEvidenceArm,
  right: TimingBehaviorEvidenceArm,
): TimingBehaviorEvidenceStrength {
  const leftStrength = timingBehaviorEvidenceStrength(left);
  const rightStrength = timingBehaviorEvidenceStrength(right);
  if (leftStrength === 'INSUFFICIENT' || rightStrength === 'INSUFFICIENT') return 'INSUFFICIENT';
  if (leftStrength === 'LOW' || rightStrength === 'LOW') return 'LOW';
  if (leftStrength === 'MEDIUM' || rightStrength === 'MEDIUM') return 'MEDIUM';
  return 'HIGH';
}

export function isMaterialRatingCompositionDifference(input: {
  meanRatingDifferenceDeltaPoints: number | null;
  maxBandShareDeltaPercentagePoints: number | null;
}): boolean | null {
  const hasMean = typeof input.meanRatingDifferenceDeltaPoints === 'number'
    && Number.isFinite(input.meanRatingDifferenceDeltaPoints);
  const hasBandShare = typeof input.maxBandShareDeltaPercentagePoints === 'number'
    && Number.isFinite(input.maxBandShareDeltaPercentagePoints);

  if (!hasMean && !hasBandShare) return null;

  return (
    (hasMean
      && Math.abs(input.meanRatingDifferenceDeltaPoints as number)
        >= RATING_COMPOSITION_MEAN_DELTA_WARNING_POINTS)
    || (hasBandShare
      && Math.abs(input.maxBandShareDeltaPercentagePoints as number)
        >= RATING_COMPOSITION_BAND_SHARE_DELTA_WARNING_PERCENTAGE_POINTS)
  );
}
