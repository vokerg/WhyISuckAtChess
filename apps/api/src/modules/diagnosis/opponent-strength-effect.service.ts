import {
  TIME_BEHAVIOR_POLICY_VERSION,
  classifyRatingDifference,
  comparativeTimingBehaviorEvidenceStrength,
  roundTimingBehaviorMetric,
  timingBehaviorEvidenceStrength,
  timingBehaviorPercentage,
  type RatingDifferenceBand,
  type TimingBehaviorEvidenceStrength,
} from '../timing/time-behavior-policy';
import { isTimingEligibleGame } from '../timing/timing-policy';

export const OPPONENT_STRENGTH_EFFECT_POLICY_VERSION = 'opponent-strength-effect-v1';
export const OPPONENT_STRENGTH_EFFECT_MAX_CANDIDATE_GAMES = 5_000;

export interface OpponentStrengthEffectScope {
  from?: Date;
  to?: Date;
}

export interface OpponentStrengthEffectSourceGame {
  importedGameId: number;
  variant: string | null;
  speedCategory: string | null;
  exactTimeControlKey: string | null;
  userRating: number | null;
  opponentRating: number | null;
  resultForUser: string | null;
  analysedUserMoves: number;
  scoreLossTotalCp: number | null;
  majorErrorMoves: number;
  blunderMoves: number;
}

export interface OpponentStrengthEffectRepository {
  countCandidates(appUserId: number, scope: OpponentStrengthEffectScope): Promise<number>;
  loadCandidates(
    appUserId: number,
    scope: OpponentStrengthEffectScope,
  ): Promise<OpponentStrengthEffectSourceGame[]>;
}

export interface OpponentStrengthBandDefinition {
  minInclusive: number | null;
  maxInclusive: number | null;
}

export interface OpponentStrengthMetrics {
  games: number;
  averageUserRating: number | null;
  averageOpponentRating: number | null;
  averageRatingDifference: number | null;
  resultCoveredGames: number;
  resultCoveragePercent: number | null;
  wins: number;
  draws: number;
  losses: number;
  scorePercent: number | null;
  analysedGames: number;
  analysisCoveragePercent: number | null;
  analysedUserMoves: number;
  averageScoreLossCp: number | null;
  majorErrorMoves: number;
  majorErrorRatePercent: number | null;
  blunderMoves: number;
  blunderRatePercent: number | null;
  resultEvidenceStrength: TimingBehaviorEvidenceStrength;
  qualityEvidenceStrength: TimingBehaviorEvidenceStrength;
}

export interface OpponentStrengthExactControlSummary {
  exactTimeControlKey: string;
  metrics: OpponentStrengthMetrics;
}

export interface OpponentStrengthBandSummary {
  band: RatingDifferenceBand;
  definition: OpponentStrengthBandDefinition;
  metrics: OpponentStrengthMetrics;
  exactControls: OpponentStrengthExactControlSummary[];
}

export interface OpponentStrengthComparisonDeltas {
  scorePercentagePoints: number | null;
  averageScoreLossCp: number | null;
  majorErrorRatePercentagePoints: number | null;
  blunderRatePercentagePoints: number | null;
}

export interface OpponentStrengthMatchedComparison {
  exactTimeControlKey: string;
  targetBand: Exclude<RatingDifferenceBand, 'EVEN'>;
  baselineBand: RatingDifferenceBand;
  status: 'AVAILABLE' | 'INSUFFICIENT' | 'UNAVAILABLE';
  reason: string | null;
  target: OpponentStrengthMetrics;
  baseline: OpponentStrengthMetrics | null;
  deltas: OpponentStrengthComparisonDeltas;
  evidenceStrength: {
    result: TimingBehaviorEvidenceStrength;
    quality: TimingBehaviorEvidenceStrength;
  };
}

