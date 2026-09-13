import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POSITION_PHASE_CLASSIFIER_VERSION,
  classifyEndgameFamily,
  classifyPositionPhase,
  stabilizeGamePhase,
} from '../dist/index.js';

test('classifies opening, middlegame, and endgame from board state', () => {
  const opening = classifyPositionPhase(
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
  );
  assert.equal(opening.phase, 'OPENING');
  assert.equal(opening.endgameFamily, 'NONE');

  const middlegame = classifyPositionPhase(
    'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 w - -',
  );
  assert.equal(middlegame.phase, 'MIDDLEGAME');

  const endgame = classifyPositionPhase(
    '8/8/8/3k4/8/4K3/4P3/8 w - -',
  );
  assert.equal(endgame.phase, 'ENDGAME');
  assert.equal(endgame.endgameFamily, 'PAWN');
  assert.equal(POSITION_PHASE_CLASSIFIER_VERSION, 'phase-v1');
});

test('classifies deterministic endgame material families', () => {
  assert.equal(
    classifyEndgameFamily('8/8/8/3k4/8/4K3/4P3/R6r w - -'),
    'ROOK',
  );
  assert.equal(
    classifyEndgameFamily('7q/8/8/3k4/8/4K3/4P3/Q7 w - -'),
    'QUEEN',
  );
  assert.equal(
    classifyEndgameFamily('8/8/8/3k4/8/4K3/3BP3/6n1 w - -'),
    'BISHOP_VS_KNIGHT',
  );
  assert.equal(
    classifyEndgameFamily('2b5/8/8/3k4/8/4K3/3BP3/8 w - -'),
    'OPPOSITE_COLORED_BISHOPS',
  );
  assert.equal(
    classifyEndgameFamily('8/8/8/3k4/1b6/4K3/3BP3/8 w - -'),
    'SAME_COLORED_BISHOPS',
  );
  assert.equal(
    classifyEndgameFamily('7r/8/8/3k4/8/4K3/3BP3/R7 w - -'),
    'ROOK_AND_MINOR',
  );
  assert.equal(
    classifyEndgameFamily('6qr/8/8/3k4/8/4K3/4P3/RQ6 w - -'),
    'MIXED_PIECE',
  );
  assert.equal(
    classifyEndgameFamily('8/8/8/3k4/8/4K3/8/8 w - -'),
    'UNKNOWN',
    'bare kings are not forced into the pawn-ending family',
  );
});

test('classifies material simplification across the endgame threshold', () => {
  const before = classifyPositionPhase(
    'r1b1k1nr/8/8/8/8/8/8/R1BQK2R w - -',
  );
  const after = classifyPositionPhase(
    'r3k2r/8/8/8/8/8/8/R3K2R w - -',
  );

  assert.equal(before.phase, 'MIDDLEGAME');
  assert.equal(after.phase, 'ENDGAME');
  assert.equal(after.endgameFamily, 'ROOK');
  assert.equal(stabilizeGamePhase(before.phase, after.phase), 'ENDGAME');
});

test('keeps game phase monotonic across structural reversals such as promotion', () => {
  assert.equal(stabilizeGamePhase('OPENING', 'MIDDLEGAME'), 'MIDDLEGAME');
  assert.equal(stabilizeGamePhase('MIDDLEGAME', 'OPENING'), 'MIDDLEGAME');
  assert.equal(stabilizeGamePhase('ENDGAME', 'MIDDLEGAME'), 'ENDGAME');

  const beforePromotion = classifyPositionPhase(
    'r1b1k2r/6P1/8/8/8/8/8/R1B1K2R w - -',
  );
  const afterPromotion = classifyPositionPhase(
    'r1b1k1Qr/8/8/8/8/8/8/R1B1K2R b - -',
  );
  assert.equal(beforePromotion.phase, 'ENDGAME');
  assert.equal(afterPromotion.phase, 'MIDDLEGAME');
  assert.equal(
    stabilizeGamePhase(beforePromotion.phase, afterPromotion.phase),
    'ENDGAME',
  );
});

test('keeps invalid or ambiguous board input explicit', () => {
  const invalid = classifyPositionPhase('not-a-fen');
  assert.equal(invalid.phase, 'UNKNOWN');
  assert.equal(invalid.endgameFamily, 'UNKNOWN');
  assert.equal(invalid.measurements, null);
  assert.equal(classifyEndgameFamily('not-a-fen'), 'UNKNOWN');
});
