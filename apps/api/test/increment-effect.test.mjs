import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MoveClassificationCode } from '@why-i-suck-at-chess/chess-domain';
import prismaModule from '../dist/prisma.js';
import { ImportedGamePlyIndexService } from '../dist/modules/imported-games/ply-index.service.js';
import {
  INCREMENT_EFFECT_MAX_CANDIDATE_GAMES,
  INCREMENT_EFFECT_POLICY_VERSION,
  buildIncrementEffectAggregate,
  getIncrementEffect,
} from '../dist/modules/diagnosis/increment-effect.service.js';
import {
  prismaIncrementEffectRepository,
} from '../dist/modules/diagnosis/increment-effect.repository.prisma.js';
import {
  TIME_BEHAVIOR_POLICY_VERSION,
} from '../dist/modules/timing/time-behavior-policy.js';
import {
  TIMING_DERIVATION_VERSION,
} from '../dist/modules/timing/timing-policy.js';

const prisma = prismaModule.default ?? prismaModule;
const PGN = '[Event "increment effect fixture"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *';

function analysis(runId = 1) {
  return {
    runId,
    snapshotId: 'snapshot-' + runId,
    analysisVersion: 'fixture-analysis-v1',
    settingsHash: 'fixture-settings-' + runId,
    engineName: 'Stockfish',
    engineVersion: '17',
  };
}

function userMove(
  plyNumber,
  {
    clockBeforeMoveCentiseconds = 6_000,
    timingDerivationStatus = 'AVAILABLE',
    timingReliabilityFlags = [],
    scoreLossCp = 20,
    classificationCode = 0,
    currentAnalysis = analysis(plyNumber),
  } = {},
) {
  return {
    plyNumber,
    clockBeforeMoveCentiseconds,
    timingDerivationVersion: TIMING_DERIVATION_VERSION,
    timingDerivationStatus,
    timingReliabilityFlags,
    phase: null,
    scoreLossCp,
    classificationCode,
    analysis: currentAnalysis,
  };
}

function game(
  importedGameId,
  {
    exactTimeControlKey = '180+0',
    timeControlInitial = 180,
    timeControlIncrement = 0,
    variant = 'standard',
    speedCategory = 'blitz',
    resultForUser = 'WIN',
    timingDerivationVersion = TIMING_DERIVATION_VERSION,
    clocks = [6_000, 5_000],
    scoreLossCp = 20,
    classificationCode = 0,
    currentAnalysis = analysis(importedGameId),
    timingReliabilityFlags = [],
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
    timingDerivationVersion,
    userMoves: [
      userMove(3, {
        clockBeforeMoveCentiseconds: clocks[0],
        scoreLossCp,
        classificationCode,
        currentAnalysis,
        timingReliabilityFlags,
      }),
      userMove(5, {
        clockBeforeMoveCentiseconds: clocks[1],
        scoreLossCp,
        classificationCode,
        currentAnalysis,
        timingReliabilityFlags,
      }),
    ],
  };
}

function gamesForControl(
  startId,
  count,
  exactTimeControlKey,
  initialSeconds,
  incrementSeconds,
  options = {},
) {
  return Array.from({ length: count }, (_, index) => game(startId + index, {
    exactTimeControlKey,
    timeControlInitial: initialSeconds,
    timeControlIncrement: incrementSeconds,
    ...options,
  }));
}

function onlyStratum(result) {
  assert.equal(result.strata.length, 1);
  return result.strata[0];
}

