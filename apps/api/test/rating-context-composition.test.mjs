import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as prismaModule from '../dist/prisma.js';
import {
  buildRatingContextComposition,
  getRatingContextComposition,
  RATING_CONTEXT_COMPOSITION_POLICY_VERSION,
} from '../dist/modules/diagnosis/rating-context-composition.service.js';
import {
  prismaRatingContextCompositionRepository,
} from '../dist/modules/diagnosis/rating-context-composition.repository.prisma.js';
import {
  TIME_BEHAVIOR_POLICY_VERSION,
} from '../dist/modules/timing/time-behavior-policy.js';

const prisma = prismaModule.default ?? prismaModule;

function comparison(left, right) {
  return {
    left: { importedGameIds: left },
    right: { importedGameIds: right },
  };
}

function ratingRow(importedGameId, userRating, opponentRating) {
  return { importedGameId, userRating, opponentRating };
}

test('balanced rated arms report complete composition without a material warning', () => {
  const left = [1, 2, 3, 4, 5];
  const right = [6, 7, 8, 9, 10];
  const rows = [...left, ...right].map((id) => ratingRow(id, 1500, 1500));

  const result = buildRatingContextComposition(comparison(left, right), rows);

  assert.equal(result.diagnosisId, 'RATING-002');
  assert.equal(result.policyVersion, RATING_CONTEXT_COMPOSITION_POLICY_VERSION);
  assert.equal(result.timeBehaviorPolicyVersion, TIME_BEHAVIOR_POLICY_VERSION);
  assert.equal(result.coverage.status, 'COMPLETE');
  assert.equal(result.coverage.inputGames, 10);
  assert.equal(result.coverage.loadedOwnedGames, 10);
  assert.equal(result.arms.left.ratingCoveragePercent, 100);
  assert.equal(result.arms.right.ratingCoveragePercent, 100);
  assert.equal(result.arms.left.bandCounts.EVEN, 5);
  assert.equal(result.arms.left.bandSharesPercent.EVEN, 100);
  assert.equal(result.comparison.meanRatingDifferenceDeltaPoints, 0);
  assert.equal(result.comparison.maxBandShareDeltaPercentagePoints, 0);
  assert.equal(result.comparison.evidenceStrength, 'LOW');
  assert.equal(result.comparison.materialCompositionWarning, false);
});

test('materially different opponent-strength populations emit the shared-policy warning', () => {
  const left = [11, 12, 13, 14, 15];
  const right = [16, 17, 18, 19, 20];
  const rows = [
    ...left.map((id) => ratingRow(id, 1600, 1400)),
    ...right.map((id) => ratingRow(id, 1600, 1800)),
  ];

  const result = buildRatingContextComposition(comparison(left, right), rows);

  assert.equal(result.arms.left.averageRatingDifference, -200);
  assert.equal(result.arms.right.averageRatingDifference, 200);
  assert.equal(result.arms.left.bandCounts.MUCH_WEAKER, 5);
  assert.equal(result.arms.right.bandCounts.MUCH_STRONGER, 5);
  assert.equal(result.comparison.meanRatingDifferenceDeltaPoints, 400);
  assert.equal(result.comparison.absoluteMeanRatingDifferenceDeltaPoints, 400);
  assert.equal(result.comparison.maxBandShareDeltaPercentagePoints, 100);
  assert.equal(result.comparison.evidenceStrength, 'LOW');
  assert.equal(result.comparison.materialCompositionWarning, true);
});

test('missing ratings remain explicit coverage loss and are never imputed', () => {
  const left = Array.from({ length: 10 }, (_, index) => 30 + index);
  const right = Array.from({ length: 10 }, (_, index) => 40 + index);
  const rows = [
    ...left.map((id, index) => index < 5
      ? ratingRow(id, 1500, 1550)
      : ratingRow(id, null, null)),
    ...right.map((id) => ratingRow(id, 1500, 1550)),
  ];

  const result = buildRatingContextComposition(comparison(left, right), rows);

  assert.equal(result.coverage.status, 'PARTIAL');
  assert.equal(result.coverage.reason, 'rating-coverage-incomplete');
  assert.equal(result.arms.left.inputGames, 10);
  assert.equal(result.arms.left.ratingCoveredGames, 5);
  assert.equal(result.arms.left.ratingCoveragePercent, 50);
  assert.equal(result.arms.left.averageUserRating, 1500);
  assert.equal(result.arms.left.averageOpponentRating, 1550);
  assert.equal(result.arms.left.averageRatingDifference, 50);
  assert.equal(
    Object.values(result.arms.left.bandCounts).reduce((sum, value) => sum + value, 0),
    5,
  );
  assert.equal(result.comparison.evidenceStrength, 'LOW');
  assert.equal(result.comparison.materialCompositionWarning, false);
});

