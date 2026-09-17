import {
  getSessionContext,
  type GameSession,
  type GameSessionContext,
  type SessionizationRepository,
  type SessionizationResult,
  type SessionizationScope,
} from '../sessions/sessionization.service';
import type {
  SessionGameQuality,
  SessionGameQualityRepository,
} from './session-deterioration.service';

export const LOSS_STREAK_DETERIORATION_POLICY_VERSION = 'loss-streak-deterioration-v1';
export const LOSS_STREAK_DETERIORATION_MIN_PRIOR_LOSSES = 2;
export const LOSS_STREAK_DETERIORATION_BASELINE_PRIOR_LOSSES = 0;
export const LOSS_STREAK_DETERIORATION_MIN_MATCH_ORDINAL = 3;
export const LOSS_STREAK_DETERIORATION_MIN_ANALYSIS_COVERAGE_PCT = 50;

export type LossStreakEvidenceStrength = 'INSUFFICIENT' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface LossStreakDeteriorationArm {
  eligibleGames: number;
  analysedGames: number;
  eligibleSessions: number;
  analysedSessions: number;
  analysisCoveragePercent: number | null;
  analysedUserMoves: number;
  averageScoreLossCp: number | null;
  majorErrorRatePercent: number | null;
  blunderRatePercent: number | null;
}

export interface LossStreakDeteriorationResult {
  diagnosisId: 'SESSION-002';
  policyVersion: string;
  sessionizationPolicyVersion: string;
  coverage: {
    status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
    reason: string | null;
    candidateGames: number;
    sessionCoveredGames: number;
    sessionUncoveredGames: number;
    baselineCandidateGames: number;
    streakCandidateGames: number;
    excludedPreStreakOrdinalGames: number;
    excludedSingleLossGames: number;
    missingTimeControlGames: number;
    matchedBaselineGames: number;
    matchedStreakGames: number;
    unmatchedBaselineGames: number;
    unmatchedStreakGames: number;
    matchedStrata: number;
    analysedMatchedGames: number;
    analysisCoveragePercent: number | null;
  };
  comparison: {
    baseline: LossStreakDeteriorationArm;
    afterLossStreak: LossStreakDeteriorationArm;
    averageScoreLossDeltaCp: number | null;
    majorErrorRateDeltaPercent: number | null;
    blunderRateDeltaPercent: number | null;
    evidenceStrength: LossStreakEvidenceStrength;
  };
  caveats: string[];
}

interface ContextRow extends GameSessionContext {
  sessionKey: string;
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator > 0 ? roundMetric((numerator / denominator) * 100) : null;
}

function delta(observed: number | null, baseline: number | null): number | null {
  return observed === null || baseline === null ? null : roundMetric(observed - baseline);
}

function analysed(row: SessionGameQuality | undefined): row is SessionGameQuality {
  return Boolean(
    row
    && row.analysedUserMoves > 0
    && row.averageScoreLossCp !== null
    && Number.isFinite(row.averageScoreLossCp),
  );
}

function flattenedContexts(sessions: readonly GameSession[]): ContextRow[] {
  return sessions.flatMap((session) => session.games.map((game) => ({
    ...game,
    sessionKey: session.sessionKey,
  })));
}

function armSummary(
  contexts: readonly ContextRow[],
  qualityByGame: ReadonlyMap<number, SessionGameQuality>,
): LossStreakDeteriorationArm {
  const eligibleSessions = new Set(contexts.map((row) => row.sessionKey));
  const analysedRows = contexts.flatMap((context) => {
    const quality = qualityByGame.get(context.importedGameId);
    return analysed(quality) ? [{ context, quality }] : [];
  });
  const analysedSessions = new Set(analysedRows.map((row) => row.context.sessionKey));
  const analysedUserMoves = analysedRows.reduce((sum, row) => sum + row.quality.analysedUserMoves, 0);
  const majorErrorMoves = analysedRows.reduce((sum, row) => sum + row.quality.majorErrorMoves, 0);
  const blunderMoves = analysedRows.reduce((sum, row) => sum + row.quality.blunderMoves, 0);
  const averageScoreLossCp = analysedRows.length
    ? roundMetric(
        analysedRows.reduce((sum, row) => sum + (row.quality.averageScoreLossCp ?? 0), 0)
          / analysedRows.length,
      )
    : null;

  return {
    eligibleGames: contexts.length,
    analysedGames: analysedRows.length,
    eligibleSessions: eligibleSessions.size,
    analysedSessions: analysedSessions.size,
    analysisCoveragePercent: percentage(analysedRows.length, contexts.length),
    analysedUserMoves,
    averageScoreLossCp,
    majorErrorRatePercent: percentage(majorErrorMoves, analysedUserMoves),
    blunderRatePercent: percentage(blunderMoves, analysedUserMoves),
  };
}

