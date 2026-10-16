import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDisposableCacheBenchmarkUrl,
  validatedCacheRun,
} from './phase-7-worker-cache-policy.mjs';

test('dedicated local PostgreSQL benchmark names are required before connecting', () => {
  for (const protocol of ['postgres', 'postgresql']) {
    assert.equal(
      assertDisposableCacheBenchmarkUrl(protocol + '://postgres:postgres@localhost:5432/why_chess_cache_benchmark_ci'),
      'why_chess_cache_benchmark_ci',
    );
  }
  assert.equal(
    assertDisposableCacheBenchmarkUrl('postgresql://u:p@127.0.0.1:5432/why_chess_cache_benchmark_local_2'),
    'why_chess_cache_benchmark_local_2',
  );
  for (const value of [
    undefined,
    'not a URL',
    'postgresql://u:p@db.internal/why_chess_cache_benchmark_ci',
    'postgresql://u:p@localhost:5432/production',
    'postgresql://u:p@localhost:5432/why_chess_cache_benchmark',
    'postgresql://u:p@localhost:5432/why_chess_cache_benchmark_ci?schema=public',
    'https://localhost/why_chess_cache_benchmark_ci',
    'postgresql://u:p@localhost:5432/why_chess_cache_benchmark_ci%2Fproduction',
  ]) {
    assert.throws(() => assertDisposableCacheBenchmarkUrl(value));
  }
});

function run(fields = {}) {
  return {
    status: 'SUCCEEDED', coverageStatus: 'COMPLETE', positionsTotal: 5,
    pliesTotal: 4, positionsDone: 5, pliesDone: 4, cacheHits: 0, cacheMisses: 5,
    attempts: 1, engineName: 'Stockfish 16', engineVersion: '16',
    createdAt: new Date('2026-10-15T00:00:00.000Z'),
    claimedAt: new Date('2026-10-15T00:00:01.000Z'),
    completedAt: new Date('2026-10-15T00:00:03.000Z'),
    ...fields,
  };
}
test('cache counts and persisted timing are measured from completed runs', () => {
  assert.deepEqual(
    validatedCacheRun(run()),
    {
      status: 'SUCCEEDED', coverageStatus: 'COMPLETE', positionsTotal: 5,
      pliesTotal: 4, cacheHits: 0, cacheMisses: 5, cacheHitRatio: 0,
      attempts: 1, engineName: 'Stockfish 16', engineVersion: '16',
      queueLagMs: 1000, persistedRunElapsedMs: 2000,
    },
  );
  assert.equal(validatedCacheRun(run({ cacheHits: 5, cacheMisses: 0 })).cacheHitRatio, 1);
});
test('partial, retried, or inconsistent counts cannot masquerade as cache measurements', () => {
  for (const fields of [
    { status: 'FAILED' }, { coverageStatus: 'PARTIAL' }, { positionsDone: 4 },
    { pliesDone: 3 }, { cacheHits: 1 }, { cacheMisses: -1 },
    { cacheHits: 6, cacheMisses: -1 }, { positionsTotal: 0 },
    { attempts: 2 }, { claimedAt: null }, { engineVersion: null },
  ]) assert.throws(() => validatedCacheRun(run(fields)));
});

test('benchmark rejects malformed, reversed, or unsafe persisted timestamp intervals', () => {
  for (const fields of [
    { createdAt: new Date('invalid') },
    { claimedAt: new Date('invalid') },
    { completedAt: new Date('invalid') },
    { createdAt: '2026-10-15T00:00:00.000Z' },
    { claimedAt: '2026-10-15T00:00:01.000Z' },
    { completedAt: '2026-10-15T00:00:03.000Z' },
    { createdAt: new Date('2026-10-15T00:00:02.000Z') },
    { claimedAt: new Date('2026-10-14T23:59:59.000Z') },
    { completedAt: new Date('2026-10-15T00:00:00.000Z') },
    {
      createdAt: new Date(-8_640_000_000_000_000),
      claimedAt: new Date(8_640_000_000_000_000),
      completedAt: new Date(8_640_000_000_000_000),
    },
  ]) {
    assert.throws(() => validatedCacheRun(run(fields)));
  }

  const zeroDuration = validatedCacheRun(run({
    claimedAt: new Date('2026-10-15T00:00:00.000Z'),
    completedAt: new Date('2026-10-15T00:00:00.000Z'),
  }));
  assert.equal(zeroDuration.queueLagMs, 0);
  assert.equal(zeroDuration.persistedRunElapsedMs, 0);
});
