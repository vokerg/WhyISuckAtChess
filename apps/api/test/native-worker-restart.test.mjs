// Opt-in, Linux/CI-only process-boundary regression for Phase 7 #123.
// Uses disposable PostgreSQL and a real Stockfish binary. No credentials or production DB.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import prismaModule from '../dist/prisma.js';
import { createStockfishAnalysisService } from '../dist/modules/engine-analysis/engine-analysis.service.js';
import { prismaAnalysisRepository } from '../dist/modules/engine-analysis/engine-analysis.repository.prisma.js';
import { createStockfishEngine, settingsHash } from '../dist/modules/engine-analysis/stockfish.adapter.js';

const prisma = prismaModule.default ?? prismaModule;
const SETTINGS = Object.freeze({ depth: 6, multiPv: 1, threads: 1, hashMb: 16 });
const INDEXED_AT = new Date('2026-09-10T12:00:00.000Z');
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

function repositoryWithoutDiscovery() {
  // An explicit pre-enqueued run keeps the native test bounded to one game.
  // All lease claims, writes and recovery still use the real Prisma repository.
  return { ...prismaAnalysisRepository, async enqueueEligibleGame() { return null; } };
}

async function childWorker() {
  const runId = Number(process.env.RESTART_TEST_RUN_ID);
  assert.ok(Number.isSafeInteger(runId));
  const service = createStockfishAnalysisService({
    repository: repositoryWithoutDiscovery(),
    settings: SETTINGS,
    analysisVersion: process.env.RESTART_TEST_ANALYSIS_VERSION,
    workerId: 'killed-native-node-' + process.pid,
    engineFactory: async () => {
      const engine = await createStockfishEngine({
        binaryPath: process.env.STOCKFISH_PATH,
        settings: SETTINGS,
        commandTimeoutMs: 15_000,
      });
      return {
        ...engine,
        async analyzeFen(fen) {
          // The parent kills the entire Linux process group after this actual UCI
          // search, before the worker can persist its first batch of results.
          const result = await engine.analyzeFen(fen);
          process.send?.({ phase: 'native-search-finished', runId, engineName: engine.engineName });
          await new Promise(() => { setInterval(() => {}, 1_000); });
          return result;
        },
      };
    },
  });
  await service.runOnce();
  throw new Error('The crash fixture must not finish a worker cycle');
}

async function waitForNativeSearch(child, stderr) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Timed out awaiting first native search; ' + stderr())), 25_000);
    function onMessage(message) {
      if (message?.phase === 'native-search-finished') finish(null, message);
    }
    function onExit(code, signal) {
      finish(new Error('Worker exited before native-search marker (' + code + ', ' + signal + '): ' + stderr()));
    }
    function onError(error) { finish(error); }
    function finish(error, message) {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      child.off('error', onError);
      if (error) reject(error); else resolve(message);
    }
    child.on('message', onMessage);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

