import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLossStreakDeteriorationAggregate,
  getLossStreakDeterioration,
  lossStreakComparativeEvidenceStrength,
  LOSS_STREAK_DETERIORATION_POLICY_VERSION,
} from '../dist/modules/diagnosis/loss-streak-deterioration.service.js';
import { sessionizeGames } from '../dist/modules/sessions/sessionization.service.js';

function sourceGame(id, start, result = 'DRAW') {
  const startedAt = new Date(start);
  return {
    importedGameId: id,
    startedAt,
    endedAt: new Date(startedAt.getTime() + 5 * 60 * 1000),
    resultForUser: result,
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

function addThreeGameSession(games, rows, idRef, dayOffset, results, thirdGameQuality, exactTimeControlKey = '3+0') {
  const base = Date.parse('2026-09-01T10:00:00Z') + dayOffset * 24 * 60 * 60 * 1000;
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    const id = idRef.value++;
    games.push(sourceGame(
      id,
      new Date(base + (ordinal - 1) * 10 * 60 * 1000).toISOString(),
      results[ordinal - 1],
    ));
    rows.push(quality(
      id,
      ordinal === 3 ? thirdGameQuality.averageScoreLossCp : 20,
      ordinal === 3 ? exactTimeControlKey : '3+0',
      10,
      ordinal === 3 ? thirdGameQuality.majorErrorMoves : 0,
      ordinal === 3 ? thirdGameQuality.blunderMoves : 0,
    ));
  }
}

test('loss-streak aggregate compares prior-loss-streak >=2 with ordinal/control matched non-streak games', () => {
  const games = [];
  const rows = [];
  const idRef = { value: 1 };

  for (let session = 0; session < 5; session += 1) {
    addThreeGameSession(
      games,
      rows,
      idRef,
      session,
      ['LOSS', 'LOSS', 'DRAW'],
      { averageScoreLossCp: 80, majorErrorMoves: 3, blunderMoves: 2 },
    );
  }
  for (let session = 5; session < 10; session += 1) {
    addThreeGameSession(
      games,
      rows,
      idRef,
      session,
      ['DRAW', 'DRAW', 'DRAW'],
      { averageScoreLossCp: 30, majorErrorMoves: 1, blunderMoves: 0 },
    );
  }

  const result = buildLossStreakDeteriorationAggregate(sessionizeGames(games), rows);

  assert.equal(result.policyVersion, LOSS_STREAK_DETERIORATION_POLICY_VERSION);
  assert.equal(result.coverage.status, 'COMPLETE');
  assert.equal(result.coverage.baselineCandidateGames, 5);
  assert.equal(result.coverage.streakCandidateGames, 5);
  assert.equal(result.coverage.excludedPreStreakOrdinalGames, 20);
  assert.equal(result.coverage.excludedSingleLossGames, 5);
  assert.equal(result.coverage.matchedBaselineGames, 5);
  assert.equal(result.coverage.matchedStreakGames, 5);
  assert.equal(result.coverage.matchedStrata, 1);
  assert.equal(result.comparison.baseline.analysedSessions, 5);
  assert.equal(result.comparison.afterLossStreak.analysedSessions, 5);
  assert.equal(result.comparison.baseline.averageScoreLossCp, 30);
  assert.equal(result.comparison.afterLossStreak.averageScoreLossCp, 80);
  assert.equal(result.comparison.averageScoreLossDeltaCp, 50);
  assert.equal(result.comparison.baseline.majorErrorRatePercent, 10);
  assert.equal(result.comparison.afterLossStreak.majorErrorRatePercent, 30);
  assert.equal(result.comparison.majorErrorRateDeltaPercent, 20);
  assert.equal(result.comparison.blunderRateDeltaPercent, 20);
  assert.equal(result.comparison.evidenceStrength, 'LOW');
});

test('matching excludes missing time controls and one-sided ordinal/control strata explicitly', () => {
  const games = [];
  const rows = [];
  const idRef = { value: 100 };

  addThreeGameSession(
    games,
    rows,
    idRef,
    0,
    ['LOSS', 'LOSS', 'DRAW'],
    { averageScoreLossCp: 80, majorErrorMoves: 2, blunderMoves: 1 },
    '3+0',
  );
  addThreeGameSession(
    games,
    rows,
    idRef,
    1,
    ['LOSS', 'LOSS', 'DRAW'],
    { averageScoreLossCp: 90, majorErrorMoves: 3, blunderMoves: 2 },
    null,
  );
  addThreeGameSession(
    games,
    rows,
    idRef,
    2,
    ['DRAW', 'DRAW', 'DRAW'],
    { averageScoreLossCp: 30, majorErrorMoves: 1, blunderMoves: 0 },
    '3+0',
  );
  addThreeGameSession(
    games,
    rows,
    idRef,
    3,
    ['DRAW', 'DRAW', 'DRAW'],
    { averageScoreLossCp: 35, majorErrorMoves: 1, blunderMoves: 0 },
    '3+2',
  );

  const result = buildLossStreakDeteriorationAggregate(sessionizeGames(games), rows);

  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.reason, 'exact-time-control-incomplete');
  assert.equal(result.coverage.baselineCandidateGames, 2);
  assert.equal(result.coverage.streakCandidateGames, 2);
  assert.equal(result.coverage.missingTimeControlGames, 1);
  assert.equal(result.coverage.matchedBaselineGames, 1);
  assert.equal(result.coverage.matchedStreakGames, 1);
  assert.equal(result.coverage.unmatchedBaselineGames, 1);
  assert.equal(result.coverage.unmatchedStreakGames, 1);
  assert.equal(result.coverage.matchedStrata, 1);
  assert.equal(result.comparison.averageScoreLossDeltaCp, 50);
  assert.equal(result.comparison.evidenceStrength, 'INSUFFICIENT');
});

