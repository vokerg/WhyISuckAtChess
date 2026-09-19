import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MoveClassificationCode } from '@why-i-suck-at-chess/chess-domain';
import prismaModule from '../dist/prisma.js';
import { ImportedGamePlyIndexService } from '../dist/modules/imported-games/ply-index.service.js';
import {
  OPPONENT_STRENGTH_BAND_DEFINITIONS,
  OPPONENT_STRENGTH_EFFECT_MAX_CANDIDATE_GAMES,
  OPPONENT_STRENGTH_EFFECT_POLICY_VERSION,
  buildOpponentStrengthEffectAggregate,
  getOpponentStrengthEffect,
} from '../dist/modules/diagnosis/opponent-strength-effect.service.js';
import {
  prismaOpponentStrengthEffectRepository,
} from '../dist/modules/diagnosis/opponent-strength-effect.repository.prisma.js';
import {
  TIME_BEHAVIOR_POLICY_VERSION,
} from '../dist/modules/timing/time-behavior-policy.js';

const prisma = prismaModule.default ?? prismaModule;
const PGN = '[Event "opponent strength fixture"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *';

function game(
  importedGameId,
  {
    userRating = 1500,
    opponentRating = 1500,
    exactTimeControlKey = '180+0',
    variant = 'standard',
    speedCategory = 'blitz',
    resultForUser = 'DRAW',
    analysedUserMoves = 2,
    averageScoreLossCp = 30,
    majorErrorMoves = 0,
    blunderMoves = 0,
  } = {},
) {
  return {
    importedGameId,
    variant,
    speedCategory,
    exactTimeControlKey,
    userRating,
    opponentRating,
    resultForUser,
    analysedUserMoves,
    scoreLossTotalCp: analysedUserMoves > 0
      ? averageScoreLossCp * analysedUserMoves
      : null,
    majorErrorMoves,
    blunderMoves,
  };
}

function gamesInBand(startId, count, opponentRating, options = {}) {
  return Array.from({ length: count }, (_, index) => game(startId + index, {
    opponentRating,
    ...options,
  }));
}

function comparison(result, exactTimeControlKey, targetBand) {
  const row = result.comparisons.find(
    (item) => item.exactTimeControlKey === exactTimeControlKey
      && item.targetBand === targetBand,
  );
  assert.ok(row, 'missing comparison for ' + exactTimeControlKey + ' ' + targetBand);
  return row;
}

test('RATING-001 exposes shared band definitions and boundary classification', () => {
  const rows = [
    ...gamesInBand(1, 5, 1300, { exactTimeControlKey: '180+0' }),
    ...gamesInBand(101, 5, 1400, { exactTimeControlKey: '180+0' }),
    ...gamesInBand(201, 5, 1599, { exactTimeControlKey: '180+0' }),
    ...gamesInBand(301, 5, 1600, { exactTimeControlKey: '180+0' }),
    ...gamesInBand(401, 5, 1700, { exactTimeControlKey: '180+0' }),
  ];

  const result = buildOpponentStrengthEffectAggregate(rows);

  assert.equal(result.diagnosisId, 'RATING-001');
  assert.equal(result.policyVersion, OPPONENT_STRENGTH_EFFECT_POLICY_VERSION);
  assert.equal(result.timeBehaviorPolicyVersion, TIME_BEHAVIOR_POLICY_VERSION);
  assert.deepEqual(result.bandDefinitions, OPPONENT_STRENGTH_BAND_DEFINITIONS);
  assert.equal(result.coverage.status, 'COMPLETE');
  assert.equal(result.coverage.representedBands, 5);
  assert.equal(result.coverage.representedExactControls, 1);

  assert.deepEqual(
    result.bands.map((band) => [band.band, band.metrics.games]),
    [
      ['MUCH_WEAKER', 5],
      ['WEAKER', 5],
      ['EVEN', 5],
      ['STRONGER', 5],
      ['MUCH_STRONGER', 5],
    ],
  );
  assert.equal(result.bands[0].metrics.averageRatingDifference, -200);
  assert.equal(result.bands[1].metrics.averageRatingDifference, -100);
  assert.equal(result.bands[2].metrics.averageRatingDifference, 99);
  assert.equal(result.bands[3].metrics.averageRatingDifference, 100);
  assert.equal(result.bands[4].metrics.averageRatingDifference, 200);
});

