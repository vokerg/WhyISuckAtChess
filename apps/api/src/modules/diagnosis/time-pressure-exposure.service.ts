import {
  TIME_BEHAVIOR_POLICY_VERSION,
  classifyRemainingClock,
  roundTimingBehaviorMetric,
  timingBehaviorEvidenceStrength,
  timingBehaviorPercentage,
  type RemainingClockBand,
  type TimingBehaviorEvidenceStrength,
} from '../timing/time-behavior-policy';
import {
  TIMING_DERIVATION_VERSION,
  isTimingEligibleGame,
} from '../timing/timing-policy';

export const TIME_PRESSURE_EXPOSURE_POLICY_VERSION = 'time-pressure-exposure-v1';
export const TIME_PRESSURE_EXPOSURE_MAX_CANDIDATE_GAMES = 5_000;

export interface TimePressureExposureScope {
  from?: Date;
  to?: Date;
}

export type TimePressurePhase = 'OPENING' | 'MIDDLEGAME' | 'ENDGAME';

export interface TimePressureSourceMove {
  plyNumber: number;
  clockBeforeMoveCentiseconds: number | null;
  timingDerivationVersion: number | null;
  timingDerivationStatus: string | null;
  timingReliabilityFlags: readonly string[];
  phase: TimePressurePhase | null;
}

export interface TimePressureSourceGame {
  importedGameId: number;
  variant: string | null;
  speedCategory: string | null;
  exactTimeControlKey: string | null;
  timeControlInitial: number | null;
  timeControlIncrement: number | null;
  timingDerivationVersion: number | null;
  userMoves: readonly TimePressureSourceMove[];
}

export interface TimePressureExposureRepository {
  countCandidates(appUserId: number, scope: TimePressureExposureScope): Promise<number>;
  loadCandidates(
    appUserId: number,
    scope: TimePressureExposureScope,
  ): Promise<TimePressureSourceGame[]>;
}

export type TimePressureExposureExclusionReason =
  | 'UNSUPPORTED_GAME'
  | 'CURRENT_TIMING_DERIVATION_UNAVAILABLE'
  | 'NO_DERIVABLE_USER_DECISIONS'
  | 'USER_TIMING_INCOMPLETE_OR_UNRELIABLE';

export interface TimePressureBandSummary {
  moves: number;
  games: number;
  moveRatePercent: number | null;
  gameRatePercent: number | null;
}

export interface TimePressureContextBreakdown {
  exactTimeControlKey: string | null;
  initialSeconds: number | null;
  incrementSeconds: number | null;
  timingCoveredGames: number;
  pressureEnteringGames: number;
  pressureEntryRatePercent: number | null;
  eligibleUserDecisions: number;
  pressureMoves: number;
  pressureMoveRatePercent: number | null;
}

export interface TimePressureExposureResult {
  diagnosisId: 'TIME-001';
  policyVersion: string;
  timeBehaviorPolicyVersion: string;
  timingDerivationVersion: number;
  coverage: {
    status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
    reason: string | null;
    candidateGames: number;
    eligibleGames: number;
    timingCoveredGames: number;
    timingCoveragePercent: number | null;
    excludedByReason: Record<TimePressureExposureExclusionReason, number>;
    maxCandidateGames: number;
  };
  exposure: {
    eligibleUserDecisions: number;
    pressureMoves: number;
    pressureMoveRatePercent: number | null;
    pressureEnteringGames: number;
    pressureEntryRatePercent: number | null;
    bands: Record<RemainingClockBand, TimePressureBandSummary>;
    firstEntry: {
      games: number;
      averagePly: number | null;
      earliestPly: number | null;
      latestPly: number | null;
      plyCounts: Array<{ plyNumber: number; games: number }>;
      phaseCoveredGames: number;
      phaseCoveragePercent: number | null;
      phaseCounts: Record<TimePressurePhase | 'UNKNOWN', number>;
    };
    evidenceStrength: TimingBehaviorEvidenceStrength;
  };
  contextBreakdown: TimePressureContextBreakdown[];
  caveats: string[];
}

interface CoveredGame {
  game: TimePressureSourceGame;
  moves: Array<TimePressureSourceMove & { band: RemainingClockBand }>;
}

interface ContextAccumulator {
  exactTimeControlKey: string | null;
  initialSeconds: number | null;
  incrementSeconds: number | null;
  timingCoveredGames: number;
  pressureEnteringGames: number;
  eligibleUserDecisions: number;
  pressureMoves: number;
}

const BAND_ORDER: readonly RemainingClockBand[] = ['CRITICAL', 'PRESSURE', 'NORMAL'];
const PHASE_ORDER: readonly TimePressurePhase[] = ['OPENING', 'MIDDLEGAME', 'ENDGAME'];