test('loss-streak strength is gated by weaker arm sample and per-arm analysis coverage', () => {
  assert.equal(lossStreakComparativeEvidenceStrength(
    { analysedGames: 40, analysisCoveragePercent: 100 },
    { analysedGames: 4, analysisCoveragePercent: 100 },
  ), 'INSUFFICIENT');
  assert.equal(lossStreakComparativeEvidenceStrength(
    { analysedGames: 20, analysisCoveragePercent: 100 },
    { analysedGames: 20, analysisCoveragePercent: 49.9 },
  ), 'INSUFFICIENT');
  assert.equal(lossStreakComparativeEvidenceStrength(
    { analysedGames: 15, analysisCoveragePercent: 50 },
    { analysedGames: 15, analysisCoveragePercent: 50 },
  ), 'MEDIUM');
  assert.equal(lossStreakComparativeEvidenceStrength(
    { analysedGames: 40, analysisCoveragePercent: 100 },
    { analysedGames: 40, analysisCoveragePercent: 100 },
  ), 'HIGH');
});

test('service composes sessionization and loads quality only for session-covered games', async () => {
  const candidates = [
    sourceGame(201, '2026-09-01T10:00:00Z', 'LOSS'),
    sourceGame(202, '2026-09-01T10:10:00Z', 'LOSS'),
    sourceGame(203, '2026-09-01T10:20:00Z', 'DRAW'),
    sourceGame(204, '2026-09-02T10:00:00Z', 'DRAW'),
    sourceGame(205, '2026-09-02T10:10:00Z', 'DRAW'),
    sourceGame(206, '2026-09-02T10:20:00Z', 'DRAW'),
    {
      importedGameId: 207,
      startedAt: null,
      endedAt: new Date('2026-09-03T10:05:00Z'),
      resultForUser: 'LOSS',
    },
  ];
  let loadedQuality = null;

  const result = await getLossStreakDeterioration(
    42,
    {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-04T00:00:00Z'),
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
          id === 203 ? 75 : id === 206 ? 25 : 20,
          '3+0',
        ));
      },
    },
  );

  assert.deepEqual(loadedQuality, {
    appUserId: 42,
    importedGameIds: [201, 202, 203, 204, 205, 206],
  });
  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.sessionUncoveredGames, 1);
  assert.equal(result.coverage.matchedBaselineGames, 1);
  assert.equal(result.coverage.matchedStreakGames, 1);
  assert.equal(result.comparison.averageScoreLossDeltaCp, 50);
});

test('quality candidate drift fails closed before matching mixed snapshots', () => {
  const sessionization = sessionizeGames([
    sourceGame(301, '2026-09-01T10:00:00Z', 'LOSS'),
    sourceGame(302, '2026-09-01T10:10:00Z', 'LOSS'),
    sourceGame(303, '2026-09-01T10:20:00Z', 'DRAW'),
  ]);
  const result = buildLossStreakDeteriorationAggregate(
    sessionization,
    [
      quality(301, 20),
      quality(302, 20),
    ],
  );

  assert.equal(result.coverage.status, 'UNAVAILABLE');
  assert.equal(result.coverage.reason, 'session-game-set-changed-during-quality-read');
  assert.equal(result.comparison.evidenceStrength, 'INSUFFICIENT');
});

test('no shared ordinal/control stratum leaves the comparison unavailable', () => {
  const games = [];
  const rows = [];
  const idRef = { value: 400 };

  addThreeGameSession(
    games,
    rows,
    idRef,
    0,
    ['LOSS', 'LOSS', 'DRAW'],
    { averageScoreLossCp: 80, majorErrorMoves: 2, blunderMoves: 1 },
    '3+0',
  );
  addThreeGameSession(
    games,
    rows,
    idRef,
    1,
    ['DRAW', 'DRAW', 'DRAW'],
    { averageScoreLossCp: 30, majorErrorMoves: 1, blunderMoves: 0 },
    '3+2',
  );

  const result = buildLossStreakDeteriorationAggregate(sessionizeGames(games), rows);

  assert.equal(result.coverage.status, 'UNAVAILABLE');
  assert.equal(result.coverage.reason, 'no-matched-loss-streak-strata');
  assert.equal(result.coverage.unmatchedBaselineGames, 1);
  assert.equal(result.coverage.unmatchedStreakGames, 1);
  assert.equal(result.comparison.averageScoreLossDeltaCp, null);
});
