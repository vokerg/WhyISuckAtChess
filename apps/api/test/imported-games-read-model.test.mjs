import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  importedGameDetailResponseSchema,
  importedGameListQuerySchema,
  importedGameListResponseSchema,
  importedGameReplayResponseSchema,
} from '@why-i-suck-at-chess/contracts';
import { buildApp } from '../dist/app.js';
import prismaModule from '../dist/prisma.js';
import {
  createPrismaImportedGamesRepository,
} from '../dist/modules/imported-games/imported-games.repository.prisma.js';
import { createImportedGamesQueryService } from '../dist/modules/imported-games/imported-games.service.js';

const prisma = prismaModule.default ?? prismaModule;

function listRow(id, endedAt = new Date('2026-09-11T10:00:00.000Z')) {
  return {
    id,
    provider: 'LICHESS',
    providerGameId: `game-${id}`,
    providerUrl: `https://lichess.org/game-${id}`,
    startedAt: new Date('2026-09-11T09:55:00.000Z'),
    endedAt,
    rated: true,
    variant: 'standard',
    speedCategory: 'blitz',
    timeControlRaw: '180+0',
    timeControlInitial: 180,
    timeControlIncrement: 0,
    timeControlSource: 'LICHESS_CLOCK_OBJECT',
    exactTimeControlKey: '180+0',
    whiteUsername: 'Player',
    blackUsername: 'Opponent',
    whiteRating: 1500,
    blackRating: 1510,
    userColor: 'white',
    opponentUsername: 'Opponent',
    result: '1-0',
    resultForUser: 'win',
    status: 'resign',
    openingName: "King's Pawn Game",
    openingEco: 'C20',
    plyIndexStatus: 'INDEXED',
    plyIndexedAt: new Date('2026-09-11T10:01:00.000Z'),
    plyIndexError: null,
    clockAlignmentStatus: 'COMPLETE',
    alignedClockPlyCount: 2,
    timingDerivationVersion: 1,
    derivedTimingPlyCount: 0,
    timingCoverageStatus: 'UNAVAILABLE',
    analysisRuns: [],
  };
}

function replayRow(overrides = {}) {
  return {
    ...listRow(7),
    source: 'LICHESS_API',
    connectedLichessUserId: 'lichess-player',
    connectedLichessUsername: 'Player',
    rawClockPresence: 'ABSENT',
    rawClockStateCount: 0,
    rawClockUnit: 'CENTISECONDS',
    rawClockAnomalies: ['CLOCKS_ABSENT'],
    createdAt: new Date('2026-09-11T10:01:00.000Z'),
    updatedAt: new Date('2026-09-11T10:01:00.000Z'),
    plies: [{
      plyNumber: 1,
      moveUci: 'e2e4',
      moverColor: 'white',
      isUserMove: true,
      beforePositionId: 11,
      afterPositionId: 12,
      beforePosition: {
        id: 11,
        normalizedFen: 'startpos',
        engineAnalyses: [],
      },
      afterPosition: { id: 12, normalizedFen: 'fen-after' },
      sourceClockOrdinal: null,
      sourceClockAfterCentiseconds: null,
      sourceClockSemantics: null,
      clockAlignmentVersion: null,
      clockBeforeMoveCentiseconds: null,
      effectiveIncrementCentiseconds: null,
      clockDeltaMoveTimeCentiseconds: null,
      beforeClockProvenance: 'UNAVAILABLE',
      incrementProvenance: 'UNAVAILABLE',
      timingDerivationVersion: 1,
      timingDerivationStatus: 'UNAVAILABLE',
      timingReliabilityFlags: [],
      timingUnavailableReason: 'CLOCKS_ABSENT',
      engineAnalysisRunId: null,
      engineAnalysisRun: null,
      scoreLossCp: null,
      classificationCode: null,
  }],
  ...overrides,
};
}