function emptyExclusions(): Record<TimePressureExposureExclusionReason, number> {
  return {
    UNSUPPORTED_GAME: 0,
    CURRENT_TIMING_DERIVATION_UNAVAILABLE: 0,
    NO_DERIVABLE_USER_DECISIONS: 0,
    USER_TIMING_INCOMPLETE_OR_UNRELIABLE: 0,
  };
}

function emptyBandSummary(): Record<RemainingClockBand, TimePressureBandSummary> {
  return {
    CRITICAL: { moves: 0, games: 0, moveRatePercent: null, gameRatePercent: null },
    PRESSURE: { moves: 0, games: 0, moveRatePercent: null, gameRatePercent: null },
    NORMAL: { moves: 0, games: 0, moveRatePercent: null, gameRatePercent: null },
  };
}

function emptyPhaseCounts(): Record<TimePressurePhase | 'UNKNOWN', number> {
  return {
    OPENING: 0,
    MIDDLEGAME: 0,
    ENDGAME: 0,
    UNKNOWN: 0,
  };
}

function unavailable(candidateGames: number, reason: string): TimePressureExposureResult {
  return {
    diagnosisId: 'TIME-001',
    policyVersion: TIME_PRESSURE_EXPOSURE_POLICY_VERSION,
    timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
    timingDerivationVersion: TIMING_DERIVATION_VERSION,
    coverage: {
      status: 'UNAVAILABLE',
      reason,
      candidateGames,
      eligibleGames: 0,
      timingCoveredGames: 0,
      timingCoveragePercent: null,
      excludedByReason: emptyExclusions(),
      maxCandidateGames: TIME_PRESSURE_EXPOSURE_MAX_CANDIDATE_GAMES,
    },
    exposure: {
      eligibleUserDecisions: 0,
      pressureMoves: 0,
      pressureMoveRatePercent: null,
      pressureEnteringGames: 0,
      pressureEntryRatePercent: null,
      bands: emptyBandSummary(),
      firstEntry: {
        games: 0,
        averagePly: null,
        earliestPly: null,
        latestPly: null,
        plyCounts: [],
        phaseCoveredGames: 0,
        phaseCoveragePercent: null,
        phaseCounts: emptyPhaseCounts(),
      },
      evidenceStrength: 'INSUFFICIENT',
    },
    contextBreakdown: [],
    caveats: [
      'No time-pressure exposure conclusion is available from this aggregate.',
      'TIME-001 measures exposure only and does not imply move-quality deterioration, panic, tilt, or causality.',
    ],
  };
}

function trustworthyMove(move: TimePressureSourceMove): boolean {
  return move.plyNumber > 2
    && move.timingDerivationVersion === TIMING_DERIVATION_VERSION
    && move.timingDerivationStatus === 'AVAILABLE'
    && typeof move.clockBeforeMoveCentiseconds === 'number'
    && Number.isFinite(move.clockBeforeMoveCentiseconds)
    && move.clockBeforeMoveCentiseconds >= 0
    && !move.timingReliabilityFlags.includes('POSSIBLE_EXTERNAL_CLOCK_ADJUSTMENT');
}

function coveredGame(
  game: TimePressureSourceGame,
): { covered: CoveredGame | null; reason: TimePressureExposureExclusionReason | null } {
  if (!isTimingEligibleGame(game)) {
    return { covered: null, reason: 'UNSUPPORTED_GAME' };
  }
  if (game.timingDerivationVersion !== TIMING_DERIVATION_VERSION) {
    return { covered: null, reason: 'CURRENT_TIMING_DERIVATION_UNAVAILABLE' };
  }

  const expectedMoves = [...game.userMoves]
    .filter((move) => move.plyNumber > 2)
    .sort((left, right) => left.plyNumber - right.plyNumber);
  if (expectedMoves.length === 0) {
    return { covered: null, reason: 'NO_DERIVABLE_USER_DECISIONS' };
  }
  if (expectedMoves.some((move) => !trustworthyMove(move))) {
    return { covered: null, reason: 'USER_TIMING_INCOMPLETE_OR_UNRELIABLE' };
  }

  const moves = expectedMoves.map((move) => {
    const band = classifyRemainingClock(move.clockBeforeMoveCentiseconds);
    if (band === null) {
      throw new Error('Trustworthy before-move clock unexpectedly failed classification');
    }
    return { ...move, band };
  });

  return { covered: { game, moves }, reason: null };
}

function contextKey(game: TimePressureSourceGame): string {
  return JSON.stringify([
    game.exactTimeControlKey,
    game.timeControlInitial,
    game.timeControlIncrement,
  ]);
}

