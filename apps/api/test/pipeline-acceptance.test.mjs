import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { importedGameReplayResponseSchema } from '@why-i-suck-at-chess/contracts';
import prismaModule from '../dist/prisma.js';
import { createLichessAccountImportService } from '../dist/modules/account-imports/account-import.service.js';
import { createStockfishAnalysisService } from '../dist/modules/engine-analysis/engine-analysis.service.js';
import { createStockfishEngine } from '../dist/modules/engine-analysis/stockfish.adapter.js';
import { prismaAnalysisRepository } from '../dist/modules/engine-analysis/engine-analysis.repository.prisma.js';
import { evidenceDetectors } from '../dist/modules/evidence/evidence.registry.js';
import { prismaEvidenceRepository } from '../dist/modules/evidence/evidence.repository.prisma.js';
import { createEvidenceService } from '../dist/modules/evidence/evidence.service.js';
import { createImportedGamesQueryService } from '../dist/modules/imported-games/imported-games.service.js';
import { ImportedGamePlyIndexService } from '../dist/modules/imported-games/ply-index.service.js';
import { runWorkerCycle } from '../dist/worker.js';

const prisma = prismaModule.default ?? prismaModule;
// This is an explicit opt-in integration gate: the normal API suite keeps its
// deterministic double, while the real binary gate exercises three exact controls.
const REAL_STOCKFISH = process.env.RUN_REAL_STOCKFISH_ACCEPTANCE === '1';
const FIXTURES = REAL_STOCKFISH
  ? [
      { speed: 'bullet', initial: 30, increment: 0, clocks: [2950, 2950, 2900, 2900] },
      { speed: 'blitz', initial: 180, increment: 2, clocks: [18150, 18100, 18100, 18000] },
      { speed: 'rapid', initial: 600, increment: 5, clocks: [60400, 60350, 60200, 60200] },
      { label: 'blitz without source clocks', speed: 'blitz', initial: 180, increment: 2, clocks: null, clockAlignment: 'UNAVAILABLE' },
      { label: 'blitz short source clocks', speed: 'blitz', initial: 180, increment: 2, clocks: [18150, 18100], clockAlignment: 'UNALIGNED' },
      { label: 'blitz excessive source clocks', speed: 'blitz', initial: 180, increment: 2, clocks: [18150, 18100, 18100, 18000, 17900, 17800], clockAlignment: 'ANOMALOUS' },
      { label: 'blitz native process crash then durable retry', speed: 'blitz', initial: 180, increment: 2, clocks: [18150, 18100, 18100, 18000], retryAfterProcessCrash: true },
    ]
  : [{ speed: 'bullet', initial: 30, increment: 0, clocks: [2950, 2950, 2900, 2900] }];

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

