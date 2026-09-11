import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  createStockfishEngine,
  DEFAULT_STOCKFISH_SETTINGS,
  parseStockfishInfo,
  settingsHash,
  summarizeStockfishSearch,
  toUciFen,
} from '../dist/modules/engine-analysis/stockfish.adapter.js';
import { createStockfishAnalysisService } from '../dist/modules/engine-analysis/engine-analysis.service.js';

test('Stockfish adapter preserves raw UCI facts and normalizes scores to white perspective', () => {
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

  const result = summarizeStockfishSearch(lines, 'e2e4', 'b');
  assert.equal(result.depth, 16);
  assert.equal(result.scoreCpWhite, -24);
  assert.equal(result.bestMove, 'e2e4');
  assert.deepEqual(result.bestPv, ['e2e4', 'c7c5']);
  assert.equal(result.multiPv.length, 3);
  assert.equal(result.multiPv[2].mateWhite, 3);
  assert.deepEqual(result.rawInfo, lines);
  assert.equal(settingsHash(DEFAULT_STOCKFISH_SETTINGS), settingsHash({ ...DEFAULT_STOCKFISH_SETTINGS }));
  assert.equal(
    settingsHash(DEFAULT_STOCKFISH_SETTINGS),
    settingsHash({ hashMb: 64, threads: 1, multiPv: 3, depth: 16 }),
  );
  assert.equal(
    toUciFen('8/8/8/8/8/8/8/K6k w - -'),
    '8/8/8/8/8/8/8/K6k w - - 0 1',
  );
  assert.equal(
    toUciFen('8/8/8/8/8/8/8/K6k b - - 4 17'),
    '8/8/8/8/8/8/8/K6k b - - 4 17',
  );
});

test('Stockfish adapter rejects a hung UCI command at the configured timeout', async () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };

  await assert.rejects(
    () => createStockfishEngine({
      commandTimeoutMs: 5,
      spawnProcess: () => child,
    }),
    /uci initialization timed out/,
  );
  assert.equal(child.killed, true);
});

test('Stockfish adapter rejects a hung search and disposes the engine process', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  child.stdin = {
    write: (value) => {
      const command = String(value).trim();
      if (command === 'uci') child.stdout.write('id name Stockfish 18\nuciok\n');
      if (command === 'isready') child.stdout.write('readyok\n');
      return true;
    },
  };

  const engine = await createStockfishEngine({
    commandTimeoutMs: 100,
    spawnProcess: () => child,
  });
  await assert.rejects(
    () => engine.analyzeFen('8/8/8/8/8/8/8/K6k w - -'),
    /position analysis timed out/,
  );
  await engine.close();
  assert.equal(child.killed, true);
});

function fakeAnalysis(scoreCpWhite = 12, options = {}) {
  return {
    depth: 16,
    scoreCpWhite,
    mateWhite: options.mateWhite ?? null,
    bestMove: options.bestMove ?? 'e2e4',
    bestPv: options.bestPv ?? ['e2e4', 'e7e5'],
    multiPv: options.multiPv ?? [{
      multiPv: 1,
      depth: 16,
      scoreCpWhite,
      mateWhite: options.mateWhite ?? null,
      pv: options.bestPv ?? ['e2e4', 'e7e5'],
      raw: 'info',
    }],
    rawInfo: ['info depth 16 multipv 1 score cp 12 pv e2e4 e7e5'],
  };
}

function baseClaim() {
  return {
    id: 11,
    importedGameId: 7,
    snapshotId: 'snapshot-11',
    attempts: 1,
    maxAttempts: 3,
    analysisVersion: 'test-v1',
    settingsHash: settingsHash(DEFAULT_STOCKFISH_SETTINGS),
    sourcePlyIndexedAt: new Date('2026-09-11T10:00:00.000Z'),
    workerId: 'test-worker',
    claimToken: 'claim-11',
  };
}

