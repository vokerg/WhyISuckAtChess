import {
  TIME_BEHAVIOR_POLICY_VERSION,
  comparativeTimingBehaviorEvidenceStrength,
  roundTimingBehaviorMetric,
  timingBehaviorEvidenceStrength,
  timingBehaviorPercentage,
  type TimingBehaviorEvidenceStrength,
} from '../timing/time-behavior-policy';
import { isTimingEligibleGame } from '../timing/timing-policy';
import {
  getRatingContextComposition,
  type RatingContextCompositionRepository,
  type RatingContextCompositionResult,
} from './rating-context-composition.service';

export const EXACT_TIME_CONTROL_UNDERPERFORMANCE_POLICY_VERSION =
  'exact-time-control-underperformance-v1';
export const EXACT_TIME_CONTROL_MAX_CANDIDATE_GAMES = 5_000;

export interface ExactTimeControlScope {
  from?: Date;
  to?: Date;
}

export interface ExactTimeControlSourceGame {
  importedGameId: number;
  variant: string | null;
  speedCategory: string | null;
  exactTimeControlKey: string | null;
  timeControlInitial: number | null;
  timeControlIncrement: number | null;
  resultForUser: string | null;
  analysedUserMoves: number;
  scoreLossTotalCp: number | null;
  majorErrorMoves: number;
  blunderMoves: number;
}

export interface ExactTimeControlRepository {
  countCandidates(appUserId: number, scope: ExactTimeControlScope): Promise<number>;
  loadCandidates(
    appUserId: number,
    scope: ExactTimeControlScope,
  ): Promise<ExactTimeControlSourceGame[]>;
}

export interface ExactTimeControlArm {
  exactTimeControlKey: string;
  initialSeconds: number;
  incrementSeconds: number;
  eligibleGames: number;
  resultCoveredGames: number;
  resultCoveragePercent: number | null;
  wins: number;
  draws: number;
  losses: number;
  scorePercent: number | null;
  resultEvidenceStrength: TimingBehaviorEvidenceStrength;
  analysedGames: number;
  analysisCoveragePercent: number | null;
  analysedUserMoves: number;
  averageScoreLossCp: number | null;
  majorErrorRatePercent: number | null;
  blunderRatePercent: number | null;
  qualityEvidenceStrength: TimingBehaviorEvidenceStrength;
  speedCategories: string[];
}

export interface ExactTimeControlRatingComposition {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  reason: string | null;
  result: RatingContextCompositionResult | null;
}

export interface ExactTimeControlComparison {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  reason: string | null;
  target: ExactTimeControlArm;
  comparatorDefinition: {
    initialSeconds: number;
    requiresDifferentIncrement: true;
    broadSpeedFallback: false;
    selectionRule:
      'STRONGEST_RESULT_EVIDENCE_THEN_LARGEST_RESULT_SAMPLE_THEN_NEAREST_INCREMENT_THEN_KEY';
    eligibleComparatorControls: number;
  };
  comparator: ExactTimeControlArm | null;
  deltas: {
    scorePercentagePoints: number | null;
    averageScoreLossCp: number | null;
    majorErrorRatePercentagePoints: number | null;
    blunderRatePercentagePoints: number | null;
  };
  evidenceStrength: {
    result: TimingBehaviorEvidenceStrength;
    quality: TimingBehaviorEvidenceStrength;
  };
  ratingComposition: ExactTimeControlRatingComposition;
}

export interface ExactTimeControlUnderperformanceResult {
  diagnosisId: 'TIME-005';
  policyVersion: string;
  timeBehaviorPolicyVersion: string;
  coverage: {
    status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
    reason: string | null;
    candidateGames: number;
    supportedGames: number;
    unsupportedGames: number;
    missingExactControlGames: number;
    inconsistentControlIdentityGames: number;
    eligibleGames: number;
    exactControls: number;
    controlsWithComparator: number;
    controlsWithoutComparator: number;
    resultCoveredGames: number;
    resultCoveragePercent: number | null;
    analysedGames: number;
    analysisCoveragePercent: number | null;
    maxCandidateGames: number;
  };
  comparisons: ExactTimeControlComparison[];
  caveats: string[];
}

