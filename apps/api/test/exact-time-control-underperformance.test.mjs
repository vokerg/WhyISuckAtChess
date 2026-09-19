import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MoveClassificationCode } from '@why-i-suck-at-chess/chess-domain';
import prismaModule from '../dist/prisma.js';
import { ImportedGamePlyIndexService } from '../dist/modules/imported-games/ply-index.service.js';
import {
  EXACT_TIME_CONTROL_MAX_CANDIDATE_GAMES,
  EXACT_TIME_CONTROL_UNDERPERFORMANCE_POLICY_VERSION,
  buildExactTimeControlUnderperformanceAggregate,
  getExactTimeControlUnderperformance,
} from '../dist/modules/diagnosis/exact-time-control-underperformance.service.js';
import {
  prismaExactTimeControlRepository,
} from '../dist/modules/diagnosis/exact-time-control-underperformance.repository.prisma.js';
import {
  TIME_BEHAVIOR_POLICY_VERSION,
} from '../dist/modules/timing/time-behavior-policy.js';

const prisma = prismaModule.default ?? prismaModule;
const PGN = '[Event "exact control fixture"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *';

function game(
  importedGameId,
  {
    exactTimeControlKey = '180+0',
    timeControlInitial = 180,
    timeControlIncrement = 0,
    variant = 'standard',
    speedCategory = 'blitz',
    resultForUser = 'WIN',
    analysedUserMoves = 2,
    averageScoreLossCp = 20,
    majorErrorMoves = 0,
    blunderMoves = 0,
  } = {},
) {
  return {
    importedGameId,
    variant,
    speedCategory,
    exactTimeControlKey,
    timeControlInitial,
    timeControlIncrement,
    resultForUser,
    analysedUserMoves,
    scoreLossTotalCp: analysedUserMoves > 0
      ? averageScoreLossCp * analysedUserMoves
      : null,
    majorErrorMoves,
    blunderMoves,
  };
}

function controlGames(
  startId,
  count,
  exactTimeControlKey,
  timeControlInitial,
  timeControlIncrement,
  options = {},
) {
  return Array.from({ length: count }, (_, index) => game(startId + index, {
    exactTimeControlKey,
    timeControlInitial,
    timeControlIncrement,
    ...options,
  }));
}

function byTarget(result, key) {
  const comparison = result.comparisons.find(
    (row) => row.target.exactTimeControlKey === key,
  );
  assert.ok(comparison, 'missing comparison for target ' + key);
  return comparison;
}

test('TIME-005 keeps exact controls distinct and compares result plus current quality separately', () => {
  const games = [
    ...controlGames(1, 5, '180+0', 180, 0, {
      resultForUser: 'WIN',
      averageScoreLossCp: 20,
    }),
    ...controlGames(101, 5, '180+2', 180, 2, {
      resultForUser: 'LOSS',
      averageScoreLossCp: 80,
      majorErrorMoves: 1,
      blunderMoves: 1,
    }),
  ];

  const result = buildExactTimeControlUnderperformanceAggregate(games);
  const noIncrement = byTarget(result, '180+0');
  const increment = byTarget(result, '180+2');

  assert.equal(result.diagnosisId, 'TIME-005');
  assert.equal(result.policyVersion, EXACT_TIME_CONTROL_UNDERPERFORMANCE_POLICY_VERSION);
  assert.equal(result.timeBehaviorPolicyVersion, TIME_BEHAVIOR_POLICY_VERSION);
  assert.equal(result.coverage.status, 'COMPLETE');
  assert.equal(result.coverage.exactControls, 2);
  assert.equal(result.coverage.controlsWithComparator, 2);
  assert.equal(result.coverage.resultCoveragePercent, 100);
  assert.equal(result.coverage.analysisCoveragePercent, 100);

  assert.equal(noIncrement.status, 'AVAILABLE');
  assert.equal(noIncrement.target.exactTimeControlKey, '180+0');
  assert.equal(noIncrement.comparator?.exactTimeControlKey, '180+2');
  assert.equal(noIncrement.target.scorePercent, 100);
  assert.equal(noIncrement.comparator?.scorePercent, 0);
  assert.equal(noIncrement.deltas.scorePercentagePoints, 100);
  assert.equal(noIncrement.deltas.averageScoreLossCp, -60);
  assert.equal(noIncrement.evidenceStrength.result, 'LOW');
  assert.equal(noIncrement.evidenceStrength.quality, 'LOW');

  assert.equal(increment.comparator?.exactTimeControlKey, '180+0');
  assert.equal(increment.deltas.scorePercentagePoints, -100);
  assert.equal(increment.deltas.averageScoreLossCp, 60);
});

