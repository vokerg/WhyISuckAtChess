import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLichessGamesRequestUrl,
  LichessNdjsonRecordError,
  normalizeLichessGame,
  readLichessNdjson,
} from '../dist/modules/account-imports/providers/lichess/lichess-account-import.js';
import { createLichessAccountImportService, planImportWindows } from '../dist/modules/account-imports/account-import.service.js';
import {
  decideClockSequence,
  ImportLeaseLostError,
} from '../dist/modules/account-imports/account-import.repository.prisma.js';

test('Lichess export URL is half-open, authenticated NDJSON, and requests clocks', () => {
  const from = new Date('2026-01-01T00:00:00.000Z');
  const to = new Date('2026-01-02T00:00:00.000Z');
  const url = new URL(buildLichessGamesRequestUrl({ username: 'Clock User', from, to }));
  assert.equal(url.pathname, '/api/games/user/Clock%20User');
  assert.equal(url.searchParams.get('since'), String(from.getTime()));
  assert.equal(url.searchParams.get('until'), String(to.getTime() - 1));
  assert.equal(url.searchParams.get('perfType'), 'bullet,blitz,rapid');
  assert.equal(url.searchParams.get('clocks'), 'true');
  assert.equal(url.searchParams.get('pgnInJson'), 'true');
  assert.equal(url.searchParams.get('sort'), 'dateAsc');
});

test('normalization preserves clock presence, order, valid values, and time-control provenance', () => {
  const identity = { lichessUserId: 'u1', username: 'Alice' };
  const base = {
    id: 'game-1', rated: true, variant: 'standard', speed: 'bullet', perf: 'bullet',
    createdAt: 1770000000000, lastMoveAt: 1770000010000, status: 'draw',
    url: 'https://lichess.org/game-1',
    pgn: '[TimeControl "60+0"]\n[Result "1/2-1/2"]\n',
    players: { white: { user: { id: 'u1', name: 'Alice' }, rating: 1500 }, black: { user: { id: 'u2', name: 'Bob' }, rating: 1400 } },
    clock: { initial: 60, increment: 0 },
    clocks: [6000, 5900, 5800],
  };
  const normalized = normalizeLichessGame(base, identity);
  assert.equal(normalized.rawClockPresence, 'PRESENT');
  assert.deepEqual(normalized.rawClockValuesCentiseconds, [6000, 5900, 5800]);
  assert.equal(normalized.timeControlSource, 'LICHESS_CLOCK_OBJECT');
  assert.equal(normalized.timeControlInitial, 60);
  assert.equal(normalized.timeControlIncrement, 0);
  assert.equal(normalized.userColor, 'white');

  const { clocks: _clocks, ...withoutClocks } = base;
  const absent = normalizeLichessGame({ ...withoutClocks, id: 'absent' }, identity);
  assert.equal(absent.rawClockPresence, 'ABSENT');
  const empty = normalizeLichessGame({ ...base, id: 'empty', clocks: [] }, identity);
  assert.equal(empty.rawClockPresence, 'PRESENT');
  assert.deepEqual(empty.rawClockValuesCentiseconds, []);
  const invalid = normalizeLichessGame({ ...base, id: 'invalid', clocks: [6000, 'bad', 5800] }, identity);
  assert.equal(invalid.rawClockPresence, 'INVALID');
  assert.deepEqual(invalid.rawClockValuesCentiseconds, [6000, 5800]);
  assert.ok(invalid.rawClockAnomalies.includes('CLOCK_SAMPLE_INVALID'));
});

test('unknown provider results never become invented wins or losses', () => {
  const identity = { lichessUserId: 'u1', username: 'Alice' };
  const normalized = normalizeLichessGame({
    id: 'unfinished-result',
    status: 'unknown',
    pgn: '[Result "*"]\n',
    players: {
      white: { user: { id: 'u1', name: 'Alice' } },
      black: { user: { id: 'u2', name: 'Bob' } },
    },
  }, identity);

  assert.equal(normalized.result, '*');
  assert.equal(normalized.resultForUser, 'unknown');
});

