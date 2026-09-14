import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceDetectors } from '../dist/modules/evidence/evidence.registry.js';
import {
  OPENING_BAD_POSITION_MAX_USER_CP,
  OPENING_EVIDENCE_DETECTOR_KEY,
  OPENING_EVIDENCE_DETECTOR_VERSION,
  OPENING_EVIDENCE_MAX_PLY,
  detectOpeningEvidence,
  openingEvidenceDetector,
} from '../dist/modules/evidence/opening-evidence.detector.js';
import {
  OPENING_RECURRENCE_MAX_CANDIDATE_GAMES,
  aggregateOpeningRecurrenceEvidence,
  getOpeningRecurrenceEvidence,
} from '../dist/modules/evidence/opening-recurrence.service.js';

const OPENING_FENS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -',
];

function analysis(cp) {
  return {
    depth: 18,
    scoreCpWhite: cp,
    mateWhite: null,
    bestMove: null,
    bestPv: [],
    multiPv: [],
  };
}

function snapshot({
  userColor = 'WHITE',
  speedCategory = 'bullet',
  evaluations = [0, -120, -120],
  missingBoundary = null,
} = {}) {
  const positions = OPENING_FENS.map((fen, index) => ({
    id: 100 + index,
    normalizedFen: fen,
    analysis: index === missingBoundary ? null : analysis(evaluations[index]),
  }));
  const plies = [
    {
      plyNumber: 1,
      beforePositionId: 100,
      afterPositionId: 101,
      moveUci: 'e2e4',
      moverColor: 'WHITE',
      isUserMove: userColor === 'WHITE',
      sourceClockOrdinal: null,
      sourceClockAfterCentiseconds: null,
      sourceClockSemantics: null,
      clockBeforeMoveCentiseconds: null,
      effectiveIncrementCentiseconds: null,
      clockDeltaMoveTimeCentiseconds: null,
      beforeClockProvenance: 'UNAVAILABLE',
      incrementProvenance: 'UNAVAILABLE',
      timingDerivationVersion: null,
      timingDerivationStatus: 'UNAVAILABLE',
      timingReliabilityFlags: [],
      timingUnavailableReason: null,
      engineAnalysisRunId: 7,
      scoreLossCp: userColor === 'WHITE' ? 120 : 0,
      classificationCode: userColor === 'WHITE' ? 5 : 2,
    },
    {
      plyNumber: 2,
      beforePositionId: 101,
      afterPositionId: 102,
      moveUci: 'e7e5',
      moverColor: 'BLACK',
      isUserMove: userColor === 'BLACK',
      sourceClockOrdinal: null,
      sourceClockAfterCentiseconds: null,
      sourceClockSemantics: null,
      clockBeforeMoveCentiseconds: null,
      effectiveIncrementCentiseconds: null,
      clockDeltaMoveTimeCentiseconds: null,
      beforeClockProvenance: 'UNAVAILABLE',
      incrementProvenance: 'UNAVAILABLE',
      timingDerivationVersion: null,
      timingDerivationStatus: 'UNAVAILABLE',
      timingReliabilityFlags: [],
      timingUnavailableReason: null,
      engineAnalysisRunId: 7,
      scoreLossCp: userColor === 'BLACK' ? 100 : 0,
      classificationCode: userColor === 'BLACK' ? 5 : 2,
    },
  ];
  return {
    game: {
      id: 9,
      appUserId: 3,
      provider: 'LICHESS',
      providerGameId: 'opening-fixture',
      userColor,
      resultForUser: 'LOSS',
      speedCategory,
      variant: 'standard',
      timeControlInitial: speedCategory === 'bullet' ? 60 : 180,
      timeControlIncrement: 0,
      exactTimeControlKey: speedCategory === 'bullet' ? '1+0' : '3+0',
      openingName: 'King Pawn Game',
      openingEco: 'C20',
    },
    provenance: {
      sourcePlyIndexedAt: new Date('2026-09-14T05:00:00.000Z'),
      plyIndexPolicyVersion: 1,
      clockAlignmentVersion: 1,
      timingDerivationVersion: 1,
      timingCoverageStatus: 'UNAVAILABLE',
      analysis: {
        runId: 7,
        snapshotId: 'opening-analysis',
        analysisVersion: 'analysis-v1',
        settingsHash: 'settings',
        engineName: 'Stockfish',
        engineVersion: '18',
      },
    },
    positions,
    plies,
  };
}

