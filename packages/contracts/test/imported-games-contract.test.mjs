import assert from 'node:assert/strict';
import test from 'node:test';
import {
  importedGameDetailResponseSchema,
  importedGameEvidenceEventSchema,
  importedGameListQuerySchema,
  importedGameListResponseSchema,
  importedGameReplayResponseSchema,
} from '../dist/index.js';

const baseGame = {
  id: 7,
  provider: 'LICHESS',
  providerGameId: 'abc123',
  providerUrl: 'https://lichess.org/abc123',
  startedAt: '2026-09-11T10:00:00.000Z',
  endedAt: '2026-09-11T10:05:00.000Z',
  rated: true,
  variant: 'standard',
  speedCategory: 'blitz',
  timeControl: {
    raw: '180+0',
    initialSeconds: 180,
    incrementSeconds: 0,
    exactKey: '180+0',
    source: 'LICHESS_CLOCK_OBJECT',
  },
  white: { username: 'Player', rating: 1500 },
  black: { username: 'Opponent', rating: 1510 },
  userColor: 'WHITE',
  opponentUsername: 'Opponent',
  result: '1-0',
  resultForUser: 'WIN',
  status: 'resign',
  opening: { eco: 'C20', name: "King's Pawn Game" },
  indexing: { status: 'INDEXED', indexedAt: '2026-09-11T10:06:00.000Z', error: null },
  timing: {
    alignmentStatus: 'COMPLETE',
    coverageStatus: 'PARTIAL',
    alignedPlyCount: 2,
    derivedPlyCount: 0,
    derivationVersion: 1,
  },
  engine: {
    status: 'NOT_ANALYZED',
    coverageStatus: 'UNAVAILABLE',
    runId: null,
    positionsDone: null,
    positionsTotal: null,
    pliesDone: null,
    pliesTotal: null,
    engineName: null,
    engineVersion: null,
    completedAt: null,
  },
};

const ply = {
  plyNumber: 1,
  moveUci: 'e2e4',
  moverColor: 'WHITE',
  isUserMove: true,
  beforePosition: { id: 11, normalizedFen: 'startpos' },
  afterPosition: { id: 12, normalizedFen: 'fen-after' },
  sourceClock: {
    status: 'UNAVAILABLE',
    sourceOrdinal: null,
    afterCentiseconds: null,
    semantics: null,
    alignmentVersion: null,
  },
  timing: {
    status: 'UNAVAILABLE',
    beforeMoveCentiseconds: null,
    effectiveIncrementCentiseconds: null,
    moveTimeCentiseconds: null,
    beforeClockProvenance: 'UNAVAILABLE',
    incrementProvenance: 'UNAVAILABLE',
    reliabilityFlags: [],
    unavailableReason: 'CLOCKS_ABSENT',
    derivationVersion: 1,
  },
  engine: {
    status: 'UNAVAILABLE',
    analysisRunId: null,
    scoreLossCp: null,
    classificationCode: null,
    beforePosition: {
      status: 'UNAVAILABLE',
      analysisVersion: null,
      settingsHash: null,
      engineName: null,
      engineVersion: null,
      depth: null,
      bestMoveUci: null,
      scoreCpWhite: null,
      mateWhite: null,
    },
  },
  annotations: [],
  evidenceEventKeys: [],
};

const emptyEvidence = {
  compatibilityPolicy: 'KNOWN_TYPES_WITH_OPAQUE_FALLBACK',
  runs: [],
};

test('imported-game contracts preserve exact controls and explicit unavailable evidence', () => {
  const replay = {
    ...baseGame,
    provenance: {
      source: 'LICHESS_API',
      connectedLichessUserId: 'user-id',
      connectedLichessUsername: 'Player',
      importedAt: '2026-09-11T10:06:00.000Z',
      sourceUpdatedAt: '2026-09-11T10:06:00.000Z',
      readModelUpdatedAt: '2026-09-11T10:06:00.000Z',
    },
    clockSource: {
      presence: 'ABSENT',
      stateCount: 0,
      unit: 'CENTISECONDS',
      anomalies: ['CLOCKS_ABSENT'],
    },
    evidence: emptyEvidence,
    plies: [ply],
  };

  assert.deepEqual(importedGameReplayResponseSchema.parse(replay), replay);
  assert.deepEqual(importedGameDetailResponseSchema.parse({ ...replay, pgn: null }).pgn, null);
  assert.equal(importedGameListResponseSchema.parse({
    items: [baseGame],
    pageInfo: { nextCursor: null, hasMore: false },
  }).items[0].timeControl.incrementSeconds, 0);
});

test('deterministic evidence contracts distinguish known payloads from opaque future types', () => {
  const known = {
    evidenceKey: 'evidence-known',
    findingKey: 'hang-p1',
    availability: 'PRESENT',
    source: { startPly: 1, endPly: 1, positionId: 12 },
    presentation: {
      family: 'MATERIAL',
      kind: 'FINDING',
      label: 'Hanging material',
    },
    payload: {
      kind: 'KNOWN',
      evidenceType: 'HANGING_MATERIAL',
      measurements: { scoreLossCp: 180 },
      details: { moveUci: 'e2e4' },
    },
    unavailableReason: null,
  };
  assert.deepEqual(importedGameEvidenceEventSchema.parse(known), known);

  const unknown = {
    evidenceKey: 'evidence-future',
    findingKey: 'future-p1',
    availability: 'PRESENT',
    source: { startPly: 1, endPly: null, positionId: 12 },
    presentation: {
      family: 'UNKNOWN',
      kind: 'UNKNOWN',
      label: 'Unsupported deterministic evidence',
    },
    payload: {
      kind: 'UNKNOWN',
      originalEvidenceType: 'FUTURE_DETECTOR_FACT',
    },
    unavailableReason: null,
  };
  assert.deepEqual(importedGameEvidenceEventSchema.parse(unknown), unknown);
  assert.equal(
    importedGameEvidenceEventSchema.safeParse({
      ...unknown,
      payload: {
        ...unknown.payload,
        measurements: { detectorInternal: true },
      },
    }).success,
    false,
    'unknown types remain opaque instead of leaking untyped detector payloads',
  );
});

test('imported-game list query defaults and bounds pagination', () => {
  assert.deepEqual(importedGameListQuerySchema.parse({}), {
    sort: 'endedAtDesc',
    limit: 25,
  });
  assert.equal(importedGameListQuerySchema.safeParse({ limit: 101 }).success, false);
  assert.equal(importedGameListQuerySchema.safeParse({ limit: 1, unexpected: true }).success, false);
});
