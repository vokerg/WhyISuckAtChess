// Opt-in recorded-workload benchmark. No network and no application database.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, totalmem } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { assertDisposableCacheBenchmarkUrl, validatedCacheRun } from './phase-7-worker-cache-policy.mjs';
import { summarizeDurationMs } from './phase-7-benchmark-statistics.mjs';
import { sampleNativeChildProcessResources } from './phase-7-stockfish-child-resources.mjs';
import { summarizeNodeHostCycleResources } from './phase-7-node-host-resources.mjs';

const round = (x) => Math.round(x * 1000) / 1000;
const hash = (x) => createHash('sha256').update(x).digest('hex');
const fixtureUrl = new URL('../apps/api/benchmarks/fixtures/recorded-cc0-workload.json', import.meta.url);

// Drain every sibling before callers can clean up a failed benchmark database.
export async function settleBenchmarkWorkers(workers, abortChildren) {
  const signal = { aborted: false };
  const results = await Promise.allSettled(workers.map(async (work) => {
    try { await work(signal); } catch (error) {
      signal.aborted = true;
      abortChildren();
      throw error;
    }
  }));
  const errors = results.filter((x) => x.status === 'rejected').map((x) => x.reason);
  if (errors.length) throw new AggregateError(errors, 'Benchmark workers failed; all siblings have stopped.');
}

export function benchmarkOptions(env = process.env) {
  if (env.RUN_PHASE7_MULTIGAME_BENCHMARK !== '1') throw new Error('Opt in with RUN_PHASE7_MULTIGAME_BENCHMARK=1.');
  const database = assertDisposableCacheBenchmarkUrl(env.DATABASE_URL);
  if (!env.STOCKFISH_PATH || !isAbsolute(env.STOCKFISH_PATH)) throw new Error('STOCKFISH_PATH must be absolute.');
  const depth = Number(env.PHASE7_DEPTH ?? 10);
  const multiPv = Number(env.PHASE7_MULTIPV ?? 3);
  const concurrency = Number(env.PHASE7_CONCURRENCY ?? 1);
  const maxGames = Number(env.PHASE7_GAMES ?? 18);
  if (!Number.isInteger(depth) || depth < 6 || depth > 16
      || ![1, 3].includes(multiPv) || ![1, 2, 4].includes(concurrency)
      || ![6, 18].includes(maxGames)) throw new Error('Bounded options: depth 6–16, MultiPV 1/3, concurrency 1/2/4, games 6/18.');
  return { database, binary: env.STOCKFISH_PATH, settings: { depth, multiPv, threads: 1, hashMb: 64 }, concurrency, maxGames };
}

