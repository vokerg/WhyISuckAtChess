import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MoveClassificationCode,
  classifyPly,
  effectiveScoreCpWhite,
  scoreFromSideToMoveToWhite,
  scoreLossForSide,
} from '../dist/index.js';

test('normalizes Stockfish side-to-move scores to white perspective', () => {
  assert.equal(scoreFromSideToMoveToWhite(35, '8/8/8/8/8/8/8/K6k w - - 0 1'), 35);
  assert.equal(scoreFromSideToMoveToWhite(35, '8/8/8/8/8/8/8/K6k b - - 0 1'), -35);
  assert.equal(scoreFromSideToMoveToWhite(-4, 'b'), 4);
});

test('normalizes mate scores and computes mover-relative loss', () => {
  assert.equal(effectiveScoreCpWhite(null, 3), 1000);
  assert.equal(effectiveScoreCpWhite(null, -2), -1000);
  assert.equal(scoreLossForSide(200, 50, 'WHITE'), 150);
  assert.equal(scoreLossForSide(-200, -50, 'BLACK'), 150);
  assert.equal(scoreLossForSide(50, 200, 'WHITE'), 0);
});

test('classifies exact centipawn-loss boundaries deterministically', () => {
  const classify = (scoreLossCp) => classifyPly({
    moveUci: 'e2e4',
    bestMoveUci: 'd2d4',
    scoreLossCp,
  });

  assert.equal(classify(0), MoveClassificationCode.Best);
  assert.equal(classify(29), MoveClassificationCode.Good);
  assert.equal(classify(30), MoveClassificationCode.Inaccuracy);
  assert.equal(classify(79), MoveClassificationCode.Inaccuracy);
  assert.equal(classify(80), MoveClassificationCode.Mistake);
  assert.equal(classify(179), MoveClassificationCode.Mistake);
  assert.equal(classify(180), MoveClassificationCode.Blunder);
  assert.equal(classifyPly({
    moveUci: 'e2e4',
    bestMoveUci: 'e2e4',
    scoreLossCp: 500,
  }), MoveClassificationCode.Best);
});