test('adjacent comparisons are exact-control matched and preserve positive, neutral, and negative effects', () => {
  const rows = [
    ...gamesInBand(1, 5, 1500, {
      exactTimeControlKey: '180+0',
      resultForUser: 'WIN',
      averageScoreLossCp: 20,
    }),
    ...gamesInBand(101, 5, 1650, {
      exactTimeControlKey: '180+0',
      resultForUser: 'LOSS',
      averageScoreLossCp: 80,
      majorErrorMoves: 2,
      blunderMoves: 1,
    }),
    ...gamesInBand(201, 5, 1500, {
      exactTimeControlKey: '180+2',
      resultForUser: 'DRAW',
      averageScoreLossCp: 40,
    }),
    ...gamesInBand(301, 5, 1650, {
      exactTimeControlKey: '180+2',
      resultForUser: 'DRAW',
      averageScoreLossCp: 40,
    }),
    ...gamesInBand(401, 5, 1400, {
      exactTimeControlKey: '180+0',
      resultForUser: 'LOSS',
      averageScoreLossCp: 70,
    }),
  ];

  const result = buildOpponentStrengthEffectAggregate(rows);
  const strongerNoIncrement = comparison(result, '180+0', 'STRONGER');
  const strongerIncrement = comparison(result, '180+2', 'STRONGER');
  const weaker = comparison(result, '180+0', 'WEAKER');

  assert.equal(strongerNoIncrement.baselineBand, 'EVEN');
  assert.equal(strongerNoIncrement.status, 'AVAILABLE');
  assert.equal(strongerNoIncrement.deltas.scorePercentagePoints, -100);
  assert.equal(strongerNoIncrement.deltas.averageScoreLossCp, 60);
  assert.equal(strongerNoIncrement.evidenceStrength.result, 'LOW');
  assert.equal(strongerNoIncrement.evidenceStrength.quality, 'LOW');

  assert.equal(strongerIncrement.deltas.scorePercentagePoints, 0);
  assert.equal(strongerIncrement.deltas.averageScoreLossCp, 0);

  assert.equal(weaker.baselineBand, 'EVEN');
  assert.equal(weaker.deltas.scorePercentagePoints, -100);
  assert.equal(weaker.deltas.averageScoreLossCp, 50);

  assert.equal(
    result.comparisons.some(
      (row) => row.exactTimeControlKey === '180+0'
        && row.targetBand === 'STRONGER'
        && row.baseline?.averageScoreLossCp === 20,
    ),
    true,
  );
  assert.equal(
    result.comparisons.some(
      (row) => row.exactTimeControlKey === '180+2'
        && row.targetBand === 'STRONGER'
        && row.baseline?.averageScoreLossCp === 40,
    ),
    true,
  );
});

test('much stronger and much weaker bands use the adjacent band toward EVEN', () => {
  const result = buildOpponentStrengthEffectAggregate([
    ...gamesInBand(1, 5, 1300, { resultForUser: 'LOSS' }),
    ...gamesInBand(101, 5, 1400, { resultForUser: 'DRAW' }),
    ...gamesInBand(201, 5, 1650, { resultForUser: 'DRAW' }),
    ...gamesInBand(301, 5, 1750, { resultForUser: 'LOSS' }),
  ]);

  assert.equal(comparison(result, '180+0', 'MUCH_WEAKER').baselineBand, 'WEAKER');
  assert.equal(comparison(result, '180+0', 'MUCH_STRONGER').baselineBand, 'STRONGER');
});

test('missing ratings, missing exact control, unsupported speeds, and engine gaps remain explicit coverage loss', () => {
  const result = buildOpponentStrengthEffectAggregate([
    ...gamesInBand(1, 5, 1500, { resultForUser: 'WIN' }),
    ...gamesInBand(101, 5, 1650, {
      resultForUser: 'LOSS',
      analysedUserMoves: 0,
    }),
    game(201, { userRating: null, opponentRating: null }),
    game(202, { exactTimeControlKey: null }),
    game(203, { speedCategory: 'classical' }),
  ]);

  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.unsupportedGames, 1);
  assert.equal(result.coverage.missingRatingGames, 1);
  assert.equal(result.coverage.missingExactControlGames, 1);
  assert.equal(result.coverage.eligibleGames, 10);
  assert.equal(result.coverage.resultCoveragePercent, 100);
  assert.equal(result.coverage.analysisCoveragePercent, 50);
  assert.equal(comparison(result, '180+0', 'STRONGER').evidenceStrength.result, 'LOW');
  assert.equal(comparison(result, '180+0', 'STRONGER').evidenceStrength.quality, 'INSUFFICIENT');
});

test('sparse adjacent arms retain descriptive deltas but are marked insufficient', () => {
  const result = buildOpponentStrengthEffectAggregate([
    ...gamesInBand(1, 5, 1500, {
      resultForUser: 'WIN',
      averageScoreLossCp: 20,
    }),
    ...gamesInBand(101, 4, 1650, {
      resultForUser: 'LOSS',
      averageScoreLossCp: 80,
    }),
  ]);

  const stronger = comparison(result, '180+0', 'STRONGER');
  assert.equal(stronger.status, 'INSUFFICIENT');
  assert.equal(stronger.reason, 'weaker-arm-below-evidence-gate');
  assert.equal(stronger.evidenceStrength.result, 'INSUFFICIENT');
  assert.equal(stronger.evidenceStrength.quality, 'INSUFFICIENT');
  assert.equal(stronger.deltas.scorePercentagePoints, -100);
  assert.equal(stronger.deltas.averageScoreLossCp, 60);
});

