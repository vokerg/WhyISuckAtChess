import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { chromium } from 'playwright';

// Real Angular routes and browser controls, with deterministic application API fixtures.
// Live provider consent/credentials are deliberately outside this smoke test.
const origin = 'http://127.0.0.1:4200';
const connectedAccount = {
  lichessUserId: 'owned-lichess-id',
  username: 'OwnedLichessPlayer',
  scopes: [],
  connectedAt: '2026-09-01T00:00:00.000Z',
  expiresAt: null,
};
const missing = { connected: false, credentialState: 'missing', reconnectRequired: true, account: null };
const usable = { connected: true, credentialState: 'usable', reconnectRequired: false, account: connectedAccount };

function importRun(status = 'QUEUED') {
  return {
    id: 7,
    provider: 'LICHESS',
    status,
    lichessUserIdSnapshot: 'owned-lichess-id',
    lichessUsernameSnapshot: 'OwnedLichessPlayer',
    scope: { provider: 'LICHESS', speeds: ['bullet', 'blitz', 'rapid'], rated: true },
    requestedFrom: '2026-09-01T00:00:00.000Z',
    requestedTo: '2026-09-30T00:00:00.000Z',
    windowsTotal: 1,
    windowsCompleted: status === 'COMPLETED' ? 1 : 0,
    gamesSeen: 0,
    gamesMatchedScope: 0,
    gamesImported: 0,
    gamesDuplicate: 0,
    gamesUpdated: 0,
    gamesSkipped: 0,
    gamesFailed: 0,
    gamesSkippedOutOfScope: 0,
    errorCode: null,
    error: null,
    lastProgressAt: null,
    rateLimitUntil: null,
    startedAt: null,
    completedAt: status === 'COMPLETED' ? '2026-09-30T00:00:00.000Z' : null,
  };
}

async function awaitServer(proc) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (proc.exitCode !== null) throw new Error('Angular development server exited early.');
    try {
      const response = await fetch(origin + '/', { headers: { Accept: 'text/html' } });
      if (response.ok) return;
    } catch {
      // Still starting.
    }
    await pause(1000);
  }
  throw new Error('Angular development server did not become ready.');
}

const server = spawn('npm', ['run', 'dev', '--workspace=apps/web', '--', '--host', '127.0.0.1', '--port', '4200'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += String(chunk).slice(-2000); });
server.stderr.on('data', (chunk) => { serverOutput += String(chunk).slice(-2000); });