test('valid clock evidence is never downgraded by absent, invalid, or shorter reimports', () => {
  assert.deepEqual(decideClockSequence('PRESENT', [10, 9, 8], 'ABSENT', []), { update: false, conflict: false });
  assert.deepEqual(decideClockSequence('PRESENT', [10, 9, 8], 'INVALID', [10, 9]), { update: false, conflict: false });
  assert.deepEqual(decideClockSequence('PRESENT', [10, 9, 8], 'PRESENT', [10, 9]), { update: false, conflict: false });
  assert.deepEqual(decideClockSequence('PRESENT', [10, 9], 'PRESENT', [10, 9, 8]), { update: true, conflict: false });
  assert.deepEqual(decideClockSequence('PRESENT', [10, 9], 'PRESENT', [10, 8]), { update: false, conflict: true });
});

test('window planning keeps contiguous half-open coverage', () => {
  const from = new Date('2026-01-01T00:00:00.000Z');
  const to = new Date('2026-02-15T00:00:00.000Z');
  const windows = planImportWindows(from, to, 10 * 24 * 60 * 60 * 1000);
  assert.equal(windows[0].from.toISOString(), from.toISOString());
  assert.equal(windows.at(-1).to.toISOString(), to.toISOString());
  for (let index = 1; index < windows.length; index += 1) {
    assert.equal(windows[index - 1].to.toISOString(), windows[index].from.toISOString());
  }
});

test('worker executor sends the connected credential and commits source games', async () => {
  const from = new Date('2026-01-01T00:00:00.000Z');
  const to = new Date('2026-01-02T00:00:00.000Z');
  const run = {
    id: 7, appUserId: 3, provider: 'LICHESS', mode: 'BOUNDED_INITIAL', source: 'LICHESS_API', status: 'QUEUED',
    scopeVersion: 1, scopeHash: 'hash', scopeJson: { provider: 'LICHESS', speeds: ['bullet', 'blitz', 'rapid'] },
    requestedFrom: from, requestedTo: to, lichessUserIdSnapshot: 'u1', lichessUsernameSnapshot: 'Alice', checkpointJson: null,
    windowsTotal: 1, windowsCompleted: 0, gamesSeen: 0, gamesMatchedScope: 0, gamesImported: 0, gamesDuplicate: 0,
    gamesUpdated: 0, gamesSkipped: 0, gamesSkippedOutOfScope: 0, gamesFailed: 0, lastProgressAt: null, workKey: 'w',
    claimedAt: null, heartbeatAt: null, cancelRequestedAt: null, rateLimitUntil: null, errorCode: null, error: null,
    startedAt: null, completedAt: null, createdAt: from, updatedAt: from,
  };
  const calls = [];
  const repository = {
    async claimNextRun() { run.status = 'RUNNING'; return run; },
    async getRun() { return run; },
    async heartbeat() {},
    async updateProgress(_id, _claimedAt, patch) { Object.assign(run, patch); },
    async commitGames(_runId, _appUserId, _claimedAt, games) { assert.equal(games.length, 1); return { imported: 1, duplicate: 0, updated: 0 }; },
    async completeRun() { run.status = 'COMPLETED'; },
    async cancelRun() { run.status = 'CANCELLED'; },
    async failRun(_id, code, message) { run.status = 'FAILED'; run.errorCode = code; run.error = message; },
    async deferRun() { run.status = 'QUEUED'; },
  };
  const service = createLichessAccountImportService({
    repository,
    connectionService: {
      async getCredentialForUser() { return { lichessUserId: 'u1', username: 'Alice', accessToken: 'secret', credentialGeneration: 'generation-1' }; },
      async markCredentialRevokedForUser() { return true; },
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), headers: init.headers });
      return new Response(JSON.stringify({
        id: 'game-1', speed: 'bullet', rated: true, variant: 'standard', createdAt: from.getTime(),
        lastMoveAt: from.getTime() + 1000, status: 'outoftime', winner: 'white', clocks: [6000, 5900],
        clock: { initial: 60, increment: 0 }, players: { white: { user: { id: 'u1', name: 'Alice' } }, black: { user: { id: 'u2', name: 'Bob' } } },
      }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
    },
    now: () => from,
  });
  await service.runOnce();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.Authorization, 'Bearer secret');
  assert.equal(calls[0].headers.Accept, 'application/x-ndjson');
  assert.equal(new URL(calls[0].url).searchParams.get('clocks'), 'true');
  assert.equal(run.status, 'COMPLETED');
});