for (const fixture of FIXTURES) {
test(`DB-backed worker cycle: ${fixture.label ?? fixture.speed} import through ${REAL_STOCKFISH ? 'real Stockfish' : 'engine double'}, evidence, and replay`, async () => {
  const completeClocks = fixture.clockAlignment === undefined;
  const rawClocks = fixture.clocks ?? [];
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
  let realEngineProcessExited = null;
  let nativeEngineSpawns = 0;
  let nativeCrashInjected = false;

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
      `[TimeControl "${fixture.initial}+${fixture.increment}"]`,
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
          speed: fixture.speed,
          perf: fixture.speed,
          createdAt: new Date('2026-09-10T12:00:00.000Z').getTime(),
          lastMoveAt: new Date('2026-09-10T12:01:00.000Z').getTime(),
          status: 'resign',
          winner: 'white',
          url: 'https://lichess.org/' + providerGameId,
          pgn,
          clock: { initial: fixture.initial, increment: fixture.increment },
          clocks: fixture.clocks ?? undefined,
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
        assert.ok(
          result.status === 'INDEXED' || result.status === 'ALREADY_INDEXED',
          'the idempotent index stage must leave the fixture indexed',
        );
        return true;
      },
    };

    const scopedAnalysisRepository = {
      ...prismaAnalysisRepository,
      async recoverStaleRuns() {
        return 0;
      },
      async enqueueEligibleGame(input) {
        // Retain the existing durable RETRY_WAIT row on the second cycle instead of
        // requesting a new snapshot and accidentally superseding the retry.
        if (queuedAnalysisRunId !== null) return null;
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
        assert.ok(['QUEUED', 'RETRY_WAIT'].includes(candidate.status));
        const now = new Date();
        const claimToken = randomUUID();
        const claimed = await prisma.gameAnalysisRun.updateMany({
          where: {
            id: runId,
            status: candidate.status,
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
      settings: { depth: REAL_STOCKFISH ? 6 : 8, multiPv: 1, threads: 1, hashMb: REAL_STOCKFISH ? 16 : 1 },
      workerId: 'pipeline-worker-' + suffix,
      engineFactory: async () => {
        if (REAL_STOCKFISH) {
          // Uses the actual child-process/UCI adapter; no fake search output.
          let spawnedChild = null;
          const engine = await createStockfishEngine({
            binaryPath: process.env.STOCKFISH_PATH,
            settings: { depth: 6, multiPv: 1, threads: 1, hashMb: 16 },
            commandTimeoutMs: 15_000,
            spawnProcess: (binaryPath) => {
              const child = spawn(binaryPath, [], { stdio: 'pipe' });
              spawnedChild = child;
              nativeEngineSpawns += 1;
              realEngineProcessExited = new Promise((resolve) => {
                child.once('exit', resolve);
              });
              return child;
            },
          });
          assert.match(engine.engineName, /Stockfish/i);
          assert.match(engine.engineVersion, /^\d+/);
          return {
            engineName: engine.engineName,
            engineVersion: engine.engineVersion,
            async analyzeFen(fen) {
              engineCalls += 1;
              if (fixture.retryAfterProcessCrash && !nativeCrashInjected) {
                nativeCrashInjected = true;
                assert.ok(spawnedChild, 'native process must exist before crash injection');
                const pendingSearch = engine.analyzeFen(fen);
                spawnedChild.kill('SIGKILL');
                return pendingSearch;
              }
              return engine.analyzeFen(fen);
            },
            async close() {
              await engine.close();
              engineClosed = true;
            },
          };
        }
        return {
          engineName: 'PipelineFake-' + suffix,
          engineVersion: '1',
          async analyzeFen() {
            engineCalls += 1;
            return deterministicAnalysis();
          },
          async close() {
            engineClosed = true;
          },
        };
      },
    });

    const scopedEvidenceRepository = {
      ...prismaEvidenceRepository,
      async recoverStaleRuns() {
        return 0;
      },
      async enqueueEligibleRun(detector) {
        assert.ok(targetGameId, 'analysis must publish a game before evidence is enqueued');
        const game = await prisma.importedGame.findUniqueOrThrow({
          where: { id: targetGameId },
          select: { plyIndexedAt: true },
        });
        assert.ok(game.plyIndexedAt);

        const usesAnalysis = detector.requiresCompleteAnalysis
          || detector.refreshOnCompleteAnalysis === true;
        const sourceAnalysis = usesAnalysis
          ? await prisma.gameAnalysisRun.findFirst({
              where: {
                importedGameId: targetGameId,
                status: 'SUCCEEDED',
                coverageStatus: 'COMPLETE',
                sourcePlyIndexedAt: game.plyIndexedAt,
              },
              orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
            })
          : null;
        if (usesAnalysis) {
          assert.ok(sourceAnalysis, detector.key + ' requires current complete analysis');
        }

        const workKey = createHash('sha256')
          .update([
            targetGameId,
            detector.key,
            detector.version,
            game.plyIndexedAt.toISOString(),
            sourceAnalysis?.snapshotId ?? '-',
          ].join('|'))
          .digest('hex');
        const existing = await prisma.evidenceRun.findUnique({
          where: { workKey },
          select: { id: true },
        });
        if (existing) return null;

        const run = await prisma.evidenceRun.create({
          data: {
            importedGameId: targetGameId,
            detectorKey: detector.key,
            detectorVersion: detector.version,
            workKey,
            sourcePlyIndexedAt: game.plyIndexedAt,
            sourceAnalysisRunId: sourceAnalysis?.id ?? null,
            sourceAnalysisSnapshotId: sourceAnalysis?.snapshotId ?? null,
          },
        });
        return run.id;
      },
      async claimNext(workerId, detectors) {
        if (targetGameId === null) return null;
        const now = new Date();
        const candidate = await prisma.evidenceRun.findFirst({
          where: {
            importedGameId: targetGameId,
            status: { in: ['QUEUED', 'RETRY_WAIT'] },
            runAfter: { lte: now },
            cancelRequestedAt: null,
            OR: detectors.map((detector) => ({
              detectorKey: detector.key,
              detectorVersion: detector.version,
            })),
          },
          orderBy: [{ runAfter: 'asc' }, { id: 'asc' }],
        });
        if (!candidate) return null;

        const claimToken = randomUUID();
        const claimed = await prisma.evidenceRun.updateMany({
          where: {
            id: candidate.id,
            status: candidate.status,
            cancelRequestedAt: null,
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
            isCurrent: false,
          },
        });
        assert.equal(claimed.count, 1);

        const run = await prisma.evidenceRun.findUniqueOrThrow({
          where: { id: candidate.id },
        });
        return {
          id: run.id,
          importedGameId: run.importedGameId,
          detectorKey: run.detectorKey,
          detectorVersion: run.detectorVersion,
          workKey: run.workKey,
          sourcePlyIndexedAt: run.sourcePlyIndexedAt,
          sourceAnalysisRunId: run.sourceAnalysisRunId,
          sourceAnalysisSnapshotId: run.sourceAnalysisSnapshotId,
          attempts: run.attempts,
          maxAttempts: run.maxAttempts,
          workerId,
          claimToken,
        };
      },
    };
    const evidenceService = createEvidenceService({
      detectors: evidenceDetectors,
      repository: scopedEvidenceRepository,
      workerId: 'pipeline-evidence-' + suffix,
    });

    if (fixture.retryAfterProcessCrash) {
      // Simulate a native process dying during search. The real service must
      // persist retry state and withhold incomplete engine/evidence from replay.
      assert.equal(await importExecutor.runOnce(), true);
      assert.equal(await plyIndexExecutor.runOnce(), true);
      assert.equal(await analysisService.runOnce(), true);
      assert.ok(queuedAnalysisRunId === null, 'first analysis claim was consumed');
      assert.ok(targetGameId);

      const failedRun = await prisma.gameAnalysisRun.findFirstOrThrow({
        where: { importedGameId: targetGameId },
      });
      assert.equal(failedRun.status, 'RETRY_WAIT');
      assert.equal(failedRun.coverageStatus, 'PENDING');
      assert.equal(failedRun.attempts, 1);
      assert.equal(failedRun.positionsDone, 0);
      assert.equal(failedRun.pliesDone, 0);
      assert.match(failedRun.error ?? '', /Stockfish exited unexpectedly/);
      assert.equal(await prisma.evidenceRun.count({ where: { importedGameId: targetGameId } }), 0);

      const beforeRetryPayload = await createImportedGamesQueryService().getReplay(user.id, targetGameId);
      assert.ok(beforeRetryPayload);
      const beforeRetry = importedGameReplayResponseSchema.parse(beforeRetryPayload);
      assert.notEqual(beforeRetry.engine.status, 'COMPLETED');
      assert.deepEqual(beforeRetry.evidence.runs, []);
      assert.ok(beforeRetry.plies.every((ply) => ply.engine.status === 'UNAVAILABLE'));

      // Advance only the fixture's backoff; keep the same run/snapshot and
      // exercise a second claim with a newly started native UCI process.
      await prisma.gameAnalysisRun.update({
        where: { id: failedRun.id },
        data: { runAfter: new Date(0) },
      });
      queuedAnalysisRunId = failedRun.id;
      assert.equal(await analysisService.runOnce(), true);
      const retriedRun = await prisma.gameAnalysisRun.findUniqueOrThrow({
        where: { id: failedRun.id },
      });
      assert.equal(retriedRun.status, 'SUCCEEDED');
      assert.equal(retriedRun.coverageStatus, 'COMPLETE');
      assert.equal(retriedRun.attempts, 2);
      assert.equal(retriedRun.snapshotId, failedRun.snapshotId);
      assert.equal(nativeEngineSpawns, 2, 'retry must start a fresh native Stockfish process');
      assert.equal(await evidenceService.runOnce(), true);
    } else {
      assert.equal(await runWorkerCycle({
        importService: importExecutor,
        plyIndexService: plyIndexExecutor,
        analysisService,
        evidenceService,
      }), true);
    }

    for (let processed = 1; processed < evidenceDetectors.length; processed += 1) {
      assert.equal(
        await evidenceService.runOnce(),
        true,
        'every registered Phase 3 detector should receive one fixture-scoped run',
      );
    }
    assert.equal(
      await evidenceService.runOnce(),
      false,
      'the same source projection must not enqueue duplicate evidence work',
    );

    assert.ok(targetGameId);
    const game = await prisma.importedGame.findUniqueOrThrow({
      where: { id: targetGameId },
    });
    assert.equal(game.plyIndexStatus, 'INDEXED');
    assert.ok(game.plyIndexedAt);
    assert.equal(game.rawClockPresence, fixture.clocks === null ? 'ABSENT' : 'PRESENT');
    assert.equal(game.rawClockStateCount, rawClocks.length);
    assert.equal(game.clockAlignmentStatus, fixture.clockAlignment ?? 'COMPLETE');
    assert.equal(game.timingCoverageStatus, completeClocks ? 'COMPLETE' : 'UNAVAILABLE');

    const analysisRun = await prisma.gameAnalysisRun.findFirstOrThrow({
      where: { importedGameId: game.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    assert.equal(analysisRun.status, 'SUCCEEDED');
    assert.equal(analysisRun.coverageStatus, 'COMPLETE');
    assert.equal(analysisRun.sourcePlyIndexedAt?.getTime(), game.plyIndexedAt.getTime());
    assert.ok(engineCalls > 0, 'integration must execute at least one engine search');
    if (REAL_STOCKFISH) {
      assert.match(analysisRun.engineName ?? '', /Stockfish/i);
      assert.match(analysisRun.engineVersion ?? '', /^\d+/);
      assert.ok(analysisRun.cacheMisses > 0, 'real pipeline must analyze an uncached position');
      assert.equal(analysisRun.positionsDone, analysisRun.positionsTotal);
      assert.equal(analysisRun.pliesDone, analysisRun.pliesTotal);
    } else {
      assert.match(analysisRun.engineName ?? '', /PipelineFake-/);
    }
    assert.equal(engineClosed, true);
    if (REAL_STOCKFISH) {
      assert.ok(realEngineProcessExited, 'native child must have spawned');
      const exitObserved = await Promise.race([
        realEngineProcessExited.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
      ]);
      assert.equal(exitObserved, true, 'native Stockfish process must exit after the worker closes it');
    }

    const persistedEvidenceRuns = await prisma.evidenceRun.findMany({
      where: { importedGameId: game.id },
      orderBy: [{ detectorKey: 'asc' }, { id: 'asc' }],
      include: { events: true },
    });
    assert.equal(persistedEvidenceRuns.length, evidenceDetectors.length);
    assert.deepEqual(
      persistedEvidenceRuns.map((run) => run.detectorKey).sort(),
      evidenceDetectors.map((detector) => detector.key).sort(),
    );
    for (const run of persistedEvidenceRuns) {
      assert.equal(run.status, 'SUCCEEDED');
      assert.equal(run.isCurrent, true);
      assert.equal(run.sourcePlyIndexedAt.getTime(), game.plyIndexedAt.getTime());
      if (run.detectorKey === 'phase-context') {
        assert.equal(run.sourceAnalysisRunId, null);
      } else {
        assert.equal(run.sourceAnalysisRunId, analysisRun.id);
        assert.equal(run.sourceAnalysisSnapshotId, analysisRun.snapshotId);
      }
    }
    const persistedEventKeys = persistedEvidenceRuns.flatMap(
      (run) => run.events.map((event) => event.evidenceKey),
    );
    assert.equal(
      new Set(persistedEventKeys).size,
      persistedEventKeys.length,
      'current detector events must keep stable non-colliding evidence identities',
    );

    const replayPayload = await createImportedGamesQueryService().getReplay(user.id, game.id);
    assert.ok(replayPayload);
    const replay = importedGameReplayResponseSchema.parse(replayPayload);
    assert.equal(replay.providerGameId, providerGameId);
    assert.equal(replay.speedCategory, fixture.speed);
    assert.equal(replay.provenance.source, 'LICHESS_API');
    assert.equal(replay.clockSource.presence, fixture.clocks === null ? 'ABSENT' : 'PRESENT');
    assert.equal(replay.clockSource.stateCount, rawClocks.length);
    assert.equal(replay.timing.coverageStatus, completeClocks ? 'COMPLETE' : 'UNAVAILABLE');
    assert.equal(replay.engine.status, 'COMPLETED');
    assert.equal(replay.engine.coverageStatus, 'COMPLETE');
    assert.equal(replay.engine.runId, analysisRun.id);
    assert.equal(replay.evidence.runs.length, evidenceDetectors.length);
    assert.deepEqual(
      replay.evidence.runs.map((run) => run.detectorKey).sort(),
      evidenceDetectors.map((detector) => detector.key).sort(),
    );
    assert.equal(replay.plies.length, 4);
    assert.deepEqual(
      replay.plies.map((ply) => ply.sourceClock.afterCentiseconds),
      completeClocks ? rawClocks : [null, null, null, null],
    );
    assert.equal(replay.plies[2].timing.status, completeClocks ? 'AVAILABLE' : 'UNAVAILABLE');
    if (completeClocks) {
      assert.notEqual(replay.plies[2].timing.moveTimeCentiseconds, null);
    } else {
      assert.equal(replay.plies[2].timing.moveTimeCentiseconds, null, 'missing clocks cannot create move times');
    }

    const phaseRun = replay.evidence.runs.find((run) => run.detectorKey === 'phase-context');
    assert.ok(phaseRun);
    assert.equal(phaseRun.coverage.status, 'COMPLETE');
    const phaseEvent = phaseRun.events.find(
      (event) => event.payload.kind === 'KNOWN'
        && event.payload.evidenceType === 'POSITION_PHASE_RANGE',
    );
    assert.ok(phaseEvent, 'the combined pipeline must expose structured phase evidence');
    assert.notEqual(phaseEvent.source.positionId, null);
    assert.notEqual(phaseEvent.source.startPly, null);
    assert.ok(
      replay.plies.some((ply) => ply.evidenceEventKeys.includes(phaseEvent.evidenceKey)),
      'read-model plies must link back to persisted evidence events',
    );
    assert.ok(
      replay.evidence.runs.some((run) => run.coverage.status !== 'COMPLETE'),
      'missing detector modalities must remain explicit coverage gaps rather than false negatives',
    );

    for (const ply of replay.plies) {
      assert.equal(ply.sourceClock.status, completeClocks ? 'AVAILABLE' : 'UNAVAILABLE');
      assert.equal(ply.engine.status, 'AVAILABLE', 'missing clocks cannot erase real engine facts');
      assert.equal(ply.engine.analysisRunId, analysisRun.id);
      assert.equal(ply.engine.beforePosition.status, 'AVAILABLE');
    }

    await prisma.importedGame.update({
      where: { id: game.id },
      data: { plyIndexedAt: new Date(game.plyIndexedAt.getTime() + 1_000) },
    });
    const staleReplayPayload = await createImportedGamesQueryService().getReplay(user.id, game.id);
    assert.ok(staleReplayPayload);
    const staleReplay = importedGameReplayResponseSchema.parse(staleReplayPayload);
    assert.deepEqual(
      staleReplay.evidence.runs,
      [],
      'changing the indexed source projection must immediately hide stale current evidence',
    );
    assert.notEqual(staleReplay.engine.status, 'COMPLETED', 'superseded engine run must not be advertised current');
    assert.ok(staleReplay.plies.every((ply) => ply.evidenceEventKeys.length === 0));
    assert.ok(staleReplay.plies.every((ply) => ply.engine.status === 'UNAVAILABLE'));
  } finally {
    if (userId !== null) {
      await prisma.appUser.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
});
}

test('real Stockfish subprocess exit rejects pending search (opt-in only)', {
  skip: !REAL_STOCKFISH,
}, async () => {
  let child = null;
  const engine = await createStockfishEngine({
    binaryPath: process.env.STOCKFISH_PATH,
    settings: { depth: 6, multiPv: 1, threads: 1, hashMb: 16 },
    commandTimeoutMs: 15_000,
    spawnProcess: (binaryPath) => {
      child = spawn(binaryPath, [], { stdio: 'pipe' });
      return child;
    },
  });
  try {
    assert.ok(child);
    child.kill('SIGKILL');
    await assert.rejects(
      () => engine.analyzeFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'),
      /Stockfish exited unexpectedly/,
    );
  } finally {
    await engine.close();
  }
  assert.equal(child.killed, true);
});
