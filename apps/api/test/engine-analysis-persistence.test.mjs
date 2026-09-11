import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import prismaModule from '../dist/prisma.js';
import { prismaAnalysisRepository } from '../dist/modules/engine-analysis/engine-analysis.repository.prisma.js';
import { DEFAULT_STOCKFISH_SETTINGS, settingsHash } from '../dist/modules/engine-analysis/stockfish.adapter.js';

const prisma = prismaModule.default ?? prismaModule;

function analysis(scoreCpWhite, bestMove = 'a2a3') {
  return {
    depth: 16,
    scoreCpWhite,
    mateWhite: null,
    bestMove,
    bestPv: [bestMove],
    multiPv: [{
      multiPv: 1,
      depth: 16,
      scoreCpWhite,
      mateWhite: null,
      pv: [bestMove],
      raw: 'info depth 16 multipv 1 score cp ' + scoreCpWhite + ' pv ' + bestMove,
    }],
    rawInfo: ['info depth 16 multipv 1 score cp ' + scoreCpWhite + ' pv ' + bestMove],
  };
}

async function createPosition(label) {
  return prisma.position.create({
    data: {
      positionKey: Buffer.from(randomUUID().replaceAll('-', ''), 'hex'),
      normalizedFen: 'fixture-' + label + '-' + randomUUID(),
    },
  });
}

