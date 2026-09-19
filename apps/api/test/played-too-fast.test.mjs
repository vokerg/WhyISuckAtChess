import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MoveClassificationCode } from '@why-i-suck-at-chess/chess-domain';
import prismaModule from '../dist/prisma.js';
import { ImportedGamePlyIndexService } from '../dist/modules/imported-games/ply-index.service.js';
import {
  PLAYED_TOO_FAST_MAX_CANDIDATE_GAMES,
  PLAYED_TOO_FAST_POLICY_VERSION,
  buildPlayedTooFastAggregate,
  getPlayedTooFast,
} from '../dist/modules/diagnosis/played-too-fast.service.js';
import {
  prismaPlayedTooFastRepository,
} from '../dist/modules/diagnosis/played-too-fast.repository.prisma.js';
import {
  TIME_BEHAVIOR_POLICY_VERSION,
  TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS,
} from '../dist/modules/timing/time-behavior-policy.js';
import {
  TIMING_DERIVATION_VERSION,
} from '../dist/modules/timing/timing-policy.js';

const prisma = prismaModule.default ?? prismaModule;
const PGN = '[Event "played too fast fixture"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *';

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

function move(
  plyNumber,
  {
    clockBeforeMoveCentiseconds = 5_000,
    moveTimeCentiseconds = 200,
    phase = 'MIDDLEGAME',
    scoreLossCp = 20,
    classificationCode = null,
    analysisRun = analysis(plyNumber),
    timingDerivationVersion = TIMING_DERIVATION_VERSION,
    timingDerivationStatus = 'AVAILABLE',
    timingReliabilityFlags = [],
  } = {},
) {
  return {
    plyNumber,
    clockBeforeMoveCentiseconds,
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

function game(
  importedGameId,
  {
    exactTimeControlKey = '180+0',
    timeControlInitial = 180,
    variant = 'standard',
    speedCategory = 'blitz',
    timingDerivationVersion = TIMING_DERIVATION_VERSION,
    userMoves = [move(3)],
  } = {},
) {
  return {
    importedGameId,
    variant,
    speedCategory,
    exactTimeControlKey,
    timeControlInitial,
    timingDerivationVersion,
    userMoves,
  };
}

test('TIME-003 identifies repeated fast ample-clock decisions with worse matched quality', () => {
  const games = [
    ...Array.from({ length: 5 }, (_, index) => game(10 + index, {
      userMoves: [move(3, {
        moveTimeCentiseconds: 200,
        scoreLossCp: 10,
        analysisRun: analysis(100 + index),
      })],
    })),
    ...Array.from({ length: 5 }, (_, index) => game(20 + index, {
      userMoves: [move(3, {
        moveTimeCentiseconds: TIME_UNUSUALLY_FAST_MOVE_CENTISECONDS,
        scoreLossCp: 80,
        classificationCode: MoveClassificationCode.Blunder,
        analysisRun: analysis(200 + index),
      })],
    })),
  ];

  const result = buildPlayedTooFastAggregate(games);

  assert.equal(result.diagnosisId, 'TIME-003');
  assert.equal(result.policyVersion, PLAYED_TOO_FAST_POLICY_VERSION);
  assert.equal(result.timeBehaviorPolicyVersion, TIME_BEHAVIOR_POLICY_VERSION);
  assert.equal(result.timingDerivationVersion, TIMING_DERIVATION_VERSION);
  assert.equal(result.definitions.fastDecisionMaxCentisecondsInclusive, 100);
  assert.deepEqual(result.definitions.matchingDimensions, ['EXACT_TIME_CONTROL', 'PHASE']);
  assert.equal(result.coverage.status, 'COMPLETE');
  assert.equal(result.coverage.matchedStrata, 1);
  assert.equal(result.coverage.matchedUserDecisions, 10);
  assert.equal(result.comparison.baseline.averageScoreLossCp, 10);
  assert.equal(result.comparison.fastAmple.averageScoreLossCp, 80);
  assert.equal(result.comparison.averageScoreLossDeltaCp, 70);
  assert.equal(result.comparison.blunderRateDeltaPercent, 100);
  assert.equal(result.comparison.evidenceStrength, 'LOW');
  assert.equal(result.comparison.mechanismStatus, 'WORSE_QUALITY_ASSOCIATION');
  assert.equal(result.recurrence.analysedBaselineGames, 5);
  assert.equal(result.recurrence.analysedFastAmpleGames, 5);
  assert.equal(result.strata.length, 1);
});

test('fast ample-clock moves with equal or better quality do not produce a positive mechanism finding', () => {
  const games = [
    ...Array.from({ length: 5 }, (_, index) => game(30 + index, {
      userMoves: [move(3, {
        moveTimeCentiseconds: 250,
        scoreLossCp: 30,
        analysisRun: analysis(300 + index),
      })],
    })),
    ...Array.from({ length: 5 }, (_, index) => game(40 + index, {
      userMoves: [move(3, {
        moveTimeCentiseconds: 50,
        scoreLossCp: 10,
        analysisRun: analysis(400 + index),
      })],
    })),
  ];

  const result = buildPlayedTooFastAggregate(games);

  assert.equal(result.comparison.averageScoreLossDeltaCp, -20);
  assert.equal(result.comparison.evidenceStrength, 'LOW');
  assert.equal(result.comparison.mechanismStatus, 'NOT_SUPPORTED');

  const neutral = buildPlayedTooFastAggregate([
    ...Array.from({ length: 5 }, (_, index) => game(50 + index, {
      userMoves: [move(3, {
        moveTimeCentiseconds: 250,
        scoreLossCp: 20,
        analysisRun: analysis(500 + index),
      })],
    })),
    ...Array.from({ length: 5 }, (_, index) => game(60 + index, {
      userMoves: [move(3, {
        moveTimeCentiseconds: 100,
        scoreLossCp: 20,
        analysisRun: analysis(600 + index),
      })],
    })),
  ]);
  assert.equal(neutral.comparison.averageScoreLossDeltaCp, 0);
  assert.equal(neutral.comparison.mechanismStatus, 'NOT_SUPPORTED');
});

test('fast decisions without ample clock are excluded from PLAYED_TOO_FAST exposure', () => {
  const result = buildPlayedTooFastAggregate([
    game(70, {
      userMoves: [move(3, {
        moveTimeCentiseconds: 50,
        clockBeforeMoveCentiseconds: 4_000,
        scoreLossCp: 90,
        analysisRun: analysis(700),
      })],
    }),
    game(71, {
      userMoves: [move(3, {
        moveTimeCentiseconds: 50,
        scoreLossCp: 80,
        analysisRun: analysis(701),
      })],
    }),
    game(72, {
      userMoves: [move(3, {
        moveTimeCentiseconds: 300,
        scoreLossCp: 20,
        analysisRun: analysis(702),
      })],
    }),
  ]);

  assert.equal(result.coverage.fastWithoutAmpleClockMoves, 1);
  assert.equal(result.coverage.nonAmpleClockUserDecisions, 1);
  assert.equal(result.coverage.ampleClockUserDecisions, 2);
  assert.equal(result.comparison.fastAmple.eligibleMoves, 1);
  assert.equal(result.comparison.baseline.eligibleMoves, 1);
  assert.equal(result.coverage.status, 'COMPLETE');
});

test('first-move, unreliable, missing-initial, context, and engine gaps remain explicit coverage loss', () => {
  const result = buildPlayedTooFastAggregate([
    game(80, {
      userMoves: [
        move(1, { moveTimeCentiseconds: null, clockBeforeMoveCentiseconds: null }),
        move(3, { moveTimeCentiseconds: 50, analysisRun: analysis(800) }),
      ],
    }),
    game(81, {
      userMoves: [move(3, {
        moveTimeCentiseconds: 250,
        analysisRun: analysis(801),
      })],
    }),
    game(82, {
      userMoves: [move(3, {
        moveTimeCentiseconds: 50,
        timingDerivationStatus: 'INCONSISTENT',
        analysisRun: analysis(802),
      })],
    }),
    game(83, {
      timeControlInitial: null,
      userMoves: [move(3, {
        moveTimeCentiseconds: 250,
        analysisRun: analysis(803),
      })],
    }),
    game(84, {
      exactTimeControlKey: null,
      userMoves: [move(3, {
        moveTimeCentiseconds: 250,
        analysisRun: analysis(804),
      })],
    }),
    game(85, {
      userMoves: [move(3, {
        moveTimeCentiseconds: 250,
        phase: null,
        analysisRun: analysis(805),
      })],
    }),
    game(86, {
      userMoves: [move(3, {
        moveTimeCentiseconds: 50,
        scoreLossCp: 100,
        analysisRun: null,
      })],
    }),
  ]);

  assert.equal(result.coverage.timingEligibleUserDecisions, 7);
  assert.equal(result.coverage.timingCoveredUserDecisions, 6);
  assert.equal(result.coverage.timingCoveragePercent, 85.7);
  assert.equal(result.coverage.unknownAmpleClockUserDecisions, 1);
  assert.equal(result.coverage.missingExactControlMoves, 1);
  assert.equal(result.coverage.missingPhaseMoves, 1);
  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.reason, 'timing-coverage-incomplete');
  assert.equal(result.comparison.fastAmple.analysisCoveragePercent, 50);
  assert.equal(result.comparison.evidenceStrength, 'INSUFFICIENT');
  assert.equal(result.comparison.mechanismStatus, 'INSUFFICIENT');
});

test('exact-control and phase matching never pools one-sided fast and baseline moves', () => {
  const result = buildPlayedTooFastAggregate([
    game(90, {
      exactTimeControlKey: '180+0',
      userMoves: [move(3, {
        phase: 'OPENING',
        moveTimeCentiseconds: 250,
        analysisRun: analysis(900),
      })],
    }),
    game(91, {
      exactTimeControlKey: '180+0',
      userMoves: [move(3, {
        phase: 'OPENING',
        moveTimeCentiseconds: 50,
        analysisRun: analysis(901),
      })],
    }),
    game(92, {
      exactTimeControlKey: '180+2',
      userMoves: [move(3, {
        phase: 'OPENING',
        moveTimeCentiseconds: 50,
        analysisRun: analysis(902),
      })],
    }),
    game(93, {
      exactTimeControlKey: '180+0',
      userMoves: [move(3, {
        phase: 'MIDDLEGAME',
        moveTimeCentiseconds: 250,
        analysisRun: analysis(903),
      })],
    }),
  ]);

  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.reason, 'unmatched-comparison-context');
  assert.equal(result.coverage.matchedStrata, 1);
  assert.equal(result.coverage.matchedUserDecisions, 2);
  assert.equal(result.coverage.unmatchedFastMoves, 1);
  assert.equal(result.coverage.unmatchedBaselineMoves, 1);
  assert.equal(result.strata.length, 1);
  assert.equal(result.strata[0].exactTimeControlKey, '180+0');
  assert.equal(result.strata[0].phase, 'OPENING');
});

