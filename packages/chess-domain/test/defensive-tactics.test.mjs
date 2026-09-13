import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectBackRankMateByMove,
  detectDefenderRemovalCreatedByMove,
  detectOverloadedDefenders,
  inspectLegalUciMove,
} from '../dist/index.js';

test('inspects legal moves without accepting illegal UCI geometry', () => {
  const move = inspectLegalUciMove(
    '4k3/8/8/8/8/8/4P3/4K3 w - -',
    'e2e4',
  );
  assert.ok(move);
  assert.equal(move.moverColor, 'WHITE');
  assert.equal(move.from, 'e2');
  assert.equal(move.to, 'e4');
  assert.equal(move.capturedPiece, null);

  assert.equal(inspectLegalUciMove(
    '4k3/8/8/8/8/8/4P3/4K3 w - -',
    'e2e5',
  ), null);
});

test('detects concrete removal of a defender only when an attacked target loses that defender', () => {
  const removal = detectDefenderRemovalCreatedByMove(
    '4k3/8/8/qb6/8/8/P2N4/5RK1 b - -',
    'a5d2',
  );
  assert.ok(removal);
  assert.equal(removal.removedDefenderSquare, 'd2');
  assert.equal(removal.removedDefenderPiece, 'n');

  const rook = removal.targets.find((target) => target.square === 'f1');
  assert.ok(rook);
  assert.equal(rook.piece, 'r');
  assert.equal(rook.defendersBefore.includes('d2'), true);
  assert.equal(rook.defendersAfter.includes('d2'), false);
  assert.equal(rook.attackersAfter.includes('b5'), true);

  assert.equal(detectDefenderRemovalCreatedByMove(
    '4k3/8/8/q7/8/8/P2N4/5RK1 b - -',
    'a5d2',
  ), null);
});

test('detects an overloaded defender from two simultaneously attacked defended targets', () => {
  const overloads = detectOverloadedDefenders(
    'q3k3/8/8/1b6/8/5R2/P2N4/5RK1 w - -',
    'WHITE',
  );
  const knight = overloads.find((entry) => entry.defenderSquare === 'd2');
  assert.ok(knight);
  assert.equal(knight.defenderPiece, 'n');
  assert.deepEqual(
    knight.targets.map((target) => target.square),
    ['f1', 'f3'],
  );
});

test('classifies an actual rook back-rank mate and rejects the same check with an escape square', () => {
  const mate = detectBackRankMateByMove(
    'k3r3/8/8/8/8/8/5PPP/6K1 b - -',
    'e8e1',
  );
  assert.ok(mate);
  assert.equal(mate.kingSquare, 'g1');
  assert.equal(mate.backRank, 1);
  assert.equal(mate.matingPiece, 'r');

  assert.equal(detectBackRankMateByMove(
    'k3r3/8/8/8/8/8/5PP1/6K1 b - -',
    'e8e1',
  ), null);
});
