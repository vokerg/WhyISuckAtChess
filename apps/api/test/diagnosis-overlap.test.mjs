import assert from 'node:assert/strict';
import test from 'node:test';
import {
  diagnosisGameEventIdentityKey,
  diagnosisPlyEventIdentityKey,
} from '@why-i-suck-at-chess/chess-domain';
import {
  calculateDiagnosisFindingOverlap,
  calculateDiagnosisFindingOverlaps,
  getCurrentDiagnosisFindingOverlaps,
} from '../dist/modules/diagnosis/diagnosis-overlap.service.js';

function plyReference(gameId, ply, sourceKind = 'SHARED_EVENT', sessionKey = null) {
  return {
    referenceKey: `g${gameId}-p${ply}-${sourceKind}`,
    referenceType: 'IMPORTED_GAME_PLY',
    importedGameId: gameId,
    sourcePlyStart: ply,
    sourcePlyEnd: ply,
    sessionKey,
    eventIdentityKey: diagnosisPlyEventIdentityKey({
      importedGameId: gameId,
      triggerPly: ply,
      sourceKind,
      sourceVersion: 'fixture-v1',
    }),
    provenance: {},
    representative: false,
  };
}

function gameReference(gameId, sourceKind, sessionKey = null) {
  return {
    referenceKey: `g${gameId}-${sourceKind}`,
    referenceType: 'IMPORTED_GAME',
    importedGameId: gameId,
    sessionKey,
    eventIdentityKey: diagnosisGameEventIdentityKey({
      importedGameId: gameId,
      sourceKind,
      sourceVersion: 'fixture-v1',
    }),
    provenance: {},
    representative: false,
  };
}

function finding(findingKey, references, overrides = {}) {
  const games = new Set(
    references
      .map((reference) => reference.importedGameId)
      .filter((value) => Number.isInteger(value)),
  );
  const sessions = new Set(
    references
      .map((reference) => reference.sessionKey)
      .filter((value) => typeof value === 'string' && value.length > 0),
  );
  return {
    id: overrides.id,
    findingKey,
    diagnosisId: overrides.diagnosisId ?? findingKey.toUpperCase(),
    distinctGameCount: overrides.distinctGameCount ?? games.size,
    distinctSessionCount: overrides.distinctSessionCount ?? sessions.size,
    evidenceReferences: references,
  };
}

test('full event overlap exposes arm, union, game, and session denominators', () => {
  const refs = [
    plyReference(1, 11, 'TACTICAL_EVENT', 'session-a'),
    plyReference(2, 13, 'TACTICAL_EVENT', 'session-a'),
    plyReference(3, 15, 'TACTICAL_EVENT', 'session-b'),
  ];
  const result = calculateDiagnosisFindingOverlap(
    finding('left', refs),
    finding('right', refs.map((reference) => ({ ...reference }))),
  );

  assert.equal(result.calculationVersion, 'diagnosis-overlap-v1');
  assert.equal(result.eventIdentityVersion, 'diagnosis-event-identity-v1');
  assert.equal(result.eventOverlap.calculable, true);
  assert.equal(result.eventOverlap.intersectionEventCount, 3);
  assert.equal(result.eventOverlap.unionEventCount, 3);
  assert.equal(result.eventOverlap.leftOverlapRate, 1);
  assert.equal(result.eventOverlap.rightOverlapRate, 1);
  assert.equal(result.eventOverlap.smallerArmOverlapRate, 1);
  assert.equal(result.eventOverlap.jaccardRate, 1);
  assert.equal(result.eventOverlap.sharedDistinctGames, 3);
  assert.equal(result.eventOverlap.sharedDistinctSessions, 2);
  assert.equal(result.eventOverlap.largestSharedGameEventShare, 1 / 3);
  assert.equal(result.eventOverlap.material, true);
});

test('partial event overlap is measured against both arms and the smaller arm', () => {
  const left = finding('left', [
    plyReference(1, 11),
    plyReference(2, 13),
    plyReference(3, 15),
  ]);
  const right = finding('right', [
    plyReference(2, 13),
    plyReference(3, 15),
    plyReference(4, 17),
  ]);
  const result = calculateDiagnosisFindingOverlap(left, right);

  assert.equal(result.eventOverlap.intersectionEventCount, 2);
  assert.equal(result.eventOverlap.unionEventCount, 4);
  assert.equal(result.eventOverlap.leftOverlapRate, 2 / 3);
  assert.equal(result.eventOverlap.rightOverlapRate, 2 / 3);
  assert.equal(result.eventOverlap.smallerArmOverlapRate, 2 / 3);
  assert.equal(result.eventOverlap.jaccardRate, 0.5);
  assert.equal(result.eventOverlap.sharedDistinctGames, 2);
  assert.equal(result.eventOverlap.material, true);
});