test('TIME-006 compares increment and no-increment inside the same initial-time stratum', () => {
  const result = buildIncrementEffectAggregate([
    ...gamesForControl(1, 5, '180+0', 180, 0, {
      resultForUser: 'LOSS',
      clocks: [2_500, 900],
      scoreLossCp: 80,
      classificationCode: MoveClassificationCode.Blunder,
    }),
    ...gamesForControl(101, 5, '180+2', 180, 2, {
      resultForUser: 'WIN',
      clocks: [6_000, 5_000],
      scoreLossCp: 20,
    }),
  ]);

  assert.equal(result.diagnosisId, 'TIME-006');
  assert.equal(result.policyVersion, INCREMENT_EFFECT_POLICY_VERSION);
  assert.equal(result.timeBehaviorPolicyVersion, TIME_BEHAVIOR_POLICY_VERSION);
  assert.equal(result.coverage.status, 'COMPLETE');
  assert.equal(result.coverage.matchedInitialTimeStrata, 1);
  assert.equal(result.coverage.matchedGames, 10);

  const stratum = onlyStratum(result);
  assert.equal(stratum.initialSeconds, 180);
  assert.deepEqual(
    stratum.noIncrement.exactControls.map((control) => control.exactTimeControlKey),
    ['180+0'],
  );
  assert.deepEqual(
    stratum.increment.exactControls.map((control) => control.exactTimeControlKey),
    ['180+2'],
  );
  assert.equal(stratum.noIncrement.scorePercent, 0);
  assert.equal(stratum.increment.scorePercent, 100);
  assert.equal(stratum.deltas.scorePercentagePoints, 100);
  assert.equal(stratum.deltas.averageScoreLossCp, -60);
  assert.equal(stratum.deltas.pressureMoveRatePercentagePoints, -100);
  assert.equal(stratum.deltas.pressureEntryRatePercentagePoints, -100);
  assert.equal(stratum.evidenceStrength.result, 'LOW');
  assert.equal(stratum.evidenceStrength.quality, 'LOW');
  assert.equal(stratum.evidenceStrength.timing, 'LOW');
});

test('TIME-006 represents negative and neutral increment effects without assuming increment helps', () => {
  const negative = onlyStratum(buildIncrementEffectAggregate([
    ...gamesForControl(1, 5, '180+0', 180, 0, {
      resultForUser: 'WIN',
      clocks: [6_000, 5_000],
      scoreLossCp: 20,
    }),
    ...gamesForControl(101, 5, '180+2', 180, 2, {
      resultForUser: 'LOSS',
      clocks: [2_500, 900],
      scoreLossCp: 80,
      classificationCode: MoveClassificationCode.Mistake,
    }),
  ]));

  assert.equal(negative.deltas.scorePercentagePoints, -100);
  assert.equal(negative.deltas.averageScoreLossCp, 60);
  assert.equal(negative.deltas.pressureEntryRatePercentagePoints, 100);

  const neutral = onlyStratum(buildIncrementEffectAggregate([
    ...gamesForControl(201, 5, '300+0', 300, 0),
    ...gamesForControl(301, 5, '300+5', 300, 5),
  ]));
  assert.equal(neutral.deltas.scorePercentagePoints, 0);
  assert.equal(neutral.deltas.averageScoreLossCp, 0);
  assert.equal(neutral.deltas.pressureMoveRatePercentagePoints, 0);
});

test('TIME-006 never compares different initial times and keeps unmatched strata explicit', () => {
  const unavailable = buildIncrementEffectAggregate([
    ...gamesForControl(1, 5, '180+0', 180, 0),
    ...gamesForControl(101, 5, '300+5', 300, 5),
  ]);

  assert.equal(unavailable.coverage.status, 'UNAVAILABLE');
  assert.equal(unavailable.coverage.reason, 'no-comparable-increment-strata');
  assert.equal(unavailable.coverage.unmatchedInitialTimeStrata, 2);
  assert.equal(unavailable.strata.length, 0);

  const partial = buildIncrementEffectAggregate([
    ...gamesForControl(201, 5, '180+0', 180, 0),
    ...gamesForControl(301, 5, '180+2', 180, 2),
    ...gamesForControl(401, 3, '600+5', 600, 5),
  ]);
  assert.equal(partial.coverage.status, 'PARTIAL');
  assert.equal(partial.coverage.reason, 'some-initial-time-strata-unmatched');
  assert.equal(partial.coverage.matchedGames, 10);
  assert.equal(partial.coverage.unmatchedGames, 3);
  assert.equal(partial.coverage.unmatchedInitialTimeStrata, 1);
});

