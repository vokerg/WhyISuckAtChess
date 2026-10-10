import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { reconstructPgnPlies } from '@why-i-suck-at-chess/chess-domain';
import { detectTacticalMotifEvidence } from '../dist/modules/evidence/tactical-motif-evidence.detector.js';
import { buildTimePressureExposureAggregate } from '../dist/modules/diagnosis/time-pressure-exposure.service.js';
import { projectDiagnosisCandidates } from '../dist/modules/diagnosis/diagnosis-candidate.registry.js';
import { TIMING_DERIVATION_VERSION } from '../dist/modules/timing/timing-policy.js';
import { TIME_BEHAVIOR_POLICY_VERSION } from '../dist/modules/timing/time-behavior-policy.js';

const corpus = JSON.parse(readFileSync(
  new URL('./fixtures/phase-7-gold-corpus.v1.json', import.meta.url),
  'utf8',
));

function fullFen(fen) {
  const fields = fen.split(/\s+/);
  assert.equal(fields.length, 4, 'position fixtures use normalized four-field FEN');
  return fen + ' 0 1';
}

function legalPositionMove(source) {
  const pgn = [
    '[Event "Synthetic gold position"]',
    '[SetUp "1"]',
    '[FEN "' + fullFen(source.beforeFen) + '"]',
    '[Result "*"]',
    '',
    '1. ' + source.playedSan + ' *',
  ].join('\n');
  const plies = reconstructPgnPlies(pgn);
  assert.equal(plies.length, 1, 'a gold position must contain exactly one legal move');
  assert.equal(plies[0].moveUci, source.playedUci);
  assert.equal(plies[0].beforeNormalizedFen, source.beforeFen);
  assert.equal(plies[0].afterNormalizedFen, source.afterFen);
  return plies[0];
}

function engineAnalysis(bestMoveUci, depth) {
  return {
    depth,
    scoreCpWhite: 0,
    mateWhite: null,
    bestMove: bestMoveUci,
    bestPv: bestMoveUci ? [bestMoveUci] : [],
    multiPv: [],
  };
}

function tacticalSnapshot(entry) {
  legalPositionMove(entry.source);
  const g = entry.gameContext;
  const e = entry.engine;
  assert.equal(e.provenance, 'DETERMINISTIC_TEST_DOUBLE');
  const hasRun = e.state !== 'NONE';
  const before = hasRun ? engineAnalysis(e.beforeBestMoveUci, e.depth) : null;
  const after = e.state === 'COMPLETE' ? engineAnalysis(e.afterBestMoveUci, e.depth) : null;
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
        runId: 1, snapshotId: entry.id, analysisVersion: e.version,
        settingsHash: 'synthetic-no-stockfish', engineName: 'GoldCorpusDouble',
        engineVersion: 'test-only',
      } : null,
    },
    positions: [
      { id: 101, normalizedFen: entry.source.beforeFen, analysis: before },
      { id: 102, normalizedFen: entry.source.afterFen, analysis: after },
    ],
    plies: [{
      plyNumber: 1, beforePositionId: 101, afterPositionId: 102,
      moveUci: entry.source.playedUci, moverColor: g.userColor, isUserMove: true,
      sourceClockOrdinal: null, sourceClockAfterCentiseconds: null,
      sourceClockSemantics: null, clockBeforeMoveCentiseconds: null,
      effectiveIncrementCentiseconds: null, clockDeltaMoveTimeCentiseconds: null,
      beforeClockProvenance: 'UNAVAILABLE', incrementProvenance: 'UNAVAILABLE',
      timingDerivationVersion: TIMING_DERIVATION_VERSION,
      timingDerivationStatus: 'UNAVAILABLE', timingReliabilityFlags: [],
      timingUnavailableReason: 'SYNTHETIC_POSITION',
      engineAnalysisRunId: hasRun ? 1 : null,
      scoreLossCp: hasRun ? e.scoreLossCp : null,
      classificationCode: e.scoreLossCp !== null && e.scoreLossCp >= 180 ? 6 : 2,
    }],
  };
}

function sameLabel(actual, expected) {
  return actual.type === expected.type
    && actual.details?.motif === expected.motif
    && actual.details?.motifState === expected.motifState;
}

function verifyTactical(entry) {
  const result = detectTacticalMotifEvidence(tacticalSnapshot(entry));
  const observed = {
    coverage: result.coverage.status,
    reason: result.coverage.reason,
    required: entry.expected.required.map((label) => result.findings.some(
      (finding) => sameLabel(finding, label),
    )),
    forbidden: entry.expected.forbidden.map((label) => result.findings.some(
      (finding) => sameLabel(finding, label),
    )),
  };
  // On failure, Node's deep-equal diff contains the case's observed-vs-expected result.
  assert.deepEqual(observed, {
    coverage: entry.expected.coverage,
    reason: entry.expected.reason,
    required: entry.expected.required.map(() => true),
    forbidden: entry.expected.forbidden.map(() => false),
  }, entry.id + ': detector diverged from the versioned expectation');
  if (entry.expected.coverage === 'UNAVAILABLE' || entry.expected.coverage === 'INCOMPLETE') {
    assert.ok(result.findings.some((f) => f.type === 'TACTICAL_MOTIF_COVERAGE_GAP'));
  }
}

