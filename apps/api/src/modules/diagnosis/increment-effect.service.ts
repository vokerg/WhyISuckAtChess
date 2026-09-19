import { MoveClassificationCode } from '@why-i-suck-at-chess/chess-domain';
import {
  TIME_BEHAVIOR_POLICY_VERSION,
  comparativeTimingBehaviorEvidenceStrength,
  roundTimingBehaviorMetric,
  timingBehaviorEvidenceStrength,
  timingBehaviorPercentage,
  type TimingBehaviorEvidenceStrength,
} from '../timing/time-behavior-policy';
import {
  TIMING_DERIVATION_VERSION,
  isTimingEligibleGame,
} from '../timing/timing-policy';
import {
  buildRatingContextComposition,
  type RatingContextCompositionRepository,
  type RatingContextCompositionResult,
} from './rating-context-composition.service';
import {
  buildTimePressureExposureAggregate,
  type TimePressureSourceGame,
  type TimePressureSourceMove,
} from './time-pressure-exposure.service';

export const INCREMENT_EFFECT_POLICY_VERSION = 'increment-effect-v1';
export const INCREMENT_EFFECT_MAX_CANDIDATE_GAMES = 5_000;

export interface IncrementEffectScope {
  from?: Date;
  to?: Date;
}

export interface IncrementEffectAnalysisRun {
  runId: number;
  snapshotId: string;
  analysisVersion: string;
  settingsHash: string;
  engineName: string | null;
  engineVersion: string | null;
}

export interface IncrementEffectSourceMove extends TimePressureSourceMove {
  scoreLossCp: number | null;
  classificationCode: number | null;
  analysis: IncrementEffectAnalysisRun | null;
}

export interface IncrementEffectSourceGame extends Omit<TimePressureSourceGame, 'userMoves'> {
  resultForUser: string | null;
  userMoves: readonly IncrementEffectSourceMove[];
}

export interface IncrementEffectRepository {
  countCandidates(appUserId: number, scope: IncrementEffectScope): Promise<number>;
  loadCandidates(
    appUserId: number,
    scope: IncrementEffectScope,
  ): Promise<IncrementEffectSourceGame[]>;
}

export interface IncrementEffectExactControl {
  exactTimeControlKey: string;
  incrementSeconds: number;
  games: number;
}

export interface IncrementEffectPressureMetrics {
  timingCoveredGames: number;
  timingCoveragePercent: number | null;
  eligibleUserDecisions: number;
  pressureMoves: number;
  pressureMoveRatePercent: number | null;
  pressureEnteringGames: number;
  pressureEntryRatePercent: number | null;
}

export interface IncrementEffectArm {
  games: number;
  exactControls: IncrementEffectExactControl[];
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
  majorErrorRatePercent: number | null;
  blunderRatePercent: number | null;
  pressure: IncrementEffectPressureMetrics;
  evidenceStrength: {
    result: TimingBehaviorEvidenceStrength;
    quality: TimingBehaviorEvidenceStrength;
    timing: TimingBehaviorEvidenceStrength;
  };
}

export interface IncrementEffectRatingComposition {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  reason: string | null;
  result: RatingContextCompositionResult | null;
}

export interface IncrementEffectStratum {
  initialSeconds: number;
  noIncrement: IncrementEffectArm;
  increment: IncrementEffectArm;
  deltas: {
    scorePercentagePoints: number | null;
    averageScoreLossCp: number | null;
    majorErrorRatePercentagePoints: number | null;
    blunderRatePercentagePoints: number | null;
    pressureMoveRatePercentagePoints: number | null;
    pressureEntryRatePercentagePoints: number | null;
  };
  evidenceStrength: {
    result: TimingBehaviorEvidenceStrength;
    quality: TimingBehaviorEvidenceStrength;
    timing: TimingBehaviorEvidenceStrength;
  };
  ratingComposition: IncrementEffectRatingComposition;
}

export interface IncrementEffectResult {
  diagnosisId: 'TIME-006';
  policyVersion: string;
  timeBehaviorPolicyVersion: string;
  timingDerivationVersion: number;
  coverage: {
    status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
    reason: string | null;
    candidateGames: number;
    supportedGames: number;
    unsupportedGames: number;
    missingControlIdentityGames: number;
    inconsistentControlIdentityGames: number;
    eligibleGames: number;
    matchedGames: number;
    unmatchedGames: number;
    matchedInitialTimeStrata: number;
    unmatchedInitialTimeStrata: number;
    resultCoveredGames: number;
    resultCoveragePercent: number | null;
    analysedGames: number;
    analysisCoveragePercent: number | null;
    timingCoveredGames: number;
    timingCoveragePercent: number | null;
    maxCandidateGames: number;
  };
  strata: IncrementEffectStratum[];
  caveats: string[];
}