function sample({
  gameId,
  userColor = 'WHITE',
  positionId = 42,
  moveUci = 'g1f3',
  scoreLossCp = 80,
  kind = 'MOVE_QUALITY',
  userEvalCp = -120,
  speedCategory = 'bullet',
  openingName = 'Transposed opening',
  openingEco = 'A00',
}) {
  return {
    kind,
    importedGameId: gameId,
    providerGameId: 'game-' + gameId,
    userColor,
    speedCategory,
    plyNumber: userColor === 'WHITE' ? 5 : 6,
    positionId,
    moveUci,
    openingName,
    openingEco,
    scoreLossCp: kind === 'MOVE_QUALITY' ? scoreLossCp : null,
    userEvalCp: kind === 'BAD_POSITION_ENTRY' ? userEvalCp : 0,
  };
}

test('registers complete-analysis opening evidence and keeps bullet eligible', () => {
  assert.equal(openingEvidenceDetector.key, OPENING_EVIDENCE_DETECTOR_KEY);
  assert.equal(openingEvidenceDetector.version, OPENING_EVIDENCE_DETECTOR_VERSION);
  assert.equal(openingEvidenceDetector.requiresCompleteAnalysis, true);
  assert.equal(evidenceDetectors.includes(openingEvidenceDetector), true);
  assert.equal(OPENING_EVIDENCE_MAX_PLY, 20);
  assert.equal(OPENING_BAD_POSITION_MAX_USER_CP, -80);

  const result = detectOpeningEvidence(snapshot());
  assert.equal(result.coverage.status, 'COMPLETE');
  const move = result.findings.find(
    (finding) => finding.type === 'OPENING_MOVE_QUALITY_SAMPLE',
  );
  assert.ok(move);
  assert.equal(move.source.positionId, 100);
  assert.equal(move.measurements.scoreLossCp, 120);
  assert.equal(move.details.speedCategory, 'bullet');

  const entry = result.findings.find(
    (finding) => finding.type === 'OPENING_BAD_POSITION_ENTRY',
  );
  assert.ok(entry);
  assert.equal(entry.source.positionId, 101);
  assert.equal(entry.measurements.beforeUserEvalCp, 0);
  assert.equal(entry.measurements.afterUserEvalCp, -120);
  assert.equal(entry.details.thresholdEntry, true);
});

test('keeps opposite-color move evidence side-aware', () => {
  const result = detectOpeningEvidence(snapshot({
    userColor: 'BLACK',
    evaluations: [0, 20, 120],
  }));
  assert.equal(result.coverage.status, 'COMPLETE');
  const moves = result.findings.filter(
    (finding) => finding.type === 'OPENING_MOVE_QUALITY_SAMPLE',
  );
  assert.equal(moves.length, 1);
  assert.equal(moves[0].source.startPly, 2);
  assert.equal(moves[0].details.userColor, 'BLACK');
  assert.equal(moves[0].measurements.afterUserEvalCp, -120);
});

test('missing engine evidence is explicit incomplete coverage, not a negative opening result', () => {
  const result = detectOpeningEvidence(snapshot({ missingBoundary: 1 }));
  assert.equal(result.coverage.status, 'INCOMPLETE');
  assert.equal(
    result.findings.some(
      (finding) => finding.type === 'OPENING_EVIDENCE_COVERAGE_GAP',
    ),
    true,
  );
});

