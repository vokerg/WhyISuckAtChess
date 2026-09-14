import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceDetectors } from '../dist/modules/evidence/evidence.registry.js';
import {
  CONVERSION_EVIDENCE_DETECTOR_KEY,
  CONVERSION_EVIDENCE_DETECTOR_VERSION,
  CONVERSION_LOSING_MAX_CP,
  CONVERSION_WINNING_MIN_CP,
  conversionEvidenceDetector,
  detectConversionEvidence,
} from '../dist/modules/evidence/conversion-evidence.detector.js';

function engineAnalysis({ cp = null, mate = null }) {
  return {
    depth: 18,
    scoreCpWhite: cp,
    mateWhite: mate,
    bestMove: null,
    bestPv: [],
    multiPv: [],
  };
}

function endgameFen(boundaryPly) {
  const active = boundaryPly % 2 === 0 ? 'w' : 'b';
  return `8/8/8/3k4/8/4K3/4P3/8 ${active} - -`;
}

function snapshot({
  evaluations,
  userColor = 'WHITE',
  missingAnalysisBoundaries = [],
  speedCategory = 'bullet',
}) {
  const positions = evaluations.map((evaluation, boundaryPly) => ({
    id: 100 + boundaryPly,
    normalizedFen: endgameFen(boundaryPly),
    analysis: missingAnalysisBoundaries.includes(boundaryPly)
      ? null
      : engineAnalysis(evaluation),
  }));

  const plies = evaluations.slice(1).map((_, index) => {
    const plyNumber = index + 1;
    const moverColor = plyNumber % 2 === 1 ? 'WHITE' : 'BLACK';
    return {
      plyNumber,
      beforePositionId: positions[index].id,
      afterPositionId: positions[index + 1].id,
      moveUci: moverColor === 'WHITE' ? 'e3e4' : 'd5d4',
      moverColor,
      isUserMove: moverColor === userColor,
      sourceClockOrdinal: index,
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
      scoreLossCp: 0,
      classificationCode: 2,
    };
  });

  return {
    game: {
      id: 32,
      appUserId: 3,
      provider: 'LICHESS',
      providerGameId: 'conversion-fixture',
      userColor,
      resultForUser: 'DRAW',
      speedCategory,
      variant: 'standard',
      timeControlInitial: speedCategory === 'bullet' ? 60 : 180,
      timeControlIncrement: 0,
      exactTimeControlKey: speedCategory === 'bullet' ? '1+0' : '3+0',
      openingName: null,
      openingEco: null,
    },
    provenance: {
      sourcePlyIndexedAt: new Date('2026-09-14T06:00:00.000Z'),
      plyIndexPolicyVersion: 1,
      clockAlignmentVersion: 1,
      timingDerivationVersion: 1,
      timingCoverageStatus: 'COMPLETE',
      analysis: {
        runId: 11,
        snapshotId: 'conversion-analysis',
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

function finding(result, type) {
  return result.findings.find((candidate) => candidate.type === type);
}

test('registers complete-analysis conversion evidence with explicit v1 bands', () => {
  assert.equal(conversionEvidenceDetector.key, CONVERSION_EVIDENCE_DETECTOR_KEY);
  assert.equal(
    conversionEvidenceDetector.version,
    CONVERSION_EVIDENCE_DETECTOR_VERSION,
  );
  assert.equal(conversionEvidenceDetector.requiresCompleteAnalysis, true);
  assert.equal(evidenceDetectors.includes(conversionEvidenceDetector), true);
  assert.equal(CONVERSION_WINNING_MIN_CP, 700);
  assert.equal(CONVERSION_LOSING_MAX_CP, -700);
});

test('compacts a gradual winning-to-losing collapse into one decisive throw', () => {
  const result = detectConversionEvidence(snapshot({
    evaluations: [
      { cp: 900 },
      { cp: 500 },
      { cp: 400 },
      { cp: -900 },
    ],
  }));

  assert.equal(result.coverage.status, 'COMPLETE');
  assert.equal(
    result.findings.filter((candidate) => candidate.type === 'EVALUATION_THROW').length,
    1,
  );
  assert.equal(
    result.findings.some((candidate) => candidate.type === 'FAILED_CONVERSION'),
    false,
  );

  const thrown = finding(result, 'EVALUATION_THROW');
  assert.ok(thrown);
  assert.equal(thrown.source.startPly, 1);
  assert.equal(thrown.source.endPly, 3);
  assert.equal(thrown.details.fromState, 'WINNING');
  assert.equal(thrown.details.toState, 'LOSING');
  assert.equal(thrown.details.severity, 'DECISIVE');
  assert.equal(thrown.details.traversedDrawableBand, true);
  assert.equal(thrown.details.startPhase, 'ENDGAME');
  assert.equal(thrown.details.startEndgameFamily, 'PAWN');
  assert.equal(thrown.measurements.scoreCpSwingForUser, -1800);
});

test('emits a one-move throw without duplicating intermediate transition evidence', () => {
  const result = detectConversionEvidence(snapshot({
    evaluations: [{ cp: 800 }, { cp: -800 }],
  }));

  const thrown = finding(result, 'EVALUATION_THROW');
  assert.ok(thrown);
  assert.equal(thrown.source.startPly, 1);
  assert.equal(thrown.source.endPly, 1);
  assert.equal(thrown.measurements.severityLevel, 2);
  assert.equal(thrown.details.transitionPly, 1);
  assert.equal(thrown.details.transitionIsUserMove, true);
});

test('emits a failed conversion when a user move loses the winning band but not the game state', () => {
  const result = detectConversionEvidence(snapshot({
    evaluations: [{ cp: 850 }, { cp: 250 }],
  }));

  const failed = finding(result, 'FAILED_CONVERSION');
  assert.ok(failed);
  assert.equal(failed.details.fromState, 'WINNING');
  assert.equal(failed.details.toState, 'DRAWABLE');
  assert.equal(failed.details.severity, 'MAJOR');
  assert.equal(failed.details.endPhase, 'ENDGAME');
  assert.equal(failed.details.endEndgameFamily, 'PAWN');
});

test('mate states override centipawns and preserve mate measurements', () => {
  const result = detectConversionEvidence(snapshot({
    evaluations: [
      { cp: -2000, mate: 3 },
      { cp: 2000, mate: -2 },
    ],
  }));

  const thrown = finding(result, 'EVALUATION_THROW');
  assert.ok(thrown);
  assert.equal(thrown.details.fromState, 'WINNING');
  assert.equal(thrown.details.toState, 'LOSING');
  assert.equal(thrown.measurements.mateForUserStart, 3);
  assert.equal(thrown.measurements.mateForUserEnd, -2);
  assert.equal(thrown.measurements.mateWhiteStart, 3);
  assert.equal(thrown.measurements.mateWhiteEnd, -2);
});

test('normalizes mate perspective correctly for a black-user save', () => {
  const result = detectConversionEvidence(snapshot({
    userColor: 'BLACK',
    evaluations: [
      { mate: 3 },
      { mate: 3 },
      { cp: 0 },
    ],
  }));

  const saved = finding(result, 'EVALUATION_SAVE');
  assert.ok(saved);
  assert.equal(saved.details.fromState, 'LOSING');
  assert.equal(saved.details.toState, 'DRAWABLE');
  assert.equal(saved.details.transitionPly, 2);
  assert.equal(saved.details.transitionMoverColor, 'BLACK');
  assert.equal(saved.measurements.mateForUserStart, -3);
  assert.equal(saved.measurements.mateWhiteStart, 3);
});

test('requires the user to preserve an opponent-created recovery before calling it a save', () => {
  const result = detectConversionEvidence(snapshot({
    evaluations: [
      { cp: -900 },
      { cp: -850 },
      { cp: -100 },
      { cp: -50 },
    ],
  }));

  const saved = finding(result, 'EVALUATION_SAVE');
  assert.ok(saved);
  assert.equal(saved.source.startPly, 1);
  assert.equal(saved.source.endPly, 3);
  assert.equal(saved.details.recoveryCreatedPly, 2);
  assert.equal(saved.details.recoveryCreatedByUser, false);
  assert.equal(saved.details.confirmationPly, 3);
});

test('does not call an opponent gift a save when the user immediately falls back to losing', () => {
  const result = detectConversionEvidence(snapshot({
    evaluations: [
      { cp: -900 },
      { cp: -850 },
      { cp: -100 },
      { cp: -900 },
    ],
  }));

  assert.equal(
    result.findings.some((candidate) => candidate.type === 'EVALUATION_SAVE'),
    false,
  );
});

test('breaks trajectories across missing engine evidence and reports incomplete coverage', () => {
  const result = detectConversionEvidence(snapshot({
    evaluations: [
      { cp: 0 },
      { cp: -200 },
      { cp: -900 },
    ],
    missingAnalysisBoundaries: [1],
  }));

  assert.equal(result.coverage.status, 'INCOMPLETE');
  assert.equal(result.coverage.reason, 'required-engine-evidence-missing');
  assert.equal(
    result.findings.some((candidate) => candidate.type === 'EVALUATION_THROW'),
    false,
  );

  const gap = finding(result, 'CONVERSION_EVIDENCE_COVERAGE_GAP');
  assert.ok(gap);
  assert.equal(gap.availability, 'INCOMPLETE');
  assert.equal(gap.measurements.analysisGapCount, 1);
  assert.deepEqual(gap.details.analysisGapBoundaries, [1]);
});
