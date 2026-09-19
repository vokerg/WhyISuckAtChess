import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MoveClassificationCode } from '@why-i-suck-at-chess/chess-domain';
import prismaModule from '../dist/prisma.js';
import { ImportedGamePlyIndexService } from '../dist/modules/imported-games/ply-index.service.js';
import {
  OPPONENT_MOVE_SPEED_EFFECT_MAX_CANDIDATE_GAMES,
  OPPONENT_MOVE_SPEED_EFFECT_POLICY_VERSION,
  buildOpponentMoveSpeedEffectAggregate,
  getOpponentMoveSpeedEffect,
} from '../dist/modules/diagnosis/opponent-move-speed-effect.service.js';
import {
  prismaOpponentMoveSpeedEffectRepository,
} from '../dist/modules/diagnosis/opponent-move-speed-effect.repository.prisma.js';
import {
  TIME_BEHAVIOR_POLICY_VERSION,
  TIME_FAST_OPPONENT_SEQUENCE_LENGTH,
  TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS,
} from '../dist/modules/timing/time-behavior-policy.js';
import {
  TIMING_DERIVATION_VERSION,
} from '../dist/modules/timing/timing-policy.js';

const prisma = prismaModule.default ?? prismaModule;
const PGN = '[Event "opponent speed fixture"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *';

function analysis(runId) {
  return {
    runId,
    snapshotId: 'snapshot-' + runId,
    analysisVersion: 'analysis-v1',
    settingsHash: 'settings-v1',
    engineName: 'Stockfish',
    engineVersion: '17',
  };
}

function ply(
  plyNumber,
  isUserMove,
  {
    moveTimeCentiseconds = 200,
    phase = 'MIDDLEGAME',
    scoreLossCp = isUserMove ? 20 : null,
    classificationCode = null,
    analysisRun = isUserMove ? analysis(plyNumber) : null,
    timingDerivationVersion = TIMING_DERIVATION_VERSION,
    timingDerivationStatus = 'AVAILABLE',
    timingReliabilityFlags = [],
  } = {},
) {
  return {
    plyNumber,
    isUserMove,
    moveTimeCentiseconds,
    timingDerivationVersion,
    timingDerivationStatus,
    timingReliabilityFlags,
    phase,
    scoreLossCp,
    classificationCode,
    analysis: analysisRun,
  };
}

function responsePair({
  opponentMoveTimeCentiseconds = 200,
  responseTimeCentiseconds = 300,
  phase = 'MIDDLEGAME',
  scoreLossCp = 20,
  classificationCode = null,
  analysisRun = analysis(Math.floor(Math.random() * 100000) + 1),
  opponentTimingDerivationStatus = 'AVAILABLE',
  userTimingDerivationStatus = 'AVAILABLE',
} = {}) {
  return [
    ply(4, false, {
      moveTimeCentiseconds: opponentMoveTimeCentiseconds,
      phase,
      timingDerivationStatus: opponentTimingDerivationStatus,
    }),
    ply(5, true, {
      moveTimeCentiseconds: responseTimeCentiseconds,
      phase,
      scoreLossCp,
      classificationCode,
      analysisRun,
      timingDerivationStatus: userTimingDerivationStatus,
    }),
  ];
}

function game(
  importedGameId,
  {
    exactTimeControlKey = '180+0',
    variant = 'standard',
    speedCategory = 'blitz',
    timingDerivationVersion = TIMING_DERIVATION_VERSION,
    plies = responsePair({ analysisRun: analysis(importedGameId) }),
  } = {},
) {
  return {
    importedGameId,
    variant,
    speedCategory,
    exactTimeControlKey,
    timingDerivationVersion,
    plies,
  };
}

