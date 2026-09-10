import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_STOCKFISH_SETTINGS,
  parseStockfishInfo,
  settingsHash,
  summarizeStockfishSearch,
} from '../dist/modules/engine-analysis/stockfish.adapter.js';
import { createStockfishAnalysisService } from '../dist/modules/engine-analysis/engine-analysis.service.js';

test('Stockfish adapter parses deterministic MultiPV output and preserves raw lines', () => {
  const lines = [
    'info depth 15 multipv 1 score cp 21 nodes 100 pv e2e4 e7e5',
    'info depth 16 multipv 2 score cp 8 nodes 140 pv d2d4 d7d5',
    'info depth 16 multipv 1 score cp 24 nodes 160 pv e2e4 c7c5',
    'info depth 16 multipv 3 score mate -3 nodes 170 pv g1f3 d7d5',
  ];
  assert.deepEqual(parseStockfishInfo(lines[0]), {
    multiPv: 1,
    depth: 15,
    scoreCp: 21,
    mateIn: null,
    pv: ['e2e4', 'e7e5'],
    raw: lines[0],
  });
  const result = summarizeStockfishSearch(lines, 'e2e4');
  assert.equal(result.depth, 16);
  assert.equal(result.scoreCp, 24);
  assert.equal(result.bestMove, 'e2e4');
  assert.deepEqual(result.bestPv, ['e2e4', 'c7c5']);
  assert.equal(result.multiPv.length, 3);
  assert.equal(result.multiPv[2].mateIn, -3);
  assert.deepEqual(result.rawInfo, lines);
  assert.equal(settingsHash(DEFAULT_STOCKFISH_SETTINGS), settingsHash({ ...DEFAULT_STOCKFISH_SETTINGS }));
});

function fakeAnalysis(scoreCp = 12) {
  return {
    depth: 16,
    scoreCp,
    mateIn: null,
    bestMove: 'e2e4',
    bestPv: ['e2e4', 'e7e5'],
    multiPv: [{ multiPv: 1, depth: 16, scoreCp, mateIn: null, pv: ['e2e4', 'e7e5'], raw: 'info' }],
    rawInfo: ['info depth 16 multipv 1 score cp 12 pv e2e4 e7e5'],
  };
}

function baseRepository(overrides = {}) {
  return {
    enqueueEligibleGame: async () => null,
    claimNext: async () => ({
      id: 11,
      importedGameId: 7,
      snapshotId: 'snapshot-11',
      attempts: 1,
      maxAttempts: 3,
      settingsHash: 'unused-by-service',
    }),
    recordEngineIdentity: async () => true,
    loadPositions: async () => [
      { positionId: 1, normalizedFen: 'fen-1' },
      { positionId: 2, normalizedFen: 'fen-2' },
    ],
    persistPositionResult: async () => true,
    markSucceeded: async () => {},
    markFailure: async () => {},
    requestReanalysis: async () => 99,
    ...overrides,
  };
}

function fakeEngine(overrides = {}) {
  return {
    engineName: 'Stockfish 18',
    engineVersion: '18',
    analyzeFen: async () => fakeAnalysis(),
    close: async () => {},
    ...overrides,
  };
}

test('analysis service stops cooperatively when a superseded run rejects a late write', async () => {
  const analyzed = [];
  let succeeded = false;
  let failed = false;
  const repository = baseRepository({
    persistPositionResult: async (input) => {
      analyzed.push(input.positionId);
      return false;
    },
    markSucceeded: async () => { succeeded = true; },
    markFailure: async () => { failed = true; },
  });
  const service = createStockfishAnalysisService({
    repository,
    engineFactory: async () => fakeEngine(),
    workerId: 'test-worker',
  });

  assert.equal(await service.runOnce(), true);
  assert.deepEqual(analyzed, [1]);
  assert.equal(succeeded, false);
  assert.equal(failed, false);
});

test('analysis service records an engine startup failure for retry on the same run', async () => {
  let failure = null;
  const repository = baseRepository({
    markFailure: async (run, error) => { failure = { run, error }; },
  });
  const service = createStockfishAnalysisService({
    repository,
    engineFactory: async () => { throw new Error('stockfish unavailable'); },
    workerId: 'test-worker',
  });

  assert.equal(await service.runOnce(), true);
  assert.equal(failure.run.id, 11);
  assert.equal(failure.run.attempts, 1);
  assert.match(failure.error, /stockfish unavailable/);
});

test('requestReanalysis delegates deterministic snapshot settings to supersession persistence', async () => {
  let requested = null;
  const repository = baseRepository({
    claimNext: async () => null,
    requestReanalysis: async (input) => {
      requested = input;
      return 42;
    },
  });
  const service = createStockfishAnalysisService({ repository, workerId: 'test-worker' });
  assert.equal(await service.requestReanalysis(123), 42);
  assert.equal(requested.importedGameId, 123);
  assert.equal(requested.settings.depth, 16);
  assert.equal(requested.settings.multiPv, 3);
  assert.equal(requested.settings.threads, 1);
  assert.equal(requested.settings.hashMb, 64);
  assert.equal(requested.settingsHash, settingsHash(DEFAULT_STOCKFISH_SETTINGS));
});