function engineRun(overrides = {}) {
  return {
    id: 41,
    status: 'SUCCEEDED',
    analysisVersion: 'test-v1',
    settingsHash: 'settings-v1',
    sourcePlyIndexedAt: new Date('2026-09-11T10:01:00.000Z'),
    coverageStatus: 'COMPLETE',
    positionsDone: 2,
    positionsTotal: 2,
    pliesDone: 1,
    pliesTotal: 1,
    engineName: 'Stockfish',
    engineVersion: '18',
    completedAt: new Date('2026-09-11T10:02:00.000Z'),
    createdAt: new Date('2026-09-11T10:01:00.000Z'),
    ...overrides,
  };
}

test('read service maps owned rows into bounded list and replay contracts', async () => {
  const calls = [];
  const rows = [listRow(7), listRow(8, new Date('2026-09-10T10:00:00.000Z'))];
  const repository = {
    async findList(...args) {
      calls.push(['list', ...args]);
      return rows;
    },
    async findDetail(appUserId, gameId) {
      calls.push(['detail', appUserId, gameId]);
      return replayRow({ id: gameId, pgn: '[Result "1-0"]' });
    },
    async findReplay(appUserId, gameId) {
      calls.push(['replay', appUserId, gameId]);
      return replayRow({ id: gameId });
    },
  };
  const service = createImportedGamesQueryService(repository);

  const page = await service.list(42, importedGameListQuerySchema.parse({ limit: 1 }));
  importedGameListResponseSchema.parse(page);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].userColor, 'WHITE');
  assert.equal(page.items[0].timeControl.incrementSeconds, 0);
  assert.equal(page.items[0].timing.coverageStatus, 'UNAVAILABLE');
  assert.equal(page.pageInfo.hasMore, true);
  assert.ok(page.pageInfo.nextCursor);
  assert.equal(calls[0][1], 42);
  assert.equal(calls[0][3], null, 'repository receives a decoded cursor, not provider data');

  const replay = await service.getReplay(42, 7);
  importedGameReplayResponseSchema.parse(replay);
  assert.equal(replay.clockSource.presence, 'ABSENT');
  assert.equal(replay.plies[0].sourceClock.status, 'UNAVAILABLE');
  assert.equal(replay.plies[0].timing.unavailableReason, 'CLOCKS_ABSENT');
  assert.deepEqual(replay.plies[0].beforePosition, { id: 11, normalizedFen: 'startpos' });
  assert.equal(replay.provenance.sourceUpdatedAt, '2026-09-11T10:00:00.000Z');
  assert.equal(replay.provenance.readModelUpdatedAt, '2026-09-11T10:01:00.000Z');
  assert.equal('rawClockStates' in replay, false);

  const detail = await service.getDetail(42, 7);
  importedGameDetailResponseSchema.parse(detail);
  assert.equal(detail.pgn, '[Result "1-0"]');
});

test('invalid pagination cursors fail before a repository query', async () => {
  let queried = false;
  const service = createImportedGamesQueryService({
    async findList() {
      queried = true;
      return [];
    },
    async findDetail() { return null; },
    async findReplay() { return null; },
  });

  await assert.rejects(
    service.list(42, importedGameListQuerySchema.parse({ cursor: 'not-a-valid-cursor' })),
    /Invalid imported-games cursor/,
  );
  assert.equal(queried, false);
});

test('read model hides stale or incomplete game-specific engine evidence', async () => {
  const basePly = replayRow().plies[0];
  const repository = {
    async findList() { return []; },
    async findDetail() { return null; },
    async findReplay() {
      return replayRow({
        analysisRuns: [engineRun({ id: 42, status: 'RUNNING', coverageStatus: 'PARTIAL', completedAt: null })],
        plies: [{
          ...basePly,
          engineAnalysisRunId: 41,
          engineAnalysisRun: { id: 41, status: 'SUCCEEDED', coverageStatus: 'COMPLETE' },
          scoreLossCp: 220,
          classificationCode: 4,
        }],
      });
    },
  };
  const service = createImportedGamesQueryService(repository);

  const replay = await service.getReplay(42, 7);
  importedGameReplayResponseSchema.parse(replay);
  assert.equal(replay.engine.status, 'RUNNING');
  assert.equal(replay.plies[0].engine.status, 'UNAVAILABLE');
  assert.equal(replay.plies[0].engine.analysisRunId, null);
  assert.equal(replay.plies[0].engine.scoreLossCp, null);
});