test('TIME-007 compares response speed and quality after fast opponent moves', () => {
  const games = [
    ...Array.from({ length: 5 }, (_, index) => game(10 + index, {
      plies: responsePair({
        opponentMoveTimeCentiseconds: 250,
        responseTimeCentiseconds: 300,
        scoreLossCp: 10,
        analysisRun: analysis(100 + index),
      }),
    })),
    ...Array.from({ length: 5 }, (_, index) => game(20 + index, {
      plies: responsePair({
        opponentMoveTimeCentiseconds: TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS,
        responseTimeCentiseconds: 50,
        scoreLossCp: 80,
        classificationCode: MoveClassificationCode.Blunder,
        analysisRun: analysis(200 + index),
      }),
    })),
  ];

  const result = buildOpponentMoveSpeedEffectAggregate(games);

  assert.equal(result.diagnosisId, 'TIME-007');
  assert.equal(result.policyVersion, OPPONENT_MOVE_SPEED_EFFECT_POLICY_VERSION);
  assert.equal(result.timeBehaviorPolicyVersion, TIME_BEHAVIOR_POLICY_VERSION);
  assert.equal(result.timingDerivationVersion, TIMING_DERIVATION_VERSION);
  assert.equal(result.definitions.fastOpponentMoveMaxCentisecondsInclusive, 100);
  assert.equal(result.definitions.fastOpponentSequenceLength, TIME_FAST_OPPONENT_SEQUENCE_LENGTH);
  assert.deepEqual(result.definitions.matchingDimensions, ['EXACT_TIME_CONTROL', 'PHASE']);
  assert.equal(result.definitions.responseJoin, 'PRECEDING_PLY');
  assert.equal(result.coverage.status, 'COMPLETE');
  assert.equal(result.coverage.matchedStrata, 1);
  assert.equal(result.coverage.matchedResponses, 10);
  assert.equal(result.comparison.baseline.averageResponseTimeCentiseconds, 300);
  assert.equal(result.comparison.exposed.averageResponseTimeCentiseconds, 50);
  assert.equal(result.comparison.averageResponseTimeDeltaCentiseconds, -250);
  assert.equal(result.comparison.baseline.averageScoreLossCp, 10);
  assert.equal(result.comparison.exposed.averageScoreLossCp, 80);
  assert.equal(result.comparison.averageScoreLossDeltaCp, 70);
  assert.equal(result.comparison.blunderRateDeltaPercent, 100);
  assert.equal(result.comparison.evidenceStrength.timing, 'LOW');
  assert.equal(result.comparison.evidenceStrength.quality, 'LOW');
  assert.equal(result.recurrence.baselineGames, 5);
  assert.equal(result.recurrence.exposedGames, 5);
  assert.equal(result.strata.length, 1);
});

test('equal response speed and quality remain a no-effect measured result', () => {
  const result = buildOpponentMoveSpeedEffectAggregate([
    ...Array.from({ length: 5 }, (_, index) => game(30 + index, {
      plies: responsePair({
        opponentMoveTimeCentiseconds: 250,
        responseTimeCentiseconds: 120,
        scoreLossCp: 25,
        analysisRun: analysis(300 + index),
      }),
    })),
    ...Array.from({ length: 5 }, (_, index) => game(40 + index, {
      plies: responsePair({
        opponentMoveTimeCentiseconds: 50,
        responseTimeCentiseconds: 120,
        scoreLossCp: 25,
        analysisRun: analysis(400 + index),
      }),
    })),
  ]);

  assert.equal(result.comparison.averageResponseTimeDeltaCentiseconds, 0);
  assert.equal(result.comparison.averageScoreLossDeltaCp, 0);
  assert.equal(result.comparison.evidenceStrength.timing, 'LOW');
  assert.equal(result.comparison.evidenceStrength.quality, 'LOW');
});

