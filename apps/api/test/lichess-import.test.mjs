import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLichessGamesRequestUrl,
  LichessNdjsonRecordError,
  LichessNdjsonRecordTooLargeError,
  MAX_LICHESS_NDJSON_RECORD_BYTES,
  normalizeLichessGame,
  readLichessNdjson,
} from '../dist/modules/account-imports/providers/lichess/lichess-account-import.js';
import { createLichessAccountImportService, planImportWindows, toImportRunResponse } from '../dist/modules/account-imports/account-import.service.js';
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


test('worker failures never persist raw credential or provider exception details into import status', async () => {
  for (const failureSource of ['credential', 'provider']) {
    const now = new Date('2026-10-13T04:30:00.000Z');
    const secret = 'secret-token-in-exception-' + failureSource;
    const run = {
      id: 42, appUserId: 7, status: 'RUNNING',
      claimedAt: now, cancelRequestedAt: null,
      requestedFrom: new Date('2026-01-01T00:00:00.000Z'),
      requestedTo: new Date('2026-01-02T00:00:00.000Z'),
      lichessUserIdSnapshot: 'u1', checkpointJson: null,
      scopeJson: { provider: 'LICHESS', speeds: ['bullet', 'blitz', 'rapid'] },
      errorCode: null, error: null,
    };
    let failureWrites = 0;
    const repository = {
      async getRun(appUserId, runId) {
        assert.equal(appUserId, run.appUserId);
        assert.equal(runId, run.id);
        return run;
      },
      async failRun(runId, claimedAt, code, message) {
        assert.equal(runId, run.id);
        assert.equal(claimedAt, now);
        failureWrites += 1;
        run.status = 'FAILED';
        run.errorCode = code;
        run.error = message;
      },
    };
    const service = createLichessAccountImportService({
      repository,
      connectionService: {
        async getCredentialForUser() {
          if (failureSource === 'credential') {
            throw new Error('Credential adapter failed with Authorization: Bearer ' + secret);
          }
          return { lichessUserId: 'u1', username: 'Alice', accessToken: secret, credentialGeneration: 'generation-1' };
        },
        async markCredentialRevokedForUser() { return true; },
      },
      fetchImpl: async () => {
        throw new Error('Provider fetch failed with Authorization: Bearer ' + secret);
      },
      now: () => now,
    });

    const result = await service.executeRun(run);
    const expectedCode = failureSource === 'credential' ? 'AUTH_REQUIRED' : 'IMPORT_FAILED';
    const expectedMessage = failureSource === 'credential'
      ? 'Lichess credential unavailable. Reconnect Lichess before importing.'
      : 'Lichess import failed. Retry the import.';

    assert.equal(failureWrites, 1, failureSource);
    assert.equal(result.status, 'FAILED');
    assert.equal(result.errorCode, expectedCode);
    assert.equal(result.error, expectedMessage);
    assert.equal(JSON.stringify(toImportRunResponse(result)).includes(secret), false, failureSource);
  }
});


test('NDJSON reader abort interrupts an already pending upstream body read', { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const response = new Response(new ReadableStream({ start() {} }));
  const result = readLichessNdjson(response, controller.signal).next();
  controller.abort(new Error('deliberate body stall abort'));
  await assert.rejects(result, /deliberate body stall abort/);
});

