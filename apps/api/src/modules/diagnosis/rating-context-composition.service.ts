import {
  TIME_BEHAVIOR_POLICY_VERSION,
  classifyRatingDifference,
  comparativeTimingBehaviorEvidenceStrength,
  isMaterialRatingCompositionDifference,
  roundTimingBehaviorMetric,
  timingBehaviorPercentage,
  type RatingDifferenceBand,
  type TimingBehaviorEvidenceStrength,
} from '../timing/time-behavior-policy';

export const RATING_CONTEXT_COMPOSITION_POLICY_VERSION = 'rating-context-composition-v1';
export const RATING_CONTEXT_MAX_TOTAL_GAMES = 5_000;

export interface RatingContextCompositionArmInput {
  importedGameIds: readonly number[];
}

export interface RatingContextCompositionInput {
  left: RatingContextCompositionArmInput;
  right: RatingContextCompositionArmInput;
}

export interface RatingContextGame {
  importedGameId: number;
  userRating: number | null;
  opponentRating: number | null;
}

export interface RatingContextCompositionRepository {
  loadOwnedRatingContext(
    appUserId: number,
    importedGameIds: readonly number[],
  ): Promise<RatingContextGame[]>;
}

export interface RatingContextCompositionArm {
  inputGames: number;
  ratingCoveredGames: number;
  ratingCoveragePercent: number | null;
  averageUserRating: number | null;
  averageOpponentRating: number | null;
  averageRatingDifference: number | null;
  bandCounts: Record<RatingDifferenceBand, number>;
  bandSharesPercent: Record<RatingDifferenceBand, number | null>;
}

export interface RatingContextCompositionResult {
  diagnosisId: 'RATING-002';
  policyVersion: string;
  timeBehaviorPolicyVersion: string;
  coverage: {
    status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
    reason: string | null;
    inputGames: number;
    loadedOwnedGames: number;
  };
  arms: {
    left: RatingContextCompositionArm;
    right: RatingContextCompositionArm;
  };
  comparison: {
    meanRatingDifferenceDeltaPoints: number | null;
    absoluteMeanRatingDifferenceDeltaPoints: number | null;
    bandShareDeltaPercentagePoints: Record<RatingDifferenceBand, number | null>;
    maxBandShareDeltaPercentagePoints: number | null;
    evidenceStrength: TimingBehaviorEvidenceStrength;
    materialCompositionWarning: boolean | null;
  };
  caveats: string[];
}

const RATING_BANDS: readonly RatingDifferenceBand[] = [
  'MUCH_WEAKER',
  'WEAKER',
  'EVEN',
  'STRONGER',
  'MUCH_STRONGER',
];

function emptyBandCounts(): Record<RatingDifferenceBand, number> {
  return {
    MUCH_WEAKER: 0,
    WEAKER: 0,
    EVEN: 0,
    STRONGER: 0,
    MUCH_STRONGER: 0,
  };
}

function emptyBandShares(): Record<RatingDifferenceBand, number | null> {
  return {
    MUCH_WEAKER: null,
    WEAKER: null,
    EVEN: null,
    STRONGER: null,
    MUCH_STRONGER: null,
  };
}

function emptyArm(inputGames: number): RatingContextCompositionArm {
  return {
    inputGames,
    ratingCoveredGames: 0,
    ratingCoveragePercent: timingBehaviorPercentage(0, inputGames),
    averageUserRating: null,
    averageOpponentRating: null,
    averageRatingDifference: null,
    bandCounts: emptyBandCounts(),
    bandSharesPercent: emptyBandShares(),
  };
}

function emptyBandDeltas(): Record<RatingDifferenceBand, number | null> {
  return {
    MUCH_WEAKER: null,
    WEAKER: null,
    EVEN: null,
    STRONGER: null,
    MUCH_STRONGER: null,
  };
}

function inputProblem(input: RatingContextCompositionInput): string | null {
  const left = [...input.left.importedGameIds];
  const right = [...input.right.importedGameIds];
  if (left.length === 0 || right.length === 0) return 'empty-rating-comparison-arm';

  const all = [...left, ...right];
  if (all.length > RATING_CONTEXT_MAX_TOTAL_GAMES) return 'rating-comparison-too-large';
  if (all.some((id) => !Number.isInteger(id) || id <= 0)) return 'invalid-imported-game-id';
  if (new Set(all).size !== all.length) return 'duplicate-or-overlapping-game-ids';
  return null;
}

