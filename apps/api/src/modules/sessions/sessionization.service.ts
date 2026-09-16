export const SESSIONIZATION_POLICY_VERSION = 'session-v1';
export const SESSION_MAX_INTER_GAME_GAP_MS = 30 * 60 * 1000;
export const SESSIONIZATION_MAX_CANDIDATE_GAMES = 5000;

export type SessionizationCoverageStatus = 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';

export interface SessionizationScope {
  from?: Date;
  to?: Date;
}

export interface SessionSourceGame {
  importedGameId: number;
  startedAt: Date | null;
  endedAt: Date | null;
  resultForUser: string | null;
}

export type SessionizationUncoveredReason =
  | 'MISSING_STARTED_AT'
  | 'MISSING_ENDED_AT'
  | 'INVALID_INTERVAL';

export interface SessionizationUncoveredGame {
  importedGameId: number;
  reason: SessionizationUncoveredReason;
}

export interface GameSessionContext {
  importedGameId: number;
  ordinal: number;
  elapsedFromSessionStartMs: number;
  interGameGapMs: number | null;
  priorLossStreak: number;
}

export interface GameSession {
  sessionKey: string;
  startedAt: Date;
  endedAt: Date;
  gameCount: number;
  games: GameSessionContext[];
}

export interface SessionizationCoverage {
  status: SessionizationCoverageStatus;
  reason: string | null;
  candidateGames: number;
  coveredGames: number;
  uncoveredGames: SessionizationUncoveredGame[];
  maxCandidateGames: number;
}

export interface SessionizationResult {
  policyVersion: string;
  maxInterGameGapMs: number;
  coverage: SessionizationCoverage;
  sessions: GameSession[];
}

export interface SessionizationRepository {
  countCandidates(appUserId: number, scope: SessionizationScope): Promise<number>;
  loadCandidates(appUserId: number, scope: SessionizationScope): Promise<SessionSourceGame[]>;
}

interface WorkingSession {
  sessionKey: string;
  startedAt: Date;
  endedAt: Date;
  games: GameSessionContext[];
  previousGame: SessionSourceGame;
  priorLossStreak: number;
}

function compareGames(left: SessionSourceGame, right: SessionSourceGame): number {
  if (left.startedAt && right.startedAt) {
    const time = left.startedAt.getTime() - right.startedAt.getTime();
    if (time !== 0) return time;
  } else if (left.startedAt) {
    return -1;
  } else if (right.startedAt) {
    return 1;
  }
  return left.importedGameId - right.importedGameId;
}

function uncoveredReason(game: SessionSourceGame): SessionizationUncoveredReason | null {
  if (!game.startedAt) return 'MISSING_STARTED_AT';
  if (!game.endedAt) return 'MISSING_ENDED_AT';
  if (game.endedAt.getTime() < game.startedAt.getTime()) return 'INVALID_INTERVAL';
  return null;
}

function sessionKey(firstGame: SessionSourceGame): string {
  return `${SESSIONIZATION_POLICY_VERSION}:${firstGame.importedGameId}`;
}

function nextLossStreak(current: number, resultForUser: string | null): number {
  return resultForUser === 'LOSS' ? current + 1 : 0;
}

function finalizeSession(session: WorkingSession): GameSession {
  return {
    sessionKey: session.sessionKey,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    gameCount: session.games.length,
    games: session.games,
  };
}

function unavailable(
  reason: string,
  candidateGames: number,
): SessionizationResult {
  return {
    policyVersion: SESSIONIZATION_POLICY_VERSION,
    maxInterGameGapMs: SESSION_MAX_INTER_GAME_GAP_MS,
    coverage: {
      status: 'UNAVAILABLE',
      reason,
      candidateGames,
      coveredGames: 0,
      uncoveredGames: [],
      maxCandidateGames: SESSIONIZATION_MAX_CANDIDATE_GAMES,
    },
    sessions: [],
  };
}