test('missing identity, stale analysis, and unreliable timing remain separate coverage loss', () => {
  const result = buildIncrementEffectAggregate([
    ...gamesForControl(1, 5, '180+0', 180, 0),
    ...gamesForControl(101, 4, '180+2', 180, 2),
    game(105, {
      exactTimeControlKey: '180+2',
      timeControlInitial: 180,
      timeControlIncrement: 2,
      currentAnalysis: null,
      timingReliabilityFlags: ['POSSIBLE_EXTERNAL_CLOCK_ADJUSTMENT'],
    }),
    game(201, { exactTimeControlKey: null }),
    game(202, { speedCategory: 'classical' }),
  ]);

  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.unsupportedGames, 1);
  assert.equal(result.coverage.missingControlIdentityGames, 1);
  assert.equal(result.coverage.analysisCoveragePercent, 90);
  assert.equal(result.coverage.timingCoveragePercent, 90);

  const stratum = onlyStratum(result);
  assert.equal(stratum.increment.analysedGames, 4);
  assert.equal(stratum.increment.analysisCoveragePercent, 80);
  assert.equal(stratum.increment.pressure.timingCoveredGames, 4);
  assert.equal(stratum.increment.pressure.timingCoveragePercent, 80);
  assert.equal(stratum.evidenceStrength.quality, 'INSUFFICIENT');
  assert.equal(stratum.evidenceStrength.timing, 'INSUFFICIENT');
});

test('service bounds reads, rejects drift, and loads rating context once for all matched strata', async () => {
  let loaded = false;
  const tooLarge = await getIncrementEffect(
    7,
    {},
    {
      countCandidates: async () => INCREMENT_EFFECT_MAX_CANDIDATE_GAMES + 1,
      loadCandidates: async () => {
        loaded = true;
        return [];
      },
    },
    { loadOwnedRatingContext: async () => [] },
  );
  assert.equal(tooLarge.coverage.reason, 'increment-effect-scope-too-large');
  assert.equal(loaded, false);

  const drifted = await getIncrementEffect(
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
    ...gamesForControl(100, 5, '180+0', 180, 0),
    ...gamesForControl(200, 5, '180+2', 180, 2),
    ...gamesForControl(300, 5, '300+0', 300, 0),
    ...gamesForControl(400, 5, '300+5', 300, 5),
  ];
  const calls = [];
  const withRating = await getIncrementEffect(
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
          opponentRating: importedGameId >= 200 && importedGameId < 300
            ? 1800
            : 1400,
        }));
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 20);
  assert.equal(withRating.strata.length, 2);
  assert.equal(withRating.strata[0].ratingComposition.status, 'AVAILABLE');
  assert.equal(
    withRating.strata[0].ratingComposition.result?.comparison.materialCompositionWarning,
    true,
  );

  await assert.rejects(
    getIncrementEffect(
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

test('Prisma repository is ownership/range bounded and fences stale engine snapshots', async () => {
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
    const owner = await createUser('increment-effect-owner-' + suffix);
    const other = await createUser('increment-effect-other-' + suffix);
    const inRange = await createGame(
      owner.id,
      'increment-effect-in-' + suffix,
      new Date('2026-09-19T10:00:00.000Z'),
    );
    await createGame(
      owner.id,
      'increment-effect-out-' + suffix,
      new Date('2026-09-19T13:00:00.000Z'),
    );
    await createGame(
      other.id,
      'increment-effect-foreign-' + suffix,
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

    assert.equal(await prismaIncrementEffectRepository.countCandidates(owner.id, scope), 1);
    let rows = await prismaIncrementEffectRepository.loadCandidates(owner.id, scope);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].importedGameId, inRange.id);
    const currentMove = rows[0].userMoves.find((move) => move.plyNumber === 1);
    assert.ok(currentMove?.analysis);
    assert.equal(currentMove?.scoreLossCp, 42);

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

    rows = await prismaIncrementEffectRepository.loadCandidates(owner.id, scope);
    const staleMove = rows[0].userMoves.find((move) => move.plyNumber === 1);
    assert.equal(staleMove?.analysis, null);
  } finally {
    for (const id of userIds.reverse()) {
      await prisma.appUser.delete({ where: { id } }).catch(() => undefined);
    }
  }
});
