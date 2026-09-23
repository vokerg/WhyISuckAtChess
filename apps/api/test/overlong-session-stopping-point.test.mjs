import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOverlongSessionStoppingPointAggregate,
  getOverlongSessionStoppingPoint,
  OVERLONG_SESSION_CANDIDATE_THRESHOLDS,
  OVERLONG_SESSION_STOPPING_POINT_POLICY_VERSION,
} from '../dist/modules/diagnosis/overlong-session-stopping-point.service.js';
import { sessionizeGames } from '../dist/modules/sessions/sessionization.service.js';

function sourceGame(id, start) {
  const startedAt = new Date(start);
  return {
    importedGameId: id,
    startedAt,
    endedAt: new Date(startedAt.getTime() + 5 * 60 * 1000),
    resultForUser: 'DRAW',
  };
}

function quality(
  importedGameId,
  averageScoreLossCp,
  exactTimeControlKey = '3+0',
  analysedUserMoves = 10,
  majorErrorMoves = 0,
  blunderMoves = 0,
) {
  return {
    importedGameId,
    exactTimeControlKey,
    analysedUserMoves,
    averageScoreLossCp,
    majorErrorMoves,
    blunderMoves,
  };
}

function addSession(games, rows, idRef, dayOffset, length, options = {}) {
  const base = Date.parse('2026-09-01T10:00:00Z') + dayOffset * 24 * 60 * 60 * 1000;
  for (let ordinal = 1; ordinal <= length; ordinal += 1) {
    const id = idRef.value++;
    games.push(sourceGame(
      id,
      new Date(base + (ordinal - 1) * 10 * 60 * 1000).toISOString(),
    ));

    const analysed = options.analysed ? options.analysed(ordinal) : true;
    rows.push(quality(
      id,
      analysed ? (options.scoreLoss ? options.scoreLoss(ordinal) : 20) : null,
      options.control ? options.control(ordinal) : '3+0',
      analysed ? 10 : 0,
      analysed && options.majorErrors ? options.majorErrors(ordinal) : 0,
      analysed && options.blunders ? options.blunders(ordinal) : 0,
    ));
  }
}

function candidate(result, threshold) {
  return result.candidates.find((item) => item.threshold === threshold);
}

test('selects the earliest stable threshold with repeated broad deterioration across sessions', () => {
  const games = [];
  const rows = [];
  const idRef = { value: 1 };

  for (let session = 0; session < 5; session += 1) {
    addSession(games, rows, idRef, session, 6, {
      scoreLoss: (ordinal) => ordinal === 6 ? 38 : 20,
      majorErrors: (ordinal) => ordinal === 6 ? 1 : 0,
      blunders: (ordinal) => ordinal === 6 ? 1 : 0,
    });
  }

  const result = buildOverlongSessionStoppingPointAggregate(sessionizeGames(games), rows);
  const threshold5 = candidate(result, 5);
  const threshold6 = candidate(result, 6);

  assert.equal(result.diagnosisId, 'SESSION-003');
  assert.equal(result.policyVersion, OVERLONG_SESSION_STOPPING_POINT_POLICY_VERSION);
  assert.deepEqual(result.candidateThresholds, [...OVERLONG_SESSION_CANDIDATE_THRESHOLDS]);
  assert.equal(result.selectedThreshold, 6);
  assert.equal(result.coverage.status, 'COMPLETE');

  assert.equal(threshold5.comparison.broadDeterioration, false);
  assert.equal(threshold5.comparison.supported, false);

  assert.equal(threshold6.coverage.sessionsReachingThreshold, 5);
  assert.equal(threshold6.coverage.comparableSessions, 5);
  assert.equal(threshold6.coverage.analysedComparableSessions, 5);
  assert.equal(threshold6.comparison.preThreshold.analysisCoveragePercent, 100);
  assert.equal(threshold6.comparison.thresholdAndLater.analysisCoveragePercent, 100);
  assert.equal(threshold6.comparison.averageScoreLossDeltaCp, 18);
  assert.equal(threshold6.comparison.majorErrorRateDeltaPercent, 10);
  assert.equal(threshold6.comparison.blunderRateDeltaPercent, 10);
  assert.equal(threshold6.comparison.deterioratingSessions, 5);
  assert.equal(threshold6.comparison.recurrencePercent, 100);
  assert.equal(threshold6.comparison.evidenceStrength, 'LOW');
  assert.equal(threshold6.comparison.supported, true);
});