interface ControlGroup {
  exactTimeControlKey: string;
  initialSeconds: number;
  incrementSeconds: number;
  games: ExactTimeControlSourceGame[];
  arm: ExactTimeControlArm;
}

interface ComparisonPair {
  targetKey: string;
  targetGameIds: number[];
  comparatorGameIds: number[];
}

interface AggregateDetail {
  result: ExactTimeControlUnderperformanceResult;
  comparisonPairs: ComparisonPair[];
}

const EVIDENCE_ORDER: Record<TimingBehaviorEvidenceStrength, number> = {
  INSUFFICIENT: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

function emptyCoverage(
  candidateGames: number,
  reason: string,
): ExactTimeControlUnderperformanceResult['coverage'] {
  return {
    status: 'UNAVAILABLE',
    reason,
    candidateGames,
    supportedGames: 0,
    unsupportedGames: 0,
    missingExactControlGames: 0,
    inconsistentControlIdentityGames: 0,
    eligibleGames: 0,
    exactControls: 0,
    controlsWithComparator: 0,
    controlsWithoutComparator: 0,
    resultCoveredGames: 0,
    resultCoveragePercent: null,
    analysedGames: 0,
    analysisCoveragePercent: null,
    maxCandidateGames: EXACT_TIME_CONTROL_MAX_CANDIDATE_GAMES,
  };
}

function unavailable(
  candidateGames: number,
  reason: string,
): ExactTimeControlUnderperformanceResult {
  return {
    diagnosisId: 'TIME-005',
    policyVersion: EXACT_TIME_CONTROL_UNDERPERFORMANCE_POLICY_VERSION,
    timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
    coverage: emptyCoverage(candidateGames, reason),
    comparisons: [],
    caveats: [
      'No exact-time-control comparison is available from this aggregate.',
      'TIME-005 is an observational within-player comparison and does not establish why one control differs from another.',
    ],
  };
}

function validateScope(scope: ExactTimeControlScope): void {
  if (scope.from && scope.to && scope.from.getTime() >= scope.to.getTime()) {
    throw new RangeError('Exact-time-control scope "from" must be earlier than "to".');
  }
}

function isControlNumber(value: number | null): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0;
}

function hasControlIdentity(game: ExactTimeControlSourceGame): game is ExactTimeControlSourceGame & {
  exactTimeControlKey: string;
  timeControlInitial: number;
  timeControlIncrement: number;
} {
  return typeof game.exactTimeControlKey === 'string'
    && game.exactTimeControlKey.length > 0
    && isControlNumber(game.timeControlInitial)
    && isControlNumber(game.timeControlIncrement);
}

function isCoveredResult(value: string | null): value is 'WIN' | 'DRAW' | 'LOSS' {
  return value === 'WIN' || value === 'DRAW' || value === 'LOSS';
}

function isAnalysedGame(game: ExactTimeControlSourceGame): boolean {
  return Number.isInteger(game.analysedUserMoves)
    && game.analysedUserMoves > 0
    && typeof game.scoreLossTotalCp === 'number'
    && Number.isFinite(game.scoreLossTotalCp)
    && game.scoreLossTotalCp >= 0
    && Number.isInteger(game.majorErrorMoves)
    && game.majorErrorMoves >= 0
    && Number.isInteger(game.blunderMoves)
    && game.blunderMoves >= 0
    && game.majorErrorMoves <= game.analysedUserMoves
    && game.blunderMoves <= game.analysedUserMoves;
}

function resultScorePercent(games: readonly ExactTimeControlSourceGame[]): {
  resultCoveredGames: number;
  wins: number;
  draws: number;
  losses: number;
  scorePercent: number | null;
} {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  for (const game of games) {
    if (game.resultForUser === 'WIN') wins += 1;
    else if (game.resultForUser === 'DRAW') draws += 1;
    else if (game.resultForUser === 'LOSS') losses += 1;
  }
  const resultCoveredGames = wins + draws + losses;
  return {
    resultCoveredGames,
    wins,
    draws,
    losses,
    scorePercent: resultCoveredGames > 0
      ? roundTimingBehaviorMetric(((wins + draws * 0.5) / resultCoveredGames) * 100)
      : null,
  };
}

