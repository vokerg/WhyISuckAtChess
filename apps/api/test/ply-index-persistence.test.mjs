import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import prismaModule from '../dist/prisma.js';
import { createPrismaAccountImportRepository } from '../dist/modules/account-imports/account-import.repository.prisma.js';
import {
  PlyIndexSourceChangedError,
  getImportedGameForPlyIndex,
  replacePlyProjection,
} from '../dist/modules/imported-games/ply-index.repository.prisma.js';
import { ImportedGamePlyIndexService } from '../dist/modules/imported-games/ply-index.service.js';

const prisma = prismaModule.default ?? prismaModule;
const PGN = '[Event "index fixture"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *';
const CLOCKS = [5900, 5900, 6000, 5900];

function sourceGame(providerGameId, incrementSeconds) {
  return {
    providerGameId,
    providerUrl: `https://lichess.org/${providerGameId}`,
    source: 'LICHESS_API',
    connectedLichessUserId: 'fixture-user',
    connectedLichessUsername: 'FixtureUser',
    pgn: PGN,
    rated: true,
    variant: 'standard',
    speedCategory: 'blitz',
    performanceCategory: 'blitz',
    timeControlRaw: `60+${incrementSeconds}`,
    timeControlInitial: 60,
    timeControlIncrement: incrementSeconds,
    timeControlSource: 'LICHESS_CLOCK_OBJECT',
    exactTimeControlKey: `60+${incrementSeconds}`,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    endedAt: new Date('2026-01-01T00:01:00.000Z'),
    whiteUsername: 'FixtureUser',
    blackUsername: 'Opponent',
    whiteRating: 1500,
    blackRating: 1500,
    userColor: 'white',
    opponentUsername: 'Opponent',
    result: '1-0',
    resultForUser: 'win',
    status: 'resign',
    openingName: null,
    openingEco: null,
    rawClockPresence: 'PRESENT',
    rawClockValuesCentiseconds: [...CLOCKS],
    rawClockAnomalies: [],
  };
}

function assertPublicationMetadataCleared(game) {
  assert.equal(game.indexedRawClockStateCount, 0);
  assert.equal(game.clockAlignmentStatus, 'UNAVAILABLE');
  assert.equal(game.clockAlignmentVersion, null);
  assert.equal(game.alignedClockPlyCount, 0);
  assert.equal(game.timingDerivationVersion, null);
  assert.equal(game.derivedTimingPlyCount, 0);
  assert.equal(game.timingCoverageStatus, 'UNAVAILABLE');
}

