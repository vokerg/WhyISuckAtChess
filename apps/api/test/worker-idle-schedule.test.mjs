import assert from 'node:assert/strict';
import test from 'node:test';

import { IdleScanSchedule, readIdleScanInterval } from '../dist/worker-idle-schedule.js';

test('scheduled scans require explicit opt-in and an interval that allows suspension', () => {
  assert.equal(readIdleScanInterval(undefined), undefined);
  assert.equal(readIdleScanInterval(''), undefined);
  assert.equal(readIdleScanInterval('900000'), 900000);
  for (const invalid of ['1000', 'NaN', '9e5', '3600001']) {
    assert.throws(() => readIdleScanInterval(invalid), /WORKER_IDLE_SCAN_INTERVAL_MS/);
  }
});

test('work wakes idle peers, keeps fast scans briefly, then returns to a shared schedule', async () => {
  let now = 42_000;
  const schedule = new IdleScanSchedule(900_000, () => now);
  assert.equal(schedule.delayMs(1000), 858_000);
  const waiting = [schedule.wait(1000), schedule.wait(5000)];
  schedule.noteWork();
  await Promise.all(waiting);
  assert.equal(schedule.delayMs(1000), 1000);
  assert.equal(schedule.delayMs(5000), 5000);

  now += 30_000;
  assert.equal(schedule.delayMs(1000), 828_000);
  const stopped = schedule.wait(1000);
  schedule.stop();
  await stopped;
  await schedule.wait(1000);
});
