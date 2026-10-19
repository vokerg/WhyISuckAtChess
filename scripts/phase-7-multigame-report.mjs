// Validate measured numerators/denominators before deriving engine-only capacity.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { summarizeDurationMs } from './phase-7-benchmark-statistics.mjs';

const positive = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
const nonnegative = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const integer = (x) => Number.isSafeInteger(x) && x >= 0;
const round = (x) => Math.round(x * 1000) / 1000;

export function summarizeMultigameReport(report) {
  const fail = () => { throw new Error('Invalid or incomplete measured multigame benchmark.'); };
  if (report?.schemaVersion !== 'phase-7-recorded-multigame-benchmark-v1'
      || !/^[a-f0-9]{64}$/.test(report.environment?.stockfishBinarySha256 ?? '')
      || !/^[a-f0-9]{64}$/.test(report.workload?.fixtureSha256 ?? '')
      || ![6, 18].includes(report.workload.games)
      || report.workload.strata.length !== report.workload.games
      || new Set(report.workload.strata.map((s) => s.key)).size !== report.workload.games
      || !positive(report.workload.plies) || !positive(report.workload.uniquePositions)
      || report.workload.clockCoverage.complete !== report.workload.games
      || report.passes?.length !== 2 || report.passes[0].mode !== 'cold' || report.passes[1].mode !== 'warm'
      || report.evidence?.runs !== report.workload.games * 6
      || report.diagnosis?.publicationStatus !== 'SUCCEEDED' || !integer(report.diagnosis.findings)
      || report.importCancellation?.finalStatus !== 'CANCELLED'
      || report.recovery?.length !== 1 || report.supersession?.length !== 1) fail();
  for (const [name, expected] of [['recovery', 'RETRY_WAIT'], ['supersession', 'SUPERSEDED']]) {
    const r = report[name][0];
    if (r.interruptedStatus !== expected || r.interruptedCoverage === 'COMPLETE' || r.interruptedPliesDone !== 0
        || r.finalStatus !== 'SUCCEEDED' || r.finalCoverage !== 'COMPLETE'
        || !positive(r.totalWallMs) || !positive(r.recoveryCallWallMs)) fail();
  }
  const expected = new Map(report.workload.strata.map((x) => [x.key, x]));
  const passes = report.passes.map((pass) => {
    if (![1, 2, 4].includes(pass.concurrency) || !positive(pass.wallMs)
        || pass.games !== report.workload.games || pass.samples.length !== pass.games
        || !Number.isSafeInteger(pass.peakActiveAnalyses) || pass.peakActiveAnalyses < 1 || pass.peakActiveAnalyses > pass.concurrency
        || !integer(pass.claimRaceRetries) || pass.participatingWorkers < 1 || pass.participatingWorkers > pass.concurrency
        || new Set(pass.samples.map((s) => s.key)).size !== pass.games
        || !nonnegative(pass.nodeResources?.cpuTotalMs)) fail();
    let hits = 0; let misses = 0;
    for (const sample of pass.samples) {
      const source = expected.get(sample.key);
      if (!source || sample.control !== source.control || sample.plies !== source.plies
          || sample.status !== 'SUCCEEDED' || sample.coverageStatus !== 'COMPLETE'
          || sample.attempts !== 1 || sample.pliesTotal !== source.plies
          || !positive(sample.workerWallMs) || !nonnegative(sample.queueLagMs)
          || !integer(sample.positionsTotal) || sample.positionsTotal < 1
          || !integer(sample.cacheHits) || !integer(sample.cacheMisses)
          || sample.cacheHits + sample.cacheMisses !== sample.positionsTotal
          || sample.searchWallMs.length !== sample.cacheMisses || !sample.searchWallMs.every(nonnegative)
          || !nonnegative(sample.nativeResources?.cpuTotalMs)
          || (pass.mode === 'warm' && sample.cacheMisses !== 0)) fail();
      hits += sample.cacheHits; misses += sample.cacheMisses;
    }
    if (hits !== pass.cacheHits || misses !== pass.cacheMisses || (pass.mode === 'cold' && misses < 1)
        || Math.abs(pass.cacheHitRatio - hits / (hits + misses)) > 1e-9) fail();
    const nativeCpuMs = pass.samples.reduce((n, s) => n + s.nativeResources.cpuTotalMs, 0);
    const strata = [...new Set(pass.samples.map((s) => s.control))].map((control) => {
      const group = pass.samples.filter((s) => s.control === control);
      return { control, games: group.length, plies: group.reduce((n, s) => n + s.plies, 0),
        perGameWorkerWallMs: summarizeDurationMs(group.map((s) => s.workerWallMs)),
        perGameNativeCpuMs: summarizeDurationMs(group.map((s) => s.nativeResources.cpuTotalMs)) };
    });
    return { mode: pass.mode, concurrency: pass.concurrency, games: pass.games, wallMs: pass.wallMs,
      peakActiveAnalyses: pass.peakActiveAnalyses, participatingWorkers: pass.participatingWorkers, claimRaceRetries: pass.claimRaceRetries,
      gamesPerHour: round(pass.games * 3600_000 / pass.wallMs),
      wallHoursPer1000Games: round(pass.wallMs / pass.games / 3600),
      observedNodeAndEngineCpuHoursPer1000Games: round((nativeCpuMs + pass.nodeResources.cpuTotalMs) / pass.games / 3600),
      cacheHitRatio: hits / (hits + misses), nativeCpuMs, nodeCpuMs: pass.nodeResources.cpuTotalMs, strata };
  });
  return { schemaVersion: 'phase-7-recorded-multigame-summary-v1', environment: report.environment, workload: report.workload,
    passes, import: report.import, indexing: summarizeDurationMs(report.indexing.map((x) => x.wallMs)),
    evidence: report.evidence, diagnosis: report.diagnosis, recovery: report.recovery,
    supersession: report.supersession, importCancellation: report.importCancellation,
    limitations: [...report.limitations, 'Per-1000 values are linear scaling scenarios for this quota cohort, not validated sustained capacity. PostgreSQL server CPU and infrastructure prices are excluded; no dollar estimate.'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = JSON.parse(await readFile(process.argv[2], 'utf8'));
  process.stdout.write(JSON.stringify(summarizeMultigameReport(report), null, 2) + '\n');
}
