import { MoveClassificationCode } from '@why-i-suck-at-chess/chess-domain';
import {
  TIME_BEHAVIOR_POLICY_VERSION,
  TIME_FAST_OPPONENT_SEQUENCE_LENGTH,
  TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS,
  classifyMoveSpeed,
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

export const OPPONENT_MOVE_SPEED_EFFECT_POLICY_VERSION = 'opponent-move-speed-effect-v1';
export const OPPONENT_MOVE_SPEED_EFFECT_MAX_CANDIDATE_GAMES = 5_000;

export interface OpponentMoveSpeedEffectScope {
  from?: Date;
  to?: Date;
}

export type OpponentMoveSpeedEffectPhase = 'OPENING' | 'MIDDLEGAME' | 'ENDGAME';
export type OpponentMoveSpeedEffectArmName = 'BASELINE' | 'EXPOSED';

export interface OpponentMoveSpeedEffectAnalysisRun {
  runId: number;
  snapshotId: string;
  analysisVersion: string;
  settingsHash: string;
  engineName: string | null;
  engineVersion: string | null;
}

export interface OpponentMoveSpeedEffectSourcePly {
  plyNumber: number;
  isUserMove: boolean;
  moveTimeCentiseconds: number | null;
  timingDerivationVersion: number | null;
  timingDerivationStatus: string | null;
  timingReliabilityFlags: readonly string[];
  phase: OpponentMoveSpeedEffectPhase | null;
  scoreLossCp: number | null;
  classificationCode: number | null;
  analysis: OpponentMoveSpeedEffectAnalysisRun | null;
}

export interface OpponentMoveSpeedEffectSourceGame {
  importedGameId: number;
  variant: string | null;
  speedCategory: string | null;
  exactTimeControlKey: string | null;
  timingDerivationVersion: number | null;
  plies: readonly OpponentMoveSpeedEffectSourcePly[];
}

export interface OpponentMoveSpeedEffectRepository {
  countCandidates(appUserId: number, scope: OpponentMoveSpeedEffectScope): Promise<number>;
  loadCandidates(
    appUserId: number,
    scope: OpponentMoveSpeedEffectScope,
  ): Promise<OpponentMoveSpeedEffectSourceGame[]>;
}

export interface OpponentMoveSpeedEffectArm {
  eligibleResponses: number;
  eligibleGames: number;
  averageResponseTimeCentiseconds: number | null;
  analysedResponses: number;
  analysisSupportingGames: number;
  analysisCoveragePercent: number | null;
  averageScoreLossCp: number | null;
  majorErrorRatePercent: number | null;
  blunderRatePercent: number | null;
  requiredTimingCoveragePercent: number | null;
  requiredQualityCoveragePercent: number | null;
}

export interface OpponentMoveSpeedEffectStratumArm {
  eligibleResponses: number;
  supportingGames: number;
  averageResponseTimeCentiseconds: number | null;
  analysedResponses: number;
  analysisSupportingGames: number;
  averageScoreLossCp: number | null;
  majorErrorRatePercent: number | null;
  blunderRatePercent: number | null;
}

export interface OpponentMoveSpeedEffectStratum {
  exactTimeControlKey: string;
  phase: OpponentMoveSpeedEffectPhase;
  baseline: OpponentMoveSpeedEffectStratumArm;
  exposed: OpponentMoveSpeedEffectStratumArm;
}

export interface OpponentMoveSpeedEffectPhaseCompositionArm {
  counts: Record<OpponentMoveSpeedEffectPhase, number>;
  sharesPercent: Record<OpponentMoveSpeedEffectPhase, number | null>;
}

export interface OpponentMoveSpeedEffectRatingComposition {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  reason: string | null;
  result: RatingContextCompositionResult | null;
}

export interface OpponentMoveSpeedEffectResult {
  diagnosisId: 'TIME-007';
  policyVersion: string;
  timeBehaviorPolicyVersion: string;
  timingDerivationVersion: number;
  definitions: {
    fastOpponentMoveMaxCentisecondsInclusive: number;
    fastOpponentSequenceLength: number;
    normalOpponentMoveMinCentisecondsExclusive: number;
    matchingDimensions: ['EXACT_TIME_CONTROL', 'PHASE'];
    responseJoin: 'PRECEDING_PLY';
  };
  coverage: {
    status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
    reason: string | null;
    candidateGames: number;
    timingEligibleGames: number;
    unsupportedGames: number;
    eligibleUserResponses: number;
    precedingOpponentAvailableResponses: number;
    missingPrecedingOpponentMoves: number;
    opponentTimingCoveredResponses: number;
    userTimingCoveredResponses: number;
    timingCoveredResponsePairs: number;
    timingCoveragePercent: number | null;
    contextEligibleResponses: number;
    contextCoveragePercent: number | null;
    missingExactControlResponses: number;
    missingPhaseResponses: number;
    matchedResponses: number;
    matchingCoveragePercent: number | null;
    matchedStrata: number;
    unmatchedBaselineResponses: number;
    unmatchedExposedResponses: number;
    analysedMatchedResponses: number;
    analysisCoveragePercent: number | null;
    maxCandidateGames: number;
  };
  recurrence: {
    baselineGames: number;
    exposedGames: number;
    analysedBaselineGames: number;
    analysedExposedGames: number;
    qualifyingFastOpponentSequences: number;
    exposedResponsesAfterFastSequence: number;
    gamesWithFastOpponentSequence: number;
  };
  comparison: {
    baseline: OpponentMoveSpeedEffectArm;
    exposed: OpponentMoveSpeedEffectArm;
    averageResponseTimeDeltaCentiseconds: number | null;
    averageScoreLossDeltaCp: number | null;
    majorErrorRateDeltaPercent: number | null;
    blunderRateDeltaPercent: number | null;
    evidenceStrength: {
      timing: TimingBehaviorEvidenceStrength;
      quality: TimingBehaviorEvidenceStrength;
    };
  };
  phaseComposition: {
    baseline: OpponentMoveSpeedEffectPhaseCompositionArm;
    exposed: OpponentMoveSpeedEffectPhaseCompositionArm;
    shareDeltaPercentagePoints: Record<OpponentMoveSpeedEffectPhase, number | null>;
    maxShareDeltaPercentagePoints: number | null;
  };
  strata: OpponentMoveSpeedEffectStratum[];
  analysisProvenance: {
    requirement: 'CURRENT_COMPLETE_SOURCE_SNAPSHOT';
    analysedRuns: number;
    snapshotIds: string[];
    analysisVersions: string[];
    settingsHashes: string[];
    engines: Array<{ name: string | null; version: string | null }>;
  };
  ratingComposition: OpponentMoveSpeedEffectRatingComposition;
  caveats: string[];
}

interface ClassifiedResponse extends OpponentMoveSpeedEffectSourcePly {
  importedGameId: number;
  exactTimeControlKey: string;
  phase: OpponentMoveSpeedEffectPhase;
  arm: OpponentMoveSpeedEffectArmName;
  precedingOpponentPlyNumber: number;
  precedingOpponentMoveTimeCentiseconds: number;
  fastOpponentSequenceLength: number;
}

interface StratumBucket {
  exactTimeControlKey: string;
  phase: OpponentMoveSpeedEffectPhase;
  baseline: ClassifiedResponse[];
  exposed: ClassifiedResponse[];
}

interface AggregateDetail {
  result: OpponentMoveSpeedEffectResult;
  baselineGameIds: number[];
  exposedGameIds: number[];
}

const PHASES: readonly OpponentMoveSpeedEffectPhase[] = [
  'OPENING',
  'MIDDLEGAME',
  'ENDGAME',
];

function emptyArm(): OpponentMoveSpeedEffectArm {
  return {
    eligibleResponses: 0,
    eligibleGames: 0,
    averageResponseTimeCentiseconds: null,
    analysedResponses: 0,
    analysisSupportingGames: 0,
    analysisCoveragePercent: null,
    averageScoreLossCp: null,
    majorErrorRatePercent: null,
    blunderRatePercent: null,
    requiredTimingCoveragePercent: null,
    requiredQualityCoveragePercent: null,
  };
}

function emptyPhaseCounts(): Record<OpponentMoveSpeedEffectPhase, number> {
  return { OPENING: 0, MIDDLEGAME: 0, ENDGAME: 0 };
}

function emptyPhaseShares(): Record<OpponentMoveSpeedEffectPhase, number | null> {
  return { OPENING: null, MIDDLEGAME: null, ENDGAME: null };
}

function emptyProvenance(): OpponentMoveSpeedEffectResult['analysisProvenance'] {
  return {
    requirement: 'CURRENT_COMPLETE_SOURCE_SNAPSHOT',
    analysedRuns: 0,
    snapshotIds: [],
    analysisVersions: [],
    settingsHashes: [],
    engines: [],
  };
}

function unavailable(
  candidateGames: number,
  reason: string,
): OpponentMoveSpeedEffectResult {
  return {
    diagnosisId: 'TIME-007',
    policyVersion: OPPONENT_MOVE_SPEED_EFFECT_POLICY_VERSION,
    timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
    timingDerivationVersion: TIMING_DERIVATION_VERSION,
    definitions: {
      fastOpponentMoveMaxCentisecondsInclusive: TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS,
      fastOpponentSequenceLength: TIME_FAST_OPPONENT_SEQUENCE_LENGTH,
      normalOpponentMoveMinCentisecondsExclusive: TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS,
      matchingDimensions: ['EXACT_TIME_CONTROL', 'PHASE'],
      responseJoin: 'PRECEDING_PLY',
    },
    coverage: {
      status: 'UNAVAILABLE',
      reason,
      candidateGames,
      timingEligibleGames: 0,
      unsupportedGames: 0,
      eligibleUserResponses: 0,
      precedingOpponentAvailableResponses: 0,
      missingPrecedingOpponentMoves: 0,
      opponentTimingCoveredResponses: 0,
      userTimingCoveredResponses: 0,
      timingCoveredResponsePairs: 0,
      timingCoveragePercent: null,
      contextEligibleResponses: 0,
      contextCoveragePercent: null,
      missingExactControlResponses: 0,
      missingPhaseResponses: 0,
      matchedResponses: 0,
      matchingCoveragePercent: null,
      matchedStrata: 0,
      unmatchedBaselineResponses: 0,
      unmatchedExposedResponses: 0,
      analysedMatchedResponses: 0,
      analysisCoveragePercent: null,
      maxCandidateGames: OPPONENT_MOVE_SPEED_EFFECT_MAX_CANDIDATE_GAMES,
    },
    recurrence: {
      baselineGames: 0,
      exposedGames: 0,
      analysedBaselineGames: 0,
      analysedExposedGames: 0,
      qualifyingFastOpponentSequences: 0,
      exposedResponsesAfterFastSequence: 0,
      gamesWithFastOpponentSequence: 0,
    },
    comparison: {
      baseline: emptyArm(),
      exposed: emptyArm(),
      averageResponseTimeDeltaCentiseconds: null,
      averageScoreLossDeltaCp: null,
      majorErrorRateDeltaPercent: null,
      blunderRateDeltaPercent: null,
      evidenceStrength: {
        timing: 'INSUFFICIENT',
        quality: 'INSUFFICIENT',
      },
    },
    phaseComposition: {
      baseline: { counts: emptyPhaseCounts(), sharesPercent: emptyPhaseShares() },
      exposed: { counts: emptyPhaseCounts(), sharesPercent: emptyPhaseShares() },
      shareDeltaPercentagePoints: emptyPhaseShares(),
      maxShareDeltaPercentagePoints: null,
    },
    strata: [],
    analysisProvenance: emptyProvenance(),
    ratingComposition: {
      status: 'UNAVAILABLE',
      reason: 'comparison-unavailable',
      result: null,
    },
    caveats: [
      'No opponent-move-speed comparison is available from this aggregate.',
      'TIME-007 is correlational and does not infer panic, premove intent, opening familiarity, or another psychological or causal explanation.',
    ],
  };
}

function validateScope(scope: OpponentMoveSpeedEffectScope): void {
  for (const value of [scope.from, scope.to]) {
    if (value && !Number.isFinite(value.getTime())) {
      throw new RangeError('Opponent-move-speed scope contains an invalid date.');
    }
  }
  if (scope.from && scope.to && scope.from.getTime() >= scope.to.getTime()) {
    throw new RangeError('Opponent-move-speed scope "from" must be earlier than "to".');
  }
}

function trustworthyTimingPly(
  game: OpponentMoveSpeedEffectSourceGame,
  ply: OpponentMoveSpeedEffectSourcePly,
): boolean {
  return game.timingDerivationVersion === TIMING_DERIVATION_VERSION
    && ply.plyNumber > 2
    && ply.timingDerivationVersion === TIMING_DERIVATION_VERSION
    && ply.timingDerivationStatus === 'AVAILABLE'
    && typeof ply.moveTimeCentiseconds === 'number'
    && Number.isFinite(ply.moveTimeCentiseconds)
    && ply.moveTimeCentiseconds >= 0
    && !ply.timingReliabilityFlags.includes('POSSIBLE_EXTERNAL_CLOCK_ADJUSTMENT');
}

function analysed(move: ClassifiedResponse): boolean {
  return Boolean(
    move.analysis
    && typeof move.scoreLossCp === 'number'
    && Number.isFinite(move.scoreLossCp)
    && move.scoreLossCp >= 0,
  );
}

function majorError(move: ClassifiedResponse): boolean {
  return move.classificationCode === MoveClassificationCode.Mistake
    || move.classificationCode === MoveClassificationCode.Blunder;
}

function blunder(move: ClassifiedResponse): boolean {
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
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return Math.min(...values as number[]);
}

function stratumKey(
  exactTimeControlKey: string,
  phase: OpponentMoveSpeedEffectPhase,
): string {
  return JSON.stringify([exactTimeControlKey, phase]);
}

function sortStrata(
  left: OpponentMoveSpeedEffectStratum,
  right: OpponentMoveSpeedEffectStratum,
): number {
  const control = left.exactTimeControlKey.localeCompare(right.exactTimeControlKey);
  if (control !== 0) return control;
  return PHASES.indexOf(left.phase) - PHASES.indexOf(right.phase);
}

function summarizeStratumArm(
  moves: readonly ClassifiedResponse[],
): OpponentMoveSpeedEffectStratumArm {
  const analysedMoves = moves.filter(analysed);
  return {
    eligibleResponses: moves.length,
    supportingGames: new Set(moves.map((move) => move.importedGameId)).size,
    averageResponseTimeCentiseconds: average(
      moves.map((move) => move.moveTimeCentiseconds as number),
    ),
    analysedResponses: analysedMoves.length,
    analysisSupportingGames: new Set(
      analysedMoves.map((move) => move.importedGameId),
    ).size,
    averageScoreLossCp: average(
      analysedMoves.map((move) => move.scoreLossCp as number),
    ),
    majorErrorRatePercent: timingBehaviorPercentage(
      analysedMoves.filter(majorError).length,
      analysedMoves.length,
    ),
    blunderRatePercent: timingBehaviorPercentage(
      analysedMoves.filter(blunder).length,
      analysedMoves.length,
    ),
  };
}

function summarizeArm(
  moves: readonly ClassifiedResponse[],
  qualityComparisonMoves: readonly ClassifiedResponse[],
  requiredTimingCoverage: readonly (number | null)[],
): OpponentMoveSpeedEffectArm {
  const analysisCoveragePercent = timingBehaviorPercentage(
    qualityComparisonMoves.length,
    moves.length,
  );
  const requiredTimingCoveragePercent = minimumCoverage(requiredTimingCoverage);
  const requiredQualityCoveragePercent = minimumCoverage([
    ...requiredTimingCoverage,
    analysisCoveragePercent,
  ]);

  return {
    eligibleResponses: moves.length,
    eligibleGames: new Set(moves.map((move) => move.importedGameId)).size,
    averageResponseTimeCentiseconds: average(
      moves.map((move) => move.moveTimeCentiseconds as number),
    ),
    analysedResponses: qualityComparisonMoves.length,
    analysisSupportingGames: new Set(
      qualityComparisonMoves.map((move) => move.importedGameId),
    ).size,
    analysisCoveragePercent,
    averageScoreLossCp: average(
      qualityComparisonMoves.map((move) => move.scoreLossCp as number),
    ),
    majorErrorRatePercent: timingBehaviorPercentage(
      qualityComparisonMoves.filter(majorError).length,
      qualityComparisonMoves.length,
    ),
    blunderRatePercent: timingBehaviorPercentage(
      qualityComparisonMoves.filter(blunder).length,
      qualityComparisonMoves.length,
    ),
    requiredTimingCoveragePercent,
    requiredQualityCoveragePercent,
  };
}

function phaseComposition(
  moves: readonly ClassifiedResponse[],
): OpponentMoveSpeedEffectPhaseCompositionArm {
  const counts = emptyPhaseCounts();
  for (const move of moves) counts[move.phase] += 1;
  const sharesPercent = emptyPhaseShares();
  for (const phase of PHASES) {
    sharesPercent[phase] = timingBehaviorPercentage(counts[phase], moves.length);
  }
  return { counts, sharesPercent };
}

function phaseComparison(
  baselineMoves: readonly ClassifiedResponse[],
  exposedMoves: readonly ClassifiedResponse[],
): OpponentMoveSpeedEffectResult['phaseComposition'] {
  const baseline = phaseComposition(baselineMoves);
  const exposed = phaseComposition(exposedMoves);
  const shareDeltaPercentagePoints = emptyPhaseShares();
  const absoluteDeltas: number[] = [];
  for (const phase of PHASES) {
    const value = delta(exposed.sharesPercent[phase], baseline.sharesPercent[phase]);
    shareDeltaPercentagePoints[phase] = value;
    if (value !== null) absoluteDeltas.push(Math.abs(value));
  }
  return {
    baseline,
    exposed,
    shareDeltaPercentagePoints,
    maxShareDeltaPercentagePoints: absoluteDeltas.length > 0
      ? roundTimingBehaviorMetric(Math.max(...absoluteDeltas))
      : null,
  };
}

function provenanceFor(
  moves: readonly ClassifiedResponse[],
): OpponentMoveSpeedEffectResult['analysisProvenance'] {
  const runById = new Map<number, OpponentMoveSpeedEffectAnalysisRun>();
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

function fastSequenceLengthEndingAt(
  game: OpponentMoveSpeedEffectSourceGame,
  byPly: ReadonlyMap<number, OpponentMoveSpeedEffectSourcePly>,
  opponentPly: OpponentMoveSpeedEffectSourcePly,
): number {
  let length = 0;
  for (let plyNumber = opponentPly.plyNumber; plyNumber > 2; plyNumber -= 2) {
    const ply = byPly.get(plyNumber);
    if (
      !ply
      || ply.isUserMove
      || !trustworthyTimingPly(game, ply)
      || classifyMoveSpeed(ply.moveTimeCentiseconds) !== 'FAST'
    ) {
      break;
    }
    length += 1;
  }
  return length;
}

function countFastSequences(
  game: OpponentMoveSpeedEffectSourceGame,
): { sequences: number; hasSequence: boolean } {
  const opponentPlies = [...game.plies]
    .filter((ply) => !ply.isUserMove)
    .sort((left, right) => left.plyNumber - right.plyNumber);
  let run = 0;
  let previousPlyNumber: number | null = null;
  let sequences = 0;

  for (const ply of opponentPlies) {
    const consecutive = previousPlyNumber !== null
      && ply.plyNumber === previousPlyNumber + 2;
    if (!consecutive) run = 0;

    if (
      trustworthyTimingPly(game, ply)
      && classifyMoveSpeed(ply.moveTimeCentiseconds) === 'FAST'
    ) {
      run += 1;
      if (run === TIME_FAST_OPPONENT_SEQUENCE_LENGTH) sequences += 1;
    } else {
      run = 0;
    }
    previousPlyNumber = ply.plyNumber;
  }

  return { sequences, hasSequence: sequences > 0 };
}

function buildAggregateDetail(
  games: readonly OpponentMoveSpeedEffectSourceGame[],
): AggregateDetail {
  if (games.length === 0) {
    return {
      result: unavailable(0, 'no-candidate-games'),
      baselineGameIds: [],
      exposedGameIds: [],
    };
  }

  const seenGames = new Set<number>();
  for (const game of games) {
    if (seenGames.has(game.importedGameId)) {
      return {
        result: unavailable(games.length, 'duplicate-candidate-game-row'),
        baselineGameIds: [],
        exposedGameIds: [],
      };
    }
    seenGames.add(game.importedGameId);

    const seenPlies = new Set<number>();
    for (const ply of game.plies) {
      if (seenPlies.has(ply.plyNumber)) {
        return {
          result: unavailable(games.length, 'duplicate-ply-number-in-candidate-game'),
          baselineGameIds: [],
          exposedGameIds: [],
        };
      }
      seenPlies.add(ply.plyNumber);
    }
  }

  let timingEligibleGames = 0;
  let unsupportedGames = 0;
  let eligibleUserResponses = 0;
  let precedingOpponentAvailableResponses = 0;
  let missingPrecedingOpponentMoves = 0;
  let opponentTimingCoveredResponses = 0;
  let userTimingCoveredResponses = 0;
  let timingCoveredResponsePairs = 0;
  let missingExactControlResponses = 0;
  let missingPhaseResponses = 0;
  let qualifyingFastOpponentSequences = 0;
  let exposedResponsesAfterFastSequence = 0;
  let gamesWithFastOpponentSequence = 0;
  let baselineTimedResponses = 0;
  let exposedTimedResponses = 0;
  const contextResponses: ClassifiedResponse[] = [];

  for (const game of games) {
    if (!isTimingEligibleGame(game)) {
      unsupportedGames += 1;
      continue;
    }
    timingEligibleGames += 1;

    const byPly = new Map(
      [...game.plies]
        .sort((left, right) => left.plyNumber - right.plyNumber)
        .map((ply) => [ply.plyNumber, ply] as const),
    );
    const sequenceSummary = countFastSequences(game);
    qualifyingFastOpponentSequences += sequenceSummary.sequences;
    if (sequenceSummary.hasSequence) gamesWithFastOpponentSequence += 1;

    for (const userMove of [...game.plies]
      .filter((ply) => ply.isUserMove && ply.plyNumber > 2)
      .sort((left, right) => left.plyNumber - right.plyNumber)) {
      eligibleUserResponses += 1;
      const opponentMove = byPly.get(userMove.plyNumber - 1);
      if (!opponentMove || opponentMove.isUserMove) {
        missingPrecedingOpponentMoves += 1;
        continue;
      }
      precedingOpponentAvailableResponses += 1;

      const opponentTimingCovered = trustworthyTimingPly(game, opponentMove);
      const userTimingCovered = trustworthyTimingPly(game, userMove);
      if (opponentTimingCovered) opponentTimingCoveredResponses += 1;
      if (userTimingCovered) userTimingCoveredResponses += 1;
      if (!opponentTimingCovered || !userTimingCovered) continue;
      timingCoveredResponsePairs += 1;

      const opponentSpeed = classifyMoveSpeed(opponentMove.moveTimeCentiseconds);
      if (!opponentSpeed) continue;
      const arm: OpponentMoveSpeedEffectArmName = opponentSpeed === 'FAST'
        ? 'EXPOSED'
        : 'BASELINE';
      if (arm === 'EXPOSED') exposedTimedResponses += 1;
      else baselineTimedResponses += 1;

      const sequenceLength = arm === 'EXPOSED'
        ? fastSequenceLengthEndingAt(game, byPly, opponentMove)
        : 0;
      if (sequenceLength >= TIME_FAST_OPPONENT_SEQUENCE_LENGTH) {
        exposedResponsesAfterFastSequence += 1;
      }

      if (!game.exactTimeControlKey) {
        missingExactControlResponses += 1;
        continue;
      }
      if (!userMove.phase) {
        missingPhaseResponses += 1;
        continue;
      }

      contextResponses.push({
        ...userMove,
        importedGameId: game.importedGameId,
        exactTimeControlKey: game.exactTimeControlKey,
        phase: userMove.phase,
        arm,
        precedingOpponentPlyNumber: opponentMove.plyNumber,
        precedingOpponentMoveTimeCentiseconds: opponentMove.moveTimeCentiseconds as number,
        fastOpponentSequenceLength: sequenceLength,
      });
    }
  }

  const timingCoveragePercent = timingBehaviorPercentage(
    timingCoveredResponsePairs,
    eligibleUserResponses,
  );
  const contextCoveragePercent = timingBehaviorPercentage(
    contextResponses.length,
    timingCoveredResponsePairs,
  );

  const contextBaseline = contextResponses.filter((move) => move.arm === 'BASELINE');
  const contextExposed = contextResponses.filter((move) => move.arm === 'EXPOSED');
  const baselineContextCoveragePercent = timingBehaviorPercentage(
    contextBaseline.length,
    baselineTimedResponses,
  );
  const exposedContextCoveragePercent = timingBehaviorPercentage(
    contextExposed.length,
    exposedTimedResponses,
  );

  const buckets = new Map<string, StratumBucket>();
  for (const response of contextResponses) {
    const key = stratumKey(response.exactTimeControlKey, response.phase);
    const bucket = buckets.get(key) ?? {
      exactTimeControlKey: response.exactTimeControlKey,
      phase: response.phase,
      baseline: [],
      exposed: [],
    };
    if (response.arm === 'BASELINE') bucket.baseline.push(response);
    else bucket.exposed.push(response);
    buckets.set(key, bucket);
  }

  const matchedBuckets = [...buckets.values()].filter(
    (bucket) => bucket.baseline.length > 0 && bucket.exposed.length > 0,
  );
  const unmatchedBaselineResponses = [...buckets.values()]
    .filter((bucket) => bucket.exposed.length === 0)
    .reduce((sum, bucket) => sum + bucket.baseline.length, 0);
  const unmatchedExposedResponses = [...buckets.values()]
    .filter((bucket) => bucket.baseline.length === 0)
    .reduce((sum, bucket) => sum + bucket.exposed.length, 0);

  const baselineMoves = matchedBuckets.flatMap((bucket) => bucket.baseline);
  const exposedMoves = matchedBuckets.flatMap((bucket) => bucket.exposed);
  const matchedResponses = baselineMoves.length + exposedMoves.length;
  const matchingCoveragePercent = timingBehaviorPercentage(
    matchedResponses,
    contextResponses.length,
  );
  const baselineMatchingCoveragePercent = timingBehaviorPercentage(
    baselineMoves.length,
    contextBaseline.length,
  );
  const exposedMatchingCoveragePercent = timingBehaviorPercentage(
    exposedMoves.length,
    contextExposed.length,
  );

  const qualityMatchedBuckets = matchedBuckets.filter(
    (bucket) => bucket.baseline.some(analysed) && bucket.exposed.some(analysed),
  );
  const analysedBaselineMoves = qualityMatchedBuckets
    .flatMap((bucket) => bucket.baseline)
    .filter(analysed);
  const analysedExposedMoves = qualityMatchedBuckets
    .flatMap((bucket) => bucket.exposed)
    .filter(analysed);

  const baseline = summarizeArm(
    baselineMoves,
    analysedBaselineMoves,
    [
      timingCoveragePercent,
      baselineContextCoveragePercent,
      baselineMatchingCoveragePercent,
    ],
  );
  const exposed = summarizeArm(
    exposedMoves,
    analysedExposedMoves,
    [
      timingCoveragePercent,
      exposedContextCoveragePercent,
      exposedMatchingCoveragePercent,
    ],
  );

  const analysedMatchedResponses = baseline.analysedResponses + exposed.analysedResponses;
  const analysisCoveragePercent = timingBehaviorPercentage(
    analysedMatchedResponses,
    matchedResponses,
  );

  let status: OpponentMoveSpeedEffectResult['coverage']['status'];
  let reason: string | null;
  if (timingEligibleGames === 0 || eligibleUserResponses === 0) {
    status = 'UNAVAILABLE';
    reason = 'no-timing-eligible-user-responses';
  } else if (timingCoveredResponsePairs === 0) {
    status = 'UNAVAILABLE';
    reason = 'paired-timing-evidence-unavailable';
  } else if (contextResponses.length === 0) {
    status = 'UNAVAILABLE';
    reason = 'comparison-context-unavailable';
  } else if (matchedBuckets.length === 0) {
    status = 'UNAVAILABLE';
    reason = 'no-matched-opponent-speed-strata';
  } else {
    const complete = timingCoveredResponsePairs === eligibleUserResponses
      && contextResponses.length === timingCoveredResponsePairs
      && matchedResponses === contextResponses.length
      && analysedMatchedResponses === matchedResponses;
    status = complete ? 'COMPLETE' : 'PARTIAL';
    reason = complete
      ? null
      : timingCoveredResponsePairs !== eligibleUserResponses
        ? 'paired-timing-coverage-incomplete'
        : contextResponses.length !== timingCoveredResponsePairs
          ? 'comparison-context-incomplete'
          : matchedResponses !== contextResponses.length
            ? 'unmatched-comparison-context'
            : 'engine-analysis-incomplete';
  }

  const timingEvidenceStrength = comparativeTimingBehaviorEvidenceStrength(
    {
      supportingGames: baseline.eligibleGames,
      requiredEvidenceCoveragePercent: baseline.requiredTimingCoveragePercent,
    },
    {
      supportingGames: exposed.eligibleGames,
      requiredEvidenceCoveragePercent: exposed.requiredTimingCoveragePercent,
    },
  );
  const qualityEvidenceStrength = comparativeTimingBehaviorEvidenceStrength(
    {
      supportingGames: baseline.analysisSupportingGames,
      requiredEvidenceCoveragePercent: baseline.requiredQualityCoveragePercent,
    },
    {
      supportingGames: exposed.analysisSupportingGames,
      requiredEvidenceCoveragePercent: exposed.requiredQualityCoveragePercent,
    },
  );

  const qualityMoves = [...analysedBaselineMoves, ...analysedExposedMoves];
  const strata = matchedBuckets.map<OpponentMoveSpeedEffectStratum>((bucket) => ({
    exactTimeControlKey: bucket.exactTimeControlKey,
    phase: bucket.phase,
    baseline: summarizeStratumArm(bucket.baseline),
    exposed: summarizeStratumArm(bucket.exposed),
  })).sort(sortStrata);

  const caveats = [
    'TIME-007 compares user responses after unusually fast opponent moves with responses after normal-speed opponent moves matched by exact time control and stabilized phase.',
    'The immediately preceding opponent move is joined by exact ply number and mover identity; missing or unreliable timing on either side excludes that response rather than being inferred from neighboring array order.',
    'Only current complete engine analysis from the same ply-index snapshot contributes quality metrics; response-time evidence remains separately reportable when engine evidence is incomplete.',
    'Fast-opponent sequence context means at least two consecutive trustworthy opponent decisions at or below the shared one-second threshold; it does not infer premove intent.',
    'The result is correlational. Fast opponent play may proxy opening familiarity, exact-control effects, opponent strength, or other context and does not establish panic or another psychological cause.',
    'V1 matching preserves exact control and phase but does not equalize stratum frequencies, opening family, session context, color, date, or opponent strength.',
  ];
  if (timingCoveragePercent !== 100) {
    caveats.push('Some user responses lack a trustworthy immediately preceding opponent move time, trustworthy user response time, or the exact preceding opponent ply and remain explicit timing-coverage loss.');
  }
  if (contextCoveragePercent !== 100) {
    caveats.push('Some paired timed responses lack exact-control or stabilized-phase context and cannot enter the matched comparison.');
  }
  if (matchingCoveragePercent !== 100) {
    caveats.push('Responses in one-sided exact-control/phase strata are excluded because no opposite-arm comparator exists.');
  }
  if (analysisCoveragePercent !== 100) {
    caveats.push('Some matched responses lack comparable current complete engine quality and remain explicit analysis-coverage loss.');
  }

  const result: OpponentMoveSpeedEffectResult = {
    diagnosisId: 'TIME-007',
    policyVersion: OPPONENT_MOVE_SPEED_EFFECT_POLICY_VERSION,
    timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
    timingDerivationVersion: TIMING_DERIVATION_VERSION,
    definitions: {
      fastOpponentMoveMaxCentisecondsInclusive: TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS,
      fastOpponentSequenceLength: TIME_FAST_OPPONENT_SEQUENCE_LENGTH,
      normalOpponentMoveMinCentisecondsExclusive: TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS,
      matchingDimensions: ['EXACT_TIME_CONTROL', 'PHASE'],
      responseJoin: 'PRECEDING_PLY',
    },
    coverage: {
      status,
      reason,
      candidateGames: games.length,
      timingEligibleGames,
      unsupportedGames,
      eligibleUserResponses,
      precedingOpponentAvailableResponses,
      missingPrecedingOpponentMoves,
      opponentTimingCoveredResponses,
      userTimingCoveredResponses,
      timingCoveredResponsePairs,
      timingCoveragePercent,
      contextEligibleResponses: contextResponses.length,
      contextCoveragePercent,
      missingExactControlResponses,
      missingPhaseResponses,
      matchedResponses,
      matchingCoveragePercent,
      matchedStrata: matchedBuckets.length,
      unmatchedBaselineResponses,
      unmatchedExposedResponses,
      analysedMatchedResponses,
      analysisCoveragePercent,
      maxCandidateGames: OPPONENT_MOVE_SPEED_EFFECT_MAX_CANDIDATE_GAMES,
    },
    recurrence: {
      baselineGames: baseline.eligibleGames,
      exposedGames: exposed.eligibleGames,
      analysedBaselineGames: baseline.analysisSupportingGames,
      analysedExposedGames: exposed.analysisSupportingGames,
      qualifyingFastOpponentSequences,
      exposedResponsesAfterFastSequence,
      gamesWithFastOpponentSequence,
    },
    comparison: {
      baseline,
      exposed,
      averageResponseTimeDeltaCentiseconds: delta(
        exposed.averageResponseTimeCentiseconds,
        baseline.averageResponseTimeCentiseconds,
      ),
      averageScoreLossDeltaCp: delta(
        exposed.averageScoreLossCp,
        baseline.averageScoreLossCp,
      ),
      majorErrorRateDeltaPercent: delta(
        exposed.majorErrorRatePercent,
        baseline.majorErrorRatePercent,
      ),
      blunderRateDeltaPercent: delta(
        exposed.blunderRatePercent,
        baseline.blunderRatePercent,
      ),
      evidenceStrength: {
        timing: timingEvidenceStrength,
        quality: qualityEvidenceStrength,
      },
    },
    phaseComposition: phaseComparison(baselineMoves, exposedMoves),
    strata,
    analysisProvenance: provenanceFor(qualityMoves),
    ratingComposition: {
      status: 'UNAVAILABLE',
      reason: 'rating-context-requires-service-composition',
      result: null,
    },
    caveats,
  };

  return {
    result,
    baselineGameIds: [...new Set(
      baselineMoves.map((move) => move.importedGameId),
    )].sort((left, right) => left - right),
    exposedGameIds: [...new Set(
      exposedMoves.map((move) => move.importedGameId),
    )].sort((left, right) => left - right),
  };
}

export function buildOpponentMoveSpeedEffectAggregate(
  games: readonly OpponentMoveSpeedEffectSourceGame[],
): OpponentMoveSpeedEffectResult {
  return buildAggregateDetail(games).result;
}

export async function getOpponentMoveSpeedEffect(
  appUserId: number,
  scope: OpponentMoveSpeedEffectScope,
  repository: OpponentMoveSpeedEffectRepository,
  ratingRepository: RatingContextCompositionRepository,
): Promise<OpponentMoveSpeedEffectResult> {
  validateScope(scope);
  const candidateGames = await repository.countCandidates(appUserId, scope);

  if (candidateGames > OPPONENT_MOVE_SPEED_EFFECT_MAX_CANDIDATE_GAMES) {
    return unavailable(candidateGames, 'opponent-move-speed-scope-too-large');
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
        reason: 'opponent-speed-comparison-unavailable',
        result: null,
      },
    };
  }

  if (detail.baselineGameIds.length === 0 || detail.exposedGameIds.length === 0) {
    return {
      ...detail.result,
      ratingComposition: {
        status: 'UNAVAILABLE',
        reason: 'insufficient-comparison-game-arms',
        result: null,
      },
    };
  }

  const baselineSet = new Set(detail.baselineGameIds);
  if (detail.exposedGameIds.some((id) => baselineSet.has(id))) {
    return {
      ...detail.result,
      ratingComposition: {
        status: 'UNAVAILABLE',
        reason: 'comparison-game-arms-overlap',
        result: null,
      },
      caveats: [
        ...detail.result.caveats,
        'RATING-002 is not attached because at least one game contributes matched responses to both opponent-speed arms, while the reusable rating-composition contract requires disjoint game-ID arms.',
      ],
    };
  }

  const ratingResult = await getRatingContextComposition(
    appUserId,
    {
      left: { importedGameIds: detail.baselineGameIds },
      right: { importedGameIds: detail.exposedGameIds },
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
      'When attached, RATING-002 is a separate opponent-strength composition disclosure and does not alter response-time or move-quality deltas.',
    ],
  };
}
