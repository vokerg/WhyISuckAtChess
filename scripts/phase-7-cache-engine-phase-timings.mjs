// Phase 7 #126: isolate real native engine await durations inside the
// opt-in persisted-cache worker probe. These are wall-clock measurements,
// not CPU/DB-query attribution or independent capacity estimates.
import { summarizeDurationMs } from './phase-7-benchmark-statistics.mjs';

const roundMs = (n) => Math.round(n * 1000) / 1000;

export function summarizeCacheEnginePhaseTimings(sample, workerCycleWallMs, expectedCacheMisses) {
  if (!Number.isSafeInteger(expectedCacheMisses) || expectedCacheMisses < 0
      || !Number.isFinite(workerCycleWallMs) || workerCycleWallMs < 0
      || !sample || typeof sample !== 'object' || Array.isArray(sample)
      || !Array.isArray(sample.searchWallMs)
      || sample.searchWallMs.length !== expectedCacheMisses
      || ![sample.startupWallMs, sample.shutdownWallMs, ...sample.searchWallMs]
        .every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
    throw new Error('Invalid per-cycle native engine phase timings or cache-miss count.');
  }

  const searchTotal = sample.searchWallMs.reduce((sum, duration) => sum + duration, 0);
  const engineAwaitedWallMs = sample.startupWallMs + searchTotal + sample.shutdownWallMs;
  // These await windows are nested within the worker cycle timer. Do not
  // silently turn materially contradictory clocks into a fabricated zero.
  const nonEngine = workerCycleWallMs - engineAwaitedWallMs;
  if (!Number.isFinite(engineAwaitedWallMs) || nonEngine < -0.001) {
    throw new Error('Engine await timings exceed the measured worker cycle.');
  }

  return {
    source: 'BENCHMARK_NATIVE_ENGINE_AWAITED_WALL_CLOCK',
    engineStartupWallMs: roundMs(sample.startupWallMs),
    engineShutdownWallMs: roundMs(sample.shutdownWallMs),
    searchCount: sample.searchWallMs.length,
    engineSearchWallMsTotal: roundMs(searchTotal),
    searchDurationDistribution: sample.searchWallMs.length
      ? summarizeDurationMs(sample.searchWallMs) : null,
    searchWallMs: sample.searchWallMs.map(roundMs),
    engineAwaitedWallMs: roundMs(engineAwaitedWallMs),
    otherWorkerWallMs: roundMs(Math.max(0, nonEngine)),
  };
}