let browser;
try {
  await awaitServer(server);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  let connection = missing;
  let persistedRun = null;
  let createMode = 'success';
  let receivedImport = null;
  let disconnects = 0;

  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const respond = (status, data) => route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify(data),
    });

    if (path === '/api/me/lichess-connection' && method === 'GET') return respond(200, connection);
    if (path === '/api/me/lichess-connection/start' && method === 'POST') {
      return respond(200, { url: 'https://lichess.org/oauth?response_type=code&client_id=fixture' });
    }
    if (path === '/api/me/lichess-connection' && method === 'DELETE') {
      disconnects++;
      connection = missing;
      return respond(200, { disconnected: true });
    }
    if (path === '/api/me/imports/lichess/latest' && method === 'GET') {
      return respond(200, { importRun: persistedRun });
    }
    if (path === '/api/me/imports/lichess' && method === 'POST') {
      receivedImport = request.postDataJSON();
      if (createMode === 'conflict') {
        persistedRun = importRun();
        return respond(409, { code: 'ACTIVE_IMPORT', message: 'An import is already active.' });
      }
      persistedRun = importRun();
      return respond(202, { importRun: persistedRun });
    }
    if (path === '/api/me/imports/7' && method === 'GET') return respond(200, { importRun: persistedRun });
    if (path === '/api/me/imports/7/cancel' && method === 'POST') {
      persistedRun = { ...persistedRun, status: 'CANCEL_REQUESTED' };
      return respond(200, { importRun: persistedRun });
    }
    return respond(404, { message: 'Not part of deterministic browser fixture.' });
  });

  // Fake provider authorization redirects to the app; only the subsequent API
  // connection response establishes authority, never the callback query alone.
  await context.route('https://lichess.org/oauth**', async (route) => {
    connection = usable;
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<script>location.replace("' + origin + '/settings/lichess?lichessConnected=1")</script>',
    });
  });

  // Callback query parameters are notices, never authentication authority.
  await page.goto(origin + '/settings/lichess?lichessConnected=1');
  await page.getByText(/Authorization return noted/).waitFor();
  await page.getByText(/No Lichess identity is connected/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Start bounded import' }).isDisabled(), true);

  // Fresh entry points remain discoverable even with no imported evidence.
  await page.goto(origin + '/games');
  await page.getByRole('link', { name: 'Connect / import Lichess' }).waitFor();
  await page.goto(origin + '/diagnosis');
  await page.getByRole('link', { name: 'Connect / import Lichess' }).waitFor();

  // The first user-driven connection step starts OAuth and returns through the
  // mocked provider to the authoritative backend connection read.
  await page.getByRole('link', { name: 'Connect / import Lichess' }).click();
  await page.getByRole('button', { name: 'Connect Lichess' }).click();
  await page.getByText('OwnedLichessPlayer').first().waitFor();

  // Explicit import of the server-owned identity; the UI sends UTC instants.
  await page.getByText('OwnedLichessPlayer').first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'Start bounded import' }).isEnabled(), true);
  const from = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const to = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
  await page.getByLabel('From (local time)').fill(from);
  await page.getByLabel('To (local time, exclusive)').fill(to);
  await page.getByLabel('Rated scope').selectOption('rated');
  await page.getByRole('button', { name: 'Start bounded import' }).click();
  await page.getByText(/Run #7/).waitFor();
  assert.equal(receivedImport.from, new Date(from).toISOString());
  assert.equal(receivedImport.to, new Date(to).toISOString());
  assert.equal(receivedImport.rated, true);
  assert.equal('userId' in receivedImport, false);
  assert.equal('username' in receivedImport, false);
  assert.equal(await page.getByRole('button', { name: 'Start bounded import' }).isDisabled(), true);

  // Reload uses the owned backend latest-run read, not browser-local authority.
  await page.reload();
  await page.getByText(/Run #7/).waitFor();
  await page.getByRole('button', { name: 'Request cancellation' }).click();
  await page.getByText(/Cancellation requested/).waitFor();
  assert.equal(persistedRun.status, 'CANCEL_REQUESTED');
  assert.equal(await page.getByRole('button', { name: 'Request cancellation' }).isDisabled(), true);

  // Zero-game completion is distinct from engine/evidence/diagnosis readiness.
  persistedRun = importRun('COMPLETED');
  await page.getByRole('button', { name: 'Reload' }).click();
  await page.getByText(/Zero imported games is a valid outcome/).waitFor();
  await page.getByRole('link', { name: 'Check diagnosis availability' }).waitFor();

  // An active conflict attaches to durable progress after a fresh attempt.
  persistedRun = null;
  createMode = 'conflict';
  await page.reload();
  await page.getByRole('button', { name: 'Start bounded import' }).click();
  await page.getByText(/Recovered its server-owned progress/).waitFor();
  await page.getByText(/Run #7/).waitFor();

  // Non-usable credential states are displayed distinctly, and disconnect is confirmed.
  for (const credentialState of ['expired', 'revoked', 'undecryptable']) {
    connection = { ...usable, credentialState, reconnectRequired: true };
    await page.reload();
    await page.locator('.credential[data-state="' + credentialState + '"]').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Start bounded import' }).isDisabled(), true);
  }
  connection = usable;
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'Disconnect Lichess' }).click();
  await page.getByText(/Lichess disconnect completed/).waitFor();
  await page.getByText(/No Lichess identity is connected/).waitFor();
  assert.equal(disconnects, 1);

  console.log('Browser onboarding acceptance passed: navigation, callback authority, import, recovery, conflict, cancellation, credential states and disconnect.');
  await context.close();
} catch (error) {
  console.error('Browser onboarding acceptance failed:', error);
  console.error('Angular server output:', serverOutput.slice(-5000));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* Already stopped. */ }
}