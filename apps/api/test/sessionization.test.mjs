import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import prismaModule from '../dist/prisma.js';
import {
  SESSIONIZATION_MAX_CANDIDATE_GAMES,
  SESSIONIZATION_POLICY_VERSION,
  SESSION_MAX_INTER_GAME_GAP_MS,
  getSessionContext,
  sessionizeGames,
} from '../dist/modules/sessions/sessionization.service.js';
import { prismaSessionizationRepository } from '../dist/modules/sessions/sessionization.repository.prisma.js';

const prisma = prismaModule.default ?? prismaModule;

function game(id, startedAt, endedAt, resultForUser = 'DRAW') {
  return {
    importedGameId: id,
    startedAt: startedAt ? new Date(startedAt) : null,
    endedAt: endedAt ? new Date(endedAt) : null,
    resultForUser,
  };
}

test('sessionization keeps exactly 30 minutes together and starts a new session above the boundary', () => {
  const result = sessionizeGames([
    game(3, '2026-09-16T12:01:01Z', '2026-09-16T12:05:00Z'),
    game(1, '2026-09-16T10:00:00Z', '2026-09-16T10:05:00Z'),
    game(2, '2026-09-16T10:35:00Z', '2026-09-16T10:40:00Z'),
    game(4, '2026-09-16T12:35:01Z', '2026-09-16T12:40:00Z'),
  ]);

  assert.equal(result.policyVersion, SESSIONIZATION_POLICY_VERSION);
  assert.equal(result.maxInterGameGapMs, SESSION_MAX_INTER_GAME_GAP_MS);
  assert.equal(result.coverage.status, 'COMPLETE');
  assert.equal(result.sessions.length, 3);
  assert.deepEqual(result.sessions[0].games.map((row) => row.importedGameId), [1, 2]);
  assert.equal(result.sessions[0].games[1].interGameGapMs, 30 * 60 * 1000);
  assert.deepEqual(result.sessions[1].games.map((row) => row.importedGameId), [3]);
  assert.deepEqual(result.sessions[2].games.map((row) => row.importedGameId), [4]);
});

test('ordering is deterministic for equal timestamps and exposes ordinal and elapsed context', () => {
  const result = sessionizeGames([
    game(8, '2026-09-16T10:00:00Z', '2026-09-16T10:04:00Z'),
    game(7, '2026-09-16T10:00:00Z', '2026-09-16T10:03:00Z'),
    game(9, '2026-09-16T10:10:00Z', '2026-09-16T10:15:00Z'),
  ]);

  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].sessionKey, `${SESSIONIZATION_POLICY_VERSION}:7`);
  assert.deepEqual(
    result.sessions[0].games.map((row) => [row.importedGameId, row.ordinal]),
    [[7, 1], [8, 2], [9, 3]],
  );
  assert.equal(result.sessions[0].games[2].elapsedFromSessionStartMs, 10 * 60 * 1000);
});

test('prior loss streak is session-local and resets on non-loss results', () => {
  const result = sessionizeGames([
    game(1, '2026-09-16T10:00:00Z', '2026-09-16T10:05:00Z', 'LOSS'),
    game(2, '2026-09-16T10:10:00Z', '2026-09-16T10:15:00Z', 'LOSS'),
    game(3, '2026-09-16T10:20:00Z', '2026-09-16T10:25:00Z', 'WIN'),
    game(4, '2026-09-16T10:30:00Z', '2026-09-16T10:35:00Z', 'LOSS'),
    game(5, '2026-09-16T12:00:00Z', '2026-09-16T12:05:00Z', 'LOSS'),
  ]);

  assert.deepEqual(
    result.sessions[0].games.map((row) => row.priorLossStreak),
    [0, 1, 2, 0],
  );
  assert.deepEqual(
    result.sessions[1].games.map((row) => row.priorLossStreak),
    [0],
  );
});

