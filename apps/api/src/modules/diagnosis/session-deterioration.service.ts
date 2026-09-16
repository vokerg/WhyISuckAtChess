import {
  getSessionContext,
  type GameSession,
  type GameSessionContext,
  type SessionizationRepository,
  type SessionizationResult,
  type SessionizationScope,
} from '../sessions/sessionization.service';

export const SESSION_DETERIORATION_POLICY_VERSION = 'session-deterioration-v1';
export const SESSION_DETERIORATION_EARLY_MAX_ORDINAL = 3;
export const SESSION_DETERIORATION_LATE_MIN_ORDINAL = 4;
export const SESSION_DETERIORATION_MIN_ANALYSIS_COVERAGE_PCT = 50;

export type DiagnosticEvidenceStrength = 'INSUFFICIENT' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface SessionGameQuality {
  importedGameId: number;
  analysedUserMoves: number;
  averageScoreLossCp: number | null;
  majorErrorMoves: number;
  blunderMoves: number;
}

export interface SessionDeteriorationRepository {
  loadGameQuality(appUserId: number, importedGameIds: readonly number[]): Promise<SessionGameQuality[]>;
}

export interface SessionDeteriorationArm {
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

export interface SessionDeteriorationResult {
  diagnosisId: 'SESSION-001';
  policyVersion: string;
  sessionizationPolicyVersion: string;
  coverage: {
    status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
    reason: string | null;
    candidateGames: number;
    sessionCoveredGames: number;
    sessionUncoveredGames: number;
    analysedGames: number;
    analysisCoveragePercent: number | null;
  };
  comparison: {
    early: SessionDeteriorationArm;
    late: SessionDeteriorationArm;
    averageScoreLossDeltaCp: number | null;
    majorErrorRateDeltaPercent: number | null;
    blunderRateDeltaPercent: number | null;
    evidenceStrength: DiagnosticEvidenceStrength;
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

function delta(late: number | null, early: number | null): number | null {
  return late === null || early === null ? null : roundMetric(late - early);
}

function analysed(row: SessionGameQuality | undefined): row is SessionGameQuality {
  return Boolean(
    row
    && row.analysedUserMoves > 0
    && row.averageScoreLossCp !== null
    && Number.isFinite(row.averageScoreLossCp),
  );
}

function armSummary(
  contexts: readonly ContextRow[],
  qualityByGame: ReadonlyMap<number, SessionGameQuality>,
): SessionDeteriorationArm {
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

export function comparativeEvidenceStrength(
  early: Pick<SessionDeteriorationArm, 'analysedGames' | 'analysisCoveragePercent'>,
  late: Pick<SessionDeteriorationArm, 'analysedGames' | 'analysisCoveragePercent'>,
): DiagnosticEvidenceStrength {
  if (
    early.analysisCoveragePercent === null
    || late.analysisCoveragePercent === null
    || early.analysisCoveragePercent < SESSION_DETERIORATION_MIN_ANALYSIS_COVERAGE_PCT
    || late.analysisCoveragePercent < SESSION_DETERIORATION_MIN_ANALYSIS_COVERAGE_PCT
  ) {
    return 'INSUFFICIENT';
  }

  const weakerArm = Math.min(early.analysedGames, late.analysedGames);
  if (weakerArm < 5) return 'INSUFFICIENT';
  if (weakerArm < 15) return 'LOW';
  if (weakerArm < 40) return 'MEDIUM';
  return 'HIGH';
}

function flattenedContexts(sessions: readonly GameSession[]): ContextRow[] {
  return sessions.flatMap((session) => session.games.map((game) => ({
    ...game,
    sessionKey: session.sessionKey,
  })));
}

function resultCoverage(
  sessionization: SessionizationResult,
  analysedGames: number,
): SessionDeteriorationResult['coverage'] {
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

function emptyArm(): SessionDeteriorationArm {
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
): SessionDeteriorationResult {
  return {
    diagnosisId: 'SESSION-001',
    policyVersion: SESSION_DETERIORATION_POLICY_VERSION,
    sessionizationPolicyVersion: sessionization.policyVersion,
    coverage: {
      ...resultCoverage(sessionization, 0),
      status: 'UNAVAILABLE',
      reason,
    },
    comparison: {
      early: emptyArm(),
      late: emptyArm(),
      averageScoreLossDeltaCp: null,
      majorErrorRateDeltaPercent: null,
      blunderRateDeltaPercent: null,
      evidenceStrength: 'INSUFFICIENT',
    },
    caveats: ['No late-session conclusion is available from this aggregate.'],
  };
}

export function buildSessionDeteriorationAggregate(
  sessionization: SessionizationResult,
  qualityRows: readonly SessionGameQuality[],
): SessionDeteriorationResult {
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

  const earlyContexts = contexts.filter(
    (row) => row.ordinal <= SESSION_DETERIORATION_EARLY_MAX_ORDINAL,
  );
  const lateContexts = contexts.filter(
    (row) => row.ordinal >= SESSION_DETERIORATION_LATE_MIN_ORDINAL,
  );
  const early = armSummary(earlyContexts, qualityByGame);
  const late = armSummary(lateContexts, qualityByGame);
  const analysedGames = qualityRows.filter((row) => analysed(row)).length;
  const caveats = [
    'This is a within-player association, not evidence that session length causes worse play.',
    'Only sessions reaching game 4 can contribute to the late arm, so short-session versus long-session composition can confound the raw comparison.',
    'The v1 comparison does not yet match exact time control, opponent strength, opening mix, or time of day.',
  ];
  if (sessionization.coverage.status !== 'COMPLETE') {
    caveats.push('Some candidate games lack trustworthy session chronology and are excluded.');
  }
  if (early.analysedSessions < 2 || late.analysedSessions < 2) {
    caveats.push('One comparison arm has analysis from fewer than two distinct sessions.');
  }

  return {
    diagnosisId: 'SESSION-001',
    policyVersion: SESSION_DETERIORATION_POLICY_VERSION,
    sessionizationPolicyVersion: sessionization.policyVersion,
    coverage: resultCoverage(sessionization, analysedGames),
    comparison: {
      early,
      late,
      averageScoreLossDeltaCp: delta(late.averageScoreLossCp, early.averageScoreLossCp),
      majorErrorRateDeltaPercent: delta(late.majorErrorRatePercent, early.majorErrorRatePercent),
      blunderRateDeltaPercent: delta(late.blunderRatePercent, early.blunderRatePercent),
      evidenceStrength: comparativeEvidenceStrength(early, late),
    },
    caveats,
  };
}

export async function getSessionDeterioration(
  appUserId: number,
  scope: SessionizationScope,
  sessionRepository: SessionizationRepository,
  repository: SessionDeteriorationRepository,
): Promise<SessionDeteriorationResult> {
  const sessionization = await getSessionContext(appUserId, scope, sessionRepository);
  if (sessionization.coverage.status === 'UNAVAILABLE') {
    return buildSessionDeteriorationAggregate(sessionization, []);
  }

  const importedGameIds = flattenedContexts(sessionization.sessions)
    .map((row) => row.importedGameId);
  const qualityRows = importedGameIds.length
    ? await repository.loadGameQuality(appUserId, importedGameIds)
    : [];

  return buildSessionDeteriorationAggregate(sessionization, qualityRows);
}
