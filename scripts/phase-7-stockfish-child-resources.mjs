// Phase 7 #126: opt-in benchmark-only Linux Stockfish child CPU and peak RSS.
// Read the live native process before engine.close(); do not attribute Node CPU
// or host-wide RAM inventory to the Stockfish child.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const roundMs = (value) => Math.round(value * 1000) / 1000;

export function parseLinuxChildProcessResourceSample(stat, status, ticksPerSecond) {
  if (!Number.isSafeInteger(ticksPerSecond) || ticksPerSecond <= 0) {
    throw new Error('Linux procfs CPU clock tick rate must be a positive integer.');
  }

  // Linux /proc/PID/stat field 2 (comm) may contain spaces and ')' characters.
  // The fields after the FINAL ')' start at field 3 (state). Fields 14/15
  // are utime/stime, hence indexes 11/12 in this suffix.
  const closingParen = stat.lastIndexOf(')');
  if (closingParen < 0 || !/^\d+\s+\(/.test(stat)) {
    throw new Error('Malformed Linux process stat record.');
  }
  const fields = stat.slice(closingParen + 1).trim().split(/\s+/);
  if (fields.length < 13 || !/^\d+$/.test(fields[11]) || !/^\d+$/.test(fields[12])) {
    throw new Error('Missing Linux process CPU counters.');
  }
  const userTicks = Number(fields[11]);
  const systemTicks = Number(fields[12]);
  if (!Number.isSafeInteger(userTicks) || !Number.isSafeInteger(systemTicks)) {
    throw new Error('Linux process CPU counters are outside the safe integer range.');
  }

  const highWater = /^VmHWM:\s+(\d+)\s+kB\s*$/m.exec(status);
  if (!highWater) throw new Error('Linux process peak RSS (VmHWM) is unavailable.');
  const highWaterKiB = Number(highWater[1]);
  if (!Number.isSafeInteger(highWaterKiB) || highWaterKiB < 0
      || !Number.isSafeInteger(highWaterKiB * 1024)) {
    throw new Error('Linux process peak RSS is outside the safe integer range.');
  }

  return {
    source: 'LINUX_PROCFS_LIVE_CHILD',
    cpuClockTicksPerSecond: ticksPerSecond,
    cpuUserTicks: userTicks,
    cpuSystemTicks: systemTicks,
    cpuUserMs: roundMs(userTicks * 1000 / ticksPerSecond),
    cpuSystemMs: roundMs(systemTicks * 1000 / ticksPerSecond),
    cpuTotalMs: roundMs((userTicks + systemTicks) * 1000 / ticksPerSecond),
    peakResidentBytes: highWaterKiB * 1024,
  };
}

export async function sampleNativeChildProcessResources(pid) {
  if (process.platform !== 'linux') return null;
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error('Stockfish child PID is required for Linux resource measurement.');
  }
  const [stat, status] = await Promise.all([
    readFile('/proc/' + pid + '/stat', 'utf8'),
    readFile('/proc/' + pid + '/status', 'utf8'),
  ]);
  const hz = Number(execFileSync('getconf', ['CLK_TCK'], {
    encoding: 'utf8', timeout: 2000,
  }).trim());
  return parseLinuxChildProcessResourceSample(stat, status, hz);
}
