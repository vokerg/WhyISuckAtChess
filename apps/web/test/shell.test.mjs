import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('web bootstrap uses Angular standalone bootstrap and the root shell', async () => {
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  const component = await readFile(new URL('../src/app/app.component.ts', import.meta.url), 'utf8');
  assert.match(main, /bootstrapApplication\(AppComponent/);
  assert.match(component, /selector: 'app-root'/);
});
