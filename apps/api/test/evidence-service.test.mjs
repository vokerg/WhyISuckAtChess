import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_EVIDENCE_FINDINGS_PER_RUN,
  createEvidenceService,
  validateEvidenceDetectorResult,
} from '../dist/modules/evidence/evidence.service.js';
import { runWorkerCycle } from '../dist/worker.js';

function snapshot() {
  return {
    game: {
      id: 7,
      appUserId: 3,
      provider: 'LICHESS',
      providerGameId: 'fixture-game',
      userColor: 'WHITE',
      resultForUser: 'WIN',
      speedCategory: 'blitz',
      variant: 'standard',
      timeControlInitial: 180,
      timeControlIncrement: 2,
      exactTimeControlKey: '3+2',
      openingName: null,
      openingEco: null,
    },
    provenance: {
      sourcePlyIndexedAt: new Date('2026-09-12T08:00:00.000Z'),
      plyIndexPolicyVersion: 1,
      clockAlignmentVersion: 1,
      timingDerivationVersion: 1,
      timingCoverageStatus: 'COMPLETE',
      analysis: {
        runId: 11,
        snapshotId: 'analysis-snapshot',
        analysisVersion: 'analysis-v1',
        settingsHash: 'settings',
        engineName: 'Stockfish',
        engineVersion: '18',
      },
    },
    positions: [
      {
        id: 101,
        normalizedFen: 'fen-before',
        analysis: {
          depth: 16,
          scoreCpWhite: 120,
          mateWhite: null,
          bestMove: 'e2e4',
          bestPv: ['e2e4'],
          multiPv: [],
        },
      },
      {
        id: 102,
        normalizedFen: 'fen-after',
        analysis: {
          depth: 16,
          scoreCpWhite: 20,
          mateWhite: null,
          bestMove: 'e7e5',
          bestPv: ['e7e5'],
          multiPv: [],
        },
      },
    ],
    plies: [{
      plyNumber: 1,
      beforePositionId: 101,
      afterPositionId: 102,
      moveUci: 'a2a3',
      moverColor: 'WHITE',
      isUserMove: true,
      sourceClockOrdinal: 0,
      sourceClockAfterCentiseconds: 17900,
      sourceClockSemantics: 'AFTER_MOVE',
      clockBeforeMoveCentiseconds: null,
      effectiveIncrementCentiseconds: 200,
      clockDeltaMoveTimeCentiseconds: null,
      beforeClockProvenance: 'UNAVAILABLE',
      incrementProvenance: 'EXACT',
      timingDerivationVersion: 1,
      timingDerivationStatus: 'UNAVAILABLE',
      timingReliabilityFlags: [],
      timingUnavailableReason: 'FIRST_MOVE',
      engineAnalysisRunId: 11,
      scoreLossCp: 100,
      classificationCode: 5,
    }],
  };
}

function claim() {
  return {
    id: 41,
    importedGameId: 7,
    detectorKey: 'fixture.material',
    detectorVersion: 'v1',
    workKey: 'work-key',
    sourcePlyIndexedAt: new Date('2026-09-12T08:00:00.000Z'),
    sourceAnalysisRunId: 11,
    sourceAnalysisSnapshotId: 'analysis-snapshot',
    attempts: 1,
    maxAttempts: 3,
    workerId: 'fixture-worker',
    claimToken: 'fixture-claim',
  };
}

function detector(result) {
  return {
    key: 'fixture.material',
    version: 'v1',
    requiresCompleteAnalysis: true,
    detect: async () => result,
  };
}

function repository(overrides = {}) {
  return {
    enqueueEligibleRun: async () => 41,
    recoverStaleRuns: async () => 0,
    claimNext: async () => claim(),
    loadSnapshot: async () => snapshot(),
    completeRun: async () => true,
    markFailure: async () => {},
    listCurrentEvidenceForGame: async () => [],
    ...overrides,
  };
}

