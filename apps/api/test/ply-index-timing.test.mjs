import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alignLichessClockStates,
  derivePlyTiming,
  isStandardImportedGameSpeed,
  isStandardImportedGameVariant,
} from '../dist/modules/timing/timing-policy.js';

function align(values, moveCount, overrides = {}) {
  return alignLichessClockStates({
    moveCount,
    rawClockPresence: 'PRESENT',
    rawClockStates: values.map((valueCentiseconds, index) => ({
      sourceOrdinal: index + 1,
      valueCentiseconds,
    })),
    provider: 'LICHESS',
    status: 'mate',
    terminalActiveColor: 'WHITE',
    ...overrides,
  });
}

test('bullet/blitz/rapid are eligible while correspondence and variants are excluded', () => {
  assert.equal(isStandardImportedGameSpeed('bullet'), true);
  assert.equal(isStandardImportedGameSpeed('blitz'), true);
  assert.equal(isStandardImportedGameSpeed('rapid'), true);
  assert.equal(isStandardImportedGameSpeed('correspondence'), false);
  assert.equal(isStandardImportedGameVariant('standard'), true);
  assert.equal(isStandardImportedGameVariant('chess960'), false);
});

test('aligns one durable source clock to each reconstructed ply', () => {
  const result = align([5900, 5900, 5800, 5700], 4);
  assert.equal(result.status, 'COMPLETE');
  assert.deepEqual(result.aligned.map((fact) => [fact.plyNumber, fact.sourceOrdinal]), [
    [1, 1], [2, 2], [3, 3], [4, 4],
  ]);
});

test('keeps a proven terminal extra state separate from plies', () => {
  const result = align([5900, 5900, 5800], 2, { status: 'timeout', terminalActiveColor: 'WHITE' });
  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.aligned.length, 2);
  assert.deepEqual(result.terminal, {
    sourceOrdinal: 3,
    valueCentiseconds: 5800,
    activeColor: 'WHITE',
    semantics: 'TERMINAL_ACTIVE_TURN_REMAINING',
    alignmentVersion: 1,
  });
});

test('does not guess alignment for short, invalid, or excessive clock sequences', () => {
  assert.equal(align([5900], 2).reason, 'CLOCK_SEQUENCE_UNALIGNED');
  assert.equal(align([5900, 5900, 5800, 5700], 2).reason, 'CLOCK_SEQUENCE_TOO_LONG');
  const invalid = alignLichessClockStates({
    moveCount: 2,
    rawClockPresence: 'INVALID',
    rawClockStates: [],
    provider: 'LICHESS',
  });
  assert.equal(invalid.reason, 'CLOCK_SAMPLE_INVALID');
  const absent = alignLichessClockStates({
    moveCount: 2,
    rawClockPresence: 'ABSENT',
    rawClockStates: [],
    provider: 'LICHESS',
  });
  assert.equal(absent.reason, 'CLOCKS_ABSENT');
});

test('first move for each color keeps post-move source clock but no invented think time', () => {
  const result = derivePlyTiming({
    moveCount: 4,
    variant: 'standard',
    speedCategory: 'blitz',
    status: 'resign',
    incrementSeconds: 0,
  }, align([5900, 5900, 5800, 5700], 4, { status: 'resign' }));

  assert.equal(result.rows[0].sourceClockAfterCentiseconds, 5900);
  assert.equal(result.rows[0].clockBeforeMoveCentiseconds, null);
  assert.equal(result.rows[0].clockDeltaMoveTimeCentiseconds, null);
  assert.equal(result.rows[0].unavailableReason, 'FIRST_MOVE_BEFORE_CLOCK_UNAVAILABLE');
  assert.equal(result.rows[1].unavailableReason, 'FIRST_MOVE_BEFORE_CLOCK_UNAVAILABLE');
  assert.equal(result.rows[2].clockDeltaMoveTimeCentiseconds, 100);
  assert.equal(result.rows[3].clockDeltaMoveTimeCentiseconds, 200);
  assert.equal(result.coverageStatus, 'COMPLETE');
});

