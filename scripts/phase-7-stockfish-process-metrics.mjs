// Linux-only, opt-in measurement of the *native Stockfish child*.
// /proc/<pid>/stat reports cumulative user/system CPU ticks; /proc/<pid>/status
// VmHWM reports that process's high-water resident set (not Node/DB memory).
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const roundMs = (value) => Math.round(value * 1000) / 1000;

function safeNonnegativeInteger(text, label) {
  if (!/^\d+$/.test(text)) throw new Error('Missing or invalid Linux process ' + label + '.');
  const number = Number(text);
  if (!Number.isSafeInteger(number)) throw new Error('Unsafe Linux process ' + label + '.');
  return number;
}

export function parseLinuxStockfishProcessResources(stat, status, clockTicksPerSecond) {
  if (!Number.isSafeInteger(clockTicksPerSecond) || clockTicksPerSecond <= 0) {
    throw new Error('Invalid Linux clock ticks per second.');
  }
  // The comm field (field 2) is parenthesized and may itself contain spaces or ')'.
  // Fields after the FINAL ')' begin at field 3, so utime/stime are indices 11/12.
  const closingParen = stat.lastIndexOf(')');
  if (!/^\d+ \(/.test(stat) || closingParen < 0) {
    throw new Error('Malformed Linux process stat header.');
  }
  const fields = stat.slice(closingParen + 1).trim().split(/\s+/);
  if (fields.length < 13) throw new Error('Incomplete Linux process stat.');
  const userTicks = safeNonnegativeInteger(fields[11], 'user CPU ticks');
  const systemTicks = safeNonnegativeInteger(fields[12], 'system CPU ticks');
  const residentMatch = /^VmHWM:\s*(\d+)\s+kB\s*$/m.exec(status);
  if (!residentMatch) throw new Error('Linux process VmHWM unavailable.');
  const highWaterKiB = safeNonnegativeInteger(residentMatch[1], 'VmHWM');
  const peakResidentBytes = highWaterKiB * 1024;
  if (!Number.isSafeInteger(peakResidentBytes)) throw new Error('Unsafe Linux peak RSS.');
  return {
    measurementSource: 'LINUX_PROC_PID_STAT_AND_STATUS',
    clockTicksPerSecond,
    cpuUserMs: roundMs(userTicks * 1000 / clockTicksPerSecond),
    cpuSystemMs: roundMs(systemTicks * 1000 / clockTicksPerSecond),
    cpuTotalMs: roundMs((userTicks + systemTicks) * 1000 / clockTicksPerSecond),
    peakResidentBytes,
  };
}

export async function readLinuxStockfishProcessResources(pid) {
  if (process.platform !== 'linux') {
    throw new Error('Stockfish process resource probe requires Linux /proc.');
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error('Native Stockfish child PID unavailable.');
  }
  const ticksText = execFileSync('getconf', ['CLK_TCK'], {
    encoding: 'utf8',
    timeout: 2_000,
  }).trim();
  const ticks = safeNonnegativeInteger(ticksText, 'clock ticks per second');
  const [stat, status] = await Promise.all([
    readFile('/proc/' + pid + '/stat', 'utf8'),
    readFile('/proc/' + pid + '/status', 'utf8'),
  ]);
  return parseLinuxStockfishProcessResources(stat, status, ticks);
}
