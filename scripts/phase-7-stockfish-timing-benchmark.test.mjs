import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeDurationMs } from './phase-7-benchmark-statistics.mjs';

test('native benchmark reports descriptive nearest-rank wall-clock distributions', () => {
  const rows = summarizeDurationMs([90, 2, 4, 10, 20]);
  assert.deepEqual(rows, {
    count: 5, minMs: 2, p50Ms: 10, p90Ms: 90, p95Ms: 90,
    maxMs: 90, meanMs: 25.2, percentileMethod: 'NEAREST_RANK',
  });
  assert.deepEqual(summarizeDurationMs([1.234567]), {
    count: 1, minMs: 1.235, p50Ms: 1.235, p90Ms: 1.235,
    p95Ms: 1.235, maxMs: 1.235, meanMs: 1.235,
    percentileMethod: 'NEAREST_RANK',
  });
});

test('native benchmark refuses empty, missing, negative and nonfinite measurements', () => {
  for (const input of [[], [NaN], [Infinity], [1, -1], [null], '100']) {
    assert.throws(() => summarizeDurationMs(input), /nonempty array of finite nonnegative/);
  }
});