test('worker bounds both stalled provider headers and stalled NDJSON response bodies', { timeout: 5000 }, async () => {
  for (const stalledAt of ['headers', 'body']) {
    const claimedAt = new Date('2026-10-13T07:30:00.000Z');
    const run = {
      id: 74, appUserId: 7, status: 'RUNNING', claimedAt, cancelRequestedAt: null,
      requestedFrom: new Date('2026-01-01T00:00:00.000Z'),
      requestedTo: new Date('2026-01-02T00:00:00.000Z'),
      lichessUserIdSnapshot: 'u1', checkpointJson: null,
      scopeJson: { provider: 'LICHESS', speeds: ['bullet', 'blitz', 'rapid'] },
      errorCode: null, error: null,
    };
    let failWrites = 0;
    let fetchSignals = 0;
    const repository = {
      async getRun(appUserId, runId) {
        assert.equal(appUserId, run.appUserId);
        assert.equal(runId, run.id);
        return run;
      },
      async failRun(id, lease, code, message) {
        assert.equal(id, run.id);
        assert.equal(lease, claimedAt);
        failWrites += 1;
        run.status = 'FAILED';
        run.errorCode = code;
        run.error = message;
      },
    };
    const service = createLichessAccountImportService({
      repository,
      connectionService: {
        async getCredentialForUser() {
          return { lichessUserId: 'u1', username: 'Alice', accessToken: 'secret-credential-value', credentialGeneration: 'generation-1' };
        },
        async markCredentialRevokedForUser() { return true; },
      },
      fetchImpl: async (_url, init) => {
        assert.equal(init.headers.Authorization, 'Bearer secret-credential-value');
        assert.ok(init.signal instanceof AbortSignal, 'fetch must receive window deadline');
        fetchSignals += 1;
        if (stalledAt === 'headers') {
          return new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
          });
        }
        return new Response(new ReadableStream({ start() {} }));
      },
      now: () => claimedAt,
      providerWindowTimeoutMs: 30,
    });

    const result = await service.executeRun(run);
    assert.equal(fetchSignals, 1, stalledAt);
    assert.equal(failWrites, 1, stalledAt);
    assert.equal(result.status, 'FAILED', stalledAt);
    assert.equal(result.errorCode, 'PROVIDER_TIMEOUT', stalledAt);
    assert.equal(result.error, 'Lichess import timed out. Retry the import.', stalledAt);
    assert.equal(JSON.stringify(toImportRunResponse({
      ...result,
      requestedFrom: run.requestedFrom,
      requestedTo: run.requestedTo,
    })).includes('secret-credential-value'), false);
  }
});

test('provider rate-limit Retry-After seconds and HTTP-dates produce bounded durable deferrals', async () => {
  const now = new Date('2026-10-14T06:00:00.000Z');
  const cases = [
    { label: 'numeric seconds', header: '120', delayMs: 120_000 },
    { label: 'oversized numeric seconds', header: '86400', delayMs: 3_600_000 },
    { label: 'valid HTTP-date', header: 'Wed, 14 Oct 2026 06:02:00 GMT', delayMs: 120_000 },
    { label: 'distant HTTP-date', header: 'Thu, 15 Oct 2026 06:00:00 GMT', delayMs: 3_600_000 },
    { label: 'past HTTP-date', header: 'Wed, 14 Oct 2026 05:00:00 GMT', delayMs: 60_000 },
    { label: 'zero seconds', header: '0', delayMs: 60_000 },
    { label: 'invalid header', header: 'not-a-date', delayMs: 60_000 },
    { label: 'missing header', header: null, delayMs: 60_000 },
  ];

  for (const { label, header, delayMs } of cases) {
    const claimedAt = new Date(now);
    const run = {
      id: 91, appUserId: 7, status: 'RUNNING', claimedAt, cancelRequestedAt: null,
      requestedFrom: new Date('2026-01-01T00:00:00.000Z'),
      requestedTo: new Date('2026-01-02T00:00:00.000Z'),
      lichessUserIdSnapshot: 'u1', checkpointJson: null,
      scopeJson: { provider: 'LICHESS', speeds: ['bullet', 'blitz', 'rapid'] },
    };
    let deferrals = 0;
    const service = createLichessAccountImportService({
      repository: {
        async getRun(userId, runId) {
          assert.equal(userId, 7);
          assert.equal(runId, 91);
          return run;
        },
        async deferRun(runId, lease, retryAt, code, message) {
          assert.equal(runId, 91);
          assert.equal(lease, claimedAt);
          assert.equal(code, 'RATE_LIMITED');
          assert.equal(message, 'Lichess rate-limited this import window.');
          assert.equal(retryAt.getTime(), now.getTime() + delayMs, label);
          run.status = 'QUEUED';
          run.rateLimitUntil = retryAt;
          deferrals += 1;
        },
        async failRun() { throw new Error('rate limiting must not fail the import'); },
      },
      connectionService: {
        async getCredentialForUser() {
          return { lichessUserId: 'u1', username: 'Alice', accessToken: 'test-secret', credentialGeneration: 'generation-1' };
        },
        async markCredentialRevokedForUser() { throw new Error('must not revoke credential'); },
      },
      fetchImpl: async () => new Response('', {
        status: 429,
        headers: header === null ? {} : { 'Retry-After': header },
      }),
      now: () => now,
    });

    const result = await service.executeRun(run);
    assert.equal(result.status, 'QUEUED', label);
    assert.equal(result.rateLimitUntil.toISOString(), new Date(now.getTime() + delayMs).toISOString(), label);
    assert.equal(deferrals, 1, label);
  }
});