test('fast-arm matching coverage gates evidence independently of the baseline arm', () => {
  const matchedBaseline = Array.from({ length: 100 }, (_, index) => game(1_000 + index, {
    exactTimeControlKey: '180+0',
    userMoves: [move(3, {
      phase: 'OPENING',
      moveTimeCentiseconds: 250,
      scoreLossCp: 10,
      analysisRun: analysis(10_000 + index),
    })],
  }));
  const matchedFast = Array.from({ length: 5 }, (_, index) => game(2_000 + index, {
    exactTimeControlKey: '180+0',
    userMoves: [move(3, {
      phase: 'OPENING',
      moveTimeCentiseconds: 50,
      scoreLossCp: 80,
      analysisRun: analysis(20_000 + index),
    })],
  }));
  const unmatchedFast = Array.from({ length: 95 }, (_, index) => game(3_000 + index, {
    exactTimeControlKey: '180+2',
    userMoves: [move(3, {
      phase: 'OPENING',
      moveTimeCentiseconds: 50,
      scoreLossCp: 80,
      analysisRun: analysis(30_000 + index),
    })],
  }));

  const result = buildPlayedTooFastAggregate([
    ...matchedBaseline,
    ...matchedFast,
    ...unmatchedFast,
  ]);

  assert.equal(result.coverage.matchingCoveragePercent, 52.5);
  assert.equal(result.comparison.baseline.requiredEvidenceCoveragePercent, 100);
  assert.equal(result.comparison.fastAmple.requiredEvidenceCoveragePercent, 5);
  assert.equal(result.comparison.averageScoreLossDeltaCp, 70);
  assert.equal(result.comparison.evidenceStrength, 'INSUFFICIENT');
  assert.equal(result.comparison.mechanismStatus, 'INSUFFICIENT');
});