test('rating-difference boundary values use the versioned shared band classifier', () => {
  const left = [60, 61, 62, 63, 64];
  const right = [70, 71, 72, 73, 74];
  const differences = [-200, -100, 99, 100, 200];
  const rows = [
    ...left.map((id, index) => ratingRow(id, 1500, 1500 + differences[index])),
    ...right.map((id, index) => ratingRow(id, 1500, 1500 + differences[index])),
  ];

  const result = buildRatingContextComposition(comparison(left, right), rows);

  assert.deepEqual(result.arms.left.bandCounts, {
    MUCH_WEAKER: 1,
    WEAKER: 1,
    EVEN: 1,
    STRONGER: 1,
    MUCH_STRONGER: 1,
  });
  assert.equal(result.arms.left.bandSharesPercent.MUCH_WEAKER, 20);
  assert.equal(result.arms.left.bandSharesPercent.MUCH_STRONGER, 20);
  assert.equal(result.comparison.materialCompositionWarning, false);
});

test('duplicate, overlapping, empty, and under-evidenced arms fail closed', () => {
  const duplicate = buildRatingContextComposition(
    comparison([1, 1], [2, 3]),
    [],
  );
  assert.equal(duplicate.coverage.status, 'UNAVAILABLE');
  assert.equal(duplicate.coverage.reason, 'duplicate-or-overlapping-game-ids');
  assert.equal(duplicate.comparison.materialCompositionWarning, null);

  const overlap = buildRatingContextComposition(
    comparison([1, 2], [2, 3]),
    [],
  );
  assert.equal(overlap.coverage.reason, 'duplicate-or-overlapping-game-ids');

  const empty = buildRatingContextComposition(comparison([], [2]), []);
  assert.equal(empty.coverage.reason, 'empty-rating-comparison-arm');

  const insufficient = buildRatingContextComposition(
    comparison([101, 102, 103, 104], [201, 202, 203, 204]),
    [
      ...[101, 102, 103, 104].map((id) => ratingRow(id, 1600, 1400)),
      ...[201, 202, 203, 204].map((id) => ratingRow(id, 1600, 1800)),
    ],
  );
  assert.equal(insufficient.comparison.evidenceStrength, 'INSUFFICIENT');
  assert.equal(insufficient.comparison.materialCompositionWarning, null);
});

test('service performs one bounded owned-game read and fails closed on game-set drift', async () => {
  let call = null;
  const input = comparison([301, 302, 303, 304, 305], [401, 402, 403, 404, 405]);

  const complete = await getRatingContextComposition(42, input, {
    loadOwnedRatingContext: async (appUserId, importedGameIds) => {
      call = { appUserId, importedGameIds: [...importedGameIds] };
      return importedGameIds.map((id) => ratingRow(id, 1500, 1500));
    },
  });

  assert.deepEqual(call, {
    appUserId: 42,
    importedGameIds: [301, 302, 303, 304, 305, 401, 402, 403, 404, 405],
  });
  assert.equal(complete.coverage.status, 'COMPLETE');

  const drifted = await getRatingContextComposition(42, input, {
    loadOwnedRatingContext: async (_appUserId, importedGameIds) =>
      importedGameIds.slice(0, -1).map((id) => ratingRow(id, 1500, 1500)),
  });
  assert.equal(drifted.coverage.status, 'UNAVAILABLE');
  assert.equal(drifted.coverage.reason, 'rating-game-set-changed-during-read');
  assert.equal(drifted.comparison.materialCompositionWarning, null);
});

test('Prisma repository maps user-relative ratings and ownership filtering makes foreign arms fail closed', async () => {
  const suffix = randomUUID();
  const userIds = [];

  async function createUser(subject) {
    const user = await prisma.appUser.create({
      data: { authProvider: 'TEST', authSubject: subject },
    });
    userIds.push(user.id);
    return user;
  }

  async function createGame(appUserId, key, userColor, whiteRating, blackRating) {
    return prisma.importedGame.create({
      data: {
        appUserId,
        provider: 'LICHESS',
        providerGameId: key,
        connectedLichessUserId: 'lichess-' + appUserId,
        connectedLichessUsername: 'user-' + appUserId,
        userColor,
        whiteRating,
        blackRating,
      },
    });
  }

  try {
    const owner = await createUser('rating-context-owner-' + suffix);
    const other = await createUser('rating-context-other-' + suffix);
    const white = await createGame(owner.id, 'white-' + suffix, 'WHITE', 1500, 1600);
    const black = await createGame(owner.id, 'black-' + suffix, 'BLACK', 1700, 1550);
    const foreign = await createGame(other.id, 'foreign-' + suffix, 'WHITE', 1400, 1800);

    const rows = await prismaRatingContextCompositionRepository.loadOwnedRatingContext(
      owner.id,
      [white.id, black.id, foreign.id],
    );

    assert.deepEqual(rows, [
      { importedGameId: white.id, userRating: 1500, opponentRating: 1600 },
      { importedGameId: black.id, userRating: 1550, opponentRating: 1700 },
    ]);

    const result = await getRatingContextComposition(
      owner.id,
      comparison([white.id], [foreign.id]),
      prismaRatingContextCompositionRepository,
    );
    assert.equal(result.coverage.status, 'UNAVAILABLE');
    assert.equal(result.coverage.reason, 'rating-game-set-changed-during-read');
    assert.equal(result.coverage.loadedOwnedGames, 1);
  } finally {
    for (const id of userIds.reverse()) {
      await prisma.appUser.delete({ where: { id } }).catch(() => undefined);
    }
  }
});
