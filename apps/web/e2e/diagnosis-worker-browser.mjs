import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { chromium } from 'playwright';

// Browser transport forwards to the real fixture-backed API. It never substitutes
// diagnosis responses or executes calculation from a frontend request.
export async function startDiagnosisBrowser(apiOrigin) {
  const origin = 'http://127.0.0.1:4299';
  const server = spawn('npm', ['run', 'dev', '--workspace=apps/web', '--', '--host', '127.0.0.1', '--port', '4299'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stdout.on('data', (chunk) => { output = (output + chunk).slice(-4000); });
  server.stderr.on('data', (chunk) => { output = (output + chunk).slice(-4000); });
  let browser;
  async function stop() {
    await browser?.close();
    if (server.exitCode === null) {
      try { process.kill(-server.pid, 'SIGTERM'); } catch {}
    }
  }
  try {
    let ready = false;
    for (let i = 0; i < 90; i++) {
      if (server.exitCode !== null) throw Error('Angular exited: ' + output);
      try { if ((await fetch(origin)).ok) { ready = true; break; } } catch {}
      await pause(1000);
    }
    if (!ready) throw Error('Angular failed to start: ' + output);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: apiOrigin + url.pathname + url.search });
      await route.fulfill({ response });
    });
    await page.goto(origin + '/diagnosis');
    return { page, stop };
  } catch (error) { await stop(); throw error; }
}
