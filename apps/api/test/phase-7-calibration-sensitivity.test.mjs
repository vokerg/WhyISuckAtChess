import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCalibrationSensitivityMatrix } from './support/phase-7-calibration-sensitivity.mjs';

const report = buildCalibrationSensitivityMatrix();

test('Phase 7 matrix is explicitly synthetic and does not claim reviewed accuracy', () => {
  assert.equal(report.reportVersion, 'phase-7-calibration-sensitivity-v1');
  assert.equal(report.policyVersions.timing, 'time-behavior-v1');
  assert.equal(report.policyVersions.ranking, 'diagnosis-ranking-v1');
  assert.equal(report.inputStatus, 'SYNTHETIC_UNREVIEWED_POLICY_PROBES');
  assert.equal(report.humanReviewedCases, 0);
  assert.equal(report.domainAccuracy, null);
  assert.equal(report.corpus.sourceCaseCount, 14);
  assert.equal(report.corpus.reviewStatus, 'PENDING');
  assert.ok(report.corpus.timingCaseIds.includes('time-rapid-clocks-absent'));
  assert.ok(report.corpus.timingCaseIds.includes('time-mixed-coverage'));
  assert.ok(report.corpus.timingCaseIds.includes('time-control-separation'));
});

test('boundary probes expose clock, ample, move-speed and early-overuse policy', () => {
  assert.deepEqual(report.clockCases.map((row) => row.band),
    ['CRITICAL', 'CRITICAL', 'PRESSURE', 'PRESSURE', 'NORMAL', null]);
  assert.deepEqual(report.ampleCases.map((row) => row.ample),
    [false, true, false, true, false, true, null]);
  assert.deepEqual(report.speedCases.map((row) => row.speed),
    ['FAST', 'FAST', 'NORMAL', null]);
  assert.equal(report.earlyOveruseMedianMultiplier, 1.5);
});

test('5/15/40 games and 50 percent required-coverage grades are sensitive at exact bounds', () => {
  const graded = (games, coverage) => {
    const match = report.grades.find((row) => (
      row.supportingGames === games
      && row.requiredEvidenceCoveragePercent === coverage
    ));
    assert.ok(match);
    return match.grade;
  };
  for (const games of [4, 5, 14, 15, 39, 40]) {
    assert.equal(graded(games, 49.9), 'INSUFFICIENT');
    assert.equal(graded(games, null), 'INSUFFICIENT');
  }
  assert.deepEqual(
    [4, 5, 14, 15, 39, 40].map((games) => graded(games, 50)),
    ['INSUFFICIENT', 'LOW', 'LOW', 'MEDIUM', 'MEDIUM', 'HIGH'],
  );
  assert.deepEqual(
    [4, 5, 14, 15, 39, 40].map((games) => graded(games, 100)),
    ['INSUFFICIENT', 'LOW', 'LOW', 'MEDIUM', 'MEDIUM', 'HIGH'],
  );
});

test('comparative evidence grade is bounded by the weaker arm, not pooled sample', () => {
  assert.deepEqual(report.comparativeCases.map((row) => [row.id, row.grade]), [
    ['balanced-high', 'HIGH'],
    ['weaker-arm-14', 'LOW'],
    ['weaker-arm-4', 'INSUFFICIENT'],
    ['low-coverage-arm', 'INSUFFICIENT'],
    ['weaker-arm-39', 'MEDIUM'],
  ]);
});

test('rating composition is a warning, never a synthetic confounder correction', () => {
  assert.deepEqual(report.ratingCompositionCases.map((row) => [row.id, row.warning]), [
    ['balanced', false],
    ['mean-threshold', true],
    ['band-threshold', true],
    ['unknown', null],
  ]);
});

test('ranking is invariant to finding ordering, sparse extreme outliers and neutral controls', () => {
  const rows = report.rankingCases;
  assert.deepEqual(rows.baseline.rows.map((row) => row.findingId), [1, 2]);
  assert.deepEqual(rows.reversedInput, rows.baseline);
  assert.deepEqual(rows.addedSparseHugeEffect, rows.baseline);
  assert.deepEqual(rows.addedAdequateNeutral, rows.baseline);
  assert.equal(rows.baseline.rows[0].rankingPolicyVersion, 'diagnosis-ranking-v1');
});

test('coverage eligibility and severity/evidence perturbations are visible in ranking', () => {
  const cases = report.rankingCases;
  assert.deepEqual(cases.coverageBelowGate.rows.map((row) => row.findingId), [2]);
  assert.deepEqual(
    new Set(cases.coverageAtGate.rows.map((row) => row.findingId)),
    new Set([1, 2]),
  );
  const score = (rows, id) => rows.find((row) => row.findingId === id).finalScore;
  assert.ok(score(cases.largerSeverity.rows, 1) > score(cases.baseline.rows, 1));
  assert.ok(score(cases.strongerEvidence.rows, 1) > score(cases.baseline.rows, 1));
  assert.equal(cases.strongerEvidence.rows.find((row) => row.findingId === 1).evidenceMultiplier, 1);
});

test('synthesized roots do not double-count children and stale finding sets fail closed', () => {
  assert.deepEqual(report.rankingCases.supportedRoot.rows.map((row) => row.findingId), [7]);
  assert.deepEqual(report.rankingCases.supportedRoot.suppressedRootChildren, [5, 6]);
  assert.equal(report.rankingCases.supportedRoot.allRowCount, 3);
  assert.equal(report.staleFindingSetRejected, true);
});