test('evidence service executes one bounded detector run and publishes structured evidence', async () => {
  const completed = [];
  const enqueued = [];
  const claimedWith = [];
  const result = {
    coverage: { status: 'COMPLETE', details: { analysedPlies: 1 } },
    findings: [{
      key: 'ply-1-material-loss',
      type: 'MATERIAL_STATE_CHANGE',
      source: { startPly: 1, endPly: 1, positionId: 102 },
      measurements: { materialDelta: -1, scoreLossCp: 100 },
      details: { moveUci: 'a2a3' },
    }],
  };
  const repo = repository({
    enqueueEligibleRun: async (identity) => {
      enqueued.push(identity);
      return 41;
    },
    claimNext: async (workerId, identities) => {
      claimedWith.push({ workerId, identities });
      return claim();
    },
    completeRun: async (run, value) => {
      completed.push({ run, value });
      return true;
    },
  });
  const service = createEvidenceService({
    detectors: [detector(result)],
    repository: repo,
    workerId: 'fixture-worker',
  });

  assert.equal(await service.runOnce(), true);
  assert.deepEqual(enqueued, [{
    key: 'fixture.material',
    version: 'v1',
    requiresCompleteAnalysis: true,
  }]);
  assert.equal(claimedWith[0].workerId, 'fixture-worker');
  assert.equal(completed.length, 1);
  assert.deepEqual(completed[0].value, result);
});

test('evidence service records invalid detector output as a failed run', async () => {
  let completed = false;
  let failure = null;
  const invalid = {
    coverage: { status: 'COMPLETE' },
    findings: [
      {
        key: 'duplicate',
        type: 'MATERIAL_STATE_CHANGE',
        measurements: {},
      },
      {
        key: 'duplicate',
        type: 'MATERIAL_STATE_CHANGE',
        measurements: {},
      },
    ],
  };
  const repo = repository({
    completeRun: async () => {
      completed = true;
      return true;
    },
    markFailure: async (run, error) => {
      failure = { run, error };
    },
  });
  const service = createEvidenceService({
    detectors: [detector(invalid)],
    repository: repo,
    workerId: 'fixture-worker',
  });

  assert.equal(await service.runOnce(), true);
  assert.equal(completed, false);
  assert.equal(failure.run.id, 41);
  assert.match(failure.error, /duplicate finding key/i);
});

test('evidence service supersedes work when the persistence fence rejects completion', async () => {
  let failure = null;
  const repo = repository({
    completeRun: async () => false,
    markFailure: async (run, error) => {
      failure = { run, error };
    },
  });
  const service = createEvidenceService({
    detectors: [detector({
      coverage: { status: 'COMPLETE' },
      findings: [],
    })],
    repository: repo,
    workerId: 'fixture-worker',
  });

  assert.equal(await service.runOnce(), true);
  assert.equal(failure.run.id, 41);
  assert.match(failure.error, /source projection changed/i);
});

test('evidence output validation enforces source references and per-run boundedness', () => {
  assert.throws(
    () => validateEvidenceDetectorResult(snapshot(), {
      coverage: { status: 'COMPLETE' },
      findings: [{
        key: 'bad-ply',
        type: 'MATERIAL_STATE_CHANGE',
        source: { startPly: 2 },
        measurements: {},
      }],
    }),
    /outside the source snapshot/i,
  );

  assert.throws(
    () => validateEvidenceDetectorResult(snapshot(), {
      coverage: { status: 'COMPLETE' },
      findings: Array.from({ length: MAX_EVIDENCE_FINDINGS_PER_RUN + 1 }, (_, index) => ({
        key: 'finding-' + index,
        type: 'MATERIAL_STATE_CHANGE',
        measurements: {},
      })),
    }),
    /finding limit/i,
  );
});

test('empty evidence registry leaves the worker stage idle', async () => {
  const service = createEvidenceService({
    detectors: [],
    repository: repository({
      recoverStaleRuns: async () => {
        throw new Error('empty registry must not touch persistence');
      },
    }),
  });
  assert.equal(await service.runOnce(), false);
});

test('worker cycle owns the evidence execution stage after analysis', async () => {
  const calls = [];
  const executor = (name, result) => ({
    async runOnce() {
      calls.push(name);
      return result;
    },
  });

  assert.equal(await runWorkerCycle({
    importService: executor('import', false),
    plyIndexService: executor('index', false),
    analysisService: executor('analysis', false),
    evidenceService: executor('evidence', true),
  }), true);
  assert.deepEqual(calls, ['import', 'index', 'analysis', 'evidence']);
});