test('repository supports bullet, reusable cache, complete freshness, and stale-claim recovery', async () => {
  const suffix = randomUUID();
  const positionIds = [];
  let userId = null;

  try {
    const user = await prisma.appUser.create({
      data: { authProvider: 'TEST', authSubject: 'engine-' + suffix },
    });
    userId = user.id;

    const game = await prisma.importedGame.create({
      data: {
        appUserId: user.id,
        provider: 'LICHESS',
        providerGameId: 'bullet-' + suffix,
        connectedLichessUserId: 'fixture-user',
        connectedLichessUsername: 'FixtureUser',
        variant: 'standard',
        speedCategory: 'bullet',
        plyIndexStatus: 'INDEXED',
      },
    });
    const before = await createPosition('before');
    const after = await createPosition('after');
    positionIds.push(before.id, after.id);
    await prisma.importedGamePly.create({
      data: {
        importedGameId: game.id,
        plyNumber: 1,
        beforePositionId: before.id,
        afterPositionId: after.id,
        moveUci: 'a2a3',
        moverColor: 'WHITE',
        isUserMove: true,
      },
    });

    const hash = settingsHash(DEFAULT_STOCKFISH_SETTINGS);
    const runId = await prismaAnalysisRepository.enqueueEligibleGame({
      analysisVersion: 'test-v1',
      settingsHash: hash,
      settings: DEFAULT_STOCKFISH_SETTINGS,
    });
    assert.ok(runId, 'bullet game should be eligible for analysis');

    const firstClaim = await prismaAnalysisRepository.claimNext('worker-1');
    assert.equal(firstClaim.id, runId);
    assert.equal(await prismaAnalysisRepository.recordEngineIdentity(
      firstClaim,
      'Stockfish 18',
      '18',
    ), true);

    const work = await prismaAnalysisRepository.loadGameWork(firstClaim.id);
    assert.equal(work.positions.length, 2);
    assert.equal(work.plies.length, 1);

    const initialCache = await prismaAnalysisRepository.loadCachedPositionAnalyses({
      positionIds: work.positions.map((position) => position.positionId),
      analysisVersion: firstClaim.analysisVersion,
      settingsHash: firstClaim.settingsHash,
      engineName: 'Stockfish 18',
      engineVersion: '18',
    });
    assert.equal(initialCache.length, 0);

    assert.equal(await prismaAnalysisRepository.initializeProgress(firstClaim, {
      positionsTotal: 2,
      pliesTotal: 1,
      cacheHits: 0,
      cacheMisses: 2,
    }), true);
    assert.equal(await prismaAnalysisRepository.persistBatch(firstClaim, {
      engineName: 'Stockfish 18',
      engineVersion: '18',
      positionResults: [
        { positionId: before.id, analysis: analysis(120, 'e2e4') },
        { positionId: after.id, analysis: analysis(20, 'h7h6') },
      ],
      plyResults: [{ plyNumber: 1, scoreLossCp: 100, classificationCode: 5 }],
      positionsDone: 2,
      pliesDone: 1,
    }), true);
    assert.equal(await prismaAnalysisRepository.markSucceeded(firstClaim), true);

    const completed = await prisma.gameAnalysisRun.findUniqueOrThrow({ where: { id: firstClaim.id } });
    assert.equal(completed.status, 'SUCCEEDED');
    assert.equal(completed.coverageStatus, 'COMPLETE');
    assert.equal(completed.positionsDone, 2);
    assert.equal(completed.positionsTotal, 2);
    assert.equal(completed.pliesDone, 1);
    assert.equal(completed.pliesTotal, 1);

    const firstPly = await prisma.importedGamePly.findUniqueOrThrow({
      where: {
        importedGameId_plyNumber: {
          importedGameId: game.id,
          plyNumber: 1,
        },
      },
    });
    assert.equal(firstPly.engineAnalysisRunId, firstClaim.id);
    assert.equal(firstPly.scoreLossCp, 100);
    assert.equal(firstPly.classificationCode, 5);

    const replacementId = await prismaAnalysisRepository.requestReanalysis({
      importedGameId: game.id,
      analysisVersion: 'test-v1',
      settingsHash: hash,
      settings: DEFAULT_STOCKFISH_SETTINGS,
    });
    const replacementClaim = await prismaAnalysisRepository.claimNext('worker-2');
    assert.equal(replacementClaim.id, replacementId);
    assert.equal(await prismaAnalysisRepository.recordEngineIdentity(
      replacementClaim,
      'Stockfish 18',
      '18',
    ), true);

    const reusedCache = await prismaAnalysisRepository.loadCachedPositionAnalyses({
      positionIds: [before.id, after.id],
      analysisVersion: replacementClaim.analysisVersion,
      settingsHash: replacementClaim.settingsHash,
      engineName: 'Stockfish 18',
      engineVersion: '18',
    });
    assert.equal(reusedCache.length, 2);

    assert.equal(await prismaAnalysisRepository.initializeProgress(replacementClaim, {
      positionsTotal: 2,
      pliesTotal: 1,
      cacheHits: 2,
      cacheMisses: 0,
    }), true);
    assert.equal(await prismaAnalysisRepository.persistBatch(replacementClaim, {
      engineName: 'Stockfish 18',
      engineVersion: '18',
      positionResults: [],
      plyResults: [{ plyNumber: 1, scoreLossCp: 100, classificationCode: 5 }],
      positionsDone: 2,
      pliesDone: 1,
    }), true);
    assert.equal(await prismaAnalysisRepository.markSucceeded(replacementClaim), true);

    const cacheCount = await prisma.stockfishPositionAnalysis.count({
      where: { positionId: { in: [before.id, after.id] } },
    });
    assert.equal(cacheCount, 2, 'reanalysis should reuse cache rows instead of snapshot-local copies');

    const newestSucceeded = await prisma.gameAnalysisRun.findFirst({
      where: { importedGameId: game.id, status: 'SUCCEEDED', coverageStatus: 'COMPLETE' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    assert.equal(newestSucceeded.id, replacementId);

    const staleGame = await prisma.importedGame.create({
      data: {
        appUserId: user.id,
        provider: 'LICHESS',
        providerGameId: 'stale-' + suffix,
        connectedLichessUserId: 'fixture-user',
        connectedLichessUsername: 'FixtureUser',
        variant: 'standard',
        speedCategory: 'blitz',
        plyIndexStatus: 'INDEXED',
      },
    });
    const staleRun = await prisma.gameAnalysisRun.create({
      data: {
        importedGameId: staleGame.id,
        analysisVersion: 'test-v1',
        settingsHash: hash,
        settingsJson: DEFAULT_STOCKFISH_SETTINGS,
        status: 'RUNNING',
        attempts: 1,
        maxAttempts: 3,
        workerId: 'dead-worker',
        claimToken: 'dead-claim',
        claimedAt: new Date(Date.now() - 60_000),
        heartbeatAt: new Date(Date.now() - 60_000),
      },
    });
    const oldClaim = {
      id: staleRun.id,
      importedGameId: staleGame.id,
      snapshotId: staleRun.snapshotId,
      attempts: staleRun.attempts,
      maxAttempts: staleRun.maxAttempts,
      analysisVersion: staleRun.analysisVersion,
      settingsHash: staleRun.settingsHash,
      workerId: 'dead-worker',
      claimToken: 'dead-claim',
    };

    assert.equal(
      await prismaAnalysisRepository.recoverStaleRuns(new Date(Date.now() - 1_000)),
      1,
    );
    const recovered = await prisma.gameAnalysisRun.findUniqueOrThrow({ where: { id: staleRun.id } });
    assert.equal(recovered.status, 'RETRY_WAIT');
    assert.equal(recovered.claimToken, null);

    const newClaim = await prismaAnalysisRepository.claimNext('replacement-worker');
    assert.equal(newClaim.id, staleRun.id);
    assert.notEqual(newClaim.claimToken, oldClaim.claimToken);

    assert.equal(await prismaAnalysisRepository.persistBatch(oldClaim, {
      engineName: 'Stockfish 18',
      engineVersion: '18',
      positionResults: [],
      plyResults: [],
      positionsDone: 0,
      pliesDone: 0,
    }), false, 'expired claims must be fenced from late writes');
  } finally {
    if (userId !== null) {
      await prisma.appUser.delete({ where: { id: userId } }).catch(() => {});
    }
    if (positionIds.length > 0) {
      await prisma.stockfishPositionAnalysis.deleteMany({
        where: { positionId: { in: positionIds } },
      }).catch(() => {});
      await prisma.position.deleteMany({
        where: { id: { in: positionIds } },
      }).catch(() => {});
    }
    await prisma.$disconnect();
  }
});
