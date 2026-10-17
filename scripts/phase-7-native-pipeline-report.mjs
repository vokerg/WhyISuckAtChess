// Phase 7 #126: pure validation/reporting of optional native pipeline acceptance timings.
// Synthetic four-ply fixture test timings are NOT representative worker throughput.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { arch, cpus, platform, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { summarizeDurationMs } from './phase-7-benchmark-statistics.mjs';

const STAGES = Object.freeze(['import', 'indexing', 'analysis', 'evidence', 'diagnosis', 'replay']);
const FIELDS = Object.freeze([
  'fixtureKey', 'speedCategory', 'initialSeconds', 'incrementSeconds',
  'sourceClockCoverage', 'scenario', 'plies', 'positionsTotal',
  'cacheHits', 'cacheMisses', 'analysisAttempts', 'nativeEngineSpawns',
  'evidenceRuns', 'diagnosisPublicationStatus', 'diagnosisFindingCount',
  'clockAlignmentStatus', 'timingCoverageStatus',
  'harnessWallMs', 'stageCallWallMs',
]);
const MAX_BYTES = 64_000;
const SCENARIOS = ['STANDARD', 'SUPERSESSION', 'NATIVE_PROCESS_CRASH_RETRY', 'NATIVE_SEARCH_DEADLINE_RETRY'];

function nonnegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function integer(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function exactKeys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === allowed.length
    && Object.keys(value).every((key) => allowed.includes(key));
}
function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

export function summarizePipelineFixtureSamples(samples, expectedCount = 11) {
  if (!Array.isArray(samples) || !integer(expectedCount, 1, 50)
      || samples.length !== expectedCount) {
    throw new Error('Native pipeline fixture samples are incomplete or unbounded.');
  }
  const seen = new Set();
  const strata = new Map();
  const normalized = [];
  for (const sample of samples) {
    if (!exactKeys(sample, FIELDS)
        || typeof sample.fixtureKey !== 'string'
        || !/^[a-z][a-z0-9_-]{0,63}$/.test(sample.fixtureKey)
        || seen.has(sample.fixtureKey)
        || !['bullet', 'blitz', 'rapid'].includes(sample.speedCategory)
        || !integer(sample.initialSeconds, 0, 86_400)
        || !integer(sample.incrementSeconds, 0, 600)
        || !['ABSENT', 'PARTIAL', 'COMPLETE', 'INVALID'].includes(sample.sourceClockCoverage)
        || !SCENARIOS.includes(sample.scenario)
        || !integer(sample.plies, 1, 1000)
        || !integer(sample.positionsTotal, 1, sample.plies + 1)
        || !integer(sample.cacheHits, 0, sample.positionsTotal)
        || !integer(sample.cacheMisses, 1, sample.positionsTotal)
        || sample.cacheHits + sample.cacheMisses !== sample.positionsTotal
        || !integer(sample.analysisAttempts, 1, 5)
        || !integer(sample.nativeEngineSpawns, 1, 5)
        || !integer(sample.evidenceRuns, 1, 100)
        || sample.diagnosisPublicationStatus !== 'SUCCEEDED'
        || !integer(sample.diagnosisFindingCount, 0, 1000)
        || typeof sample.clockAlignmentStatus !== 'string'
        || !/^[A-Z_]{2,40}$/.test(sample.clockAlignmentStatus)
        || typeof sample.timingCoverageStatus !== 'string'
        || !/^[A-Z_]{2,40}$/.test(sample.timingCoverageStatus)
        || !nonnegative(sample.harnessWallMs)
        || !exactKeys(sample.stageCallWallMs, STAGES)) {
      throw new Error('Invalid synthetic native pipeline fixture sample.');
    }
    seen.add(sample.fixtureKey);
    const estimatedSeconds = sample.initialSeconds + 40 * sample.incrementSeconds;
    const expectedSpeed = estimatedSeconds < 30 ? 'ultraBullet'
      : estimatedSeconds < 180 ? 'bullet'
      : estimatedSeconds < 480 ? 'blitz'
      : estimatedSeconds < 1500 ? 'rapid' : 'classical';
    if (sample.speedCategory !== expectedSpeed) {
      throw new Error('Native pipeline fixture contradicts its exact time control.');
    }
    let allStageMs = 0;
    const stageTotals = {};
    for (const stage of STAGES) {
      const values = sample.stageCallWallMs[stage];
      if (!Array.isArray(values) || values.length < 1 || values.length > 100
          || values.some((value) => !nonnegative(value))) {
        throw new Error('Native pipeline stage has missing or invalid call timings.');
      }
      if (['import', 'indexing', 'diagnosis', 'replay'].includes(stage) && values.length !== 1) {
        throw new Error('Expected exactly one import, indexing, diagnosis and replay call per fixture.');
      }
      stageTotals[stage] = sum(values);
      allStageMs += stageTotals[stage];
    }
    if (sample.stageCallWallMs.analysis.length !== sample.nativeEngineSpawns
        || sample.stageCallWallMs.analysis.length < sample.analysisAttempts
        || (sample.scenario === 'STANDARD' && sample.nativeEngineSpawns !== 1)
        || (sample.scenario !== 'STANDARD' && sample.nativeEngineSpawns !== 2)
        || allStageMs > sample.harnessWallMs + 0.02) {
      throw new Error('Native fixture call counts or containing wall time disagree.');
    }
    const exactTimeControl = sample.initialSeconds + '+' + sample.incrementSeconds;
    const key = [sample.speedCategory, exactTimeControl, sample.sourceClockCoverage].join('|');
    const item = { ...sample, exactTimeControl, stageTotalWallMs: stageTotals };
    normalized.push(item);
    const group = strata.get(key) ?? [];
    group.push(item);
    strata.set(key, group);
  }

  const grouped = [...strata.entries()].map(([key, values]) => {
    const [speedCategory, exactTimeControl, sourceClockCoverage] = key.split('|');
    return {
      speedCategory, exactTimeControl, sourceClockCoverage, games: values.length,
      scenarios: [...new Set(values.map((item) => item.scenario))].sort(),
      harnessWallMs: summarizeDurationMs(values.map((item) => item.harnessWallMs)),
      stages: Object.fromEntries(STAGES.map((stage) =>
        [stage, summarizeDurationMs(values.map((item) => item.stageTotalWallMs[stage]))])),
    };
  }).sort((a, b) => {
    const speeds = ['bullet', 'blitz', 'rapid'];
    return speeds.indexOf(a.speedCategory) - speeds.indexOf(b.speedCategory)
      || a.exactTimeControl.localeCompare(b.exactTimeControl)
      || a.sourceClockCoverage.localeCompare(b.sourceClockCoverage);
  });
  return {
    schemaVersion: 'phase-7-native-pipeline-fixture-timings-v2',
    measurementKind: 'INSTRUMENTED_NATIVE_ACCEPTANCE_TEST_SYNTHETIC_FOUR_PLY',
    games: normalized.length,
    sampleUnit: 'ONE_SYNTHETIC_TEST_FIXTURE_NOT_AN_INDEPENDENT_REAL_GAME',
    stageSemantics: 'SUM_OF_SUCCESSFUL_RUNONCE_CALL_WALL_TIMES;DIAGNOSIS_OWNER_SCOPED_PUBLICATION;REPLAY_QUERY_AND_PARSE',
    samples: normalized, strata: grouped,
    notMeasured: [
      'production Lichess HTTP import, diagnosis on representative histories or end-user HTTP latency',
      'representative real-game lengths, player clock coverage, or production depth-16/MultiPV-3',
      'isolated worker/PostgreSQL process CPU and peak RSS, database query counts/latencies',
      'concurrent throughput, backlog saturation, natural recovery delay or cancellation cost',
      'population quantiles, per-1000-game capacity, cloud cost or pilot readiness',
    ],
  };
}