export interface OpponentStrengthEffectResult {
  diagnosisId: 'RATING-001';
  policyVersion: string;
  timeBehaviorPolicyVersion: string;
  bandDefinitions: Record<RatingDifferenceBand, OpponentStrengthBandDefinition>;
  coverage: {
    status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
    reason: string | null;
    candidateGames: number;
    supportedGames: number;
    unsupportedGames: number;
    ratingCoveredGames: number;
    ratingCoveragePercent: number | null;
    missingRatingGames: number;
    exactControlCoveredGames: number;
    exactControlCoveragePercent: number | null;
    missingExactControlGames: number;
    eligibleGames: number;
    resultCoveredGames: number;
    resultCoveragePercent: number | null;
    analysedGames: number;
    analysisCoveragePercent: number | null;
    representedBands: number;
    representedExactControls: number;
    matchedComparisons: number;
    maxCandidateGames: number;
  };
  bands: OpponentStrengthBandSummary[];
  comparisons: OpponentStrengthMatchedComparison[];
  caveats: string[];
}

export const OPPONENT_STRENGTH_BAND_DEFINITIONS: Record<
  RatingDifferenceBand,
  OpponentStrengthBandDefinition
> = {
  MUCH_WEAKER: { minInclusive: null, maxInclusive: -200 },
  WEAKER: { minInclusive: -199, maxInclusive: -100 },
  EVEN: { minInclusive: -99, maxInclusive: 99 },
  STRONGER: { minInclusive: 100, maxInclusive: 199 },
  MUCH_STRONGER: { minInclusive: 200, maxInclusive: null },
};

const RATING_BANDS: readonly RatingDifferenceBand[] = [
  'MUCH_WEAKER',
  'WEAKER',
  'EVEN',
  'STRONGER',
  'MUCH_STRONGER',
];

const ADJACENT_BASELINE: Record<
  Exclude<RatingDifferenceBand, 'EVEN'>,
  RatingDifferenceBand
> = {
  MUCH_WEAKER: 'WEAKER',
  WEAKER: 'EVEN',
  STRONGER: 'EVEN',
  MUCH_STRONGER: 'STRONGER',
};

type EligibleGame = OpponentStrengthEffectSourceGame & {
  exactTimeControlKey: string;
  userRating: number;
  opponentRating: number;
  ratingDifference: number;
  ratingBand: RatingDifferenceBand;
};

function validateScope(scope: OpponentStrengthEffectScope): void {
  if (
    scope.from
    && scope.to
    && scope.from.getTime() >= scope.to.getTime()
  ) {
    throw new RangeError('Opponent-strength scope must have from < to');
  }
}

