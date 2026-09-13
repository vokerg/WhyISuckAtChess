import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectTacticalMotifs,
  detectTacticalMotifsCreatedByMove,
} from '../dist/index.js';

function find(result, type) {
  return result.find((motif) => motif.type === type);
}

test('detects a fork once per attacker with all attacked targets', () => {
  const motifs = detectTacticalMotifs(
    '4k3/3q1r2/8/4N3/8/8/8/4K3 w - -',
    'WHITE',
  );
  const fork = find(motifs, 'FORK');
  assert.ok(fork);
  assert.equal(fork.attackerSquare, 'e5');
  assert.deepEqual(
    fork.targets.map((target) => target.square),
    ['d7', 'f7'],
  );

  const pseudo = detectTacticalMotifs(
    '4k3/3q4/8/4N3/8/8/8/4K3 w - -',
    'WHITE',
  );
  assert.equal(find(pseudo, 'FORK'), undefined);
});

test('detects an absolute pin and rejects a non-king line target', () => {
  const pin = find(detectTacticalMotifs(
    '4k3/8/2n5/1B6/8/8/8/4K3 w - -',
    'WHITE',
  ), 'PIN');
  assert.ok(pin);
  assert.equal(pin.attackerSquare, 'b5');
  assert.deepEqual(pin.targets.map((target) => target.square), ['c6', 'e8']);

  const pseudo = detectTacticalMotifs(
    '6k1/8/2n5/1B6/8/8/8/4K3 w - -',
    'WHITE',
  );
  assert.equal(find(pseudo, 'PIN'), undefined);
});

test('detects a skewer only when the front target is more valuable', () => {
  const skewer = find(detectTacticalMotifs(
    '8/8/8/8/R2k1q2/8/8/7K b - -',
    'WHITE',
  ), 'SKEWER');
  assert.ok(skewer);
  assert.equal(skewer.attackerSquare, 'a4');
  assert.deepEqual(skewer.targets.map((target) => target.square), ['d4', 'f4']);

  const pseudo = detectTacticalMotifs(
    '4k3/8/8/8/R2r1q2/8/8/4K3 w - -',
    'WHITE',
  );
  assert.equal(find(pseudo, 'SKEWER'), undefined);
});

test('detects a discovered attack created by moving the blocker off the ray', () => {
  const created = detectTacticalMotifsCreatedByMove(
    'q3k3/8/8/8/N7/8/8/R3K3 w - -',
    'a4b6',
  );
  assert.ok(created);
  const discovered = find(created.motifs, 'DISCOVERED_ATTACK');
  assert.ok(discovered);
  assert.equal(discovered.attackerSquare, 'a1');
  assert.equal(discovered.targets[0].square, 'a8');
  assert.deepEqual(discovered.revealedBy, {
    from: 'a4',
    to: 'b6',
    piece: 'n',
  });

  const pseudo = detectTacticalMotifsCreatedByMove(
    'q3k3/8/8/8/Q7/8/8/R3K3 w - -',
    'a4a5',
  );
  assert.ok(pseudo);
  assert.equal(find(pseudo.motifs, 'DISCOVERED_ATTACK'), undefined);
});

test('reports static motifs newly created by a legal move without pairwise duplicates', () => {
  const created = detectTacticalMotifsCreatedByMove(
    '4k3/8/3q1r2/8/8/2N5/8/4K3 w - -',
    'c3e4',
  );
  assert.ok(created);
  const forks = created.motifs.filter((motif) => motif.type === 'FORK');
  assert.equal(forks.length, 1);
  assert.equal(forks[0].attackerSquare, 'e4');
  assert.deepEqual(
    forks[0].targets.map((target) => target.square),
    ['d6', 'f6'],
  );
});