test('missing opponent or user timing is explicit paired-timing coverage loss', () => {
  const result = buildOpponentMoveSpeedEffectAggregate([
    game(50, {
      plies: responsePair({
        opponentMoveTimeCentiseconds: 50,
        analysisRun: analysis(500),
      }),
    }),
    game(51, {
      plies: responsePair({
        opponentMoveTimeCentiseconds: 250,
        analysisRun: analysis(501),
      }),
    }),
    game(52, {
      plies: responsePair({
        opponentMoveTimeCentiseconds: 50,
        opponentTimingDerivationStatus: 'INCONSISTENT',
        analysisRun: analysis(502),
      }),
    }),
    game(53, {
      plies: responsePair({
        opponentMoveTimeCentiseconds: 250,
        userTimingDerivationStatus: 'UNAVAILABLE',
        analysisRun: analysis(503),
      }),
    }),
    game(54, {
      plies: [ply(5, true, {
        moveTimeCentiseconds: 200,
        analysisRun: analysis(504),
      })],
    }),
  ]);

  assert.equal(result.coverage.eligibleUserResponses, 5);
  assert.equal(result.coverage.precedingOpponentAvailableResponses, 4);
  assert.equal(result.coverage.missingPrecedingOpponentMoves, 1);
  assert.equal(result.coverage.opponentTimingCoveredResponses, 3);
  assert.equal(result.coverage.userTimingCoveredResponses, 3);
  assert.equal(result.coverage.timingCoveredResponsePairs, 2);
  assert.equal(result.coverage.timingCoveragePercent, 40);
  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.reason, 'paired-timing-coverage-incomplete');
  assert.equal(result.comparison.evidenceStrength.timing, 'INSUFFICIENT');
});

test('exact-control and phase matching excludes one-sided response strata', () => {
  const result = buildOpponentMoveSpeedEffectAggregate([
    game(60, {
      exactTimeControlKey: '180+0',
      plies: responsePair({
        opponentMoveTimeCentiseconds: 250,
        phase: 'OPENING',
        analysisRun: analysis(600),
      }),
    }),
    game(61, {
      exactTimeControlKey: '180+0',
      plies: responsePair({
        opponentMoveTimeCentiseconds: 50,
        phase: 'OPENING',
        analysisRun: analysis(601),
      }),
    }),
    game(62, {
      exactTimeControlKey: '180+2',
      plies: responsePair({
        opponentMoveTimeCentiseconds: 50,
        phase: 'OPENING',
        analysisRun: analysis(602),
      }),
    }),
    game(63, {
      exactTimeControlKey: '180+0',
      plies: responsePair({
        opponentMoveTimeCentiseconds: 250,
        phase: 'MIDDLEGAME',
        analysisRun: analysis(603),
      }),
    }),
  ]);

  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.reason, 'unmatched-comparison-context');
  assert.equal(result.coverage.matchedStrata, 1);
  assert.equal(result.coverage.matchedResponses, 2);
  assert.equal(result.coverage.unmatchedBaselineResponses, 1);
  assert.equal(result.coverage.unmatchedExposedResponses, 1);
  assert.equal(result.strata[0].exactTimeControlKey, '180+0');
  assert.equal(result.strata[0].phase, 'OPENING');
  assert.equal(result.phaseComposition.baseline.counts.OPENING, 1);
  assert.equal(result.phaseComposition.exposed.counts.OPENING, 1);
});

test('stale or missing engine analysis does not erase timing evidence', () => {
  const result = buildOpponentMoveSpeedEffectAggregate([
    ...Array.from({ length: 5 }, (_, index) => game(70 + index, {
      plies: responsePair({
        opponentMoveTimeCentiseconds: 250,
        responseTimeCentiseconds: 300,
        scoreLossCp: 10,
        analysisRun: analysis(700 + index),
      }),
    })),
    ...Array.from({ length: 5 }, (_, index) => game(80 + index, {
      plies: responsePair({
        opponentMoveTimeCentiseconds: 50,
        responseTimeCentiseconds: 100,
        scoreLossCp: 90,
        analysisRun: null,
      }),
    })),
  ]);

  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.reason, 'engine-analysis-incomplete');
  assert.equal(result.comparison.averageResponseTimeDeltaCentiseconds, -200);
  assert.equal(result.comparison.evidenceStrength.timing, 'LOW');
  assert.equal(result.comparison.averageScoreLossDeltaCp, null);
  assert.equal(result.comparison.evidenceStrength.quality, 'INSUFFICIENT');
});

