import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MoveClassificationCode } from '@why-i-suck-at-chess/chess-domain';
import prismaModule from '../dist/prisma.js';
import { ImportedGamePlyIndexService } from '../dist/modules/imported-games/ply-index.service.js';
import {
  TIME_PRESSURE_QUALITY_MAX_CANDIDATE_GAMES,
  TIME_PRESSURE_QUALITY_POLICY_VERSION,
  buildTimePressureQualityCollapseAggregate,
  getTimePressureQualityCollapse,
} from '../dist/modules/diagnosis/time-pressure-quality-collapse.service.js';
import {
  prismaTimePressureQualityRepository,
} from '../dist/modules/diagnosis/time-pressure-quality-collapse.repository.prisma.js';
import {
  TIME_BEHAVIOR_POLICY_VERSION,
} from '../dist/modules/timing/time-behavior-policy.js';
import {
  TIMING_DERIVATION_VERSION,
} from '../dist/modules/timing/timing-policy.js';

const prisma = prismaModule.default ?? prismaModule;
const PGN = '[Event "time pressure quality fixture"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *';

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
  clockBeforeMoveCentiseconds,
  {
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
    timeControlIncrement = 0,
    variant = 'standard',
    speedCategory = 'blitz',
    timingDerivationVersion = TIMING_DERIVATION_VERSION,
    userMoves = [move(3, 5_000)],
  } = {},
) {
  return {
    importedGameId,
    variant,
    speedCategory,
    exactTimeControlKey,
    timeControlInitial,
    timeControlIncrement,
    timingDerivationVersion,
    userMoves,
  };
}

test('TIME-002 compares pressure with exact-control and phase matched normal-clock moves', () => {
  const games = [
    ...Array.from({ length: 5 }, (_, index) => game(10 + index, {
      userMoves: [move(3, 5_000, {
        scoreLossCp: 20,
        analysisRun: analysis(100 + index),
      })],
    })),
    ...Array.from({ length: 5 }, (_, index) => game(20 + index, {
      userMoves: [move(3, 2_500, {
        scoreLossCp: 80,
        classificationCode: MoveClassificationCode.Blunder,
        analysisRun: analysis(200 + index),
      })],
    })),
  ];

  const result = buildTimePressureQualityCollapseAggregate(games);

  assert.equal(result.diagnosisId, 'TIME-002');
  assert.equal(result.policyVersion, TIME_PRESSURE_QUALITY_POLICY_VERSION);
  assert.equal(result.timeBehaviorPolicyVersion, TIME_BEHAVIOR_POLICY_VERSION);
  assert.equal(result.timingDerivationVersion, TIMING_DERIVATION_VERSION);
  assert.equal(result.coverage.status, 'COMPLETE');
  assert.equal(result.coverage.matchedStrata, 1);
  assert.equal(result.coverage.matchedUserDecisions, 10);
  assert.equal(result.coverage.analysisCoveragePercent, 100);
  assert.equal(result.comparison.baseline.eligibleMoves, 5);
  assert.equal(result.comparison.pressure.eligibleMoves, 5);
  assert.equal(result.comparison.baseline.supportingGames, 5);
  assert.equal(result.comparison.pressure.supportingGames, 5);
  assert.equal(result.comparison.baseline.averageScoreLossCp, 20);
  assert.equal(result.comparison.pressure.averageScoreLossCp, 80);
  assert.equal(result.comparison.averageScoreLossDeltaCp, 60);
  assert.equal(result.comparison.majorErrorRateDeltaPercent, 100);
  assert.equal(result.comparison.blunderRateDeltaPercent, 100);
  assert.equal(result.comparison.evidenceStrength, 'LOW');
  assert.equal(result.strata.length, 1);
  assert.equal(result.strata[0].exactTimeControlKey, '180+0');
  assert.equal(result.strata[0].phase, 'MIDDLEGAME');
  assert.equal(result.analysisProvenance.analysedRuns, 10);
});

test('one-sided exact-control and phase strata stay explicit instead of being pooled', () => {
  const result = buildTimePressureQualityCollapseAggregate([
    game(1, {
      exactTimeControlKey: '180+0',
      userMoves: [move(3, 5_000, { phase: 'OPENING', analysisRun: analysis(1) })],
    }),
    game(2, {
      exactTimeControlKey: '180+0',
      userMoves: [move(3, 2_500, { phase: 'OPENING', analysisRun: analysis(2) })],
    }),
    game(3, {
      exactTimeControlKey: '180+2',
      timeControlIncrement: 2,
      userMoves: [move(3, 2_500, { phase: 'OPENING', analysisRun: analysis(3) })],
    }),
    game(4, {
      exactTimeControlKey: '180+0',
      userMoves: [move(3, 5_000, { phase: 'MIDDLEGAME', analysisRun: analysis(4) })],
    }),
  ]);

  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.reason, 'unmatched-comparison-context');
  assert.equal(result.coverage.contextEligibleUserDecisions, 4);
  assert.equal(result.coverage.matchedUserDecisions, 2);
  assert.equal(result.coverage.matchingCoveragePercent, 50);
  assert.equal(result.coverage.unmatchedBaselineMoves, 1);
  assert.equal(result.coverage.unmatchedPressureMoves, 1);
  assert.equal(result.strata.length, 1);
  assert.equal(result.strata[0].exactTimeControlKey, '180+0');
  assert.equal(result.strata[0].phase, 'OPENING');
});

