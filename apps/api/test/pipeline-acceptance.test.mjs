import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { importedGameReplayResponseSchema } from '@why-i-suck-at-chess/contracts';
import prismaModule from '../dist/prisma.js';
import { createLichessAccountImportService } from '../dist/modules/account-imports/account-import.service.js';
import { createStockfishAnalysisService } from '../dist/modules/engine-analysis/engine-analysis.service.js';
import { prismaAnalysisRepository } from '../dist/modules/engine-analysis/engine-analysis.repository.prisma.js';
import { evidenceDetectors } from '../dist/modules/evidence/evidence.registry.js';
import { prismaEvidenceRepository } from '../dist/modules/evidence/evidence.repository.prisma.js';
import { createEvidenceService } from '../dist/modules/evidence/evidence.service.js';
import { createImportedGamesQueryService } from '../dist/modules/imported-games/imported-games.service.js';
import { ImportedGamePlyIndexService } from '../dist/modules/imported-games/ply-index.service.js';
import { runWorkerCycle } from '../dist/worker.js';

const prisma = prismaModule.default ?? prismaModule;
const CLOCKS = [2950, 2950, 2900, 2900];

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

test('DB-backed worker cycle carries a clock-complete bullet game through import, indexing, analysis, evidence, and replay', async () => {
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
      '[TimeControl "30+0"]',
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
          speed: 'bullet',
          perf: 'bullet',
          createdAt: new Date('2026-09-10T12:00:00.000Z').getTime(),
          lastMoveAt: new Date('2026-09-10T12:01:00.000Z').getTime(),
          status: 'resign',
          winner: 'white',
          url: 'https://lichess.org/' + providerGameId,
          pgn,
          clock: { initial: 30, increment: 0 },
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

        const workKey = [
          'pipeline-acceptance',
          suffix,
          detector.key,
          detector.version,
          game.plyIndexedAt.toISOString(),
          sourceAnalysis?.snapshotId ?? '-',
        ].join(':');
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

    assert.equal(await runWorkerCycle({
      importService: importExecutor,
      plyIndexService: plyIndexExecutor,
      analysisService,
      evidenceService,
    }), true);

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
    assert.equal(replay.speedCategory, 'bullet');
    assert.equal(replay.provenance.source, 'LICHESS_API');
    assert.equal(replay.clockSource.presence, 'PRESENT');
    assert.equal(replay.clockSource.stateCount, CLOCKS.length);
    assert.equal(replay.timing.coverageStatus, 'COMPLETE');
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
      CLOCKS,
    );
    assert.equal(replay.plies[2].timing.status, 'AVAILABLE');
    assert.notEqual(replay.plies[2].timing.moveTimeCentiseconds, null);

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
      assert.equal(ply.sourceClock.status, 'AVAILABLE');
      assert.equal(ply.engine.status, 'AVAILABLE');
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
    assert.ok(staleReplay.plies.every((ply) => ply.evidenceEventKeys.length === 0));
  } finally {
    if (userId !== null) {
      await prisma.appUser.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
});