test('fewer than five comparable sessions cannot establish a stopping point', () => {
  const games = [];
  const rows = [];
  const idRef = { value: 100 };

  for (let session = 0; session < 4; session += 1) {
    addSession(games, rows, idRef, session, 6, {
      scoreLoss: (ordinal) => ordinal === 6 ? 60 : 20,
      majorErrors: (ordinal) => ordinal === 6 ? 2 : 0,
      blunders: (ordinal) => ordinal === 6 ? 1 : 0,
    });
  }

  const result = buildOverlongSessionStoppingPointAggregate(sessionizeGames(games), rows);
  const threshold6 = candidate(result, 6);

  assert.equal(result.selectedThreshold, null);
  assert.equal(threshold6.coverage.analysedComparableSessions, 4);
  assert.equal(threshold6.comparison.recurrencePercent, 100);
  assert.equal(threshold6.comparison.evidenceStrength, 'INSUFFICIENT');
  assert.equal(threshold6.comparison.supported, false);
});

test('one marathon session cannot establish a stable stopping point', () => {
  const games = [];
  const rows = [];
  const idRef = { value: 200 };

  addSession(games, rows, idRef, 0, 10, {
    scoreLoss: (ordinal) => ordinal >= 4 ? 80 : 20,
    majorErrors: (ordinal) => ordinal >= 4 ? 3 : 0,
    blunders: (ordinal) => ordinal >= 4 ? 2 : 0,
  });

  const result = buildOverlongSessionStoppingPointAggregate(sessionizeGames(games), rows);
  const threshold4 = candidate(result, 4);

  assert.equal(result.selectedThreshold, null);
  assert.equal(threshold4.coverage.comparableSessions, 1);
  assert.equal(threshold4.coverage.analysedComparableSessions, 1);
  assert.equal(threshold4.comparison.broadDeterioration, true);
  assert.equal(threshold4.comparison.evidenceStrength, 'INSUFFICIENT');
  assert.equal(threshold4.comparison.supported, false);
});

test('exact controls are matched inside each session rather than pooled across incompatible arms', () => {
  const games = [];
  const rows = [];
  const idRef = { value: 300 };

  for (let session = 0; session < 5; session += 1) {
    addSession(games, rows, idRef, session, 6, {
      control: (ordinal) => ordinal < 4 ? '3+0' : '3+2',
      scoreLoss: () => 20,
    });
  }

  const result = buildOverlongSessionStoppingPointAggregate(sessionizeGames(games), rows);
  const threshold4 = candidate(result, 4);

  assert.equal(result.selectedThreshold, null);
  assert.equal(threshold4.coverage.status, 'UNAVAILABLE');
  assert.equal(threshold4.coverage.reason, 'no-matched-session-control-strata');
  assert.equal(threshold4.coverage.comparableSessions, 0);
  assert.equal(threshold4.coverage.matchedPreThresholdGames, 0);
  assert.equal(threshold4.coverage.matchedThresholdAndLaterGames, 0);
});

test('per-arm analysis coverage below fifty percent prevents support and remains explicit', () => {
  const games = [];
  const rows = [];
  const idRef = { value: 400 };

  for (let session = 0; session < 5; session += 1) {
    addSession(games, rows, idRef, session, 6, {
      scoreLoss: (ordinal) => ordinal === 6 ? 60 : 20,
      majorErrors: (ordinal) => ordinal === 6 ? 2 : 0,
      blunders: (ordinal) => ordinal === 6 ? 1 : 0,
      analysed: (ordinal) => ordinal !== 6 || session < 2,
    });
  }

  const result = buildOverlongSessionStoppingPointAggregate(sessionizeGames(games), rows);
  const threshold6 = candidate(result, 6);

  assert.equal(result.selectedThreshold, null);
  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.reason, 'engine-analysis-incomplete');
  assert.equal(threshold6.coverage.status, 'PARTIAL');
  assert.equal(threshold6.coverage.reason, 'engine-analysis-incomplete');
  assert.equal(threshold6.comparison.thresholdAndLater.analysisCoveragePercent, 40);
  assert.equal(threshold6.coverage.analysedComparableSessions, 2);
  assert.equal(threshold6.comparison.evidenceStrength, 'INSUFFICIENT');
  assert.equal(threshold6.comparison.supported, false);
});

