import assert from 'node:assert/strict';
import test from 'node:test';
import { MoveClassificationCode } from '@why-i-suck-at-chess/chess-domain';
import {
  buildEarlyTimeOveruseAggregate,
} from '../dist/modules/diagnosis/early-time-overuse.service.js';
import {
  buildExactTimeControlUnderperformanceAggregate,
} from '../dist/modules/diagnosis/exact-time-control-underperformance.service.js';
import {
  buildIncrementEffectAggregate,
  getIncrementEffect,
} from '../dist/modules/diagnosis/increment-effect.service.js';
import {
  buildOpponentMoveSpeedEffectAggregate,
} from '../dist/modules/diagnosis/opponent-move-speed-effect.service.js';
import {
  buildOpponentStrengthEffectAggregate,
} from '../dist/modules/diagnosis/opponent-strength-effect.service.js';
import {
  buildPlayedTooFastAggregate,
} from '../dist/modules/diagnosis/played-too-fast.service.js';
import {
  buildRatingContextComposition,
} from '../dist/modules/diagnosis/rating-context-composition.service.js';
import {
  buildTimePressureExposureAggregate,
} from '../dist/modules/diagnosis/time-pressure-exposure.service.js';
import {
  buildTimePressureQualityCollapseAggregate,
} from '../dist/modules/diagnosis/time-pressure-quality-collapse.service.js';
import {
  TIME_BEHAVIOR_POLICY_VERSION,
  TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS,
} from '../dist/modules/timing/time-behavior-policy.js';
import {
  TIMING_DERIVATION_VERSION,
} from '../dist/modules/timing/timing-policy.js';

const FIXTURE_ACCOUNT_ID = 67;

function analysis(runId) {
  return {
    runId,
    snapshotId: 'phase-4b-snapshot-' + runId,
    analysisVersion: 'phase-4b-analysis-v1',
    settingsHash: 'phase-4b-settings-v1',
    engineName: 'Stockfish',
    engineVersion: '17',
  };
}

function timedMove(
  plyNumber,
  {
    clockBeforeMoveCentiseconds = 8_000,
    moveTimeCentiseconds = 200,
    phase = 'MIDDLEGAME',
    scoreLossCp = 20,
    classificationCode = null,
    analysisRun = analysis(plyNumber),
    timingDerivationStatus = 'AVAILABLE',
    timingReliabilityFlags = [],
  } = {},
) {
  return {
    plyNumber,
    clockBeforeMoveCentiseconds,
    moveTimeCentiseconds,
    timingDerivationVersion: TIMING_DERIVATION_VERSION,
    timingDerivationStatus,
    timingReliabilityFlags,
    phase,
    scoreLossCp,
    classificationCode,
    analysis: analysisRun,
  };
}

function timingGame(
  importedGameId,
  {
    exactTimeControlKey = '180+0',
    timeControlInitial = 180,
    timeControlIncrement = 0,
    resultForUser = 'LOSS',
    userMoves = [timedMove(7)],
  } = {},
) {
  return {
    importedGameId,
    variant: 'standard',
    speedCategory: 'blitz',
    exactTimeControlKey,
    timeControlInitial,
    timeControlIncrement,
    resultForUser,
    timingDerivationVersion: TIMING_DERIVATION_VERSION,
    userMoves,
  };
}

function pressureQualityCohort() {
  return [
    ...Array.from({ length: 5 }, (_, index) => timingGame(1 + index, {
      userMoves: [timedMove(7, {
        clockBeforeMoveCentiseconds: 8_000,
        moveTimeCentiseconds: 250,
        scoreLossCp: 10,
        analysisRun: analysis(100 + index),
      })],
    })),
    ...Array.from({ length: 5 }, (_, index) => timingGame(6 + index, {
      userMoves: [timedMove(7, {
        clockBeforeMoveCentiseconds: 2_500,
        moveTimeCentiseconds: 50,
        scoreLossCp: 80,
        classificationCode: MoveClassificationCode.Blunder,
        analysisRun: analysis(200 + index),
      })],
    })),
  ];
}