test('fast-opponent sequences are counted across consecutive opponent decisions by ply identity', () => {
  const sequenceGame = game(90, {
    plies: [
      ply(4, false, { moveTimeCentiseconds: 50, phase: 'OPENING' }),
      ply(5, true, {
        moveTimeCentiseconds: 180,
        phase: 'OPENING',
        analysisRun: analysis(900),
      }),
      ply(6, false, { moveTimeCentiseconds: 80, phase: 'OPENING' }),
      ply(7, true, {
        moveTimeCentiseconds: 170,
        phase: 'OPENING',
        analysisRun: analysis(901),
      }),
    ],
  });
  const baseline = game(91, {
    plies: responsePair({
      opponentMoveTimeCentiseconds: 250,
      phase: 'OPENING',
      analysisRun: analysis(902),
    }),
  });

  const result = buildOpponentMoveSpeedEffectAggregate([sequenceGame, baseline]);

  assert.equal(result.recurrence.qualifyingFastOpponentSequences, 1);
  assert.equal(result.recurrence.exposedResponsesAfterFastSequence, 1);
  assert.equal(result.recurrence.gamesWithFastOpponentSequence, 1);
  assert.equal(result.comparison.exposed.eligibleResponses, 2);
});

test('service composes disjoint opponent-strength context without adjusting measured effects', async () => {
  const games = [
    ...Array.from({ length: 5 }, (_, index) => game(100 + index, {
      plies: responsePair({
        opponentMoveTimeCentiseconds: 250,
        responseTimeCentiseconds: 300,
        analysisRun: analysis(1000 + index),
      }),
    })),
    ...Array.from({ length: 5 }, (_, index) => game(110 + index, {
      plies: responsePair({
        opponentMoveTimeCentiseconds: 50,
        responseTimeCentiseconds: 100,
        analysisRun: analysis(1100 + index),
      }),
    })),
  ];

  const result = await getOpponentMoveSpeedEffect(
    7,
    {},
    {
      countCandidates: async () => games.length,
      loadCandidates: async () => games,
    },
    {
      loadOwnedRatingContext: async (_appUserId, ids) => ids.map((id) => ({
        importedGameId: id,
        userRating: 1500,
        opponentRating: id < 110 ? 1500 : 1700,
      })),
    },
  );

  assert.equal(result.ratingComposition.status, 'AVAILABLE');
  assert.equal(result.ratingComposition.result?.diagnosisId, 'RATING-002');
  assert.equal(result.comparison.averageResponseTimeDeltaCentiseconds, -200);
  assert.equal(
    result.ratingComposition.result?.comparison.materialCompositionWarning,
    true,
  );
});

test('service bounds reads, rejects snapshot drift, and validates scope', async () => {
  let loaded = false;
  const tooLarge = await getOpponentMoveSpeedEffect(
    7,
    {},
    {
      countCandidates: async () => OPPONENT_MOVE_SPEED_EFFECT_MAX_CANDIDATE_GAMES + 1,
      loadCandidates: async () => {
        loaded = true;
        return [];
      },
    },
    {
      loadOwnedRatingContext: async () => [],
    },
  );
  assert.equal(tooLarge.coverage.status, 'UNAVAILABLE');
  assert.equal(tooLarge.coverage.reason, 'opponent-move-speed-scope-too-large');
  assert.equal(loaded, false);

  const drifted = await getOpponentMoveSpeedEffect(
    7,
    {},
    {
      countCandidates: async () => 2,
      loadCandidates: async () => [game(1)],
    },
    {
      loadOwnedRatingContext: async () => [],
    },
  );
  assert.equal(drifted.coverage.reason, 'candidate-set-changed-during-read');

  await assert.rejects(
    getOpponentMoveSpeedEffect(
      7,
      {
        from: new Date('2026-09-19T12:00:00.000Z'),
        to: new Date('2026-09-19T12:00:00.000Z'),
      },
      {
        countCandidates: async () => 0,
        loadCandidates: async () => [],
      },
      {
        loadOwnedRatingContext: async () => [],
      },
    ),
    RangeError,
  );
});

