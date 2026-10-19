import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { benchmarkOptions, settleBenchmarkWorkers } from './phase-7-multigame-benchmark.mjs';
import { prepareRecordedWorkload, RECORDED_CONTROLS } from './phase-7-recorded-workload.mjs';
import { summarizeMultigameReport } from './phase-7-multigame-report.mjs';

const valid = { RUN_PHASE7_MULTIGAME_BENCHMARK: '1', DATABASE_URL: 'postgresql://localhost/why_chess_cache_benchmark_test', STOCKFISH_PATH: '/usr/bin/stockfish' };
test('benchmark refuses nonlocal/shared targets and unbounded work before loading services', () => {
  assert.equal(benchmarkOptions(valid).maxGames, 18);
  for (const patch of [{ RUN_PHASE7_MULTIGAME_BENCHMARK: '' }, { DATABASE_URL: 'postgresql://example.org/why_chess_cache_benchmark_test' },
    { DATABASE_URL: 'postgresql://localhost/application' }, { STOCKFISH_PATH: 'stockfish' },
    { PHASE7_DEPTH: '17' }, { PHASE7_CONCURRENCY: '8' }, { PHASE7_GAMES: '1000' }]) {
    assert.throws(() => benchmarkOptions({ ...valid, ...patch }));
  }
});

test('recorded CC0 cohort contains complete legal games and preserves source clocks/exact controls', async () => {
  const require = createRequire(new URL('../packages/chess-domain/package.json', import.meta.url));
  const { Chess } = require('chess.js');
  const text = await readFile(new URL('../apps/api/benchmarks/fixtures/recorded-cc0-workload.json', import.meta.url), 'utf8');
  const fixture = JSON.parse(text);
  assert.equal(fixture.source.license, 'CC0-1.0');
  assert.equal(fixture.games.length, 18);
  assert.equal(new Set(fixture.games.map((g) => g.sourcePgnSha256)).size, 18);
  assert.doesNotMatch(text, /https:\/\/lichess.org\/[a-zA-Z0-9]{8}/);
  for (const control of RECORDED_CONTROLS) {
    assert.deepEqual(new Set(fixture.games.filter((g) => g.control === control).map((g) => g.lengthBand)), new Set(['short', 'medium', 'long']));
  }
  for (const game of fixture.games) {
    const chess = new Chess(); chess.loadPgn(game.pgn);
    assert.equal(chess.history().length, game.plies);
    assert.equal(game.clocks.length, game.plies);
    assert.ok(game.clocks.every((x) => Number.isSafeInteger(x) && x >= 0 && x % 100 === 0));
    assert.equal(chess.getHeaders().TimeControl, game.control);
    assert.equal(chess.getHeaders().White, 'BenchmarkUser');
    assert.equal(chess.getHeaders().Black, 'BenchmarkOpponent');
  }
});

test('preparation fails closed on unlicensed source or incomplete strata', () => {
  assert.throws(() => prepareRecordedWorkload('', 'https://example.org/games.pgn'));
  assert.throws(() => prepareRecordedWorkload('', 'https://database.lichess.org/standard/lichess_db_standard_rated_2025-01.pgn.zst'), /18 exact-control/);
});

test('capacity reporting rejects incomplete lifecycle or unmeasured evidence', () => {
  assert.throws(() => summarizeMultigameReport({}));
  assert.throws(() => summarizeMultigameReport({ schemaVersion: 'phase-7-recorded-multigame-benchmark-v1', environment: {} }));
});

test('a failed worker aborts and drains siblings before cleanup can begin', async () => {
  let siblingStopped = false; let aborted = false;
  await assert.rejects(settleBenchmarkWorkers([
    async () => { throw new Error('injected worker failure'); },
    async (signal) => {
      await new Promise((done) => setTimeout(done, 10));
      assert.equal(signal.aborted, true);
      siblingStopped = true;
    },
  ], () => { aborted = true; }), /all siblings have stopped/);
  assert.equal(aborted, true);
  assert.equal(siblingStopped, true);
});

function reportFixture() {
  const strata = RECORDED_CONTROLS.map((control, i) => ({ key: `test_${i}`, control, plies: 20 }));
  return { schemaVersion: 'phase-7-recorded-multigame-benchmark-v1',
    environment: { stockfishBinarySha256: 'a'.repeat(64) },
    workload: { fixtureSha256: 'b'.repeat(64), games: 6, plies: 120, uniquePositions: 100, clockCoverage: { complete: 6 }, strata },
    evidence: { runs: 36 }, diagnosis: { publicationStatus: 'SUCCEEDED', findings: 0 }, indexing: [{ wallMs: 1 }],
    importCancellation: { finalStatus: 'CANCELLED' },
    recovery: [{ interruptedStatus: 'RETRY_WAIT', interruptedCoverage: 'PENDING', interruptedPliesDone: 0, finalStatus: 'SUCCEEDED', finalCoverage: 'COMPLETE', totalWallMs: 1000, recoveryCallWallMs: 100 }],
    supersession: [{ interruptedStatus: 'SUPERSEDED', interruptedCoverage: 'INCOMPLETE', interruptedPliesDone: 0, finalStatus: 'SUCCEEDED', finalCoverage: 'COMPLETE', totalWallMs: 200, recoveryCallWallMs: 100 }],
    passes: ['cold', 'warm'].map((mode) => ({ mode, concurrency: 2, peakActiveAnalyses: 2, participatingWorkers: 2, claimRaceRetries: 1,
      wallMs: 600, games: 6, cacheHits: mode === 'cold' ? 0 : 126, cacheMisses: mode === 'cold' ? 126 : 0,
      cacheHitRatio: mode === 'cold' ? 0 : 1, nodeResources: { cpuTotalMs: 60 },
      samples: strata.map((s) => ({ ...s, status: 'SUCCEEDED', coverageStatus: 'COMPLETE', attempts: 1,
        pliesTotal: s.plies, positionsTotal: 21, workerWallMs: 100, queueLagMs: 10,
        cacheHits: mode === 'cold' ? 0 : 21, cacheMisses: mode === 'cold' ? 21 : 0,
        searchWallMs: mode === 'cold' ? Array(21).fill(1) : [], nativeResources: { cpuTotalMs: 30 } })),
    })), limitations: [],
  };
}

test('capacity uses elapsed cohort wall and additive measured CPU, without summing concurrent walls', () => {
  const summary = summarizeMultigameReport(reportFixture());
  assert.equal(summary.passes[0].gamesPerHour, 36_000);
  assert.equal(summary.passes[0].wallHoursPer1000Games, 0.028);
  assert.equal(summary.passes[0].observedNodeAndEngineCpuHoursPer1000Games, 0.011);
  assert.equal(summary.passes[0].strata.length, 6);
});

test('report rejects duplicate games, contradictory cache/search counts, or false complete recovery', () => {
  for (const corrupt of [
    (r) => { r.passes[0].samples[1].key = r.passes[0].samples[0].key; },
    (r) => { r.passes[1].samples[0].cacheMisses = 1; },
    (r) => { r.passes[0].samples[0].searchWallMs = []; },
    (r) => { r.recovery[0].interruptedCoverage = 'COMPLETE'; },
    (r) => { r.diagnosis.publicationStatus = 'QUEUED'; },
    (r) => { r.passes[0].samples[0].nativeResources.cpuTotalMs = -1; },
  ]) {
    const report = reportFixture(); corrupt(report);
    assert.throws(() => summarizeMultigameReport(report));
  }
});
