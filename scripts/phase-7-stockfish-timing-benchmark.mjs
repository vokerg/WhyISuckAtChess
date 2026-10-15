// Opt-in, real-binary wall-clock microbaseline for Phase 7 #126.
// This is NOT the Lichess -> DB worker throughput/economics acceptance gate.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { arch, cpus, platform, totalmem } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  createStockfishEngine,
  settingsHash,
} from '../apps/api/dist/modules/engine-analysis/stockfish.adapter.js';
import { summarizeDurationMs } from './phase-7-benchmark-statistics.mjs';
import { sampleNativeChildProcessResources } from './phase-7-stockfish-child-resources.mjs';

// All positions arise from e4 e5 Nf3 Nc6. No Lichess accounts, requests, or user data.
const POSITIONS = Object.freeze([
  { id: 'opening-0', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
  { id: 'opening-1', fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1' },
  { id: 'opening-2', fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2' },
  { id: 'opening-3', fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2' },
  { id: 'opening-4', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3' },
]);

function integerOption(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(name + ' must be a positive base-10 integer.');
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(name + ' must be between ' + minimum + ' and ' + maximum + '.');
  }
  return value;
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function runNativeTimingBaseline() {
  if (process.env.RUN_PHASE7_ENGINE_BENCHMARK !== '1') {
    throw new Error('Set RUN_PHASE7_ENGINE_BENCHMARK=1 to explicitly opt in to native searches.');
  }
  const binaryPath = process.env.STOCKFISH_PATH;
  if (!binaryPath || !isAbsolute(binaryPath)) {
    throw new Error('STOCKFISH_PATH must be an explicit absolute path to a native binary.');
  }
  const depth = integerOption('PHASE7_BENCH_DEPTH', 6, 4, 10);
  const passes = integerOption('PHASE7_BENCH_PASSES', 3, 1, 8);
  const settings = { depth, multiPv: 1, threads: 1, hashMb: 16 };
  const binarySha256 = await sha256File(binaryPath);
  const machineCpus = cpus();
  const samples = [];
  const totalStart = performance.now();

  // One process per run, just like the current native acceptance fixture.
  // analyzeFen sends ucinewgame before each search, so these repeats do not
  // deliberately reuse the engine's transposition hash. Differences may
  // reflect process/host warm-up, not the application's persisted cache.
  let childPid = null;
  let nativeChildResources = null;
  const engine = await createStockfishEngine({
    binaryPath,
    settings,
    commandTimeoutMs: 15_000,
    spawnProcess: (command) => {
      const child = spawn(command, [], { stdio: 'pipe' });
      childPid = child.pid ?? null;
      return child;
    },
  });
  try {
    for (let pass = 0; pass < passes; pass += 1) {
      for (const position of POSITIONS) {
        const start = performance.now();
        const result = await engine.analyzeFen(position.fen);
        const wallMs = performance.now() - start;
        if (result.depth < depth) {
          throw new Error('Native engine failed to reach the requested depth.');
        }
        samples.push({
          pass: pass + 1,
          positionId: position.id,
          wallMs: Math.round(wallMs * 1000) / 1000,
          achievedDepth: result.depth,
        });
      }
    }
    // Sample while the same native child is still alive; close() terminates it.
    nativeChildResources = await sampleNativeChildProcessResources(childPid);
  } finally {
    await engine.close();
  }
  const totalWallMs = performance.now() - totalStart;
  const first = samples.filter((row) => row.pass === 1).map((row) => row.wallMs);
  const later = samples.filter((row) => row.pass > 1).map((row) => row.wallMs);
  return {
    schemaVersion: 'phase-7-native-timing-microbaseline-v1',
    observedAtUtc: new Date().toISOString(),
    measurementKind: 'SYNTHETIC_NATIVE_STOCKFISH_WALL_CLOCK_ONLY',
    inputProvenance: 'ORIGINAL_SYNTHETIC_FIVE_POSITION_OPENING',
    environment: {
      platform: platform(),
      architecture: arch(),
      logicalCpuCount: machineCpus.length,
      cpuModel: machineCpus[0]?.model ?? null,
      hostReportedRamBytes: totalmem(),
      nodeVersion: process.version,
      stockfishBinaryPath: binaryPath,
      stockfishBinarySha256: binarySha256,
      engineName: engine.engineName,
      engineVersion: engine.engineVersion,
    },
    settings: { ...settings, settingsHash: settingsHash(settings), passes, positionCount: POSITIONS.length },
    positions: POSITIONS,
    results: {
      totalProcessSessionWallMs: Math.round(totalWallMs * 1000) / 1000,
      firstPass: summarizeDurationMs(first),
      repeatedPasses: later.length ? summarizeDurationMs(later) : null,
      allSearches: summarizeDurationMs(samples.map((row) => row.wallMs)),
      nativeChildResources,
      samples,
    },
    notMeasured: [
      'Lichess import/index/DB/evidence/diagnosis worker throughput',
      'application persisted position-cache cold/warm hit rate',
      'per-game Stockfish child CPU-time/peak RSS (only the aggregate synthetic session is sampled)',
      'worker concurrency, cancellation/backlog, recovery cost',
      'representative user-game length/time-control distribution',
      'cloud infrastructure cost or per-game capacity',
    ],
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runNativeTimingBaseline().then(
    (report) => { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); },
    (error) => {
      process.stderr.write('Phase 7 native timing baseline failed: ' + String(error?.message ?? error) + '\n');
      process.exitCode = 1;
    },
  );
}
