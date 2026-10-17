import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizePipelineFixtureSamples } from './phase-7-native-pipeline-report.mjs';

function sample(overrides = {}) {
  return {
    fixtureKey: 'synthetic_blitz',
    speedCategory: 'blitz',
    initialSeconds: 180,
    incrementSeconds: 2,
    sourceClockCoverage: 'COMPLETE',
    scenario: 'STANDARD',
    plies: 4,
    positionsTotal: 5,
    cacheHits: 0,
    cacheMisses: 5,
    analysisAttempts: 1,
    nativeEngineSpawns: 1,
    evidenceRuns: 5,
    clockAlignmentStatus: 'COMPLETE',
    timingCoverageStatus: 'COMPLETE',
    harnessWallMs: 100,
    stageCallWallMs: {
      import: [10], indexing: [10], analysis: [35],
      evidence: [4, 4, 4, 4, 4], replay: [2],
    },
    ...overrides,
  };
}
const summarizeOne = (row) => summarizePipelineFixtureSamples([row], 1);

test('groups measured native synthetic fixture stages with transparent sample unit', () => {
  const report = summarizePipelineFixtureSamples([
    sample({ fixtureKey: 'first', harnessWallMs: 100 }),
    sample({
      fixtureKey: 'second', harnessWallMs: 160, sourceClockCoverage: 'ABSENT',
      stageCallWallMs: { import: [20], indexing: [20], analysis: [60], evidence: [5, 5, 5, 5, 5], replay: [5] },
    }),
    sample({
      fixtureKey: 'third', harnessWallMs: 210, scenario: 'NATIVE_PROCESS_CRASH_RETRY',
      sourceClockCoverage: 'COMPLETE',
      analysisAttempts: 2, nativeEngineSpawns: 2,
      stageCallWallMs: { import: [10], indexing: [10], analysis: [40, 60],
        evidence: [4, 4, 4, 4, 4], replay: [2] },
    }),
  ], 3);
  assert.equal(report.games, 3);
  assert.equal(report.schemaVersion, 'phase-7-native-pipeline-fixture-timings-v1');
  assert.match(report.sampleUnit, /SYNTHETIC/);
  assert.equal(report.strata.length, 2);
  const complete = report.strata.find((row) => row.sourceClockCoverage === 'COMPLETE');
  assert.equal(complete.games, 2);
  assert.equal(complete.harnessWallMs.p50Ms, 100);
  assert.equal(complete.harnessWallMs.p95Ms, 210);
  assert.equal(complete.stages.analysis.p90Ms, 100);
  assert.equal(report.samples[2].stageTotalWallMs.analysis, 100);
});

test('requires exact expected fixture cardinality and unique opaque keys', () => {
  assert.throws(() => summarizePipelineFixtureSamples([sample()]), /incomplete/);
  assert.throws(() => summarizeOne(sample({ fixtureKey: 'https://lichess.org/a' })), /Invalid/);
  assert.throws(() => summarizePipelineFixtureSamples([sample(), sample()], 2), /Invalid/);
  assert.throws(() => summarizeOne(sample({ credential: 'secret' })), /Invalid/);
});

test('rejects mismatched time controls, cache counts, stage totals and missing calls', () => {
  assert.throws(() => summarizeOne(sample({ speedCategory: 'bullet' })), /time control/);
  assert.throws(() => summarizeOne(sample({ cacheMisses: 4 })), /Invalid/);
  assert.throws(() => summarizeOne(sample({ harnessWallMs: 1 })), /containing wall/);
  assert.throws(() => summarizeOne(sample({
    stageCallWallMs: { import: [1], indexing: [1], analysis: [],
      evidence: [1], replay: [1] },
  })), /missing or invalid/);
  assert.throws(() => summarizeOne(sample({
    stageCallWallMs: { ...sample().stageCallWallMs, sqlText: [5] },
  })), /Invalid/);
});

test('rejects false native retry/spawn accounting and nonfinite durations', () => {
  assert.throws(() => summarizeOne(sample({ scenario: 'NATIVE_PROCESS_CRASH_RETRY' })), /counts/);
  assert.throws(() => summarizeOne(sample({
    nativeEngineSpawns: 2, stageCallWallMs: { ...sample().stageCallWallMs, analysis: [35, 5] },
  })), /counts/);
  assert.throws(() => summarizeOne(sample({
    stageCallWallMs: { ...sample().stageCallWallMs, evidence: [Infinity] },
  })), /missing or invalid/);
  assert.throws(() => summarizeOne(sample({ harnessWallMs: NaN })), /Invalid/);
});
