import assert from 'node:assert/strict';
import test from 'node:test';
import { ReplayStepper } from '../src/app/features/games/state/replay-stepper.ts';

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