interface ControlIdentity {
  exactTimeControlKey: string;
  initialSeconds: number;
  incrementSeconds: number;
}

interface InitialTimeBucket {
  initialSeconds: number;
  noIncrementGames: IncrementEffectSourceGame[];
  incrementGames: IncrementEffectSourceGame[];
}

interface RatingPair {
  initialSeconds: number;
  noIncrementGameIds: number[];
  incrementGameIds: number[];
}

interface AggregateDetail {
  result: IncrementEffectResult;
  ratingPairs: RatingPair[];
}

function emptyCoverage(
  candidateGames: number,
  reason: string,
): IncrementEffectResult['coverage'] {
  return {
    status: 'UNAVAILABLE',
    reason,
    candidateGames,
    supportedGames: 0,
    unsupportedGames: 0,
    missingControlIdentityGames: 0,
    inconsistentControlIdentityGames: 0,
    eligibleGames: 0,
    matchedGames: 0,
    unmatchedGames: 0,
    matchedInitialTimeStrata: 0,
    unmatchedInitialTimeStrata: 0,
    resultCoveredGames: 0,
    resultCoveragePercent: null,
    analysedGames: 0,
    analysisCoveragePercent: null,
    timingCoveredGames: 0,
    timingCoveragePercent: null,
    maxCandidateGames: INCREMENT_EFFECT_MAX_CANDIDATE_GAMES,
  };
}

function unavailable(candidateGames: number, reason: string): IncrementEffectResult {
  return {
    diagnosisId: 'TIME-006',
    policyVersion: INCREMENT_EFFECT_POLICY_VERSION,
    timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
    timingDerivationVersion: TIMING_DERIVATION_VERSION,
    coverage: emptyCoverage(candidateGames, reason),
    strata: [],
    caveats: [
      'No increment-versus-no-increment comparison is available from this aggregate.',
      'TIME-006 is an observational within-player comparison and does not establish that increment caused any measured difference.',
    ],
  };
}

function validateScope(scope: IncrementEffectScope): void {
  for (const value of [scope.from, scope.to]) {
    if (value && !Number.isFinite(value.getTime())) {
      throw new RangeError('Increment-effect scope contains an invalid date.');
    }
  }
  if (scope.from && scope.to && scope.from.getTime() >= scope.to.getTime()) {
    throw new RangeError('Increment-effect scope "from" must be earlier than "to".');
  }
}

function isControlNumber(value: number | null): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0;
}

function controlIdentity(game: IncrementEffectSourceGame): ControlIdentity | null {
  if (
    typeof game.exactTimeControlKey !== 'string'
    || game.exactTimeControlKey.length === 0
    || !isControlNumber(game.timeControlInitial)
    || !isControlNumber(game.timeControlIncrement)
  ) {
    return null;
  }
  return {
    exactTimeControlKey: game.exactTimeControlKey,
    initialSeconds: game.timeControlInitial,
    incrementSeconds: game.timeControlIncrement,
  };
}

function coveredResult(value: string | null): value is 'WIN' | 'DRAW' | 'LOSS' {
  return value === 'WIN' || value === 'DRAW' || value === 'LOSS';
}

function analysedMove(move: IncrementEffectSourceMove): boolean {
  return Boolean(
    move.analysis
    && typeof move.scoreLossCp === 'number'
    && Number.isFinite(move.scoreLossCp)
    && move.scoreLossCp >= 0,
  );
}

function majorError(move: IncrementEffectSourceMove): boolean {
  return move.classificationCode === MoveClassificationCode.Mistake
    || move.classificationCode === MoveClassificationCode.Blunder;
}

function blunder(move: IncrementEffectSourceMove): boolean {
  return move.classificationCode === MoveClassificationCode.Blunder;
}

function delta(right: number | null, left: number | null): number | null {
  return right === null || left === null
    ? null
    : roundTimingBehaviorMetric(right - left);
}

