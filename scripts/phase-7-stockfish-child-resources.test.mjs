import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLinuxChildProcessResourceSample } from './phase-7-stockfish-child-resources.mjs';

function stat({ user = '12', system = '8', name = 'stock fish) worker' } = {}) {
  const fields = Array(51).fill('0');
  fields[0] = 'S';
  fields[11] = user;  // Linux /proc/PID/stat field 14: utime
  fields[12] = system; // Linux /proc/PID/stat field 15: stime
  return '123 (' + name + ') ' + fields.join(' ') + '\n';
}

test('read child CPU times and peak RSS from Linux procfs, including tricky comm', () => {
  assert.deepEqual(
    parseLinuxChildProcessResourceSample(stat(), 'Name:\tstockfish\nVmRSS:\t800 kB\nVmHWM:\t1024 kB\n', 100),
    {
      source: 'LINUX_PROCFS_LIVE_CHILD',
      cpuClockTicksPerSecond: 100,
      cpuUserTicks: 12,
      cpuSystemTicks: 8,
      cpuUserMs: 120,
      cpuSystemMs: 80,
      cpuTotalMs: 200,
      peakResidentBytes: 1048576,
    },
  );
});

test('CPU units come from the measured host tick rate, not a presumed 100 Hz', () => {
  const sampled = parseLinuxChildProcessResourceSample(
    stat({ user: '3', system: '2' }), 'VmHWM:\t64 kB\n', 250,
  );
  assert.equal(sampled.cpuUserMs, 12);
  assert.equal(sampled.cpuSystemMs, 8);
  assert.equal(sampled.peakResidentBytes, 65536);
});

test('malformed, missing or unsafe proc counters fail closed', () => {
  for (const [statText, statusText, hz] of [
    ['not a stat', 'VmHWM:\t20 kB\n', 100],
    [stat({ user: '-1' }), 'VmHWM:\t20 kB\n', 100],
    [stat({ system: 'NaN' }), 'VmHWM:\t20 kB\n', 100],
    [stat({ user: '9007199254740993' }), 'VmHWM:\t20 kB\n', 100],
    [stat(), 'VmRSS:\t20 kB\n', 100],
    [stat(), 'VmHWM:\t9007199254740993 kB\n', 100],
    [stat(), 'VmHWM:\t20 kB\n', 0],
    [stat(), 'VmHWM:\t20 kB\n', 1.5],
  ]) {
    assert.throws(() => parseLinuxChildProcessResourceSample(statText, statusText, hz));
  }
});
