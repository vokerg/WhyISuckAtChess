// Phase 7 #126: deterministic, metadata-only workload composition audit.
// No provider fetch, engine analysis, DB access, or user identifiers.
// A composition report is NOT a benchmark measurement or evidence of representativeness.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SPEEDS = Object.freeze(['bullet', 'blitz', 'rapid']);
const CLOCK_STATES = Object.freeze(['ABSENT', 'PARTIAL', 'COMPLETE', 'INVALID']);
const ORIGINS = Object.freeze(['ORIGINAL_SYNTHETIC', 'RIGHTS_CLEARED_RECORDED']);
const FIELDS = Object.freeze([
  'fixtureId', 'origin', 'speedCategory', 'initialSeconds', 'incrementSeconds',
  'plies', 'distinctPositions', 'clockCoverage', 'sourceClockSamples',
]);
const MAX_GAMES = 10_000;
const MAX_FILE_BYTES = 1_000_000;

function assertInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error('Invalid ' + label + ' in workload manifest.');
  }
}

function countDistribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const nearestRank = (fraction) => sorted[Math.ceil(sorted.length * fraction) - 1];
  return {
    count: sorted.length,
    min: sorted[0],
    p50: nearestRank(0.50),
    p90: nearestRank(0.90),
    p95: nearestRank(0.95),
    max: sorted[sorted.length - 1],
    percentileMethod: 'NEAREST_RANK',
  };
}

