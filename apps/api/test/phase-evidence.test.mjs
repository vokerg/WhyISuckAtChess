import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceDetectors } from '../dist/modules/evidence/evidence.registry.js';
import {
  PHASE_EVIDENCE_DETECTOR_KEY,
  PHASE_EVIDENCE_DETECTOR_VERSION,
  detectPhaseEvidence,
  phaseEvidenceDetector,
} from '../dist/modules/evidence/phase-evidence.detector.js';

function snapshot(fens) {
  const positions = fens.map((fen, index) => ({
    id: 100 + index,
    normalizedFen: fen,
    analysis: null,
  }));
  const plies = fens.slice(1).map((_, index) => ({
    plyNumber: index + 1,
    beforePositionId: positions[index].id,
    afterPositionId: positions[index + 1].id,
    moveUci: 'a2a3',
    moverColor: index % 2 === 0 ? 'WHITE' : 'BLACK',
    isUserMove: index % 2 === 0,
    sourceClockOrdinal: null,
    sourceClockAfterCentiseconds: null,
    sourceClockSemantics: null,
    clockBeforeMoveCentiseconds: null,
    effectiveIncrementCentiseconds: null,
    clockDeltaMoveTimeCentiseconds: null,
    beforeClockProvenance: null,
    incrementProvenance: null,
    timingDerivationVersion: null,
    timingDerivationStatus: null,
    timingReliabilityFlags: [],
    timingUnavailableReason: null,
    engineAnalysisRunId: null,
    scoreLossCp: null,
    classificationCode: null,
  }));

  return {
    game: {
      id: 9,
      appUserId: 3,
      provider: 'LICHESS',
      providerGameId: 'phase-fixture',
      userColor: 'WHITE',
      resultForUser: 'DRAW',
      speedCategory: 'bullet',
      variant: 'standard',
      timeControlInitial: 60,
      timeControlIncrement: 0,
      exactTimeControlKey: '1+0',
      openingName: 'Ignored by phase detector',
      openingEco: 'C50',
    },
    provenance: {
      sourcePlyIndexedAt: new Date('2026-09-12T12:00:00.000Z'),
      plyIndexPolicyVersion: 1,
      clockAlignmentVersion: 1,
      timingDerivationVersion: 1,
      timingCoverageStatus: 'UNAVAILABLE',
      analysis: null,
    },
    positions,
    plies,
  };
}

test('registers board-only phase evidence without requiring engine analysis', () => {
  assert.equal(phaseEvidenceDetector.key, PHASE_EVIDENCE_DETECTOR_KEY);
  assert.equal(phaseEvidenceDetector.version, PHASE_EVIDENCE_DETECTOR_VERSION);
  assert.equal(phaseEvidenceDetector.requiresCompleteAnalysis, false);
  assert.equal(evidenceDetectors.includes(phaseEvidenceDetector), true);
});

test('publishes compact opening, middlegame, and pawn-endgame ranges', () => {
  const result = detectPhaseEvidence(snapshot([
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
    'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 w - -',
    '8/8/8/3k4/8/4K3/4P3/8 w - -',
  ]));

  assert.equal(result.coverage.status, 'COMPLETE');
  const ranges = result.findings.filter(
    (finding) => finding.type === 'POSITION_PHASE_RANGE',
  );
  assert.deepEqual(
    ranges.map((finding) => [
      finding.details.phase,
      finding.details.endgameFamily,
    ]),
    [
      ['OPENING', 'NONE'],
      ['MIDDLEGAME', 'NONE'],
      ['ENDGAME', 'PAWN'],
    ],
  );
  assert.deepEqual(
    ranges.map((finding) => [
      finding.measurements.startBoundaryPly,
      finding.measurements.endBoundaryPly,
    ]),
    [[0, 0], [1, 1], [2, 2]],
  );
});

test('keeps an entered endgame stable when promotion increases structural material', () => {
  const result = detectPhaseEvidence(snapshot([
    'r1b1k2r/6P1/8/8/8/8/8/R1B1K2R w - -',
    'r1b1k1Qr/8/8/8/8/8/8/R1B1K2R b - -',
  ]));

  const ranges = result.findings.filter(
    (finding) => finding.type === 'POSITION_PHASE_RANGE',
  );
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].details.phase, 'ENDGAME');
  assert.equal(ranges[1].details.phase, 'ENDGAME');
  assert.equal(ranges[1].details.structuralStartPhase, 'MIDDLEGAME');
  assert.equal(ranges[1].details.endgameFamily, 'MIXED_PIECE');
});

test('reports invalid board state as explicit incomplete coverage', () => {
  const result = detectPhaseEvidence(snapshot([
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
    'not-a-fen',
  ]));

  assert.equal(result.coverage.status, 'INCOMPLETE');
  assert.equal(
    result.findings.some(
      (finding) => finding.type === 'PHASE_EVIDENCE_COVERAGE_GAP',
    ),
    true,
  );
  const unknown = result.findings.find(
    (finding) => finding.type === 'POSITION_PHASE_RANGE'
      && finding.details.phase === 'UNKNOWN',
  );
  assert.ok(unknown);
  assert.equal(unknown.availability, 'INCOMPLETE');
});

test('marks a valid but unsupported endgame family as incomplete', () => {
  const result = detectPhaseEvidence(snapshot([
    '8/8/8/3k4/8/4K3/8/8 w - -',
    '8/8/8/3k4/8/4K3/8/8 b - -',
  ]));

  assert.equal(result.coverage.status, 'INCOMPLETE');
  assert.equal(result.coverage.reason, 'phase-or-endgame-family-unavailable');
  const range = result.findings.find(
    (finding) => finding.type === 'POSITION_PHASE_RANGE',
  );
  assert.ok(range);
  assert.equal(range.details.phase, 'ENDGAME');
  assert.equal(range.details.endgameFamily, 'UNKNOWN');
  assert.equal(range.availability, 'INCOMPLETE');
  assert.equal(
    range.unavailableReason,
    'phase-or-endgame-family-unavailable',
  );
});


test('keeps stabilized phase unknown after a board gap until certainty is restored', () => {
  const result = detectPhaseEvidence(snapshot([
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
    'not-a-fen',
    'r1b1k1Qr/8/8/8/8/8/8/R1B1K2R b - -',
    '8/8/8/3k4/8/4K3/4P3/8 w - -',
  ]));

  assert.equal(result.coverage.status, 'INCOMPLETE');
  const ranges = result.findings.filter(
    (finding) => finding.type === 'POSITION_PHASE_RANGE',
  );
  assert.deepEqual(
    ranges.map((finding) => [
      finding.details.phase,
      finding.details.structuralStartPhase,
      finding.details.structuralEndPhase,
    ]),
    [
      ['OPENING', 'OPENING', 'OPENING'],
      ['UNKNOWN', 'UNKNOWN', 'MIDDLEGAME'],
      ['ENDGAME', 'ENDGAME', 'ENDGAME'],
    ],
  );
  assert.equal(ranges[1].availability, 'INCOMPLETE');
  assert.equal(ranges[2].details.endgameFamily, 'PAWN');
});