async function childResources(pid) {
  if (platform() === 'linux') return sampleNativeChildProcessResources(pid);
  if (platform() !== 'darwin') throw new Error('Native resources require Linux or macOS.');
  const raw = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'cputime=,rss='], { encoding: 'utf8', timeout: 2000 }).trim();
  const m = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s+(\d+)$/.exec(raw);
  if (!m) throw new Error('Could not sample live macOS Stockfish process.');
  return { source: 'DARWIN_PS_LIVE_CHILD', cpuTotalMs: round(((Number(m[1] || 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000),
    residentBytesAtClose: Number(m[4]) * 1024, peakResidentBytes: null };
}

export async function runMultigameBenchmark() {
  const options = benchmarkOptions();
  const benchmarkScriptSha256 = hash(await readFile(new URL(import.meta.url)));
  const gitRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const fixtureBytes = await readFile(fixtureUrl);
  const fixture = JSON.parse(fixtureBytes);
  assert.equal(fixture.schemaVersion, 'phase-7-recorded-workload-v1');
  let samples = fixture.games;
  if (options.maxGames === 6) samples = samples.filter((x) => x.lengthBand === 'short');
  assert.equal(samples.length, options.maxGames);
  const binarySha256 = hash(await readFile(options.binary));
  // Load services only after the local disposable-target guard.
  const prismaModule = await import('../apps/api/dist/prisma.js');
  const prisma = prismaModule.default.default ?? prismaModule.default;
  const { createLichessAccountImportService } = await import('../apps/api/dist/modules/account-imports/account-import.service.js');
  const { ImportedGamePlyIndexService } = await import('../apps/api/dist/modules/imported-games/ply-index.service.js');
  const { createStockfishAnalysisService } = await import('../apps/api/dist/modules/engine-analysis/engine-analysis.service.js');
  const { prismaAnalysisRepository } = await import('../apps/api/dist/modules/engine-analysis/engine-analysis.repository.prisma.js');
  const { createStockfishEngine, settingsHash } = await import('../apps/api/dist/modules/engine-analysis/stockfish.adapter.js');
  const { createEvidenceService } = await import('../apps/api/dist/modules/evidence/evidence.service.js');
  const { evidenceDetectors } = await import('../apps/api/dist/modules/evidence/evidence.registry.js');
  const { createDiagnosisWorkerService } = await import('../apps/api/dist/modules/diagnosis/diagnosis-worker.service.js');
  const { diagnosisSummaryService } = await import('../apps/api/dist/modules/diagnosis/diagnosis-summary.service.js');
  const { CURRENT_DIAGNOSIS_ANALYSIS } = await import('../apps/api/dist/modules/engine-analysis/current-analysis-identity.js');
  const { diagnosisMaterializationVersions } = await import('../apps/api/dist/modules/diagnosis/diagnosis-materialization.versions.js');
  const settingsId = settingsHash(options.settings);
  const analysisVersion = 'phase7-recorded-benchmark-v1';
  // This isolated process publishes against its explicitly measured settings.
  // Production defaults and application processes are untouched.
  const originalIdentity = { ...CURRENT_DIAGNOSIS_ANALYSIS };
  const originalVersions = { ...diagnosisMaterializationVersions.policyVersions };
  Object.assign(CURRENT_DIAGNOSIS_ANALYSIS, { analysisVersion, settingsHash: settingsId });
  Object.assign(diagnosisMaterializationVersions.policyVersions, { analysis: analysisVersion, settings: settingsId });
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Benchmark blocked an unexpected external network request.'); };
  let user;
  let positionIds = [];
  let deadline;
  const children = new Set();
  const measure = async (operation) => { const started = performance.now(); const value = await operation(); return { value, wallMs: round(performance.now() - started) }; };
  const dbSnapshot = async () => {
    const [row] = await prisma.$queryRaw`SELECT pg_database_size(current_database())::text AS bytes,
      current_setting('TimeZone') AS timezone, version() AS version,
      (SELECT json_build_object('commits', xact_commit, 'rollbacks', xact_rollback, 'blocksRead', blks_read,
        'blocksHit', blks_hit, 'tuplesReturned', tup_returned, 'tuplesFetched', tup_fetched,
        'tuplesInserted', tup_inserted, 'tuplesUpdated', tup_updated, 'tuplesDeleted', tup_deleted)
       FROM pg_stat_database WHERE datname = current_database()) AS counters`;
    return { physicalBytes: Number(row.bytes), timezone: row.timezone, version: row.version, counters: row.counters };
  };
  try {
    const counts = await Promise.all([prisma.appUser.count(), prisma.importedGame.count(), prisma.position.count(), prisma.gameAnalysisRun.count()]);
    assert.ok(counts.every((n) => n === 0), 'Benchmark requires an empty migrated database.');
    const dbBefore = await dbSnapshot();
    assert.ok(['UTC', 'Etc/UTC'].includes(dbBefore.timezone), 'Controlled benchmark profile requires UTC/Etc/UTC PostgreSQL sessions.');
    // Hard deadline kills engines even if a worker stalls. No incomplete report is emitted.
    deadline = setTimeout(() => { for (const child of children) child.kill('SIGKILL'); console.error('Benchmark exceeded 30-minute hard deadline.'); process.exit(124); }, 30 * 60_000);
    const scenarioStarted = performance.now();
    const cpuBefore = process.cpuUsage(); const rssBefore = process.memoryUsage.rss();
    user = await prisma.appUser.create({ data: { authProvider: 'TEST', authSubject: 'phase7-recorded-' + randomUUID() } });
    const records = samples.map((game, i) => ({
      id: `bench${String(i).padStart(3, '0')}`, rated: true, variant: 'standard', speed: game.speed,
      createdAt: game.createdAt, status: game.status,
      ...(game.result === '1-0' ? { winner: 'white' } : game.result === '0-1' ? { winner: 'black' } : {}),
      pgn: game.pgn, clock: { initial: Number(game.control.split('+')[0]), increment: Number(game.control.split('+')[1]) }, clocks: game.clocks,
      players: { white: { user: { id: 'benchmarkuser', name: 'BenchmarkUser' }, rating: game.whiteRating },
        black: { user: { id: 'benchmarkopponent', name: 'BenchmarkOpponent' }, rating: game.blackRating } },
    }));
    const importer = createLichessAccountImportService({
      connectionService: { getCredentialForUser: async () => ({ lichessUserId: 'benchmarkuser', username: 'BenchmarkUser', accessToken: 'offline-fixture', credentialGeneration: 'benchmark' }), markCredentialRevokedForUser: async () => true },
      fetchImpl: async () => new Response(records.map((x) => JSON.stringify(x)).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } }),
    });
    const from = new Date(Math.min(...samples.map((x) => x.createdAt)) - 1000);
    const to = new Date(Math.max(...samples.map((x) => x.createdAt)) + 1000);
    const requested = await importer.requestImport(user.id, { from, to, rated: true });
    const importTiming = await measure(() => importer.runOnce());
    assert.equal((await importer.getRun(user.id, requested.id)).status, 'COMPLETED');
    const games = await prisma.importedGame.findMany({ where: { appUserId: user.id }, orderBy: { providerGameId: 'asc' } });
    assert.equal(games.length, samples.length);
    const indexing = [];
    for (const [i, game] of games.entries()) {
      const timed = await measure(() => ImportedGamePlyIndexService.indexOne(user.id, game.id));
      assert.equal(timed.value.status, 'INDEXED'); assert.equal(timed.value.pliesIndexed, samples[i].plies);
      indexing.push({ key: samples[i].key, wallMs: timed.wallMs });
    }
    positionIds = (await prisma.position.findMany({ select: { id: true } })).map((x) => x.id);
    const passes = [];
    for (const mode of ['cold', 'warm']) {
      const serviceForRequests = createStockfishAnalysisService({ analysisVersion, settings: options.settings });
      for (const game of games) await serviceForRequests.requestReanalysis(game.id);
      const queueStart = await prisma.gameAnalysisRun.count({ where: { status: 'QUEUED' } });
      assert.equal(queueStart, games.length);
      const cycleSamples = [];
      let activeAnalyses = 0; let peakActiveAnalyses = 0; let claimRaceRetries = 0;
      const passStarted = performance.now();
      const passCpu = process.cpuUsage(); const passRss = process.memoryUsage.rss();
      const workers = Array.from({ length: options.concurrency }, (_, workerIndex) => async (signal) => {
        let claim = null; let engineData = null;
        const repository = { ...prismaAnalysisRepository,
          // All jobs are pre-enqueued to measure an actual finite backlog.
          async enqueueEligibleGame() { return null; },
          async claimNext(workerId) {
            if (signal.aborted) return null;
            claim = await prismaAnalysisRepository.claimNext(workerId);
            if (claim) { activeAnalyses++; peakActiveAnalyses = Math.max(peakActiveAnalyses, activeAnalyses); }
            return claim;
          },
        };
        const service = createStockfishAnalysisService({ repository, settings: options.settings, analysisVersion,
          workerId: 'recorded-bench-' + workerIndex,
          engineFactory: async () => {
            if (signal.aborted) throw new Error('Benchmark sibling aborted.');
            let child;
            const startup = performance.now();
            const engine = await createStockfishEngine({ binaryPath: options.binary, settings: options.settings, commandTimeoutMs: 30_000,
              spawnProcess(command) { child = spawn(command, [], { stdio: 'pipe' }); children.add(child); child.once('exit', () => children.delete(child)); return child; },
            });
            engineData = { engineName: engine.engineName, engineVersion: engine.engineVersion, startupWallMs: round(performance.now() - startup), searchWallMs: [], nativeResources: null };
            return { ...engine,
              async analyzeFen(fen) { const timed = await measure(() => engine.analyzeFen(fen)); engineData.searchWallMs.push(timed.wallMs); return timed.value; },
              async close() {
                try {
                  // Do not mask the durable engine error if the adapter has
                  // already terminated a crashed/timed-out child.
                  if (child.exitCode === null && child.signalCode === null) engineData.nativeResources = await childResources(child.pid);
                } finally { await engine.close(); }
              },
            };
          },
        });
        let idlePolls = 0;
        for (;;) {
          if (signal.aborted) return;
          claim = null; engineData = null;
          let timed;
          try { timed = await measure(() => service.runOnce()); }
          finally { if (claim) activeAnalyses--; }
          if (!timed.value) {
            // A lost optimistic claim is not an empty queue. Keep competitors
            // alive while claimable work remains, with a bounded idle budget.
            const queued = await prisma.gameAnalysisRun.count({ where: { status: 'QUEUED', runAfter: { lte: new Date() } } });
            if (!queued) break;
            if (++idlePolls > 10_000) throw new Error('Benchmark claim contention exceeded idle budget.');
            claimRaceRetries++;
            await new Promise((done) => setTimeout(done, 10));
            continue;
          }
          idlePolls = 0;
          assert.ok(claim && engineData);
          const run = await prisma.gameAnalysisRun.findUniqueOrThrow({ where: { id: claim.id } });
          assert.equal(run.status, 'SUCCEEDED', run.error ?? 'Analysis did not succeed.');
          const validated = validatedCacheRun(run);
          assert.ok(engineData.nativeResources, 'Successful run lacks native resource measurement.');
          assert.equal(engineData.searchWallMs.length, run.cacheMisses);
          if (mode === 'warm') assert.equal(run.cacheMisses, 0, 'Warm pass must reuse actual complete cache rows.');
          const i = games.findIndex((x) => x.id === claim.importedGameId);
          cycleSamples.push({ key: samples[i].key, control: samples[i].control, speed: samples[i].speed, plies: samples[i].plies,
            workerIndex, workerWallMs: timed.wallMs, ...validated, ...engineData });
          console.error(`${mode} c=${options.concurrency} ${samples[i].key}: ${timed.wallMs}ms, ${run.cacheHits}/${run.positionsTotal} cache hits`);
        }
      });
      await settleBenchmarkWorkers(workers, () => { for (const child of children) child.kill('SIGKILL'); });
      const wallMs = round(performance.now() - passStarted);
      assert.equal(cycleSamples.length, games.length);
      const cacheHits = cycleSamples.reduce((n, x) => n + x.cacheHits, 0);
      const cacheMisses = cycleSamples.reduce((n, x) => n + x.cacheMisses, 0);
      passes.push({ mode, concurrency: options.concurrency, wallMs, games: games.length,
        peakActiveAnalyses, claimRaceRetries, participatingWorkers: new Set(cycleSamples.map((x) => x.workerIndex)).size,
        gamesPerHour: round(games.length * 3600_000 / wallMs), cacheHits, cacheMisses,
        cacheHitRatio: cacheHits / (cacheHits + cacheMisses),
        workerWallDistribution: summarizeDurationMs(cycleSamples.map((x) => x.workerWallMs)),
        queueLagDistribution: summarizeDurationMs(cycleSamples.map((x) => x.queueLagMs)),
        nativeCpuDistribution: summarizeDurationMs(cycleSamples.map((x) => x.nativeResources?.cpuTotalMs ?? 0)),
        searchWallDistribution: cacheMisses ? summarizeDurationMs(cycleSamples.flatMap((x) => x.searchWallMs)) : null,
        positionCacheRows: await prisma.stockfishPositionAnalysis.count(), samples: cycleSamples });
      passes.at(-1).nodeResources = summarizeNodeHostCycleResources(process.cpuUsage(passCpu), passRss, process.memoryUsage.rss());
    }
    const recovery = [];
    const supersession = [];
    // Actual process crashes and source supersession, bounded and explicitly
    // injected; preserve production retry/backoff and publication fencing.
    for (const kind of ['crash', 'supersede']) {
      const i = samples.findIndex((x) => x.lengthBand === 'short');
      const game = games[i];
      const plies = await prisma.importedGamePly.findMany({ where: { importedGameId: game.id }, select: { beforePositionId: true, afterPositionId: true } });
      const ids = [...new Set(plies.flatMap((x) => [x.beforePositionId, x.afterPositionId]))];
      await prisma.stockfishPositionAnalysis.deleteMany({ where: { positionId: { in: ids } } });
      let inject = true; let searches = 0; let replacementId = null;
      const recoveryService = createStockfishAnalysisService({ analysisVersion, settings: options.settings,
        repository: { ...prismaAnalysisRepository, async enqueueEligibleGame() { return null; } },
        engineFactory: async () => {
          let child;
          const engine = await createStockfishEngine({ binaryPath: options.binary, settings: options.settings, commandTimeoutMs: 30_000,
            spawnProcess(command) { child = spawn(command, [], { stdio: 'pipe' }); children.add(child); child.once('exit', () => children.delete(child)); return child; },
          });
          return { ...engine, async analyzeFen(fen) {
            const value = await engine.analyzeFen(fen);
            searches++;
            if (inject && searches === 2) {
              inject = false;
              if (kind === 'crash') {
                await new Promise((done) => { child.once('exit', done); child.kill('SIGKILL'); });
              } else replacementId = await recoveryService.requestReanalysis(game.id);
            }
            return value;
          } };
        },
      });
      const runId = await recoveryService.requestReanalysis(game.id);
      const start = performance.now();
      const failedCall = await measure(() => recoveryService.runOnce());
      const interrupted = await prisma.gameAnalysisRun.findUniqueOrThrow({ where: { id: runId } });
      assert.equal(interrupted.status, kind === 'crash' ? 'RETRY_WAIT' : 'SUPERSEDED');
      assert.notEqual(interrupted.coverageStatus, 'COMPLETE');
      assert.equal(interrupted.pliesDone, 0);
      const interruptedSearches = searches;
      const waiting = performance.now();
      let recoveredCall;
      for (let polls = 0; polls < 100; polls++) {
        recoveredCall = await measure(() => recoveryService.runOnce());
        if (recoveredCall.value) break;
        await new Promise((done) => setTimeout(done, 100));
      }
      assert.equal(recoveredCall.value, true, 'Bounded recovery must execute the retry.');
      const completed = await prisma.gameAnalysisRun.findUniqueOrThrow({ where: { id: replacementId ?? runId } });
      assert.equal(completed.status, 'SUCCEEDED'); assert.equal(completed.coverageStatus, 'COMPLETE');
      assert.equal(completed.pliesDone, samples[i].plies);
      assert.equal(completed.attempts, kind === 'crash' ? 2 : 1);
      const sample = { key: samples[i].key, injectedAfterSearches: 2, interruptedStatus: interrupted.status,
        interruptedCoverage: interrupted.coverageStatus, interruptedPliesDone: interrupted.pliesDone,
        interruptedSearches, interruptedCallWallMs: failedCall.wallMs,
        recoveryCallWallMs: recoveredCall.wallMs, observedWaitAndRecoveryMs: round(performance.now() - waiting),
        totalWallMs: round(performance.now() - start), finalStatus: completed.status, finalCoverage: completed.coverageStatus,
        finalAttempts: completed.attempts };
      (kind === 'crash' ? recovery : supersession).push(sample);
    }
    let cancelId;
    const cancelImporter = createLichessAccountImportService({
      connectionService: { getCredentialForUser: async () => ({ lichessUserId: 'benchmarkuser', username: 'BenchmarkUser', accessToken: 'offline-fixture', credentialGeneration: 'benchmark' }), markCredentialRevokedForUser: async () => true },
      fetchImpl: async () => {
        await cancelImporter.cancelRun(user.id, cancelId);
        return new Response(records.map((x) => JSON.stringify(x)).join('\n') + '\n');
      },
    });
    cancelId = (await cancelImporter.requestImport(user.id, { from: new Date(from.getTime() - 1000), to, rated: true })).id;
    const cancellationTiming = await measure(() => cancelImporter.runOnce());
    const cancelled = await cancelImporter.getRun(user.id, cancelId);
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(await prisma.importedGame.count({ where: { appUserId: user.id } }), games.length);
    // After warm analysis, run the actual complete registered evidence and owner
    // diagnosis pipeline once. This is separate from the engine-only work rate.
    const evidence = createEvidenceService({ detectors: evidenceDetectors });
    const evidenceTiming = await measure(async () => {
      for (let calls = 0; calls <= games.length * evidenceDetectors.length; calls++) {
        if (!await evidence.runOnce()) return calls;
      }
      throw new Error('Evidence drain exceeded the bounded detector/game count.');
    });
    const failedEvidence = await prisma.evidenceRun.count({ where: { status: { not: 'SUCCEEDED' } } });
    assert.equal(failedEvidence, 0, 'Evidence must not silently fail.');
    const evidenceCount = await prisma.evidenceRun.count();
    assert.equal(evidenceCount, games.length * evidenceDetectors.length);
    const diagnosisTiming = await measure(() => createDiagnosisWorkerService({ appUserId: user.id }).runOnce());
    const summary = await diagnosisSummaryService.getSummary(user.id, 'overall');
    assert.equal(summary.status, 'AVAILABLE'); assert.equal(summary.refresh.state, 'READY');
    const wallMs = round(performance.now() - scenarioStarted);
    const dbAfter = await dbSnapshot();
    const report = {
      schemaVersion: 'phase-7-recorded-multigame-benchmark-v1',
      environment: { gitRevision, benchmarkScriptSha256, node: process.version, platform: platform(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
        hostRamBytes: totalmem(), stockfishBinarySha256: binarySha256, settings: options.settings, settingsHash: settingsId,
        analysisVersion, database: options.database, dbBefore, dbAfter },
      workload: { fixtureSha256: hash(fixtureBytes), source: fixture.source, games: samples.length,
        plies: samples.reduce((n, x) => n + x.plies, 0), uniquePositions: positionIds.length,
        clockCoverage: { complete: samples.length, precision: 'SECONDS_FROM_ARCHIVE' },
        strata: samples.map(({ key, control, speed, plies, lengthBand }) => ({ key, control, speed, plies, lengthBand })) },
      import: { wallMs: importTiming.wallMs, provider: 'OFFLINE_ADAPTED_CC0_PGN_NOT_LIVE_NDJSON' }, indexing, passes,
      evidence: { wallMs: evidenceTiming.wallMs, calls: evidenceTiming.value, runs: evidenceCount },
      diagnosis: { wallMs: diagnosisTiming.wallMs, publicationStatus: 'SUCCEEDED', findings: summary.items.length },
      recovery, supersession,
      importCancellation: { wallMs: cancellationTiming.wallMs, finalStatus: cancelled.status, retainedGames: games.length },
      totalHarnessWallMs: wallMs,
      nodeResources: summarizeNodeHostCycleResources(process.cpuUsage(cpuBefore), rssBefore, process.memoryUsage.rss()),
      limitations: ['Quota-selected archive prefix, not a population estimate.', 'Engine passes include worker/cache/persistence; work rates exclude import/index/evidence/diagnosis.',
        'The warm rerun is forced actual reanalysis, not scheduling no-op.', 'Unrelated archived players pooled; finding counts validate lifecycle, not player diagnosis credibility.',
        'PostgreSQL counters are asynchronous cumulative DB telemetry, not per-query latency or exclusive server CPU.',
        'macOS native RSS is a live close-time snapshot, not peak; Linux provides VmHWM.', 'Node CPU covers the whole scenario; concurrent per-game wall windows overlap.',
        'Depth/settings, source precision, cache contention and machine provenance must match before extrapolation.'],
    };
    return report;
  } finally {
    clearTimeout(deadline);
    for (const child of children) child.kill('SIGKILL');
    globalThis.fetch = priorFetch;
    Object.assign(CURRENT_DIAGNOSIS_ANALYSIS, originalIdentity);
    Object.assign(diagnosisMaterializationVersions.policyVersions, originalVersions);
    if (user) {
      await prisma.appUser.delete({ where: { id: user.id } });
      await prisma.stockfishPositionAnalysis.deleteMany({ where: { positionId: { in: positionIds } } });
      await prisma.position.deleteMany({ where: { id: { in: positionIds } } });
    }
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runMultigameBenchmark();
  if (process.env.PHASE7_REPORT_PATH) await writeFile(process.env.PHASE7_REPORT_PATH, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