function validateClockFacts(game, plies) {
  assert.equal(game.clockSource, 'SYNTHETIC_POST_MOVE');
  assert.equal(game.afterMoveClocksCentiseconds.length, plies.length,
    game.fixtureGameId + ': one synthetic source-clock slot per ply is required');
  const present = game.afterMoveClocksCentiseconds.filter((clock) => clock !== null).length;
  if (game.clockStatus === 'COMPLETE') assert.equal(present, plies.length);
  else if (game.clockStatus === 'ABSENT') assert.equal(present, 0);
  else if (game.clockStatus === 'PARTIAL') {
    assert.ok(present > 0 && present < plies.length);
  } else assert.fail('Unknown synthetic clock status');
  for (const clock of game.afterMoveClocksCentiseconds) {
    assert.ok(clock === null || (Number.isSafeInteger(clock) && clock >= 0));
  }
}

function timingSourceGame(game) {
  const plies = reconstructPgnPlies(game.pgn);
  assert.equal(plies.length, 8, 'v1 recorded game must have eight legal plies');
  validateClockFacts(game, plies);
  assert.equal(game.timingDerivationVersion, TIMING_DERIVATION_VERSION,
    'timing policy drift requires an explicit corpus review/version bump');
  assert.equal(game.exactTimeControlKey, game.initialSeconds + '+' + game.incrementSeconds);
  const userMoves = plies.filter((ply) => ply.moverColor === game.userColor && ply.plyNumber > 2)
    .map((ply) => {
      // For this synthetic fixture only: after-move source clock on the
      // immediately previous same-side ply is the next before-move clock.
      // Increment/time-spent are deliberately not invented.
      const previousSameSide = game.afterMoveClocksCentiseconds[ply.plyNumber - 3];
      return {
        plyNumber: ply.plyNumber,
        clockBeforeMoveCentiseconds: previousSameSide,
        timingDerivationVersion: TIMING_DERIVATION_VERSION,
        timingDerivationStatus: previousSameSide === null ? 'UNAVAILABLE' : 'AVAILABLE',
        timingReliabilityFlags: [],
        phase: game.fixturePhaseByPly[String(ply.plyNumber)] ?? null,
      };
    });
  return {
    importedGameId: game.fixtureGameId, variant: game.variant,
    speedCategory: game.speedCategory, exactTimeControlKey: game.exactTimeControlKey,
    timeControlInitial: game.initialSeconds, timeControlIncrement: game.incrementSeconds,
    timingDerivationVersion: game.timingDerivationVersion, userMoves,
  };
}

function verifyTiming(entry) {
  assert.equal(entry.policyVersions.timeBehavior, TIME_BEHAVIOR_POLICY_VERSION,
    'time-behavior policy drift requires corpus review');
  assert.equal(entry.policyVersions.timingDerivation, TIMING_DERIVATION_VERSION);
  const result = buildTimePressureExposureAggregate(entry.source.games.map(timingSourceGame));
  const observed = {
    status: result.coverage.status,
    reason: result.coverage.reason,
    candidateGames: result.coverage.candidateGames,
    eligibleGames: result.coverage.eligibleGames,
    coveredGames: result.coverage.timingCoveredGames,
    pressureMoves: result.exposure.pressureMoves,
    eligibleUserDecisions: result.exposure.eligibleUserDecisions,
    firstPressurePly: result.exposure.firstEntry.earliestPly,
    criticalMoves: result.exposure.bands.CRITICAL.moves,
    contextKeys: result.contextBreakdown.map((row) => row.exactTimeControlKey),
    excludedUnreliable: result.coverage.excludedByReason.USER_TIMING_INCOMPLETE_OR_UNRELIABLE,
  };
  assert.deepEqual(observed, entry.expected, entry.id + ': aggregate differs from gold expectation');
  // A single observed incidence is exposure, not support for a causal diagnosis.
  assert.equal(result.diagnosisId, 'TIME-001');
  assert.equal(result.exposure.evidenceStrength, 'INSUFFICIENT');
}