function exactControls(games: readonly IncrementEffectSourceGame[]): IncrementEffectExactControl[] {
  const byKey = new Map<string, IncrementEffectExactControl>();
  for (const game of games) {
    const identity = controlIdentity(game);
    if (!identity) continue;
    const existing = byKey.get(identity.exactTimeControlKey);
    if (existing) {
      existing.games += 1;
    } else {
      byKey.set(identity.exactTimeControlKey, {
        exactTimeControlKey: identity.exactTimeControlKey,
        incrementSeconds: identity.incrementSeconds,
        games: 1,
      });
    }
  }
  return [...byKey.values()].sort(
    (left, right) => left.incrementSeconds - right.incrementSeconds
      || left.exactTimeControlKey.localeCompare(right.exactTimeControlKey),
  );
}

function summarizeArm(games: readonly IncrementEffectSourceGame[]): IncrementEffectArm {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  const analysedMoves: IncrementEffectSourceMove[] = [];
  const analysedGameIds = new Set<number>();

  for (const game of games) {
    if (game.resultForUser === 'WIN') wins += 1;
    else if (game.resultForUser === 'DRAW') draws += 1;
    else if (game.resultForUser === 'LOSS') losses += 1;

    for (const move of game.userMoves) {
      if (!analysedMove(move)) continue;
      analysedMoves.push(move);
      analysedGameIds.add(game.importedGameId);
    }
  }

  const resultCoveredGames = wins + draws + losses;
  const resultCoveragePercent = timingBehaviorPercentage(resultCoveredGames, games.length);
  const analysedGames = analysedGameIds.size;
  const analysisCoveragePercent = timingBehaviorPercentage(analysedGames, games.length);
  const scoreLossTotal = analysedMoves.reduce(
    (sum, move) => sum + (move.scoreLossCp as number),
    0,
  );
  const pressureResult = buildTimePressureExposureAggregate(games);
  const pressure = pressureResult.exposure;

  return {
    games: games.length,
    exactControls: exactControls(games),
    resultCoveredGames,
    resultCoveragePercent,
    wins,
    draws,
    losses,
    scorePercent: resultCoveredGames > 0
      ? roundTimingBehaviorMetric(((wins + draws * 0.5) / resultCoveredGames) * 100)
      : null,
    analysedGames,
    analysisCoveragePercent,
    analysedUserMoves: analysedMoves.length,
    averageScoreLossCp: analysedMoves.length > 0
      ? roundTimingBehaviorMetric(scoreLossTotal / analysedMoves.length)
      : null,
    majorErrorRatePercent: timingBehaviorPercentage(
      analysedMoves.filter(majorError).length,
      analysedMoves.length,
    ),
    blunderRatePercent: timingBehaviorPercentage(
      analysedMoves.filter(blunder).length,
      analysedMoves.length,
    ),
    pressure: {
      timingCoveredGames: pressureResult.coverage.timingCoveredGames,
      timingCoveragePercent: pressureResult.coverage.timingCoveragePercent,
      eligibleUserDecisions: pressure.eligibleUserDecisions,
      pressureMoves: pressure.pressureMoves,
      pressureMoveRatePercent: pressure.pressureMoveRatePercent,
      pressureEnteringGames: pressure.pressureEnteringGames,
      pressureEntryRatePercent: pressure.pressureEntryRatePercent,
    },
    evidenceStrength: {
      result: timingBehaviorEvidenceStrength({
        supportingGames: resultCoveredGames,
        requiredEvidenceCoveragePercent: resultCoveragePercent,
      }),
      quality: timingBehaviorEvidenceStrength({
        supportingGames: analysedGames,
        requiredEvidenceCoveragePercent: analysisCoveragePercent,
      }),
      timing: pressure.evidenceStrength,
    },
  };
}