function incrementCohort() {
  return Array.from({ length: 10 }, (_, index) => timingGame(101 + index, {
    exactTimeControlKey: '180+2',
    timeControlIncrement: 2,
    resultForUser: 'WIN',
    userMoves: [timedMove(7, {
      clockBeforeMoveCentiseconds: 8_000,
      moveTimeCentiseconds: 200,
      scoreLossCp: 20,
      analysisRun: analysis(300 + index),
    })],
  }));
}

function fastAmpleCohort(startId, baselineScoreLossCp, fastScoreLossCp) {
  return [
    ...Array.from({ length: 5 }, (_, index) => timingGame(startId + index, {
      exactTimeControlKey: '300+0',
      timeControlInitial: 300,
      userMoves: [timedMove(7, {
        clockBeforeMoveCentiseconds: 10_000,
        moveTimeCentiseconds: 250,
        scoreLossCp: baselineScoreLossCp,
        analysisRun: analysis(startId * 10 + index),
      })],
    })),
    ...Array.from({ length: 5 }, (_, index) => timingGame(startId + 5 + index, {
      exactTimeControlKey: '300+0',
      timeControlInitial: 300,
      userMoves: [timedMove(7, {
        clockBeforeMoveCentiseconds: 10_000,
        moveTimeCentiseconds: TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS,
        scoreLossCp: fastScoreLossCp,
        classificationCode: fastScoreLossCp > baselineScoreLossCp
          ? MoveClassificationCode.Blunder
          : null,
        analysisRun: analysis(startId * 10 + 100 + index),
      })],
    })),
  ];
}

function earlyOveruseCohort(startId, pressureScoreLossCp) {
  const peers = Array.from({ length: 5 }, (_, index) => timingGame(startId + index, {
    userMoves: [
      timedMove(3, {
        clockBeforeMoveCentiseconds: 12_000,
        moveTimeCentiseconds: 100,
        phase: 'OPENING',
        analysisRun: analysis(startId * 10 + index * 10 + 1),
      }),
      timedMove(5, {
        clockBeforeMoveCentiseconds: 11_000,
        moveTimeCentiseconds: 100,
        phase: 'OPENING',
        analysisRun: analysis(startId * 10 + index * 10 + 2),
      }),
      timedMove(7, {
        clockBeforeMoveCentiseconds: 8_000,
        moveTimeCentiseconds: 150,
        phase: 'MIDDLEGAME',
        scoreLossCp: 10,
        analysisRun: analysis(startId * 10 + index * 10 + 3),
      }),
    ],
  }));

  const overuse = Array.from({ length: 5 }, (_, index) => timingGame(startId + 5 + index, {
    userMoves: [
      timedMove(3, {
        clockBeforeMoveCentiseconds: 12_000,
        moveTimeCentiseconds: 300,
        phase: 'OPENING',
        analysisRun: analysis(startId * 10 + 500 + index * 10 + 1),
      }),
      timedMove(5, {
        clockBeforeMoveCentiseconds: 11_000,
        moveTimeCentiseconds: 300,
        phase: 'OPENING',
        analysisRun: analysis(startId * 10 + 500 + index * 10 + 2),
      }),
      timedMove(7, {
        clockBeforeMoveCentiseconds: 2_500,
        moveTimeCentiseconds: 150,
        phase: 'MIDDLEGAME',
        scoreLossCp: pressureScoreLossCp,
        analysisRun: analysis(startId * 10 + 500 + index * 10 + 3),
      }),
    ],
  }));

  return [...peers, ...overuse];
}

function opponentResponsePair(
  runId,
  {
    opponentMoveTimeCentiseconds,
    responseTimeCentiseconds,
    scoreLossCp,
  },
) {
  return [
    {
      plyNumber: 4,
      isUserMove: false,
      moveTimeCentiseconds: opponentMoveTimeCentiseconds,
      timingDerivationVersion: TIMING_DERIVATION_VERSION,
      timingDerivationStatus: 'AVAILABLE',
      timingReliabilityFlags: [],
      phase: 'MIDDLEGAME',
      scoreLossCp: null,
      classificationCode: null,
      analysis: null,
    },
    {
      plyNumber: 5,
      isUserMove: true,
      moveTimeCentiseconds: responseTimeCentiseconds,
      timingDerivationVersion: TIMING_DERIVATION_VERSION,
      timingDerivationStatus: 'AVAILABLE',
      timingReliabilityFlags: [],
      phase: 'MIDDLEGAME',
      scoreLossCp,
      classificationCode: scoreLossCp > 20 ? MoveClassificationCode.Blunder : null,
      analysis: analysis(runId),
    },
  ];
}

