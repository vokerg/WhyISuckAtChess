import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceDetectors } from '../dist/modules/evidence/evidence.registry.js';
import {
  DEFENSIVE_THREAT_EVIDENCE_DETECTOR_KEY,
  DEFENSIVE_THREAT_EVIDENCE_DETECTOR_VERSION,
  defensiveThreatEvidenceDetector,
  detectDefensiveThreatEvidence,
} from '../dist/modules/evidence/defensive-threat-evidence.detector.js';

function engineAnalysis({
  bestMove,
  scoreCpWhite = 0,
  mateWhite = null,
  multiPv,
}) {
  return {
    depth: 18,
    scoreCpWhite,
    mateWhite,
    bestMove,
    bestPv: bestMove ? [bestMove] : [],
    multiPv: multiPv ?? (bestMove ? [{
      multiPv: 1,
      depth: 18,
      scoreCpWhite,
      mateWhite,
      pv: [bestMove],
    }] : []),
  };
}

function baseGame() {
  return {
    id: 31,
    appUserId: 3,
    provider: 'LICHESS',
    providerGameId: 'defensive-threat-fixture',
    userColor: 'WHITE',
    resultForUser: 'LOSS',
    speedCategory: 'bullet',
    variant: 'standard',
    timeControlInitial: 60,
    timeControlIncrement: 0,
    exactTimeControlKey: '1+0',
    openingName: null,
    openingEco: null,
  };
}

function provenance() {
  return {
    sourcePlyIndexedAt: new Date('2026-09-13T12:00:00.000Z'),
    plyIndexPolicyVersion: 1,
    clockAlignmentVersion: 1,
    timingDerivationVersion: 1,
    timingCoverageStatus: 'COMPLETE',
    analysis: {
      runId: 11,
      snapshotId: 'defensive-analysis',
      analysisVersion: 'analysis-v1',
      settingsHash: 'settings',
      engineName: 'Stockfish',
      engineVersion: '18',
    },
  };
}

function ply({
  plyNumber,
  beforePositionId,
  afterPositionId,
  moveUci,
  moverColor,
  isUserMove,
  scoreLossCp = 0,
}) {
  return {
    plyNumber,
    beforePositionId,
    afterPositionId,
    moveUci,
    moverColor,
    isUserMove,
    sourceClockOrdinal: plyNumber - 1,
    sourceClockAfterCentiseconds: 5000,
    sourceClockSemantics: 'AFTER_MOVE',
    clockBeforeMoveCentiseconds: 5100,
    effectiveIncrementCentiseconds: 0,
    clockDeltaMoveTimeCentiseconds: 100,
    beforeClockProvenance: 'DERIVED',
    incrementProvenance: 'EXACT',
    timingDerivationVersion: 1,
    timingDerivationStatus: 'AVAILABLE',
    timingReliabilityFlags: [],
    timingUnavailableReason: null,
    engineAnalysisRunId: 11,
    scoreLossCp,
    classificationCode: scoreLossCp >= 180 ? 6 : 2,
  };
}

function sequenceSnapshot({
  creatingBeforeFen,
  creatingMove,
  beforeResponseFen,
  defensiveMove,
  playedResponse,
  afterResponseFen,
  exploitingReply,
  beforeResponseMateWhite = null,
  afterResponseMateWhite = null,
  scoreLossCp = 300,
  beforeResponseMultiPv,
}) {
  return {
    game: baseGame(),
    provenance: provenance(),
    positions: [
      {
        id: 100,
        normalizedFen: creatingBeforeFen,
        analysis: engineAnalysis({
          bestMove: creatingMove,
          scoreCpWhite: 0,
        }),
      },
      {
        id: 101,
        normalizedFen: beforeResponseFen,
        analysis: engineAnalysis({
          bestMove: defensiveMove,
          scoreCpWhite: 0,
          mateWhite: beforeResponseMateWhite,
          multiPv: beforeResponseMultiPv,
        }),
      },
      {
        id: 102,
        normalizedFen: afterResponseFen,
        analysis: engineAnalysis({
          bestMove: exploitingReply,
          scoreCpWhite: afterResponseMateWhite === null ? -300 : null,
          mateWhite: afterResponseMateWhite,
        }),
      },
    ],
    plies: [
      ply({
        plyNumber: 10,
        beforePositionId: 100,
        afterPositionId: 101,
        moveUci: creatingMove,
        moverColor: 'BLACK',
        isUserMove: false,
      }),
      ply({
        plyNumber: 11,
        beforePositionId: 101,
        afterPositionId: 102,
        moveUci: playedResponse,
        moverColor: 'WHITE',
        isUserMove: true,
        scoreLossCp,
      }),
    ],
  };
}

