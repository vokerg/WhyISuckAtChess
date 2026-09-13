import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceDetectors } from '../dist/modules/evidence/evidence.registry.js';
import {
  TACTICAL_MOTIF_EVIDENCE_DETECTOR_KEY,
  TACTICAL_MOTIF_EVIDENCE_DETECTOR_VERSION,
  detectTacticalMotifEvidence,
  tacticalMotifEvidenceDetector,
} from '../dist/modules/evidence/tactical-motif-evidence.detector.js';

function engineAnalysis(bestMove) {
  return {
    depth: 18,
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
  scoreLossCp = 240,
  speedCategory = 'blitz',
}) {
  return {
    game: {
      id: 7,
      appUserId: 3,
      provider: 'LICHESS',
      providerGameId: 'tactical-fixture',
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
      sourcePlyIndexedAt: new Date('2026-09-13T05:00:00.000Z'),
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
      classificationCode: scoreLossCp >= 180 ? 6 : 2,
    }],
  };
}

function motifFinding(result, type, motif) {
  return result.findings.find((finding) => (
    finding.type === type && finding.details?.motif === motif
  ));
}

test('registers the tactical motif detector as complete-analysis evidence', () => {
  assert.equal(
    tacticalMotifEvidenceDetector.key,
    TACTICAL_MOTIF_EVIDENCE_DETECTOR_KEY,
  );
  assert.equal(
    tacticalMotifEvidenceDetector.version,
    TACTICAL_MOTIF_EVIDENCE_DETECTOR_VERSION,
  );
  assert.equal(tacticalMotifEvidenceDetector.requiresCompleteAnalysis, true);
  assert.equal(evidenceDetectors.includes(tacticalMotifEvidenceDetector), true);
});

test('emits an existing fork as a missed engine-backed tactical motif in bullet', () => {
  const result = detectTacticalMotifEvidence(snapshot({
    beforeFen: '4k3/3q1r2/8/4N3/8/8/8/4K3 w - -',
    afterFen: '4k3/3q1r2/8/4N3/8/8/4K3/8 b - -',
    moveUci: 'e1e2',
    beforeBestMove: 'e5d7',
    afterBestMove: 'e8e7',
    scoreLossCp: 320,
    speedCategory: 'bullet',
  }));

  assert.equal(result.coverage.status, 'COMPLETE');
  const finding = motifFinding(result, 'MISSED_TACTICAL_MOTIF', 'FORK');
  assert.ok(finding);
  assert.equal(finding.details.motifState, 'EXISTING');
  assert.equal(finding.details.attackerSquare, 'e5');
  assert.equal(finding.details.engineMoveUci, 'e5d7');
  assert.equal(finding.measurements.scoreLossCp, 320);
});

test('emits a fork created by the missed engine best move', () => {
  const result = detectTacticalMotifEvidence(snapshot({
    beforeFen: '4k3/8/3q1r2/8/8/2N5/8/4K3 w - -',
    afterFen: '4k3/8/3q1r2/8/8/2N5/4K3/8 b - -',
    moveUci: 'e1e2',
    beforeBestMove: 'c3e4',
    afterBestMove: 'e8e7',
    scoreLossCp: 260,
  }));

  const finding = result.findings.find((entry) => (
    entry.type === 'MISSED_TACTICAL_MOTIF'
    && entry.details?.motif === 'FORK'
    && entry.details?.motifState === 'CREATED_BY_BEST_MOVE'
  ));
  assert.ok(finding);
  assert.equal(finding.details.attackerSquare, 'e4');
  assert.deepEqual(
    finding.details.targets.map((target) => target.square),
    ['d6', 'f6'],
  );
});