export function sessionizeGames(games: readonly SessionSourceGame[]): SessionizationResult {
  if (games.length === 0) return unavailable('no-candidate-games', 0);

  const ordered = [...games].sort(compareGames);
  const uncoveredGames: SessionizationUncoveredGame[] = [];
  const valid: SessionSourceGame[] = [];

  for (const game of ordered) {
    const reason = uncoveredReason(game);
    if (reason) {
      uncoveredGames.push({ importedGameId: game.importedGameId, reason });
    } else {
      valid.push(game);
    }
  }

  uncoveredGames.sort((left, right) => left.importedGameId - right.importedGameId);

  if (valid.length === 0) {
    return {
      ...unavailable('session-chronology-unavailable', games.length),
      coverage: {
        status: 'UNAVAILABLE',
        reason: 'session-chronology-unavailable',
        candidateGames: games.length,
        coveredGames: 0,
        uncoveredGames,
        maxCandidateGames: SESSIONIZATION_MAX_CANDIDATE_GAMES,
      },
    };
  }

  const sessions: GameSession[] = [];
  let current: WorkingSession | null = null;

  for (const game of valid) {
    const startedAt = game.startedAt as Date;
    const endedAt = game.endedAt as Date;
    const gapMs = current
      ? Math.max(0, startedAt.getTime() - (current.previousGame.endedAt as Date).getTime())
      : null;
    const startsNewSession = !current
      || (gapMs !== null && gapMs > SESSION_MAX_INTER_GAME_GAP_MS);

    if (startsNewSession) {
      if (current) sessions.push(finalizeSession(current));
      current = {
        sessionKey: sessionKey(game),
        startedAt,
        endedAt,
        games: [],
        previousGame: game,
        priorLossStreak: 0,
      };
    }

    const active = current as WorkingSession;
    const actualGapMs = active.games.length === 0
      ? null
      : Math.max(0, startedAt.getTime() - (active.previousGame.endedAt as Date).getTime());

    active.games.push({
      importedGameId: game.importedGameId,
      ordinal: active.games.length + 1,
      elapsedFromSessionStartMs: startedAt.getTime() - active.startedAt.getTime(),
      interGameGapMs: actualGapMs,
      priorLossStreak: active.priorLossStreak,
    });
    if (endedAt.getTime() > active.endedAt.getTime()) active.endedAt = endedAt;
    active.priorLossStreak = nextLossStreak(active.priorLossStreak, game.resultForUser);
    active.previousGame = game;
  }

  if (current) sessions.push(finalizeSession(current));

  return {
    policyVersion: SESSIONIZATION_POLICY_VERSION,
    maxInterGameGapMs: SESSION_MAX_INTER_GAME_GAP_MS,
    coverage: {
      status: uncoveredGames.length > 0 ? 'PARTIAL' : 'COMPLETE',
      reason: uncoveredGames.length > 0 ? 'session-chronology-incomplete' : null,
      candidateGames: games.length,
      coveredGames: valid.length,
      uncoveredGames,
      maxCandidateGames: SESSIONIZATION_MAX_CANDIDATE_GAMES,
    },
    sessions,
  };
}

function validateScope(scope: SessionizationScope): void {
  if (
    scope.from
    && scope.to
    && scope.from.getTime() >= scope.to.getTime()
  ) {
    throw new RangeError('Sessionization scope "from" must be earlier than "to".');
  }
}

export async function getSessionContext(
  appUserId: number,
  scope: SessionizationScope,
  repository: SessionizationRepository,
): Promise<SessionizationResult> {
  validateScope(scope);
  const candidateGames = await repository.countCandidates(appUserId, scope);

  if (candidateGames > SESSIONIZATION_MAX_CANDIDATE_GAMES) {
    return unavailable('sessionization-scope-too-large', candidateGames);
  }
  if (candidateGames === 0) return unavailable('no-candidate-games', 0);

  const games = await repository.loadCandidates(appUserId, scope);
  if (games.length !== candidateGames) {
    return unavailable('candidate-set-changed-during-read', candidateGames);
  }

  return sessionizeGames(games);
}
