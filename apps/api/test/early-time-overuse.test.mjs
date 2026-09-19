import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import prismaModule from '../dist/prisma.js';
import { ImportedGamePlyIndexService } from '../dist/modules/imported-games/ply-index.service.js';
import {
  EARLY_TIME_OVERUSE_MAX_CANDIDATE_GAMES,
  EARLY_TIME_OVERUSE_POLICY_VERSION,
  buildEarlyTimeOveruseAggregate,
  getEarlyTimeOveruse,
} from '../dist/modules/diagnosis/early-time-overuse.service.js';
import {
  prismaEarlyTimeOveruseRepository,
} from '../dist/modules/diagnosis/early-time-overuse.repository.prisma.js';
import {
  TIME_BEHAVIOR_POLICY_VERSION,
  TIME_EARLY_OVERUSE_MEDIAN_MULTIPLIER,
  TIME_EARLY_OVERUSE_MIN_PEER_GAMES,
} from '../dist/modules/timing/time-behavior-policy.js';
import {
  TIMING_DERIVATION_VERSION,
} from '../dist/modules/timing/timing-policy.js';

const prisma = prismaModule.default ?? prismaModule;
const PGN = '[Event "early time overuse fixture"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *';

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
    clockBeforeMoveCentiseconds = 10_000,
    moveTimeCentiseconds = 100,
    phase = 'OPENING',
    scoreLossCp = 10,
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
    userMoves = [
      move(3),
      move(5),
      move(7, { phase: 'MIDDLEGAME', clockBeforeMoveCentiseconds: 8_000 }),
    ],
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

function normalPeer(importedGameId, runBase = importedGameId * 10) {
  return game(importedGameId, {
    userMoves: [
      move(3, { moveTimeCentiseconds: 100, analysisRun: analysis(runBase + 1) }),
      move(5, { moveTimeCentiseconds: 100, analysisRun: analysis(runBase + 2) }),
      move(7, {
        phase: 'MIDDLEGAME',
        moveTimeCentiseconds: 150,
        clockBeforeMoveCentiseconds: 8_000,
        scoreLossCp: 10,
        analysisRun: analysis(runBase + 3),
      }),
    ],
  });
}

function overusePressureGame(
  importedGameId,
  {
    pressureScoreLossCp = 80,
    pressureAnalysis = analysis(importedGameId * 10 + 3),
    pressureClockCentiseconds = 2_500,
  } = {},
) {
  return game(importedGameId, {
    userMoves: [
      move(3, {
        moveTimeCentiseconds: 300,
        analysisRun: analysis(importedGameId * 10 + 1),
      }),
      move(5, {
        moveTimeCentiseconds: 300,
        analysisRun: analysis(importedGameId * 10 + 2),
      }),
      move(7, {
        phase: 'MIDDLEGAME',
        moveTimeCentiseconds: 150,
        clockBeforeMoveCentiseconds: pressureClockCentiseconds,
        scoreLossCp: pressureScoreLossCp,
        analysisRun: pressureAnalysis,
      }),
    ],
  });
}

test('TIME-004 requires the complete ordered chain before reporting an association', () => {
  const peers = Array.from({ length: 5 }, (_, index) => normalPeer(10 + index));
  const overuse = Array.from(
    { length: 5 },
    (_, index) => overusePressureGame(20 + index),
  );

  const result = buildEarlyTimeOveruseAggregate([...peers, ...overuse]);

  assert.equal(result.diagnosisId, 'TIME-004');
  assert.equal(result.policyVersion, EARLY_TIME_OVERUSE_POLICY_VERSION);
  assert.equal(result.timeBehaviorPolicyVersion, TIME_BEHAVIOR_POLICY_VERSION);
  assert.equal(result.definitions.overuseMedianMultiplier, TIME_EARLY_OVERUSE_MEDIAN_MULTIPLIER);
  assert.equal(result.definitions.minimumPeerGames, TIME_EARLY_OVERUSE_MIN_PEER_GAMES);
  assert.equal(result.coverage.status, 'COMPLETE');
  assert.equal(result.coverage.earlyOveruseGames, 5);
  assert.equal(result.coverage.laterPressureGames, 5);
  assert.equal(result.coverage.laterDegradationGames, 5);
  assert.equal(result.chain.completeChainGames, 5);
  assert.equal(result.chain.averageLaterScoreLossDeltaCp, 70);
  assert.equal(result.chain.evidenceStrength, 'LOW');
  assert.equal(result.chain.mechanismStatus, 'ORDERED_ASSOCIATION');
  assert.equal(result.controls.length, 1);
  assert.equal(result.controls[0].peerMedianCentiseconds, 400);
  assert.equal(result.controls[0].overuseThresholdCentiseconds, 600);
  assert.equal(result.coverage.normalQualityBaselineGames, 5);
});