test('timing, phase, exact-control, and current-analysis gaps remain coverage loss', () => {
  const result = buildTimePressureQualityCollapseAggregate([
    game(10, {
      userMoves: [move(3, 5_000, { analysisRun: analysis(10) })],
    }),
    game(11, {
      userMoves: [move(3, 2_500, { analysisRun: analysis(11) })],
    }),
    game(12, {
      userMoves: [move(3, 5_000, {
        timingReliabilityFlags: ['POSSIBLE_EXTERNAL_CLOCK_ADJUSTMENT'],
        analysisRun: analysis(12),
      })],
    }),
    game(13, {
      exactTimeControlKey: null,
      userMoves: [move(3, 2_500, { analysisRun: analysis(13) })],
    }),
    game(14, {
      userMoves: [move(3, 5_000, {
        phase: null,
        analysisRun: analysis(14),
      })],
    }),
    game(15, {
      userMoves: [move(3, 2_500, {
        scoreLossCp: 90,
        analysisRun: null,
      })],
    }),
  ]);

  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.reason, 'timing-coverage-incomplete');
  assert.equal(result.coverage.timingEligibleUserDecisions, 6);
  assert.equal(result.coverage.timingCoveredUserDecisions, 5);
  assert.equal(result.coverage.timingCoveragePercent, 83.3);
  assert.equal(result.coverage.missingExactControlMoves, 1);
  assert.equal(result.coverage.missingPhaseMoves, 1);
  assert.equal(result.coverage.contextCoveragePercent, 60);
  assert.equal(result.comparison.pressure.analysisCoveragePercent, 50);
  assert.equal(result.comparison.evidenceStrength, 'INSUFFICIENT');
});

test('engine gaps cannot make the quality comparison cross exact-control/phase strata', () => {
  const result = buildTimePressureQualityCollapseAggregate([
    game(20, {
      userMoves: [move(3, 5_000, {
        phase: 'OPENING',
        scoreLossCp: 10,
        analysisRun: analysis(20),
      })],
    }),
    game(21, {
      userMoves: [move(3, 2_500, {
        phase: 'OPENING',
        scoreLossCp: 90,
        analysisRun: null,
      })],
    }),
    game(22, {
      userMoves: [move(3, 5_000, {
        phase: 'MIDDLEGAME',
        scoreLossCp: 10,
        analysisRun: null,
      })],
    }),
    game(23, {
      userMoves: [move(3, 2_500, {
        phase: 'MIDDLEGAME',
        scoreLossCp: 90,
        analysisRun: analysis(23),
      })],
    }),
  ]);

  assert.equal(result.coverage.matchedStrata, 2);
  assert.equal(result.coverage.status, 'UNAVAILABLE');
  assert.equal(result.coverage.reason, 'engine-analysis-unavailable-in-comparison-arm');
  assert.equal(result.coverage.analysisCoveragePercent, 0);
  assert.equal(result.comparison.baseline.analysedMoves, 0);
  assert.equal(result.comparison.pressure.analysedMoves, 0);
  assert.equal(result.comparison.averageScoreLossDeltaCp, null);
  assert.equal(result.analysisProvenance.analysedRuns, 0);
});

test('negative and neutral pressure deltas are representable without forcing a positive mechanism', () => {
  const betterUnderPressure = buildTimePressureQualityCollapseAggregate([
    game(30, {
      userMoves: [move(3, 5_000, { scoreLossCp: 40, analysisRun: analysis(30) })],
    }),
    game(31, {
      userMoves: [move(3, 2_500, { scoreLossCp: 10, analysisRun: analysis(31) })],
    }),
  ]);
  assert.equal(betterUnderPressure.comparison.averageScoreLossDeltaCp, -30);

  const neutral = buildTimePressureQualityCollapseAggregate([
    game(32, {
      userMoves: [move(3, 5_000, { scoreLossCp: 25, analysisRun: analysis(32) })],
    }),
    game(33, {
      userMoves: [move(3, 2_500, { scoreLossCp: 25, analysisRun: analysis(33) })],
    }),
  ]);
  assert.equal(neutral.comparison.averageScoreLossDeltaCp, 0);
});