test('no overlap remains calculable and is not material', () => {
  const result = calculateDiagnosisFindingOverlap(
    finding('left', [plyReference(1, 11, 'LEFT')]),
    finding('right', [plyReference(2, 11, 'RIGHT')]),
  );

  assert.equal(result.eventOverlap.calculable, true);
  assert.equal(result.eventOverlap.intersectionEventCount, 0);
  assert.equal(result.eventOverlap.unionEventCount, 2);
  assert.equal(result.eventOverlap.jaccardRate, 0);
  assert.equal(result.eventOverlap.sharedDistinctGames, 0);
  assert.equal(result.eventOverlap.material, false);
});

test('repeated shared events in one game cannot establish material overlap', () => {
  const refs = [
    plyReference(1, 11, 'TACTICAL_EVENT'),
    plyReference(1, 13, 'TACTICAL_EVENT'),
    plyReference(1, 15, 'TACTICAL_EVENT'),
  ];
  const result = calculateDiagnosisFindingOverlap(
    finding('left', refs),
    finding('right', refs.map((reference) => ({ ...reference }))),
  );

  assert.equal(result.eventOverlap.intersectionEventCount, 3);
  assert.equal(result.eventOverlap.sharedDistinctGames, 1);
  assert.equal(result.eventOverlap.largestSharedGameEventShare, 1);
  assert.equal(result.eventOverlap.material, false);
});

test('aggregate game-set overlap stays visible without pretending distinct source events are identical', () => {
  const left = finding('left', [
    gameReference(1, 'SESSION_AGGREGATE', 'session-a'),
    gameReference(2, 'SESSION_AGGREGATE', 'session-b'),
    gameReference(3, 'SESSION_AGGREGATE', 'session-c'),
  ]);
  const right = finding('right', [
    gameReference(2, 'TIMING_AGGREGATE', 'session-b'),
    gameReference(3, 'TIMING_AGGREGATE', 'session-c'),
    gameReference(4, 'TIMING_AGGREGATE', 'session-d'),
  ]);
  const result = calculateDiagnosisFindingOverlap(left, right);

  assert.equal(result.eventOverlap.calculable, true);
  assert.equal(result.eventOverlap.intersectionEventCount, 0);
  assert.equal(result.eventOverlap.material, false);
  assert.equal(result.gameSetOverlap.calculable, true);
  assert.equal(result.gameSetOverlap.intersectionGameCount, 2);
  assert.equal(result.gameSetOverlap.unionGameCount, 4);
  assert.equal(result.gameSetOverlap.jaccardRate, 0.5);
  assert.equal(result.gameSetOverlap.sharedDistinctSessions, 2);
});

test('missing event identity is explicit while complete game-set overlap remains calculable', () => {
  const left = finding('left', [{
    referenceKey: 'left-game-1',
    referenceType: 'IMPORTED_GAME',
    importedGameId: 1,
    eventIdentityKey: null,
    provenance: {},
  }]);
  const right = finding('right', [gameReference(1, 'OTHER')]);
  const result = calculateDiagnosisFindingOverlap(left, right);

  assert.equal(result.left.coverage.status, 'EVENT_IDENTITY_UNAVAILABLE');
  assert.equal(result.eventOverlap.calculable, false);
  assert.match(result.eventOverlap.reason, /EVENT_IDENTITY_UNAVAILABLE/);
  assert.equal(result.eventOverlap.intersectionEventCount, null);
  assert.equal(result.gameSetOverlap.calculable, true);
  assert.equal(result.gameSetOverlap.intersectionGameCount, 1);
});

test('stale identity versions and incomplete reference sets fail closed', () => {
  const stale = finding('stale', [{
    referenceKey: 'stale-game-1',
    referenceType: 'IMPORTED_GAME',
    importedGameId: 1,
    eventIdentityKey: 'diagnosis-event-identity-v0|game|g:1|k:X|v:v1',
    provenance: {},
  }]);
  const current = finding('current', [gameReference(1, 'X')]);
  const staleResult = calculateDiagnosisFindingOverlap(stale, current);
  assert.equal(staleResult.left.coverage.status, 'STALE_EVENT_IDENTITY');
  assert.equal(staleResult.eventOverlap.calculable, false);

  const incomplete = finding(
    'incomplete',
    [gameReference(1, 'X'), gameReference(2, 'X')],
    { distinctGameCount: 3 },
  );
  const incompleteResult = calculateDiagnosisFindingOverlap(incomplete, current);
  assert.equal(incompleteResult.left.coverage.status, 'INCOMPLETE_GAME_SET');
  assert.equal(incompleteResult.eventOverlap.calculable, false);
  assert.equal(incompleteResult.gameSetOverlap.calculable, false);
});

