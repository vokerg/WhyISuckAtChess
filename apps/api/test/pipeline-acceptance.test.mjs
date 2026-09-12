import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import prismaModule from '../dist/prisma.js';
import { createLichessAccountImportService } from '../dist/modules/account-imports/account-import.service.js';
import { createStockfishAnalysisService } from '../dist/modules/engine-analysis/engine-analysis.service.js';
import { prismaAnalysisRepository } from '../dist/modules/engine-analysis/engine-analysis.repository.prisma.js';
import { createImportedGamesQueryService } from '../dist/modules/imported-games/imported-games.service.js';
import { ImportedGamePlyIndexService } from '../dist/modules/imported-games/ply-index.service.js';
import { runWorkerCycle } from '../dist/worker.js';

const prisma = prismaModule.default ?? prismaModule;
const CLOCKS = [5900, 5900, 5900, 5900];

function deterministicAnalysis() {
  return {
    depth: 8,
    scoreCpWhite: 0,
    mateWhite: null,
    bestMove: null,
    bestPv: [],
    multiPv: [],
    rawInfo: ['deterministic pipeline fixture'],
  };
}

test('DB-backed worker cycle carries a clock-complete Lichess game through import, indexing, analysis, and replay', async () => {
  const suffix = randomUUID();
  const providerGameId = 'pipeline-' + suffix;
  const from = new Date('2026-09-10T00:00:00.000Z');
  const to = new Date('2026-09-11T00:00:00.000Z');
  const claimedAt = new Date('2026-09-10T00:00:01.000Z');
  let userId = null;
  let targetGameId = null;
  let queuedAnalysisRunId = null;
  let engineCalls = 0;
  let engineClosed = false;

  try {
    const user = await prisma.appUser.create({
      data: { authProvider: 'TEST', authSubject: 'pipeline-' + suffix },
    });
    userId = user.id;

    const credential = {
      lichessUserId: 'fixture-user-' + suffix,
      username: 'FixtureUser',
      accessToken: 'pipeline-token',
      credentialGeneration: 'pipeline-generation',
    };
    const pgn = [
      '[Event "pipeline fixture"]',
      '[Site "https://lichess.org/' + providerGameId + '"]',
      '[Date "2026.09.10"]',
      '[White "FixtureUser"]',
      '[Black "Opponent"]',
      '[Result "1-0"]',
      '[TimeControl "60+1"]',
      '',
      '1. e4 e5 2. Nf3 Nc6 1-0',
    ].join('\n');

    const importService = createLichessAccountImportService({
      connectionService: {
        async getCredentialForUser(appUserId) {
          assert.equal(appUserId, user.id);
          return credential;
        },
        async markCredentialRevokedForUser() {
          return true;
        },
      },
      fetchImpl: async (url, init) => {
        const requestUrl = new URL(String(url));
        assert.equal(requestUrl.searchParams.get('clocks'), 'true');
        assert.equal(requestUrl.searchParams.get('perfType'), 'bullet,blitz,rapid');
        assert.equal(init.headers.Authorization, 'Bearer pipeline-token');
        return new Response(JSON.stringify({
          id: providerGameId,
          rated: true,
          variant: 'standard',
          speed: 'blitz',
          perf: 'blitz',
          createdAt: new Date('2026-09-10T12:00:00.000Z').getTime(),
          lastMoveAt: new Date('2026-09-10T12:01:00.000Z').getTime(),
          status: 'resign',
          winner: 'white',
          url: 'https://lichess.org/' + providerGameId,
          pgn,
          clock: { initial: 60, increment: 1 },
          clocks: CLOCKS,
          players: {
            white: { user: { id: credential.lichessUserId, name: credential.username }, rating: 1500 },
            black: { user: { id: 'opponent-' + suffix, name: 'Opponent' }, rating: 1510 },
          },
        }) + '\n', {
          headers: { 'content-type': 'application/x-ndjson' },
        });
      },
    });

    const importRun = await importService.requestImport(user.id, { from, to, rated: true });
    await prisma.importRun.update({
      where: { id: importRun.id },
      data: {
        status: 'RUNNING',
        claimedAt,
        heartbeatAt: claimedAt,
        startedAt: claimedAt,
      },
    });

    let importExecuted = false;
    const importExecutor = {
      async runOnce() {
        if (importExecuted) return false;
        const run = await importService.getRun(user.id, importRun.id);
        assert.ok(run);
        assert.equal(run.status, 'RUNNING');
        const completed = await importService.executeRun(run);
        assert.equal(completed?.status, 'COMPLETED');
        importExecuted = true;
        return true;
      },
    };

    const plyIndexExecutor = {
      async runOnce() {
        const game = await prisma.importedGame.findFirst({
          where: { appUserId: user.id, providerGameId },
        });
        assert.ok(game, 'import stage must persist the source game before indexing');
        targetGameId = game.id;
        const result = await ImportedGamePlyIndexService.indexOne(user.id, game.id);
        assert.equal(result.status, 'INDEXED');
        return true;
      },
    };

    const scopedAnalysisRepository = {
      ...prismaAnalysisRepository,
      async recoverStaleRuns() {
        return 0;
      },
      async enqueueEligibleGame(input) {
        assert.ok(targetGameId, 'index stage must publish a game before analysis is enqueued');
        queuedAnalysisRunId = await prismaAnalysisRepository.requestReanalysis({
          importedGameId: targetGameId,
          analysisVersion: input.analysisVersion,
          settingsHash: input.settingsHash,
          settings: input.settings,
        });
        return queuedAnalysisRunId;
      },
      async claimNext(workerId) {
        if (queuedAnalysisRunId === null) return null;
        const runId = queuedAnalysisRunId;
        const candidate = await prisma.gameAnalysisRun.findUniqueOrThrow({
          where: { id: runId },
        });
        assert.ok(candidate.sourcePlyIndexedAt);
        const now = new Date();
        const claimToken = randomUUID();
        const claimed = await prisma.gameAnalysisRun.updateMany({
          where: {
            id: runId,
            status: 'QUEUED',
            sourcePlyIndexedAt: candidate.sourcePlyIndexedAt,
            cancelRequestedAt: null,
            importedGame: {
              plyIndexStatus: 'INDEXED',
              plyIndexedAt: candidate.sourcePlyIndexedAt,
            },
          },
          data: {
            status: 'RUNNING',
            coverageStatus: 'PENDING',
            attempts: { increment: 1 },
            startedAt: candidate.startedAt ?? now,
            claimedAt: now,
            heartbeatAt: now,
            workerId,
            claimToken,
            error: null,
            completedAt: null,
          },
        });
        assert.equal(claimed.count, 1);

        const run = await prisma.gameAnalysisRun.findUniqueOrThrow({ where: { id: runId } });
        queuedAnalysisRunId = null;
        return {
          id: run.id,
          importedGameId: run.importedGameId,
          snapshotId: run.snapshotId,
          attempts: run.attempts,
          maxAttempts: run.maxAttempts,
          analysisVersion: run.analysisVersion,
          settingsHash: run.settingsHash,
          sourcePlyIndexedAt: run.sourcePlyIndexedAt,
          workerId,
          claimToken,
        };
      },
    };

    const analysisService = createStockfishAnalysisService({
      repository: scopedAnalysisRepository,
      analysisVersion: 'pipeline-acceptance-' + suffix,
      settings: { depth: 8, multiPv: 1, threads: 1, hashMb: 1 },
      workerId: 'pipeline-worker-' + suffix,
      engineFactory: async () => ({
        engineName: 'PipelineFake-' + suffix,
        engineVersion: '1',
        async analyzeFen() {
          engineCalls += 1;
          return deterministicAnalysis();
        },
        async close() {
          engineClosed = true;
        },
      }),
    });

    assert.equal(await runWorkerCycle({
      importService: importExecutor,
      plyIndexService: plyIndexExecutor,
      analysisService,
    }), true);

    assert.ok(targetGameId);
    const game = await prisma.importedGame.findUniqueOrThrow({
      where: { id: targetGameId },
    });
    assert.equal(game.plyIndexStatus, 'INDEXED');
    assert.ok(game.plyIndexedAt);
    assert.equal(game.rawClockPresence, 'PRESENT');
    assert.equal(game.rawClockStateCount, CLOCKS.length);
    assert.equal(game.clockAlignmentStatus, 'COMPLETE');
    assert.equal(game.timingCoverageStatus, 'COMPLETE');

    const analysisRun = await prisma.gameAnalysisRun.findFirstOrThrow({
      where: { importedGameId: game.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    assert.equal(analysisRun.status, 'SUCCEEDED');
    assert.equal(analysisRun.coverageStatus, 'COMPLETE');
    assert.equal(analysisRun.sourcePlyIndexedAt?.getTime(), game.plyIndexedAt.getTime());
    assert.ok(engineCalls > 0, 'acceptance test must use the deterministic engine double');
    assert.equal(engineClosed, true);

    const replay = await createImportedGamesQueryService().getReplay(user.id, game.id);
    assert.ok(replay);
    assert.equal(replay.providerGameId, providerGameId);
    assert.equal(replay.provenance.source, 'LICHESS_API');
    assert.equal(replay.clockSource.presence, 'PRESENT');
    assert.equal(replay.clockSource.stateCount, CLOCKS.length);
    assert.equal(replay.timing.coverageStatus, 'COMPLETE');
    assert.equal(replay.engine.status, 'COMPLETED');
    assert.equal(replay.engine.coverageStatus, 'COMPLETE');
    assert.equal(replay.engine.runId, analysisRun.id);
    assert.equal(replay.plies.length, 4);
    assert.deepEqual(
      replay.plies.map((ply) => ply.sourceClock.afterCentiseconds),
      CLOCKS,
    );
    assert.equal(replay.plies[2].timing.status, 'AVAILABLE');
    assert.notEqual(replay.plies[2].timing.moveTimeCentiseconds, null);

    for (const ply of replay.plies) {
      assert.equal(ply.sourceClock.status, 'AVAILABLE');
      assert.equal(ply.engine.status, 'AVAILABLE');
      assert.equal(ply.engine.analysisRunId, analysisRun.id);
      assert.equal(ply.engine.beforePosition.status, 'AVAILABLE');
    }
  } finally {
    if (userId !== null) {
      await prisma.appUser.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
});