test('service bounds reads, rejects snapshot drift, and attaches RATING-002 only for disjoint analysed game arms', async () => {
  let loaded = false;
  const tooLarge = await getTimePressureQualityCollapse(
    7,
    {},
    {
      countCandidates: async () => TIME_PRESSURE_QUALITY_MAX_CANDIDATE_GAMES + 1,
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
  assert.equal(tooLarge.coverage.reason, 'time-pressure-quality-scope-too-large');
  assert.equal(loaded, false);

  const drifted = await getTimePressureQualityCollapse(
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

  const disjointGames = [
    ...Array.from({ length: 5 }, (_, index) => game(100 + index, {
      userMoves: [move(3, 5_000, { analysisRun: analysis(1000 + index) })],
    })),
    ...Array.from({ length: 5 }, (_, index) => game(200 + index, {
      userMoves: [move(3, 2_500, { analysisRun: analysis(2000 + index) })],
    })),
  ];
  let ratingIds = [];
  const withRating = await getTimePressureQualityCollapse(
    9,
    {},
    {
      countCandidates: async () => disjointGames.length,
      loadCandidates: async () => disjointGames,
    },
    {
      loadOwnedRatingContext: async (appUserId, importedGameIds) => {
        assert.equal(appUserId, 9);
        ratingIds = [...importedGameIds];
        return importedGameIds.map((importedGameId) => ({
          importedGameId,
          userRating: 1500,
          opponentRating: 1500,
        }));
      },
    },
  );

  assert.equal(withRating.ratingComposition.status, 'AVAILABLE');
  assert.equal(withRating.ratingComposition.result?.diagnosisId, 'RATING-002');
  assert.equal(withRating.ratingComposition.result?.comparison.materialCompositionWarning, false);
  assert.equal(ratingIds.length, 10);

  let overlapRatingCalled = false;
  const overlapping = await getTimePressureQualityCollapse(
    9,
    {},
    {
      countCandidates: async () => 1,
      loadCandidates: async () => [game(300, {
        userMoves: [
          move(3, 5_000, { analysisRun: analysis(3001) }),
          move(5, 2_500, { analysisRun: analysis(3002) }),
        ],
      })],
    },
    {
      loadOwnedRatingContext: async () => {
        overlapRatingCalled = true;
        return [];
      },
    },
  );
  assert.equal(overlapping.ratingComposition.status, 'UNAVAILABLE');
  assert.equal(overlapping.ratingComposition.reason, 'comparison-game-arms-overlap');
  assert.equal(overlapRatingCalled, false);

  await assert.rejects(
    getTimePressureQualityCollapse(
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

  async function createGame(appUserId, providerGameId, startedAt, clocks) {
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
        rawClockStateCount: clocks.length,
        rawClockAnomalies: [],
        rawClockStates: {
          create: clocks.map((valueCentiseconds, index) => ({
            sourceOrdinal: index + 1,
            valueCentiseconds,
          })),
        },
      },
    });
  }

  try {
    const owner = await createUser('time-pressure-quality-owner-' + suffix);
    const other = await createUser('time-pressure-quality-other-' + suffix);
    const inRange = await createGame(
      owner.id,
      'time-pressure-quality-in-' + suffix,
      new Date('2026-09-19T10:00:00.000Z'),
      [2_500, 5_900, 2_400, 5_800],
    );
    await createGame(
      owner.id,
      'time-pressure-quality-out-' + suffix,
      new Date('2026-09-19T13:00:00.000Z'),
      [5_000, 5_900, 4_900, 5_800],
    );
    await createGame(
      other.id,
      'time-pressure-quality-foreign-' + suffix,
      new Date('2026-09-19T10:15:00.000Z'),
      [5_000, 5_900, 4_900, 5_800],
    );

    const indexed = await ImportedGamePlyIndexService.indexOne(owner.id, inRange.id);
    assert.equal(indexed.status, 'INDEXED');
    assert.ok(indexed.plyIndexedAt);

    await prisma.evidenceRun.create({
      data: {
        importedGameId: inRange.id,
        detectorKey: 'phase-context',
        detectorVersion: 'phase-v1',
        workKey: 'time-pressure-quality-phase-' + suffix,
        sourcePlyIndexedAt: indexed.plyIndexedAt,
        status: 'SUCCEEDED',
        coverageStatus: 'COMPLETE',
        isCurrent: true,
        events: {
          create: {
            evidenceKey: 'tpq-phase-event-' + suffix,
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
      await prismaTimePressureQualityRepository.countCandidates(owner.id, scope),
      1,
    );

    let rows = await prismaTimePressureQualityRepository.loadCandidates(owner.id, scope);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].importedGameId, inRange.id);
    const currentMove = rows[0].userMoves.find((row) => row.plyNumber === 3);
    assert.ok(currentMove);
    assert.equal(currentMove.phase, 'MIDDLEGAME');
    assert.equal(currentMove.scoreLossCp, 120);
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

    rows = await prismaTimePressureQualityRepository.loadCandidates(owner.id, scope);
    const staleMove = rows[0].userMoves.find((row) => row.plyNumber === 3);
    assert.ok(staleMove);
    assert.equal(staleMove.analysis, null);
  } finally {
    for (const id of userIds.reverse()) {
      await prisma.appUser.delete({ where: { id } }).catch(() => undefined);
    }
  }
});