function summarizeArm(
  exactTimeControlKey: string,
  initialSeconds: number,
  incrementSeconds: number,
  games: readonly ExactTimeControlSourceGame[],
): ExactTimeControlArm {
  const result = resultScorePercent(games);
  const analysedGames = games.filter(isAnalysedGame);
  const analysedUserMoves = analysedGames.reduce(
    (sum, game) => sum + game.analysedUserMoves,
    0,
  );
  const scoreLossTotalCp = analysedGames.reduce(
    (sum, game) => sum + (game.scoreLossTotalCp as number),
    0,
  );
  const majorErrorMoves = analysedGames.reduce(
    (sum, game) => sum + game.majorErrorMoves,
    0,
  );
  const blunderMoves = analysedGames.reduce(
    (sum, game) => sum + game.blunderMoves,
    0,
  );
  const resultCoveragePercent = timingBehaviorPercentage(result.resultCoveredGames, games.length);
  const analysisCoveragePercent = timingBehaviorPercentage(analysedGames.length, games.length);

  return {
    exactTimeControlKey,
    initialSeconds,
    incrementSeconds,
    eligibleGames: games.length,
    resultCoveredGames: result.resultCoveredGames,
    resultCoveragePercent,
    wins: result.wins,
    draws: result.draws,
    losses: result.losses,
    scorePercent: result.scorePercent,
    resultEvidenceStrength: timingBehaviorEvidenceStrength({
      supportingGames: result.resultCoveredGames,
      requiredEvidenceCoveragePercent: resultCoveragePercent,
    }),
    analysedGames: analysedGames.length,
    analysisCoveragePercent,
    analysedUserMoves,
    averageScoreLossCp: analysedUserMoves > 0
      ? roundTimingBehaviorMetric(scoreLossTotalCp / analysedUserMoves)
      : null,
    majorErrorRatePercent: timingBehaviorPercentage(majorErrorMoves, analysedUserMoves),
    blunderRatePercent: timingBehaviorPercentage(blunderMoves, analysedUserMoves),
    qualityEvidenceStrength: timingBehaviorEvidenceStrength({
      supportingGames: analysedGames.length,
      requiredEvidenceCoveragePercent: analysisCoveragePercent,
    }),
    speedCategories: [...new Set(
      games
        .map((game) => game.speedCategory)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    )].sort(),
  };
}

function delta(target: number | null, comparator: number | null): number | null {
  return target === null || comparator === null
    ? null
    : roundTimingBehaviorMetric(target - comparator);
}

function compareControls(left: ControlGroup, right: ControlGroup): number {
  return left.initialSeconds - right.initialSeconds
    || left.incrementSeconds - right.incrementSeconds
    || left.exactTimeControlKey.localeCompare(right.exactTimeControlKey);
}

function compareComparatorCandidates(target: ControlGroup, left: ControlGroup, right: ControlGroup): number {
  return EVIDENCE_ORDER[right.arm.resultEvidenceStrength]
      - EVIDENCE_ORDER[left.arm.resultEvidenceStrength]
    || right.arm.resultCoveredGames - left.arm.resultCoveredGames
    || Math.abs(left.incrementSeconds - target.incrementSeconds)
      - Math.abs(right.incrementSeconds - target.incrementSeconds)
    || left.incrementSeconds - right.incrementSeconds
    || left.exactTimeControlKey.localeCompare(right.exactTimeControlKey);
}

function comparativeResultStrength(
  target: ExactTimeControlArm,
  comparator: ExactTimeControlArm,
): TimingBehaviorEvidenceStrength {
  return comparativeTimingBehaviorEvidenceStrength(
    {
      supportingGames: target.resultCoveredGames,
      requiredEvidenceCoveragePercent: target.resultCoveragePercent,
    },
    {
      supportingGames: comparator.resultCoveredGames,
      requiredEvidenceCoveragePercent: comparator.resultCoveragePercent,
    },
  );
}

function comparativeQualityStrength(
  target: ExactTimeControlArm,
  comparator: ExactTimeControlArm,
): TimingBehaviorEvidenceStrength {
  return comparativeTimingBehaviorEvidenceStrength(
    {
      supportingGames: target.analysedGames,
      requiredEvidenceCoveragePercent: target.analysisCoveragePercent,
    },
    {
      supportingGames: comparator.analysedGames,
      requiredEvidenceCoveragePercent: comparator.analysisCoveragePercent,
    },
  );
}