export async function reportNativePipelineFixtureFile(path) {
  const info = await stat(path);
  if (!integer(info.size, 1, MAX_BYTES)) throw new Error('Pipeline fixture sample file is missing or oversized.');
  const raw = await readFile(path);
  if (raw.byteLength !== info.size || raw.byteLength > MAX_BYTES) {
    throw new Error('Pipeline fixture sample size changed or exceeded its bound.');
  }
  const lines = raw.toString('utf8').trimEnd().split('\n');
  const samples = lines.map((line) => JSON.parse(line));
  const summary = summarizePipelineFixtureSamples(samples);
  return {
    ...summary,
    environment: {
      platform: platform(), architecture: arch(), nodeVersion: process.version,
      logicalCpuCount: cpus().length, cpuModel: cpus()[0]?.model ?? null,
      hostReportedRamBytes: totalmem(),
      engineConfiguration: { depth: 6, multiPv: 1, threads: 1, hashMb: 16 },
      stockfishBinarySha256: process.env.STOCKFISH_PATH
        ? createHash('sha256').update(await readFile(process.env.STOCKFISH_PATH)).digest('hex')
        : null,
    },
    input: { bytes: raw.byteLength, sha256: createHash('sha256').update(raw).digest('hex') },
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) {
    process.stderr.write('Usage: node scripts/phase-7-native-pipeline-report.mjs <bounded-local-NDJSON>\n');
    process.exitCode = 1;
  } else {
    reportNativePipelineFixtureFile(process.argv[2]).then(
      (report) => { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); },
      () => { process.stderr.write('Native pipeline fixture timing report rejected.\n'); process.exitCode = 1; },
    );
  }
}
