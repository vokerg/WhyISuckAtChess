// Phase 7 #124: a machine-readable audit of *test-oracle agreement*, NOT detector accuracy.
// All current corpus labels and engine snapshots are synthetic/unadjudicated.
// Run: node apps/api/test/support/phase-7-detector-audit.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { reconstructPgnPlies } from '@why-i-suck-at-chess/chess-domain';
import {
  detectTacticalMotifEvidence,
  TACTICAL_MOTIF_EVIDENCE_DETECTOR_VERSION,
} from '../../dist/modules/evidence/tactical-motif-evidence.detector.js';
import { TIMING_DERIVATION_VERSION } from '../../dist/modules/timing/timing-policy.js';

export const corpus = JSON.parse(readFileSync(
  new URL('../fixtures/phase-7-gold-corpus.v1.json', import.meta.url), 'utf8',
));

function tacticalSnapshot(entry) {
  const source = entry.source;
  assert.equal(source.kind, 'SYNTHETIC_POSITION');
  const legal = reconstructPgnPlies([
    '[Event "Phase 7 detector audit"]',
    '[SetUp "1"]',
    '[FEN "' + source.beforeFen + ' 0 1"]',
    '[Result "*"]', '', '1. ' + source.playedSan + ' *',
  ].join('\n'));
  assert.equal(legal.length, 1, entry.id + ': expected one legal ply');
  assert.equal(legal[0].moveUci, source.playedUci);
  assert.equal(legal[0].afterNormalizedFen, source.afterFen);
  assert.equal(legal[0].beforeNormalizedFen, source.beforeFen);

  const engine = entry.engine;
  assert.equal(engine.provenance, 'DETERMINISTIC_TEST_DOUBLE');
  const hasRun = engine.state !== 'NONE';
  const positionAnalysis = (move) => ({
    depth: engine.depth, scoreCpWhite: 0, mateWhite: null,
    bestMove: move, bestPv: move ? [move] : [], multiPv: [],
  });
  const g = entry.gameContext;
  return {
    game: {
      id: 1, appUserId: 1, provider: 'LICHESS', providerGameId: entry.id,
      userColor: g.userColor, resultForUser: g.result, speedCategory: g.speedCategory,
      variant: g.variant, timeControlInitial: g.initialSeconds,
      timeControlIncrement: g.incrementSeconds,
      exactTimeControlKey: g.initialSeconds + '+' + g.incrementSeconds,
      openingName: null, openingEco: null,
    },
    provenance: {
      sourcePlyIndexedAt: new Date('2026-10-10T00:00:00Z'),
      plyIndexPolicyVersion: 1, clockAlignmentVersion: 1,
      timingDerivationVersion: TIMING_DERIVATION_VERSION,
      timingCoverageStatus: 'UNAVAILABLE',
      analysis: hasRun ? {
        runId: 1, snapshotId: entry.id, analysisVersion: engine.version,
        settingsHash: 'synthetic-no-stockfish',
        engineName: 'GoldCorpusDouble', engineVersion: 'test-only',
      } : null,
    },
    positions: [
      { id: 101, normalizedFen: source.beforeFen,
        analysis: hasRun ? positionAnalysis(engine.beforeBestMoveUci) : null },
      { id: 102, normalizedFen: source.afterFen,
        analysis: engine.state === 'COMPLETE' ? positionAnalysis(engine.afterBestMoveUci) : null },
    ],
    plies: [{
      plyNumber: 1, beforePositionId: 101, afterPositionId: 102,
      moveUci: source.playedUci, moverColor: g.userColor, isUserMove: true,
      sourceClockOrdinal: null, sourceClockAfterCentiseconds: null,
      sourceClockSemantics: null, clockBeforeMoveCentiseconds: null,
      effectiveIncrementCentiseconds: null, clockDeltaMoveTimeCentiseconds: null,
      beforeClockProvenance: 'UNAVAILABLE', incrementProvenance: 'UNAVAILABLE',
      timingDerivationVersion: TIMING_DERIVATION_VERSION,
      timingDerivationStatus: 'UNAVAILABLE', timingReliabilityFlags: [],
      timingUnavailableReason: 'SYNTHETIC_POSITION',
      engineAnalysisRunId: hasRun ? 1 : null,
      scoreLossCp: hasRun ? engine.scoreLossCp : null,
      classificationCode: engine.scoreLossCp !== null && engine.scoreLossCp >= 180 ? 6 : 2,
    }],
  };
}

