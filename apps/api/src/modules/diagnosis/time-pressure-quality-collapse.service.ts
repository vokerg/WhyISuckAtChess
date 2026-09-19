import { MoveClassificationCode } from '@why-i-suck-at-chess/chess-domain';
import {
  TIME_BEHAVIOR_POLICY_VERSION,
  classifyRemainingClock,
  comparativeTimingBehaviorEvidenceStrength,
  roundTimingBehaviorMetric,
  timingBehaviorPercentage,
  type TimingBehaviorEvidenceStrength,
} from '../timing/time-behavior-policy';
import {
  TIMING_DERIVATION_VERSION,
  isTimingEligibleGame,
} from '../timing/timing-policy';
import {
  getRatingContextComposition,
  type RatingContextCompositionRepository,
  type RatingContextCompositionResult,
} from './rating-context-composition.service';

export const TIME_PRESSURE_QUALITY_POLICY_VERSION = 'time-pressure-quality-collapse-v1';
export const TIME_PRESSURE_QUALITY_MAX_CANDIDATE_GAMES = 5_000;

export interface TimePressureQualityScope {
  from?: Date;
  to?: Date;
}

export type TimePressureQualityPhase = 'OPENING' | 'MIDDLEGAME' | 'ENDGAME';
export type TimePressureQualityArmName = 'BASELINE' | 'PRESSURE';

export interface TimePressureQualityAnalysisRun {
  runId: number;
  snapshotId: string;
  analysisVersion: string;
  settingsHash: string;
  engineName: string | null;
  engineVersion: string | null;
}

export interface TimePressureQualitySourceMove {
  plyNumber: number;
  clockBeforeMoveCentiseconds: number | null;
  timingDerivationVersion: number | null;
  timingDerivationStatus: string | null;
  timingReliabilityFlags: readonly string[];
  phase: TimePressureQualityPhase | null;
  scoreLossCp: number | null;
  classificationCode: number | null;
  analysis: TimePressureQualityAnalysisRun | null;
}

export interface TimePressureQualitySourceGame {
  importedGameId: number;
  variant: string | null;
  speedCategory: string | null;
  exactTimeControlKey: string | null;
  timeControlInitial: number | null;
  timeControlIncrement: number | null;
  timingDerivationVersion: number | null;
  userMoves: readonly TimePressureQualitySourceMove[];
}

export interface TimePressureQualityRepository {
  countCandidates(appUserId: number, scope: TimePressureQualityScope): Promise<number>;
  loadCandidates(
    appUserId: number,
    scope: TimePressureQualityScope,
  ): Promise<TimePressureQualitySourceGame[]>;
}

export interface TimePressureQualityArm {
  eligibleMoves: number;
  eligibleGames: number;
  analysedMoves: number;
  supportingGames: number;
  analysisCoveragePercent: number | null;
  requiredEvidenceCoveragePercent: number | null;
  averageScoreLossCp: number | null;
  majorErrorRatePercent: number | null;
  blunderRatePercent: number | null;
}

export interface TimePressureQualityStratumArm {
  eligibleMoves: number;
  analysedMoves: number;
  supportingGames: number;
  averageScoreLossCp: number | null;
  majorErrorRatePercent: number | null;
  blunderRatePercent: number | null;
}

export interface TimePressureQualityStratum {
  exactTimeControlKey: string;
  phase: TimePressureQualityPhase;
  baseline: TimePressureQualityStratumArm;
  pressure: TimePressureQualityStratumArm;
}

export interface TimePressureQualityRatingComposition {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  reason: string | null;
  result: RatingContextCompositionResult | null;
}

