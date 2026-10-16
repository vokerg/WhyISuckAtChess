// Opt-in Phase 7 cache benchmark: CPU time for this Node host process and
// instantaneous RSS at worker-cycle boundaries. Not a worker-only peak or
// Stockfish/PostgreSQL resource measurement.
export function summarizeNodeHostCycleResources(cpuMicroseconds, rssBeforeBytes, rssAfterBytes) {
  const user = cpuMicroseconds?.user;
  const system = cpuMicroseconds?.system;
  if (![user, system].every((value) => Number.isSafeInteger(value) && value >= 0)
      || !Number.isSafeInteger(user + system)) {
    throw new Error('Node host CPU deltas must be safe nonnegative microseconds.');
  }
  if (![rssBeforeBytes, rssAfterBytes].every(
    (value) => Number.isSafeInteger(value) && value > 0,
  )) {
    throw new Error('Node host RSS boundary readings must be positive safe bytes.');
  }
  return {
    source: 'NODE_PARENT_CPU_USAGE_AND_RSS_BOUNDARY_SNAPSHOTS',
    cpuUserMs: user / 1000,
    cpuSystemMs: system / 1000,
    cpuTotalMs: (user + system) / 1000,
    rssBeforeBytes,
    rssAfterBytes,
    rssChangeBytes: rssAfterBytes - rssBeforeBytes,
  };
}
