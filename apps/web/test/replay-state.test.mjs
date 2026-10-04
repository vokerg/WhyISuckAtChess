import assert from 'node:assert/strict';
import test from 'node:test';
import { ReplayStepper } from '../src/app/features/games/state/replay-stepper.ts';
import {
  parseReplayRequestedPly,
  resolveReplayRequestedPly,
} from '../src/app/features/games/state/replay-deep-link.ts';

test('replay stepper traverses positions without leaving the indexed ply range', () => {
  const stepper = new ReplayStepper();
  stepper.setTotalPlies(4);

  assert.equal(stepper.currentPly, 0);
  assert.equal(stepper.goToNext(), 1);
  assert.equal(stepper.goToNext(), 2);
  assert.equal(stepper.goToEnd(), 4);
  assert.equal(stepper.goToNext(), 4);
  assert.equal(stepper.goToPrevious(), 3);
  assert.equal(stepper.goToStart(), 0);
  assert.equal(stepper.select(99), 0);
  assert.equal(stepper.select(2), 2);
});

test('URL replay target parser accepts only positive safe canonical ply numbers', () => {
  assert.equal(parseReplayRequestedPly('31'), 31);
  for (const value of [null, '', '0', '-1', '01', '+1', '2.5', '1x', '1e3', ' 1', '9007199254740992']) {
    assert.equal(parseReplayRequestedPly(value), null);
  }
});

test('URL replay target resolves only to an indexed ply and otherwise starts at zero', () => {
  assert.equal(resolveReplayRequestedPly(2, 2), 2);
  for (const value of [null, 0, -1, 3, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(resolveReplayRequestedPly(value, 2), 0);
  }
  assert.equal(resolveReplayRequestedPly(1, 0), 0);
});
