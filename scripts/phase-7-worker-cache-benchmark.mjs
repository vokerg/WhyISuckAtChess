// Phase 7 #126: strictly opt-in, native Stockfish + persisted position-cache probe.
// This uses one synthetic four-ply PGN in a fresh LOCAL disposable PostgreSQL DB.
// Not an import/provider, representative throughput, or production-depth benchmark.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { arch, cpus, platform, totalmem } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { assertDisposableCacheBenchmarkUrl, validatedCacheRun } from './phase-7-worker-cache-policy.mjs';
import { sampleNativeChildProcessResources } from './phase-7-stockfish-child-resources.mjs';
import { summarizeNodeHostCycleResources } from './phase-7-node-host-resources.mjs';

const PGN = [
  '[Event "Phase 7 synthetic cache benchmark"]',
  '[Site "local disposable database"]',
  '[Date "2026.10.15"]',
  '[White "FixtureUser"]',
  '[Black "FixtureOpponent"]',
  '[Result "1-0"]',
  '[TimeControl "180+0"]',
  '',
  '1. e4 e5 2. Nf3 Nc6 1-0',
].join('\n');
const SETTINGS = Object.freeze({ depth: 6, multiPv: 1, threads: 1, hashMb: 16 });
const ANALYSIS_VERSION = 'phase-7-cache-probe-v1';
const roundMs = (value) => Math.round(value * 1000) / 1000;

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function sizeOfDatabase(prisma) {
  const rows = await prisma.$queryRaw`SELECT pg_database_size(current_database())::text AS bytes`;
  const bytes = Number(rows[0]?.bytes);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error('Could not measure PostgreSQL database size safely.');
  }
  return bytes;
}

async function assertEmptyBenchmarkDatabase(prisma) {
  const counts = await Promise.all([
    prisma.appUser.count(),
    prisma.importedGame.count(),
    prisma.position.count(),
    prisma.gameAnalysisRun.count(),
    prisma.stockfishPositionAnalysis.count(),
  ]);
  if (counts.some((count) => count !== 0)) {
    throw new Error('The dedicated cache benchmark database must be empty after migrations.');
  }
}