test('ply projection is atomic, fenced to its source snapshot, and clears stale publication metadata', async () => {
  const suffix = randomUUID();
  let userId = null;

  try {
    const user = await prisma.appUser.create({
      data: { authProvider: 'TEST', authSubject: `ply-index-${suffix}` },
    });
    userId = user.id;

    const providerGameId = `fixture-${suffix}`;
    const source = sourceGame(providerGameId, 2);
    const game = await prisma.importedGame.create({
      data: {
        appUser: { connect: { id: user.id } },
        provider: 'LICHESS',
        providerGameId,
        providerUrl: source.providerUrl,
        source: source.source,
        connectedLichessUserId: source.connectedLichessUserId,
        connectedLichessUsername: source.connectedLichessUsername,
        pgn: source.pgn,
        rated: source.rated,
        variant: source.variant,
        speedCategory: source.speedCategory,
        performanceCategory: source.performanceCategory,
        timeControlRaw: source.timeControlRaw,
        timeControlInitial: source.timeControlInitial,
        timeControlIncrement: source.timeControlIncrement,
        timeControlSource: source.timeControlSource,
        exactTimeControlKey: source.exactTimeControlKey,
        startedAt: source.startedAt,
        endedAt: source.endedAt,
        whiteUsername: source.whiteUsername,
        blackUsername: source.blackUsername,
        whiteRating: source.whiteRating,
        blackRating: source.blackRating,
        userColor: source.userColor,
        opponentUsername: source.opponentUsername,
        result: source.result,
        resultForUser: source.resultForUser,
        status: source.status,
        rawClockPresence: source.rawClockPresence,
        rawClockStateCount: source.rawClockValuesCentiseconds.length,
        rawClockAnomalies: source.rawClockAnomalies,
        rawClockStates: {
          create: source.rawClockValuesCentiseconds.map((valueCentiseconds, index) => ({
            sourceOrdinal: index + 1,
            valueCentiseconds,
          })),
        },
      },
    });

    const first = await ImportedGamePlyIndexService.indexOne(user.id, game.id);
    assert.equal(first.status, 'INDEXED');
    assert.equal(first.pliesIndexed, 4);

    const indexed = await prisma.importedGame.findUniqueOrThrow({
      where: { id: game.id },
      include: { plies: { orderBy: { plyNumber: 'asc' } }, terminalClockFacts: true },
    });
    assert.equal(indexed.plyIndexStatus, 'INDEXED');
    assert.equal(indexed.clockAlignmentStatus, 'COMPLETE');
    assert.equal(indexed.timingCoverageStatus, 'COMPLETE');
    assert.equal(indexed.plies.length, 4);
    assert.equal(indexed.terminalClockFacts.length, 0);
    assert.equal(indexed.plies[0].sourceClockAfterCentiseconds, 5900);
    assert.equal(indexed.plies[0].clockDeltaMoveTimeCentiseconds, null);
    assert.equal(indexed.plies[1].clockDeltaMoveTimeCentiseconds, null);
    assert.equal(indexed.plies[2].clockDeltaMoveTimeCentiseconds, 100);
    assert.equal(indexed.plies[3].clockDeltaMoveTimeCentiseconds, 200);
    for (let index = 1; index < indexed.plies.length; index += 1) {
      assert.equal(indexed.plies[index - 1].afterPositionId, indexed.plies[index].beforePositionId);
    }

    const retry = await ImportedGamePlyIndexService.indexOne(user.id, game.id);
    assert.equal(retry.status, 'ALREADY_INDEXED');
    assert.equal(retry.pliesIndexed, 4);

    const staleSnapshot = await getImportedGameForPlyIndex(user.id, game.id);
    assert.ok(staleSnapshot);

    const activeAnalysis = await prisma.gameAnalysisRun.create({
      data: {
        importedGameId: game.id,
        analysisVersion: 'test-analysis-v1',
        settingsHash: 'settings-hash',
        settingsJson: { depth: 16 },
        sourcePlyIndexedAt: indexed.plyIndexedAt,
        status: 'RUNNING',
        workerId: 'analysis-worker',
        claimToken: 'analysis-claim',
        claimedAt: new Date('2026-01-01T00:02:00.000Z'),
        heartbeatAt: new Date('2026-01-01T00:02:00.000Z'),
      },
    });

    const claimedAt = new Date('2026-01-02T00:00:00.000Z');
    const run = await prisma.importRun.create({
      data: {
        appUser: { connect: { id: user.id } },
        provider: 'LICHESS',
        status: 'RUNNING',
        scopeHash: `scope-${suffix}`,
        scopeJson: { speeds: ['blitz'] },
        requestedFrom: new Date('2026-01-01T00:00:00.000Z'),
        requestedTo: new Date('2026-01-03T00:00:00.000Z'),
        lichessUserIdSnapshot: 'fixture-user',
        lichessUsernameSnapshot: 'FixtureUser',
        workKey: `work-${suffix}`,
        claimedAt,
        heartbeatAt: claimedAt,
      },
    });

    const repository = createPrismaAccountImportRepository(prisma);
    const commitResult = await repository.commitGames(
      run.id,
      user.id,
      claimedAt,
      [sourceGame(providerGameId, 3)],
    );
    assert.equal(commitResult.updated, 1);

    await assert.rejects(
      replacePlyProjection({
        importedGameId: game.id,
        expectedSourceUpdatedAt: staleSnapshot.updatedAt,
        rows: [],
        terminal: null,
        plyIndexPolicyVersion: 1,
        indexedRawClockStateCount: CLOCKS.length,
        clockAlignmentStatus: 'COMPLETE',
        clockAlignmentVersion: 1,
        alignedClockPlyCount: 0,
        timingDerivationVersion: 1,
        derivedTimingPlyCount: 0,
        timingCoverageStatus: 'UNAVAILABLE',
      }),
      (error) => error instanceof PlyIndexSourceChangedError,
    );

    const invalidated = await prisma.importedGame.findUniqueOrThrow({ where: { id: game.id } });
    assert.equal(invalidated.plyIndexStatus, 'PENDING');
    assert.equal(invalidated.plyIndexedAt, null);
    assert.equal(await prisma.importedGamePly.count({ where: { importedGameId: game.id } }), 0);
    const supersededAnalysis = await prisma.gameAnalysisRun.findUniqueOrThrow({
      where: { id: activeAnalysis.id },
    });
    assert.equal(supersededAnalysis.status, 'SUPERSEDED');
    assert.equal(supersededAnalysis.claimToken, null);

    let reconciled = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await ImportedGamePlyIndexService.runOnce();
      const current = await prisma.importedGame.findUniqueOrThrow({
        where: { id: game.id },
        select: { plyIndexStatus: true },
      });
      if (current.plyIndexStatus !== 'PENDING') {
        reconciled = true;
        break;
      }
    }
    assert.equal(reconciled, true, 'persistent reconciler should consume pending ply-index work');
    const reindexed = await prisma.importedGame.findUniqueOrThrow({
      where: { id: game.id },
      select: { plyIndexStatus: true, plyIndexedAt: true },
    });
    assert.equal(reindexed.plyIndexStatus, 'INDEXED');
    assert.ok(reindexed.plyIndexedAt);
    const refreshedPly = await prisma.importedGamePly.findUniqueOrThrow({
      where: { importedGameId_plyNumber: { importedGameId: game.id, plyNumber: 3 } },
    });
    assert.equal(refreshedPly.effectiveIncrementCentiseconds, 300);
    assert.equal(refreshedPly.clockDeltaMoveTimeCentiseconds, 200);

    await prisma.importedGame.update({
      where: { id: game.id },
      data: { pgn: null },
    });
    const failed = await ImportedGamePlyIndexService.indexOne(user.id, game.id, { force: true });
    assert.equal(failed.status, 'FAILED');
    const failedGame = await prisma.importedGame.findUniqueOrThrow({ where: { id: game.id } });
    assert.equal(failedGame.plyIndexStatus, 'FAILED');
    assert.equal(failedGame.plyIndexPolicyVersion, null);
    assertPublicationMetadataCleared(failedGame);
    assert.equal(await prisma.importedGamePly.count({ where: { importedGameId: game.id } }), 0);

    await prisma.importedGame.update({
      where: { id: game.id },
      data: { pgn: PGN, variant: 'standard' },
    });
    const indexedAgain = await ImportedGamePlyIndexService.indexOne(user.id, game.id);
    assert.equal(indexedAgain.status, 'INDEXED');

    await prisma.importedGame.update({
      where: { id: game.id },
      data: { variant: 'chess960' },
    });
    const skipped = await ImportedGamePlyIndexService.indexOne(user.id, game.id);
    assert.equal(skipped.status, 'SKIPPED');
    const skippedGame = await prisma.importedGame.findUniqueOrThrow({ where: { id: game.id } });
    assert.equal(skippedGame.plyIndexStatus, 'SKIPPED');
    assert.equal(skippedGame.plyIndexPolicyVersion, 1);
    assertPublicationMetadataCleared(skippedGame);
    assert.equal(await prisma.importedGamePly.count({ where: { importedGameId: game.id } }), 0);
  } finally {
    if (userId !== null) {
      await prisma.appUser.delete({ where: { id: userId } }).catch(() => undefined);
    }
  }
});
