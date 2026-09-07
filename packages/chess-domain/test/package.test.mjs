import assert from 'node:assert/strict';
import test from 'node:test';
import { chessDomainPackage } from '../dist/index.js';

test('chess-domain package is executable', () => {
  assert.equal(chessDomainPackage, 'why-i-suck-at-chess/chess-domain');
});