test('NDJSON reader accepts the exact byte limit and multiple records in a larger stream', async () => {
  const prefix = '{"id":"at-limit","pgn":"';
  const suffix = '"}';
  const record = prefix + 'x'.repeat(MAX_LICHESS_NDJSON_RECORD_BYTES - Buffer.byteLength(prefix + suffix)) + suffix;
  assert.equal(Buffer.byteLength(record), MAX_LICHESS_NDJSON_RECORD_BYTES);
  const rows = [];
  for await (const row of readLichessNdjson(new Response(record + '\\n' + '{"id":"next"}\\n'))) {
    rows.push(row);
  }
  assert.deepEqual(rows.map((row) => row.id), ['at-limit', 'next']);
  assert.equal(rows[0].pgn.length, MAX_LICHESS_NDJSON_RECORD_BYTES - Buffer.byteLength(prefix + suffix));
});

test('NDJSON reader rejects fragmented oversized UTF-8 records before JSON parsing', async () => {
  const line = '{"id":"oversize","pgn":"' + 'é'.repeat(Math.floor(MAX_LICHESS_NDJSON_RECORD_BYTES / 2)) + '"}';
  assert.ok(line.length < MAX_LICHESS_NDJSON_RECORD_BYTES, 'limit must count UTF-8 bytes, not code units');
  const bytes = new TextEncoder().encode(line);
  assert.ok(bytes.byteLength > MAX_LICHESS_NDJSON_RECORD_BYTES);
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 31));
      controller.enqueue(bytes.subarray(31));
      controller.close();
    },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(
    async () => { for await (const _record of readLichessNdjson(response)) { throw new Error('unexpected yield'); } },
    (error) => error instanceof LichessNdjsonRecordTooLargeError && error.lineNumber === 1
      && error.message === 'Lichess returned oversized NDJSON on line 1.',
  );
  // The stream may have already closed, but the reader must reject the record.
  assert.equal(typeof cancelled, 'boolean');
});

test('NDJSON reader preserves UTF-8 split across network chunks and CRLF boundaries', async () => {
  const encoded = new TextEncoder().encode('{"id":"unicode","pgn":"é♟"}\\r\\n');
  const middleOfUtf8 = encoded.indexOf(0xc3) + 1;
  assert.ok(middleOfUtf8 > 1);
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoded.subarray(0, middleOfUtf8));
      controller.enqueue(encoded.subarray(middleOfUtf8));
      controller.close();
    },
  }));
  const records = [];
  for await (const record of readLichessNdjson(response)) records.push(record);
  assert.deepEqual(records, [{ id: 'unicode', pgn: 'é♟' }]);
});

test('oversized provider NDJSON fails an import without checkpointing or leaking source bytes', async () => {
  const claimedAt = new Date('2026-10-14T06:00:00.000Z');
  const run = {
    id: 92, appUserId: 7, status: 'RUNNING', claimedAt, cancelRequestedAt: null,
    requestedFrom: new Date('2026-01-01T00:00:00.000Z'),
    requestedTo: new Date('2026-01-02T00:00:00.000Z'),
    lichessUserIdSnapshot: 'u1', checkpointJson: null,
    scopeJson: { provider: 'LICHESS', speeds: ['bullet', 'blitz', 'rapid'] },
    errorCode: null, error: null,
  };
  let failureWrites = 0;
  const repository = {
    async getRun() { return run; },
    async failRun(id, lease, code, message) {
      assert.equal(id, 92);
      assert.equal(lease, claimedAt);
      assert.equal(code, 'PROVIDER_RECORD_TOO_LARGE');
      assert.equal(message, 'Lichess returned oversized NDJSON on line 1.');
      run.status = 'FAILED';
      run.errorCode = code;
      run.error = message;
      failureWrites += 1;
    },
    async updateProgress() { throw new Error('must not checkpoint an oversized window'); },
    async commitGames() { throw new Error('must not persist an oversized first record'); },
  };
  const service = createLichessAccountImportService({
    repository,
    connectionService: {
      async getCredentialForUser() {
        return { lichessUserId: 'u1', username: 'Alice', accessToken: 'secret-credential-value', credentialGeneration: 'generation-1' };
      },
    },
    fetchImpl: async () => new Response('{"id":"large","pgn":"' + 'x'.repeat(MAX_LICHESS_NDJSON_RECORD_BYTES) + '"}'),
    now: () => claimedAt,
  });
  const result = await service.executeRun(run);
  assert.equal(failureWrites, 1);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.errorCode, 'PROVIDER_RECORD_TOO_LARGE');
  assert.equal(result.error.includes('secret-credential-value'), false);
  assert.equal(run.checkpointJson, null);
});
