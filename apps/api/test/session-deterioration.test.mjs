import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import prismaModule from '../dist/prisma.js';
import { MoveClassificationCode } from '@why-i-suck-at-chess/chess-domain';
import {
  buildSessionDeteriorationAggregate,
  comparativeEvidenceStrength,
  SESSION_DETERIORATION_POLICY_VERSION,
} from '../dist/modules/diagnosis/session-deterioration.service.js';
import { prismaSessionDeteriorationRepository } from '../dist/modules/diagnosis/session-deterioration.repository.prisma.js';
import { sessionizeGames } from '../dist/modules/sessions/sessionization.service.js';

const prisma = prismaModule.default ?? prismaModule;

function sourceGame(id, start, result = 'DRAW') {
  const startedAt = new Date(start);
  return {
    importedGameId: id,
    startedAt,
    endedAt: new Date(startedAt.getTime() + 5 * 60 * 1000),
    resultForUser: result,
  };
}

function quality(importedGameId, averageScoreLossCp, analysedUserMoves = 10, majorErrorMoves = 0, blunderMoves = 0) {
  return {
    importedGameId,
    analysedUserMoves,
    averageScoreLossCp,
    majorErrorMoves,
    blunderMoves,
  };
}

test('late-session aggregation compares games 1-3 with game 4+ and reports deterioration deltas', () => {
  const games = [];
  const rows = [];
  let id = 1;
  for (let session = 0; session < 5; session += 1) {
    const base = Date.parse('2026-09-01T10:00:00Z') + session * 24 * 60 * 60 * 1000;
    for (let ordinal = 1; ordinal <= 4; ordinal += 1) {
      const gameId = id++;
      games.push(sourceGame(gameId, new Date(base + (ordinal - 1) * 10 * 60 * 1000).toISOString()));
      rows.push(quality(
        gameId,
        ordinal === 4 ? 80 : 30,
        10,
        ordinal === 4 ? 3 : 1,
        ordinal === 4 ? 2 : 0,
      ));
    }
  }

  const result = buildSessionDeteriorationAggregate(sessionizeGames(games), rows);

  assert.equal(result.policyVersion, SESSION_DETERIORATION_POLICY_VERSION);
  assert.equal(result.comparison.early.eligibleGames, 15);
  assert.equal(result.comparison.late.eligibleGames, 5);
  assert.equal(result.comparison.early.analysedSessions, 5);
  assert.equal(result.comparison.late.analysedSessions, 5);
  assert.equal(result.comparison.early.averageScoreLossCp, 30);
  assert.equal(result.comparison.late.averageScoreLossCp, 80);
  assert.equal(result.comparison.averageScoreLossDeltaCp, 50);
  assert.equal(result.comparison.early.majorErrorRatePercent, 10);
  assert.equal(result.comparison.late.majorErrorRatePercent, 30);
  assert.equal(result.comparison.majorErrorRateDeltaPercent, 20);
  assert.equal(result.comparison.blunderRateDeltaPercent, 20);
  assert.equal(result.comparison.evidenceStrength, 'LOW');
});

test('comparative strength is gated by the weaker arm and per-arm analysis coverage', () => {
  assert.equal(comparativeEvidenceStrength(
    { analysedGames: 40, analysisCoveragePercent: 100 },
    { analysedGames: 4, analysisCoveragePercent: 100 },
  ), 'INSUFFICIENT');
  assert.equal(comparativeEvidenceStrength(
    { analysedGames: 20, analysisCoveragePercent: 49.9 },
    { analysedGames: 20, analysisCoveragePercent: 100 },
  ), 'INSUFFICIENT');
  assert.equal(comparativeEvidenceStrength(
    { analysedGames: 15, analysisCoveragePercent: 50 },
    { analysedGames: 15, analysisCoveragePercent: 50 },
  ), 'MEDIUM');
  assert.equal(comparativeEvidenceStrength(
    { analysedGames: 40, analysisCoveragePercent: 100 },
    { analysedGames: 40, analysisCoveragePercent: 100 },
  ), 'HIGH');
});