test('TIME-005 never falls back to broad speed and exposes controls without sufficient comparators', () => {
  const unrelated = buildExactTimeControlUnderperformanceAggregate([
    ...controlGames(1, 5, '180+0', 180, 0),
    ...controlGames(101, 5, '300+0', 300, 0),
  ]);

  assert.equal(unrelated.coverage.status, 'UNAVAILABLE');
  assert.equal(unrelated.coverage.reason, 'no-sufficient-same-initial-comparator');
  assert.equal(byTarget(unrelated, '180+0').status, 'UNAVAILABLE');
  assert.equal(byTarget(unrelated, '300+0').status, 'UNAVAILABLE');

  const weakComparator = buildExactTimeControlUnderperformanceAggregate([
    ...controlGames(201, 5, '180+0', 180, 0),
    ...controlGames(301, 4, '180+2', 180, 2),
  ]);
  assert.equal(byTarget(weakComparator, '180+0').status, 'UNAVAILABLE');
  assert.equal(byTarget(weakComparator, '180+0').reason, 'no-sufficient-same-initial-comparator');
  assert.equal(byTarget(weakComparator, '180+2').status, 'AVAILABLE');
  assert.equal(byTarget(weakComparator, '180+2').evidenceStrength.result, 'INSUFFICIENT');
});

test('comparator selection is deterministic when multiple same-initial controls qualify', () => {
  const result = buildExactTimeControlUnderperformanceAggregate([
    ...controlGames(1, 5, '180+0', 180, 0),
    ...controlGames(101, 5, '180+1', 180, 1),
    ...controlGames(201, 5, '180+2', 180, 2),
  ]);

  const target = byTarget(result, '180+0');
  assert.equal(target.comparatorDefinition.eligibleComparatorControls, 2);
  assert.equal(target.comparator?.exactTimeControlKey, '180+1');
  assert.equal(
    target.comparatorDefinition.selectionRule,
    'STRONGEST_RESULT_EVIDENCE_THEN_LARGEST_RESULT_SAMPLE_THEN_NEAREST_INCREMENT_THEN_KEY',
  );
});

test('missing control identity, unsupported cohorts, result gaps, and analysis gaps remain explicit', () => {
  const result = buildExactTimeControlUnderperformanceAggregate([
    ...controlGames(1, 5, '180+0', 180, 0),
    ...controlGames(101, 5, '180+2', 180, 2, {
      resultForUser: null,
      analysedUserMoves: 0,
    }),
    game(201, { exactTimeControlKey: null }),
    game(202, { speedCategory: 'classical' }),
  ]);

  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.unsupportedGames, 1);
  assert.equal(result.coverage.missingExactControlGames, 1);
  assert.equal(result.coverage.resultCoveredGames, 5);
  assert.equal(result.coverage.resultCoveragePercent, 50);
  assert.equal(result.coverage.analysedGames, 5);
  assert.equal(result.coverage.analysisCoveragePercent, 50);
  assert.equal(byTarget(result, '180+0').status, 'UNAVAILABLE');
  assert.equal(byTarget(result, '180+2').status, 'AVAILABLE');
  assert.equal(byTarget(result, '180+2').target.resultEvidenceStrength, 'INSUFFICIENT');
  assert.equal(byTarget(result, '180+2').target.qualityEvidenceStrength, 'INSUFFICIENT');
});