test('neutral or noisy later games do not manufacture a stopping point', () => {
  const games = [];
  const rows = [];
  const idRef = { value: 500 };

  for (let session = 0; session < 10; session += 1) {
    addSession(games, rows, idRef, session, 6, {
      scoreLoss: (ordinal) => ordinal === 6 ? 25 : 20,
      majorErrors: () => 0,
      blunders: () => 0,
    });
  }

  const result = buildOverlongSessionStoppingPointAggregate(sessionizeGames(games), rows);
  const threshold6 = candidate(result, 6);

  assert.equal(result.selectedThreshold, null);
  assert.equal(threshold6.comparison.evidenceStrength, 'LOW');
  assert.equal(threshold6.comparison.averageScoreLossDeltaCp, 5);
  assert.equal(threshold6.comparison.broadDeterioration, false);
  assert.equal(threshold6.comparison.deterioratingSessions, 0);
  assert.equal(threshold6.comparison.supported, false);
});

test('a later dramatic threshold does not replace an earlier supported threshold', () => {
  const games = [];
  const rows = [];
  const idRef = { value: 700 };

  for (let session = 0; session < 5; session += 1) {
    addSession(games, rows, idRef, session, 7, {
      scoreLoss: (ordinal) => ordinal <= 3 ? 20 : ordinal === 7 ? 100 : 35,
      majorErrors: (ordinal) => ordinal <= 3 ? 0 : ordinal === 7 ? 4 : 1,
      blunders: (ordinal) => ordinal === 7 ? 3 : 0,
    });
  }

  const result = buildOverlongSessionStoppingPointAggregate(sessionizeGames(games), rows);
  const threshold4 = candidate(result, 4);
  const threshold7 = candidate(result, 7);

  assert.equal(threshold4.comparison.supported, true);
  assert.equal(threshold7.comparison.supported, true);
  assert.equal(result.selectedThreshold, 4);
});

test('candidate-set drift fails closed', () => {
  const games = [];
  const rows = [];
  const idRef = { value: 900 };

  addSession(games, rows, idRef, 0, 6);

  const result = buildOverlongSessionStoppingPointAggregate(
    sessionizeGames(games),
    rows,
    [4, 5, 6, 7, 8, 9, 11],
  );

  assert.equal(result.coverage.status, 'UNAVAILABLE');
  assert.equal(result.coverage.reason, 'candidate-threshold-set-mismatch');
  assert.equal(result.selectedThreshold, null);
  assert.deepEqual(result.candidates, []);
});

test('service composes sessionization with the shared provenance-safe game-quality repository contract', async () => {
  const candidates = [
    sourceGame(1001, '2026-09-01T10:00:00Z'),
    sourceGame(1002, '2026-09-01T10:10:00Z'),
    sourceGame(1003, '2026-09-01T10:20:00Z'),
    sourceGame(1004, '2026-09-01T10:30:00Z'),
    sourceGame(1005, '2026-09-01T10:40:00Z'),
    sourceGame(1006, '2026-09-01T10:50:00Z'),
    {
      importedGameId: 1007,
      startedAt: null,
      endedAt: new Date('2026-09-02T10:05:00Z'),
      resultForUser: 'DRAW',
    },
  ];
  let loadedQuality = null;

  const result = await getOverlongSessionStoppingPoint(
    42,
    {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-03T00:00:00Z'),
    },
    {
      countCandidates: async (appUserId) => {
        assert.equal(appUserId, 42);
        return candidates.length;
      },
      loadCandidates: async (appUserId) => {
        assert.equal(appUserId, 42);
        return candidates;
      },
    },
    {
      loadGameQuality: async (appUserId, importedGameIds) => {
        loadedQuality = { appUserId, importedGameIds: [...importedGameIds] };
        return importedGameIds.map((id) => quality(
          id,
          id === 1006 ? 38 : 20,
          '3+0',
          10,
          id === 1006 ? 1 : 0,
          id === 1006 ? 1 : 0,
        ));
      },
    },
  );

  assert.deepEqual(loadedQuality, {
    appUserId: 42,
    importedGameIds: [1001, 1002, 1003, 1004, 1005, 1006],
  });
  assert.equal(result.diagnosisId, 'SESSION-003');
  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.sessionUncoveredGames, 1);
  assert.equal(result.selectedThreshold, null);
});