test('registers defensive threat evidence as complete-analysis evidence', () => {
  assert.equal(
    defensiveThreatEvidenceDetector.key,
    DEFENSIVE_THREAT_EVIDENCE_DETECTOR_KEY,
  );
  assert.equal(
    defensiveThreatEvidenceDetector.version,
    DEFENSIVE_THREAT_EVIDENCE_DETECTOR_VERSION,
  );
  assert.equal(defensiveThreatEvidenceDetector.requiresCompleteAnalysis, true);
  assert.equal(evidenceDetectors.includes(defensiveThreatEvidenceDetector), true);
});

test('records a quiet opponent move and failed response as back-rank threat blindness', () => {
  const result = detectDefensiveThreatEvidence(sequenceSnapshot({
    creatingBeforeFen: 'k7/4r3/8/8/8/8/P4PPP/6K1 b - -',
    creatingMove: 'e7e8',
    beforeResponseFen: 'k3r3/8/8/8/8/8/P4PPP/6K1 w - -',
    defensiveMove: 'h2h3',
    playedResponse: 'a2a3',
    afterResponseFen: 'k3r3/8/8/8/8/P7/5PPP/6K1 b - -',
    exploitingReply: 'e8e1',
    beforeResponseMateWhite: null,
    afterResponseMateWhite: -1,
    scoreLossCp: 500,
  }));

  assert.equal(result.coverage.status, 'COMPLETE');
  const backRank = result.findings.find(
    (finding) => finding.type === 'BACK_RANK_THREAT',
  );
  assert.ok(backRank);

  const blindness = result.findings.find(
    (finding) => finding.type === 'THREAT_BLINDNESS',
  );
  assert.ok(blindness);
  assert.equal(blindness.source.startPly, 10);
  assert.equal(blindness.source.endPly, 11);
  assert.equal(blindness.details.creatingMoveWasCapture, false);
  assert.equal(blindness.details.creatingMoveGaveCheck, false);
  assert.equal(blindness.details.defensiveMoveUci, 'h2h3');
  assert.equal(blindness.details.exploitingReplyUci, 'e8e1');
  assert.equal(
    blindness.details.mechanisms.some(
      (mechanism) => mechanism.kind === 'BACK_RANK_MATE',
    ),
    true,
  );
});

test('rejects a false back-rank pattern when the king retains an escape square', () => {
  const result = detectDefensiveThreatEvidence(sequenceSnapshot({
    creatingBeforeFen: 'k7/4r3/8/8/8/8/P4PP1/6K1 b - -',
    creatingMove: 'e7e8',
    beforeResponseFen: 'k3r3/8/8/8/8/8/P4PP1/6K1 w - -',
    defensiveMove: 'g2g3',
    playedResponse: 'a2a3',
    afterResponseFen: 'k3r3/8/8/8/8/P7/5PP1/6K1 b - -',
    exploitingReply: 'e8e1',
    beforeResponseMateWhite: null,
    afterResponseMateWhite: null,
    scoreLossCp: 300,
  }));

  assert.equal(
    result.findings.some((finding) => finding.type === 'BACK_RANK_THREAT'),
    false,
  );
  assert.equal(
    result.findings.some((finding) => finding.type === 'THREAT_BLINDNESS'),
    false,
  );
});

test('ties removal of a defender to the later engine exploitation of its target', () => {
  const result = detectDefensiveThreatEvidence(sequenceSnapshot({
    creatingBeforeFen: '4k3/8/8/qb6/8/8/P2N4/5RK1 b - -',
    creatingMove: 'a5d2',
    beforeResponseFen: '4k3/8/8/1b6/8/8/P2q4/5RK1 w - -',
    defensiveMove: 'f1f2',
    playedResponse: 'a2a3',
    afterResponseFen: '4k3/8/8/1b6/8/P7/3q4/5RK1 b - -',
    exploitingReply: 'b5f1',
    scoreLossCp: 320,
  }));

  const removal = result.findings.find(
    (finding) => finding.type === 'DEFENDER_REMOVAL_THREAT',
  );
  assert.ok(removal);
  assert.equal(removal.details.removedDefenderSquare, 'd2');
  assert.equal(removal.details.target.square, 'f1');

  const blindness = result.findings.find(
    (finding) => finding.type === 'THREAT_BLINDNESS',
  );
  assert.ok(blindness);
  assert.equal(
    blindness.details.mechanisms.some(
      (mechanism) => mechanism.kind === 'DEFENDER_REMOVAL',
    ),
    true,
  );
});

test('detects a newly created overload only when the engine reply exploits an overloaded target', () => {
  const result = detectDefensiveThreatEvidence(sequenceSnapshot({
    creatingBeforeFen: '1q2k3/8/8/1b6/8/5R2/P2N4/5RK1 b - -',
    creatingMove: 'b8a8',
    beforeResponseFen: 'q3k3/8/8/1b6/8/5R2/P2N4/5RK1 w - -',
    defensiveMove: 'f3f2',
    playedResponse: 'a2a3',
    afterResponseFen: 'q3k3/8/8/1b6/8/P4R2/3N4/5RK1 b - -',
    exploitingReply: 'a8f3',
    scoreLossCp: 300,
  }));

  const overload = result.findings.find(
    (finding) => finding.type === 'OVERLOADED_DEFENDER_THREAT',
  );
  assert.ok(overload);
  assert.equal(overload.details.defenderSquare, 'd2');
  assert.equal(overload.details.exploitedTarget.square, 'f3');
});