test('emits a newly allowed pin only when the engine best reply exploits it', () => {
  const result = detectTacticalMotifEvidence(snapshot({
    beforeFen: '4k3/8/8/8/1b6/2P5/3N4/4K3 w - -',
    afterFen: '4k3/8/8/8/1bP5/8/3N4/4K3 b - -',
    moveUci: 'c3c4',
    beforeBestMove: 'd2f3',
    afterBestMove: 'b4d2',
    scoreLossCp: 220,
  }));

  const finding = motifFinding(result, 'ALLOWED_TACTICAL_MOTIF', 'PIN');
  assert.ok(finding);
  assert.equal(finding.details.motifState, 'NEWLY_ALLOWED');
  assert.equal(finding.details.attackerSquare, 'b4');
  assert.deepEqual(
    finding.details.targets.map((target) => target.square),
    ['d2', 'e1'],
  );
});

test('emits a missed skewer created by the engine best move', () => {
  const result = detectTacticalMotifEvidence(snapshot({
    beforeFen: '8/8/8/8/3k1q2/8/R7/7K w - -',
    afterFen: '8/8/8/8/3k1q2/8/R7/6K1 b - -',
    moveUci: 'h1g1',
    beforeBestMove: 'a2a4',
    afterBestMove: 'd4e4',
    scoreLossCp: 300,
  }));

  const finding = motifFinding(result, 'MISSED_TACTICAL_MOTIF', 'SKEWER');
  assert.ok(finding);
  assert.equal(finding.details.motifState, 'CREATED_BY_BEST_MOVE');
  assert.deepEqual(
    finding.details.targets.map((target) => target.square),
    ['d4', 'f4'],
  );
});

test('emits a missed discovered attack with the revealing move recorded', () => {
  const result = detectTacticalMotifEvidence(snapshot({
    beforeFen: 'q3k3/8/8/8/N7/8/8/R3K3 w - -',
    afterFen: 'q3k3/8/8/8/N7/8/4K3/R7 b - -',
    moveUci: 'e1e2',
    beforeBestMove: 'a4b6',
    afterBestMove: 'e8e7',
    scoreLossCp: 360,
  }));

  const finding = motifFinding(
    result,
    'MISSED_TACTICAL_MOTIF',
    'DISCOVERED_ATTACK',
  );
  assert.ok(finding);
  assert.deepEqual(finding.details.revealedBy, {
    from: 'a4',
    to: 'b6',
    piece: 'n',
  });
  assert.equal(finding.details.attackerSquare, 'a1');
  assert.equal(finding.details.targets[0].square, 'a8');
});

test('does not promote incidental geometry into a severe finding without score loss', () => {
  const result = detectTacticalMotifEvidence(snapshot({
    beforeFen: '4k3/8/3q1r2/8/8/2N5/8/4K3 w - -',
    afterFen: '4k3/8/3q1r2/8/8/2N5/4K3/8 b - -',
    moveUci: 'e1e2',
    beforeBestMove: 'c3e4',
    afterBestMove: 'e8e7',
    scoreLossCp: 20,
  }));

  assert.equal(result.coverage.status, 'COMPLETE');
  assert.equal(
    result.findings.some((finding) => finding.type.includes('TACTICAL_MOTIF')),
    false,
  );
});

test('represents missing complete engine analysis as unavailable, not no finding', () => {
  const source = snapshot({
    beforeFen: '4k3/3q1r2/8/4N3/8/8/8/4K3 w - -',
    afterFen: '4k3/3q1r2/8/4N3/8/8/4K3/8 b - -',
    moveUci: 'e1e2',
    beforeBestMove: 'e5d7',
    afterBestMove: 'e8e7',
  });
  source.provenance.analysis = null;
  source.plies[0].engineAnalysisRunId = null;
  source.plies[0].scoreLossCp = null;
  source.positions[0].analysis = null;
  source.positions[1].analysis = null;

  const result = detectTacticalMotifEvidence(source);
  assert.equal(result.coverage.status, 'UNAVAILABLE');
  assert.equal(result.coverage.reason, 'complete-engine-analysis-unavailable');
  const gap = result.findings.find(
    (finding) => finding.type === 'TACTICAL_MOTIF_COVERAGE_GAP',
  );
  assert.ok(gap);
  assert.equal(gap.availability, 'UNAVAILABLE');
});