export async function runPersistedCacheProbe() {
  if (process.env.RUN_PHASE7_CACHE_BENCHMARK !== '1') {
    throw new Error('Explicitly opt in with RUN_PHASE7_CACHE_BENCHMARK=1.');
  }
  const databaseName = assertDisposableCacheBenchmarkUrl(process.env.DATABASE_URL);
  const binaryPath = process.env.STOCKFISH_PATH;
  if (!binaryPath || !isAbsolute(binaryPath)) {
    throw new Error('STOCKFISH_PATH must be an explicit absolute executable path.');
  }
  const binarySha256 = await sha256File(binaryPath);

  // Import application modules only AFTER opt-in and the DB target preflight.
  const [
    prismaModule, indexModule, analysisModule, adapterModule,
  ] = await Promise.all([
    import('../apps/api/dist/prisma.js'),
    import('../apps/api/dist/modules/imported-games/ply-index.service.js'),
    import('../apps/api/dist/modules/engine-analysis/engine-analysis.service.js'),
    import('../apps/api/dist/modules/engine-analysis/stockfish.adapter.js'),
  ]);
  const prisma = prismaModule.default?.default ?? prismaModule.default;
  const { ImportedGamePlyIndexService } = indexModule;
  const { createStockfishAnalysisService } = analysisModule;
  const { createStockfishEngine, settingsHash } = adapterModule;
  let userId = null;
  let positionIds = [];
  try {
    await assertEmptyBenchmarkDatabase(prisma);
    const dbSizeBeforeBytes = await sizeOfDatabase(prisma);
    const suffix = randomUUID();

    const user = await prisma.appUser.create({
      data: { authProvider: 'TEST', authSubject: 'phase7-cache-bench-' + suffix },
    });
    userId = user.id;
    const game = await prisma.importedGame.create({
      data: {
        appUserId: user.id,
        provider: 'LICHESS',
        providerGameId: 'phase7-cache-bench-' + suffix,
        connectedLichessUserId: 'synthetic-fixture',
        connectedLichessUsername: 'FixtureUser',
        source: 'PHASE7_SYNTHETIC',
        pgn: PGN,
        rated: true,
        variant: 'standard',
        speedCategory: 'blitz',
        timeControlRaw: '180+0',
        timeControlInitial: 180,
        timeControlIncrement: 0,
        timeControlSource: 'PGN',
        userColor: 'WHITE',
        whiteUsername: 'FixtureUser',
        blackUsername: 'FixtureOpponent',
        status: 'resign',
        rawClockPresence: 'ABSENT',
        rawClockStateCount: 0,
      },
    });

    const indexStarted = performance.now();
    const indexed = await ImportedGamePlyIndexService.indexOne(user.id, game.id);
    const indexWallMs = roundMs(performance.now() - indexStarted);
    if (indexed.status !== 'INDEXED' || indexed.pliesIndexed !== 4) {
      throw new Error('Synthetic benchmark indexing failed.');
    }
    const plies = await prisma.importedGamePly.findMany({
      where: { importedGameId: game.id },
      select: { beforePositionId: true, afterPositionId: true },
    });
    positionIds = [...new Set(plies.flatMap((ply) => [ply.beforePositionId, ply.afterPositionId]))];

    const processSamples = [];
    const service = createStockfishAnalysisService({
      analysisVersion: ANALYSIS_VERSION,
      settings: SETTINGS,
      workerId: 'phase7-cache-benchmark-' + suffix,
      engineFactory: async () => {
        let childPid = null;
        const engine = await createStockfishEngine({
          binaryPath, settings: SETTINGS, commandTimeoutMs: 15_000,
          spawnProcess: (command) => {
            const child = spawn(command, [], { stdio: 'pipe' });
            childPid = child.pid ?? null;
            return child;
          },
        });
        return {
          ...engine,
          async close() {
            // Capture live child CPU + VmHWM before the worker closes the engine.
            try {
              processSamples.push(await sampleNativeChildProcessResources(childPid));
            } finally {
              await engine.close();
            }
          },
        };
      },
    });

    async function measureRun(expectedId) {
      // Capture only this benchmark Node process, independently from native
      // Stockfish child /proc samples. RSS boundaries are NOT per-cycle peaks.
      const rssBeforeBytes = process.memoryUsage.rss();
      const cpuBefore = process.cpuUsage();
      const started = performance.now();
      const claimed = await service.runOnce();
      const wallMs = roundMs(performance.now() - started);
      const cpuDelta = process.cpuUsage(cpuBefore);
      const rssAfterBytes = process.memoryUsage.rss();
      if (!claimed) throw new Error('Benchmark worker did not claim its queued run.');
      const nodeHostResources = summarizeNodeHostCycleResources(
        cpuDelta, rssBeforeBytes, rssAfterBytes,
      );
      const nativeChildResources = processSamples.shift() ?? null;
      if (process.platform === 'linux' && !nativeChildResources) {
        throw new Error('Linux native child CPU/RSS measurement is missing.');
      }
      const persisted = await prisma.gameAnalysisRun.findUniqueOrThrow({
        where: { id: expectedId },
      });
      return {
        ...validatedCacheRun(persisted),
        workerCycleWallMs: wallMs,
        nativeChildResources,
        nodeHostResources,
        sourcePlyIndexedAt: persisted.sourcePlyIndexedAt?.toISOString(),
        analysisVersion: persisted.analysisVersion,
        settingsHash: persisted.settingsHash,
      };
    }

    // requestReanalysis deliberately creates a NEW durable run even with
    // unchanged source/settings; otherwise the completed state skips work.
    const coldId = await service.requestReanalysis(game.id);
    const cold = await measureRun(coldId);
    const positionAnalysisRowsAfterCold = await prisma.stockfishPositionAnalysis.count();
    const warmId = await service.requestReanalysis(game.id);
    const warm = await measureRun(warmId);
    const positionAnalysisRowsAfterWarm = await prisma.stockfishPositionAnalysis.count();

    if (cold.cacheHits !== 0 || cold.cacheMisses !== cold.positionsTotal
        || cold.positionsTotal !== positionIds.length
        || warm.cacheHits !== warm.positionsTotal || warm.cacheMisses !== 0
        || warm.positionsTotal !== cold.positionsTotal
        || warm.pliesTotal !== cold.pliesTotal
        || cold.settingsHash !== warm.settingsHash
        || cold.analysisVersion !== warm.analysisVersion
        || cold.engineName !== warm.engineName || cold.engineVersion !== warm.engineVersion
        || cold.sourcePlyIndexedAt !== warm.sourcePlyIndexedAt
        || positionAnalysisRowsAfterCold !== positionIds.length
        || positionAnalysisRowsAfterWarm !== positionAnalysisRowsAfterCold) {
      throw new Error('Cold/warm persisted cache invariants did not hold.');
    }

    const dbSizeAfterBytes = await sizeOfDatabase(prisma);
    const cpusOnHost = cpus();
    return {
      schemaVersion: 'phase-7-persisted-stockfish-cache-probe-v3',
      observedAtUtc: new Date().toISOString(),
      measurementKind: 'SYNTHETIC_SINGLE_GAME_DB_CACHE_COLD_WARM',
      environment: {
        platform: platform(),
        architecture: arch(),
        nodeVersion: process.version,
        logicalCpuCount: cpusOnHost.length,
        cpuModel: cpusOnHost[0]?.model ?? null,
        hostReportedRamBytes: totalmem(),
        databaseName,
        stockfishBinaryPath: binaryPath,
        stockfishBinarySha256: binarySha256,
      },
      settings: { ...SETTINGS, analysisVersion: ANALYSIS_VERSION, settingsHash: settingsHash(SETTINGS) },
      fixture: {
        origin: 'ORIGINAL_SYNTHETIC_FOUR_PLY_PGN',
        speedCategory: 'blitz',
        exactTimeControl: '180+0',
        sourceClockCoverage: 'ABSENT',
        games: 1,
        plies: plies.length,
        distinctPositionIds: positionIds.length,
      },
      results: {
        indexingWallMs: indexWallMs,
        cold,
        warm,
        positionAnalysisRowsAfterCold,
        positionAnalysisRowsAfterWarm,
        databaseBytesBefore: dbSizeBeforeBytes,
        databaseBytesAfter: dbSizeAfterBytes,
        databaseBytesDelta: dbSizeAfterBytes - dbSizeBeforeBytes,
      },
      notMeasured: [
        'real Lichess provider import and evidence/diagnosis throughput',
        'representative bullet/blitz/rapid game distributions and clock coverage',
        'production depth-16/MultiPV-3 resource use',
        'per-game Stockfish child CPU/peak RSS distributions (only one four-ply synthetic game is sampled)',
        'isolated Node worker CPU/peak RSS, or PostgreSQL process CPU/RSS (only Node parent cycle deltas and RSS endpoints are sampled)',
        'concurrency, saturation, cancellation/backlog, retry/recovery economics',
        'cloud pricing, per-1k-game cost or pilot capacity',
      ],
    };
  } finally {
    // Delete only synthetic rows created in this run. The DB is dedicated,
    // empty on entry, and must never be an application or production database.
    try {
      if (userId !== null) {
        await prisma.appUser.delete({ where: { id: userId } });
      }
      if (positionIds.length) {
        await prisma.stockfishPositionAnalysis.deleteMany({
          where: { positionId: { in: positionIds } },
        });
        await prisma.position.deleteMany({ where: { id: { in: positionIds } } });
      }
    } finally {
      await prisma.$disconnect();
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runPersistedCacheProbe().then(
    (report) => { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); },
    (error) => {
      // No DB connection URL, FEN, tokens, or provider response in error logs.
      process.stderr.write('Phase 7 persisted cache probe failed: ' + String(error?.message ?? error) + '\n');
      process.exitCode = 1;
    },
  );
}
