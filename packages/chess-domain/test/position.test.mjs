import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fenTurnColor,
  normalizeFenForPosition,
  reconstructPgnPlies,
} from '../dist/index.js';

test('normalizes position identity without halfmove/fullmove counters', () => {
  assert.equal(
    normalizeFenForPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 7 42'),
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
  );
});

test('reconstructs deterministic ordered plies with before/after positions', () => {
  const plies = reconstructPgnPlies('[Event "fixture"]\n\n1. e4 e5 2. Nf3 Nc6 *');
  assert.equal(plies.length, 4);
  assert.equal(plies[0].moveUci, 'e2e4');
  assert.equal(plies[0].moverColor, 'WHITE');
  assert.equal(plies[1].moverColor, 'BLACK');
  assert.equal(plies[3].plyNumber, 4);
  assert.equal(fenTurnColor(plies[3].afterFen), 'WHITE');
  assert.notEqual(plies[0].beforeNormalizedFen, plies[0].afterNormalizedFen);
});

test('surfaces invalid PGN reconstruction explicitly', () => {
  assert.throws(
    () => reconstructPgnPlies('[Event "broken"]\n\n1. e4 e5 2. ThisIsNotAMove *'),
    /Could not parse imported game PGN/,
  );
});
