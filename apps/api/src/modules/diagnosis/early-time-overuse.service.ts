import {
  TIME_BEHAVIOR_LOW_EVIDENCE_GAMES,
  TIME_BEHAVIOR_POLICY_VERSION,
  TIME_EARLY_OVERUSE_MEDIAN_MULTIPLIER,
  TIME_EARLY_OVERUSE_MIN_PEER_GAMES,
  TIME_PRESSURE_THRESHOLD_CENTISECONDS,
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

export const EARLY_TIME_OVERUSE_POLICY_VERSION = 'early-time-overuse-v1';
export const EARLY_TIME_OVERUSE_MAX_CANDIDATE_GAMES = 5_000;

export interface EarlyTimeOveruseScope {
  from?: Date;
  to?: Date;
}

export type EarlyTimeOverusePhase = 'OPENING' | 'MIDDLEGAME' | 'ENDGAME';
export type EarlyTimeOveruseMechanismStatus =
  | 'INSUFFICIENT'
  | 'NOT_SUPPORTED'
  | 'ORDERED_ASSOCIATION';

export interface EarlyTimeOveruseAnalysisRun {
  runId: number;
  snapshotId: string;
  analysisVersion: string;
  settingsHash: string;
  engineName: string | null;
  engineVersion: string | null;
}

export interface EarlyTimeOveruseSourceMove {
  plyNumber: number;
  clockBeforeMoveCentiseconds: number | null;
  moveTimeCentiseconds: number | null;
  timingDerivationVersion: number | null;
  timingDerivationStatus: string | null;
  timingReliabilityFlags: readonly string[];
  phase: EarlyTimeOverusePhase | null;
  scoreLossCp: number | null;
  analysis: EarlyTimeOveruseAnalysisRun | null;
}

export interface EarlyTimeOveruseSourceGame {
  importedGameId: number;
  variant: string | null;
  speedCategory: string | null;
  exactTimeControlKey: string | null;
  timeControlInitial: number | null;
  timeControlIncrement: number | null;
  timingDerivationVersion: number | null;
  userMoves: readonly EarlyTimeOveruseSourceMove[];
}

export interface EarlyTimeOveruseRepository {
  countCandidates(appUserId: number, scope: EarlyTimeOveruseScope): Promise<number>;
  loadCandidates(
    appUserId: number,
    scope: EarlyTimeOveruseScope,
  ): Promise<EarlyTimeOveruseSourceGame[]>;
}

export interface EarlyTimeOveruseGameEvidence {
  importedGameId: number;
  exactTimeControlKey: string | null;
  early: {
    status: 'AVAILABLE' | 'UNAVAILABLE';
    reason: string | null;
    expenditureCentiseconds: number | null;
    lastOpeningPly: number | null;
    peerGames: number;
    peerMedianCentiseconds: number | null;
    overuseThresholdCentiseconds: number | null;
    excessPercent: number | null;
    overuse: boolean | null;
  };
  laterPressure: {
    status: 'NOT_APPLICABLE' | 'AVAILABLE' | 'UNAVAILABLE';
    reason: string | null;
    observedEntryPly: number | null;
    observedPressureMoves: number;
    timingComplete: boolean | null;
  };
  laterQuality: {
    status: 'NOT_APPLICABLE' | 'AVAILABLE' | 'UNAVAILABLE';
    reason: string | null;
    knownPressureMoves: number;
    matchedAnalysedPressureMoves: number;
    analysisCoveragePercent: number | null;
    averagePressureScoreLossCp: number | null;
    averageMatchedBaselineScoreLossCp: number | null;
    scoreLossDeltaCp: number | null;
    degraded: boolean | null;
  };
  completeChain: boolean;
}

export interface EarlyTimeOveruseControlBreakdown {
  exactTimeControlKey: string;
  earlyCoveredGames: number;
  peerMedianCentiseconds: number;
  overuseThresholdCentiseconds: number;
  earlyOveruseGames: number;
  completeChainGames: number;
}

export interface EarlyTimeOveruseResult {
  diagnosisId: 'TIME-004';
  policyVersion: string;
  timeBehaviorPolicyVersion: string;
  timingDerivationVersion: number;
  definitions: {
    earlyPhase: 'OPENING';
    overuseMedianMultiplier: number;
    minimumPeerGames: number;
    pressureClockMaximumCentisecondsInclusive: number;
    qualityMatchingDimensions: ['EXACT_TIME_CONTROL', 'PHASE'];
  };
  coverage: {
    status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
    reason: string | null;
    candidateGames: number;
    timingEligibleGames: number;
    unsupportedGames: number;
    earlyCoveredGames: number;
    earlyCoveragePercent: number | null;
    peerBaselineGames: number;
    peerBaselineCoveragePercent: number | null;
    earlyOveruseGames: number;
    laterPressureEvaluableGames: number;
    laterPressureGames: number;
    laterPressureCoveragePercent: number | null;
    qualityEvaluableGames: number;
    laterDegradationGames: number;
    qualityGameCoveragePercent: number | null;
    knownPressureMoves: number;
    matchedAnalysedPressureMoves: number;
    qualityMoveCoveragePercent: number | null;
    normalQualityBaselineMoves: number;
    analysedNormalQualityBaselineMoves: number;
    normalQualityBaselineAnalysisCoveragePercent: number | null;
    normalQualityBaselineGames: number;
    maxCandidateGames: number;
    exclusions: {
      missingExactControlGames: number;
      earlyPhaseUnavailableGames: number;
      earlyTimingIncompleteGames: number;
      peerBaselineTooSmallGames: number;
      laterTimingIncompleteGames: number;
      qualityEvidenceUnavailableGames: number;
    };
  };
  chain: {
    earlyOveruseGames: number;
    overuseWithoutLaterPressureGames: number;
    laterPressureGames: number;
    pressureWithoutQualityEvidenceGames: number;
    pressureWithoutDegradationGames: number;
    laterDegradationGames: number;
    completeChainGames: number;
    pressureRateAmongEvaluableOverusePercent: number | null;
    degradationRateAmongQualityEvaluablePressurePercent: number | null;
    averageEarlyExcessPercent: number | null;
    averageLaterScoreLossDeltaCp: number | null;
    evidenceStrength: TimingBehaviorEvidenceStrength;
    mechanismStatus: EarlyTimeOveruseMechanismStatus;
  };
  controls: EarlyTimeOveruseControlBreakdown[];
  games: EarlyTimeOveruseGameEvidence[];
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

interface EarlyMeasurement {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  reason: string | null;
  expenditureCentiseconds: number | null;
  lastOpeningPly: number | null;
}

interface QualityBaselineMove {
  importedGameId: number;
  scoreLossCp: number;
  analysis: EarlyTimeOveruseAnalysisRun;
}

interface QualityBaselineStratum {
  eligibleMoves: number;
  analysedMoves: QualityBaselineMove[];
}

interface QualityPair {
  move: EarlyTimeOveruseSourceMove;
  benchmarkScoreLossCp: number;
  baselineKey: string;
  baseline: QualityBaselineStratum;
}

function validateScope(scope: EarlyTimeOveruseScope): void {
  for (const value of [scope.from, scope.to]) {
    if (value && !Number.isFinite(value.getTime())) {
      throw new RangeError('Early-time-overuse scope contains an invalid date.');
    }
  }
  if (scope.from && scope.to && scope.from.getTime() >= scope.to.getTime()) {
    throw new RangeError('Early-time-overuse scope "from" must be earlier than "to".');
  }
}

function trustworthyTimingMove(
  game: EarlyTimeOveruseSourceGame,
  move: EarlyTimeOveruseSourceMove,
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

function analysed(move: EarlyTimeOveruseSourceMove): move is EarlyTimeOveruseSourceMove & {
  scoreLossCp: number;
  analysis: EarlyTimeOveruseAnalysisRun;
} {
  return Boolean(
    move.analysis
    && typeof move.scoreLossCp === 'number'
    && Number.isFinite(move.scoreLossCp)
    && move.scoreLossCp >= 0,
  );
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return roundTimingBehaviorMetric(
    values.reduce((sum, value) => sum + value, 0) / values.length,
  );
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return roundTimingBehaviorMetric((sorted[middle - 1] + sorted[middle]) / 2);
}

function minimumCoverage(values: readonly (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null;
  return Math.min(...values.filter((value): value is number => value !== null));
}

function qualityStratumKey(
  exactTimeControlKey: string,
  phase: EarlyTimeOverusePhase,
): string {
  return JSON.stringify([exactTimeControlKey, phase]);
}

function earlyMeasurement(game: EarlyTimeOveruseSourceGame): EarlyMeasurement {
  const moves = [...game.userMoves]
    .filter((move) => move.plyNumber > 2)
    .sort((left, right) => left.plyNumber - right.plyNumber);

  let sawOpening = false;
  let sawNonOpeningAfterOpening = false;
  let lastOpeningPly: number | null = null;

  for (const move of moves) {
    if (sawNonOpeningAfterOpening) {
      if (move.phase === 'OPENING') {
        return {
          status: 'UNAVAILABLE',
          reason: 'early-phase-order-inconsistent',
          expenditureCentiseconds: null,
          lastOpeningPly: null,
        };
      }
      continue;
    }

    if (move.phase === null) {
      return {
        status: 'UNAVAILABLE',
        reason: 'early-phase-unavailable',
        expenditureCentiseconds: null,
        lastOpeningPly: null,
      };
    }

    if (move.phase === 'OPENING') {
      sawOpening = true;
      lastOpeningPly = move.plyNumber;
      if (!trustworthyTimingMove(game, move)) {
        return {
          status: 'UNAVAILABLE',
          reason: 'early-timing-incomplete',
          expenditureCentiseconds: null,
          lastOpeningPly: null,
        };
      }
      continue;
    }

    if (sawOpening) sawNonOpeningAfterOpening = true;
  }

  if (!sawOpening || lastOpeningPly === null) {
    return {
      status: 'UNAVAILABLE',
      reason: 'early-phase-unavailable',
      expenditureCentiseconds: null,
      lastOpeningPly: null,
    };
  }

  const openingMoves = moves.filter(
    (move) => move.phase === 'OPENING' && move.plyNumber <= lastOpeningPly,
  );
  return {
    status: 'AVAILABLE',
    reason: null,
    expenditureCentiseconds: openingMoves.reduce(
      (sum, move) => sum + (move.moveTimeCentiseconds as number),
      0,
    ),
    lastOpeningPly,
  };
}

function buildNormalQualityBaselines(
  games: readonly EarlyTimeOveruseSourceGame[],
): Map<string, QualityBaselineStratum> {
  const baselines = new Map<string, QualityBaselineStratum>();

  for (const game of games) {
    if (!isTimingEligibleGame(game) || !game.exactTimeControlKey) continue;
    for (const move of game.userMoves) {
      if (
        !trustworthyTimingMove(game, move)
        || !move.phase
        || classifyRemainingClock(move.clockBeforeMoveCentiseconds) !== 'NORMAL'
      ) {
        continue;
      }
      const key = qualityStratumKey(game.exactTimeControlKey, move.phase);
      const stratum = baselines.get(key) ?? { eligibleMoves: 0, analysedMoves: [] };
      stratum.eligibleMoves += 1;
      if (analysed(move)) {
        stratum.analysedMoves.push({
          importedGameId: game.importedGameId,
          scoreLossCp: move.scoreLossCp,
          analysis: move.analysis,
        });
      }
      baselines.set(key, stratum);
    }
  }

  return baselines;
}

function provenanceFor(
  runsInput: readonly EarlyTimeOveruseAnalysisRun[],
): EarlyTimeOveruseResult['analysisProvenance'] {
  const runById = new Map<number, EarlyTimeOveruseAnalysisRun>();
  for (const run of runsInput) runById.set(run.runId, run);
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

function unavailable(candidateGames: number, reason: string): EarlyTimeOveruseResult {
  return {
    diagnosisId: 'TIME-004',
    policyVersion: EARLY_TIME_OVERUSE_POLICY_VERSION,
    timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
    timingDerivationVersion: TIMING_DERIVATION_VERSION,
    definitions: {
      earlyPhase: 'OPENING',
      overuseMedianMultiplier: TIME_EARLY_OVERUSE_MEDIAN_MULTIPLIER,
      minimumPeerGames: TIME_EARLY_OVERUSE_MIN_PEER_GAMES,
      pressureClockMaximumCentisecondsInclusive: TIME_PRESSURE_THRESHOLD_CENTISECONDS,
      qualityMatchingDimensions: ['EXACT_TIME_CONTROL', 'PHASE'],
    },
    coverage: {
      status: 'UNAVAILABLE',
      reason,
      candidateGames,
      timingEligibleGames: 0,
      unsupportedGames: 0,
      earlyCoveredGames: 0,
      earlyCoveragePercent: null,
      peerBaselineGames: 0,
      peerBaselineCoveragePercent: null,
      earlyOveruseGames: 0,
      laterPressureEvaluableGames: 0,
      laterPressureGames: 0,
      laterPressureCoveragePercent: null,
      qualityEvaluableGames: 0,
      laterDegradationGames: 0,
      qualityGameCoveragePercent: null,
      knownPressureMoves: 0,
      matchedAnalysedPressureMoves: 0,
      qualityMoveCoveragePercent: null,
      normalQualityBaselineMoves: 0,
      analysedNormalQualityBaselineMoves: 0,
      normalQualityBaselineAnalysisCoveragePercent: null,
      normalQualityBaselineGames: 0,
      maxCandidateGames: EARLY_TIME_OVERUSE_MAX_CANDIDATE_GAMES,
      exclusions: {
        missingExactControlGames: 0,
        earlyPhaseUnavailableGames: 0,
        earlyTimingIncompleteGames: 0,
        peerBaselineTooSmallGames: 0,
        laterTimingIncompleteGames: 0,
        qualityEvidenceUnavailableGames: 0,
      },
    },
    chain: {
      earlyOveruseGames: 0,
      overuseWithoutLaterPressureGames: 0,
      laterPressureGames: 0,
      pressureWithoutQualityEvidenceGames: 0,
      pressureWithoutDegradationGames: 0,
      laterDegradationGames: 0,
      completeChainGames: 0,
      pressureRateAmongEvaluableOverusePercent: null,
      degradationRateAmongQualityEvaluablePressurePercent: null,
      averageEarlyExcessPercent: null,
      averageLaterScoreLossDeltaCp: null,
      evidenceStrength: 'INSUFFICIENT',
      mechanismStatus: 'INSUFFICIENT',
    },
    controls: [],
    games: [],
    analysisProvenance: {
      requirement: 'CURRENT_COMPLETE_SOURCE_SNAPSHOT',
      analysedRuns: 0,
      snapshotIds: [],
      analysisVersions: [],
      settingsHashes: [],
      engines: [],
    },
    caveats: [
      'No TIME-004 ordered-chain conclusion is available from this aggregate.',
      'TIME-004 is behavioral, correlational evidence and does not establish a psychological or causal explanation.',
    ],
  };
}

export function buildEarlyTimeOveruseAggregate(
  games: readonly EarlyTimeOveruseSourceGame[],
): EarlyTimeOveruseResult {
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
  let missingExactControlGames = 0;
  let earlyPhaseUnavailableGames = 0;
  let earlyTimingIncompleteGames = 0;

  const measurements = new Map<number, EarlyMeasurement>();
  const earlyGroups = new Map<string, Array<{
    game: EarlyTimeOveruseSourceGame;
    measurement: EarlyMeasurement & {
      status: 'AVAILABLE';
      expenditureCentiseconds: number;
      lastOpeningPly: number;
    };
  }>>();

  for (const game of games) {
    if (!isTimingEligibleGame(game)) {
      unsupportedGames += 1;
      continue;
    }
    timingEligibleGames += 1;

    if (!game.exactTimeControlKey) {
      missingExactControlGames += 1;
      measurements.set(game.importedGameId, {
        status: 'UNAVAILABLE',
        reason: 'missing-exact-control',
        expenditureCentiseconds: null,
        lastOpeningPly: null,
      });
      continue;
    }

    const measurement = earlyMeasurement(game);
    measurements.set(game.importedGameId, measurement);
    if (measurement.status === 'UNAVAILABLE') {
      if (measurement.reason === 'early-timing-incomplete') earlyTimingIncompleteGames += 1;
      else earlyPhaseUnavailableGames += 1;
      continue;
    }

    const rows = earlyGroups.get(game.exactTimeControlKey) ?? [];
    rows.push({
      game,
      measurement: measurement as EarlyMeasurement & {
        status: 'AVAILABLE';
        expenditureCentiseconds: number;
        lastOpeningPly: number;
      },
    });
    earlyGroups.set(game.exactTimeControlKey, rows);
  }

  const earlyCoveredGames = [...earlyGroups.values()]
    .reduce((sum, rows) => sum + rows.length, 0);
  const earlyCoveragePercent = timingBehaviorPercentage(
    earlyCoveredGames,
    timingEligibleGames,
  );

  const peerMedians = new Map<string, { peerGames: number; median: number; threshold: number }>();
  let peerBaselineGames = 0;
  let peerBaselineTooSmallGames = 0;
  for (const [control, rows] of earlyGroups) {
    if (rows.length < TIME_EARLY_OVERUSE_MIN_PEER_GAMES) {
      peerBaselineTooSmallGames += rows.length;
      continue;
    }
    const groupMedian = median(rows.map((row) => row.measurement.expenditureCentiseconds));
    if (groupMedian === null) continue;
    peerBaselineGames += rows.length;
    peerMedians.set(control, {
      peerGames: rows.length,
      median: groupMedian,
      threshold: roundTimingBehaviorMetric(
        groupMedian * TIME_EARLY_OVERUSE_MEDIAN_MULTIPLIER,
      ),
    });
  }

  const peerBaselineCoveragePercent = timingBehaviorPercentage(
    peerBaselineGames,
    earlyCoveredGames,
  );
  const normalBaselines = buildNormalQualityBaselines(games);
  const gameEvidence: EarlyTimeOveruseGameEvidence[] = [];
  const contributingAnalysisRuns: EarlyTimeOveruseAnalysisRun[] = [];
  const usedBaselineGameIds = new Set<number>();
  const usedBaselineStratumKeys = new Set<string>();

  let earlyOveruseGames = 0;
  let laterPressureEvaluableGames = 0;
  let laterPressureGames = 0;
  let laterTimingIncompleteGames = 0;
  let overuseWithoutLaterPressureGames = 0;
  let qualityEvaluableGames = 0;
  let qualityEvidenceUnavailableGames = 0;
  let pressureWithoutQualityEvidenceGames = 0;
  let pressureWithoutDegradationGames = 0;
  let laterDegradationGames = 0;
  let completeChainGames = 0;
  let knownPressureMoves = 0;
  let matchedAnalysedPressureMoves = 0;
  const earlyExcesses: number[] = [];
  const qualityDeltas: number[] = [];

  for (const game of [...games].sort((left, right) => left.importedGameId - right.importedGameId)) {
    const measurement = measurements.get(game.importedGameId) ?? {
      status: 'UNAVAILABLE' as const,
      reason: !isTimingEligibleGame(game) ? 'unsupported-game' : 'early-evidence-unavailable',
      expenditureCentiseconds: null,
      lastOpeningPly: null,
    };
    const peer = game.exactTimeControlKey
      ? peerMedians.get(game.exactTimeControlKey) ?? null
      : null;

    let overuse: boolean | null = null;
    let excessPercent: number | null = null;
    if (
      measurement.status === 'AVAILABLE'
      && measurement.expenditureCentiseconds !== null
      && peer
    ) {
      overuse = measurement.expenditureCentiseconds >= peer.threshold;
      excessPercent = peer.median > 0
        ? roundTimingBehaviorMetric(
            ((measurement.expenditureCentiseconds - peer.median) / peer.median) * 100,
          )
        : null;
    }

    const evidence: EarlyTimeOveruseGameEvidence = {
      importedGameId: game.importedGameId,
      exactTimeControlKey: game.exactTimeControlKey,
      early: {
        status: measurement.status,
        reason: measurement.reason,
        expenditureCentiseconds: measurement.expenditureCentiseconds,
        lastOpeningPly: measurement.lastOpeningPly,
        peerGames: peer?.peerGames ?? 0,
        peerMedianCentiseconds: peer?.median ?? null,
        overuseThresholdCentiseconds: peer?.threshold ?? null,
        excessPercent,
        overuse,
      },
      laterPressure: {
        status: overuse === true ? 'UNAVAILABLE' : 'NOT_APPLICABLE',
        reason: overuse === true ? 'not-evaluated' : null,
        observedEntryPly: null,
        observedPressureMoves: 0,
        timingComplete: null,
      },
      laterQuality: {
        status: 'NOT_APPLICABLE',
        reason: null,
        knownPressureMoves: 0,
        matchedAnalysedPressureMoves: 0,
        analysisCoveragePercent: null,
        averagePressureScoreLossCp: null,
        averageMatchedBaselineScoreLossCp: null,
        scoreLossDeltaCp: null,
        degraded: null,
      },
      completeChain: false,
    };

    if (overuse !== true || measurement.lastOpeningPly === null) {
      gameEvidence.push(evidence);
      continue;
    }

    earlyOveruseGames += 1;
    if (excessPercent !== null) earlyExcesses.push(excessPercent);

    const laterMoves = [...game.userMoves]
      .filter((move) => move.plyNumber > (measurement.lastOpeningPly as number))
      .sort((left, right) => left.plyNumber - right.plyNumber);
    const trustworthyLaterMoves = laterMoves.filter((move) => trustworthyTimingMove(game, move));
    const timingComplete = trustworthyLaterMoves.length === laterMoves.length;
    const pressureMoves = trustworthyLaterMoves.filter((move) => {
      const band = classifyRemainingClock(move.clockBeforeMoveCentiseconds);
      return band === 'PRESSURE' || band === 'CRITICAL';
    });
    const firstPressure = pressureMoves[0] ?? null;

    if (firstPressure || timingComplete) {
      laterPressureEvaluableGames += 1;
      evidence.laterPressure = {
        status: 'AVAILABLE',
        reason: null,
        observedEntryPly: firstPressure?.plyNumber ?? null,
        observedPressureMoves: pressureMoves.length,
        timingComplete,
      };
    } else {
      laterTimingIncompleteGames += 1;
      evidence.laterPressure = {
        status: 'UNAVAILABLE',
        reason: 'later-timing-incomplete-without-observed-pressure',
        observedEntryPly: null,
        observedPressureMoves: 0,
        timingComplete: false,
      };
      gameEvidence.push(evidence);
      continue;
    }

    if (!firstPressure) {
      overuseWithoutLaterPressureGames += 1;
      gameEvidence.push(evidence);
      continue;
    }

    laterPressureGames += 1;
    if (!timingComplete) laterTimingIncompleteGames += 1;

    const pressureFromEntry = pressureMoves.filter(
      (move) => move.plyNumber >= firstPressure.plyNumber,
    );
    knownPressureMoves += pressureFromEntry.length;
    const pairs: QualityPair[] = [];

    for (const move of pressureFromEntry) {
      if (!game.exactTimeControlKey || !move.phase || !analysed(move)) continue;
      const baselineKey = qualityStratumKey(game.exactTimeControlKey, move.phase);
      const baseline = normalBaselines.get(baselineKey) ?? null;
      if (!baseline || baseline.analysedMoves.length === 0) continue;
      const benchmark = average(baseline.analysedMoves.map((row) => row.scoreLossCp));
      if (benchmark === null) continue;
      pairs.push({ move, benchmarkScoreLossCp: benchmark, baselineKey, baseline });
    }

    matchedAnalysedPressureMoves += pairs.length;
    const analysisCoveragePercent = timingBehaviorPercentage(
      pairs.length,
      pressureFromEntry.length,
    );
    evidence.laterQuality.knownPressureMoves = pressureFromEntry.length;
    evidence.laterQuality.matchedAnalysedPressureMoves = pairs.length;
    evidence.laterQuality.analysisCoveragePercent = analysisCoveragePercent;

    if (pairs.length === 0) {
      qualityEvidenceUnavailableGames += 1;
      pressureWithoutQualityEvidenceGames += 1;
      evidence.laterQuality.status = 'UNAVAILABLE';
      evidence.laterQuality.reason = 'no-current-matched-quality-evidence';
      gameEvidence.push(evidence);
      continue;
    }

    qualityEvaluableGames += 1;
    const pressureAverage = average(
      pairs.map((pair) => (pair.move.scoreLossCp as number)),
    );
    const baselineAverage = average(
      pairs.map((pair) => pair.benchmarkScoreLossCp),
    );
    const delta = pressureAverage === null || baselineAverage === null
      ? null
      : roundTimingBehaviorMetric(pressureAverage - baselineAverage);
    const degraded = delta !== null ? delta > 0 : null;

    evidence.laterQuality = {
      status: 'AVAILABLE',
      reason: null,
      knownPressureMoves: pressureFromEntry.length,
      matchedAnalysedPressureMoves: pairs.length,
      analysisCoveragePercent,
      averagePressureScoreLossCp: pressureAverage,
      averageMatchedBaselineScoreLossCp: baselineAverage,
      scoreLossDeltaCp: delta,
      degraded,
    };

    for (const pair of pairs) {
      if (analysed(pair.move)) contributingAnalysisRuns.push(pair.move.analysis);
      usedBaselineStratumKeys.add(pair.baselineKey);
      for (const baseline of pair.baseline.analysedMoves) {
        usedBaselineGameIds.add(baseline.importedGameId);
      }
    }
    if (delta !== null) qualityDeltas.push(delta);

    if (degraded) {
      laterDegradationGames += 1;
      completeChainGames += 1;
      evidence.completeChain = true;
    } else {
      pressureWithoutDegradationGames += 1;
    }

    gameEvidence.push(evidence);
  }

  const laterPressureCoveragePercent = timingBehaviorPercentage(
    Math.max(0, earlyOveruseGames - laterTimingIncompleteGames),
    earlyOveruseGames,
  );
  const qualityGameCoveragePercent = timingBehaviorPercentage(
    qualityEvaluableGames,
    laterPressureGames,
  );
  const qualityMoveCoveragePercent = timingBehaviorPercentage(
    matchedAnalysedPressureMoves,
    knownPressureMoves,
  );
  let normalQualityBaselineMoves = 0;
  let analysedNormalQualityBaselineMoves = 0;
  for (const key of usedBaselineStratumKeys) {
    const baseline = normalBaselines.get(key);
    if (!baseline) continue;
    normalQualityBaselineMoves += baseline.eligibleMoves;
    analysedNormalQualityBaselineMoves += baseline.analysedMoves.length;
    for (const row of baseline.analysedMoves) contributingAnalysisRuns.push(row.analysis);
  }
  const normalQualityBaselineAnalysisCoveragePercent = timingBehaviorPercentage(
    analysedNormalQualityBaselineMoves,
    normalQualityBaselineMoves,
  );
  const requiredCoverage = minimumCoverage([
    earlyCoveragePercent,
    peerBaselineCoveragePercent,
    laterPressureCoveragePercent,
    qualityGameCoveragePercent,
    qualityMoveCoveragePercent,
    normalQualityBaselineAnalysisCoveragePercent,
  ]);

  const evidenceStrength = comparativeTimingBehaviorEvidenceStrength(
    {
      supportingGames: qualityEvaluableGames,
      requiredEvidenceCoveragePercent: requiredCoverage,
    },
    {
      supportingGames: usedBaselineGameIds.size,
      requiredEvidenceCoveragePercent: requiredCoverage,
    },
  );
  const mechanismStatus: EarlyTimeOveruseMechanismStatus = evidenceStrength === 'INSUFFICIENT'
    ? 'INSUFFICIENT'
    : completeChainGames >= TIME_BEHAVIOR_LOW_EVIDENCE_GAMES
      ? 'ORDERED_ASSOCIATION'
      : 'NOT_SUPPORTED';

  let status: EarlyTimeOveruseResult['coverage']['status'];
  let reason: string | null;
  if (timingEligibleGames === 0) {
    status = 'UNAVAILABLE';
    reason = 'no-timing-eligible-games';
  } else if (earlyCoveredGames === 0) {
    status = 'UNAVAILABLE';
    reason = 'early-evidence-unavailable';
  } else if (peerBaselineGames === 0) {
    status = 'UNAVAILABLE';
    reason = 'same-control-peer-baseline-unavailable';
  } else {
    const pressureComplete = earlyOveruseGames === 0
      || (
        laterPressureEvaluableGames === earlyOveruseGames
        && laterTimingIncompleteGames === 0
      );
    const qualityComplete = laterPressureGames === 0
      || (
        qualityEvaluableGames === laterPressureGames
        && matchedAnalysedPressureMoves === knownPressureMoves
        && analysedNormalQualityBaselineMoves === normalQualityBaselineMoves
      );
    const complete = earlyCoveredGames === timingEligibleGames
      && peerBaselineGames === earlyCoveredGames
      && pressureComplete
      && qualityComplete;
    status = complete ? 'COMPLETE' : 'PARTIAL';
    reason = complete
      ? null
      : earlyCoveredGames !== timingEligibleGames
        ? 'early-coverage-incomplete'
        : peerBaselineGames !== earlyCoveredGames
          ? 'peer-baseline-coverage-incomplete'
          : !pressureComplete
            ? 'later-pressure-coverage-incomplete'
            : 'later-quality-coverage-incomplete';
  }

  const controls = [...peerMedians.entries()].map<EarlyTimeOveruseControlBreakdown>(
    ([exactTimeControlKey, peer]) => {
      const relevant = gameEvidence.filter(
        (row) => row.exactTimeControlKey === exactTimeControlKey
          && row.early.status === 'AVAILABLE',
      );
      return {
        exactTimeControlKey,
        earlyCoveredGames: relevant.length,
        peerMedianCentiseconds: peer.median,
        overuseThresholdCentiseconds: peer.threshold,
        earlyOveruseGames: relevant.filter((row) => row.early.overuse === true).length,
        completeChainGames: relevant.filter((row) => row.completeChain).length,
      };
    },
  ).sort((left, right) => left.exactTimeControlKey.localeCompare(right.exactTimeControlKey));

  const caveats = [
    'TIME-004 requires the ordered same-game chain: above-normal OPENING time use, then observed later pressure, then worse current-engine quality than exact-control/phase-matched NORMAL-clock moves.',
    'Early overuse is player-relative within the same exact control and requires at least five eligible peer games; sparse controls remain unavailable rather than borrowing another control.',
    'The first user move timing is never invented, and unknown phase before the stabilized OPENING boundary is coverage loss rather than early-time evidence.',
    'Observed later pressure can establish the pressure link despite other missing later timings, but incomplete later timing remains explicit coverage loss.',
    'Move-quality comparison uses only current complete engine analysis from the same ply-index snapshot and does not silently pool exact controls or phases.',
    'The ordered association is correlational; it does not prove that early thinking caused later pressure or degraded play.',
  ];
  if (usedBaselineGameIds.size > 0) {
    caveats.push('Normal-clock comparator games may overlap the early-overuse game set; the comparator is move-level and matched by exact control plus phase, not a disjoint game cohort.');
  }

  return {
    diagnosisId: 'TIME-004',
    policyVersion: EARLY_TIME_OVERUSE_POLICY_VERSION,
    timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
    timingDerivationVersion: TIMING_DERIVATION_VERSION,
    definitions: {
      earlyPhase: 'OPENING',
      overuseMedianMultiplier: TIME_EARLY_OVERUSE_MEDIAN_MULTIPLIER,
      minimumPeerGames: TIME_EARLY_OVERUSE_MIN_PEER_GAMES,
      pressureClockMaximumCentisecondsInclusive: TIME_PRESSURE_THRESHOLD_CENTISECONDS,
      qualityMatchingDimensions: ['EXACT_TIME_CONTROL', 'PHASE'],
    },
    coverage: {
      status,
      reason,
      candidateGames: games.length,
      timingEligibleGames,
      unsupportedGames,
      earlyCoveredGames,
      earlyCoveragePercent,
      peerBaselineGames,
      peerBaselineCoveragePercent,
      earlyOveruseGames,
      laterPressureEvaluableGames,
      laterPressureGames,
      laterPressureCoveragePercent,
      qualityEvaluableGames,
      laterDegradationGames,
      qualityGameCoveragePercent,
      knownPressureMoves,
      matchedAnalysedPressureMoves,
      qualityMoveCoveragePercent,
      normalQualityBaselineMoves,
      analysedNormalQualityBaselineMoves,
      normalQualityBaselineAnalysisCoveragePercent,
      normalQualityBaselineGames: usedBaselineGameIds.size,
      maxCandidateGames: EARLY_TIME_OVERUSE_MAX_CANDIDATE_GAMES,
      exclusions: {
        missingExactControlGames,
        earlyPhaseUnavailableGames,
        earlyTimingIncompleteGames,
        peerBaselineTooSmallGames,
        laterTimingIncompleteGames,
        qualityEvidenceUnavailableGames,
      },
    },
    chain: {
      earlyOveruseGames,
      overuseWithoutLaterPressureGames,
      laterPressureGames,
      pressureWithoutQualityEvidenceGames,
      pressureWithoutDegradationGames,
      laterDegradationGames,
      completeChainGames,
      pressureRateAmongEvaluableOverusePercent: timingBehaviorPercentage(
        laterPressureGames,
        laterPressureEvaluableGames,
      ),
      degradationRateAmongQualityEvaluablePressurePercent: timingBehaviorPercentage(
        laterDegradationGames,
        qualityEvaluableGames,
      ),
      averageEarlyExcessPercent: average(earlyExcesses),
      averageLaterScoreLossDeltaCp: average(qualityDeltas),
      evidenceStrength,
      mechanismStatus,
    },
    controls,
    games: gameEvidence,
    analysisProvenance: provenanceFor(contributingAnalysisRuns),
    caveats,
  };
}

export async function getEarlyTimeOveruse(
  appUserId: number,
  scope: EarlyTimeOveruseScope,
  repository: EarlyTimeOveruseRepository,
): Promise<EarlyTimeOveruseResult> {
  validateScope(scope);
  const candidateGames = await repository.countCandidates(appUserId, scope);

  if (candidateGames > EARLY_TIME_OVERUSE_MAX_CANDIDATE_GAMES) {
    return unavailable(candidateGames, 'early-time-overuse-scope-too-large');
  }
  if (candidateGames === 0) return unavailable(0, 'no-candidate-games');

  const games = await repository.loadCandidates(appUserId, scope);
  if (games.length !== candidateGames) {
    return unavailable(candidateGames, 'candidate-set-changed-during-read');
  }

  return buildEarlyTimeOveruseAggregate(games);
}
