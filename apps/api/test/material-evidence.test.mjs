import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceDetectors } from '../dist/modules/evidence/evidence.registry.js';
import {
  MATERIAL_EVIDENCE_DETECTOR_KEY,
  MATERIAL_EVIDENCE_DETECTOR_VERSION,
  detectMaterialEvidence,
  materialEvidenceDetector,
} from '../dist/modules/evidence/material-evidence.detector.js';

function engineAnalysis(bestMove) {
  return {
    depth: 16,
    scoreCpWhite: 0,
    mateWhite: null,
    bestMove,
    bestPv: bestMove ? [bestMove] : [],
    multiPv: [],
  };
}

function snapshot({
  beforeFen,
  afterFen,
  moveUci,
  beforeBestMove,
  afterBestMove,
  scoreLossCp = 0,
  speedCategory = 'blitz',
}) {
  return {
    game: {
      id: 7,
      appUserId: 3,
      provider: 'LICHESS',
      providerGameId: 'material-fixture',
      userColor: 'WHITE',
      resultForUser: 'LOSS',
      speedCategory,
      variant: 'standard',
      timeControlInitial: speedCategory === 'bullet' ? 60 : 180,
      timeControlIncrement: 0,
      exactTimeControlKey: speedCategory === 'bullet' ? '1+0' : '3+0',
      openingName: null,
      openingEco: null,
    },
    provenance: {
      sourcePlyIndexedAt: new Date('2026-09-12T10:00:00.000Z'),
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
        normalizedFen: beforeFen,
        analysis: engineAnalysis(beforeBestMove),
      },
      {
        id: 102,
        normalizedFen: afterFen,
        analysis: engineAnalysis(afterBestMove),
      },
    ],
    plies: [{
      plyNumber: 1,
      beforePositionId: 101,
      afterPositionId: 102,
      moveUci,
      moverColor: 'WHITE',
      isUserMove: true,
      sourceClockOrdinal: 0,
      sourceClockAfterCentiseconds: 5900,
      sourceClockSemantics: 'AFTER_MOVE',
      clockBeforeMoveCentiseconds: null,
      effectiveIncrementCentiseconds: 0,
      clockDeltaMoveTimeCentiseconds: null,
      beforeClockProvenance: 'UNAVAILABLE',
      incrementProvenance: 'EXACT',
      timingDerivationVersion: 1,
      timingDerivationStatus: 'UNAVAILABLE',
      timingReliabilityFlags: [],
      timingUnavailableReason: 'FIRST_MOVE',
      engineAnalysisRunId: 11,
      scoreLossCp,
      classificationCode: scoreLossCp === null ? null : scoreLossCp >= 180 ? 6 : 2,
    }],
  };
}

test('registers the material detector as complete-analysis evidence', () => {
  assert.equal(materialEvidenceDetector.key, MATERIAL_EVIDENCE_DETECTOR_KEY);
  assert.equal(materialEvidenceDetector.version, MATERIAL_EVIDENCE_DETECTOR_VERSION);
  assert.equal(materialEvidenceDetector.requiresCompleteAnalysis, true);
  assert.equal(evidenceDetectors.includes(materialEvidenceDetector), true);
});

test('detects a materially bad move that leaves an undefended queen en prise in bullet', () => {
  const result = detectMaterialEvidence(snapshot({
    beforeFen: '3rk3/8/8/8/8/8/8/3QK3 w - -',
    afterFen: '3rk3/8/8/8/3Q4/8/8/4K3 b - -',
    moveUci: 'd1d4',
    beforeBestMove: 'e1e2',
    afterBestMove: 'd8d4',
    scoreLossCp: 400,
    speedCategory: 'bullet',
  }));

  assert.equal(result.coverage.status, 'COMPLETE');
  const hanging = result.findings.find((finding) => finding.type === 'HANGING_MATERIAL');
  assert.ok(hanging);
  assert.equal(hanging.source.positionId, 102);
  assert.equal(hanging.measurements.targetValue, 9);
  assert.equal(hanging.measurements.defenderCount, 0);
  assert.equal(hanging.details.hangingPiece, 'q');
  assert.equal(hanging.details.bestReplyUci, 'd8d4');
});