export function summarizeWorkloadManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
      || manifest.schemaVersion !== 'phase-7-workload-manifest-v1'
      || Object.keys(manifest).some((key) => !['schemaVersion', 'games'].includes(key))
      || !Array.isArray(manifest.games) || manifest.games.length < 1
      || manifest.games.length > MAX_GAMES) {
    throw new Error('Expected a bounded phase-7-workload-manifest-v1 games array.');
  }

  const seen = new Set();
  const groups = new Map();
  const clockCoverageCounts = Object.fromEntries(CLOCK_STATES.map((state) => [state, 0]));
  const originCounts = Object.fromEntries(ORIGINS.map((origin) => [origin, 0]));
  let totalPlies = 0;
  let summedGameDistinctPositions = 0;

  for (const game of manifest.games) {
    if (!game || typeof game !== 'object' || Array.isArray(game)
        || Object.keys(game).length !== FIELDS.length
        || Object.keys(game).some((key) => !FIELDS.includes(key))) {
      throw new Error('Workload game must contain exactly the permitted metadata fields.');
    }
    if (typeof game.fixtureId !== 'string'
        || !/^[a-z][a-z0-9_-]{0,63}$/.test(game.fixtureId)
        || seen.has(game.fixtureId)) {
      throw new Error('Workload fixture IDs must be unique, short, and nonidentifying.');
    }
    seen.add(game.fixtureId);
    if (!ORIGINS.includes(game.origin) || !SPEEDS.includes(game.speedCategory)
        || !CLOCK_STATES.includes(game.clockCoverage)) {
      throw new Error('Invalid workload origin, speed, or source-clock coverage.');
    }
    assertInteger(game.initialSeconds, 1, 86_400, 'initial time');
    assertInteger(game.incrementSeconds, 0, 600, 'time increment');
    assertInteger(game.plies, 1, 1_000, 'ply count');
    assertInteger(game.distinctPositions, 1, game.plies + 1, 'game distinct positions');
    assertInteger(game.sourceClockSamples, 0, game.plies, 'source clock sample count');
    // Lichess speed pools use initial + 40 * increment (estimated 40-move game).
    // Do not let an author-declared pool contradict the exact clock settings.
    const estimatedSeconds = game.initialSeconds + 40 * game.incrementSeconds;
    const clockSpeed = estimatedSeconds < 30 ? 'ultraBullet'
      : estimatedSeconds < 180 ? 'bullet'
      : estimatedSeconds < 480 ? 'blitz'
      : estimatedSeconds < 1500 ? 'rapid' : 'classical';
    if (clockSpeed !== game.speedCategory) {
      throw new Error('Workload speed category contradicts the exact time control.');
    }
    if ((game.clockCoverage === 'ABSENT' && game.sourceClockSamples !== 0)
        || (game.clockCoverage === 'COMPLETE' && game.sourceClockSamples !== game.plies)
        || (game.clockCoverage === 'PARTIAL'
          && (game.sourceClockSamples === 0 || game.sourceClockSamples === game.plies))) {
      throw new Error('Clock coverage contradicts the source clock sample count.');
    }
    // INVALID means some source values cannot be treated as aligned clock samples.
    // Never infer missing clocks or downgrade INVALID to PARTIAL.
    clockCoverageCounts[game.clockCoverage] += 1;
    originCounts[game.origin] += 1;
    totalPlies += game.plies;
    summedGameDistinctPositions += game.distinctPositions;

    const exactTimeControl = game.initialSeconds + '+' + game.incrementSeconds;
    const key = [game.speedCategory, exactTimeControl, game.clockCoverage].join('|');
    let group = groups.get(key);
    if (!group) {
      group = {
        speedCategory: game.speedCategory,
        exactTimeControl,
        clockCoverage: game.clockCoverage,
        gamePlies: [],
        gameDistinctPositions: [],
        gamesWithSourceClockSamples: 0,
        sourceClockSamples: 0,
        origins: new Set(),
      };
      groups.set(key, group);
    }
    group.gamePlies.push(game.plies);
    group.gameDistinctPositions.push(game.distinctPositions);
    group.sourceClockSamples += game.sourceClockSamples;
    group.gamesWithSourceClockSamples += Number(game.sourceClockSamples > 0);
    group.origins.add(game.origin);
  }

  const strata = [...groups.values()].sort((a, b) => {
    const order = SPEEDS.indexOf(a.speedCategory) - SPEEDS.indexOf(b.speedCategory);
    if (order) return order;
    const [ai, ax] = a.exactTimeControl.split('+').map(Number);
    const [bi, bx] = b.exactTimeControl.split('+').map(Number);
    return ai - bi || ax - bx || CLOCK_STATES.indexOf(a.clockCoverage) - CLOCK_STATES.indexOf(b.clockCoverage);
  }).map((group) => ({
    speedCategory: group.speedCategory,
    exactTimeControl: group.exactTimeControl,
    clockCoverage: group.clockCoverage,
    games: group.gamePlies.length,
    plyCount: countDistribution(group.gamePlies),
    gameDistinctPositionCount: countDistribution(group.gameDistinctPositions),
    // Per-game distinct counts cannot be added to obtain corpus-global unique positions.
    summedGameDistinctPositions: group.gameDistinctPositions.reduce((sum, n) => sum + n, 0),
    gamesWithSourceClockSamples: group.gamesWithSourceClockSamples,
    sourceClockSamples: group.sourceClockSamples,
    origins: [...group.origins].sort(),
  }));

  return {
    schemaVersion: 'phase-7-workload-composition-v1',
    measurementKind: 'METADATA_ONLY_WORKLOAD_COMPOSITION',
    metadataOnly: true,
    games: manifest.games.length,
    totalPlies,
    summedGameDistinctPositions,
    clockCoverageCounts,
    originCounts,
    strata,
    notMeasured: [
      'real Stockfish search times, CPU, RSS, and persisted position cache behavior',
      'global unique positions across games or actual game imports',
      'worker/DB throughput, concurrency, retries, or cancellation',
      'population representativeness, cloud capacity, or per-game pricing',
    ],
  };
}

export async function reportWorkloadManifestFile(path) {
  const size = (await stat(path)).size;
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES) {
    throw new Error('Workload manifest exceeds the bounded file size.');
  }
  const raw = await readFile(path);
  if (raw.byteLength > MAX_FILE_BYTES) {
    throw new Error('Workload manifest exceeds the bounded file size.');
  }
  const manifest = JSON.parse(raw.toString('utf8'));
  const summary = summarizeWorkloadManifest(manifest);
  return {
    ...summary,
    input: { sha256: createHash('sha256').update(raw).digest('hex'), bytes: raw.byteLength },
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) {
    process.stderr.write('Usage: node scripts/phase-7-workload-manifest.mjs <local-metadata-only-json>\n');
    process.exitCode = 1;
  } else {
    reportWorkloadManifestFile(process.argv[2]).then(
      (report) => { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); },
      () => {
        // Do not echo file contents, paths, or metadata on validation failure.
        process.stderr.write('Phase 7 workload manifest rejected.\n');
        process.exitCode = 1;
      },
    );
  }
}
