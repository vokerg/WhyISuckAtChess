import {
  getSessionContext,
  type GameSession,
  type GameSessionContext,
  type SessionizationRepository,
  type SessionizationResult,
  type SessionizationScope,
} from '../sessions/sessionization.service';
import type {
  DiagnosticEvidenceStrength,
  SessionGameQuality,
  SessionGameQualityRepository,
} from './session-deterioration.service';

export const OVERLONG_SESSION_STOPPING_POINT_POLICY_VERSION = 'overlong-session-stopping-point-v1';
export const OVERLONG_SESSION_CANDIDATE_THRESHOLDS = [4, 5, 6, 7, 8, 9, 10] as const;
export const OVERLONG_SESSION_MIN_ANALYSIS_COVERAGE_PCT = 50;
export const OVERLONG_SESSION_MIN_COMPARABLE_SESSIONS = 5;
export const OVERLONG_SESSION_MIN_RECURRENCE_PCT = 60;
export const OVERLONG_SESSION_MIN_SCORE_LOSS_DELTA_CP = 10;
export const OVERLONG_SESSION_MIN_MAJOR_ERROR_DELTA_PCT = 2;
export const OVERLONG_SESSION_MIN_BLUNDER_DELTA_PCT = 1;

export type OverlongSessionEvidenceStrength = DiagnosticEvidenceStrength;