test('TIME-004 keeps every broken chain link distinct', () => {
  const peers = Array.from({ length: 5 }, (_, index) => normalPeer(100 + index));
  const noPressure = game(200, {
    userMoves: [
      move(3, { moveTimeCentiseconds: 300 }),
      move(5, { moveTimeCentiseconds: 300 }),
      move(7, {
        phase: 'MIDDLEGAME',
        moveTimeCentiseconds: 150,
        clockBeforeMoveCentiseconds: 8_000,
        scoreLossCp: 80,
      }),
    ],
  });
  const noQuality = overusePressureGame(201, { pressureAnalysis: null });
  const noDegradation = overusePressureGame(202, { pressureScoreLossCp: 5 });

  const result = buildEarlyTimeOveruseAggregate([
    ...peers,
    noPressure,
    noQuality,
    noDegradation,
  ]);

  assert.equal(result.chain.earlyOveruseGames, 3);
  assert.equal(result.chain.overuseWithoutLaterPressureGames, 1);
  assert.equal(result.chain.laterPressureGames, 2);
  assert.equal(result.chain.pressureWithoutQualityEvidenceGames, 1);
  assert.equal(result.chain.pressureWithoutDegradationGames, 1);
  assert.equal(result.chain.completeChainGames, 0);
  assert.equal(result.games.find((row) => row.importedGameId === 200)?.completeChain, false);
  assert.equal(
    result.games.find((row) => row.importedGameId === 201)?.laterQuality.status,
    'UNAVAILABLE',
  );
  assert.equal(
    result.games.find((row) => row.importedGameId === 202)?.laterQuality.degraded,
    false,
  );
});

test('missing phase and unreliable early timing remain explicit early coverage loss', () => {
  const peers = Array.from({ length: 5 }, (_, index) => normalPeer(300 + index));
  const missingPhase = game(400, {
    userMoves: [
      move(3, { phase: null }),
      move(5),
      move(7, { phase: 'MIDDLEGAME' }),
    ],
  });
  const unreliable = game(401, {
    userMoves: [
      move(3, {
        timingDerivationStatus: 'INCONSISTENT',
      }),
      move(5),
      move(7, { phase: 'MIDDLEGAME' }),
    ],
  });

  const result = buildEarlyTimeOveruseAggregate([
    ...peers,
    missingPhase,
    unreliable,
  ]);

  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.reason, 'early-coverage-incomplete');
  assert.equal(result.coverage.earlyCoveredGames, 5);
  assert.equal(result.coverage.exclusions.earlyPhaseUnavailableGames, 1);
  assert.equal(result.coverage.exclusions.earlyTimingIncompleteGames, 1);
  assert.equal(result.games.find((row) => row.importedGameId === 400)?.early.reason, 'early-phase-unavailable');
  assert.equal(result.games.find((row) => row.importedGameId === 401)?.early.reason, 'early-timing-incomplete');
});

test('same-control peer baselines do not borrow games from another exact control', () => {
  const controlA = Array.from({ length: 4 }, (_, index) => normalPeer(500 + index));
  const controlB = Array.from({ length: 5 }, (_, index) => game(600 + index, {
    exactTimeControlKey: '180+2',
    timeControlIncrement: 2,
  }));

  const result = buildEarlyTimeOveruseAggregate([...controlB, ...controlA].reverse());

  assert.equal(result.coverage.exclusions.peerBaselineTooSmallGames, 4);
  assert.equal(result.controls.length, 1);
  assert.equal(result.controls[0].exactTimeControlKey, '180+2');
  assert.deepEqual(
    result.games.map((row) => row.importedGameId),
    [...result.games.map((row) => row.importedGameId)].sort((left, right) => left - right),
  );
  for (const row of result.games.filter((item) => item.exactTimeControlKey === '180+0')) {
    assert.equal(row.early.peerMedianCentiseconds, null);
    assert.equal(row.early.overuse, null);
  }
});

