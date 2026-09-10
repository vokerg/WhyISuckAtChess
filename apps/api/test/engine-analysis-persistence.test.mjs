import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import prismaModule from '../dist/prisma.js';
import { prismaAnalysisRepository } from '../dist/modules/engine-analysis/engine-analysis.repository.prisma.js';
import { DEFAULT_STOCKFISH_SETTINGS, settingsHash } from '../dist/modules/engine-analysis/stockfish.adapter.js';

const prisma = prismaModule.default ?? prismaModule;

function analysis(scoreCp) {
  return {
    depth: 16,
    scoreCp,
    mateIn: null,
    bestMove: 'e2e4',
    bestPv: ['e2e4', 'e7e5'],
    multiPv: [{ multiPv: 1, depth: 16, scoreCp, mateIn: null, pv: ['e2e4', 'e7e5'], raw: `info score cp ${scoreCp}` }],
    rawInfo: [`info depth 16 multipv 1 score cp ${scoreCp} pv e2e4 e7e5`],
  };
}

test('analysis persistence is idempotent within a snapshot and reanalysis supersedes the active run', async () => {
  const suffix = randomUUID();
  let userId = null;
  let positionId = null;
  try {
    const user = await prisma.appUser.create({ data: { authProvider: 'TEST', authSubject: `engine-${suffix}` } });
    userId = user.id;
    const game = await prisma.importedGame.create({
      data: {
        appUserId: user.id,
        provider: 'LICHESS',
        providerGameId: `engine-${suffix}`,
        connectedLichessUserId: 'fixture-user',
        connectedLichessUsername: 'FixtureUser',
        plyIndexStatus: 'INDEXED',
      },
    });
    const position = await prisma.position.create({
      data: {
        positionKey: Buffer.from(randomUUID().replaceAll('-', ''), 'hex'),
        normalizedFen: `8/8/8/8/8/8/8/K6k w - - 0 1 ${suffix}`,
      },
    });
    positionId = position.id;
    const hash = settingsHash(DEFAULT_STOCKFISH_SETTINGS);
    const run = await prisma.gameAnalysisRun.create({
      data: {
        importedGameId: game.id,
        analysisVersion: 'test-v1',
        settingsHash: hash,
        settingsJson: DEFAULT_STOCKFISH_SETTINGS,
        engineName: 'Stockfish 18',
        engineVersion: '18',
        status: 'RUNNING',
      },
    });

    assert.equal(await prismaAnalysisRepository.persistPositionResult({
      runId: run.id,
      positionId: position.id,
      engineName: 'Stockfish 18',
      engineVersion: '18',
      settingsHash: hash,
      analysis: analysis(20),
    }), true);
    assert.equal(await prismaAnalysisRepository.persistPositionResult({
      runId: run.id,
      positionId: position.id,
      engineName: 'Stockfish 18',
      engineVersion: '18',
      settingsHash: hash,
      analysis: analysis(25),
    }), true);

    const rows = await prisma.stockfishPositionAnalysis.findMany({ where: { analysisRunId: run.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].scoreCp, 25);
    assert.equal(rows[0].engineVersion, '18');
    assert.equal(rows[0].settingsHash, hash);

    const replacementId = await prismaAnalysisRepository.requestReanalysis({
      importedGameId: game.id,
      analysisVersion: 'test-v1',
      settingsHash: hash,
      settings: DEFAULT_STOCKFISH_SETTINGS,
    });
    const previous = await prisma.gameAnalysisRun.findUniqueOrThrow({ where: { id: run.id } });
    const replacement = await prisma.gameAnalysisRun.findUniqueOrThrow({ where: { id: replacementId } });
    assert.equal(previous.status, 'SUPERSEDED');
    assert.ok(previous.cancelRequestedAt);
    assert.equal(replacement.status, 'QUEUED');
    assert.notEqual(replacement.snapshotId, previous.snapshotId);

    assert.equal(await prismaAnalysisRepository.persistPositionResult({
      runId: run.id,
      positionId: position.id,
      engineName: 'Stockfish 18',
      engineVersion: '18',
      settingsHash: hash,
      analysis: analysis(99),
    }), false);
    const unchanged = await prisma.stockfishPositionAnalysis.findUniqueOrThrow({
      where: { analysisRunId_positionId: { analysisRunId: run.id, positionId: position.id } },
    });
    assert.equal(unchanged.scoreCp, 25);
  } finally {
    if (userId !== null) await prisma.appUser.delete({ where: { id: userId } }).catch(() => {});
    if (positionId !== null) await prisma.position.delete({ where: { id: positionId } }).catch(() => {});
    await prisma.$disconnect();
  }
});