export interface TimePressureQualityResult {
  diagnosisId: 'TIME-002';
  policyVersion: string;
  timeBehaviorPolicyVersion: string;
  timingDerivationVersion: number;
  coverage: {
    status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
    reason: string | null;
    candidateGames: number;
    timingEligibleGames: number;
    unsupportedGames: number;
    timingEligibleUserDecisions: number;
    timingCoveredUserDecisions: number;
    timingCoveragePercent: number | null;
    contextEligibleUserDecisions: number;
    contextCoveragePercent: number | null;
    missingExactControlMoves: number;
    missingPhaseMoves: number;
    matchedUserDecisions: number;
    matchingCoveragePercent: number | null;
    matchedStrata: number;
    unmatchedBaselineMoves: number;
    unmatchedPressureMoves: number;
    analysedMatchedUserDecisions: number;
    analysisCoveragePercent: number | null;
    maxCandidateGames: number;
  };
  comparison: {
    baseline: TimePressureQualityArm;
    pressure: TimePressureQualityArm;
    averageScoreLossDeltaCp: number | null;
    majorErrorRateDeltaPercent: number | null;
    blunderRateDeltaPercent: number | null;
    evidenceStrength: TimingBehaviorEvidenceStrength;
  };
  strata: TimePressureQualityStratum[];
  analysisProvenance: {
    requirement: 'CURRENT_COMPLETE_SOURCE_SNAPSHOT';
    analysedRuns: number;
    snapshotIds: string[];
    analysisVersions: string[];
    settingsHashes: string[];
    engines: Array<{ name: string | null; version: string | null }>;
  };
  ratingComposition: TimePressureQualityRatingComposition;
  caveats: string[];
}

interface ClassifiedMove extends TimePressureQualitySourceMove {
  importedGameId: number;
  exactTimeControlKey: string;
  phase: TimePressureQualityPhase;
  arm: TimePressureQualityArmName;
}

interface StratumBucket {
  exactTimeControlKey: string;
  phase: TimePressureQualityPhase;
  baseline: ClassifiedMove[];
  pressure: ClassifiedMove[];
}

interface AggregateDetail {
  result: TimePressureQualityResult;
  analysedBaselineGameIds: number[];
  analysedPressureGameIds: number[];
}

function emptyArm(): TimePressureQualityArm {
  return {
    eligibleMoves: 0,
    eligibleGames: 0,
    analysedMoves: 0,
    supportingGames: 0,
    analysisCoveragePercent: null,
    requiredEvidenceCoveragePercent: null,
    averageScoreLossCp: null,
    majorErrorRatePercent: null,
    blunderRatePercent: null,
  };
}

function emptyProvenance(): TimePressureQualityResult['analysisProvenance'] {
  return {
    requirement: 'CURRENT_COMPLETE_SOURCE_SNAPSHOT',
    analysedRuns: 0,
    snapshotIds: [],
    analysisVersions: [],
    settingsHashes: [],
    engines: [],
  };
}

function unavailable(candidateGames: number, reason: string): TimePressureQualityResult {
  return {
    diagnosisId: 'TIME-002',
    policyVersion: TIME_PRESSURE_QUALITY_POLICY_VERSION,
    timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
    timingDerivationVersion: TIMING_DERIVATION_VERSION,
    coverage: {
      status: 'UNAVAILABLE',
      reason,
      candidateGames,
      timingEligibleGames: 0,
      unsupportedGames: 0,
      timingEligibleUserDecisions: 0,
      timingCoveredUserDecisions: 0,
      timingCoveragePercent: null,
      contextEligibleUserDecisions: 0,
      contextCoveragePercent: null,
      missingExactControlMoves: 0,
      missingPhaseMoves: 0,
      matchedUserDecisions: 0,
      matchingCoveragePercent: null,
      matchedStrata: 0,
      unmatchedBaselineMoves: 0,
      unmatchedPressureMoves: 0,
      analysedMatchedUserDecisions: 0,
      analysisCoveragePercent: null,
      maxCandidateGames: TIME_PRESSURE_QUALITY_MAX_CANDIDATE_GAMES,
    },
    comparison: {
      baseline: emptyArm(),
      pressure: emptyArm(),
      averageScoreLossDeltaCp: null,
      majorErrorRateDeltaPercent: null,
      blunderRateDeltaPercent: null,
      evidenceStrength: 'INSUFFICIENT',
    },
    strata: [],
    analysisProvenance: emptyProvenance(),
    ratingComposition: {
      status: 'UNAVAILABLE',
      reason: 'rating-context-requires-service-composition',
      result: null,
    },
    caveats: [
      'No move-quality-under-pressure conclusion is available from this aggregate.',
      'TIME-002 is correlational and must not be described as panic, tilt, or proof that time pressure caused worse play.',
    ],
  };
}