test('detects a missed free queen capture and suppresses the duplicate hanging consequence', () => {
  const result = detectMaterialEvidence(snapshot({
    beforeFen: '4k3/8/8/3q4/2B5/8/8/4K3 w - -',
    afterFen: '4k3/8/8/3q4/2B5/8/4K3/8 b - -',
    moveUci: 'e1e2',
    beforeBestMove: 'c4d5',
    afterBestMove: 'd5c4',
    scoreLossCp: 600,
  }));

  const missed = result.findings.filter((finding) => finding.type === 'MISSED_MATERIAL_WIN');
  const hanging = result.findings.filter((finding) => finding.type === 'HANGING_MATERIAL');
  assert.equal(missed.length, 1);
  assert.equal(hanging.length, 0);
  assert.equal(missed[0].details.bestMoveUci, 'c4d5');
  assert.equal(missed[0].details.mechanism, 'FREE_CAPTURE');
  assert.equal(missed[0].measurements.capturedValue, 9);
});

test('emits exact material-state change measurements for a capture', () => {
  const result = detectMaterialEvidence(snapshot({
    beforeFen: '4k3/8/8/3q4/2B5/8/8/4K3 w - -',
    afterFen: '4k3/8/8/3B4/8/8/8/4K3 b - -',
    moveUci: 'c4d5',
    beforeBestMove: 'c4d5',
    afterBestMove: 'e8e7',
    scoreLossCp: 0,
  }));

  const change = result.findings.find((finding) => finding.type === 'MATERIAL_STATE_CHANGE');
  assert.ok(change);
  assert.equal(change.measurements.materialBalanceBefore, -6);
  assert.equal(change.measurements.materialBalanceAfter, 3);
  assert.equal(change.measurements.materialDeltaForUser, 9);
  assert.equal(change.details.capturedPiece, 'q');
});

test('does not label an equal defended exchange as a missed material win', () => {
  const result = detectMaterialEvidence(snapshot({
    beforeFen: '4k3/8/4p3/3b4/2B5/8/8/4K3 w - -',
    afterFen: '4k3/8/4p3/3b4/2B5/8/4K3/8 b - -',
    moveUci: 'e1e2',
    beforeBestMove: 'c4d5',
    afterBestMove: 'e8e7',
    scoreLossCp: 120,
  }));

  assert.equal(
    result.findings.some((finding) => finding.type === 'MISSED_MATERIAL_WIN'),
    false,
  );
});

test('does not call an engine-approved sacrifice simple hanging material', () => {
  const result = detectMaterialEvidence(snapshot({
    beforeFen: '3rk3/8/8/8/8/8/8/3QK3 w - -',
    afterFen: '3rk3/8/8/8/3Q4/8/8/4K3 b - -',
    moveUci: 'd1d4',
    beforeBestMove: 'd1d4',
    afterBestMove: 'd8d4',
    scoreLossCp: 0,
  }));

  assert.equal(
    result.findings.some((finding) => finding.type === 'HANGING_MATERIAL'),
    false,
  );
});

test('turns missing required score-loss evidence into incomplete coverage, not a negative', () => {
  const result = detectMaterialEvidence(snapshot({
    beforeFen: '3rk3/8/8/8/8/8/8/3QK3 w - -',
    afterFen: '3rk3/8/8/8/3Q4/8/8/4K3 b - -',
    moveUci: 'd1d4',
    beforeBestMove: 'e1e2',
    afterBestMove: 'd8d4',
    scoreLossCp: null,
  }));

  assert.equal(result.coverage.status, 'INCOMPLETE');
  assert.equal(
    result.findings.some((finding) => finding.type === 'HANGING_MATERIAL'),
    false,
  );
  const gap = result.findings.find(
    (finding) => finding.type === 'MATERIAL_EVIDENCE_COVERAGE_GAP',
  );
  assert.ok(gap);
  assert.equal(gap.availability, 'INCOMPLETE');
  assert.equal(gap.measurements.analysisGapCount, 1);
});
