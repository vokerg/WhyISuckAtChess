import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyseLegalMaterialMove,
  materialBalanceForColor,
  materialInventory,
} from '../dist/index.js';

test('accounts material from normalized four-field FENs', () => {
  const inventory = materialInventory(
    '4k3/8/8/3q4/2B5/8/8/4K3 w - -',
  );

  assert.equal(inventory.white.b, 1);
  assert.equal(inventory.black.q, 1);
  assert.equal(inventory.whitePoints, 3);
  assert.equal(inventory.blackPoints, 9);
  assert.equal(
    materialBalanceForColor(
      '4k3/8/8/3q4/2B5/8/8/4K3 w - -',
      'WHITE',
    ),
    -6,
  );
});

test('identifies a free or favorable legal material capture', () => {
  const capture = analyseLegalMaterialMove(
    '4k3/8/8/3q4/2B5/8/8/4K3 w - -',
    'c4d5',
  );

  assert.ok(capture);
  assert.equal(capture.capturedPiece, 'q');
  assert.equal(capture.attackerValue, 3);
  assert.equal(capture.capturedValue, 9);
  assert.deepEqual(capture.defenderSquares, []);
  assert.equal(capture.materialDeltaForMover, 9);
  assert.equal(capture.isFavorableMaterialCapture, true);
});

test('does not call an equal defended exchange a favorable material capture', () => {
  const capture = analyseLegalMaterialMove(
    '4k3/8/4p3/3b4/2B5/8/8/4K3 w - -',
    'c4d5',
  );

  assert.ok(capture);
  assert.equal(capture.capturedPiece, 'b');
  assert.deepEqual(capture.defenderSquares, ['e6']);
  assert.equal(capture.attackerValue, 3);
  assert.equal(capture.capturedValue, 3);
  assert.equal(capture.isFavorableMaterialCapture, false);
});

test('includes promotion gain in material-state accounting', () => {
  const promotion = analyseLegalMaterialMove(
    '4k3/P7/8/8/8/8/8/4K3 w - -',
    'a7a8q',
  );

  assert.ok(promotion);
  assert.equal(promotion.capturedPiece, null);
  assert.equal(promotion.promotion, 'q');
  assert.equal(promotion.promotionGain, 8);
  assert.equal(promotion.materialDeltaForMover, 8);
});