export function lossStreakComparativeEvidenceStrength(
  baseline: Pick<LossStreakDeteriorationArm, 'analysedGames' | 'analysisCoveragePercent'>,
  afterLossStreak: Pick<LossStreakDeteriorationArm, 'analysedGames' | 'analysisCoveragePercent'>,
): LossStreakEvidenceStrength {
  if (
    baseline.analysisCoveragePercent === null
    || afterLossStreak.analysisCoveragePercent === null
    || baseline.analysisCoveragePercent < LOSS_STREAK_DETERIORATION_MIN_ANALYSIS_COVERAGE_PCT
    || afterLossStreak.analysisCoveragePercent < LOSS_STREAK_DETERIORATION_MIN_ANALYSIS_COVERAGE_PCT
  ) {
    return 'INSUFFICIENT';
  }

  const weakerArm = Math.min(baseline.analysedGames, afterLossStreak.analysedGames);
  if (weakerArm < 5) return 'INSUFFICIENT';
  if (weakerArm < 15) return 'LOW';
  if (weakerArm < 40) return 'MEDIUM';
  return 'HIGH';
}

function stratumKey(
  context: ContextRow,
  qualityByGame: ReadonlyMap<number, SessionGameQuality>,
): string | null {
  const exactTimeControlKey = qualityByGame.get(context.importedGameId)?.exactTimeControlKey ?? null;
  return exactTimeControlKey
    ? context.ordinal + '|' + exactTimeControlKey
    : null;
}

function emptyCoverage(
  sessionization: SessionizationResult,
  reason: string,
): LossStreakDeteriorationResult['coverage'] {
  return {
    status: 'UNAVAILABLE',
    reason,
    candidateGames: sessionization.coverage.candidateGames,
    sessionCoveredGames: sessionization.coverage.coveredGames,
    sessionUncoveredGames: sessionization.coverage.uncoveredGames.length,
    baselineCandidateGames: 0,
    streakCandidateGames: 0,
    excludedPreStreakOrdinalGames: 0,
    excludedSingleLossGames: 0,
    missingTimeControlGames: 0,
    matchedBaselineGames: 0,
    matchedStreakGames: 0,
    unmatchedBaselineGames: 0,
    unmatchedStreakGames: 0,
    matchedStrata: 0,
    analysedMatchedGames: 0,
    analysisCoveragePercent: null,
  };
}

function emptyArm(): LossStreakDeteriorationArm {
  return {
    eligibleGames: 0,
    analysedGames: 0,
    eligibleSessions: 0,
    analysedSessions: 0,
    analysisCoveragePercent: null,
    analysedUserMoves: 0,
    averageScoreLossCp: null,
    majorErrorRatePercent: null,
    blunderRatePercent: null,
  };
}

function unavailable(
  sessionization: SessionizationResult,
  reason: string,
): LossStreakDeteriorationResult {
  return {
    diagnosisId: 'SESSION-002',
    policyVersion: LOSS_STREAK_DETERIORATION_POLICY_VERSION,
    sessionizationPolicyVersion: sessionization.policyVersion,
    coverage: emptyCoverage(sessionization, reason),
    comparison: {
      baseline: emptyArm(),
      afterLossStreak: emptyArm(),
      averageScoreLossDeltaCp: null,
      majorErrorRateDeltaPercent: null,
      blunderRateDeltaPercent: null,
      evidenceStrength: 'INSUFFICIENT',
    },
    caveats: ['No matched loss-streak comparison is available from this aggregate.'],
  };
}