test('does not reclassify an existing overload when the opponent move only changes its target set', () => {
  const result = detectDefensiveThreatEvidence(sequenceSnapshot({
    creatingBeforeFen: 'q3k3/8/8/1b6/3n4/1P3R2/P2N4/5RK1 b - -',
    creatingMove: 'd4b3',
    beforeResponseFen: 'q3k3/8/8/1b6/8/1n3R2/P2N4/5RK1 w - -',
    defensiveMove: 'f3f2',
    playedResponse: 'a2a3',
    afterResponseFen: 'q3k3/8/8/1b6/8/Pn3R2/3N4/5RK1 b - -',
    exploitingReply: 'a8f3',
    scoreLossCp: 300,
  }));

  assert.equal(
    result.findings.some((finding) => finding.type === 'OVERLOADED_DEFENDER_THREAT'),
    false,
  );
  assert.equal(
    result.findings.some((finding) => finding.type === 'THREAT_BLINDNESS'),
    false,
  );
});

test('emits missed forced mate and the more specific back-rank subtype from mate-score transition', () => {
  const snapshot = {
    game: baseGame(),
    provenance: provenance(),
    positions: [
      {
        id: 201,
        normalizedFen: '6k1/5ppp/8/8/8/8/8/K3R3 w - -',
        analysis: engineAnalysis({
          bestMove: 'e1e8',
          scoreCpWhite: null,
          mateWhite: 1,
        }),
      },
      {
        id: 202,
        normalizedFen: '6k1/5ppp/8/8/8/8/8/1K2R3 b - -',
        analysis: engineAnalysis({
          bestMove: 'g8h8',
          scoreCpWhite: 0,
          mateWhite: null,
        }),
      },
    ],
    plies: [ply({
      plyNumber: 1,
      beforePositionId: 201,
      afterPositionId: 202,
      moveUci: 'a1b1',
      moverColor: 'WHITE',
      isUserMove: true,
      scoreLossCp: 1000,
    })],
  };

  const result = detectDefensiveThreatEvidence(snapshot);
  const missed = result.findings.find(
    (finding) => finding.type === 'MISSED_BACK_RANK_MATE',
  );
  assert.ok(missed);
  assert.equal(missed.details.bestMoveUci, 'e1e8');
  assert.equal(missed.details.immediateMate, true);
  assert.equal(missed.measurements.mateWhiteBefore, 1);
  assert.equal(missed.measurements.mateWhiteAfter, null);
});

test('does not promote sacrifice-like geometry without material engine consequence', () => {
  const result = detectDefensiveThreatEvidence(sequenceSnapshot({
    creatingBeforeFen: '4k3/8/8/qb6/8/8/P2N4/5RK1 b - -',
    creatingMove: 'a5d2',
    beforeResponseFen: '4k3/8/8/1b6/8/8/P2q4/5RK1 w - -',
    defensiveMove: 'f1f2',
    playedResponse: 'a2a3',
    afterResponseFen: '4k3/8/8/1b6/8/P7/3q4/5RK1 b - -',
    exploitingReply: 'b5f1',
    scoreLossCp: 20,
  }));

  assert.equal(
    result.findings.some((finding) => finding.type === 'DEFENDER_REMOVAL_THREAT'),
    false,
  );
  assert.equal(
    result.findings.some((finding) => finding.type === 'THREAT_BLINDNESS'),
    false,
  );
});

test('marks missing MultiPV defensive alternatives as incomplete instead of no finding', () => {
  const source = sequenceSnapshot({
    creatingBeforeFen: 'k7/4r3/8/8/8/8/P4PPP/6K1 b - -',
    creatingMove: 'e7e8',
    beforeResponseFen: 'k3r3/8/8/8/8/8/P4PPP/6K1 w - -',
    defensiveMove: 'h2h3',
    playedResponse: 'a2a3',
    afterResponseFen: 'k3r3/8/8/8/8/P7/5PPP/6K1 b - -',
    exploitingReply: 'e8e1',
    beforeResponseMateWhite: null,
    afterResponseMateWhite: -1,
    scoreLossCp: 500,
    beforeResponseMultiPv: [],
  });

  const result = detectDefensiveThreatEvidence(source);
  assert.equal(result.coverage.status, 'INCOMPLETE');
  assert.equal(result.coverage.reason, 'required-multipv-evidence-missing');
  assert.equal(
    result.findings.some((finding) => finding.type === 'THREAT_BLINDNESS'),
    false,
  );
  const gap = result.findings.find(
    (finding) => finding.type === 'DEFENSIVE_THREAT_COVERAGE_GAP',
  );
  assert.ok(gap);
  assert.equal(gap.availability, 'INCOMPLETE');
});