test('worker finalizes cancellation immediately when a running lease is cancelled during persistence', async () => {
  const from = new Date('2026-01-01T00:00:00.000Z');
  const claimedAt = new Date('2026-01-01T00:00:01.000Z');
  const run = {
    id: 8, appUserId: 3, provider: 'LICHESS', mode: 'BOUNDED_INITIAL', source: 'LICHESS_API', status: 'RUNNING',
    scopeVersion: 1, scopeHash: 'hash-cancel', scopeJson: { provider: 'LICHESS', speeds: ['bullet', 'blitz', 'rapid'] },
    requestedFrom: from, requestedTo: new Date('2026-01-02T00:00:00.000Z'), lichessUserIdSnapshot: 'u1',
    lichessUsernameSnapshot: 'Alice', checkpointJson: null, windowsTotal: 1, windowsCompleted: 0, gamesSeen: 0,
    gamesMatchedScope: 0, gamesImported: 0, gamesDuplicate: 0, gamesUpdated: 0, gamesSkipped: 0,
    gamesSkippedOutOfScope: 0, gamesFailed: 0, lastProgressAt: claimedAt, workKey: 'cancel-work',
    claimedAt, heartbeatAt: claimedAt, cancelRequestedAt: null, rateLimitUntil: null, errorCode: null, error: null,
    startedAt: claimedAt, completedAt: null, createdAt: from, updatedAt: claimedAt,
  };
  let cancelFinalizations = 0;
  const repository = {
    async claimNextRun() { return null; },
    async getRun() { return run; },
    async heartbeat() {},
    async updateProgress() {},
    async commitGames() {
      run.status = 'CANCEL_REQUESTED';
      run.cancelRequestedAt = claimedAt;
      throw new ImportLeaseLostError(run.id);
    },
    async completeRun() { throw new Error('must not complete'); },
    async cancelRun(_id, lease) {
      assert.equal(lease.getTime(), claimedAt.getTime());
      cancelFinalizations += 1;
      run.status = 'CANCELLED';
      run.completedAt = claimedAt;
    },
    async failRun() { throw new Error('must not fail'); },
    async deferRun() { throw new Error('must not defer'); },
  };
  const service = createLichessAccountImportService({
    repository,
    connectionService: {
      async getCredentialForUser() {
        return { lichessUserId: 'u1', username: 'Alice', accessToken: 'secret', credentialGeneration: 'generation-1' };
      },
      async markCredentialRevokedForUser() { return true; },
    },
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'game-cancel', speed: 'bullet', rated: true, variant: 'standard', createdAt: from.getTime(),
      lastMoveAt: from.getTime() + 1000, status: 'outoftime', winner: 'white',
      players: { white: { user: { id: 'u1', name: 'Alice' } }, black: { user: { id: 'u2', name: 'Bob' } } },
    }) + '\n'),
    now: () => claimedAt,
  });

  const result = await service.executeRun(run);
  assert.equal(cancelFinalizations, 1);
  assert.equal(result.status, 'CANCELLED');
});

test('malformed NDJSON is classified separately from a valid record', async () => {
  const response = new Response('{"id":"ok"}\nnot-json\n');
  const iterator = readLichessNdjson(response);
  assert.deepEqual((await iterator.next()).value, { id: 'ok' });
  await assert.rejects(iterator.next(), (error) => error instanceof LichessNdjsonRecordError && error.lineNumber === 2);
});
