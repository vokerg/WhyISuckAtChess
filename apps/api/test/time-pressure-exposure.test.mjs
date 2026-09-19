import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import prismaModule from '../dist/prisma.js';
import { ImportedGamePlyIndexService } from '../dist/modules/imported-games/ply-index.service.js';
import {
  TIME_PRESSURE_EXPOSURE_MAX_CANDIDATE_GAMES,
  TIME_PRESSURE_EXPOSURE_POLICY_VERSION,
  buildTimePressureExposureAggregate,
  getTimePressureExposure,
} from '../dist/modules/diagnosis/time-pressure-exposure.service.js';
import {
  prismaTimePressureExposureRepository,
} from '../dist/modules/diagnosis/time-pressure-exposure.repository.prisma.js';
import {
  TIME_BEHAVIOR_POLICY_VERSION,
} from '../dist/modules/timing/time-behavior-policy.js';
import {
  TIMING_DERIVATION_VERSION,
} from '../dist/modules/timing/timing-policy.js';

const prisma = prismaModule.default ?? prismaModule;
const PGN = '[Event "time pressure fixture"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *';

function timingMove(
  plyNumber,
  clockBeforeMoveCentiseconds,
  {
    phase = null,
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
  };
}

function sourceGame(
  importedGameId,
  {
    exactTimeControlKey = '180+0',
    timeControlInitial = 180,
    timeControlIncrement = 0,
    variant = 'standard',
    speedCategory = 'blitz',
    timingDerivationVersion = TIMING_DERIVATION_VERSION,
    userMoves = [timingMove(3, 6_000)],
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

test('classifies exact pressure boundaries and records deterministic first entry', () => {
  const result = buildTimePressureExposureAggregate([
    sourceGame(1, {
      userMoves: [
        timingMove(3, 3_001, { phase: 'OPENING' }),
        timingMove(5, 3_000, { phase: 'OPENING' }),
        timingMove(7, 1_000, { phase: 'MIDDLEGAME' }),
      ],
    }),
  ]);

  assert.equal(result.diagnosisId, 'TIME-001');
  assert.equal(result.policyVersion, TIME_PRESSURE_EXPOSURE_POLICY_VERSION);
  assert.equal(result.timeBehaviorPolicyVersion, TIME_BEHAVIOR_POLICY_VERSION);
  assert.equal(result.timingDerivationVersion, TIMING_DERIVATION_VERSION);
  assert.equal(result.coverage.status, 'COMPLETE');
  assert.equal(result.coverage.eligibleGames, 1);
  assert.equal(result.coverage.timingCoveredGames, 1);
  assert.equal(result.exposure.eligibleUserDecisions, 3);
  assert.equal(result.exposure.bands.NORMAL.moves, 1);
  assert.equal(result.exposure.bands.PRESSURE.moves, 1);
  assert.equal(result.exposure.bands.CRITICAL.moves, 1);
  assert.equal(result.exposure.pressureMoves, 2);
  assert.equal(result.exposure.pressureMoveRatePercent, 66.7);
  assert.equal(result.exposure.pressureEnteringGames, 1);
  assert.equal(result.exposure.pressureEntryRatePercent, 100);
  assert.deepEqual(result.exposure.firstEntry.plyCounts, [{ plyNumber: 5, games: 1 }]);
  assert.equal(result.exposure.firstEntry.averagePly, 5);
  assert.equal(result.exposure.firstEntry.earliestPly, 5);
  assert.equal(result.exposure.firstEntry.latestPly, 5);
  assert.equal(result.exposure.firstEntry.phaseCoveredGames, 1);
  assert.equal(result.exposure.firstEntry.phaseCoveragePercent, 100);
  assert.equal(result.exposure.firstEntry.phaseCounts.OPENING, 1);
});

test('keeps increment and exact-control populations distinct in the exposure breakdown', () => {
  const result = buildTimePressureExposureAggregate([
    sourceGame(10, {
      exactTimeControlKey: '180+0',
      timeControlIncrement: 0,
      userMoves: [timingMove(3, 2_500, { phase: 'MIDDLEGAME' })],
    }),
    sourceGame(11, {
      exactTimeControlKey: '180+2',
      timeControlIncrement: 2,
      userMoves: [timingMove(3, 4_500, { phase: null })],
    }),
  ]);

  assert.equal(result.coverage.status, 'COMPLETE');
  assert.equal(result.contextBreakdown.length, 2);
  assert.deepEqual(
    result.contextBreakdown.map((row) => [
      row.exactTimeControlKey,
      row.incrementSeconds,
      row.timingCoveredGames,
      row.pressureEnteringGames,
    ]),
    [
      ['180+0', 0, 1, 1],
      ['180+2', 2, 1, 0],
    ],
  );
  assert.equal(result.contextBreakdown[0].pressureEntryRatePercent, 100);
  assert.equal(result.contextBreakdown[1].pressureEntryRatePercent, 0);
  assert.equal(result.exposure.firstEntry.phaseCounts.MIDDLEGAME, 1);
});

test('partial, inconsistent, unsupported, and unreliable timing remain explicit coverage loss', () => {
  const result = buildTimePressureExposureAggregate([
    sourceGame(20, {
      userMoves: [
        timingMove(3, 6_000),
        timingMove(5, 2_000),
      ],
    }),
    sourceGame(21, {
      userMoves: [
        timingMove(3, 2_000),
        timingMove(5, null, { timingDerivationStatus: 'UNAVAILABLE' }),
      ],
    }),
    sourceGame(22, {
      variant: 'chess960',
      userMoves: [timingMove(3, 2_000)],
    }),
    sourceGame(23, {
      timingDerivationVersion: null,
      userMoves: [timingMove(3, 2_000)],
    }),
    sourceGame(24, {
      userMoves: [
        timingMove(3, 2_000, {
          timingReliabilityFlags: ['POSSIBLE_EXTERNAL_CLOCK_ADJUSTMENT'],
        }),
      ],
    }),
    sourceGame(25, {
      userMoves: [timingMove(1, null, { timingDerivationStatus: 'UNAVAILABLE' })],
    }),
  ]);

  assert.equal(result.coverage.candidateGames, 6);
  assert.equal(result.coverage.eligibleGames, 5);
  assert.equal(result.coverage.timingCoveredGames, 1);
  assert.equal(result.coverage.timingCoveragePercent, 20);
  assert.equal(result.coverage.status, 'PARTIAL');
  assert.deepEqual(result.coverage.excludedByReason, {
    UNSUPPORTED_GAME: 1,
    CURRENT_TIMING_DERIVATION_UNAVAILABLE: 1,
    NO_DERIVABLE_USER_DECISIONS: 1,
    USER_TIMING_INCOMPLETE_OR_UNRELIABLE: 2,
  });

  assert.equal(result.exposure.pressureEnteringGames, 1);
  assert.equal(result.exposure.pressureMoves, 1);
  assert.equal(result.exposure.eligibleUserDecisions, 2);
  assert.equal(result.exposure.evidenceStrength, 'INSUFFICIENT');
  assert.equal(
    result.exposure.firstEntry.phaseCounts.UNKNOWN,
    1,
    'missing phase stays unknown instead of being inferred from ply number',
  );
});

test('shared evidence strength uses timing-covered games and the required coverage gate', () => {
  const result = buildTimePressureExposureAggregate(
    Array.from({ length: 5 }, (_, index) => sourceGame(100 + index, {
      userMoves: [timingMove(3, index < 3 ? 2_500 : 5_000)],
    })),
  );

  assert.equal(result.coverage.timingCoveragePercent, 100);
  assert.equal(result.exposure.pressureEnteringGames, 3);
  assert.equal(result.exposure.pressureEntryRatePercent, 60);
  assert.equal(result.exposure.evidenceStrength, 'LOW');
});

test('service bounds database work, rejects snapshot drift, and validates date ranges', async () => {
  let loaded = false;
  const tooLarge = await getTimePressureExposure(7, {}, {
    countCandidates: async () => TIME_PRESSURE_EXPOSURE_MAX_CANDIDATE_GAMES + 1,
    loadCandidates: async () => {
      loaded = true;
      return [];
    },
  });
  assert.equal(tooLarge.coverage.status, 'UNAVAILABLE');
  assert.equal(tooLarge.coverage.reason, 'time-pressure-scope-too-large');
  assert.equal(loaded, false);

  const drifted = await getTimePressureExposure(7, {}, {
    countCandidates: async () => 2,
    loadCandidates: async () => [sourceGame(1)],
  });
  assert.equal(drifted.coverage.status, 'UNAVAILABLE');
  assert.equal(drifted.coverage.reason, 'candidate-set-changed-during-read');

  await assert.rejects(
    getTimePressureExposure(
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

test('Prisma repository is ownership/range bounded and attaches current phase evidence to the entry boundary', async () => {
  const suffix = randomUUID();
  const userIds = [];

  async function createUser(subject) {
    const user = await prisma.appUser.create({
      data: { authProvider: 'TEST', authSubject: subject },
    });
    userIds.push(user.id);
    return user;
  }

  async function createGame(appUserId, providerGameId, startedAt, clocks = [2_500, 5_900, 2_400, 5_800]) {
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
    const owner = await createUser('time-pressure-owner-' + suffix);
    const other = await createUser('time-pressure-other-' + suffix);
    const inRange = await createGame(
      owner.id,
      'time-pressure-in-' + suffix,
      new Date('2026-09-19T10:00:00.000Z'),
    );
    await createGame(
      owner.id,
      'time-pressure-out-' + suffix,
      new Date('2026-09-19T13:00:00.000Z'),
    );
    await createGame(
      other.id,
      'time-pressure-foreign-' + suffix,
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
        workKey: 'time-pressure-phase-' + suffix,
        sourcePlyIndexedAt: indexed.plyIndexedAt,
        status: 'SUCCEEDED',
        coverageStatus: 'COMPLETE',
        isCurrent: true,
        events: {
          create: {
            evidenceKey: 'time-pressure-phase-event-' + suffix,
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

    const scope = {
      from: new Date('2026-09-19T09:00:00.000Z'),
      to: new Date('2026-09-19T11:00:00.000Z'),
    };
    assert.equal(
      await prismaTimePressureExposureRepository.countCandidates(owner.id, scope),
      1,
    );

    const rows = await prismaTimePressureExposureRepository.loadCandidates(owner.id, scope);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].importedGameId, inRange.id);
    assert.equal(rows[0].exactTimeControlKey, '60+0');
    assert.equal(rows[0].timeControlIncrement, 0);

    const userDecision = rows[0].userMoves.find((move) => move.plyNumber === 3);
    assert.ok(userDecision);
    assert.equal(userDecision.clockBeforeMoveCentiseconds, 2_500);
    assert.equal(userDecision.timingDerivationStatus, 'AVAILABLE');
    assert.equal(userDecision.phase, 'MIDDLEGAME');

    const aggregate = await getTimePressureExposure(
      owner.id,
      scope,
      prismaTimePressureExposureRepository,
    );
    assert.equal(aggregate.coverage.status, 'COMPLETE');
    assert.equal(aggregate.coverage.candidateGames, 1);
    assert.equal(aggregate.coverage.timingCoveredGames, 1);
    assert.equal(aggregate.exposure.pressureEnteringGames, 1);
    assert.equal(aggregate.exposure.firstEntry.phaseCounts.MIDDLEGAME, 1);
    assert.equal(aggregate.contextBreakdown[0].exactTimeControlKey, '60+0');
  } finally {
    for (const id of userIds.reverse()) {
      await prisma.appUser.delete({ where: { id } }).catch(() => undefined);
    }
  }
});