function opponentSpeedCohort() {
  return [
    ...Array.from({ length: 5 }, (_, index) => ({
      importedGameId: 401 + index,
      variant: 'standard',
      speedCategory: 'blitz',
      exactTimeControlKey: '600+0',
      timingDerivationVersion: TIMING_DERIVATION_VERSION,
      plies: opponentResponsePair(4_000 + index, {
        opponentMoveTimeCentiseconds: 250,
        responseTimeCentiseconds: 300,
        scoreLossCp: 10,
      }),
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      importedGameId: 406 + index,
      variant: 'standard',
      speedCategory: 'blitz',
      exactTimeControlKey: '600+0',
      timingDerivationVersion: TIMING_DERIVATION_VERSION,
      plies: opponentResponsePair(4_100 + index, {
        opponentMoveTimeCentiseconds: TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS,
        responseTimeCentiseconds: 50,
        scoreLossCp: 80,
      }),
    })),
  ];
}

function controlSummaryGame(game) {
  const analysed = game.userMoves.filter(
    (move) => move.analysis && typeof move.scoreLossCp === 'number',
  );
  const majorErrorMoves = analysed.filter(
    (move) => move.classificationCode === MoveClassificationCode.Mistake
      || move.classificationCode === MoveClassificationCode.Blunder,
  ).length;
  const blunderMoves = analysed.filter(
    (move) => move.classificationCode === MoveClassificationCode.Blunder,
  ).length;

  return {
    importedGameId: game.importedGameId,
    variant: game.variant,
    speedCategory: game.speedCategory,
    exactTimeControlKey: game.exactTimeControlKey,
    timeControlInitial: game.timeControlInitial,
    timeControlIncrement: game.timeControlIncrement,
    resultForUser: game.resultForUser,
    analysedUserMoves: analysed.length,
    scoreLossTotalCp: analysed.length > 0
      ? analysed.reduce((sum, move) => sum + move.scoreLossCp, 0)
      : null,
    majorErrorMoves,
    blunderMoves,
  };
}

function ratingRowsForIncrementComparison(noIncrement, increment) {
  return [
    ...noIncrement.map((game) => ({
      importedGameId: game.importedGameId,
      userRating: 1500,
      opponentRating: 1700,
    })),
    ...increment.map((game) => ({
      importedGameId: game.importedGameId,
      userRating: 1500,
      opponentRating: 1300,
    })),
  ];
}

function ratingEffectCohort() {
  const games = [];
  for (const [offset, exactTimeControlKey, resultForUser, averageScoreLossCp] of [
    [0, '180+0', 'WIN', 20],
    [10, '180+2', 'DRAW', 40],
  ]) {
    for (let index = 0; index < 5; index += 1) {
      games.push({
        importedGameId: 501 + offset + index,
        variant: 'standard',
        speedCategory: 'blitz',
        exactTimeControlKey,
        userRating: 1500,
        opponentRating: 1500,
        resultForUser,
        analysedUserMoves: 2,
        scoreLossTotalCp: averageScoreLossCp * 2,
        majorErrorMoves: 0,
        blunderMoves: 0,
      });
    }
    for (let index = 0; index < 5; index += 1) {
      const noIncrement = exactTimeControlKey === '180+0';
      games.push({
        importedGameId: 506 + offset + index,
        variant: 'standard',
        speedCategory: 'blitz',
        exactTimeControlKey,
        userRating: 1500,
        opponentRating: 1650,
        resultForUser: noIncrement ? 'LOSS' : resultForUser,
        analysedUserMoves: 2,
        scoreLossTotalCp: (noIncrement ? 80 : averageScoreLossCp) * 2,
        majorErrorMoves: noIncrement ? 2 : 0,
        blunderMoves: noIncrement ? 1 : 0,
      });
    }
  }
  return games;
}