test('missing or invalid chronology is explicit partial coverage', () => {
  const result = sessionizeGames([
    game(1, '2026-09-16T10:00:00Z', '2026-09-16T10:05:00Z'),
    game(2, null, '2026-09-16T10:10:00Z'),
    game(3, '2026-09-16T10:20:00Z', null),
    game(4, '2026-09-16T10:30:00Z', '2026-09-16T10:25:00Z'),
  ]);

  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.reason, 'session-chronology-incomplete');
  assert.equal(result.coverage.candidateGames, 4);
  assert.equal(result.coverage.coveredGames, 1);
  assert.deepEqual(result.coverage.uncoveredGames, [
    { importedGameId: 2, reason: 'MISSING_STARTED_AT' },
    { importedGameId: 3, reason: 'MISSING_ENDED_AT' },
    { importedGameId: 4, reason: 'INVALID_INTERVAL' },
  ]);
});

test('scope safety rejects over-broad history before loading candidate rows', async () => {
  let loaded = false;
  const result = await getSessionContext(1, {}, {
    countCandidates: async () => SESSIONIZATION_MAX_CANDIDATE_GAMES + 1,
    loadCandidates: async () => {
      loaded = true;
      return [];
    },
  });

  assert.equal(result.coverage.status, 'UNAVAILABLE');
  assert.equal(result.coverage.reason, 'sessionization-scope-too-large');
  assert.equal(loaded, false);
});

test('candidate-set changes are rejected instead of producing a mixed snapshot', async () => {
  const result = await getSessionContext(1, {}, {
    countCandidates: async () => 2,
    loadCandidates: async () => [
      game(1, '2026-09-16T10:00:00Z', '2026-09-16T10:05:00Z'),
    ],
  });

  assert.equal(result.coverage.status, 'UNAVAILABLE');
  assert.equal(result.coverage.reason, 'candidate-set-changed-during-read');
  assert.deepEqual(result.sessions, []);
});

test('Prisma sessionization repository is ownership-scoped and uses a start-time range', async () => {
  const suffix = randomUUID();
  let ownerId = null;
  let otherId = null;

  try {
    const owner = await prisma.appUser.create({
      data: { authProvider: 'TEST', authSubject: `session-owner-${suffix}` },
    });
    const other = await prisma.appUser.create({
      data: { authProvider: 'TEST', authSubject: `session-other-${suffix}` },
    });
    ownerId = owner.id;
    otherId = other.id;

    const createGame = (appUserId, providerGameId, startedAt) => prisma.importedGame.create({
      data: {
        appUserId,
        provider: 'LICHESS',
        providerGameId,
        connectedLichessUserId: `lichess-${appUserId}`,
        connectedLichessUsername: `user-${appUserId}`,
        startedAt,
        endedAt: new Date(startedAt.getTime() + 5 * 60 * 1000),
        resultForUser: 'LOSS',
      },
    });

    const first = await createGame(
      owner.id,
      `session-first-${suffix}`,
      new Date('2026-09-16T10:00:00Z'),
    );
    const second = await createGame(
      owner.id,
      `session-second-${suffix}`,
      new Date('2026-09-16T10:20:00Z'),
    );
    await createGame(
      owner.id,
      `session-outside-${suffix}`,
      new Date('2026-09-16T12:00:00Z'),
    );
    await createGame(
      other.id,
      `session-other-${suffix}`,
      new Date('2026-09-16T10:10:00Z'),
    );

    const scope = {
      from: new Date('2026-09-16T09:55:00Z'),
      to: new Date('2026-09-16T11:00:00Z'),
    };
    assert.equal(
      await prismaSessionizationRepository.countCandidates(owner.id, scope),
      2,
    );
    const rows = await prismaSessionizationRepository.loadCandidates(owner.id, scope);
    assert.deepEqual(rows.map((row) => row.importedGameId), [first.id, second.id]);
  } finally {
    if (ownerId !== null) {
      await prisma.appUser.delete({ where: { id: ownerId } }).catch(() => undefined);
    }
    if (otherId !== null) {
      await prisma.appUser.delete({ where: { id: otherId } }).catch(() => undefined);
    }
  }
});