test('read model exposes game-specific engine evidence only for the latest complete run', async () => {
  const basePly = replayRow().plies[0];
  const repository = {
    async findList() { return []; },
    async findDetail() { return null; },
    async findReplay() {
      return replayRow({
        analysisRuns: [engineRun()],
        plies: [{
          ...basePly,
          engineAnalysisRunId: 41,
          engineAnalysisRun: { id: 41, status: 'SUCCEEDED', coverageStatus: 'COMPLETE' },
          scoreLossCp: 220,
          classificationCode: 4,
        }],
      });
    },
  };
  const service = createImportedGamesQueryService(repository);

  const replay = await service.getReplay(42, 7);
  importedGameReplayResponseSchema.parse(replay);
  assert.equal(replay.engine.status, 'COMPLETED');
  assert.equal(replay.plies[0].engine.status, 'AVAILABLE');
  assert.equal(replay.plies[0].engine.analysisRunId, 41);
  assert.equal(replay.plies[0].engine.scoreLossCp, 220);
});

test('read model never splices mismatched position-cache provenance into a complete game run', async () => {
  const basePly = replayRow().plies[0];
  const repository = {
    async findList() { return []; },
    async findDetail() { return null; },
    async findReplay() {
      return replayRow({
        analysisRuns: [engineRun()],
        plies: [{
          ...basePly,
          beforePosition: {
            ...basePly.beforePosition,
            engineAnalyses: [{
              analysisVersion: 'different-policy',
              settingsHash: 'different-settings',
              engineName: 'Stockfish 18',
              engineVersion: '18',
              depth: 20,
              bestMove: 'd2d4',
              scoreCpWhite: 30,
              mateWhite: null,
            }],
          },
          engineAnalysisRunId: 41,
          engineAnalysisRun: { id: 41, status: 'SUCCEEDED', coverageStatus: 'COMPLETE' },
          scoreLossCp: 220,
          classificationCode: 4,
        }],
      });
    },
  };
  const service = createImportedGamesQueryService(repository);

  const replay = await service.getReplay(42, 7);
  assert.equal(replay.plies[0].engine.status, 'AVAILABLE');
  assert.equal(replay.plies[0].engine.beforePosition.status, 'UNAVAILABLE');
  assert.equal(replay.plies[0].engine.beforePosition.bestMoveUci, null);
});

test('Prisma projections enforce ownership and bounded list/detail selection', async () => {
  const calls = [];
  const database = {
    importedGame: {
      async findMany(args) {
        calls.push(['many', args]);
        return [];
      },
      async findFirst(args) {
        calls.push(['first', args]);
        return null;
      },
    },
  };
  const repository = createPrismaImportedGamesRepository(database);
  await repository.findList(73, importedGameListQuerySchema.parse({ limit: 2 }), null);
  await repository.findReplay(73, 901);
  await repository.findDetail(73, 901);

  assert.deepEqual(calls[0][1].where, { appUserId: 73, provider: 'LICHESS' });
  assert.equal(calls[0][1].take, 3);
  assert.equal('plies' in calls[0][1].select, false);
  assert.equal('rawClockStates' in calls[0][1].select, false);
  assert.deepEqual(calls[1][1].where, { id: 901, appUserId: 73, provider: 'LICHESS' });
  assert.equal('pgn' in calls[1][1].select, false, 'replay does not load raw PGN');
  assert.equal('plies' in calls[1][1].select, true);
  assert.deepEqual(calls[2][1].where, { id: 901, appUserId: 73, provider: 'LICHESS' });
  assert.equal('pgn' in calls[2][1].select, true);
});