function comparisonForControl(result, targetKey) {
  const row = result.comparisons.find(
    (comparison) => comparison.target.exactTimeControlKey === targetKey,
  );
  assert.ok(row, 'missing exact-control comparison for ' + targetKey);
  return row;
}

function ratingComparison(result, exactTimeControlKey, targetBand) {
  const row = result.comparisons.find(
    (comparison) => comparison.exactTimeControlKey === exactTimeControlKey
      && comparison.targetBand === targetBand,
  );
  assert.ok(row, 'missing rating comparison for ' + exactTimeControlKey + ' ' + targetBand);
  return row;
}

test('Phase 4B fixture composes timing, quality, control, increment, opponent-speed, and rating evidence', async () => {
  const noIncrement = pressureQualityCohort();
  const increment = incrementCohort();
  const exactControlGames = [...noIncrement, ...increment].map(controlSummaryGame);
  const ratingRows = ratingRowsForIncrementComparison(noIncrement, increment);

  const timePressure = buildTimePressureExposureAggregate(noIncrement);
  const pressureQuality = buildTimePressureQualityCollapseAggregate(noIncrement);
  const playedTooFast = buildPlayedTooFastAggregate(fastAmpleCohort(201, 10, 80));
  const earlyOveruse = buildEarlyTimeOveruseAggregate(earlyOveruseCohort(301, 80));
  const exactControl = buildExactTimeControlUnderperformanceAggregate(exactControlGames);
  const incrementEffect = buildIncrementEffectAggregate([...noIncrement, ...increment]);
  const opponentSpeed = buildOpponentMoveSpeedEffectAggregate(opponentSpeedCohort());
  const opponentStrength = buildOpponentStrengthEffectAggregate(ratingEffectCohort());
  const ratingContext = buildRatingContextComposition(
    {
      left: { importedGameIds: noIncrement.map((game) => game.importedGameId) },
      right: { importedGameIds: increment.map((game) => game.importedGameId) },
    },
    ratingRows,
  );

  for (const result of [
    timePressure,
    pressureQuality,
    playedTooFast,
    earlyOveruse,
    exactControl,
    incrementEffect,
    opponentSpeed,
    opponentStrength,
    ratingContext,
  ]) {
    assert.equal(result.timeBehaviorPolicyVersion, TIME_BEHAVIOR_POLICY_VERSION);
  }

  assert.equal(timePressure.coverage.status, 'COMPLETE');
  assert.equal(timePressure.exposure.pressureEnteringGames, 5);
  assert.equal(timePressure.exposure.pressureEntryRatePercent, 50);
  assert.deepEqual(
    timePressure.contextBreakdown.map((row) => row.exactTimeControlKey),
    ['180+0'],
  );

  assert.equal(pressureQuality.coverage.matchedStrata, 1);
  assert.equal(pressureQuality.comparison.averageScoreLossDeltaCp, 70);
  assert.equal(pressureQuality.comparison.evidenceStrength, 'LOW');

  assert.equal(playedTooFast.comparison.averageScoreLossDeltaCp, 70);
  assert.equal(playedTooFast.comparison.mechanismStatus, 'WORSE_QUALITY_ASSOCIATION');
  assert.equal(playedTooFast.recurrence.analysedFastAmpleGames, 5);

  assert.equal(earlyOveruse.chain.earlyOveruseGames, 5);
  assert.equal(earlyOveruse.chain.laterPressureGames, 5);
  assert.equal(earlyOveruse.chain.completeChainGames, 5);
  assert.equal(earlyOveruse.chain.averageLaterScoreLossDeltaCp, 70);
  assert.equal(earlyOveruse.chain.mechanismStatus, 'ORDERED_ASSOCIATION');

  const noIncrementControl = comparisonForControl(exactControl, '180+0');
  assert.equal(noIncrementControl.status, 'AVAILABLE');
  assert.equal(noIncrementControl.comparator?.exactTimeControlKey, '180+2');
  assert.equal(noIncrementControl.deltas.scorePercentagePoints, -100);
  assert.equal(noIncrementControl.deltas.averageScoreLossCp, 25);

  assert.equal(incrementEffect.strata.length, 1);
  assert.deepEqual(
    incrementEffect.strata[0].noIncrement.exactControls.map((row) => row.exactTimeControlKey),
    ['180+0'],
  );
  assert.deepEqual(
    incrementEffect.strata[0].increment.exactControls.map((row) => row.exactTimeControlKey),
    ['180+2'],
  );
  assert.equal(incrementEffect.strata[0].deltas.scorePercentagePoints, 100);
  assert.equal(incrementEffect.strata[0].deltas.averageScoreLossCp, -25);
  assert.equal(incrementEffect.strata[0].deltas.pressureEntryRatePercentagePoints, -50);

  assert.equal(opponentSpeed.comparison.averageResponseTimeDeltaCentiseconds, -250);
  assert.equal(opponentSpeed.comparison.averageScoreLossDeltaCp, 70);
  assert.equal(opponentSpeed.comparison.evidenceStrength.timing, 'LOW');
  assert.equal(opponentSpeed.comparison.evidenceStrength.quality, 'LOW');

  assert.equal(ratingContext.comparison.materialCompositionWarning, true);
  assert.equal(ratingContext.comparison.evidenceStrength, 'LOW');
  assert.equal(ratingContext.comparison.absoluteMeanRatingDifferenceDeltaPoints, 400);

  const strongerNoIncrement = ratingComparison(opponentStrength, '180+0', 'STRONGER');
  const strongerIncrement = ratingComparison(opponentStrength, '180+2', 'STRONGER');
  assert.equal(strongerNoIncrement.deltas.averageScoreLossCp, 60);
  assert.equal(strongerNoIncrement.evidenceStrength.quality, 'LOW');
  assert.equal(strongerIncrement.deltas.averageScoreLossCp, 0);

  const incrementWithRating = await getIncrementEffect(
    FIXTURE_ACCOUNT_ID,
    {},
    {
      countCandidates: async () => noIncrement.length + increment.length,
      loadCandidates: async () => [...noIncrement, ...increment],
    },
    {
      loadOwnedRatingContext: async (appUserId, importedGameIds) => {
        assert.equal(appUserId, FIXTURE_ACCOUNT_ID);
        const requested = new Set(importedGameIds);
        return ratingRows.filter((row) => requested.has(row.importedGameId));
      },
    },
  );

  assert.equal(incrementWithRating.strata.length, 1);
  assert.equal(
    incrementWithRating.strata[0].ratingComposition.result?.comparison.materialCompositionWarning,
    true,
  );
  assert.deepEqual(
    incrementWithRating.strata[0].deltas,
    incrementEffect.strata[0].deltas,
  );
});

test('Phase 4B no-effect fixtures do not promote exposure into a positive mechanism', () => {
  const neutralFast = buildPlayedTooFastAggregate(fastAmpleCohort(601, 20, 20));
  assert.equal(neutralFast.comparison.fastAmple.eligibleMoves, 5);
  assert.equal(neutralFast.comparison.evidenceStrength, 'LOW');
  assert.equal(neutralFast.comparison.averageScoreLossDeltaCp, 0);
  assert.equal(neutralFast.comparison.mechanismStatus, 'NOT_SUPPORTED');

  const neutralEarly = buildEarlyTimeOveruseAggregate(earlyOveruseCohort(701, 10));
  assert.equal(neutralEarly.chain.earlyOveruseGames, 5);
  assert.equal(neutralEarly.chain.laterPressureGames, 5);
  assert.equal(neutralEarly.chain.evidenceStrength, 'LOW');
  assert.equal(neutralEarly.chain.averageLaterScoreLossDeltaCp, 0);
  assert.equal(neutralEarly.chain.completeChainGames, 0);
  assert.equal(neutralEarly.chain.mechanismStatus, 'NOT_SUPPORTED');
});