test('service bounds reads, rejects snapshot drift, and validates scope', async () => {
  let loaded = false;
  const tooLarge = await getPlayedTooFast(
    7,
    {},
    {
      countCandidates: async () => PLAYED_TOO_FAST_MAX_CANDIDATE_GAMES + 1,
      loadCandidates: async () => {
        loaded = true;
        return [];
      },
    },
  );
  assert.equal(tooLarge.coverage.status, 'UNAVAILABLE');
  assert.equal(tooLarge.coverage.reason, 'played-too-fast-scope-too-large');
  assert.equal(loaded, false);

  const drifted = await getPlayedTooFast(
    7,
    {},
    {
      countCandidates: async () => 2,
      loadCandidates: async () => [game(1)],
    },
  );
  assert.equal(drifted.coverage.reason, 'candidate-set-changed-during-read');

  await assert.rejects(
    getPlayedTooFast(
      7,
      {
        from: new Date('2026-09-19T12:00:00.000Z'),
        to: new Date('2026-09-19T12:00:00.000Z'),
      },
      {
        countCandidates: async () => 0,
        loadCandidates: async () => [],
      },
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
    const owner = await createUser('played-too-fast-owner-' + suffix);
    const other = await createUser('played-too-fast-other-' + suffix);
    const inRange = await createGame(
      owner.id,
      'played-too-fast-in-' + suffix,
      new Date('2026-09-19T10:00:00.000Z'),
    );
    await createGame(
      owner.id,
      'played-too-fast-out-' + suffix,
      new Date('2026-09-19T13:00:00.000Z'),
    );
    await createGame(
      other.id,
      'played-too-fast-foreign-' + suffix,
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
        workKey: 'played-too-fast-phase-' + suffix,
        sourcePlyIndexedAt: indexed.plyIndexedAt,
        status: 'SUCCEEDED',
        coverageStatus: 'COMPLETE',
        isCurrent: true,
        events: {
          create: {
            evidenceKey: 'ptf-phase-event-' + suffix,
            findingKey: 'phase-range-0',
            evidenceType: 'POSITION_PHASE_RANGE',
            availability: 'PRESENT',
            sourcePlyStart: 2,
            sourcePlyEnd: 2,
            measurementsJson: {
              positionCount: 1,
              startBoundaryPly: 2,
              endBoundaryPly: 2,
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
      await prismaPlayedTooFastRepository.countCandidates(owner.id, scope),
      1,
    );

    let rows = await prismaPlayedTooFastRepository.loadCandidates(owner.id, scope);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].importedGameId, inRange.id);
    const currentMove = rows[0].userMoves.find((row) => row.plyNumber === 3);
    assert.ok(currentMove);
    assert.equal(currentMove.clockBeforeMoveCentiseconds, 5_000);
    assert.equal(currentMove.moveTimeCentiseconds, 100);
    assert.equal(currentMove.phase, 'MIDDLEGAME');
    assert.equal(currentMove.analysis?.runId, currentRun.id);

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

    rows = await prismaPlayedTooFastRepository.loadCandidates(owner.id, scope);
    const staleMove = rows[0].userMoves.find((row) => row.plyNumber === 3);
    assert.ok(staleMove);
    assert.equal(staleMove.analysis, null);
  } finally {
    for (const id of userIds.reverse()) {
      await prisma.appUser.delete({ where: { id } }).catch(() => undefined);
    }
  }
});