function comparativeStrength(
  left: IncrementEffectArm,
  right: IncrementEffectArm,
  modality: 'result' | 'quality' | 'timing',
): TimingBehaviorEvidenceStrength {
  if (modality === 'result') {
    return comparativeTimingBehaviorEvidenceStrength(
      {
        supportingGames: left.resultCoveredGames,
        requiredEvidenceCoveragePercent: left.resultCoveragePercent,
      },
      {
        supportingGames: right.resultCoveredGames,
        requiredEvidenceCoveragePercent: right.resultCoveragePercent,
      },
    );
  }
  if (modality === 'quality') {
    return comparativeTimingBehaviorEvidenceStrength(
      {
        supportingGames: left.analysedGames,
        requiredEvidenceCoveragePercent: left.analysisCoveragePercent,
      },
      {
        supportingGames: right.analysedGames,
        requiredEvidenceCoveragePercent: right.analysisCoveragePercent,
      },
    );
  }
  return comparativeTimingBehaviorEvidenceStrength(
    {
      supportingGames: left.pressure.timingCoveredGames,
      requiredEvidenceCoveragePercent: left.pressure.timingCoveragePercent,
    },
    {
      supportingGames: right.pressure.timingCoveredGames,
      requiredEvidenceCoveragePercent: right.pressure.timingCoveragePercent,
    },
  );
}