test('HTTP routes pass authenticated ownership through list/detail/replay boundaries', async () => {
  const calls = [];
  const response = {
    items: [],
    pageInfo: { nextCursor: null, hasMore: false },
  };
  const service = {
    async list(userId) {
      calls.push(['list', userId]);
      return response;
    },
    async getReplay(userId, gameId) {
      calls.push(['replay', userId, gameId]);
      return null;
    },
    async getDetail(userId, gameId) {
      calls.push(['detail', userId, gameId]);
      return null;
    },
  };
  const app = await buildApp({
    prisma: { $disconnect: async () => undefined },
    authConfig: { mode: 'dev-single-user' },
    currentUserService: {
      async resolveDevUser() {
        return { auth: { userId: 314, provider: 'dev', externalSubject: 'read-model-test' } };
      },
      async resolveExternalUser() {
        throw new Error('not used in dev mode');
      },
    },
    importedGamesService: service,
  });

  try {
    assert.equal((await app.inject({ method: 'GET', url: '/api/imported-games?limit=1' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/imported-games/9/replay' })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: '/api/imported-games/9' })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: '/api/imported-games/not-an-id' })).statusCode, 400);
  } finally {
    await app.close();
  }

  assert.deepEqual(calls, [
    ['list', 314],
    ['replay', 314, 9],
    ['detail', 314, 9],
  ]);
});

test('Prisma read model returns real indexed evidence only for its owner', async () => {
  const suffix = randomUUID();
  const positionIds = [];
  let userId = null;

  try {
    const user = await prisma.appUser.create({
      data: { authProvider: 'TEST', authSubject: `read-model-${suffix}` },
    });
    userId = user.id;

    const before = await prisma.position.create({
      data: {
        positionKey: Buffer.from(randomUUID().replaceAll('-', ''), 'hex'),
        normalizedFen: `fixture-before-${suffix}`,
      },
    });
    const after = await prisma.position.create({
      data: {
        positionKey: Buffer.from(randomUUID().replaceAll('-', ''), 'hex'),
        normalizedFen: `fixture-after-${suffix}`,
      },
    });
    positionIds.push(before.id, after.id);

    const game = await prisma.importedGame.create({
      data: {
        appUserId: user.id,
        provider: 'LICHESS',
        providerGameId: `read-model-${suffix}`,
        providerUrl: `https://lichess.org/${suffix}`,
        source: 'LICHESS_API',
        connectedLichessUserId: 'fixture-user',
        connectedLichessUsername: 'FixtureUser',
        pgn: '[Result "1-0"]\n\n1. e4 *',
        rated: true,
        variant: 'standard',
        speedCategory: 'blitz',
        timeControlRaw: '180+0',
        timeControlInitial: 180,
        timeControlIncrement: 0,
        timeControlSource: 'PGN_TIME_CONTROL',
        exactTimeControlKey: '180+0',
        startedAt: new Date('2026-09-11T10:00:00.000Z'),
        endedAt: new Date('2026-09-11T10:01:00.000Z'),
        whiteUsername: 'FixtureUser',
        blackUsername: 'Opponent',
        whiteRating: 1500,
        blackRating: 1500,
        userColor: 'white',
        opponentUsername: 'Opponent',
        result: '1-0',
        resultForUser: 'win',
        status: 'resign',
        rawClockPresence: 'ABSENT',
        rawClockStateCount: 0,
        rawClockAnomalies: ['CLOCKS_ABSENT'],
      },
    });
    await prisma.importedGamePly.create({
      data: {
        importedGameId: game.id,
        plyNumber: 1,
        beforePositionId: before.id,
        afterPositionId: after.id,
        moveUci: 'e2e4',
        moverColor: 'white',
        isUserMove: true,
      },
    });

    const service = createImportedGamesQueryService();
    const page = await service.list(user.id, importedGameListQuerySchema.parse({ limit: 1 }));
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].id, game.id);
    assert.equal(page.items[0].timeControl.incrementSeconds, 0);

    const replay = await service.getReplay(user.id, game.id);
    importedGameReplayResponseSchema.parse(replay);
    assert.equal(replay.plies.length, 1);
    assert.equal(replay.plies[0].beforePosition.id, before.id);
    assert.equal(replay.plies[0].sourceClock.status, 'UNAVAILABLE');
    assert.equal(replay.plies[0].timing.status, 'UNAVAILABLE');
    assert.equal(await service.getReplay(user.id + 1, game.id), null);
  } finally {
    if (userId !== null) await prisma.appUser.delete({ where: { id: userId } }).catch(() => {});
    if (positionIds.length > 0) await prisma.position.deleteMany({ where: { id: { in: positionIds } } }).catch(() => {});
    await prisma.$disconnect();
  }
});