if (process.env.RESTART_TEST_CHILD === '1') {
  await childWorker();
} else {
  test('real Stockfish: SIGKILL Node worker, expire lease, and complete same snapshot in a fresh worker', {
    skip: process.env.RUN_REAL_STOCKFISH_ACCEPTANCE !== '1' || process.platform !== 'linux',
  }, async () => {
    const suffix = randomUUID();
    const analysisVersion = 'native-node-restart-' + suffix;
    const positionIds = [];
    let userId = null;
    let child = null;
    let childKilled = false;
    try {
      const user = await prisma.appUser.create({
        data: { authProvider: 'TEST', authSubject: 'native-node-restart-' + suffix },
      });
      userId = user.id;
      const game = await prisma.importedGame.create({
        data: {
          appUserId: user.id,
          provider: 'LICHESS',
          providerGameId: 'native-restart-' + suffix,
          connectedLichessUserId: 'fixture-user',
          connectedLichessUsername: 'FixtureUser',
          variant: 'standard',
          speedCategory: 'blitz',
          plyIndexStatus: 'INDEXED',
          plyIndexedAt: INDEXED_AT,
        },
      });
      const before = await prisma.position.create({
        data: {
          positionKey: Buffer.from(randomUUID().replaceAll('-', ''), 'hex'),
          normalizedFen: START_FEN,
        },
      });
      const after = await prisma.position.create({
        data: {
          positionKey: Buffer.from(randomUUID().replaceAll('-', ''), 'hex'),
          normalizedFen: AFTER_E4_FEN,
        },
      });
      positionIds.push(before.id, after.id);
      await prisma.importedGamePly.create({
        data: {
          importedGameId: game.id,
          plyNumber: 1,
          beforePositionId: before.id,
          afterPositionId: after.id,
          moveUci: 'e2e4',
          moverColor: 'WHITE',
          isUserMove: true,
        },
      });
      const runId = await prismaAnalysisRepository.requestReanalysis({
        importedGameId: game.id,
        analysisVersion,
        settingsHash: settingsHash(SETTINGS),
        settings: SETTINGS,
      });

      let childStderr = '';
      child = fork(fileURLToPath(import.meta.url), [], {
        detached: true,
        execArgv: [],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: {
          ...process.env,
          RESTART_TEST_CHILD: '1',
          RESTART_TEST_RUN_ID: String(runId),
          RESTART_TEST_ANALYSIS_VERSION: analysisVersion,
        },
      });
      child.stderr.on('data', (chunk) => { childStderr = (childStderr + chunk).slice(-4000); });
      const marker = await waitForNativeSearch(child, () => childStderr);
      assert.equal(marker.runId, runId);
      assert.match(marker.engineName, /Stockfish/i);
      const running = await prisma.gameAnalysisRun.findUniqueOrThrow({ where: { id: runId } });
      assert.equal(running.status, 'RUNNING');
      assert.equal(running.attempts, 1);
      assert.equal(running.positionsDone, 0, 'no first-search result was committed');
      assert.equal(running.pliesDone, 0);
      assert.ok(running.claimToken);
      const oldClaim = {
        id: running.id,
        importedGameId: game.id,
        snapshotId: running.snapshotId,
        attempts: running.attempts,
        maxAttempts: running.maxAttempts,
        analysisVersion: running.analysisVersion,
        settingsHash: running.settingsHash,
        sourcePlyIndexedAt: running.sourcePlyIndexedAt,
        workerId: running.workerId,
        claimToken: running.claimToken,
      };

      // Detached process group contains the Node worker and its native Stockfish
      // child. Kill both so CI never leaves an orphaned engine process.
      const workerExit = once(child, 'exit');
      process.kill(-child.pid, 'SIGKILL');
      const [code, signal] = await workerExit;
      childKilled = true;
      assert.equal(code, null);
      assert.equal(signal, 'SIGKILL');
      assert.equal((await prisma.gameAnalysisRun.findUniqueOrThrow({ where: { id: runId } })).status, 'RUNNING',
        'abrupt Node termination leaves an unreconciled durable claim');

      // Move only the test's lease cutoff forward: no five-minute CI delay.
      assert.equal(await prismaAnalysisRepository.recoverStaleRuns(new Date(Date.now() + 1_000)), 1);
      const expired = await prisma.gameAnalysisRun.findUniqueOrThrow({ where: { id: runId } });
      assert.equal(expired.status, 'RETRY_WAIT');
      assert.equal(expired.claimToken, null);
      assert.equal(expired.coverageStatus, 'PENDING');
      assert.equal(await prismaAnalysisRepository.persistBatch(oldClaim, {
        engineName: marker.engineName,
        engineVersion: '16',
        positionResults: [],
        plyResults: [],
        positionsDone: 0,
        pliesDone: 0,
      }), false, 'expired worker must not write with its old claim token');
      assert.equal(await prismaAnalysisRepository.markSucceeded(oldClaim), false);

      let freshEngineCount = 0;
      let freshEngineClosed = 0;
      const replacement = createStockfishAnalysisService({
        repository: repositoryWithoutDiscovery(),
        settings: SETTINGS,
        analysisVersion,
        workerId: 'replacement-native-node-' + suffix,
        engineFactory: async () => {
          freshEngineCount++;
          const engine = await createStockfishEngine({
            binaryPath: process.env.STOCKFISH_PATH,
            settings: SETTINGS,
            commandTimeoutMs: 15_000,
          });
          return { ...engine, async close() { freshEngineClosed++; await engine.close(); } };
        },
      });
      assert.equal(await replacement.runOnce(), true);
      assert.equal(freshEngineCount, 1);
      assert.equal(freshEngineClosed, 1);
      const completed = await prisma.gameAnalysisRun.findUniqueOrThrow({ where: { id: runId } });
      assert.equal(completed.status, 'SUCCEEDED');
      assert.equal(completed.coverageStatus, 'COMPLETE');
      assert.equal(completed.attempts, 2);
      assert.equal(completed.snapshotId, running.snapshotId);
      assert.equal(completed.sourcePlyIndexedAt.getTime(), INDEXED_AT.getTime());
      assert.equal(completed.positionsTotal, 2);
      assert.equal(completed.positionsDone, 2);
      assert.equal(completed.pliesTotal, 1);
      assert.equal(completed.pliesDone, 1);
      assert.equal(completed.cacheMisses, 2);
      assert.equal(completed.claimToken, null);
      assert.match(completed.engineName, /Stockfish/i);
      const ply = await prisma.importedGamePly.findUniqueOrThrow({
        where: { importedGameId_plyNumber: { importedGameId: game.id, plyNumber: 1 } },
      });
      assert.equal(ply.engineAnalysisRunId, runId);
      assert.ok(Number.isFinite(ply.scoreLossCp));
      assert.ok(Number.isInteger(ply.classificationCode));
      assert.equal(await prisma.stockfishPositionAnalysis.count({
        where: { positionId: { in: positionIds }, analysisVersion },
      }), 2);
    } finally {
      if (child && !childKilled && child.pid && child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      if (userId !== null) {
        await prisma.appUser.delete({ where: { id: userId } }).catch(() => {});
      }
      if (positionIds.length > 0) {
        await prisma.stockfishPositionAnalysis.deleteMany({
          where: { positionId: { in: positionIds } },
        }).catch(() => {});
        await prisma.position.deleteMany({ where: { id: { in: positionIds } } }).catch(() => {});
      }
      await prisma.$disconnect();
    }
  });
}
