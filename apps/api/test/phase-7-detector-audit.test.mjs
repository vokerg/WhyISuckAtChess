import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDetectorAudit, corpus } from './support/phase-7-detector-audit.mjs';

test('Phase 7 detector audit: deterministic corpus contract, not human accuracy', () => {
  const report = buildDetectorAudit();
  assert.equal(report.reportVersion, 'phase-7-detector-audit-v1');
  assert.equal(report.truthSource, 'SYNTHETIC_UNREVIEWED_TEST_ORACLE');
  assert.equal(report.summary.totalCorpusCases, 14);
  assert.equal(report.summary.assessedFamilyCases, 7);
  assert.equal(report.summary.coveredCases, 5);
  assert.equal(report.summary.coverageExcludedCases, 2);
  assert.deepEqual(report.summary.coverageExcludedIds, [
    'tact-missing-engine', 'tact-incomplete-after-analysis',
  ]);
  assert.equal(report.summary.scopedAssertions, 5); // Three required, two forbidden
  assert.equal(report.summary.testOracleAgreements, 5);
  assert.equal(report.summary.coverageAgreements, 7);
  assert.equal(report.summary.unexpectedMotifsDuringCoverageLoss, 0);
  assert.equal(report.summary.reviewedAssertions, 0);
  for (const key of [
    'truePositives', 'falsePositives', 'falseNegatives', 'trueNegatives',
    'precision', 'recall',
  ]) {
    assert.equal(report.summary[key], null, key + ' cannot be scored without human labels');
  }
  for (const row of report.rows) {
    assert.equal(row.reviewStatus, 'PENDING_DOMAIN_REVIEW');
    assert.equal(row.engineProvenance, 'DETERMINISTIC_TEST_DOUBLE');
    if (!row.coverageEligible) {
      assert.equal(row.scopedLabels.length, 0, 'unknown coverage must not become TN/FN');
      assert.equal(row.coverageGapFlag, true);
      assert.equal(row.observedMotifCount, 0, 'unavailable evidence cannot emit motifs');
    }
  }
});

test('Phase 7 detector audit exposes oracle disagreement, but does not invent false-negative rates', () => {
  const first = corpus.cases.find((entry) => entry.id === 'tact-missed-existing-fork');
  const data = { ...corpus, cases: [first] };
  const report = buildDetectorAudit(data, () => ({
    coverage: { status: 'COMPLETE', reason: null },
    findings: [],
  }));
  assert.equal(report.summary.scopedAssertions, 1);
  assert.equal(report.summary.testOracleAgreements, 0);
  assert.deepEqual(report.rows[0].scopedLabels.map((entry) => ({
    required: entry.oracleRequiresDetection, detected: entry.observedDetection,
    agrees: entry.agreesWithTestOracle,
  })), [{ required: true, detected: false, agrees: false }]);
  assert.equal(report.summary.falseNegatives, null, 'an unreviewed oracle mismatch is not expert FN');
});

test('Phase 7 detector audit fails closed when an unadjudicated label is misrepresented as reviewed', () => {
  const first = corpus.cases.find((entry) => entry.id === 'tact-missed-existing-fork');
  const data = {
    ...corpus,
    cases: [{ ...first, review: { ...first.review, status: 'REVIEWED' } }],
  };
  assert.throws(() => buildDetectorAudit(data), /domain review requires a separate/);
});