test('cluster overlap is deterministic and bounded', () => {
  const findings = [
    finding('z-last', [gameReference(3, 'X')], { id: 3 }),
    finding('a-first', [gameReference(1, 'X')], { id: 1 }),
    finding('m-middle', [gameReference(2, 'X')], { id: 2 }),
  ];
  const pairs = calculateDiagnosisFindingOverlaps(findings);
  assert.deepEqual(
    pairs.map((pair) => [pair.left.findingKey, pair.right.findingKey]),
    [
      ['a-first', 'm-middle'],
      ['a-first', 'z-last'],
      ['m-middle', 'z-last'],
    ],
  );

  assert.throws(() => calculateDiagnosisFindingOverlaps(
    Array.from({ length: 201 }, (_, index) => finding(
      `finding-${index}`,
      [gameReference(index + 1, 'X')],
    )),
  ));
});

test('current-scope service uses the repository version fence before calculating overlap', async () => {
  const left = finding('left', [gameReference(1, 'X')], { id: 10 });
  const right = finding('right', [gameReference(1, 'X')], { id: 11 });
  const versions = {
    taxonomyVersion: 'taxonomy-v1',
    synthesisPolicyVersion: 'diagnosis-synthesis-v1',
    calculationVersion: 'calculation-v1',
    policyVersions: { eventIdentity: 'diagnosis-event-identity-v1' },
  };
  let calls = 0;
  let sourceChecks = 0;
  const repository = {
    async getCurrentScope(appUserId, scopeKey, receivedVersions) {
      calls += 1;
      assert.equal(appUserId, 7);
      assert.equal(scopeKey, 'scope-a');
      assert.deepEqual(receivedVersions, versions);
      return {
        id: 99,
        appUserId,
        materializationKey: 'materialization-a',
        scopeKey,
        scope: {},
        taxonomyVersion: versions.taxonomyVersion,
        synthesisPolicyVersion: versions.synthesisPolicyVersion,
        calculationVersion: versions.calculationVersion,
        policyVersions: versions.policyVersions,
        calculationAsOf: new Date('2026-09-24T00:00:00Z'),
        isCurrent: true,
        supersededAt: null,
        findings: [left, right],
        relationships: [],
      };
    },
    async assertCurrentSourceReferences(appUserId, snapshot) {
      sourceChecks += 1;
      assert.equal(appUserId, 7);
      assert.equal(snapshot.id, 99);
    },
  };

  const result = await getCurrentDiagnosisFindingOverlaps(
    7,
    'scope-a',
    versions,
    repository,
  );
  assert.equal(calls, 1);
  assert.equal(sourceChecks, 1);
  assert.equal(result.findingSetId, 99);
  assert.equal(result.calculationVersion, 'diagnosis-overlap-v1');
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].eventOverlap.intersectionEventCount, 1);
});


test('current-scope service propagates stale-source rejection before overlap calculation', async () => {
  const versions = {
    taxonomyVersion: 'taxonomy-v1',
    synthesisPolicyVersion: 'diagnosis-synthesis-v1',
    calculationVersion: 'calculation-v1',
    policyVersions: { eventIdentity: 'diagnosis-event-identity-v1' },
  };
  const repository = {
    async getCurrentScope() {
      return {
        id: 100,
        appUserId: 7,
        materializationKey: 'materialization-b',
        scopeKey: 'scope-b',
        scope: {},
        taxonomyVersion: versions.taxonomyVersion,
        synthesisPolicyVersion: versions.synthesisPolicyVersion,
        calculationVersion: versions.calculationVersion,
        policyVersions: versions.policyVersions,
        calculationAsOf: new Date('2026-09-24T00:00:00Z'),
        isCurrent: true,
        supersededAt: null,
        findings: [
          finding('left', [gameReference(1, 'X')], { id: 10 }),
          finding('right', [gameReference(1, 'X')], { id: 11 }),
        ],
        relationships: [],
      };
    },
    async assertCurrentSourceReferences() {
      throw new Error('stale source evidence');
    },
  };

  await assert.rejects(
    getCurrentDiagnosisFindingOverlaps(7, 'scope-b', versions, repository),
    /stale source evidence/,
  );
});
