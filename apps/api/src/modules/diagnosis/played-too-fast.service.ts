import { MoveClassificationCode } from '@why-i-suck-at-chess/chess-domain';
import {
  TIME_AMPLE_CLOCK_INITIAL_FRACTION,
  TIME_AMPLE_CLOCK_MIN_CENTISECONDS,
  TIME_BEHAVIOR_POLICY_VERSION,
  TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS,
  classifyMoveSpeed,
  comparativeTimingBehaviorEvidenceStrength,
  isAmpleClock,
  roundTimingBehaviorMetric,
  timingBehaviorPercentage,
  type TimingBehaviorEvidenceStrength,
} from '../timing/time-behavior-policy';
import {
  TIMING_DERIVATION_VERSION,
  isTimingEligibleGame,
} from '../timing/timing-policy';

export const PLAYED_TOO_FAST_POLICY_VERSION = 'played-too-fast-v1';
export const PLAYED_TOO_FAST_MAX_CANDIDATE_GAMES = 5_000;

export interface PlayedTooFastScope {
  from?: Date;
  to?: Date;
}

export type PlayedTooFastPhase = 'OPENING' | 'MIDDLEGAME' | 'ENDGAME';
export type PlayedTooFastArmName = 'BASELINE' | 'FAST_AMPLE';
export type PlayedTooFastMechanismStatus =
  | 'INSUFFICIENT'
  | 'NOT_SUPPORTED'
  | 'WORSE_QUALITY_ASSOCIATION';

export interface PlayedTooFastAnalysisRun {
  runId: number;
  snapshotId: string;
  analysisVersion: string;
  settingsHash: string;
  engineName: string | null;
  engineVersion: string | null;
}

export interface PlayedTooFastSourceMove {
  plyNumber: number;
  clockBeforeMoveCentiseconds: number | null;
  moveTimeCentiseconds: number | null;
  timingDerivationVersion: number | null;
  timingDerivationStatus: string | null;
  timingReliabilityFlags: readonly string[];
  phase: PlayedTooFastPhase | null;
  scoreLossCp: number | null;
  classificationCode: number | null;
  analysis: PlayedTooFastAnalysisRun | null;
}

export interface PlayedTooFastSourceGame {
  importedGameId: number;
  variant: string | null;
  speedCategory: string | null;
  exactTimeControlKey: string | null;
  timeControlInitial: number | null;
  timingDerivationVersion: number | null;
  userMoves: readonly PlayedTooFastSourceMove[];
}

export interface PlayedTooFastRepository {
  countCandidates(appUserId: number, scope: PlayedTooFastScope): Promise<number>;
  loadCandidates(
    appUserId: number,
    scope: PlayedTooFastScope,
  ): Promise<PlayedTooFastSourceGame[]>;
}