test('Prisma repository is ownership/range bounded, returns both colors, and fences stale engine snapshots', async () => {
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
        timeControlRaw: '60+0',
        timeControlInitial: 60,
        timeControlIncrement: 0,
        timeControlSource: 'LICHESS_CLOCK_OBJECT',
        exactTimeControlKey: '60+0',
        startedAt,
        endedAt: new Date(startedAt.getTime() + 60_000),
        whiteUsername: 'FixtureUser',
        blackUsername: 'Opponent',
        whiteRating: 1500,
        blackRating: 1500,
        userColor: 'WHITE',
        status: 'resign',
        rawClockPresence: 'PRESENT',
        rawClockStateCount: 4,
        rawClockAnomalies: [],
        rawClockStates: {
          create: [5_000, 5_900, 4_900, 5_800].map((valueCentiseconds, index) => ({
            sourceOrdinal: index + 1,
            valueCentiseconds,
          })),
        },
      },
    });
  }

  try {
    const owner = await createUser('opponent-speed-owner-' + suffix);
    const other = await createUser('opponent-speed-other-' + suffix);
    const inRange = await createGame(
      owner.id,
      'opponent-speed-in-' + suffix,
      new Date('2026-09-19T10:00:00.000Z'),
    );
    await createGame(
      owner.id,
      'opponent-speed-out-' + suffix,
      new Date('2026-09-19T13:00:00.000Z'),
    );
    await createGame(
      other.id,
      'opponent-speed-foreign-' + suffix,
      new Date('2026-09-19T10:15:00.000Z'),
    );

    const indexed = await ImportedGamePlyIndexService.indexOne(owner.id, inRange.id);
    assert.equal(indexed.status, 'INDEXED');
    assert.ok(indexed.plyIndexedAt);

    await prisma.evidenceRun.create({
      data: {
        importedGameId: inRange.id,
        detectorKey: 'phase-context',
        detectorVersion: 'phase-v1',
        workKey: 'opponent-speed-phase-' + suffix,
        sourcePlyIndexedAt: indexed.plyIndexedAt,
        status: 'SUCCEEDED',
        coverageStatus: 'COMPLETE',
        isCurrent: true,
        events: {
          create: {
            evidenceKey: 'opponent-speed-phase-event-' + suffix,
            findingKey: 'phase-range-0',
            evidenceType: 'POSITION_PHASE_RANGE',
            availability: 'PRESENT',
            sourcePlyStart: 2,
            sourcePlyEnd: 4,
            measurementsJson: {
              positionCount: 3,
              startBoundaryPly: 2,
              endBoundaryPly: 4,
            },
            detailsJson: {
              phase: 'MIDDLEGAME',
              endgameFamily: 'NONE',
            },
          },
        },
      },
    });

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
          plyNumber: 3,
        },
      },
      data: {
        engineAnalysisRunId: currentRun.id,
        scoreLossCp: 120,
        classificationCode: MoveClassificationCode.Blunder,
      },
    });

    const scope = {
      from: new Date('2026-09-19T09:00:00.000Z'),
      to: new Date('2026-09-19T11:00:00.000Z'),
    };

    assert.equal(
      await prismaOpponentMoveSpeedEffectRepository.countCandidates(owner.id, scope),
      1,
    );

    let rows = await prismaOpponentMoveSpeedEffectRepository.loadCandidates(owner.id, scope);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].importedGameId, inRange.id);
    const userMove = rows[0].plies.find((row) => row.plyNumber === 3);
    const opponentMove = rows[0].plies.find((row) => row.plyNumber === 4);
    assert.ok(userMove);
    assert.ok(opponentMove);
    assert.equal(userMove.isUserMove, true);
    assert.equal(opponentMove.isUserMove, false);
    assert.equal(userMove.moveTimeCentiseconds, 100);
    assert.equal(opponentMove.moveTimeCentiseconds, 100);
    assert.equal(userMove.phase, 'MIDDLEGAME');
    assert.equal(userMove.analysis?.runId, currentRun.id);

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
          plyNumber: 3,
        },
      },
      data: {
        engineAnalysisRunId: staleRun.id,
      },
    });

    rows = await prismaOpponentMoveSpeedEffectRepository.loadCandidates(owner.id, scope);
    const staleUserMove = rows[0].plies.find((row) => row.plyNumber === 3);
    assert.ok(staleUserMove);
    assert.equal(staleUserMove.analysis, null);
  } finally {
    for (const id of userIds.reverse()) {
      await prisma.appUser.delete({ where: { id } }).catch(() => undefined);
    }
  }
});