function pressureQualitySource(entry) {
  const source = entry.source;
  const coverage = source.requiredCoveragePercent;
  const delta = source.averageScoreLossDeltaCp;
  return {
    diagnosisId: 'TIME-002',
    policyVersion: 'time-pressure-quality-collapse-v1',
    timeBehaviorPolicyVersion: TIME_BEHAVIOR_POLICY_VERSION,
    timingDerivationVersion: TIMING_DERIVATION_VERSION,
    coverage: {
      status: source.coverageStatus,
      reason: source.coverageStatus === 'COMPLETE' ? null : 'synthetic-partial-coverage',
      candidateGames: 12, timingEligibleGames: 12,
      timingCoveragePercent: 100, analysisCoveragePercent: coverage,
    },
    comparison: {
      baseline: {
        eligibleMoves: 40, eligibleGames: 8, analysedMoves: 40,
        supportingGames: 8, requiredEvidenceCoveragePercent: coverage,
        averageScoreLossCp: 20,
      },
      pressure: {
        eligibleMoves: 40, eligibleGames: 8, analysedMoves: 40,
        supportingGames: 8, requiredEvidenceCoveragePercent: coverage,
        averageScoreLossCp: 20 + delta,
      },
      averageScoreLossDeltaCp: delta,
      majorErrorRateDeltaPercent: delta > 0 ? 10 : 0,
      blunderRateDeltaPercent: delta > 0 ? 5 : 0,
      evidenceStrength: source.evidenceStrength,
    },
    strata: [],
    analysisProvenance: {
      requirement: 'CURRENT_COMPLETE_SOURCE_SNAPSHOT',
      analysedRuns: 8, snapshotIds: ['synthetic-gold-v1'],
      analysisVersions: ['analysis-fixture-v1'], settingsHashes: ['fixture'],
      engines: [{ name: 'GoldCorpusDouble', version: 'test-only' }],
    },
    ratingComposition: { status: 'UNAVAILABLE', reason: 'no-comparable-arms', result: null },
    caveats: ['Synthetic aggregate for policy contract testing, not calibrated evidence.'],
  };
}

function verifyProjection(entry) {
  assert.equal(entry.policyVersions.projection, 'diagnosis-candidate-projection-v1');
  const [finding] = projectDiagnosisCandidates('timePressureQualityCollapse', pressureQualitySource(entry));
  assert.ok(finding, 'TIME-002 candidate must be supported by the registered projection');
  assert.deepEqual({
    diagnosisId: finding.diagnosisId,
    observationState: finding.observationState,
    requiredEvidenceCoverage: finding.requiredEvidenceCoverage,
  }, entry.expected, entry.id + ': candidate state differs from gold expectation');
}

test('Phase 7 gold corpus schema, provenance, and coverage are explicit', () => {
  assert.equal(corpus.schemaVersion, 'phase-7-gold-corpus-v1');
  assert.equal(corpus.domainReviewStatus, 'PENDING');
  assert.equal(corpus.cases.length, 14);
  const ids = new Set();
  const kinds = new Set();
  const families = new Set();
  for (const entry of corpus.cases) {
    assert.match(entry.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(!ids.has(entry.id), 'duplicate fixture identity: ' + entry.id);
    ids.add(entry.id);
    kinds.add(entry.caseKind);
    families.add(entry.family);
    assert.equal(entry.review.status, 'PENDING_DOMAIN_REVIEW');
    assert.equal(entry.review.confidence, 'UNASSESSED');
    assert.ok(entry.review.note.length > 20);
    assert.ok(entry.expected);
    assert.ok(entry.source.kind.startsWith('SYNTHETIC_'));
    if (entry.family === 'TACTICAL_MOTIF') assert.equal(entry.engine.provenance, 'DETERMINISTIC_TEST_DOUBLE');
    if (entry.family === 'TIME_PRESSURE_EXPOSURE') {
      assert.ok(entry.source.games.every((game) => game.clockSource === 'SYNTHETIC_POST_MOVE'));
    }
  }
  for (const family of ['TACTICAL_MOTIF', 'TIME_PRESSURE_EXPOSURE', 'DIAGNOSIS_PROJECTION']) {
    assert.ok(families.has(family), family + ' has no cases');
  }
  for (const kind of ['POSITIVE', 'NEGATIVE', 'AMBIGUOUS', 'UNAVAILABLE', 'INCOMPLETE']) {
    assert.ok(kinds.has(kind), kind + ' has no cases');
  }
});

test('Phase 7 corpus reproduces each case with an observed/expected diff on failure', async (t) => {
  for (const entry of corpus.cases) {
    await t.test(entry.id + ' [' + entry.caseKind + ']', () => {
      if (entry.family === 'TACTICAL_MOTIF') verifyTactical(entry);
      else if (entry.family === 'TIME_PRESSURE_EXPOSURE') verifyTiming(entry);
      else if (entry.family === 'DIAGNOSIS_PROJECTION') verifyProjection(entry);
      else assert.fail('Unregistered corpus family: ' + entry.family);
    });
  }
});