function validateScope(scope: TimePressureQualityScope): void {
  for (const value of [scope.from, scope.to]) {
    if (value && !Number.isFinite(value.getTime())) {
      throw new RangeError('Time-pressure quality scope contains an invalid date.');
    }
  }
  if (scope.from && scope.to && scope.from.getTime() >= scope.to.getTime()) {
    throw new RangeError('Time-pressure quality scope "from" must be earlier than "to".');
  }
}

function trustworthyTimingMove(
  game: TimePressureQualitySourceGame,
  move: TimePressureQualitySourceMove,
): boolean {
  return game.timingDerivationVersion === TIMING_DERIVATION_VERSION
    && move.plyNumber > 2
    && move.timingDerivationVersion === TIMING_DERIVATION_VERSION
    && move.timingDerivationStatus === 'AVAILABLE'
    && typeof move.clockBeforeMoveCentiseconds === 'number'
    && Number.isFinite(move.clockBeforeMoveCentiseconds)
    && move.clockBeforeMoveCentiseconds >= 0
    && !move.timingReliabilityFlags.includes('POSSIBLE_EXTERNAL_CLOCK_ADJUSTMENT');
}

function analysed(move: ClassifiedMove): boolean {
  return Boolean(
    move.analysis
    && typeof move.scoreLossCp === 'number'
    && Number.isFinite(move.scoreLossCp)
    && move.scoreLossCp >= 0,
  );
}

function majorError(move: ClassifiedMove): boolean {
  return move.classificationCode === MoveClassificationCode.Mistake
    || move.classificationCode === MoveClassificationCode.Blunder;
}

function blunder(move: ClassifiedMove): boolean {
  return move.classificationCode === MoveClassificationCode.Blunder;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return roundTimingBehaviorMetric(
    values.reduce((sum, value) => sum + value, 0) / values.length,
  );
}

function delta(right: number | null, left: number | null): number | null {
  return right === null || left === null
    ? null
    : roundTimingBehaviorMetric(right - left);
}