test('uses configured increment for ordinary later moves including zero increment', () => {
  const withIncrement = derivePlyTiming({
    moveCount: 4,
    variant: 'standard',
    speedCategory: 'rapid',
    status: 'resign',
    incrementSeconds: 2,
  }, align([5900, 5900, 6000, 6000], 4, { status: 'resign' }));
  assert.equal(withIncrement.rows[2].effectiveIncrementCentiseconds, 200);
  assert.equal(withIncrement.rows[2].clockDeltaMoveTimeCentiseconds, 100);
  assert.equal(withIncrement.rows[2].incrementProvenance, 'GAME_CONTROL');

  const zeroIncrement = derivePlyTiming({
    moveCount: 3,
    variant: 'standard',
    speedCategory: 'bullet',
    status: 'resign',
    incrementSeconds: 0,
  }, align([5900, 5900, 5800], 3, { status: 'resign' }));
  assert.equal(zeroIncrement.rows[2].effectiveIncrementCentiseconds, 0);
  assert.equal(zeroIncrement.rows[2].clockDeltaMoveTimeCentiseconds, 100);
});

test('does not add increment when the final move directly ends the game', () => {
  const result = derivePlyTiming({
    moveCount: 3,
    variant: 'standard',
    speedCategory: 'blitz',
    status: 'mate',
    incrementSeconds: 2,
  }, align([5900, 5900, 5700], 3, { status: 'mate' }));

  assert.equal(result.rows[2].effectiveIncrementCentiseconds, 0);
  assert.equal(result.rows[2].clockDeltaMoveTimeCentiseconds, 200);
  assert.equal(result.rows[2].incrementProvenance, 'FINAL_MOVE_NO_INCREMENT');
});

test('uses alignment cardinality to distinguish direct autodraw from asynchronous draw', () => {
  const directAlignment = align([5900, 5900, 5700], 3, { status: 'draw' });
  assert.equal(directAlignment.terminal, undefined);
  const direct = derivePlyTiming({
    moveCount: 3,
    variant: 'standard',
    speedCategory: 'blitz',
    status: 'draw',
    incrementSeconds: 2,
  }, directAlignment);
  assert.equal(direct.rows[2].effectiveIncrementCentiseconds, 0);
  assert.equal(direct.rows[2].clockDeltaMoveTimeCentiseconds, 200);
  assert.equal(direct.rows[2].incrementProvenance, 'FINAL_MOVE_NO_INCREMENT');

  const asynchronousAlignment = align([5900, 5900, 5700, 5600], 3, {
    status: 'draw',
    terminalActiveColor: 'BLACK',
  });
  assert.equal(asynchronousAlignment.terminal?.valueCentiseconds, 5600);
  const asynchronous = derivePlyTiming({
    moveCount: 3,
    variant: 'standard',
    speedCategory: 'blitz',
    status: 'draw',
    incrementSeconds: 2,
  }, asynchronousAlignment);
  assert.equal(asynchronous.rows[2].effectiveIncrementCentiseconds, 200);
  assert.equal(asynchronous.rows[2].clockDeltaMoveTimeCentiseconds, 400);
  assert.equal(asynchronous.rows[2].incrementProvenance, 'GAME_CONTROL');
});

test('negative clock arithmetic is inconsistent rather than clamped', () => {
  const result = derivePlyTiming({
    moveCount: 3,
    variant: 'standard',
    speedCategory: 'blitz',
    status: 'resign',
    incrementSeconds: 2,
  }, align([5900, 5900, 6200], 3, { status: 'resign' }));

  assert.equal(result.rows[2].derivationStatus, 'INCONSISTENT');
  assert.equal(result.rows[2].clockDeltaMoveTimeCentiseconds, null);
  assert.equal(result.rows[2].unavailableReason, 'NEGATIVE_CLOCK_DELTA');
  assert.ok(result.rows[2].reliabilityFlags.includes('POSSIBLE_EXTERNAL_CLOCK_ADJUSTMENT'));
});

test('unsupported game semantics retain source clock but suppress timing arithmetic', () => {
  const result = derivePlyTiming({
    moveCount: 3,
    variant: 'standard',
    speedCategory: 'correspondence',
    status: 'resign',
    incrementSeconds: 0,
  }, align([5900, 5900, 5800], 3, { status: 'resign' }));

  assert.equal(result.rows[2].sourceClockAfterCentiseconds, 5800);
  assert.equal(result.rows[2].derivationStatus, 'UNSUPPORTED');
  assert.equal(result.rows[2].unavailableReason, 'UNSUPPORTED_CLOCK_SEMANTICS');
});