export interface PlayedTooFastArm {
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

export interface PlayedTooFastStratumArm {
  eligibleMoves: number;
  analysedMoves: number;
  supportingGames: number;
  averageScoreLossCp: number | null;
  majorErrorRatePercent: number | null;
  blunderRatePercent: number | null;
}

export interface PlayedTooFastStratum {
  exactTimeControlKey: string;
  phase: PlayedTooFastPhase;
  baseline: PlayedTooFastStratumArm;
  fastAmple: PlayedTooFastStratumArm;
}

export interface PlayedTooFastResult {
  diagnosisId: 'TIME-003';
  policyVersion: string;
  timeBehaviorPolicyVersion: string;
  timingDerivationVersion: number;
  definitions: {
    fastDecisionMaxCentisecondsInclusive: number;
    normalDecisionMinCentisecondsExclusive: number;
    ampleClockMinimumCentiseconds: number;
    ampleClockInitialFraction: number;
    matchingDimensions: ['EXACT_TIME_CONTROL', 'PHASE'];
  };
  coverage: {
    status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
    reason: string | null;
    candidateGames: number;
    timingEligibleGames: number;
    unsupportedGames: number;
    timingEligibleUserDecisions: number;
    timingCoveredUserDecisions: number;
    timingCoveragePercent: number | null;
    ampleClockUserDecisions: number;
    nonAmpleClockUserDecisions: number;
    unknownAmpleClockUserDecisions: number;
    ampleClassificationCoveragePercent: number | null;
    fastWithoutAmpleClockMoves: number;
    contextEligibleUserDecisions: number;
    contextCoveragePercent: number | null;
    missingExactControlMoves: number;
    missingPhaseMoves: number;
    matchedUserDecisions: number;
    matchingCoveragePercent: number | null;
    matchedStrata: number;
    unmatchedBaselineMoves: number;
    unmatchedFastMoves: number;
    analysedMatchedUserDecisions: number;
    analysisCoveragePercent: number | null;
    maxCandidateGames: number;
  };
  recurrence: {
    fastAmpleGames: number;
    baselineGames: number;
    analysedFastAmpleGames: number;
    analysedBaselineGames: number;
  };
  comparison: {
    baseline: PlayedTooFastArm;
    fastAmple: PlayedTooFastArm;
    averageScoreLossDeltaCp: number | null;
    majorErrorRateDeltaPercent: number | null;
    blunderRateDeltaPercent: number | null;
    evidenceStrength: TimingBehaviorEvidenceStrength;
    mechanismStatus: PlayedTooFastMechanismStatus;
  };
  strata: PlayedTooFastStratum[];
  analysisProvenance: {
    requirement: 'CURRENT_COMPLETE_SOURCE_SNAPSHOT';
    analysedRuns: number;
    snapshotIds: string[];
    analysisVersions: string[];
    settingsHashes: string[];
    engines: Array<{ name: string | null; version: string | null }>;
  };
  caveats: string[];
}

interface ClassifiedMove extends PlayedTooFastSourceMove {
  importedGameId: number;
  exactTimeControlKey: string;
  phase: PlayedTooFastPhase;
  arm: PlayedTooFastArmName;
}

interface StratumBucket {
  exactTimeControlKey: string;
  phase: PlayedTooFastPhase;
  baseline: ClassifiedMove[];
  fastAmple: ClassifiedMove[];
}

function emptyArm(): PlayedTooFastArm {
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

function emptyProvenance(): PlayedTooFastResult['analysisProvenance'] {
  return {
    requirement: 'CURRENT_COMPLETE_SOURCE_SNAPSHOT',
    analysedRuns: 0,
    snapshotIds: [],
    analysisVersions: [],
    settingsHashes: [],
    engines: [],
  };
}

function unavailable(candidateGames: number, reason: string): PlayedTooFastResult {
  return {
    diagnosisId: 'TIME-003',
    policyVersion: PLAYED_TOO_FAST_POLICY_VERSION,
    timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
    timingDerivationVersion: TIMING_DERIVATION_VERSION,
    definitions: {
      fastDecisionMaxCentisecondsInclusive: TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS,
      normalDecisionMinCentisecondsExclusive: TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS,
      ampleClockMinimumCentiseconds: TIME_AMPLE_CLOCK_MIN_CENTISECONDS,
      ampleClockInitialFraction: TIME_AMPLE_CLOCK_INITIAL_FRACTION,
      matchingDimensions: ['EXACT_TIME_CONTROL', 'PHASE'],
    },
    coverage: {
      status: 'UNAVAILABLE',
      reason,
      candidateGames,
      timingEligibleGames: 0,
      unsupportedGames: 0,
      timingEligibleUserDecisions: 0,
      timingCoveredUserDecisions: 0,
      timingCoveragePercent: null,
      ampleClockUserDecisions: 0,
      nonAmpleClockUserDecisions: 0,
      unknownAmpleClockUserDecisions: 0,
      ampleClassificationCoveragePercent: null,
      fastWithoutAmpleClockMoves: 0,
      contextEligibleUserDecisions: 0,
      contextCoveragePercent: null,
      missingExactControlMoves: 0,
      missingPhaseMoves: 0,
      matchedUserDecisions: 0,
      matchingCoveragePercent: null,
      matchedStrata: 0,
      unmatchedBaselineMoves: 0,
      unmatchedFastMoves: 0,
      analysedMatchedUserDecisions: 0,
      analysisCoveragePercent: null,
      maxCandidateGames: PLAYED_TOO_FAST_MAX_CANDIDATE_GAMES,
    },
    recurrence: {
      fastAmpleGames: 0,
      baselineGames: 0,
      analysedFastAmpleGames: 0,
      analysedBaselineGames: 0,
    },
    comparison: {
      baseline: emptyArm(),
      fastAmple: emptyArm(),
      averageScoreLossDeltaCp: null,
      majorErrorRateDeltaPercent: null,
      blunderRateDeltaPercent: null,
      evidenceStrength: 'INSUFFICIENT',
      mechanismStatus: 'INSUFFICIENT',
    },
    strata: [],
    analysisProvenance: emptyProvenance(),
    caveats: [
      'No played-too-fast quality conclusion is available from this aggregate.',
      'TIME-003 describes measured decision speed and associated move quality; it does not infer premove intent, impulsiveness, panic, or another psychological cause.',
    ],
  };
}

function validateScope(scope: PlayedTooFastScope): void {
  for (const value of [scope.from, scope.to]) {
    if (value && !Number.isFinite(value.getTime())) {
      throw new RangeError('Played-too-fast scope contains an invalid date.');
    }
  }
  if (scope.from && scope.to && scope.from.getTime() >= scope.to.getTime()) {
    throw new RangeError('Played-too-fast scope "from" must be earlier than "to".');
  }
}

function trustworthyTimingMove(
  game: PlayedTooFastSourceGame,
  move: PlayedTooFastSourceMove,
): boolean {
  return game.timingDerivationVersion === TIMING_DERIVATION_VERSION
    && move.plyNumber > 2
    && move.timingDerivationVersion === TIMING_DERIVATION_VERSION
    && move.timingDerivationStatus === 'AVAILABLE'
    && typeof move.clockBeforeMoveCentiseconds === 'number'
    && Number.isFinite(move.clockBeforeMoveCentiseconds)
    && move.clockBeforeMoveCentiseconds >= 0
    && typeof move.moveTimeCentiseconds === 'number'
    && Number.isFinite(move.moveTimeCentiseconds)
    && move.moveTimeCentiseconds >= 0
    && !move.timingReliabilityFlags.includes('POSSIBLE_EXTERNAL_CLOCK_ADJUSTMENT');
}

function initialTimeCentiseconds(game: PlayedTooFastSourceGame): number | null {
  if (
    typeof game.timeControlInitial !== 'number'
    || !Number.isFinite(game.timeControlInitial)
    || game.timeControlInitial <= 0
  ) {
    return null;
  }
  return game.timeControlInitial * 100;
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
  const covered = values.filter((value): value is number => value !== null);
  return Math.min(...covered);
}

function stratumKey(exactTimeControlKey: string, phase: PlayedTooFastPhase): string {
  return JSON.stringify([exactTimeControlKey, phase]);
}

function sortStrata(left: PlayedTooFastStratum, right: PlayedTooFastStratum): number {
  const control = left.exactTimeControlKey.localeCompare(right.exactTimeControlKey);
  if (control !== 0) return control;
  const order: Record<PlayedTooFastPhase, number> = {
    OPENING: 0,
    MIDDLEGAME: 1,
    ENDGAME: 2,
  };
  return order[left.phase] - order[right.phase];
}

function summarizeStratumArm(moves: readonly ClassifiedMove[]): PlayedTooFastStratumArm {
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
  comparisonAnalysedMoves: readonly ClassifiedMove[],
  requiredCoverage: readonly (number | null)[],
): PlayedTooFastArm {
  const analysedMoves = [...comparisonAnalysedMoves];
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
      ...requiredCoverage,
      analysisCoveragePercent,
    ]),
    averageScoreLossCp: average(scoreLosses),
    majorErrorRatePercent: timingBehaviorPercentage(majorErrors, analysedMoves.length),
    blunderRatePercent: timingBehaviorPercentage(blunders, analysedMoves.length),
  };
}