function unavailable(
  input: RatingContextCompositionInput,
  reason: string,
  loadedOwnedGames: number,
): RatingContextCompositionResult {
  return {
    diagnosisId: 'RATING-002',
    policyVersion: RATING_CONTEXT_COMPOSITION_POLICY_VERSION,
    timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
    coverage: {
      status: 'UNAVAILABLE',
      reason,
      inputGames: input.left.importedGameIds.length + input.right.importedGameIds.length,
      loadedOwnedGames,
    },
    arms: {
      left: emptyArm(input.left.importedGameIds.length),
      right: emptyArm(input.right.importedGameIds.length),
    },
    comparison: {
      meanRatingDifferenceDeltaPoints: null,
      absoluteMeanRatingDifferenceDeltaPoints: null,
      bandShareDeltaPercentagePoints: emptyBandDeltas(),
      maxBandShareDeltaPercentagePoints: null,
      evidenceStrength: 'INSUFFICIENT',
      materialCompositionWarning: null,
    },
    caveats: [
      'No opponent-strength composition conclusion is available from this aggregate.',
      'RATING-002 is a confounder disclosure only and never adjusts another aggregate\'s measured effect.',
    ],
  };
}

function hasRatings(
  row: RatingContextGame,
): row is RatingContextGame & { userRating: number; opponentRating: number } {
  return typeof row.userRating === 'number'
    && Number.isFinite(row.userRating)
    && typeof row.opponentRating === 'number'
    && Number.isFinite(row.opponentRating);
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return roundTimingBehaviorMetric(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function summarizeArm(
  importedGameIds: readonly number[],
  rowById: ReadonlyMap<number, RatingContextGame>,
): RatingContextCompositionArm {
  const rows = importedGameIds.map((id) => rowById.get(id) as RatingContextGame);
  const rated = rows.filter(hasRatings).map((row) => {
    const ratingDifference = row.opponentRating - row.userRating;
    const band = classifyRatingDifference(ratingDifference);
    if (band === null) {
      throw new Error('Finite rating difference unexpectedly failed classification');
    }
    return { ...row, ratingDifference, band };
  });

  const bandCounts = emptyBandCounts();
  for (const row of rated) {
    bandCounts[row.band] += 1;
  }

  const bandSharesPercent = emptyBandShares();
  for (const band of RATING_BANDS) {
    bandSharesPercent[band] = timingBehaviorPercentage(bandCounts[band], rated.length);
  }

  return {
    inputGames: importedGameIds.length,
    ratingCoveredGames: rated.length,
    ratingCoveragePercent: timingBehaviorPercentage(rated.length, importedGameIds.length),
    averageUserRating: average(rated.map((row) => row.userRating)),
    averageOpponentRating: average(rated.map((row) => row.opponentRating)),
    averageRatingDifference: average(rated.map((row) => row.ratingDifference)),
    bandCounts,
    bandSharesPercent,
  };
}

function delta(right: number | null, left: number | null): number | null {
  if (left === null || right === null) return null;
  return roundTimingBehaviorMetric(right - left);
}

function bandDeltas(
  left: RatingContextCompositionArm,
  right: RatingContextCompositionArm,
): Record<RatingDifferenceBand, number | null> {
  const deltas = emptyBandDeltas();
  for (const band of RATING_BANDS) {
    deltas[band] = delta(right.bandSharesPercent[band], left.bandSharesPercent[band]);
  }
  return deltas;
}

function maxAbsoluteBandDelta(
  deltas: Record<RatingDifferenceBand, number | null>,
): number | null {
  const values = RATING_BANDS
    .map((band) => deltas[band])
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return roundTimingBehaviorMetric(Math.max(...values.map((value) => Math.abs(value))));
}

function coverageStatus(
  left: RatingContextCompositionArm,
  right: RatingContextCompositionArm,
): Pick<RatingContextCompositionResult['coverage'], 'status' | 'reason'> {
  if (left.ratingCoveredGames === 0 || right.ratingCoveredGames === 0) {
    return { status: 'UNAVAILABLE', reason: 'rating-evidence-unavailable' };
  }
  if (
    left.ratingCoveredGames !== left.inputGames
    || right.ratingCoveredGames !== right.inputGames
  ) {
    return { status: 'PARTIAL', reason: 'rating-coverage-incomplete' };
  }
  return { status: 'COMPLETE', reason: null };
}

export function buildRatingContextComposition(
  input: RatingContextCompositionInput,
  rows: readonly RatingContextGame[],
): RatingContextCompositionResult {
  const problem = inputProblem(input);
  if (problem) return unavailable(input, problem, rows.length);

  const rowById = new Map<number, RatingContextGame>();
  for (const row of rows) {
    if (rowById.has(row.importedGameId)) {
      return unavailable(input, 'duplicate-rating-context-row', rows.length);
    }
    rowById.set(row.importedGameId, row);
  }

  const expectedIds = [
    ...input.left.importedGameIds,
    ...input.right.importedGameIds,
  ];
  const expected = new Set(expectedIds);
  if (
    rows.length !== expected.size
    || rows.some((row) => !expected.has(row.importedGameId))
    || expectedIds.some((id) => !rowById.has(id))
  ) {
    return unavailable(input, 'rating-game-set-changed-during-read', rows.length);
  }

  const left = summarizeArm(input.left.importedGameIds, rowById);
  const right = summarizeArm(input.right.importedGameIds, rowById);
  const coverage = coverageStatus(left, right);
  const meanRatingDifferenceDeltaPoints = delta(
    right.averageRatingDifference,
    left.averageRatingDifference,
  );
  const bandShareDeltaPercentagePoints = bandDeltas(left, right);
  const maxBandShareDeltaPercentagePoints = maxAbsoluteBandDelta(
    bandShareDeltaPercentagePoints,
  );
  const evidenceStrength = comparativeTimingBehaviorEvidenceStrength(
    {
      supportingGames: left.ratingCoveredGames,
      requiredEvidenceCoveragePercent: left.ratingCoveragePercent,
    },
    {
      supportingGames: right.ratingCoveredGames,
      requiredEvidenceCoveragePercent: right.ratingCoveragePercent,
    },
  );
  const materialCompositionWarning = evidenceStrength === 'INSUFFICIENT'
    ? null
    : isMaterialRatingCompositionDifference({
        meanRatingDifferenceDeltaPoints,
        maxBandShareDeltaPercentagePoints,
      });

  const caveats = [
    'RATING-002 describes opponent-strength composition differences; it does not establish why another measured effect exists.',
    'The warning is reported separately and never adjusts, normalizes, or rewrites another aggregate\'s measured effect.',
  ];
  if (coverage.status !== 'COMPLETE') {
    caveats.push('Some input games lack both user and opponent ratings and remain explicit rating-coverage loss.');
  }
  if (evidenceStrength === 'INSUFFICIENT') {
    caveats.push('The weaker arm does not meet the shared sample and rating-coverage gates, so no material-composition warning is emitted.');
  }

  return {
    diagnosisId: 'RATING-002',
    policyVersion: RATING_CONTEXT_COMPOSITION_POLICY_VERSION,
    timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
    coverage: {
      ...coverage,
      inputGames: expectedIds.length,
      loadedOwnedGames: rows.length,
    },
    arms: { left, right },
    comparison: {
      meanRatingDifferenceDeltaPoints,
      absoluteMeanRatingDifferenceDeltaPoints: meanRatingDifferenceDeltaPoints === null
        ? null
        : roundTimingBehaviorMetric(Math.abs(meanRatingDifferenceDeltaPoints)),
      bandShareDeltaPercentagePoints,
      maxBandShareDeltaPercentagePoints,
      evidenceStrength,
      materialCompositionWarning,
    },
    caveats,
  };
}

export async function getRatingContextComposition(
  appUserId: number,
  input: RatingContextCompositionInput,
  repository: RatingContextCompositionRepository,
): Promise<RatingContextCompositionResult> {
  const problem = inputProblem(input);
  if (problem) return unavailable(input, problem, 0);

  const importedGameIds = [
    ...input.left.importedGameIds,
    ...input.right.importedGameIds,
  ];
  const rows = await repository.loadOwnedRatingContext(appUserId, importedGameIds);
  return buildRatingContextComposition(input, rows);
}