test('missing chronology stays visible and uncovered games never enter the comparison', () => {
  const sessionization = sessionizeGames([
    sourceGame(1, '2026-09-01T10:00:00Z'),
    {
      importedGameId: 2,
      startedAt: null,
      endedAt: new Date('2026-09-01T10:20:00Z'),
      resultForUser: 'LOSS',
    },
  ]);
  const result = buildSessionDeteriorationAggregate(sessionization, [quality(1, 25)]);

  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.candidateGames, 2);
  assert.equal(result.coverage.sessionCoveredGames, 1);
  assert.equal(result.coverage.sessionUncoveredGames, 1);
  assert.equal(result.comparison.early.eligibleGames, 1);
  assert.equal(result.comparison.late.eligibleGames, 0);
  assert.equal(result.comparison.evidenceStrength, 'INSUFFICIENT');
});

test('Prisma quality aggregation enforces ownership and excludes stale analysis provenance', async () => {
  const suffix = randomUUID();
  const owners = [];

  async function createUser(subject) {
    const user = await prisma.appUser.create({
      data: { authProvider: 'TEST', authSubject: subject },
    });
    owners.push(user.id);
    return user;
  }

  async function createGame(appUserId, key, scoreLossCp, classificationCode, stale = false) {
    const indexedAt = new Date('2026-09-16T07:00:00Z');
    const game = await prisma.importedGame.create({
      data: {
        appUserId,
        provider: 'LICHESS',
        providerGameId: key,
        connectedLichessUserId: 'lichess-' + appUserId,
        connectedLichessUsername: 'user-' + appUserId,
        startedAt: new Date('2026-09-16T06:00:00Z'),
        endedAt: new Date('2026-09-16T06:05:00Z'),
        userColor: 'WHITE',
        resultForUser: 'LOSS',
        plyIndexStatus: 'INDEXED',
        plyIndexedAt: indexedAt,
      },
    });
    const before = await prisma.position.create({
      data: {
        positionKey: Buffer.from(randomUUID().replaceAll('-', ''), 'hex'),
        normalizedFen: 'before-' + key,
      },
    });
    const after = await prisma.position.create({
      data: {
        positionKey: Buffer.from(randomUUID().replaceAll('-', ''), 'hex'),
        normalizedFen: 'after-' + key,
      },
    });
    const run = await prisma.gameAnalysisRun.create({
      data: {
        importedGameId: game.id,
        analysisVersion: 'test-v1',
        settingsHash: 'hash-' + key,
        settingsJson: {},
        sourcePlyIndexedAt: stale ? new Date(indexedAt.getTime() - 1000) : indexedAt,
        status: 'SUCCEEDED',
        coverageStatus: 'COMPLETE',
        positionsTotal: 2,
        positionsDone: 2,
        pliesTotal: 1,
        pliesDone: 1,
      },
    });
    await prisma.importedGamePly.create({
      data: {
        importedGameId: game.id,
        plyNumber: 1,
        beforePositionId: before.id,
        afterPositionId: after.id,
        moveUci: 'e2e4',
        moverColor: 'WHITE',
        isUserMove: true,
        engineAnalysisRunId: run.id,
        scoreLossCp,
        classificationCode,
      },
    });
    return game;
  }

  try {
    const owner = await createUser('session-deterioration-owner-' + suffix);
    const other = await createUser('session-deterioration-other-' + suffix);
    const current = await createGame(
      owner.id,
      'current-' + suffix,
      220,
      MoveClassificationCode.Blunder,
    );
    const stale = await createGame(
      owner.id,
      'stale-' + suffix,
      260,
      MoveClassificationCode.Blunder,
      true,
    );
    const foreign = await createGame(
      other.id,
      'foreign-' + suffix,
      300,
      MoveClassificationCode.Blunder,
    );

    const rows = await prismaSessionDeteriorationRepository.loadGameQuality(
      owner.id,
      [current.id, stale.id, foreign.id],
    );

    assert.deepEqual(rows.map((row) => row.importedGameId), [current.id, stale.id]);
    assert.equal(rows[0].analysedUserMoves, 1);
    assert.equal(rows[0].averageScoreLossCp, 220);
    assert.equal(rows[0].majorErrorMoves, 1);
    assert.equal(rows[0].blunderMoves, 1);
    assert.equal(rows[1].analysedUserMoves, 0);
    assert.equal(rows[1].averageScoreLossCp, null);
    assert.equal(rows[1].majorErrorMoves, 0);
  } finally {
    for (const id of owners.reverse()) {
      await prisma.appUser.delete({ where: { id } }).catch(() => undefined);
    }
  }
});
