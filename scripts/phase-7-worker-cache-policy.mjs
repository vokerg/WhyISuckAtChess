// Phase 7 #126: pure safety and consistency checks for an opt-in real-DB probe.
// Keep these independent of Prisma/Stockfish so guardrail tests need no services.
export function assertDisposableCacheBenchmarkUrl(raw) {
  if (!raw) throw new Error('DATABASE_URL is required for the cache benchmark.');
  let url;
  try { url = new URL(raw); } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['localhost', '127.0.0.1'].includes(url.hostname)
      || !/^why_chess_cache_benchmark_(ci|test|local)(?:_[a-z0-9_]+)?$/.test(databaseName)
      || url.search || url.hash) {
    throw new Error('Cache benchmark requires a dedicated local why_chess_cache_benchmark_{ci,test,local} database without URL parameters.');
  }
  return databaseName;
}

export function validatedCacheRun(run) {
  if (run.status !== 'SUCCEEDED' || run.coverageStatus !== 'COMPLETE'
      || !Number.isSafeInteger(run.positionsTotal) || run.positionsTotal < 1
      || !Number.isSafeInteger(run.pliesTotal) || run.pliesTotal < 1
      || run.positionsDone !== run.positionsTotal || run.pliesDone !== run.pliesTotal
      || !Number.isSafeInteger(run.cacheHits) || run.cacheHits < 0
      || !Number.isSafeInteger(run.cacheMisses) || run.cacheMisses < 0
      || run.cacheHits + run.cacheMisses !== run.positionsTotal
      || run.attempts !== 1 || !run.engineName || !run.engineVersion
      || !run.claimedAt || !run.completedAt || !run.createdAt) {
    throw new Error('Analysis run is not a complete, single-attempt cache measurement.');
  }
  return {
    status: run.status,
    coverageStatus: run.coverageStatus,
    positionsTotal: run.positionsTotal,
    pliesTotal: run.pliesTotal,
    cacheHits: run.cacheHits,
    cacheMisses: run.cacheMisses,
    cacheHitRatio: run.cacheHits / run.positionsTotal,
    attempts: run.attempts,
    engineName: run.engineName,
    engineVersion: run.engineVersion,
    queueLagMs: Math.max(0, run.claimedAt.getTime() - run.createdAt.getTime()),
    persistedRunElapsedMs: Math.max(0, run.completedAt.getTime() - run.claimedAt.getTime()),
  };
}
