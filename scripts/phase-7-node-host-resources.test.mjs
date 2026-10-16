import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeNodeHostCycleResources } from './phase-7-node-host-resources.mjs';

test('Node parent CPU deltas are microseconds and RSS endpoint readings are bytes', () => {
  assert.deepEqual(summarizeNodeHostCycleResources(
    { user: 1234, system: 750 }, 100_000_000, 112_000_000,
  ), {
    source: 'NODE_PARENT_CPU_USAGE_AND_RSS_BOUNDARY_SNAPSHOTS',
    cpuUserMs: 1.234,
    cpuSystemMs: 0.75,
    cpuTotalMs: 1.984,
    rssBeforeBytes: 100_000_000,
    rssAfterBytes: 112_000_000,
    rssChangeBytes: 12_000_000,
  });
});

test('RSS can shrink, while CPU usage remains nonnegative', () => {
  const sample = summarizeNodeHostCycleResources(
    { user: 0, system: 0 }, 112_000_000, 100_000_000,
  );
  assert.equal(sample.rssChangeBytes, -12_000_000);
  assert.equal(sample.cpuTotalMs, 0);
});

test('malformed, negative or unsafe CPU/RSS measurements fail closed', () => {
  for (const [cpu, before, after] of [
    [null, 10, 20],
    [{ user: -1, system: 1 }, 10, 20],
    [{ user: NaN, system: 1 }, 10, 20],
    [{ user: 0.5, system: 1 }, 10, 20],
    [{ user: Number.MAX_SAFE_INTEGER, system: 1 }, 10, 20],
    [{ user: 1, system: 1 }, 0, 20],
    [{ user: 1, system: 1 }, 10, -20],
    [{ user: 1, system: 1 }, 10, Infinity],
    [{ user: 1, system: 1 }, Number.MAX_SAFE_INTEGER + 1, 20],
  ]) {
    assert.throws(() => summarizeNodeHostCycleResources(cpu, before, after));
  }
});