function buildAggregateDetail(
  games: readonly IncrementEffectSourceGame[],
): AggregateDetail {
  if (games.length === 0) {
    return { result: unavailable(0, 'no-candidate-games'), ratingPairs: [] };
  }

  const seen = new Set<number>();
  for (const game of games) {
    if (seen.has(game.importedGameId)) {
      return {
        result: unavailable(games.length, 'duplicate-candidate-game-row'),
        ratingPairs: [],
      };
    }
    seen.add(game.importedGameId);
  }

  const supported = games.filter(isTimingEligibleGame);
  const unsupportedGames = games.length - supported.length;
  const identityByKey = new Map<string, { initialSeconds: number; incrementSeconds: number }>();
  const inconsistentKeys = new Set<string>();
  let missingControlIdentityGames = 0;

  for (const game of supported) {
    const identity = controlIdentity(game);
    if (!identity) {
      missingControlIdentityGames += 1;
      continue;
    }
    const previous = identityByKey.get(identity.exactTimeControlKey);
    if (
      previous
      && (
        previous.initialSeconds !== identity.initialSeconds
        || previous.incrementSeconds !== identity.incrementSeconds
      )
    ) {
      inconsistentKeys.add(identity.exactTimeControlKey);
    } else if (!previous) {
      identityByKey.set(identity.exactTimeControlKey, {
        initialSeconds: identity.initialSeconds,
        incrementSeconds: identity.incrementSeconds,
      });
    }
  }

  const inconsistentControlIdentityGames = supported.filter((game) => (
    typeof game.exactTimeControlKey === 'string'
    && inconsistentKeys.has(game.exactTimeControlKey)
  )).length;
  const eligible = supported.filter((game) => {
    const identity = controlIdentity(game);
    return identity !== null && !inconsistentKeys.has(identity.exactTimeControlKey);
  });

  if (eligible.length === 0) {
    const result = unavailable(games.length, 'no-eligible-increment-effect-games');
    result.coverage = {
      ...result.coverage,
      supportedGames: supported.length,
      unsupportedGames,
      missingControlIdentityGames,
      inconsistentControlIdentityGames,
    };
    return { result, ratingPairs: [] };
  }

  const byInitial = new Map<number, InitialTimeBucket>();
  for (const game of eligible) {
    const identity = controlIdentity(game) as ControlIdentity;
    const bucket = byInitial.get(identity.initialSeconds) ?? {
      initialSeconds: identity.initialSeconds,
      noIncrementGames: [],
      incrementGames: [],
    };
    if (identity.incrementSeconds === 0) bucket.noIncrementGames.push(game);
    else bucket.incrementGames.push(game);
    byInitial.set(identity.initialSeconds, bucket);
  }

  const buckets = [...byInitial.values()].sort(
    (left, right) => left.initialSeconds - right.initialSeconds,
  );
  const matched = buckets.filter(
    (bucket) => bucket.noIncrementGames.length > 0 && bucket.incrementGames.length > 0,
  );
  const unmatched = buckets.filter(
    (bucket) => bucket.noIncrementGames.length === 0 || bucket.incrementGames.length === 0,
  );
  const matchedGameIds = new Set(
    matched.flatMap((bucket) => [
      ...bucket.noIncrementGames.map((game) => game.importedGameId),
      ...bucket.incrementGames.map((game) => game.importedGameId),
    ]),
  );
  const matchedGames = eligible.filter((game) => matchedGameIds.has(game.importedGameId));
  const unmatchedGames = eligible.length - matchedGames.length;

  if (matched.length === 0) {
    const result = unavailable(games.length, 'no-comparable-increment-strata');
    result.coverage = {
      ...result.coverage,
      supportedGames: supported.length,
      unsupportedGames,
      missingControlIdentityGames,
      inconsistentControlIdentityGames,
      eligibleGames: eligible.length,
      matchedGames: 0,
      unmatchedGames,
      matchedInitialTimeStrata: 0,
      unmatchedInitialTimeStrata: unmatched.length,
    };
    return { result, ratingPairs: [] };
  }

  const strata: IncrementEffectStratum[] = [];
  const ratingPairs: RatingPair[] = [];
  for (const bucket of matched) {
    const noIncrement = summarizeArm(bucket.noIncrementGames);
    const increment = summarizeArm(bucket.incrementGames);
    strata.push({
      initialSeconds: bucket.initialSeconds,
      noIncrement,
      increment,
      deltas: {
        scorePercentagePoints: delta(increment.scorePercent, noIncrement.scorePercent),
        averageScoreLossCp: delta(
          increment.averageScoreLossCp,
          noIncrement.averageScoreLossCp,
        ),
        majorErrorRatePercentagePoints: delta(
          increment.majorErrorRatePercent,
          noIncrement.majorErrorRatePercent,
        ),
        blunderRatePercentagePoints: delta(
          increment.blunderRatePercent,
          noIncrement.blunderRatePercent,
        ),
        pressureMoveRatePercentagePoints: delta(
          increment.pressure.pressureMoveRatePercent,
          noIncrement.pressure.pressureMoveRatePercent,
        ),
        pressureEntryRatePercentagePoints: delta(
          increment.pressure.pressureEntryRatePercent,
          noIncrement.pressure.pressureEntryRatePercent,
        ),
      },
      evidenceStrength: {
        result: comparativeStrength(noIncrement, increment, 'result'),
        quality: comparativeStrength(noIncrement, increment, 'quality'),
        timing: comparativeStrength(noIncrement, increment, 'timing'),
      },
      ratingComposition: {
        status: 'UNAVAILABLE',
        reason: 'rating-context-requires-service-composition',
        result: null,
      },
    });
    ratingPairs.push({
      initialSeconds: bucket.initialSeconds,
      noIncrementGameIds: bucket.noIncrementGames
        .map((game) => game.importedGameId)
        .sort((left, right) => left - right),
      incrementGameIds: bucket.incrementGames
        .map((game) => game.importedGameId)
        .sort((left, right) => left - right),
    });
  }

  const resultCoveredGames = matchedGames.filter(
    (game) => coveredResult(game.resultForUser),
  ).length;
  const analysedGames = matchedGames.filter(
    (game) => game.userMoves.some(analysedMove),
  ).length;
  const timingCoveredGames = strata.reduce(
    (sum, stratum) => sum
      + stratum.noIncrement.pressure.timingCoveredGames
      + stratum.increment.pressure.timingCoveredGames,
    0,
  );
  const resultCoveragePercent = timingBehaviorPercentage(
    resultCoveredGames,
    matchedGames.length,
  );
  const analysisCoveragePercent = timingBehaviorPercentage(
    analysedGames,
    matchedGames.length,
  );
  const timingCoveragePercent = timingBehaviorPercentage(
    timingCoveredGames,
    matchedGames.length,
  );

  const complete = unsupportedGames === 0
    && missingControlIdentityGames === 0
    && inconsistentControlIdentityGames === 0
    && unmatchedGames === 0
    && resultCoveragePercent === 100
    && analysisCoveragePercent === 100
    && timingCoveragePercent === 100;
  const status: IncrementEffectResult['coverage']['status'] = complete ? 'COMPLETE' : 'PARTIAL';
  const reason = complete
    ? null
    : unsupportedGames > 0
      ? 'unsupported-game-coverage'
      : missingControlIdentityGames > 0 || inconsistentControlIdentityGames > 0
        ? 'time-control-identity-coverage-incomplete'
        : unmatchedGames > 0
          ? 'some-initial-time-strata-unmatched'
          : resultCoveragePercent !== 100
            ? 'result-coverage-incomplete'
            : analysisCoveragePercent !== 100
              ? 'engine-analysis-incomplete'
              : 'timing-coverage-incomplete';

  const caveats = [
    'TIME-006 compares increment and no-increment games only within the same exact initial-time stratum; controls with different initial seconds are never pooled into one effect.',
    'The increment arm may contain multiple exact increment controls, which remain visible in exactControls rather than being hidden by the arm label.',
    'Result, current-engine quality, and trustworthy timing exposure have separate denominators and evidence grades.',
    'Pressure uses the shared time-behavior-v1 remaining-clock thresholds and the conservative complete-game timing coverage rule from TIME-001.',
    'All deltas are increment minus no-increment. The aggregate represents positive, neutral, and negative associations without assuming that increment helps.',
    'TIME-006 is observational and player-relative; it does not establish that increment caused the measured result, quality, or pressure difference.',
  ];
  if (unmatchedGames > 0) {
    caveats.push('Games in initial-time strata that contain only increment or only no-increment controls are retained as unmatched coverage loss and do not enter effect deltas.');
  }
  if (analysisCoveragePercent !== 100) {
    caveats.push('Some matched games lack current complete engine-backed move quality and remain explicit analysis coverage loss.');
  }
  if (timingCoveragePercent !== 100) {
    caveats.push('Some matched games lack complete current reliable user timing and remain explicit timing coverage loss rather than being treated as no-pressure games.');
  }

  return {
    result: {
      diagnosisId: 'TIME-006',
      policyVersion: INCREMENT_EFFECT_POLICY_VERSION,
      timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
      timingDerivationVersion: TIMING_DERIVATION_VERSION,
      coverage: {
        status,
        reason,
        candidateGames: games.length,
        supportedGames: supported.length,
        unsupportedGames,
        missingControlIdentityGames,
        inconsistentControlIdentityGames,
        eligibleGames: eligible.length,
        matchedGames: matchedGames.length,
        unmatchedGames,
        matchedInitialTimeStrata: matched.length,
        unmatchedInitialTimeStrata: unmatched.length,
        resultCoveredGames,
        resultCoveragePercent,
        analysedGames,
        analysisCoveragePercent,
        timingCoveredGames,
        timingCoveragePercent,
        maxCandidateGames: INCREMENT_EFFECT_MAX_CANDIDATE_GAMES,
      },
      strata,
      caveats,
    },
    ratingPairs,
  };
}