function baseComparison(target: ControlGroup): ExactTimeControlComparison {
  return {
    status: 'UNAVAILABLE',
    reason: 'no-sufficient-same-initial-comparator',
    target: target.arm,
    comparatorDefinition: {
      initialSeconds: target.initialSeconds,
      requiresDifferentIncrement: true,
      broadSpeedFallback: false,
      selectionRule:
        'STRONGEST_RESULT_EVIDENCE_THEN_LARGEST_RESULT_SAMPLE_THEN_NEAREST_INCREMENT_THEN_KEY',
      eligibleComparatorControls: 0,
    },
    comparator: null,
    deltas: {
      scorePercentagePoints: null,
      averageScoreLossCp: null,
      majorErrorRatePercentagePoints: null,
      blunderRatePercentagePoints: null,
    },
    evidenceStrength: {
      result: 'INSUFFICIENT',
      quality: 'INSUFFICIENT',
    },
    ratingComposition: {
      status: 'UNAVAILABLE',
      reason: 'comparison-unavailable',
      result: null,
    },
  };
}

function buildAggregateDetail(
  games: readonly ExactTimeControlSourceGame[],
): AggregateDetail {
  if (games.length === 0) {
    return { result: unavailable(0, 'no-candidate-games'), comparisonPairs: [] };
  }

  const seen = new Set<number>();
  for (const game of games) {
    if (seen.has(game.importedGameId)) {
      return {
        result: unavailable(games.length, 'duplicate-candidate-game-row'),
        comparisonPairs: [],
      };
    }
    seen.add(game.importedGameId);
  }

  const supported = games.filter(isTimingEligibleGame);
  const unsupportedGames = games.length - supported.length;
  const controlIdentity = new Map<string, { initialSeconds: number; incrementSeconds: number }>();
  const inconsistentKeys = new Set<string>();
  let missingExactControlGames = 0;

  for (const game of supported) {
    if (!hasControlIdentity(game)) {
      missingExactControlGames += 1;
      continue;
    }
    const previous = controlIdentity.get(game.exactTimeControlKey);
    if (
      previous
      && (
        previous.initialSeconds !== game.timeControlInitial
        || previous.incrementSeconds !== game.timeControlIncrement
      )
    ) {
      inconsistentKeys.add(game.exactTimeControlKey);
    } else if (!previous) {
      controlIdentity.set(game.exactTimeControlKey, {
        initialSeconds: game.timeControlInitial,
        incrementSeconds: game.timeControlIncrement,
      });
    }
  }

  const inconsistentControlIdentityGames = supported.filter(
    (game) => typeof game.exactTimeControlKey === 'string'
      && inconsistentKeys.has(game.exactTimeControlKey),
  ).length;

  const eligible = supported.filter(
    (game) => hasControlIdentity(game) && !inconsistentKeys.has(game.exactTimeControlKey),
  );

  if (eligible.length === 0) {
    const result = unavailable(games.length, 'no-eligible-exact-time-control-games');
    result.coverage = {
      ...result.coverage,
      supportedGames: supported.length,
      unsupportedGames,
      missingExactControlGames,
      inconsistentControlIdentityGames,
    };
    return { result, comparisonPairs: [] };
  }

  const groupsByKey = new Map<string, ControlGroup>();
  for (const game of eligible) {
    const identity = controlIdentity.get(game.exactTimeControlKey as string);
    if (!identity) continue;
    const existing = groupsByKey.get(game.exactTimeControlKey as string);
    if (existing) {
      existing.games.push(game);
    } else {
      groupsByKey.set(game.exactTimeControlKey as string, {
        exactTimeControlKey: game.exactTimeControlKey as string,
        initialSeconds: identity.initialSeconds,
        incrementSeconds: identity.incrementSeconds,
        games: [game],
        arm: {} as ExactTimeControlArm,
      });
    }
  }

  const groups = [...groupsByKey.values()];
  for (const group of groups) {
    group.arm = summarizeArm(
      group.exactTimeControlKey,
      group.initialSeconds,
      group.incrementSeconds,
      group.games,
    );
  }
  groups.sort(compareControls);

  const comparisons: ExactTimeControlComparison[] = [];
  const comparisonPairs: ComparisonPair[] = [];

  for (const target of groups) {
    const eligibleComparators = groups
      .filter((candidate) => (
        candidate.exactTimeControlKey !== target.exactTimeControlKey
        && candidate.initialSeconds === target.initialSeconds
        && candidate.incrementSeconds !== target.incrementSeconds
        && candidate.arm.resultEvidenceStrength !== 'INSUFFICIENT'
      ))
      .sort((left, right) => compareComparatorCandidates(target, left, right));

    if (eligibleComparators.length === 0) {
      comparisons.push(baseComparison(target));
      continue;
    }

    const comparator = eligibleComparators[0];
    comparisons.push({
      status: 'AVAILABLE',
      reason: null,
      target: target.arm,
      comparatorDefinition: {
        initialSeconds: target.initialSeconds,
        requiresDifferentIncrement: true,
        broadSpeedFallback: false,
        selectionRule:
          'STRONGEST_RESULT_EVIDENCE_THEN_LARGEST_RESULT_SAMPLE_THEN_NEAREST_INCREMENT_THEN_KEY',
        eligibleComparatorControls: eligibleComparators.length,
      },
      comparator: comparator.arm,
      deltas: {
        scorePercentagePoints: delta(target.arm.scorePercent, comparator.arm.scorePercent),
        averageScoreLossCp: delta(
          target.arm.averageScoreLossCp,
          comparator.arm.averageScoreLossCp,
        ),
        majorErrorRatePercentagePoints: delta(
          target.arm.majorErrorRatePercent,
          comparator.arm.majorErrorRatePercent,
        ),
        blunderRatePercentagePoints: delta(
          target.arm.blunderRatePercent,
          comparator.arm.blunderRatePercent,
        ),
      },
      evidenceStrength: {
        result: comparativeResultStrength(target.arm, comparator.arm),
        quality: comparativeQualityStrength(target.arm, comparator.arm),
      },
      ratingComposition: {
        status: 'UNAVAILABLE',
        reason: 'rating-context-requires-service-composition',
        result: null,
      },
    });
    comparisonPairs.push({
      targetKey: target.exactTimeControlKey,
      targetGameIds: target.games.map((game) => game.importedGameId).sort((a, b) => a - b),
      comparatorGameIds: comparator.games
        .map((game) => game.importedGameId)
        .sort((a, b) => a - b),
    });
  }

  const controlsWithComparator = comparisons.filter(
    (comparison) => comparison.status === 'AVAILABLE',
  ).length;
  const controlsWithoutComparator = comparisons.length - controlsWithComparator;
  const resultCoveredGames = eligible.filter((game) => isCoveredResult(game.resultForUser)).length;
  const analysedGames = eligible.filter(isAnalysedGame).length;
  const resultCoveragePercent = timingBehaviorPercentage(resultCoveredGames, eligible.length);
  const analysisCoveragePercent = timingBehaviorPercentage(analysedGames, eligible.length);

  let status: ExactTimeControlUnderperformanceResult['coverage']['status'];
  let reason: string | null;
  if (controlsWithComparator === 0) {
    status = 'UNAVAILABLE';
    reason = 'no-sufficient-same-initial-comparator';
  } else {
    const complete = unsupportedGames === 0
      && missingExactControlGames === 0
      && inconsistentControlIdentityGames === 0
      && controlsWithoutComparator === 0
      && resultCoveragePercent === 100
      && analysisCoveragePercent === 100;
    status = complete ? 'COMPLETE' : 'PARTIAL';
    reason = complete
      ? null
      : unsupportedGames > 0
        ? 'unsupported-game-coverage'
        : missingExactControlGames > 0 || inconsistentControlIdentityGames > 0
          ? 'exact-time-control-coverage-incomplete'
          : controlsWithoutComparator > 0
            ? 'some-controls-lack-sufficient-comparator'
            : resultCoveragePercent !== 100
              ? 'result-coverage-incomplete'
              : 'engine-analysis-incomplete';
  }

  const caveats = [
    'TIME-005 compares each exact control only with a same-initial-time control using a different increment; broad speed categories are never used as fallback comparators.',
    'Result score and current-engine move quality have separate denominators and evidence grades. Missing results or engine analysis remain explicit coverage loss.',
    'Only current complete engine analysis from the same ply-index snapshot contributes quality metrics; stale, superseded, incomplete, or missing analysis is excluded.',
    'The comparison is observational and player-relative. It does not establish why a control differs, and it should not outrank a supported timing mechanism such as TIME-002, TIME-004, or TIME-006.',
    'Comparator selection is deterministic: strongest result evidence, then largest result-covered sample, nearest increment, and finally exact-control key.',
  ];
  if (unsupportedGames > 0) {
    caveats.push('Games outside the existing standard timing-policy cohort are excluded from TIME-005 rather than pooled into exact-control groups.');
  }
  if (missingExactControlGames > 0 || inconsistentControlIdentityGames > 0) {
    caveats.push('Games without a trustworthy exact-control identity, or with internally inconsistent exact-control metadata, are excluded from comparison groups.');
  }
  if (controlsWithoutComparator > 0) {
    caveats.push('Some exact controls have no same-initial different-increment comparator that passes the shared result sample/coverage gate.');
  }
  if (analysisCoveragePercent !== 100) {
    caveats.push('Some eligible games lack current complete engine move-quality evidence; result-only comparisons remain available independently.');
  }

  return {
    result: {
      diagnosisId: 'TIME-005',
      policyVersion: EXACT_TIME_CONTROL_UNDERPERFORMANCE_POLICY_VERSION,
      timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
      coverage: {
        status,
        reason,
        candidateGames: games.length,
        supportedGames: supported.length,
        unsupportedGames,
        missingExactControlGames,
        inconsistentControlIdentityGames,
        eligibleGames: eligible.length,
        exactControls: groups.length,
        controlsWithComparator,
        controlsWithoutComparator,
        resultCoveredGames,
        resultCoveragePercent,
        analysedGames,
        analysisCoveragePercent,
        maxCandidateGames: EXACT_TIME_CONTROL_MAX_CANDIDATE_GAMES,
      },
      comparisons,
      caveats,
    },
    comparisonPairs,
  };
}