test('represented target without adjacent baseline is unavailable instead of borrowing another control or band', () => {
  const result = buildOpponentStrengthEffectAggregate([
    ...gamesInBand(1, 5, 1650, { exactTimeControlKey: '180+0' }),
    ...gamesInBand(101, 5, 1500, { exactTimeControlKey: '180+2' }),
  ]);

  assert.equal(result.coverage.status, 'UNAVAILABLE');
  assert.equal(result.coverage.reason, 'no-adjacent-rating-band-comparison');
  const stronger = comparison(result, '180+0', 'STRONGER');
  assert.equal(stronger.status, 'UNAVAILABLE');
  assert.equal(stronger.reason, 'adjacent-rating-band-unavailable');
  assert.equal(stronger.baseline, null);
});

test('service bounds reads, rejects snapshot drift, and validates ranges', async () => {
  let loaded = false;
  const tooLarge = await getOpponentStrengthEffect(
    7,
    {},
    {
      countCandidates: async () => OPPONENT_STRENGTH_EFFECT_MAX_CANDIDATE_GAMES + 1,
      loadCandidates: async () => {
        loaded = true;
        return [];
      },
    },
  );
  assert.equal(tooLarge.coverage.reason, 'opponent-strength-scope-too-large');
  assert.equal(loaded, false);

  const drifted = await getOpponentStrengthEffect(
    7,
    {},
    {
      countCandidates: async () => 2,
      loadCandidates: async () => [game(1)],
    },
  );
  assert.equal(drifted.coverage.reason, 'candidate-set-changed-during-read');

  await assert.rejects(
    getOpponentStrengthEffect(
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

test('Prisma repository is ownership/range bounded, maps user-relative ratings, and fences stale analysis', async () => {
  const suffix = randomUUID();
  const userIds = [];

  async function createUser(subject) {
    const user = await prisma.appUser.create({
      data: { authProvider: 'TEST', authSubject: subject },
    });
    userIds.push(user.id);
    return user;
  }

  async function createGame(
    appUserId,
    providerGameId,
    startedAt,
    {
      userColor = 'WHITE',
      whiteRating = 1500,
      blackRating = 1650,
    } = {},
  ) {
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
        whiteUsername: userColor === 'WHITE' ? 'FixtureUser' : 'Opponent',
        blackUsername: userColor === 'BLACK' ? 'FixtureUser' : 'Opponent',
        whiteRating,
        blackRating,
        userColor,
        resultForUser: 'LOSS',
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
    const owner = await createUser('opponent-strength-owner-' + suffix);
    const other = await createUser('opponent-strength-other-' + suffix);
    const white = await createGame(
      owner.id,
      'opponent-strength-white-' + suffix,
      new Date('2026-09-19T10:00:00.000Z'),
    );
    const black = await createGame(
      owner.id,
      'opponent-strength-black-' + suffix,
      new Date('2026-09-19T10:15:00.000Z'),
      { userColor: 'BLACK', whiteRating: 1700, blackRating: 1550 },
    );
    await createGame(
      owner.id,
      'opponent-strength-out-' + suffix,
      new Date('2026-09-19T13:00:00.000Z'),
    );
    await createGame(
      other.id,
      'opponent-strength-foreign-' + suffix,
      new Date('2026-09-19T10:30:00.000Z'),
    );

    const indexed = await ImportedGamePlyIndexService.indexOne(owner.id, white.id);
    assert.equal(indexed.status, 'INDEXED');
    assert.ok(indexed.plyIndexedAt);

    const currentRun = await prisma.gameAnalysisRun.create({
      data: {
        importedGameId: white.id,
        analysisVersion: 'fixture-analysis-v1',
        settingsHash: 'opponent-strength-current-' + suffix,
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
          importedGameId: white.id,
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

    assert.equal(await prismaOpponentStrengthEffectRepository.countCandidates(owner.id, scope), 2);
    let rows = await prismaOpponentStrengthEffectRepository.loadCandidates(owner.id, scope);
    assert.deepEqual(rows.map((row) => row.importedGameId), [white.id, black.id]);
    assert.deepEqual(
      rows.map((row) => [row.userRating, row.opponentRating]),
      [[1500, 1650], [1550, 1700]],
    );
    assert.equal(rows[0].analysedUserMoves, 1);
    assert.equal(rows[0].scoreLossTotalCp, 42);
    assert.equal(rows[0].majorErrorMoves, 1);
    assert.equal(rows[0].blunderMoves, 1);

    const staleRun = await prisma.gameAnalysisRun.create({
      data: {
        importedGameId: white.id,
        analysisVersion: 'fixture-analysis-v1',
        settingsHash: 'opponent-strength-stale-' + suffix,
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
          importedGameId: white.id,
          plyNumber: 1,
        },
      },
      data: { engineAnalysisRunId: staleRun.id },
    });

    rows = await prismaOpponentStrengthEffectRepository.loadCandidates(owner.id, scope);
    assert.equal(rows[0].analysedUserMoves, 0);
    assert.equal(rows[0].scoreLossTotalCp, null);
    assert.equal(rows[0].majorErrorMoves, 0);
  } finally {
    for (const id of userIds.reverse()) {
      await prisma.appUser.delete({ where: { id } }).catch(() => undefined);
    }
  }
});