export function buildIncrementEffectAggregate(
  games: readonly IncrementEffectSourceGame[],
): IncrementEffectResult {
  return buildAggregateDetail(games).result;
}

export async function getIncrementEffect(
  appUserId: number,
  scope: IncrementEffectScope,
  repository: IncrementEffectRepository,
  ratingRepository: RatingContextCompositionRepository,
): Promise<IncrementEffectResult> {
  validateScope(scope);
  const candidateGames = await repository.countCandidates(appUserId, scope);

  if (candidateGames > INCREMENT_EFFECT_MAX_CANDIDATE_GAMES) {
    return unavailable(candidateGames, 'increment-effect-scope-too-large');
  }
  if (candidateGames === 0) return unavailable(0, 'no-candidate-games');

  const games = await repository.loadCandidates(appUserId, scope);
  if (games.length !== candidateGames) {
    return unavailable(candidateGames, 'candidate-set-changed-during-read');
  }

  const detail = buildAggregateDetail(games);
  if (detail.ratingPairs.length === 0) return detail.result;

  const matchedIds = [...new Set(detail.ratingPairs.flatMap((pair) => [
    ...pair.noIncrementGameIds,
    ...pair.incrementGameIds,
  ]))].sort((left, right) => left - right);
  const ratingRows = await ratingRepository.loadOwnedRatingContext(appUserId, matchedIds);

  const ratingByInitial = new Map<number, RatingContextCompositionResult>();
  for (const pair of detail.ratingPairs) {
    const ids = new Set([...pair.noIncrementGameIds, ...pair.incrementGameIds]);
    ratingByInitial.set(
      pair.initialSeconds,
      buildRatingContextComposition(
        {
          left: { importedGameIds: pair.noIncrementGameIds },
          right: { importedGameIds: pair.incrementGameIds },
        },
        ratingRows.filter((row) => ids.has(row.importedGameId)),
      ),
    );
  }

  return {
    ...detail.result,
    strata: detail.result.strata.map((stratum) => {
      const ratingResult = ratingByInitial.get(stratum.initialSeconds);
      return {
        ...stratum,
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
      'RATING-002 is attached per matched initial-time stratum as a separate opponent-strength composition disclosure and never adjusts TIME-006 deltas.',
    ],
  };
}