test('groups transposed opening labels by exact normalized position and move', () => {
  const samples = Array.from({ length: 5 }, (_, index) => sample({
    gameId: index + 1,
    openingName: index % 2 === 0 ? 'English Opening' : 'Réti Opening',
    openingEco: index % 2 === 0 ? 'A10' : 'A04',
    scoreLossCp: 70 + index * 10,
  }));
  const result = aggregateOpeningRecurrenceEvidence({
    eligibleGames: 5,
    analysedGames: 5,
    samples,
  });
  assert.equal(result.coverage.status, 'COMPLETE');
  const repeated = result.findings.find(
    (finding) => finding.type === 'REPEATED_EARLY_MOVE_ERROR',
  );
  assert.ok(repeated);
  assert.equal(repeated.measurements.distinctGames, 5);
  assert.equal(repeated.details.positionId, 42);
  assert.equal(repeated.details.moveUci, 'g1f3');
  assert.deepEqual(repeated.details.openingEcos, ['A04', 'A10']);
  assert.equal(repeated.details.supportingGames[0].speedCategory, 'bullet');
});

test('does not merge opposite colors into one recurring-position sample', () => {
  const samples = [
    ...Array.from({ length: 5 }, (_, index) => sample({
      gameId: index + 1,
      userColor: 'WHITE',
    })),
    ...Array.from({ length: 5 }, (_, index) => sample({
      gameId: index + 101,
      userColor: 'BLACK',
    })),
  ];
  const result = aggregateOpeningRecurrenceEvidence({
    eligibleGames: 10,
    analysedGames: 10,
    samples,
  });
  const repeated = result.findings.filter(
    (finding) => finding.type === 'REPEATED_EARLY_MOVE_ERROR',
  );
  assert.equal(repeated.length, 2);
  assert.deepEqual(
    repeated.map((finding) => finding.details.userColor).sort(),
    ['BLACK', 'WHITE'],
  );
});

test('sparse recurrence samples remain a complete no-finding result', () => {
  const result = aggregateOpeningRecurrenceEvidence({
    eligibleGames: 5,
    analysedGames: 5,
    samples: Array.from({ length: 4 }, (_, index) => sample({ gameId: index + 1 })),
  });
  assert.equal(result.coverage.status, 'COMPLETE');
  assert.deepEqual(result.findings, []);
});

test('recurring bad positions use exact threshold-entry position identity', () => {
  const result = aggregateOpeningRecurrenceEvidence({
    eligibleGames: 5,
    analysedGames: 5,
    samples: Array.from({ length: 5 }, (_, index) => sample({
      gameId: index + 1,
      kind: 'BAD_POSITION_ENTRY',
      positionId: 77,
      userEvalCp: -100 - index * 10,
      openingName: index % 2 ? 'Transposition A' : 'Transposition B',
    })),
  });
  const bad = result.findings.find(
    (finding) => finding.type === 'RECURRING_BAD_OPENING_POSITION',
  );
  assert.ok(bad);
  assert.equal(bad.details.positionId, 77);
  assert.equal(bad.measurements.distinctGames, 5);
  assert.equal(bad.measurements.averageUserEvalCp, -120);
});

test('insufficient analysed coverage cannot become a false negative recurrence result', () => {
  const tooFew = aggregateOpeningRecurrenceEvidence({
    eligibleGames: 12,
    analysedGames: 4,
    samples: [],
  });
  assert.equal(tooFew.coverage.status, 'UNAVAILABLE');
  assert.equal(tooFew.coverage.reason, 'insufficient-analysed-games');

  const lowCoverage = aggregateOpeningRecurrenceEvidence({
    eligibleGames: 20,
    analysedGames: 8,
    samples: [],
  });
  assert.equal(lowCoverage.coverage.status, 'INCOMPLETE');
  assert.equal(lowCoverage.coverage.reason, 'insufficient-analysis-coverage');
});

test('scope safety rejects over-broad history before loading evidence rows', async () => {
  let loaded = false;
  const result = await getOpeningRecurrenceEvidence(1, {
    countEligibleGames: async () => OPENING_RECURRENCE_MAX_CANDIDATE_GAMES + 1,
    countAnalysedEvidenceGames: async () => {
      throw new Error('must not count analysed evidence for rejected scope');
    },
    loadCurrentSamples: async () => {
      loaded = true;
      return [];
    },
  });
  assert.equal(result.coverage.status, 'UNAVAILABLE');
  assert.equal(result.coverage.reason, 'opening-recurrence-scope-too-large');
  assert.equal(loaded, false);
});
