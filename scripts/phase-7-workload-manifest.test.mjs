import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { reportWorkloadManifestFile, summarizeWorkloadManifest } from './phase-7-workload-manifest.mjs';

const game = (fields = {}) => ({
  fixtureId: 'synthetic_1', origin: 'ORIGINAL_SYNTHETIC',
  speedCategory: 'bullet', initialSeconds: 30, incrementSeconds: 0,
  plies: 4, distinctPositions: 5, clockCoverage: 'COMPLETE', sourceClockSamples: 4,
  ...fields,
});
const manifest = (games) => ({ schemaVersion: 'phase-7-workload-manifest-v1', games });

test('exact controls, game lengths and source-clock arms stay separate', () => {
  const rows = [
    game(),
    game({ fixtureId: 'b2', plies: 8, distinctPositions: 8, sourceClockSamples: 8 }),
    game({ fixtureId: 'b3', initialSeconds: 60, incrementSeconds: 1, clockCoverage: 'ABSENT', sourceClockSamples: 0 }),
    game({ fixtureId: 'z1', speedCategory: 'blitz', initialSeconds: 180, incrementSeconds: 0, clockCoverage: 'PARTIAL', sourceClockSamples: 2 }),
    game({ fixtureId: 'r1', speedCategory: 'rapid', initialSeconds: 600, incrementSeconds: 5,
      origin: 'RIGHTS_CLEARED_RECORDED', clockCoverage: 'INVALID', sourceClockSamples: 3 }),
  ];
  const result = summarizeWorkloadManifest(manifest(rows));
  assert.equal(result.metadataOnly, true);
  assert.equal(result.games, 5);
  assert.equal(result.totalPlies, 24);
  assert.equal(result.strata.length, 4);
  assert.equal(result.strata[0].exactTimeControl, '30+0');
  assert.deepEqual(result.strata[0].plyCount, {
    count: 2, min: 4, p50: 4, p90: 8, p95: 8,
    max: 8, percentileMethod: 'NEAREST_RANK',
  });
  assert.equal(result.strata[0].summedGameDistinctPositions, 13);
  assert.equal(result.strata[1].exactTimeControl, '60+1');
  assert.equal(result.strata[1].clockCoverage, 'ABSENT');
  assert.equal(result.strata[2].exactTimeControl, '180+0');
  assert.equal(result.strata[3].exactTimeControl, '600+5');
  assert.equal(result.strata[3].clockCoverage, 'INVALID');
  assert.deepEqual(result.clockCoverageCounts, { ABSENT: 1, PARTIAL: 1, COMPLETE: 2, INVALID: 1 });
  assert.equal(result.originCounts.RIGHTS_CLEARED_RECORDED, 1);
  assert.equal(JSON.stringify(result).includes('synthetic_1'), false);
});

test('Lichess time-control classification enforces bullet/blitz/rapid boundaries', () => {
  const cases = [
    [0, 1, 'bullet'], [0, 5, 'blitz'], [30, 0, 'bullet'], [179, 0, 'bullet'], [180, 0, 'blitz'],
    [479, 0, 'blitz'], [480, 0, 'rapid'], [1499, 0, 'rapid'],
    [120, 2, 'blitz'], // 120 + 40*2 = 200, not bullet
  ];
  const rows = cases.map(([initialSeconds, incrementSeconds, speedCategory], index) =>
    game({ fixtureId: 'boundary_' + index, initialSeconds, incrementSeconds, speedCategory }));
  const result = summarizeWorkloadManifest(manifest(rows));
  assert.equal(result.games, cases.length);
  assert.equal(result.strata.length, cases.length);
  const invalid = [
    game({ speedCategory: 'bullet', initialSeconds: 180 }),
    game({ speedCategory: 'blitz', initialSeconds: 60 }),
    game({ speedCategory: 'rapid', initialSeconds: 180 }),
    game({ initialSeconds: 29 }), // ultraBullet pool is out of scope
    game({ speedCategory: 'rapid', initialSeconds: 1500 }), // classical is out of scope
    game({ initialSeconds: 120, incrementSeconds: 2 }), // 2+2 belongs to blitz
  ];
  for (const row of invalid) {
    assert.throws(() => summarizeWorkloadManifest(manifest([row])), /contradicts/);
  }
});

test('reject malformed, unsafe or potentially identifying manifests', () => {
  const invalid = [
    manifest([]), manifest(Array.from({ length: 10_001 }, (_, i) => game({ fixtureId: 'g' + i }))),
    { schemaVersion: 'invalid', games: [game()] },
    { ...manifest([game()]), credentials: 'secret' },
    manifest([game(), game()]),
    manifest([game({ fixtureId: 'a/name' })]),
    manifest([game({ username: 'player' })]),
    manifest([game({ speedCategory: 'classical' })]),
    manifest([game({ origin: 'PRODUCTION' })]),
    manifest([game({ initialSeconds: 0 })]),
    manifest([game({ initialSeconds: Infinity })]),
    manifest([game({ incrementSeconds: -1 })]),
    manifest([game({ plies: 3.5 })]),
    manifest([game({ plies: 0 })]),
    manifest([game({ distinctPositions: 6 })]),
    manifest([game({ clockCoverage: 'ABSENT', sourceClockSamples: 4 })]),
    manifest([game({ clockCoverage: 'COMPLETE', sourceClockSamples: 3 })]),
    manifest([game({ clockCoverage: 'PARTIAL', sourceClockSamples: 0 })]),
    manifest([game({ clockCoverage: 'PARTIAL', sourceClockSamples: 4 })]),
    manifest([game({ sourceClockSamples: 5 })]),
    manifest([game({ sourceClockSamples: NaN })]),
  ];
  for (const item of invalid) assert.throws(() => summarizeWorkloadManifest(item));
});

test('bounded file reporter returns hash but no raw manifest; CLI rejects input without dumping it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'phase7-cohort-'));
  try {
    const path = join(dir, 'manifest.json');
    const content = JSON.stringify(manifest([game()]));
    await writeFile(path, content);
    const report = await reportWorkloadManifestFile(path);
    assert.equal(report.input.bytes, Buffer.byteLength(content));
    assert.match(report.input.sha256, /^[a-f0-9]{64}$/);
    assert.equal(report.strata[0].games, 1);
    assert.equal(JSON.stringify(report).includes('synthetic_1'), false);
    const badPath = join(dir, 'bad.json');
    await writeFile(badPath, JSON.stringify(manifest([game({ username: 'PRIVATE_NAME' })])));
    const failed = spawnSync(process.execPath, ['scripts/phase-7-workload-manifest.mjs', badPath], {
      encoding: 'utf8',
    });
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout, '');
    assert.equal(failed.stderr.includes('PRIVATE_NAME'), false);
    await writeFile(badPath, 'x'.repeat(1_000_001));
    await assert.rejects(reportWorkloadManifestFile(badPath), /bounded file size/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