function provenanceFor(moves: readonly ClassifiedMove[]): PlayedTooFastResult['analysisProvenance'] {
  const runById = new Map<number, PlayedTooFastAnalysisRun>();
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

function mechanismStatus(
  evidenceStrength: TimingBehaviorEvidenceStrength,
  scoreLossDeltaCp: number | null,
): PlayedTooFastMechanismStatus {
  if (evidenceStrength === 'INSUFFICIENT' || scoreLossDeltaCp === null) {
    return 'INSUFFICIENT';
  }
  return scoreLossDeltaCp > 0 ? 'WORSE_QUALITY_ASSOCIATION' : 'NOT_SUPPORTED';
}

export function buildPlayedTooFastAggregate(
  games: readonly PlayedTooFastSourceGame[],
): PlayedTooFastResult {
  if (games.length === 0) return unavailable(0, 'no-candidate-games');

  const seen = new Set<number>();
  for (const game of games) {
    if (seen.has(game.importedGameId)) {
      return unavailable(games.length, 'duplicate-candidate-game-row');
    }
    seen.add(game.importedGameId);
  }

  let timingEligibleGames = 0;
  let unsupportedGames = 0;
  let timingEligibleUserDecisions = 0;
  let timingCoveredUserDecisions = 0;
  let ampleClockUserDecisions = 0;
  let ampleFastUserDecisions = 0;
  let ampleBaselineUserDecisions = 0;
  let nonAmpleClockUserDecisions = 0;
  let unknownAmpleClockUserDecisions = 0;
  let fastWithoutAmpleClockMoves = 0;
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

      const initialCentiseconds = initialTimeCentiseconds(game);
      const ample = isAmpleClock(move.clockBeforeMoveCentiseconds, initialCentiseconds);
      if (ample === null) {
        unknownAmpleClockUserDecisions += 1;
        continue;
      }
      if (!ample) {
        nonAmpleClockUserDecisions += 1;
        if (classifyMoveSpeed(move.moveTimeCentiseconds) === 'FAST') {
          fastWithoutAmpleClockMoves += 1;
        }
        continue;
      }
      ampleClockUserDecisions += 1;

      const speed = classifyMoveSpeed(move.moveTimeCentiseconds);
      if (!speed) continue;
      if (speed === 'FAST') ampleFastUserDecisions += 1;
      else ampleBaselineUserDecisions += 1;

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
        arm: speed === 'FAST' ? 'FAST_AMPLE' : 'BASELINE',
      });
    }
  }

  const timingCoveragePercent = timingBehaviorPercentage(
    timingCoveredUserDecisions,
    timingEligibleUserDecisions,
  );
  const ampleClassificationCoveragePercent = timingBehaviorPercentage(
    ampleClockUserDecisions + nonAmpleClockUserDecisions,
    timingCoveredUserDecisions,
  );
  const contextCoveragePercent = timingBehaviorPercentage(
    contextMoves.length,
    ampleClockUserDecisions,
  );
  const contextBaselineMoves = contextMoves.filter((move) => move.arm === 'BASELINE');
  const contextFastMoves = contextMoves.filter((move) => move.arm === 'FAST_AMPLE');
  const baselineContextCoveragePercent = timingBehaviorPercentage(
    contextBaselineMoves.length,
    ampleBaselineUserDecisions,
  );
  const fastContextCoveragePercent = timingBehaviorPercentage(
    contextFastMoves.length,
    ampleFastUserDecisions,
  );

  const buckets = new Map<string, StratumBucket>();
  for (const move of contextMoves) {
    const key = stratumKey(move.exactTimeControlKey, move.phase);
    const bucket = buckets.get(key) ?? {
      exactTimeControlKey: move.exactTimeControlKey,
      phase: move.phase,
      baseline: [],
      fastAmple: [],
    };
    if (move.arm === 'BASELINE') bucket.baseline.push(move);
    else bucket.fastAmple.push(move);
    buckets.set(key, bucket);
  }

  const matchedBuckets = [...buckets.values()].filter(
    (bucket) => bucket.baseline.length > 0 && bucket.fastAmple.length > 0,
  );
  const unmatchedBaselineMoves = [...buckets.values()]
    .filter((bucket) => bucket.fastAmple.length === 0)
    .reduce((sum, bucket) => sum + bucket.baseline.length, 0);
  const unmatchedFastMoves = [...buckets.values()]
    .filter((bucket) => bucket.baseline.length === 0)
    .reduce((sum, bucket) => sum + bucket.fastAmple.length, 0);

  const baselineMoves = matchedBuckets.flatMap((bucket) => bucket.baseline);
  const fastMoves = matchedBuckets.flatMap((bucket) => bucket.fastAmple);
  const matchedUserDecisions = baselineMoves.length + fastMoves.length;
  const matchingCoveragePercent = timingBehaviorPercentage(
    matchedUserDecisions,
    contextMoves.length,
  );
  const baselineMatchingCoveragePercent = timingBehaviorPercentage(
    baselineMoves.length,
    contextBaselineMoves.length,
  );
  const fastMatchingCoveragePercent = timingBehaviorPercentage(
    fastMoves.length,
    contextFastMoves.length,
  );

  const analysisMatchedBuckets = matchedBuckets.filter(
    (bucket) => bucket.baseline.some(analysed) && bucket.fastAmple.some(analysed),
  );
  const analysedBaselineMoves = analysisMatchedBuckets
    .flatMap((bucket) => bucket.baseline)
    .filter(analysed);
  const analysedFastMoves = analysisMatchedBuckets
    .flatMap((bucket) => bucket.fastAmple)
    .filter(analysed);

  const baselineRequiredCoverage = [
    timingCoveragePercent,
    ampleClassificationCoveragePercent,
    baselineContextCoveragePercent,
    baselineMatchingCoveragePercent,
  ];
  const fastRequiredCoverage = [
    timingCoveragePercent,
    ampleClassificationCoveragePercent,
    fastContextCoveragePercent,
    fastMatchingCoveragePercent,
  ];
  const baseline = summarizeArm(
    baselineMoves,
    analysedBaselineMoves,
    baselineRequiredCoverage,
  );
  const fastAmple = summarizeArm(
    fastMoves,
    analysedFastMoves,
    fastRequiredCoverage,
  );
  const analysedMatchedUserDecisions = baseline.analysedMoves + fastAmple.analysedMoves;
  const rawAnalysedMatchedUserDecisions = [...baselineMoves, ...fastMoves]
    .filter(analysed).length;
  const analysisCoveragePercent = timingBehaviorPercentage(
    analysedMatchedUserDecisions,
    matchedUserDecisions,
  );

  let status: PlayedTooFastResult['coverage']['status'];
  let reason: string | null;
  if (timingEligibleGames === 0 || timingEligibleUserDecisions === 0) {
    status = 'UNAVAILABLE';
    reason = 'no-timing-eligible-user-decisions';
  } else if (timingCoveredUserDecisions === 0) {
    status = 'UNAVAILABLE';
    reason = 'timing-evidence-unavailable';
  } else if (ampleClockUserDecisions === 0) {
    status = 'UNAVAILABLE';
    reason = 'no-ample-clock-user-decisions';
  } else if (contextMoves.length === 0) {
    status = 'UNAVAILABLE';
    reason = 'comparison-context-unavailable';
  } else if (matchedBuckets.length === 0) {
    status = 'UNAVAILABLE';
    reason = 'no-matched-fast-baseline-strata';
  } else if (
    analysisMatchedBuckets.length === 0
    || baseline.analysedMoves === 0
    || fastAmple.analysedMoves === 0
  ) {
    status = 'UNAVAILABLE';
    reason = 'engine-analysis-unavailable-in-comparison-arm';
  } else {
    const complete = timingCoveredUserDecisions === timingEligibleUserDecisions
      && unknownAmpleClockUserDecisions === 0
      && contextMoves.length === ampleClockUserDecisions
      && matchedUserDecisions === contextMoves.length
      && analysedMatchedUserDecisions === matchedUserDecisions;
    status = complete ? 'COMPLETE' : 'PARTIAL';
    reason = complete
      ? null
      : timingCoveredUserDecisions !== timingEligibleUserDecisions
        ? 'timing-coverage-incomplete'
        : unknownAmpleClockUserDecisions !== 0
          ? 'ample-clock-context-incomplete'
          : contextMoves.length !== ampleClockUserDecisions
            ? 'comparison-context-incomplete'
            : matchedUserDecisions !== contextMoves.length
              ? 'unmatched-comparison-context'
              : 'engine-analysis-incomplete';
  }

  const scoreLossDelta = delta(
    fastAmple.averageScoreLossCp,
    baseline.averageScoreLossCp,
  );
  const evidenceStrength = comparativeTimingBehaviorEvidenceStrength(
    {
      supportingGames: baseline.supportingGames,
      requiredEvidenceCoveragePercent: baseline.requiredEvidenceCoveragePercent,
    },
    {
      supportingGames: fastAmple.supportingGames,
      requiredEvidenceCoveragePercent: fastAmple.requiredEvidenceCoveragePercent,
    },
  );

  const analysedMoves = [...analysedBaselineMoves, ...analysedFastMoves];
  const strata = matchedBuckets.map<PlayedTooFastStratum>((bucket) => ({
    exactTimeControlKey: bucket.exactTimeControlKey,
    phase: bucket.phase,
    baseline: summarizeStratumArm(bucket.baseline),
    fastAmple: summarizeStratumArm(bucket.fastAmple),
  })).sort(sortStrata);

  const caveats = [
    'TIME-003 compares unusually fast user decisions made with ample clock against normal-pace ample-clock decisions matched by exact time control and stabilized phase.',
    'Fast decisions without ample clock are excluded from the candidate arm rather than interpreted as played-too-fast behavior.',
    'Only current complete engine analysis from the same ply-index snapshot contributes move-quality metrics; stale, superseded, incomplete, or missing analysis is coverage loss.',
    'The result is a within-player association and does not establish premove intent, impulsiveness, panic, or another psychological cause.',
    'Evidence strength applies context and matching coverage per comparison arm, so a well-covered baseline cannot mask sparse fast-arm coverage.',
    'V1 matching does not equalize stratum frequencies, opening family, session context, color, date, or opponent strength.',
  ];
  if (timingCoveragePercent !== 100) {
    caveats.push('Some derivable user decisions lack current trustworthy timing and are excluded rather than treated as normal-pace evidence.');
  }
  if (ampleClassificationCoveragePercent !== 100) {
    caveats.push('Some trustworthy timed moves lack exact initial-time context, so ample-clock status is unavailable.');
  }
  if (contextCoveragePercent !== 100) {
    caveats.push('Some ample-clock moves lack exact-control or stabilized-phase context and cannot enter the matched comparison.');
  }
  if (matchingCoveragePercent !== 100) {
    caveats.push('Moves in one-sided exact-control/phase strata are excluded because no opposite-arm comparator exists.');
  }
  if (analysisCoveragePercent !== 100) {
    caveats.push('Some matched moves lack current complete engine quality and remain explicit analysis-coverage loss.');
  }
  if (rawAnalysedMatchedUserDecisions > analysedMatchedUserDecisions) {
    caveats.push('Current engine evidence that is one-sided within an exact-control/phase stratum is excluded rather than compared across different strata.');
  }

  return {
    diagnosisId: 'TIME-003',
    policyVersion: PLAYED_TOO_FAST_POLICY_VERSION,
    timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
    timingDerivationVersion: TIMING_DERIVATION_VERSION,
    definitions: {
      fastDecisionMaxCentisecondsInclusive: TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS,
      normalDecisionMinCentisecondsExclusive: TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS,
      ampleClockMinimumCentiseconds: TIME_AMPLE_CLOCK_MIN_CENTISECONDS,
      ampleClockInitialFraction: TIME_AMPLE_CLOCK_INITIAL_FRACTION,
      matchingDimensions: ['EXACT_TIME_CONTROL', 'PHASE'],
    },
    coverage: {
      status,
      reason,
      candidateGames: games.length,
      timingEligibleGames,
      unsupportedGames,
      timingEligibleUserDecisions,
      timingCoveredUserDecisions,
      timingCoveragePercent,
      ampleClockUserDecisions,
      nonAmpleClockUserDecisions,
      unknownAmpleClockUserDecisions,
      ampleClassificationCoveragePercent,
      fastWithoutAmpleClockMoves,
      contextEligibleUserDecisions: contextMoves.length,
      contextCoveragePercent,
      missingExactControlMoves,
      missingPhaseMoves,
      matchedUserDecisions,
      matchingCoveragePercent,
      matchedStrata: matchedBuckets.length,
      unmatchedBaselineMoves,
      unmatchedFastMoves,
      analysedMatchedUserDecisions,
      analysisCoveragePercent,
      maxCandidateGames: PLAYED_TOO_FAST_MAX_CANDIDATE_GAMES,
    },
    recurrence: {
      fastAmpleGames: new Set(fastMoves.map((move) => move.importedGameId)).size,
      baselineGames: new Set(baselineMoves.map((move) => move.importedGameId)).size,
      analysedFastAmpleGames: fastAmple.supportingGames,
      analysedBaselineGames: baseline.supportingGames,
    },
    comparison: {
      baseline,
      fastAmple,
      averageScoreLossDeltaCp: scoreLossDelta,
      majorErrorRateDeltaPercent: delta(
        fastAmple.majorErrorRatePercent,
        baseline.majorErrorRatePercent,
      ),
      blunderRateDeltaPercent: delta(
        fastAmple.blunderRatePercent,
        baseline.blunderRatePercent,
      ),
      evidenceStrength,
      mechanismStatus: mechanismStatus(evidenceStrength, scoreLossDelta),
    },
    strata,
    analysisProvenance: provenanceFor(analysedMoves),
    caveats,
  };
}

export async function getPlayedTooFast(
  appUserId: number,
  scope: PlayedTooFastScope,
  repository: PlayedTooFastRepository,
): Promise<PlayedTooFastResult> {
  validateScope(scope);
  const candidateGames = await repository.countCandidates(appUserId, scope);

  if (candidateGames > PLAYED_TOO_FAST_MAX_CANDIDATE_GAMES) {
    return unavailable(candidateGames, 'played-too-fast-scope-too-large');
  }
  if (candidateGames === 0) return unavailable(0, 'no-candidate-games');

  const games = await repository.loadCandidates(appUserId, scope);
  if (games.length !== candidateGames) {
    return unavailable(candidateGames, 'candidate-set-changed-during-read');
  }

  return buildPlayedTooFastAggregate(games);
}