export function buildExactTimeControlUnderperformanceAggregate(
  games: readonly ExactTimeControlSourceGame[],
): ExactTimeControlUnderperformanceResult {
  return buildAggregateDetail(games).result;
}

export async function getExactTimeControlUnderperformance(
  appUserId: number,
  scope: ExactTimeControlScope,
  repository: ExactTimeControlRepository,
  ratingRepository: RatingContextCompositionRepository,
): Promise<ExactTimeControlUnderperformanceResult> {
  validateScope(scope);
  const candidateGames = await repository.countCandidates(appUserId, scope);

  if (candidateGames > EXACT_TIME_CONTROL_MAX_CANDIDATE_GAMES) {
    return unavailable(candidateGames, 'exact-time-control-scope-too-large');
  }
  if (candidateGames === 0) return unavailable(0, 'no-candidate-games');

  const games = await repository.loadCandidates(appUserId, scope);
  if (games.length !== candidateGames) {
    return unavailable(candidateGames, 'candidate-set-changed-during-read');
  }

  const detail = buildAggregateDetail(games);
  if (detail.comparisonPairs.length === 0) return detail.result;

  const ratingByTarget = new Map<string, RatingContextCompositionResult>();
  await Promise.all(detail.comparisonPairs.map(async (pair) => {
    const ratingResult = await getRatingContextComposition(
      appUserId,
      {
        left: { importedGameIds: pair.comparatorGameIds },
        right: { importedGameIds: pair.targetGameIds },
      },
      ratingRepository,
    );
    ratingByTarget.set(pair.targetKey, ratingResult);
  }));

  return {
    ...detail.result,
    comparisons: detail.result.comparisons.map((comparison) => {
      if (comparison.status !== 'AVAILABLE') return comparison;
      const ratingResult = ratingByTarget.get(comparison.target.exactTimeControlKey);
      return {
        ...comparison,
        ratingComposition: ratingResult
          ? { status: 'AVAILABLE', reason: null, result: ratingResult }
          : {
              status: 'UNAVAILABLE',
              reason: 'rating-context-unavailable',
              result: null,
            },
      };
    }),
    caveats: [
      ...detail.result.caveats,
      'For each selected pair, RATING-002 is attached as a separate opponent-strength composition disclosure and never adjusts the TIME-005 deltas.',
    ],
  };
}