export interface OverlongSessionArm {
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

export interface OverlongSessionCandidateSummary {
  threshold: number;
  coverage: {
    status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
    reason: string | null;
    sessionsReachingThreshold: number;
    comparableSessions: number;
    analysedComparableSessions: number;
    preThresholdCandidateGames: number;
    thresholdAndLaterCandidateGames: number;
    missingTimeControlGames: number;
    matchedPreThresholdGames: number;
    matchedThresholdAndLaterGames: number;
    unmatchedPreThresholdGames: number;
    unmatchedThresholdAndLaterGames: number;
    matchedStrata: number;
  };
  comparison: {
    preThreshold: OverlongSessionArm;
    thresholdAndLater: OverlongSessionArm;
    averageScoreLossDeltaCp: number | null;
    majorErrorRateDeltaPercent: number | null;
    blunderRateDeltaPercent: number | null;
    deterioratingSessions: number;
    recurrencePercent: number | null;
    broadDeterioration: boolean;
    evidenceStrength: OverlongSessionEvidenceStrength;
    supported: boolean;
  };
}

export interface OverlongSessionStoppingPointResult {
  diagnosisId: 'SESSION-003';
  policyVersion: string;
  sessionizationPolicyVersion: string;
  candidateThresholds: readonly number[];
  selectedThreshold: number | null;
  coverage: {
    status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
    reason: string | null;
    candidateGames: number;
    sessionCoveredGames: number;
    sessionUncoveredGames: number;
    analysedGames: number;
    analysisCoveragePercent: number | null;
  };
  candidates: OverlongSessionCandidateSummary[];
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

function emptyArm(): OverlongSessionArm {
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

function armSummary(
  contexts: readonly ContextRow[],
  qualityByGame: ReadonlyMap<number, SessionGameQuality>,
): OverlongSessionArm {
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

function candidateThresholdSetMatches(candidateThresholds: readonly number[]): boolean {
  return candidateThresholds.length === OVERLONG_SESSION_CANDIDATE_THRESHOLDS.length
    && candidateThresholds.every(
      (threshold, index) => threshold === OVERLONG_SESSION_CANDIDATE_THRESHOLDS[index],
    );
}

function exactTimeControlKey(
  context: ContextRow,
  qualityByGame: ReadonlyMap<number, SessionGameQuality>,
): string | null {
  return qualityByGame.get(context.importedGameId)?.exactTimeControlKey ?? null;
}

function stratumKey(
  context: ContextRow,
  qualityByGame: ReadonlyMap<number, SessionGameQuality>,
): string | null {
  const control = exactTimeControlKey(context, qualityByGame);
  return control ? context.sessionKey + '|' + control : null;
}

function broadDeterioration(
  averageScoreLossDeltaCp: number | null,
  majorErrorRateDeltaPercent: number | null,
  blunderRateDeltaPercent: number | null,
): boolean {
  if (
    averageScoreLossDeltaCp === null
    || averageScoreLossDeltaCp < OVERLONG_SESSION_MIN_SCORE_LOSS_DELTA_CP
  ) {
    return false;
  }

  return (
    majorErrorRateDeltaPercent !== null
    && majorErrorRateDeltaPercent >= OVERLONG_SESSION_MIN_MAJOR_ERROR_DELTA_PCT
  ) || (
    blunderRateDeltaPercent !== null
    && blunderRateDeltaPercent >= OVERLONG_SESSION_MIN_BLUNDER_DELTA_PCT
  );
}

export function overlongSessionEvidenceStrength(
  preThreshold: Pick<OverlongSessionArm, 'analysisCoveragePercent'>,
  thresholdAndLater: Pick<OverlongSessionArm, 'analysisCoveragePercent'>,
  analysedComparableSessions: number,
): OverlongSessionEvidenceStrength {
  if (
    preThreshold.analysisCoveragePercent === null
    || thresholdAndLater.analysisCoveragePercent === null
    || preThreshold.analysisCoveragePercent < OVERLONG_SESSION_MIN_ANALYSIS_COVERAGE_PCT
    || thresholdAndLater.analysisCoveragePercent < OVERLONG_SESSION_MIN_ANALYSIS_COVERAGE_PCT
    || analysedComparableSessions < OVERLONG_SESSION_MIN_COMPARABLE_SESSIONS
  ) {
    return 'INSUFFICIENT';
  }

  if (analysedComparableSessions < 15) return 'LOW';
  if (analysedComparableSessions < 40) return 'MEDIUM';
  return 'HIGH';
}

function candidateSummary(
  threshold: number,
  sessionization: SessionizationResult,
  qualityByGame: ReadonlyMap<number, SessionGameQuality>,
): OverlongSessionCandidateSummary {
  const sessionsReachingThreshold = sessionization.sessions.filter(
    (session) => session.games.some((game) => game.ordinal >= threshold),
  );
  const contexts = flattenedContexts(sessionsReachingThreshold);
  const preThresholdCandidates = contexts.filter((context) => context.ordinal < threshold);
  const thresholdAndLaterCandidates = contexts.filter((context) => context.ordinal >= threshold);

  const preKeys = new Set(
    preThresholdCandidates
      .map((context) => stratumKey(context, qualityByGame))
      .filter((key): key is string => key !== null),
  );
  const postKeys = new Set(
    thresholdAndLaterCandidates
      .map((context) => stratumKey(context, qualityByGame))
      .filter((key): key is string => key !== null),
  );
  const matchedKeys = new Set([...preKeys].filter((key) => postKeys.has(key)));

  const matchedPreThreshold = preThresholdCandidates.filter((context) => {
    const key = stratumKey(context, qualityByGame);
    return key !== null && matchedKeys.has(key);
  });
  const matchedThresholdAndLater = thresholdAndLaterCandidates.filter((context) => {
    const key = stratumKey(context, qualityByGame);
    return key !== null && matchedKeys.has(key);
  });

  const missingTimeControlGames = [...preThresholdCandidates, ...thresholdAndLaterCandidates]
    .filter((context) => exactTimeControlKey(context, qualityByGame) === null)
    .length;
  const unmatchedPreThresholdGames = preThresholdCandidates.filter((context) => {
    const key = stratumKey(context, qualityByGame);
    return key !== null && !matchedKeys.has(key);
  }).length;
  const unmatchedThresholdAndLaterGames = thresholdAndLaterCandidates.filter((context) => {
    const key = stratumKey(context, qualityByGame);
    return key !== null && !matchedKeys.has(key);
  }).length;

  const preThreshold = armSummary(matchedPreThreshold, qualityByGame);
  const thresholdAndLater = armSummary(matchedThresholdAndLater, qualityByGame);
  const averageScoreLossDeltaCp = delta(
    thresholdAndLater.averageScoreLossCp,
    preThreshold.averageScoreLossCp,
  );
  const majorErrorRateDeltaPercent = delta(
    thresholdAndLater.majorErrorRatePercent,
    preThreshold.majorErrorRatePercent,
  );
  const blunderRateDeltaPercent = delta(
    thresholdAndLater.blunderRatePercent,
    preThreshold.blunderRatePercent,
  );

  const comparableSessionKeys = new Set([
    ...matchedPreThreshold.map((context) => context.sessionKey),
    ...matchedThresholdAndLater.map((context) => context.sessionKey),
  ]);
  let analysedComparableSessions = 0;
  let deterioratingSessions = 0;

  for (const sessionKey of comparableSessionKeys) {
    const sessionPre = armSummary(
      matchedPreThreshold.filter((context) => context.sessionKey === sessionKey),
      qualityByGame,
    );
    const sessionPost = armSummary(
      matchedThresholdAndLater.filter((context) => context.sessionKey === sessionKey),
      qualityByGame,
    );
    if (sessionPre.analysedGames === 0 || sessionPost.analysedGames === 0) continue;

    analysedComparableSessions += 1;
    if (broadDeterioration(
      delta(sessionPost.averageScoreLossCp, sessionPre.averageScoreLossCp),
      delta(sessionPost.majorErrorRatePercent, sessionPre.majorErrorRatePercent),
      delta(sessionPost.blunderRatePercent, sessionPre.blunderRatePercent),
    )) {
      deterioratingSessions += 1;
    }
  }

  const recurrencePercent = percentage(deterioratingSessions, analysedComparableSessions);
  const isBroadDeterioration = broadDeterioration(
    averageScoreLossDeltaCp,
    majorErrorRateDeltaPercent,
    blunderRateDeltaPercent,
  );
  const evidenceStrength = overlongSessionEvidenceStrength(
    preThreshold,
    thresholdAndLater,
    analysedComparableSessions,
  );
  const supported = evidenceStrength !== 'INSUFFICIENT'
    && isBroadDeterioration
    && recurrencePercent !== null
    && recurrencePercent >= OVERLONG_SESSION_MIN_RECURRENCE_PCT;

  const comparisonAvailable = matchedPreThreshold.length > 0
    && matchedThresholdAndLater.length > 0;
  const complete = comparisonAvailable
    && sessionization.coverage.status === 'COMPLETE'
    && missingTimeControlGames === 0
    && unmatchedPreThresholdGames === 0
    && unmatchedThresholdAndLaterGames === 0
    && preThreshold.analysedGames === matchedPreThreshold.length
    && thresholdAndLater.analysedGames === matchedThresholdAndLater.length;

  let reason: string | null = null;
  if (sessionsReachingThreshold.length === 0) reason = 'no-sessions-reach-threshold';
  else if (!comparisonAvailable) reason = 'no-matched-session-control-strata';
  else if (sessionization.coverage.status !== 'COMPLETE') {
    reason = sessionization.coverage.reason ?? 'session-chronology-incomplete';
  } else if (missingTimeControlGames > 0) reason = 'exact-time-control-incomplete';
  else if (unmatchedPreThresholdGames > 0 || unmatchedThresholdAndLaterGames > 0) {
    reason = 'comparison-strata-unmatched';
  } else if (
    preThreshold.analysedGames !== matchedPreThreshold.length
    || thresholdAndLater.analysedGames !== matchedThresholdAndLater.length
  ) {
    reason = 'engine-analysis-incomplete';
  }

  return {
    threshold,
    coverage: {
      status: !comparisonAvailable ? 'UNAVAILABLE' : complete ? 'COMPLETE' : 'PARTIAL',
      reason,
      sessionsReachingThreshold: sessionsReachingThreshold.length,
      comparableSessions: comparableSessionKeys.size,
      analysedComparableSessions,
      preThresholdCandidateGames: preThresholdCandidates.length,
      thresholdAndLaterCandidateGames: thresholdAndLaterCandidates.length,
      missingTimeControlGames,
      matchedPreThresholdGames: matchedPreThreshold.length,
      matchedThresholdAndLaterGames: matchedThresholdAndLater.length,
      unmatchedPreThresholdGames,
      unmatchedThresholdAndLaterGames,
      matchedStrata: matchedKeys.size,
    },
    comparison: {
      preThreshold,
      thresholdAndLater,
      averageScoreLossDeltaCp,
      majorErrorRateDeltaPercent,
      blunderRateDeltaPercent,
      deterioratingSessions,
      recurrencePercent,
      broadDeterioration: isBroadDeterioration,
      evidenceStrength,
      supported,
    },
  };
}

function resultCoverage(
  sessionization: SessionizationResult,
  qualityRows: readonly SessionGameQuality[],
): OverlongSessionStoppingPointResult['coverage'] {
  const analysedGames = qualityRows.filter((row) => analysed(row)).length;
  const sessionCoveredGames = sessionization.coverage.coveredGames;
  const analysisCoveragePercent = percentage(analysedGames, sessionCoveredGames);

  if (sessionization.coverage.status === 'UNAVAILABLE' || sessionCoveredGames === 0) {
    return {
      status: 'UNAVAILABLE',
      reason: sessionization.coverage.reason,
      candidateGames: sessionization.coverage.candidateGames,
      sessionCoveredGames,
      sessionUncoveredGames: sessionization.coverage.uncoveredGames.length,
      analysedGames,
      analysisCoveragePercent,
    };
  }

  const complete = sessionization.coverage.status === 'COMPLETE'
    && analysedGames === sessionCoveredGames;
  return {
    status: complete ? 'COMPLETE' : 'PARTIAL',
    reason: complete
      ? null
      : sessionization.coverage.reason ?? 'engine-analysis-incomplete',
    candidateGames: sessionization.coverage.candidateGames,
    sessionCoveredGames,
    sessionUncoveredGames: sessionization.coverage.uncoveredGames.length,
    analysedGames,
    analysisCoveragePercent,
  };
}

function unavailable(
  sessionization: SessionizationResult,
  reason: string,
): OverlongSessionStoppingPointResult {
  return {
    diagnosisId: 'SESSION-003',
    policyVersion: OVERLONG_SESSION_STOPPING_POINT_POLICY_VERSION,
    sessionizationPolicyVersion: sessionization.policyVersion,
    candidateThresholds: [...OVERLONG_SESSION_CANDIDATE_THRESHOLDS],
    selectedThreshold: null,
    coverage: {
      ...resultCoverage(sessionization, []),
      status: 'UNAVAILABLE',
      reason,
    },
    candidates: [],
    caveats: ['No stable overlong-session stopping point is available from this aggregate.'],
  };
}

export function buildOverlongSessionStoppingPointAggregate(
  sessionization: SessionizationResult,
  qualityRows: readonly SessionGameQuality[],
  candidateThresholds: readonly number[] = OVERLONG_SESSION_CANDIDATE_THRESHOLDS,
): OverlongSessionStoppingPointResult {
  if (!candidateThresholdSetMatches(candidateThresholds)) {
    return unavailable(sessionization, 'candidate-threshold-set-mismatch');
  }
  if (sessionization.coverage.status === 'UNAVAILABLE') {
    return unavailable(sessionization, sessionization.coverage.reason ?? 'session-context-unavailable');
  }

  const contexts = flattenedContexts(sessionization.sessions);
  const expected = new Set(contexts.map((row) => row.importedGameId));
  if (
    qualityRows.length !== expected.size
    || qualityRows.some((row) => !expected.has(row.importedGameId))
  ) {
    return unavailable(sessionization, 'session-game-set-changed-during-quality-read');
  }

  const qualityByGame = new Map<number, SessionGameQuality>();
  for (const row of qualityRows) {
    if (qualityByGame.has(row.importedGameId)) {
      throw new Error('Duplicate session game quality row: ' + row.importedGameId);
    }
    qualityByGame.set(row.importedGameId, row);
  }

  const candidates = OVERLONG_SESSION_CANDIDATE_THRESHOLDS.map((threshold) => (
    candidateSummary(threshold, sessionization, qualityByGame)
  ));
  const selectedThreshold = candidates.find((candidate) => candidate.comparison.supported)?.threshold ?? null;

  const caveats = [
    'This is a within-player behavioral association and does not establish fatigue, tilt, or another psychological cause.',
    'Only fixed game-count thresholds 4 through 10 are evaluated; changing the candidate set requires a policy-version change.',
    'Pre-threshold and threshold-and-later games are compared only inside shared session + exact-time-control strata.',
    'The v1 broad-deterioration rule requires at least +10cp average score loss plus either +2 percentage points major-error rate or +1 percentage point blunder rate.',
    'A supported threshold must recur materially in at least 60% of at least five analysed comparable sessions with at least 50% analysis coverage in both arms.',
    'Opponent strength, opening mix, color, local time, and unequal matched-stratum sizes can still confound the measured association.',
  ];
  if (sessionization.coverage.status !== 'COMPLETE') {
    caveats.push('Some candidate games lack trustworthy session chronology and are excluded.');
  }

  return {
    diagnosisId: 'SESSION-003',
    policyVersion: OVERLONG_SESSION_STOPPING_POINT_POLICY_VERSION,
    sessionizationPolicyVersion: sessionization.policyVersion,
    candidateThresholds: [...OVERLONG_SESSION_CANDIDATE_THRESHOLDS],
    selectedThreshold,
    coverage: resultCoverage(sessionization, qualityRows),
    candidates,
    caveats,
  };
}

export async function getOverlongSessionStoppingPoint(
  appUserId: number,
  scope: SessionizationScope,
  sessionRepository: SessionizationRepository,
  repository: SessionGameQualityRepository,
): Promise<OverlongSessionStoppingPointResult> {
  const sessionization = await getSessionContext(appUserId, scope, sessionRepository);
  if (sessionization.coverage.status === 'UNAVAILABLE') {
    return buildOverlongSessionStoppingPointAggregate(sessionization, []);
  }

  const importedGameIds = flattenedContexts(sessionization.sessions)
    .map((row) => row.importedGameId);
  const qualityRows = importedGameIds.length
    ? await repository.loadGameQuality(appUserId, importedGameIds)
    : [];

  return buildOverlongSessionStoppingPointAggregate(sessionization, qualityRows);
}