export function buildLossStreakDeteriorationAggregate(
  sessionization: SessionizationResult,
  qualityRows: readonly SessionGameQuality[],
): LossStreakDeteriorationResult {
  if (sessionization.coverage.status === 'UNAVAILABLE') {
    return unavailable(sessionization, sessionization.coverage.reason ?? 'session-context-unavailable');
  }

  const contexts = flattenedContexts(sessionization.sessions);
  const qualityByGame = new Map<number, SessionGameQuality>();
  for (const row of qualityRows) {
    if (qualityByGame.has(row.importedGameId)) {
      throw new Error('Duplicate session game quality row: ' + row.importedGameId);
    }
    qualityByGame.set(row.importedGameId, row);
  }

  const expected = new Set(contexts.map((row) => row.importedGameId));
  if (
    qualityRows.length !== expected.size
    || qualityRows.some((row) => !expected.has(row.importedGameId))
  ) {
    return unavailable(sessionization, 'session-game-set-changed-during-quality-read');
  }

  const excludedPreStreakOrdinalGames = contexts
    .filter((context) => context.ordinal < LOSS_STREAK_DETERIORATION_MIN_MATCH_ORDINAL)
    .length;
  const excludedSingleLossGames = contexts
    .filter((context) => context.priorLossStreak === 1)
    .length;
  const baselineCandidates = contexts.filter(
    (context) => (
      context.ordinal >= LOSS_STREAK_DETERIORATION_MIN_MATCH_ORDINAL
      && context.priorLossStreak === LOSS_STREAK_DETERIORATION_BASELINE_PRIOR_LOSSES
    ),
  );
  const streakCandidates = contexts.filter(
    (context) => (
      context.ordinal >= LOSS_STREAK_DETERIORATION_MIN_MATCH_ORDINAL
      && context.priorLossStreak >= LOSS_STREAK_DETERIORATION_MIN_PRIOR_LOSSES
    ),
  );

  const baselineKeys = new Set(
    baselineCandidates
      .map((context) => stratumKey(context, qualityByGame))
      .filter((key): key is string => key !== null),
  );
  const streakKeys = new Set(
    streakCandidates
      .map((context) => stratumKey(context, qualityByGame))
      .filter((key): key is string => key !== null),
  );
  const matchedKeys = new Set([...baselineKeys].filter((key) => streakKeys.has(key)));

  const matchedBaseline = baselineCandidates.filter((context) => {
    const key = stratumKey(context, qualityByGame);
    return key !== null && matchedKeys.has(key);
  });
  const matchedStreak = streakCandidates.filter((context) => {
    const key = stratumKey(context, qualityByGame);
    return key !== null && matchedKeys.has(key);
  });
  const missingTimeControlGames = [...baselineCandidates, ...streakCandidates]
    .filter((context) => stratumKey(context, qualityByGame) === null)
    .length;

  const baseline = armSummary(matchedBaseline, qualityByGame);
  const afterLossStreak = armSummary(matchedStreak, qualityByGame);
  const matchedGames = matchedBaseline.length + matchedStreak.length;
  const analysedMatchedGames = baseline.analysedGames + afterLossStreak.analysedGames;
  const unmatchedBaselineGames = baselineCandidates.filter((context) => {
    const key = stratumKey(context, qualityByGame);
    return key !== null && !matchedKeys.has(key);
  }).length;
  const unmatchedStreakGames = streakCandidates.filter((context) => {
    const key = stratumKey(context, qualityByGame);
    return key !== null && !matchedKeys.has(key);
  }).length;

  const comparisonAvailable = matchedBaseline.length > 0 && matchedStreak.length > 0;
  const complete = comparisonAvailable
    && sessionization.coverage.status === 'COMPLETE'
    && missingTimeControlGames === 0
    && unmatchedBaselineGames === 0
    && unmatchedStreakGames === 0
    && analysedMatchedGames === matchedGames;

  let reason: string | null = null;
  if (!comparisonAvailable) reason = 'no-matched-loss-streak-strata';
  else if (sessionization.coverage.status !== 'COMPLETE') {
    reason = sessionization.coverage.reason ?? 'session-chronology-incomplete';
  } else if (missingTimeControlGames > 0) reason = 'exact-time-control-incomplete';
  else if (unmatchedBaselineGames > 0 || unmatchedStreakGames > 0) {
    reason = 'comparison-strata-unmatched';
  } else if (analysedMatchedGames !== matchedGames) reason = 'engine-analysis-incomplete';

  const caveats = [
    'This is a within-player association, not evidence that losing causes worse play or that the player was tilted.',
    'The v1 matcher holds session ordinal and exact time control constant by comparison stratum.',
    'Opponent strength, opening mix, color, and local time of day are not yet matched and can still confound the comparison.',
    'Matched strata are pooled with equal game weighting; unequal game counts across strata can still affect aggregate composition.',
  ];
  if (sessionization.coverage.status !== 'COMPLETE') {
    caveats.push('Some candidate games lack trustworthy session chronology and are excluded.');
  }
  if (missingTimeControlGames > 0) {
    caveats.push('Some comparison candidates lack exact time-control identity and are excluded from matching.');
  }
  if (unmatchedBaselineGames > 0 || unmatchedStreakGames > 0) {
    caveats.push('Some comparison candidates have no opposite-arm game in the same ordinal/exact-control stratum.');
  }
  if (baseline.analysedSessions < 2 || afterLossStreak.analysedSessions < 2) {
    caveats.push('One matched comparison arm has analysis from fewer than two distinct sessions.');
  }

  return {
    diagnosisId: 'SESSION-002',
    policyVersion: LOSS_STREAK_DETERIORATION_POLICY_VERSION,
    sessionizationPolicyVersion: sessionization.policyVersion,
    coverage: {
      status: !comparisonAvailable ? 'UNAVAILABLE' : complete ? 'COMPLETE' : 'PARTIAL',
      reason,
      candidateGames: sessionization.coverage.candidateGames,
      sessionCoveredGames: sessionization.coverage.coveredGames,
      sessionUncoveredGames: sessionization.coverage.uncoveredGames.length,
      baselineCandidateGames: baselineCandidates.length,
      streakCandidateGames: streakCandidates.length,
      excludedPreStreakOrdinalGames,
      excludedSingleLossGames,
      missingTimeControlGames,
      matchedBaselineGames: matchedBaseline.length,
      matchedStreakGames: matchedStreak.length,
      unmatchedBaselineGames,
      unmatchedStreakGames,
      matchedStrata: matchedKeys.size,
      analysedMatchedGames,
      analysisCoveragePercent: percentage(analysedMatchedGames, matchedGames),
    },
    comparison: {
      baseline,
      afterLossStreak,
      averageScoreLossDeltaCp: delta(afterLossStreak.averageScoreLossCp, baseline.averageScoreLossCp),
      majorErrorRateDeltaPercent: delta(
        afterLossStreak.majorErrorRatePercent,
        baseline.majorErrorRatePercent,
      ),
      blunderRateDeltaPercent: delta(
        afterLossStreak.blunderRatePercent,
        baseline.blunderRatePercent,
      ),
      evidenceStrength: lossStreakComparativeEvidenceStrength(baseline, afterLossStreak),
    },
    caveats,
  };
}

export async function getLossStreakDeterioration(
  appUserId: number,
  scope: SessionizationScope,
  sessionRepository: SessionizationRepository,
  repository: SessionGameQualityRepository,
): Promise<LossStreakDeteriorationResult> {
  const sessionization = await getSessionContext(appUserId, scope, sessionRepository);
  if (sessionization.coverage.status === 'UNAVAILABLE') {
    return buildLossStreakDeteriorationAggregate(sessionization, []);
  }

  const importedGameIds = flattenedContexts(sessionization.sessions)
    .map((row) => row.importedGameId);
  const qualityRows = importedGameIds.length
    ? await repository.loadGameQuality(appUserId, importedGameIds)
    : [];

  return buildLossStreakDeteriorationAggregate(sessionization, qualityRows);
}
