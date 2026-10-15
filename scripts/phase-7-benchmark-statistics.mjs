// Phase 7 #126: deterministic descriptive statistics for opt-in native timing samples.
// These are wall-clock samples, NOT estimates of CPU, memory, DB cache reuse or cloud spend.
export function summarizeDurationMs(samples) {
  if (!Array.isArray(samples) || samples.length === 0
      || samples.some((value) => typeof value !== 'number'
        || !Number.isFinite(value) || value < 0)) {
    throw new Error('Expected a nonempty array of finite nonnegative durations.');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (value) => Math.round(value * 1000) / 1000;
  // Nearest-rank percentile. For small N the 95th percentile is often the maximum.
  const percentile = (fraction) => sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
  return {
    count: sorted.length,
    minMs: round(sorted[0]),
    p50Ms: round(percentile(0.5)),
    p90Ms: round(percentile(0.9)),
    p95Ms: round(percentile(0.95)),
    maxMs: round(sorted.at(-1)),
    meanMs: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    percentileMethod: 'NEAREST_RANK',
  };
}