function exactControlKey(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function hasRatings(game: OpponentStrengthEffectSourceGame): game is OpponentStrengthEffectSourceGame & {
  userRating: number;
  opponentRating: number;
} {
  return typeof game.userRating === 'number'
    && Number.isFinite(game.userRating)
    && typeof game.opponentRating === 'number'
    && Number.isFinite(game.opponentRating);
}

function isCoveredResult(value: string | null): value is 'WIN' | 'DRAW' | 'LOSS' {
  return value === 'WIN' || value === 'DRAW' || value === 'LOSS';
}

function isAnalysedGame(game: OpponentStrengthEffectSourceGame): boolean {
  return Number.isInteger(game.analysedUserMoves)
    && game.analysedUserMoves > 0
    && typeof game.scoreLossTotalCp === 'number'
    && Number.isFinite(game.scoreLossTotalCp)
    && game.scoreLossTotalCp >= 0;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return roundTimingBehaviorMetric(
    values.reduce((sum, value) => sum + value, 0) / values.length,
  );
}

function scorePercent(wins: number, draws: number, losses: number): number | null {
  return timingBehaviorPercentage(wins + draws * 0.5, wins + draws + losses);
}

function summarizeMetrics(games: readonly EligibleGame[]): OpponentStrengthMetrics {
  const results = games.filter((game) => isCoveredResult(game.resultForUser));
  const wins = results.filter((game) => game.resultForUser === 'WIN').length;
  const draws = results.filter((game) => game.resultForUser === 'DRAW').length;
  const losses = results.filter((game) => game.resultForUser === 'LOSS').length;
  const analysed = games.filter(isAnalysedGame);
  const analysedUserMoves = analysed.reduce((sum, game) => sum + game.analysedUserMoves, 0);
  const scoreLossTotalCp = analysed.reduce(
    (sum, game) => sum + (game.scoreLossTotalCp ?? 0),
    0,
  );
  const majorErrorMoves = analysed.reduce((sum, game) => sum + game.majorErrorMoves, 0);
  const blunderMoves = analysed.reduce((sum, game) => sum + game.blunderMoves, 0);
  const resultCoveragePercent = timingBehaviorPercentage(results.length, games.length);
  const analysisCoveragePercent = timingBehaviorPercentage(analysed.length, games.length);

  return {
    games: games.length,
    averageUserRating: average(games.map((game) => game.userRating)),
    averageOpponentRating: average(games.map((game) => game.opponentRating)),
    averageRatingDifference: average(games.map((game) => game.ratingDifference)),
    resultCoveredGames: results.length,
    resultCoveragePercent,
    wins,
    draws,
    losses,
    scorePercent: scorePercent(wins, draws, losses),
    analysedGames: analysed.length,
    analysisCoveragePercent,
    analysedUserMoves,
    averageScoreLossCp: analysedUserMoves > 0
      ? roundTimingBehaviorMetric(scoreLossTotalCp / analysedUserMoves)
      : null,
    majorErrorMoves,
    majorErrorRatePercent: timingBehaviorPercentage(majorErrorMoves, analysedUserMoves),
    blunderMoves,
    blunderRatePercent: timingBehaviorPercentage(blunderMoves, analysedUserMoves),
    resultEvidenceStrength: timingBehaviorEvidenceStrength({
      supportingGames: results.length,
      requiredEvidenceCoveragePercent: resultCoveragePercent,
    }),
    qualityEvidenceStrength: timingBehaviorEvidenceStrength({
      supportingGames: analysed.length,
      requiredEvidenceCoveragePercent: analysisCoveragePercent,
    }),
  };
}

function nullDeltas(): OpponentStrengthComparisonDeltas {
  return {
    scorePercentagePoints: null,
    averageScoreLossCp: null,
    majorErrorRatePercentagePoints: null,
    blunderRatePercentagePoints: null,
  };
}

function delta(target: number | null, baseline: number | null): number | null {
  if (target === null || baseline === null) return null;
  return roundTimingBehaviorMetric(target - baseline);
}

function comparisonDeltas(
  target: OpponentStrengthMetrics,
  baseline: OpponentStrengthMetrics,
): OpponentStrengthComparisonDeltas {
  return {
    scorePercentagePoints: delta(target.scorePercent, baseline.scorePercent),
    averageScoreLossCp: delta(target.averageScoreLossCp, baseline.averageScoreLossCp),
    majorErrorRatePercentagePoints: delta(
      target.majorErrorRatePercent,
      baseline.majorErrorRatePercent,
    ),
    blunderRatePercentagePoints: delta(
      target.blunderRatePercent,
      baseline.blunderRatePercent,
    ),
  };
}

function unavailable(
  candidateGames: number,
  reason: string,
): OpponentStrengthEffectResult {
  return {
    diagnosisId: 'RATING-001',
    policyVersion: OPPONENT_STRENGTH_EFFECT_POLICY_VERSION,
    timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
    bandDefinitions: OPPONENT_STRENGTH_BAND_DEFINITIONS,
    coverage: {
      status: 'UNAVAILABLE',
      reason,
      candidateGames,
      supportedGames: 0,
      unsupportedGames: 0,
      ratingCoveredGames: 0,
      ratingCoveragePercent: null,
      missingRatingGames: 0,
      exactControlCoveredGames: 0,
      exactControlCoveragePercent: null,
      missingExactControlGames: 0,
      eligibleGames: 0,
      resultCoveredGames: 0,
      resultCoveragePercent: null,
      analysedGames: 0,
      analysisCoveragePercent: null,
      representedBands: 0,
      representedExactControls: 0,
      matchedComparisons: 0,
      maxCandidateGames: OPPONENT_STRENGTH_EFFECT_MAX_CANDIDATE_GAMES,
    },
    bands: [],
    comparisons: [],
    caveats: [
      'No opponent-strength effect conclusion is available from this aggregate.',
      'RATING-001 is descriptive and correlational; it does not infer fear, intimidation, confidence, or causality.',
    ],
  };
}

function buildEligibleGames(
  games: readonly OpponentStrengthEffectSourceGame[],
): {
  supported: OpponentStrengthEffectSourceGame[];
  ratingCovered: (OpponentStrengthEffectSourceGame & {
    userRating: number;
    opponentRating: number;
  })[];
  eligible: EligibleGame[];
  missingRatingGames: number;
  missingExactControlGames: number;
} {
  const supported = games.filter((game) => isTimingEligibleGame(game));
  const ratingCovered = supported.filter(hasRatings);
  const eligible: EligibleGame[] = [];
  let missingExactControlGames = 0;

  for (const game of ratingCovered) {
    const key = exactControlKey(game.exactTimeControlKey);
    if (!key) {
      missingExactControlGames += 1;
      continue;
    }
    const ratingDifference = game.opponentRating - game.userRating;
    const ratingBand = classifyRatingDifference(ratingDifference);
    if (!ratingBand) continue;
    eligible.push({
      ...game,
      exactTimeControlKey: key,
      ratingDifference,
      ratingBand,
    });
  }

  return {
    supported,
    ratingCovered,
    eligible,
    missingRatingGames: supported.length - ratingCovered.length,
    missingExactControlGames,
  };
}

function buildBandSummaries(
  eligible: readonly EligibleGame[],
): OpponentStrengthBandSummary[] {
  return RATING_BANDS.flatMap((band) => {
    const bandGames = eligible.filter((game) => game.ratingBand === band);
    if (bandGames.length === 0) return [];

    const controlKeys = [...new Set(
      bandGames.map((game) => game.exactTimeControlKey),
    )].sort();

    return [{
      band,
      definition: OPPONENT_STRENGTH_BAND_DEFINITIONS[band],
      metrics: summarizeMetrics(bandGames),
      exactControls: controlKeys.map((exactTimeControlKey) => ({
        exactTimeControlKey,
        metrics: summarizeMetrics(
          bandGames.filter((game) => game.exactTimeControlKey === exactTimeControlKey),
        ),
      })),
    }];
  });
}

function buildComparisons(
  eligible: readonly EligibleGame[],
): OpponentStrengthMatchedComparison[] {
  const controlKeys = [...new Set(
    eligible.map((game) => game.exactTimeControlKey),
  )].sort();
  const comparisons: OpponentStrengthMatchedComparison[] = [];

  for (const exactTimeControlKey of controlKeys) {
    const controlGames = eligible.filter(
      (game) => game.exactTimeControlKey === exactTimeControlKey,
    );

    for (const targetBand of Object.keys(ADJACENT_BASELINE) as Array<
      Exclude<RatingDifferenceBand, 'EVEN'>
    >) {
      const targetGames = controlGames.filter((game) => game.ratingBand === targetBand);
      if (targetGames.length === 0) continue;

      const baselineBand = ADJACENT_BASELINE[targetBand];
      const baselineGames = controlGames.filter((game) => game.ratingBand === baselineBand);
      const target = summarizeMetrics(targetGames);

      if (baselineGames.length === 0) {
        comparisons.push({
          exactTimeControlKey,
          targetBand,
          baselineBand,
          status: 'UNAVAILABLE',
          reason: 'adjacent-rating-band-unavailable',
          target,
          baseline: null,
          deltas: nullDeltas(),
          evidenceStrength: {
            result: 'INSUFFICIENT',
            quality: 'INSUFFICIENT',
          },
        });
        continue;
      }

      const baseline = summarizeMetrics(baselineGames);
      const resultStrength = comparativeTimingBehaviorEvidenceStrength(
        {
          supportingGames: target.resultCoveredGames,
          requiredEvidenceCoveragePercent: target.resultCoveragePercent,
        },
        {
          supportingGames: baseline.resultCoveredGames,
          requiredEvidenceCoveragePercent: baseline.resultCoveragePercent,
        },
      );
      const qualityStrength = comparativeTimingBehaviorEvidenceStrength(
        {
          supportingGames: target.analysedGames,
          requiredEvidenceCoveragePercent: target.analysisCoveragePercent,
        },
        {
          supportingGames: baseline.analysedGames,
          requiredEvidenceCoveragePercent: baseline.analysisCoveragePercent,
        },
      );
      const insufficient = resultStrength === 'INSUFFICIENT'
        && qualityStrength === 'INSUFFICIENT';

      comparisons.push({
        exactTimeControlKey,
        targetBand,
        baselineBand,
        status: insufficient ? 'INSUFFICIENT' : 'AVAILABLE',
        reason: insufficient ? 'weaker-arm-below-evidence-gate' : null,
        target,
        baseline,
        deltas: comparisonDeltas(target, baseline),
        evidenceStrength: {
          result: resultStrength,
          quality: qualityStrength,
        },
      });
    }
  }

  return comparisons;
}

export function buildOpponentStrengthEffectAggregate(
  games: readonly OpponentStrengthEffectSourceGame[],
): OpponentStrengthEffectResult {
  const {
    supported,
    ratingCovered,
    eligible,
    missingRatingGames,
    missingExactControlGames,
  } = buildEligibleGames(games);

  const unsupportedGames = games.length - supported.length;
  if (eligible.length === 0) {
    const result = unavailable(games.length, 'no-eligible-rating-context-games');
    return {
      ...result,
      coverage: {
        ...result.coverage,
        supportedGames: supported.length,
        unsupportedGames,
        ratingCoveredGames: ratingCovered.length,
        ratingCoveragePercent: timingBehaviorPercentage(ratingCovered.length, supported.length),
        missingRatingGames,
        missingExactControlGames,
        exactControlCoveredGames: 0,
        exactControlCoveragePercent: timingBehaviorPercentage(0, ratingCovered.length),
      },
    };
  }

  const bands = buildBandSummaries(eligible);
  const comparisons = buildComparisons(eligible);
  const matchedComparisons = comparisons.filter(
    (comparison) => comparison.baseline !== null,
  ).length;
  const resultCoveredGames = eligible.filter(
    (game) => isCoveredResult(game.resultForUser),
  ).length;
  const analysedGames = eligible.filter(isAnalysedGame).length;
  const resultCoveragePercent = timingBehaviorPercentage(
    resultCoveredGames,
    eligible.length,
  );
  const analysisCoveragePercent = timingBehaviorPercentage(
    analysedGames,
    eligible.length,
  );
  const ratingCoveragePercent = timingBehaviorPercentage(
    ratingCovered.length,
    supported.length,
  );
  const exactControlCoveragePercent = timingBehaviorPercentage(
    eligible.length,
    ratingCovered.length,
  );
  const representedExactControls = new Set(
    eligible.map((game) => game.exactTimeControlKey),
  ).size;

  let status: OpponentStrengthEffectResult['coverage']['status'];
  let reason: string | null;
  if (matchedComparisons === 0) {
    status = 'UNAVAILABLE';
    reason = 'no-adjacent-rating-band-comparison';
  } else {
    const complete = unsupportedGames === 0
      && missingRatingGames === 0
      && missingExactControlGames === 0
      && resultCoveragePercent === 100
      && analysisCoveragePercent === 100;
    status = complete ? 'COMPLETE' : 'PARTIAL';
    reason = complete
      ? null
      : unsupportedGames > 0
        ? 'unsupported-game-coverage'
        : missingRatingGames > 0
          ? 'rating-coverage-incomplete'
          : missingExactControlGames > 0
            ? 'exact-time-control-coverage-incomplete'
            : resultCoveragePercent !== 100
              ? 'result-coverage-incomplete'
              : 'engine-analysis-incomplete';
  }

  const caveats = [
    'RATING-001 describes associations between opponent-strength bands and the player\'s results/current-engine move quality; it does not establish causality or a psychological response.',
    'Rating difference is opponent minus user rating at game time. Missing ratings are never imputed.',
    'Descriptive band summaries expose exact-control composition. Effect deltas are emitted only inside one exact time control and never pool 3+0 with 3+2 or other controls.',
    'Each non-even target uses the adjacent band toward EVEN as its baseline: MUCH_WEAKER->WEAKER->EVEN<-STRONGER<-MUCH_STRONGER.',
    'Only current complete engine analysis from the same ply-index snapshot contributes quality metrics; stale, superseded, incomplete, or missing analysis is coverage loss.',
    'Result and quality evidence strengths are graded independently from the weaker exact-control-matched arm.',
  ];
  if (unsupportedGames > 0) {
    caveats.push('Games outside the current standard bullet/blitz/rapid cohort are excluded rather than silently mixed into rating-band comparisons.');
  }
  if (missingRatingGames > 0) {
    caveats.push('Some supported games lack both user and opponent ratings and remain explicit rating-coverage loss.');
  }
  if (missingExactControlGames > 0) {
    caveats.push('Some rated supported games lack an exact time-control key and are excluded from matched effect comparisons.');
  }
  if (comparisons.some((comparison) => comparison.status === 'INSUFFICIENT')) {
    caveats.push('Sparse adjacent-band arms retain their descriptive metrics and deltas but are explicitly marked INSUFFICIENT under the shared coverage/sample gate.');
  }

  return {
    diagnosisId: 'RATING-001',
    policyVersion: OPPONENT_STRENGTH_EFFECT_POLICY_VERSION,
    timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
    bandDefinitions: OPPONENT_STRENGTH_BAND_DEFINITIONS,
    coverage: {
      status,
      reason,
      candidateGames: games.length,
      supportedGames: supported.length,
      unsupportedGames,
      ratingCoveredGames: ratingCovered.length,
      ratingCoveragePercent,
      missingRatingGames,
      exactControlCoveredGames: eligible.length,
      exactControlCoveragePercent,
      missingExactControlGames,
      eligibleGames: eligible.length,
      resultCoveredGames,
      resultCoveragePercent,
      analysedGames,
      analysisCoveragePercent,
      representedBands: bands.length,
      representedExactControls,
      matchedComparisons,
      maxCandidateGames: OPPONENT_STRENGTH_EFFECT_MAX_CANDIDATE_GAMES,
    },
    bands,
    comparisons,
    caveats,
  };
}

export async function getOpponentStrengthEffect(
  appUserId: number,
  scope: OpponentStrengthEffectScope,
  repository: OpponentStrengthEffectRepository,
): Promise<OpponentStrengthEffectResult> {
  validateScope(scope);
  const candidateGames = await repository.countCandidates(appUserId, scope);

  if (candidateGames > OPPONENT_STRENGTH_EFFECT_MAX_CANDIDATE_GAMES) {
    return unavailable(candidateGames, 'opponent-strength-scope-too-large');
  }
  if (candidateGames === 0) return unavailable(0, 'no-candidate-games');

  const games = await repository.loadCandidates(appUserId, scope);
  if (games.length !== candidateGames) {
    return unavailable(candidateGames, 'candidate-set-changed-during-read');
  }

  return buildOpponentStrengthEffectAggregate(games);
}