function baseRepository(overrides = {}) {
  return {
    enqueueEligibleGame: async () => null,
    recoverStaleRuns: async () => 0,
    claimNext: async () => baseClaim(),
    recordEngineIdentity: async () => true,
    loadGameWork: async () => ({
      positions: [
        { positionId: 1, normalizedFen: 'fen-1' },
        { positionId: 2, normalizedFen: 'fen-2' },
      ],
      plies: [{
        plyNumber: 1,
        beforePositionId: 1,
        afterPositionId: 2,
        moveUci: 'a2a3',
        moverColor: 'WHITE',
      }],
    }),
    loadCachedPositionAnalyses: async () => [],
    initializeProgress: async () => true,
    persistBatch: async () => true,
    markSucceeded: async () => true,
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

test('analysis service reuses cached positions, analyses only misses, and classifies the played ply', async () => {
  const analyzedFens = [];
  const batches = [];
  let initialized = null;
  let succeeded = false;

  const repository = baseRepository({
    loadCachedPositionAnalyses: async () => [{
      positionId: 1,
      ...fakeAnalysis(100, {
        bestMove: 'e2e4',
        bestPv: ['e2e4', 'e7e5'],
      }),
    }],
    initializeProgress: async (_run, input) => {
      initialized = input;
      return true;
    },
    persistBatch: async (_run, input) => {
      batches.push(input);
      return true;
    },
    markSucceeded: async () => {
      succeeded = true;
      return true;
    },
  });

  const service = createStockfishAnalysisService({
    repository,
    engineFactory: async () => fakeEngine({
      analyzeFen: async (fen) => {
        analyzedFens.push(fen);
        return fakeAnalysis(0, { bestMove: 'h7h6', bestPv: ['h7h6'] });
      },
    }),
    workerId: 'test-worker',
  });

  assert.equal(await service.runOnce(), true);
  assert.deepEqual(analyzedFens, ['fen-2']);
  assert.deepEqual(initialized, {
    positionsTotal: 2,
    pliesTotal: 1,
    cacheHits: 1,
    cacheMisses: 1,
  });

  const positionWrites = batches.flatMap((batch) => batch.positionResults);
  const plyWrites = batches.flatMap((batch) => batch.plyResults);
  assert.deepEqual(positionWrites.map((row) => row.positionId), [2]);
  assert.equal(plyWrites.length, 1);
  assert.equal(plyWrites[0].scoreLossCp, 100);
  assert.equal(plyWrites[0].classificationCode, 5);
  assert.equal(succeeded, true);
});

test('analysis service normalizes mate scores and black mover loss deterministically', async () => {
  const batches = [];
  const repository = baseRepository({
    loadGameWork: async () => ({
      positions: [
        { positionId: 1, normalizedFen: 'fen-1' },
        { positionId: 2, normalizedFen: 'fen-2' },
      ],
      plies: [{
        plyNumber: 1,
        beforePositionId: 1,
        afterPositionId: 2,
        moveUci: 'h7h6',
        moverColor: 'BLACK',
      }],
    }),
    persistBatch: async (_run, input) => {
      batches.push(input);
      return true;
    },
  });
  const service = createStockfishAnalysisService({
    repository,
    engineFactory: async () => fakeEngine({
      analyzeFen: async (fen) => fen === 'fen-1'
        ? fakeAnalysis(null, { bestMove: 'a7a6', mateWhite: -3 })
        : fakeAnalysis(null, { bestMove: 'e2e4', mateWhite: 3 }),
    }),
    workerId: 'test-worker',
  });

  assert.equal(await service.runOnce(), true);
  const ply = batches.flatMap((batch) => batch.plyResults)[0];
  assert.equal(ply.scoreLossCp, 2_000);
  assert.equal(ply.classificationCode, 6);
});

test('analysis service stops cooperatively when a superseded run rejects a batch write', async () => {
  let succeeded = false;
  let failed = false;
  const repository = baseRepository({
    persistBatch: async () => false,
    markSucceeded: async () => {
      succeeded = true;
      return true;
    },
    markFailure: async () => { failed = true; },
  });
  const service = createStockfishAnalysisService({
    repository,
    engineFactory: async () => fakeEngine(),
    workerId: 'test-worker',
  });

  assert.equal(await service.runOnce(), true);
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

test('analysis service preserves persisted partial progress when a later engine search fails', async () => {
  const positions = Array.from({ length: 9 }, (_, index) => ({
    positionId: index + 1,
    normalizedFen: 'fen-' + (index + 1),
  }));
  const persisted = [];
  let failure = null;
  let calls = 0;
  const repository = baseRepository({
    loadGameWork: async () => ({
      positions,
      plies: [{
        plyNumber: 1,
        beforePositionId: 1,
        afterPositionId: 2,
        moveUci: 'a2a3',
        moverColor: 'WHITE',
      }],
    }),
    persistBatch: async (_run, input) => {
      persisted.push(input);
      return true;
    },
    markFailure: async (run, error) => { failure = { run, error }; },
  });
  const service = createStockfishAnalysisService({
    repository,
    engineFactory: async () => fakeEngine({
      analyzeFen: async () => {
        calls += 1;
        if (calls === 9) throw new Error('engine search failed');
        return fakeAnalysis(calls);
      },
    }),
    workerId: 'test-worker',
  });

  assert.equal(await service.runOnce(), true);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].positionResults.length, 8);
  assert.equal(persisted[0].positionsDone, 8);
  assert.match(failure.error, /engine search failed/);
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