test('later pressure without complete later timing remains observed but lowers coverage', () => {
  const peers = Array.from({ length: 5 }, (_, index) => normalPeer(700 + index));
  const pressured = game(800, {
    userMoves: [
      move(3, { moveTimeCentiseconds: 300 }),
      move(5, { moveTimeCentiseconds: 300 }),
      move(7, {
        phase: 'MIDDLEGAME',
        clockBeforeMoveCentiseconds: 2_500,
        scoreLossCp: 80,
      }),
      move(9, {
        phase: 'MIDDLEGAME',
        timingDerivationStatus: 'INCONSISTENT',
      }),
    ],
  });

  const result = buildEarlyTimeOveruseAggregate([...peers, pressured]);
  const row = result.games.find((item) => item.importedGameId === 800);

  assert.equal(row?.laterPressure.status, 'AVAILABLE');
  assert.equal(row?.laterPressure.observedEntryPly, 7);
  assert.equal(row?.laterPressure.timingComplete, false);
  assert.equal(result.coverage.exclusions.laterTimingIncompleteGames, 1);
  assert.equal(result.coverage.status, 'COMPLETE');
});

test('service bounds reads, rejects snapshot drift, and validates scope', async () => {
  let loaded = false;
  const tooLarge = await getEarlyTimeOveruse(
    7,
    {},
    {
      countCandidates: async () => EARLY_TIME_OVERUSE_MAX_CANDIDATE_GAMES + 1,
      loadCandidates: async () => {
        loaded = true;
        return [];
      },
    },
  );
  assert.equal(tooLarge.coverage.reason, 'early-time-overuse-scope-too-large');
  assert.equal(loaded, false);

  const drifted = await getEarlyTimeOveruse(
    7,
    {},
    {
      countCandidates: async () => 2,
      loadCandidates: async () => [normalPeer(1)],
    },
  );
  assert.equal(drifted.coverage.reason, 'candidate-set-changed-during-read');

  await assert.rejects(
    getEarlyTimeOveruse(
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

test('Prisma repository is ownership/range bounded and fences stale analysis', async () => {
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
    const owner = await createUser('early-overuse-owner-' + suffix);
    const other = await createUser('early-overuse-other-' + suffix);
    const inRange = await createGame(
      owner.id,
      'early-overuse-in-' + suffix,
      new Date('2026-09-19T10:00:00.000Z'),
    );
    await createGame(
      owner.id,
      'early-overuse-out-' + suffix,
      new Date('2026-09-19T13:00:00.000Z'),
    );
    await createGame(
      other.id,
      'early-overuse-foreign-' + suffix,
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
        workKey: 'early-overuse-phase-' + suffix,
        sourcePlyIndexedAt: indexed.plyIndexedAt,
        status: 'SUCCEEDED',
        coverageStatus: 'COMPLETE',
        isCurrent: true,
        events: {
          create: {
            evidenceKey: 'early-overuse-phase-event-' + suffix,
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
              phase: 'OPENING',
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
        settingsHash: 'fixture-current-' + suffix,
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
      },
    });

    const scope = {
      from: new Date('2026-09-19T09:00:00.000Z'),
      to: new Date('2026-09-19T11:00:00.000Z'),
    };
    assert.equal(await prismaEarlyTimeOveruseRepository.countCandidates(owner.id, scope), 1);

    let rows = await prismaEarlyTimeOveruseRepository.loadCandidates(owner.id, scope);
    assert.equal(rows.length, 1);
    const currentMove = rows[0].userMoves.find((row) => row.plyNumber === 3);
    assert.ok(currentMove);
    assert.equal(currentMove.moveTimeCentiseconds, 100);
    assert.equal(currentMove.phase, 'OPENING');
    assert.equal(currentMove.analysis?.runId, currentRun.id);

    const staleRun = await prisma.gameAnalysisRun.create({
      data: {
        importedGameId: inRange.id,
        analysisVersion: 'fixture-analysis-v1',
        settingsHash: 'fixture-stale-' + suffix,
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
      data: { engineAnalysisRunId: staleRun.id },
    });

    rows = await prismaEarlyTimeOveruseRepository.loadCandidates(owner.id, scope);
    const staleMove = rows[0].userMoves.find((row) => row.plyNumber === 3);
    assert.ok(staleMove);
    assert.equal(staleMove.analysis, null);
  } finally {
    for (const id of userIds.reverse()) {
      await prisma.appUser.delete({ where: { id } }).catch(() => undefined);
    }
  }
});
