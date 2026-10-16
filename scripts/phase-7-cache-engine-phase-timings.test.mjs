import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeCacheEnginePhaseTimings } from './phase-7-cache-engine-phase-timings.mjs';

test('cold and partial-cache cycles include exactly one search per miss', () => {
  const cold = summarizeCacheEnginePhaseTimings(
    { startupWallMs: 10, shutdownWallMs: 2, searchWallMs: [3, 4] }, 25, 2,
  );
  assert.deepEqual({
    searchCount: cold.searchCount,
    engineSearchWallMsTotal: cold.engineSearchWallMsTotal,
    engineAwaitedWallMs: cold.engineAwaitedWallMs,
    otherWorkerWallMs: cold.otherWorkerWallMs,
  }, {
    searchCount: 2, engineSearchWallMsTotal: 7,
    engineAwaitedWallMs: 19, otherWorkerWallMs: 6,
  });
  assert.deepEqual(cold.searchWallMs, [3, 4]);
  assert.equal(cold.searchDurationDistribution.count, 2);
  assert.equal(cold.searchDurationDistribution.p95Ms, 4);
  assert.equal(cold.source, 'BENCHMARK_NATIVE_ENGINE_AWAITED_WALL_CLOCK');
});

test('all-hit warm cycle starts an engine but records no Stockfish searches', () => {
  const warm = summarizeCacheEnginePhaseTimings(
    { startupWallMs: 9, shutdownWallMs: 1, searchWallMs: [] }, 18, 0,
  );
  assert.equal(warm.searchCount, 0);
  assert.equal(warm.searchDurationDistribution, null);
  assert.deepEqual(warm.searchWallMs, []);
  assert.equal(warm.engineSearchWallMsTotal, 0);
  assert.equal(warm.engineAwaitedWallMs, 10);
  assert.equal(warm.otherWorkerWallMs, 8);
});

test('rejects missing, unbounded or contradictory timings rather than creating false economics', () => {
  const valid = { startupWallMs: 2, shutdownWallMs: 1, searchWallMs: [3] };
  for (const [sample, workerMs, misses] of [
    [valid, 10, 0], // reported hit cannot secretly invoke the engine
    [valid, 10, 2], // reported miss must have a search
    [{ ...valid, searchWallMs: [3, 4] }, 10, 1],
    [{ ...valid, startupWallMs: -1 }, 10, 1],
    [{ ...valid, shutdownWallMs: Infinity }, 10, 1],
    [{ ...valid, searchWallMs: [NaN] }, 10, 1],
    [{ ...valid, searchWallMs: ['3'] }, 10, 1],
    [{ ...valid, searchWallMs: null }, 10, 1],
    [valid, 5, 1], // phase awaits cannot exceed their containing cycle
    [valid, -1, 1],
    [valid, Infinity, 1],
    [valid, 10, -1],
    [valid, 10, 1.5],
    [null, 10, 1],
  ]) {
    assert.throws(() => summarizeCacheEnginePhaseTimings(sample, workerMs, misses));
  }
});