function minimumCoverage(values: readonly (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null;
  return Math.min(...values as number[]);
}

function stratumKey(exactTimeControlKey: string, phase: TimePressureQualityPhase): string {
  return JSON.stringify([exactTimeControlKey, phase]);
}

function sortStrata(left: TimePressureQualityStratum, right: TimePressureQualityStratum): number {
  const control = left.exactTimeControlKey.localeCompare(right.exactTimeControlKey);
  if (control !== 0) return control;
  const order: Record<TimePressureQualityPhase, number> = {
    OPENING: 0,
    MIDDLEGAME: 1,
    ENDGAME: 2,
  };
  return order[left.phase] - order[right.phase];
}

function summarizeStratumArm(moves: readonly ClassifiedMove[]): TimePressureQualityStratumArm {
  const analysedMoves = moves.filter(analysed);
  const scoreLosses = analysedMoves.map((move) => move.scoreLossCp as number);
  const majorErrors = analysedMoves.filter(majorError).length;
  const blunders = analysedMoves.filter(blunder).length;
  return {
    eligibleMoves: moves.length,
    analysedMoves: analysedMoves.length,
    supportingGames: new Set(analysedMoves.map((move) => move.importedGameId)).size,
    averageScoreLossCp: average(scoreLosses),
    majorErrorRatePercent: timingBehaviorPercentage(majorErrors, analysedMoves.length),
    blunderRatePercent: timingBehaviorPercentage(blunders, analysedMoves.length),
  };
}

function summarizeArm(
  moves: readonly ClassifiedMove[],
  globalTimingCoveragePercent: number | null,
  globalContextCoveragePercent: number | null,
  globalMatchingCoveragePercent: number | null,
): TimePressureQualityArm {
  const analysedMoves = moves.filter(analysed);
  const analysisCoveragePercent = timingBehaviorPercentage(analysedMoves.length, moves.length);
  const scoreLosses = analysedMoves.map((move) => move.scoreLossCp as number);
  const majorErrors = analysedMoves.filter(majorError).length;
  const blunders = analysedMoves.filter(blunder).length;
  return {
    eligibleMoves: moves.length,
    eligibleGames: new Set(moves.map((move) => move.importedGameId)).size,
    analysedMoves: analysedMoves.length,
    supportingGames: new Set(analysedMoves.map((move) => move.importedGameId)).size,
    analysisCoveragePercent,
    requiredEvidenceCoveragePercent: minimumCoverage([
      globalTimingCoveragePercent,
      globalContextCoveragePercent,
      globalMatchingCoveragePercent,
      analysisCoveragePercent,
    ]),
    averageScoreLossCp: average(scoreLosses),
    majorErrorRatePercent: timingBehaviorPercentage(majorErrors, analysedMoves.length),
    blunderRatePercent: timingBehaviorPercentage(blunders, analysedMoves.length),
  };
}

function provenanceFor(moves: readonly ClassifiedMove[]): TimePressureQualityResult['analysisProvenance'] {
  const runById = new Map<number, TimePressureQualityAnalysisRun>();
  for (const move of moves) {
    if (analysed(move) && move.analysis) {
      runById.set(move.analysis.runId, move.analysis);
    }
  }

  const runs = [...runById.values()].sort((left, right) => left.runId - right.runId);
  const engines = new Map<string, { name: string | null; version: string | null }>();
  for (const run of runs) {
    engines.set(JSON.stringify([run.engineName, run.engineVersion]), {
      name: run.engineName,
      version: run.engineVersion,
    });
  }

  return {
    requirement: 'CURRENT_COMPLETE_SOURCE_SNAPSHOT',
    analysedRuns: runs.length,
    snapshotIds: [...new Set(runs.map((run) => run.snapshotId))].sort(),
    analysisVersions: [...new Set(runs.map((run) => run.analysisVersion))].sort(),
    settingsHashes: [...new Set(runs.map((run) => run.settingsHash))].sort(),
    engines: [...engines.values()].sort((left, right) => {
      const leftKey = (left.name ?? '') + '\u0000' + (left.version ?? '');
      const rightKey = (right.name ?? '') + '\u0000' + (right.version ?? '');
      return leftKey.localeCompare(rightKey);
    }),
  };
}

function buildAggregateDetail(
  games: readonly TimePressureQualitySourceGame[],
): AggregateDetail {
  if (games.length === 0) {
    return {
      result: unavailable(0, 'no-candidate-games'),
      analysedBaselineGameIds: [],
      analysedPressureGameIds: [],
    };
  }

  const seen = new Set<number>();
  for (const game of games) {
    if (seen.has(game.importedGameId)) {
      return {
        result: unavailable(games.length, 'duplicate-candidate-game-row'),
        analysedBaselineGameIds: [],
        analysedPressureGameIds: [],
      };
    }
    seen.add(game.importedGameId);
  }

  let timingEligibleGames = 0;
  let unsupportedGames = 0;
  let timingEligibleUserDecisions = 0;
  let timingCoveredUserDecisions = 0;
  let missingExactControlMoves = 0;
  let missingPhaseMoves = 0;
  const contextMoves: ClassifiedMove[] = [];

  for (const game of games) {
    if (!isTimingEligibleGame(game)) {
      unsupportedGames += 1;
      continue;
    }
    timingEligibleGames += 1;

    for (const move of [...game.userMoves].sort((left, right) => left.plyNumber - right.plyNumber)) {
      if (move.plyNumber <= 2) continue;
      timingEligibleUserDecisions += 1;
      if (!trustworthyTimingMove(game, move)) continue;
      timingCoveredUserDecisions += 1;

      const band = classifyRemainingClock(move.clockBeforeMoveCentiseconds);
      if (band === null) continue;

      if (!game.exactTimeControlKey) {
        missingExactControlMoves += 1;
        continue;
      }
      if (!move.phase) {
        missingPhaseMoves += 1;
        continue;
      }

      contextMoves.push({
        ...move,
        importedGameId: game.importedGameId,
        exactTimeControlKey: game.exactTimeControlKey,
        phase: move.phase,
        arm: band === 'NORMAL' ? 'BASELINE' : 'PRESSURE',
      });
    }
  }

  const timingCoveragePercent = timingBehaviorPercentage(
    timingCoveredUserDecisions,
    timingEligibleUserDecisions,
  );
  const contextCoveragePercent = timingBehaviorPercentage(
    contextMoves.length,
    timingCoveredUserDecisions,
  );

  const buckets = new Map<string, StratumBucket>();
  for (const move of contextMoves) {
    const key = stratumKey(move.exactTimeControlKey, move.phase);
    const bucket = buckets.get(key) ?? {
      exactTimeControlKey: move.exactTimeControlKey,
      phase: move.phase,
      baseline: [],
      pressure: [],
    };
    if (move.arm === 'BASELINE') bucket.baseline.push(move);
    else bucket.pressure.push(move);
    buckets.set(key, bucket);
  }

  const matchedBuckets = [...buckets.values()].filter(
    (bucket) => bucket.baseline.length > 0 && bucket.pressure.length > 0,
  );
  const unmatchedBaselineMoves = [...buckets.values()]
    .filter((bucket) => bucket.pressure.length === 0)
    .reduce((sum, bucket) => sum + bucket.baseline.length, 0);
  const unmatchedPressureMoves = [...buckets.values()]
    .filter((bucket) => bucket.baseline.length === 0)
    .reduce((sum, bucket) => sum + bucket.pressure.length, 0);

  const baselineMoves = matchedBuckets.flatMap((bucket) => bucket.baseline);
  const pressureMoves = matchedBuckets.flatMap((bucket) => bucket.pressure);
  const matchedUserDecisions = baselineMoves.length + pressureMoves.length;
  const matchingCoveragePercent = timingBehaviorPercentage(
    matchedUserDecisions,
    contextMoves.length,
  );

  const baseline = summarizeArm(
    baselineMoves,
    timingCoveragePercent,
    contextCoveragePercent,
    matchingCoveragePercent,
  );
  const pressure = summarizeArm(
    pressureMoves,
    timingCoveragePercent,
    contextCoveragePercent,
    matchingCoveragePercent,
  );
  const analysedMatchedUserDecisions = baseline.analysedMoves + pressure.analysedMoves;
  const analysisCoveragePercent = timingBehaviorPercentage(
    analysedMatchedUserDecisions,
    matchedUserDecisions,
  );

  let status: TimePressureQualityResult['coverage']['status'];
  let reason: string | null;
  if (timingEligibleGames === 0 || timingEligibleUserDecisions === 0) {
    status = 'UNAVAILABLE';
    reason = 'no-timing-eligible-user-decisions';
  } else if (timingCoveredUserDecisions === 0) {
    status = 'UNAVAILABLE';
    reason = 'timing-evidence-unavailable';
  } else if (matchedBuckets.length === 0) {
    status = 'UNAVAILABLE';
    reason = 'no-matched-pressure-baseline-strata';
  } else if (baseline.analysedMoves === 0 || pressure.analysedMoves === 0) {
    status = 'UNAVAILABLE';
    reason = 'engine-analysis-unavailable-in-comparison-arm';
  } else {
    const complete = timingCoveredUserDecisions === timingEligibleUserDecisions
      && contextMoves.length === timingCoveredUserDecisions
      && matchedUserDecisions === contextMoves.length
      && analysedMatchedUserDecisions === matchedUserDecisions;
    status = complete ? 'COMPLETE' : 'PARTIAL';
    reason = complete
      ? null
      : timingCoveredUserDecisions !== timingEligibleUserDecisions
        ? 'timing-coverage-incomplete'
        : contextMoves.length !== timingCoveredUserDecisions
          ? 'comparison-context-incomplete'
          : matchedUserDecisions !== contextMoves.length
            ? 'unmatched-comparison-context'
            : 'engine-analysis-incomplete';
  }

  const analysedMoves = [...baselineMoves, ...pressureMoves].filter(analysed);
  const strata = matchedBuckets.map<TimePressureQualityStratum>((bucket) => ({
    exactTimeControlKey: bucket.exactTimeControlKey,
    phase: bucket.phase,
    baseline: summarizeStratumArm(bucket.baseline),
    pressure: summarizeStratumArm(bucket.pressure),
  })).sort(sortStrata);

  const evidenceStrength = comparativeTimingBehaviorEvidenceStrength(
    {
      supportingGames: baseline.supportingGames,
      requiredEvidenceCoveragePercent: baseline.requiredEvidenceCoveragePercent,
    },
    {
      supportingGames: pressure.supportingGames,
      requiredEvidenceCoveragePercent: pressure.requiredEvidenceCoveragePercent,
    },
  );

  const caveats = [
    'TIME-002 compares current engine move quality under pressure with NORMAL-clock moves matched by exact time control and stabilized phase.',
    'The comparison is a within-player association and does not establish that time pressure caused worse play or that the player panicked.',
    'Only current complete engine analysis from the same ply-index snapshot contributes move-quality metrics; stale, superseded, incomplete, or missing analysis is coverage loss.',
    'Matching keeps exact controls and phases separate, but v1 does not equalize stratum frequencies and does not match opening family, session context, color, date, or opponent strength.',
  ];
  if (timingCoveragePercent !== 100) {
    caveats.push('Some derivable user decisions lack current trustworthy timing and are excluded rather than interpreted as normal-clock evidence.');
  }
  if (contextCoveragePercent !== 100) {
    caveats.push('Some trustworthy timed moves lack exact-control or stabilized-phase context and cannot enter the matched comparison.');
  }
  if (matchingCoveragePercent !== 100) {
    caveats.push('Moves in one-sided exact-control/phase strata are excluded because no opposite-arm comparator exists.');
  }
  if (analysisCoveragePercent !== 100) {
    caveats.push('Some matched moves lack current complete engine quality and remain explicit analysis-coverage loss.');
  }

  const result: TimePressureQualityResult = {
    diagnosisId: 'TIME-002',
    policyVersion: TIME_PRESSURE_QUALITY_POLICY_VERSION,
    timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
    timingDerivationVersion: TIMING_DERIVATION_VERSION,
    coverage: {
      status,
      reason,
      candidateGames: games.length,
      timingEligibleGames,
      unsupportedGames,
      timingEligibleUserDecisions,
      timingCoveredUserDecisions,
      timingCoveragePercent,
      contextEligibleUserDecisions: contextMoves.length,
      contextCoveragePercent,
      missingExactControlMoves,
      missingPhaseMoves,
      matchedUserDecisions,
      matchingCoveragePercent,
      matchedStrata: matchedBuckets.length,
      unmatchedBaselineMoves,
      unmatchedPressureMoves,
      analysedMatchedUserDecisions,
      analysisCoveragePercent,
      maxCandidateGames: TIME_PRESSURE_QUALITY_MAX_CANDIDATE_GAMES,
    },
    comparison: {
      baseline,
      pressure,
      averageScoreLossDeltaCp: delta(
        pressure.averageScoreLossCp,
        baseline.averageScoreLossCp,
      ),
      majorErrorRateDeltaPercent: delta(
        pressure.majorErrorRatePercent,
        baseline.majorErrorRatePercent,
      ),
      blunderRateDeltaPercent: delta(
        pressure.blunderRatePercent,
        baseline.blunderRatePercent,
      ),
      evidenceStrength,
    },
    strata,
    analysisProvenance: provenanceFor(analysedMoves),
    ratingComposition: {
      status: 'UNAVAILABLE',
      reason: 'rating-context-requires-service-composition',
      result: null,
    },
    caveats,
  };

  return {
    result,
    analysedBaselineGameIds: [...new Set(
      baselineMoves.filter(analysed).map((move) => move.importedGameId),
    )].sort((left, right) => left - right),
    analysedPressureGameIds: [...new Set(
      pressureMoves.filter(analysed).map((move) => move.importedGameId),
    )].sort((left, right) => left - right),
  };
}

export function buildTimePressureQualityCollapseAggregate(
  games: readonly TimePressureQualitySourceGame[],
): TimePressureQualityResult {
  return buildAggregateDetail(games).result;
}

export async function getTimePressureQualityCollapse(
  appUserId: number,
  scope: TimePressureQualityScope,
  repository: TimePressureQualityRepository,
  ratingRepository: RatingContextCompositionRepository,
): Promise<TimePressureQualityResult> {
  validateScope(scope);
  const candidateGames = await repository.countCandidates(appUserId, scope);

  if (candidateGames > TIME_PRESSURE_QUALITY_MAX_CANDIDATE_GAMES) {
    return unavailable(candidateGames, 'time-pressure-quality-scope-too-large');
  }
  if (candidateGames === 0) return unavailable(0, 'no-candidate-games');

  const games = await repository.loadCandidates(appUserId, scope);
  if (games.length !== candidateGames) {
    return unavailable(candidateGames, 'candidate-set-changed-during-read');
  }

  const detail = buildAggregateDetail(games);
  if (detail.result.coverage.status === 'UNAVAILABLE') {
    return {
      ...detail.result,
      ratingComposition: {
        status: 'UNAVAILABLE',
        reason: 'quality-comparison-unavailable',
        result: null,
      },
    };
  }

  const baseline = detail.analysedBaselineGameIds;
  const pressure = detail.analysedPressureGameIds;
  if (baseline.length === 0 || pressure.length === 0) {
    return {
      ...detail.result,
      ratingComposition: {
        status: 'UNAVAILABLE',
        reason: 'insufficient-analysed-game-arms',
        result: null,
      },
    };
  }

  const baselineSet = new Set(baseline);
  if (pressure.some((id) => baselineSet.has(id))) {
    return {
      ...detail.result,
      ratingComposition: {
        status: 'UNAVAILABLE',
        reason: 'comparison-game-arms-overlap',
        result: null,
      },
      caveats: [
        ...detail.result.caveats,
        'RATING-002 is not attached because at least one analysed game contributes moves to both pressure and baseline arms, while the reusable composition contract requires disjoint game-ID arms.',
      ],
    };
  }

  const ratingResult = await getRatingContextComposition(
    appUserId,
    {
      left: { importedGameIds: baseline },
      right: { importedGameIds: pressure },
    },
    ratingRepository,
  );

  return {
    ...detail.result,
    ratingComposition: {
      status: 'AVAILABLE',
      reason: null,
      result: ratingResult,
    },
    caveats: [
      ...detail.result.caveats,
      'When attached, RATING-002 is a separate opponent-strength composition disclosure and does not alter the measured pressure-quality deltas.',
    ],
  };
}