test('service bounds reads, rejects snapshot drift, and attaches RATING-002 per selected pair', async () => {
  let loaded = false;
  const tooLarge = await getExactTimeControlUnderperformance(
    7,
    {},
    {
      countCandidates: async () => EXACT_TIME_CONTROL_MAX_CANDIDATE_GAMES + 1,
      loadCandidates: async () => {
        loaded = true;
        return [];
      },
    },
    { loadOwnedRatingContext: async () => [] },
  );
  assert.equal(tooLarge.coverage.reason, 'exact-time-control-scope-too-large');
  assert.equal(loaded, false);

  const drifted = await getExactTimeControlUnderperformance(
    7,
    {},
    {
      countCandidates: async () => 2,
      loadCandidates: async () => [game(1)],
    },
    { loadOwnedRatingContext: async () => [] },
  );
  assert.equal(drifted.coverage.reason, 'candidate-set-changed-during-read');

  const games = [
    ...controlGames(100, 5, '180+0', 180, 0),
    ...controlGames(200, 5, '180+2', 180, 2),
  ];
  const calls = [];
  const withRating = await getExactTimeControlUnderperformance(
    9,
    {},
    {
      countCandidates: async () => games.length,
      loadCandidates: async () => games,
    },
    {
      loadOwnedRatingContext: async (appUserId, importedGameIds) => {
        assert.equal(appUserId, 9);
        calls.push([...importedGameIds]);
        return importedGameIds.map((importedGameId) => ({
          importedGameId,
          userRating: 1600,
          opponentRating: importedGameId >= 200 ? 1800 : 1400,
        }));
      },
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(byTarget(withRating, '180+0').ratingComposition.status, 'AVAILABLE');
  assert.equal(
    byTarget(withRating, '180+0').ratingComposition.result?.comparison.materialCompositionWarning,
    true,
  );

  await assert.rejects(
    getExactTimeControlUnderperformance(
      7,
      {
        from: new Date('2026-09-19T12:00:00.000Z'),
        to: new Date('2026-09-19T12:00:00.000Z'),
      },
      {
        countCandidates: async () => 0,
        loadCandidates: async () => [],
      },
      { loadOwnedRatingContext: async () => [] },
    ),
    RangeError,
  );
});

test('Prisma repository is ownership/range bounded and excludes stale engine snapshots', async () => {
  const suffix = randomUUID();
  const userIds = [];

  async function createUser(subject) {
    const user = await prisma.appUser.create({
      data: { authProvider: 'TEST', authSubject: subject },
    });
    userIds.push(user.id);
    return user;
  }

  async function createGame(appUserId, providerGameId, startedAt) {
    return prisma.importedGame.create({
      data: {
        appUserId,
        provider: 'LICHESS',
        providerGameId,
        source: 'LICHESS_API',
        connectedLichessUserId: 'fixture-' + appUserId,
        connectedLichessUsername: 'FixtureUser',
        pgn: PGN,
        variant: 'standard',
        speedCategory: 'blitz',
        timeControlRaw: '180+0',
        timeControlInitial: 180,
        timeControlIncrement: 0,
        timeControlSource: 'LICHESS_CLOCK_OBJECT',
        exactTimeControlKey: '180+0',
        startedAt,
        endedAt: new Date(startedAt.getTime() + 60_000),
        whiteUsername: 'FixtureUser',
        blackUsername: 'Opponent',
        whiteRating: 1500,
        blackRating: 1500,
        userColor: 'WHITE',
        resultForUser: 'WIN',
        status: 'resign',
        rawClockPresence: 'PRESENT',
        rawClockStateCount: 4,
        rawClockAnomalies: [],
        rawClockStates: {
          create: [18_000, 18_000, 17_900, 17_900].map((valueCentiseconds, index) => ({
            sourceOrdinal: index + 1,
            valueCentiseconds,
          })),
        },
      },
    });
  }

  try {
    const owner = await createUser('exact-control-owner-' + suffix);
    const other = await createUser('exact-control-other-' + suffix);
    const inRange = await createGame(
      owner.id,
      'exact-control-in-' + suffix,
      new Date('2026-09-19T10:00:00.000Z'),
    );
    await createGame(
      owner.id,
      'exact-control-out-' + suffix,
      new Date('2026-09-19T13:00:00.000Z'),
    );
    await createGame(
      other.id,
      'exact-control-foreign-' + suffix,
      new Date('2026-09-19T10:15:00.000Z'),
    );

    const indexed = await ImportedGamePlyIndexService.indexOne(owner.id, inRange.id);
    assert.equal(indexed.status, 'INDEXED');
    assert.ok(indexed.plyIndexedAt);

    const currentRun = await prisma.gameAnalysisRun.create({
      data: {
        importedGameId: inRange.id,
        analysisVersion: 'fixture-analysis-v1',
        settingsHash: 'fixture-settings-current-' + suffix,
        settingsJson: { depth: 12 },
        sourcePlyIndexedAt: indexed.plyIndexedAt,
        engineName: 'Stockfish',
        engineVersion: '17',
        status: 'SUCCEEDED',
        coverageStatus: 'COMPLETE',
      },
    });

    await prisma.importedGamePly.update({
      where: {
        importedGameId_plyNumber: {
          importedGameId: inRange.id,
          plyNumber: 1,
        },
      },
      data: {
        engineAnalysisRunId: currentRun.id,
        scoreLossCp: 42,
        classificationCode: MoveClassificationCode.Blunder,
      },
    });

    const scope = {
      from: new Date('2026-09-19T09:00:00.000Z'),
      to: new Date('2026-09-19T11:00:00.000Z'),
    };

    assert.equal(await prismaExactTimeControlRepository.countCandidates(owner.id, scope), 1);
    let rows = await prismaExactTimeControlRepository.loadCandidates(owner.id, scope);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].importedGameId, inRange.id);
    assert.equal(rows[0].analysedUserMoves, 1);
    assert.equal(rows[0].scoreLossTotalCp, 42);
    assert.equal(rows[0].majorErrorMoves, 1);
    assert.equal(rows[0].blunderMoves, 1);

    const staleRun = await prisma.gameAnalysisRun.create({
      data: {
        importedGameId: inRange.id,
        analysisVersion: 'fixture-analysis-v1',
        settingsHash: 'fixture-settings-stale-' + suffix,
        settingsJson: { depth: 12 },
        sourcePlyIndexedAt: new Date(indexed.plyIndexedAt.getTime() - 1_000),
        engineName: 'Stockfish',
        engineVersion: '17',
        status: 'SUCCEEDED',
        coverageStatus: 'COMPLETE',
      },
    });
    await prisma.importedGamePly.update({
      where: {
        importedGameId_plyNumber: {
          importedGameId: inRange.id,
          plyNumber: 1,
        },
      },
      data: { engineAnalysisRunId: staleRun.id },
    });

    rows = await prismaExactTimeControlRepository.loadCandidates(owner.id, scope);
    assert.equal(rows[0].analysedUserMoves, 0);
    assert.equal(rows[0].scoreLossTotalCp, null);
    assert.equal(rows[0].majorErrorMoves, 0);
  } finally {
    for (const id of userIds.reverse()) {
      await prisma.appUser.delete({ where: { id } }).catch(() => undefined);
    }
  }
});
