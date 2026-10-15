import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLinuxStockfishProcessResources } from './phase-7-stockfish-process-metrics.mjs';

function fixtureStat(userTicks = '12', systemTicks = '7') {
  // fields 3..15: state, 10 preceding numeric fields, utime, stime.
  return '1234 (Stockfish worker) S ' + [...Array(10).fill('0'), userTicks, systemTicks].join(' ') + '\n';
}

test('Linux child CPU ticks and VmHWM are unit-labelled and correctly converted', () => {
  assert.deepEqual(
    parseLinuxStockfishProcessResources(fixtureStat(), 'Name:\tstockfish\nVmRSS:\t42 kB\nVmHWM:\t2048 kB\n', 100),
    {
      measurementSource: 'LINUX_PROC_PID_STAT_AND_STATUS',
      clockTicksPerSecond: 100,
      cpuUserMs: 120,
      cpuSystemMs: 70,
      cpuTotalMs: 190,
      peakResidentBytes: 2_097_152,
    },
  );
});

test('parenthesized process names with closing parentheses do not offset CPU fields', () => {
  const stat = fixtureStat('3', '2').replace('(Stockfish worker)', '(Stockfish ) worker)');
  const result = parseLinuxStockfishProcessResources(stat, 'VmHWM:\t33 kB\n', 250);
  assert.equal(result.cpuTotalMs, 20);
  assert.equal(result.peakResidentBytes, 33 * 1024);
});

test('malformed or incomplete Linux resource snapshots fail closed', () => {
  for (const [stat, status, ticks] of [
    [fixtureStat(), 'VmRSS: 20 kB\n', 100],
    [fixtureStat('-1'), 'VmHWM: 1 kB\n', 100],
    [fixtureStat('Infinity'), 'VmHWM: 1 kB\n', 100],
    [fixtureStat(), 'VmHWM: 1 kB\n', 0],
    ['1234 (Stockfish) S 0', 'VmHWM: 1 kB\n', 100],
    ['1234 missing parentheses', 'VmHWM: 1 kB\n', 100],
    [fixtureStat(), 'VmHWM: 999999999999999 kB\n', 100],
  ]) {
    assert.throws(() => parseLinuxStockfishProcessResources(stat, status, ticks));
  }
});