function hasLabel(findings, label) {
  return findings.some((finding) => finding.type === label.type
    && finding.details?.motif === label.motif
    && finding.details?.motifState === label.motifState);
}

/**
 * Scoped assertions, not exhaustive labels: a forbidden motif is not a claim
 * that *no* other motifs exist. Unknown coverage is never a true negative.
 * Expert-reviewed confusion matrices are deliberately unavailable in v1.
 */
export function buildDetectorAudit(data = corpus, detect = detectTacticalMotifEvidence) {
  assert.equal(data.schemaVersion, 'phase-7-gold-corpus-v1');
  assert.equal(data.domainReviewStatus, 'PENDING');
  const entries = data.cases.filter((entry) => entry.family === 'TACTICAL_MOTIF');
  const rows = entries.map((entry) => {
    assert.equal(entry.review.status, 'PENDING_DOMAIN_REVIEW',
      'a domain review requires a separate adjudicated audit and revised metrics');
    const result = detect(tacticalSnapshot(entry));
    const labels = [
      ...entry.expected.required.map((label) => ({ label, required: true })),
      ...entry.expected.forbidden.map((label) => ({ label, required: false })),
    ].map(({ label, required }) => {
      const observed = hasLabel(result.findings, label);
      return {
        label, oracleRequiresDetection: required, observedDetection: observed,
        agreesWithTestOracle: observed === required,
      };
    });
    const observedCoverage = result.coverage.status;
    const coverageMatches = observedCoverage === entry.expected.coverage
      && result.coverage.reason === entry.expected.reason;
    const coverageEligible = observedCoverage === 'COMPLETE'
      && entry.expected.coverage === 'COMPLETE';
    return {
      caseId: entry.id, caseKind: entry.caseKind,
      plyNumber: 1, playedUci: entry.source.playedUci,
      engineProvenance: entry.engine.provenance,
      engineSnapshotVersion: entry.engine.version,
      reviewStatus: entry.review.status,
      expectedCoverage: entry.expected.coverage,
      observedCoverage, coverageReason: result.coverage.reason,
      coverageMatches, coverageEligible,
      scopedLabels: labels,
      observedMotifCount: result.findings.filter((finding) => (
        finding.type === 'MISSED_TACTICAL_MOTIF'
        || finding.type === 'ALLOWED_TACTICAL_MOTIF'
      )).length,
      coverageGapFlag: result.findings.some((finding) => finding.type === 'TACTICAL_MOTIF_COVERAGE_GAP'),
    };
  });
  const scopedLabels = rows.flatMap((row) => row.scopedLabels);
  const coverageExcludedCases = rows.filter((row) => !row.coverageEligible);
  return {
    reportVersion: 'phase-7-detector-audit-v1',
    corpusVersion: data.schemaVersion,
    detector: 'TACTICAL_MOTIF',
    detectorVersion: TACTICAL_MOTIF_EVIDENCE_DETECTOR_VERSION,
    truthSource: 'SYNTHETIC_UNREVIEWED_TEST_ORACLE',
    summary: {
      totalCorpusCases: data.cases.length,
      assessedFamilyCases: rows.length,
      coveredCases: rows.length - coverageExcludedCases.length,
      coverageExcludedCases: coverageExcludedCases.length,
      coverageExcludedIds: coverageExcludedCases.map((row) => row.caseId),
      scopedAssertions: scopedLabels.length,
      testOracleAgreements: scopedLabels.filter((label) => label.agreesWithTestOracle).length,
      coverageAgreements: rows.filter((row) => row.coverageMatches).length,
      unexpectedMotifsDuringCoverageLoss: coverageExcludedCases
        .filter((row) => row.observedMotifCount > 0).length,
      reviewedAssertions: 0,
      // Null, NOT zero: no independently reviewed reference labels exist.
      truePositives: null, falsePositives: null, falseNegatives: null,
      trueNegatives: null, precision: null, recall: null,
      unsupportedFamilies: [
        'MATERIAL', 'TACTICAL_OFFENSE_OTHER', 'DEFENSIVE_THREAT',
        'CONVERSION', 'PHASE_ENDGAME', 'OPENING',
      ],
    },
    rows,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(buildDetectorAudit(), null, 2) + '\n');
}