function compareContext(left: TimePressureContextBreakdown, right: TimePressureContextBreakdown): number {
  const leftKey = left.exactTimeControlKey ?? '\uffff';
  const rightKey = right.exactTimeControlKey ?? '\uffff';
  const keyCompare = leftKey.localeCompare(rightKey);
  if (keyCompare !== 0) return keyCompare;

  const initialCompare = (left.initialSeconds ?? Number.MAX_SAFE_INTEGER)
    - (right.initialSeconds ?? Number.MAX_SAFE_INTEGER);
  if (initialCompare !== 0) return initialCompare;
  return (left.incrementSeconds ?? Number.MAX_SAFE_INTEGER)
    - (right.incrementSeconds ?? Number.MAX_SAFE_INTEGER);
}

function validateScope(scope: TimePressureExposureScope): void {
  for (const value of [scope.from, scope.to]) {
    if (value && !Number.isFinite(value.getTime())) {
      throw new RangeError('Time-pressure exposure scope contains an invalid date.');
    }
  }
  if (scope.from && scope.to && scope.from.getTime() >= scope.to.getTime()) {
    throw new RangeError('Time-pressure exposure scope "from" must be earlier than "to".');
  }
}

export function buildTimePressureExposureAggregate(
  games: readonly TimePressureSourceGame[],
): TimePressureExposureResult {
  const seen = new Set<number>();
  for (const game of games) {
    if (seen.has(game.importedGameId)) {
      return unavailable(games.length, 'duplicate-candidate-game-row');
    }
    seen.add(game.importedGameId);
  }

  const exclusions = emptyExclusions();
  const covered: CoveredGame[] = [];
  let eligibleGames = 0;

  for (const game of games) {
    const result = coveredGame(game);
    if (result.reason === 'UNSUPPORTED_GAME') {
      exclusions.UNSUPPORTED_GAME += 1;
      continue;
    }

    eligibleGames += 1;
    if (result.reason) {
      exclusions[result.reason] += 1;
      continue;
    }
    covered.push(result.covered as CoveredGame);
  }

  const timingCoveredGames = covered.length;
  const timingCoveragePercent = timingBehaviorPercentage(timingCoveredGames, eligibleGames);
  const coverageStatus = eligibleGames === 0 || timingCoveredGames === 0
    ? 'UNAVAILABLE'
    : timingCoveredGames === eligibleGames
      ? 'COMPLETE'
      : 'PARTIAL';
  const coverageReason = eligibleGames === 0
    ? 'no-timing-eligible-games'
    : timingCoveredGames === 0
      ? 'timing-evidence-unavailable'
      : timingCoveredGames === eligibleGames
        ? null
        : 'timing-coverage-incomplete';

  const bandMoveCounts: Record<RemainingClockBand, number> = {
    CRITICAL: 0,
    PRESSURE: 0,
    NORMAL: 0,
  };
  const bandGameSets: Record<RemainingClockBand, Set<number>> = {
    CRITICAL: new Set<number>(),
    PRESSURE: new Set<number>(),
    NORMAL: new Set<number>(),
  };
  const entryPlies: number[] = [];
  const entryPlyCounts = new Map<number, number>();
  const phaseCounts = emptyPhaseCounts();
  let phaseCoveredGames = 0;
  let pressureEnteringGames = 0;
  let eligibleUserDecisions = 0;
  let pressureMoves = 0;
  const contexts = new Map<string, ContextAccumulator>();

  for (const item of covered) {
    eligibleUserDecisions += item.moves.length;
    let gamePressureMoves = 0;
    for (const move of item.moves) {
      bandMoveCounts[move.band] += 1;
      bandGameSets[move.band].add(item.game.importedGameId);
      if (move.band !== 'NORMAL') {
        pressureMoves += 1;
        gamePressureMoves += 1;
      }
    }

    const entry = item.moves.find((move) => move.band !== 'NORMAL') ?? null;
    if (entry) {
      pressureEnteringGames += 1;
      entryPlies.push(entry.plyNumber);
      entryPlyCounts.set(entry.plyNumber, (entryPlyCounts.get(entry.plyNumber) ?? 0) + 1);
      if (entry.phase) {
        phaseCoveredGames += 1;
        phaseCounts[entry.phase] += 1;
      } else {
        phaseCounts.UNKNOWN += 1;
      }
    }

    const key = contextKey(item.game);
    const accumulator = contexts.get(key) ?? {
      exactTimeControlKey: item.game.exactTimeControlKey,
      initialSeconds: item.game.timeControlInitial,
      incrementSeconds: item.game.timeControlIncrement,
      timingCoveredGames: 0,
      pressureEnteringGames: 0,
      eligibleUserDecisions: 0,
      pressureMoves: 0,
    };
    accumulator.timingCoveredGames += 1;
    accumulator.pressureEnteringGames += entry ? 1 : 0;
    accumulator.eligibleUserDecisions += item.moves.length;
    accumulator.pressureMoves += gamePressureMoves;
    contexts.set(key, accumulator);
  }

  const bands = emptyBandSummary();
  for (const band of BAND_ORDER) {
    bands[band] = {
      moves: bandMoveCounts[band],
      games: bandGameSets[band].size,
      moveRatePercent: timingBehaviorPercentage(bandMoveCounts[band], eligibleUserDecisions),
      gameRatePercent: timingBehaviorPercentage(bandGameSets[band].size, timingCoveredGames),
    };
  }

  const contextBreakdown = [...contexts.values()].map<TimePressureContextBreakdown>((item) => ({
    ...item,
    pressureEntryRatePercent: timingBehaviorPercentage(
      item.pressureEnteringGames,
      item.timingCoveredGames,
    ),
    pressureMoveRatePercent: timingBehaviorPercentage(
      item.pressureMoves,
      item.eligibleUserDecisions,
    ),
  })).sort(compareContext);

  const caveats = [
    'TIME-001 measures observed time-pressure exposure only; it does not imply that pressure caused worse play.',
    'Pressure uses the shared time-behavior-v1 before-move clock bands and does not shift the 10/30-second thresholds for increment.',
    'A game contributes to game-level recurrence only when every derivable user decision has current reliable timing; incomplete or externally adjustable clocks remain coverage loss.',
  ];
  if (coverageStatus !== 'COMPLETE') {
    caveats.push('Some timing-eligible games are excluded because current trustworthy user timing is incomplete or unavailable.');
  }
  if (phaseCoveredGames < pressureEnteringGames) {
    caveats.push('First-entry phase is reported only where current phase evidence covers the before-position boundary; missing phase is not inferred from move number.');
  }

  return {
    diagnosisId: 'TIME-001',
    policyVersion: TIME_PRESSURE_EXPOSURE_POLICY_VERSION,
    timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
    timingDerivationVersion: TIMING_DERIVATION_VERSION,
    coverage: {
      status: coverageStatus,
      reason: coverageReason,
      candidateGames: games.length,
      eligibleGames,
      timingCoveredGames,
      timingCoveragePercent,
      excludedByReason: exclusions,
      maxCandidateGames: TIME_PRESSURE_EXPOSURE_MAX_CANDIDATE_GAMES,
    },
    exposure: {
      eligibleUserDecisions,
      pressureMoves,
      pressureMoveRatePercent: timingBehaviorPercentage(pressureMoves, eligibleUserDecisions),
      pressureEnteringGames,
      pressureEntryRatePercent: timingBehaviorPercentage(
        pressureEnteringGames,
        timingCoveredGames,
      ),
      bands,
      firstEntry: {
        games: pressureEnteringGames,
        averagePly: entryPlies.length > 0
          ? roundTimingBehaviorMetric(
              entryPlies.reduce((sum, plyNumber) => sum + plyNumber, 0) / entryPlies.length,
            )
          : null,
        earliestPly: entryPlies.length > 0 ? Math.min(...entryPlies) : null,
        latestPly: entryPlies.length > 0 ? Math.max(...entryPlies) : null,
        plyCounts: [...entryPlyCounts.entries()]
          .sort(([left], [right]) => left - right)
          .map(([plyNumber, count]) => ({ plyNumber, games: count })),
        phaseCoveredGames,
        phaseCoveragePercent: timingBehaviorPercentage(
          phaseCoveredGames,
          pressureEnteringGames,
        ),
        phaseCounts,
      },
      evidenceStrength: timingBehaviorEvidenceStrength({
        supportingGames: timingCoveredGames,
        requiredEvidenceCoveragePercent: timingCoveragePercent,
      }),
    },
    contextBreakdown,
    caveats,
  };
}

export async function getTimePressureExposure(
  appUserId: number,
  scope: TimePressureExposureScope,
  repository: TimePressureExposureRepository,
): Promise<TimePressureExposureResult> {
  validateScope(scope);
  const candidateGames = await repository.countCandidates(appUserId, scope);

  if (candidateGames > TIME_PRESSURE_EXPOSURE_MAX_CANDIDATE_GAMES) {
    return unavailable(candidateGames, 'time-pressure-scope-too-large');
  }
  if (candidateGames === 0) return unavailable(0, 'no-candidate-games');

  const games = await repository.loadCandidates(appUserId, scope);
  if (games.length !== candidateGames) {
    return unavailable(candidateGames, 'candidate-set-changed-during-read');
  }

  return buildTimePressureExposureAggregate(games);
}
