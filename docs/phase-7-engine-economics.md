# Phase 7 engine economics: measured evidence and remaining gates (#126)

**Status:** **Partial benchmark instrumentation, not an economics sign-off.**
The first deliverables are a reproducible native Stockfish timing microbaseline
and a real persisted-cache probe on two short synthetic games with partially shared positions. Linux-only, live-child
CPU and peak RSS snapshots supplement their wall-clock timings; none of these
are representative per-game cost, application worker throughput, or pilot capacity.
See [real-Stockfish acceptance](phase-7-real-stockfish-acceptance.md) for the
separate already-tested disposable-PostgreSQL provenance and recovery gate.

## 1. Controlled microbaseline

The opt-in command runs five original synthetic opening FENs (the starting position
through 1.e4 e5 2.Nf3 Nc6) with the **production native UCI adapter**, not an
engine double. It uses a single engine process, depth 6 (configurable 4–10),
MultiPV 1, one thread, 16 MiB hash, and 15-second per-UCI-command deadline.
Three sequential passes (configurable 1–8) provide 15 search-duration samples
by default. The first pass is reported separately from subsequent searches.
The production adapter sends `ucinewgame` before **each** analysis, so no
controlled transposition-hash reuse is being measured; any timing differences
may reflect host or process warm-up. This is **not** an experiment on Why's
persisted position cache.

The report is machine-readable JSON, schema
`phase-7-native-timing-microbaseline-v2`. It records per-search wall time,
nearest-rank p50/p90/p95, mean/min/max, engine name/version, binary SHA-256,
runtime, CPU model/logical core count, host-reported RAM, FEN sample definitions,
settings and settings hash. Timings are from the Node host monotonic clock
around the awaited real UCI search; process setup/teardown is reported as a
separate total session wall clock. On Linux the new
`results.nativeChildResources` also captures the *live native Stockfish child*
cumulative user/system CPU ticks (converted using `getconf CLK_TCK`) and
`VmHWM` peak resident bytes **once before termination**. The CPU count is
coarse at host clock-tick resolution and describes the entire short synthetic
session, not individual positions or Node/DB worker resource usage; on other
platforms this field is `null`. A missing Linux sample fails the opt-in run.
No cloud price assumptions or computed throughput denominators are inserted.

Prerequisites: Node >=22.12, npm >=10, repository dependencies/build, and
an explicitly identified native Stockfish executable. **No Lichess account,
Neon, DB, credentials, network-provider requests, or production user games** are
used by this microbaseline.

```sh
npm ci
npm run build:api
export STOCKFISH_PATH=/usr/games/stockfish
export RUN_PHASE7_ENGINE_BENCHMARK=1
PHASE7_BENCH_DEPTH=6 PHASE7_BENCH_PASSES=3 \
  timeout 120s node scripts/phase-7-stockfish-timing-benchmark.mjs \
  > phase-7-native-timing.json
node --test scripts/phase-7-stockfish-timing-benchmark.test.mjs
```

The command requires an **absolute** `STOCKFISH_PATH` and an explicit opt-in.
Depth/passes and search timeouts are bounded so CI cannot silently run a
production-sized workload. The dedicated
[real-Stockfish workflow](../.github/workflows/real-stockfish-acceptance.yml)
now exercises this extra microbaseline after its existing native/DB gates,
on Ubuntu 24.04 with apt `stockfish=16-1build1` and PostgreSQL 16.
Its logs contain the measured JSON, and the dedicated workflow also uploads
both raw synthetic benchmark JSON reports as one GitHub Actions artifact; do not
extrapolate across runner/CPU/binary differences without matching recorded
provenance.

### First observed native CI sample (illustrative; not economics acceptance)

Dedicated [real-Stockfish workflow run #38708355101](https://github.com/vokerg/WhyISuckAtChess/actions/runs/38708355101)
passed against benchmark commit `a9c7d848f3e558c349696841a0ffc65a3549f2b3`.
Its recorded environment was Ubuntu 24.04 x64, 4 logical CPUs (AMD EPYC
9V74), Node 22.23.3, and Stockfish 16 apt package `16-1build1` (binary
SHA-256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`).
Engine configuration: depth 6, MultiPV 1, 1 thread, 16 MiB hash.

| Sample | Count | p50 wall ms | p95 wall ms | Mean wall ms |
| --- | ---: | ---: | ---: | ---: |
| First pass | 5 | 1.829 | 2.566 | — |
| Subsequent passes | 10 | 1.443 | 2.209 | — |
| All searches | 15 | 1.561 | 2.566 | 1.723 |

The engine process session (including startup/teardown) took 136.773 ms.
These are **one CI runner's five very short synthetic opening positions**
and nearest-rank descriptive quantiles, not an independent game sample or
an estimate of native Stockfish costs at production depth 16 / MultiPV 3.
Subsequent non-runtime corrections do not constitute a second measurement
run; preserve the original head reference when citing these timings.

### Evidence register

| Measurement | Evidence | Interpretation |
| --- | --- | --- |
| Native engine wall-time distribution for 5 synthetic positions | Opt-in JSON from the dedicated workflow; confirm exact run/head before citing values | **Microbaseline only**, not a game/worker distribution |
| Repeated in-process engine searches | First pass versus later passes in the same JSON | `ucinewgame` is sent per search; timing variation is **not** a measured engine-hash or DB-cache hit rate |
| Cold, warm, and cross-game persisted position cache | Real DB-backed four-ply synthetic probe: cold 0/5, warm 5/5 hits (see #156); v4 additionally tests partial reuse from a second divergent synthetic opening | **Partial**; two fixed 4-ply games cannot establish representative cross-game reuse |
| Imported game/position/ply throughput | **Not yet measured** | Existing small pipeline CI durations are acceptance-test times, not representative costs |
| Stockfish child CPU/peak RSS | One Linux live-child snapshot per synthetic engine session/pass, available only from new exact-head benchmark runs | **Partial**; not a representative per-game distribution, and not application worker CPU/RSS |
| Node benchmark parent CPU/RSS | `process.cpuUsage()` delta plus `process.memoryUsage.rss()` before/after each cache worker cycle | **Partial**; inclusive Node parent-process CPU, not an isolated worker, child engine, or PostgreSQL sample; RSS endpoints are **not peaks** |
| Per-cache-cycle native engine phase wall time | v5 instruments awaited Stockfish initialization, each `analyzeFen`, and shutdown within `service.runOnce()`; checks search count equals durable cache misses | **Partial**; isolates engine *await* windows from remaining worker wall time, but does not measure database-only time, per-query latencies or representative game cost |
| Concurrent workers, cancellation, backlog, recovery | **Not yet measured** | Crash tests establish bounded behavior, not performance under load |
| Cloud cost/capacity and uncertainty | **Not yet measured** | Requires operational CPU/DB/RAM observations and explicitly sourced rates |

Do not treat synthetic success or green CI as fulfillment of #126's
resource/cost acceptance criteria. Historical native acceptance runs and
their machine/binary details are linked in the real-engine gate document;
none currently constitute a statistically useful economics sample.

## 2. Bounded persisted-cache cold/warm probe (partial #126)

The opt-in `scripts/phase-7-worker-cache-benchmark.mjs` supplies a **different
measurement** from the five-FEN UCI-only microbaseline: it inserts one original
four-ply 180+0 blitz PGN, indexes it with the production ply-index service,
and processes it through the **real persisted Stockfish analysis service**
against freshly migrated PostgreSQL. After the cold/warm reanalysis of that
first game, it indexes a **second original synthetic four-ply game**, with
identical 180+0 metadata and initial `1. e4 e5` moves but a divergent
`2. d4 exd4` continuation. This checks true *cross-game* persistence rather
than only same-game rerun behavior. It then **requests reanalysis as a new
durable run** with identical indexed source, engine identity, analysis version,
settings hash, and actual cache rows. Without that new run, the normal
already-complete scheduling path would skip work, making a "warm" result invalid.

The cold run must report zero hits and all distinct positions as misses; the
warm run must report all hits and zero misses. The second game's analysis must
report both shared-position cache hits and new-position misses based on actual
indexed position IDs, preserve engine name/version/analysis settings, and grow
the persisted cache by **exactly the number of new positions**; all three
runs must complete on the same disposable database. If there are zero shared
positions or zero new positions, or the counters/row growth disagree, the
probe fails rather than claiming a cross-game reuse measurement. Both durable runs must have
`SUCCEEDED/COMPLETE` coverage with all plies, one attempt, matching provenance,
and unchanged `StockfishPositionAnalysis` row count after the warm run.
The report includes wall-clock worker-cycle times **including engine startup**
and Postgres persistence, indexed PGN time, database-reported queue/claim times,
cache ratios, row counts, OS/engine identifiers, binary SHA-256 and database
size before/after (affected by physical allocation; **not per-game storage
economics**). Each cold/warm/cross-game run independently samples the live Stockfish
child's cumulative CPU time and peak RSS before engine shutdown on Linux.
These readings exclude the Node process and PostgreSQL, and the two single-game
samples are not a useful CPU/RSS distribution. Persisted `createdAt`, `claimedAt`,
and `completedAt` timestamps must be valid, chronologically ordered, and yield
safe integer millisecond intervals; invalid timing is rejected instead of
silently being clamped to zero. These database timestamps are not monotonic
wall-clock timers and do not replace the separate measured worker-cycle wall
time. The v5 JSON also reports
`nodeHostResources` for each cold/warm/cross-game `service.runOnce()` call. It additionally records per-cycle `enginePhaseTimings`: time awaited for native UCI startup, each completed `analyzeFen` search, and shutdown, plus nearest-rank search-duration quantiles and raw duration samples. The measured native search count **must equal persisted cache misses**; an all-hit warm cycle has zero searches and a `null` search-duration distribution. `engineAwaitedWallMs` is their sum, and `otherWorkerWallMs` is the containing monotonic `runOnce()` wall duration minus these nested awaits. This residual also includes JavaScript work, scheduling, Prisma interaction, PostgreSQL operations and time waiting outside the measured engine calls, **not** a PostgreSQL-only or CPU-time measurement. Timings are rounded only for output and rejected if the underlying phase sums contradict the containing worker cycle. The resource
window uses `process.cpuUsage()` to obtain the **parent benchmark Node process's**
user/system CPU delta in milliseconds, and `process.memoryUsage.rss()` for
resident bytes at the start and end. These Node readings include parent
benchmark and database-client overhead but exclude native Stockfish child and
PostgreSQL server CPU/memory; the RSS change may be negative and is **not**
a cycle peak. No isolated application worker or per-position footprint is
established. The probe does not contact Lichess or run evidence/diagnosis, and its two tiny fixed games are not independent samples of a population.

**Safety requirements:** explicit `RUN_PHASE7_CACHE_BENCHMARK=1`; an absolute
`STOCKFISH_PATH`; a **local** dedicated DB whose name starts
`why_chess_cache_benchmark_ci`, `_test`, or `_local`; an empty database
after migrations; and an exclusive worker environment. The runner deletes
only its generated user and positions. It runs one fixed four-ply sample at
depth 6, MultiPV 1, one thread and 16 MiB hash, with 15-second UCI deadlines.
Never point this probe at Neon, a shared or production database, or personal
Lichess games.

```sh
# Create a separate, empty LOCAL database with the required benchmark name.
export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/why_chess_cache_benchmark_local'
npm run db:migrate
npm run build:api
export RUN_PHASE7_CACHE_BENCHMARK=1
export STOCKFISH_PATH=/usr/games/stockfish
timeout 120s node scripts/phase-7-worker-cache-benchmark.mjs > phase-7-cache-probe.json
node --test scripts/phase-7-worker-cache-policy.test.mjs scripts/phase-7-stockfish-child-resources.test.mjs scripts/phase-7-node-host-resources.test.mjs scripts/phase-7-cache-engine-phase-timings.test.mjs
```

The dedicated native workflow creates a separate disposable PostgreSQL 16
database for this probe so prior integration tests cannot contaminate a cold
cache. Its JSON output schema is `phase-7-persisted-stockfish-cache-probe-v5`, including
`fixture.crossGame`, `results.crossGame`, second-game indexing time, and the
post-cross-game row count. The workflow validates all three native-child and
Node-parent resource snapshots, nested Stockfish phase awaits and search-to-cache-miss counts, exact shared/new position counts and cache
row growth.
On successful validation it uploads `/tmp/phase7-native-timing.json` and
`/tmp/phase7-db-cache.json` together as an Actions artifact named
`phase7-native-benchmarks-<workflow-SHA>-<run-attempt>` with **30-day retention**.
Here `github.sha` identifies the tested workflow revision (the test merge commit
on pull-request runs, not necessarily the source branch's head SHA).
A preceding CI step requires both reports to be nonempty; a missing report
fails the job rather than uploading only one file. Download from the specific workflow
run's Artifacts section to inspect raw measurements and compare exact engine,
settings, host, and DB provenance. This is limited retention, not a permanent
research archive; save approved copies separately if longer-term comparison is
required. These are **synthetic** benchmark reports; they contain local binary
paths, disposable database names and host information, but no Lichess user data.
Archiving them does not make their one-game results representative.
Inspect the **exact run/head** and its CPU/binary/environment before citing
actual measured values; merely landing the script or passing a unit test is
not a measurement. This narrow two-game synthetic case cannot establish statistically
representative resource distributions, isolated application-worker peak RSS or
PostgreSQL process CPU/RSS, concurrency, queue saturation, provider ingestion,
evidence/diagnosis throughput, or cloud capacity/cost. In
particular, source clocks are absent, not silently reconstructed. Keep #126
and the Phase 7 #128 pilot gate open until representative empirical work.

### CRT reference / Why delta

**Reference:** CRT `apps/api/benchmarks/onboarding-throughput-safe.mjs`
uses an opt-in disposable-database guard, timed synthetic work and structured
results. **Preserve:** isolation, measured rather than inferred durations,
explicit provenance, and safe cleanup. **Change:** Why uses its own Lichess
indexing and durable, version-keyed native Stockfish position cache and
explicitly forces the second run to distinguish reuse from no-op scheduling.
**Omit:** CRT's Chess.com workflows, WASM engine and provider-loading stress.
**Future seam:** native pipeline benchmarks for representative strata,
process-resource instrumentation, concurrency and recovery.

## 3. Required full-pipeline measurement plan (not completed)

Run on disposable PostgreSQL 16 with the recorded native engine configuration
and a controlled CPU/memory environment. Only recorded, rights-cleared NDJSON
fixtures or synthetic user accounts may be used; no repeated live Lichess API
requests. Preserve source clock coverage independently from engine coverage.
Report distributions and denominator counts for each of bullet, blitz and rapid,
with distinct exact controls such as `180+0` and `180+2`.

For each stratum record: actual games, total plies, distinct legal positions,
positions eligible for engine analysis, new position-cache rows, cache hits and
misses (with definitions), supported evidence runs, diagnosis outputs, absent
and partial clock cases, and final run status. Instrument timestamps at import,
indexing, engine claim/start/complete, evidence and diagnosis publication.
Report end-to-end queue lag and total latency, not merely `node --test`
wall-clock duration. Distinguish cold disposable-cache run from a **same
settings/provenance** warm rerun and ensure re-analysis is not skipped due to
already-complete durable job status.

Collect operating-system process CPU time, peak RSS, worker concurrency,
DB query counts/latencies, database size delta and per-game storage growth.
Measure at least one controlled concurrency/saturation series, failed-engine
retry with observed recovery duration, and cancellation without marking
missing engine/evidence as complete. Use p50/p90/p95 and sample counts,
identify outliers and warm-up effects, and preserve raw JSON/CSV measurement
artifacts with environment/binary/settings hashes.

Only after those observations exist, derive explicit per-1k-games capacity
and budget scenarios with the measured numerator/denominator, uncertainty
and sourced unit prices. Production depth-16/MultiPV-3 defaults must not be
assumed cost-equivalent to the depth-6/MultiPV-1 acceptance fixture.

**Decision at this checkpoint:** no runtime/worker configuration change.
#126 remains open and Phase 7 #128 pilot-readiness remains gated on empirical
economics and independent domain/operational assessment.


## 4. Workload composition manifest (metadata only; partial #126)

Run the deterministic cohort *shape* audit against a local, bounded JSON manifest
before comparing any real-engine performance measurements. This accepts only
nonidentifying per-game metadata, **not** PGNs, FENs, player names, game IDs,
OAuth tokens, account identifiers, or provider URLs. It refuses extra fields,
duplicate fixture IDs, unsafe counts, contradictory absent/complete/partial
source-clock coverage, unapproved origins, and manifest files larger than 1 MB.
Only ORIGINAL_SYNTHETIC and RIGHTS_CLEARED_RECORDED metadata origins
are accepted; selecting the latter does **not** certify the underlying rights
or the representativeness of a dataset.

The output partitions game **counts and ply/within-game distinct-position
count distributions** by bullet/blitz/rapid, exact initial+increment
(e.g. 180+0 versus 180+2), and ABSENT/PARTIAL/COMPLETE/INVALID source-clock
coverage. Speed pools are checked against Lichess's estimated duration
`initialSeconds + 40 * incrementSeconds`: 30–179 seconds is bullet,
180–479 is blitz, and 480–1499 is rapid. UltraBullet and classical
controls are explicitly out of scope rather than silently mislabeled.
Zero initial time with positive increment (such as 0+1 bullet) is permitted
when the resulting estimated duration is in a supported speed pool; 0+0 is not.
It also preserves aggregate source-clock sample counts. Its
input.sha256 identifies the precise manifest bytes; no fixture IDs or
raw game metadata appear in the output. Summed per-game distinct positions
**cannot** be interpreted as unique positions across the whole corpus.
The pure command does not contact Lichess, the database, or Stockfish:

~~~sh
node --test scripts/phase-7-workload-manifest.test.mjs
node scripts/phase-7-workload-manifest.mjs \
  scripts/phase-7-workload-synthetic.json \
  > phase-7-workload-composition.json
~~~

The checked-in six-row example is **invented metadata for schema/stratification
testing**, not six recorded or engine-analyzed games; its four-ply lengths
are deliberately nonrepresentative. Source-clock coverage is declared by
the fixture author, never inferred. Use separately rights-cleared recorded
input and independently verified import/clock alignment for a future
real-game workload; do not upload private source data to Actions. Keep raw
real benchmark evidence, binary/settings and host provenance in separate,
versioned measurement artifacts. This composition report alone has **no
runtime, CPU, RAM, cache-hit, pipeline throughput, saturation, pricing,
or population-sampling data**, and changes none of the #126/#128 gates.


## 5. Opt-in native import-to-diagnosis/replay fixture stage timing (partial #126)

The dedicated native acceptance workflow now **retains bounded, structured stage
timings** from its existing **11 original synthetic four-ply fixtures** covering
bullet `30+0`, blitz `180+2`, and rapid `600+5`, including absent, short,
invalid and otherwise complete provider-clock samples. The fixtures also include
source supersession and injected real Stockfish process-crash/search-deadline
retries. They exercise the real import/indexing/engine/evidence/replay modules
with a **mocked Lichess NDJSON response** and a real local Stockfish subprocess;
they do **not** make external Lichess requests or sample real user workloads.

Instrumentation is behind `RUN_PHASE7_PIPELINE_BENCHMARK_REPORT=1` *and*
`RUN_REAL_STOCKFISH_ACCEPTANCE=1`. It records one opaque fixture key,
exact control, declared sample clock-coverage category, durable engine
cache counters, engine claim/spawn counts, evidence-run count, **completed diagnosis
publication status and finding count**, and
monotonic **wall time for each successful `runOnce()` call** in the import,
indexing, native engine, evidence and owner-scoped diagnosis publication stages.
The diagnosis stage calls the production durable `createDiagnosisWorkerService`
for the synthetic user after every current evidence run, requires a
`SUCCEEDED` materialization job and an `AVAILABLE`/`READY` summary, and times
its single `runOnce()` call. An empty finding set is a valid completed
publication, not evidence of model accuracy. The replay stage times
the read-model query plus schema parse. Failed/empty polling calls are excluded
from stage totals; injected failed engine claims that return true are retained.
The separate per-fixture `harnessWallMs` includes test assertions, direct
database assertions/queries and special-case retry/supersession orchestration,
so **it is not app-request latency or a queue throughput denominator**.
Stages can include Node scheduling, DB interaction and Stockfish time, and
must not be described as exclusive CPU or PostgreSQL times.

Raw `/tmp/phase7-pipeline-fixtures.ndjson` is processed by
`scripts/phase-7-native-pipeline-report.mjs`; the pure validator refuses
missing/duplicate fixtures, extra fields, invalid time-control pools,
cache-count disagreements, missing/nonfinite stage timings, inconsistent
native spawn/analysis call counts, or stage sums exceeding enclosing harness
wall time. It requires exactly 11 rows by default. The v2 summary groups by
speed, **exact control and clock-coverage category**, with per-group sample
counts and nearest-rank p50/p90/p95 of *fixture* wall durations and per-stage durations, including diagnosis;
the raw rows
are retained for inspection. Each single-game group with n=1 has degenerate
quantiles, not an estimated population distribution. The report also records
Node/OS/host CPU model and RAM, depth-6/MultiPV-1/one-thread/16-MiB engine
settings, native executable SHA-256 and input NDJSON SHA-256. Neither private
IDs, account/player names, PGNs, FENs nor provider payloads are emitted.

```sh
# With the same disposable PostgreSQL/Stockfish setup as the native acceptance
# workflow (do NOT run on Neon or an application database):
export RUN_REAL_STOCKFISH_ACCEPTANCE=1
export RUN_PHASE7_PIPELINE_BENCHMARK_REPORT=1
rm -f /tmp/phase7-pipeline-fixtures.ndjson
timeout 360s node --test apps/api/test/pipeline-acceptance.test.mjs
node --test scripts/phase-7-native-pipeline-report.test.mjs
node scripts/phase-7-native-pipeline-report.mjs \
  /tmp/phase7-pipeline-fixtures.ndjson > phase-7-pipeline-timings.json
```

The dedicated workflow fails if the full native test/validator does not pass,
requires both raw and summarized nonempty files, and uploads them with the
other synthetic native artifacts under the **tested workflow SHA/run attempt**,
subject to 30-day retention. No local native run or measured numerical result
is inferred merely from this instrumentation. Examine actual run artifacts
before reporting numbers.

**Unresolved:** all 11 cases share one tiny four-ply opening skeleton; they
are neither independent natural games nor rights-cleared sampled Lichess
histories. This work does not establish real provider-network ingestion,
representative diagnosis publication throughput, per-game CPU/RSS or PostgreSQL load, production
depth-16/MultiPV-3 economics, concurrency/saturation, natural retry backoff,
cancellation cost or per-1k-game capacity. The fully representative #126
economics gate and Phase 7 #128 pilot gate remain **OPEN**.

## 6. Recorded multi-game operational benchmark (#126)

The new `scripts/phase-7-multigame-benchmark.mjs` replaces the four-ply-only
measurement boundary with a reproducible, offline **18-game / 1,246-ply**
recorded workload. The checked-in [CC0 fixture and selection notes](../apps/api/benchmarks/fixtures/README.md)
cover bullet 60+0/60+1, blitz 180+0/180+2, and rapid 600+0/600+5, with one
20–40, 41–80 and 81–160-ply game per control. Selection is a chronological
archive-prefix quota, **not random sampling or a population estimate**. Original
moves/results/ratings/dates/clocks are retained with benchmark player identities.
The source archive's second-resolution clocks remain explicitly distinct from
native API centisecond precision. Complete source-clock coverage in this quota
sample is not an estimate of coverage in users' histories.

Reference: CRT `apps/api/benchmarks/onboarding-throughput-safe.mjs` and
`apps/api/src/prisma.ts`. Preserve the explicit disposable DB guard, finite
backlog, production service calls, measured resource windows and structured
artifacts. Change to recorded standard Lichess games, native UCI and the complete
Why evidence/diagnosis pipeline. Omit CRT Chess.com/WASM/repertoire behavior.
The fixture adapter, runner and pure report validator remain benchmark modules;
production engine/worker policy and database schema are unchanged.

### Reproduce

Use an empty migrated **local** PostgreSQL 16 database matching
`why_chess_cache_benchmark_{ci,test,local}[_suffix]`, UTC sessions, and an absolute
native `STOCKFISH_PATH`. The guard rejects remote/shared targets and URL options.
Do not point this at the application's configured database. The runner only
removes its generated user, cache rows and indexed positions. It blocks all
unexpected network fetches, bounds the dataset and concurrency, and kills its
native engines at a 30-minute hard deadline. A failed/incomplete run never emits
a completed report. All concurrent workers are drained before failure cleanup.

```sh
export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/why_chess_cache_benchmark_local_recorded'
export STOCKFISH_PATH=/absolute/path/to/stockfish
npm run db:migrate
npm run build:api
node --test scripts/phase-7-multigame-benchmark.test.mjs
export RUN_PHASE7_MULTIGAME_BENCHMARK=1
PHASE7_DEPTH=10 PHASE7_CONCURRENCY=1 PHASE7_GAMES=18 \
  PHASE7_REPORT_PATH=/tmp/recorded-c1.json \
  node scripts/phase-7-multigame-benchmark.mjs
node scripts/phase-7-multigame-report.mjs /tmp/recorded-c1.json \
  > /tmp/recorded-c1-summary.json
```

Repeat **sequentially** with concurrency 2 and 4 on an otherwise quiet host.
Each invocation starts with an empty application dataset/cache; the same local
DB may be reused after successful cleanup, but physical allocation/statistics
are cumulative and are reported before/after. `PHASE7_GAMES=6` selects the six
short games for a bounded production depth-16/MultiPV-3 comparison. Depth is
bounded to 6–16, MultiPV to 1 or 3, threads to 1, hash to 64 MiB, and each native
command to 30 seconds. Settings and executable SHA-256 accompany every report.

The [dedicated workflow](../.github/workflows/multigame-economics.yml) runs six
short recorded games at depth 6/concurrency 2 on PRs, with pinned Ubuntu
Stockfish `16-1build1` and PostgreSQL 16. Manual dispatch supports the same
bounded profiles. Both raw and validated reports are retained with the tested
workflow SHA/run attempt; a PR's small gate is not the full economics matrix.

### What the measurements mean

- Import uses an explicit PGN-to-NDJSON fixture adapter and the durable production
  importer, not a live HTTP export or invented source game. Indexing uses the
  production legal-ply/clock projection.
- Every engine pass pre-enqueues all games as a real bounded backlog. Cold
  starts with no position-analysis rows; opening positions can then be shared
  across games. Warm explicitly requests new durable analyses and requires
  zero searches/cache misses. A scheduling no-op cannot count as reuse.
- Workers retry lost optimistic claims while eligible queued work remains.
  Requested concurrency, observed peak simultaneous claims, participating
  workers and claim-race retries are separate fields. Per-game wall windows
  overlap; cohort wall time, rather than their sum, determines work rate.
- The six registered evidence detectors drain after the final current analyses.
  The owner-scoped diagnosis worker must publish an `AVAILABLE`/`READY` result.
  The pooled unrelated-player finding count validates lifecycle completion,
  **not** diagnosis quality for a person. Import/index/evidence/diagnosis walls
  are separate from engine-only capacity.
- Actual native SIGKILL after two successful searches exercises the production
  retry/backoff. A separate mid-search source supersession exercises claim
  fencing; the interrupted run must remain incomplete and its replacement must
  complete. An in-flight import cancellation must finish `CANCELLED` without
  adding games. These are injected scenarios, not natural failure frequencies,
  and each run has one sample of each scenario.
- Native CPU is measured for each live engine before close. Linux reports
  `/proc` CPU and `VmHWM`; macOS reports `ps` cumulative CPU and **close-time RSS,
  not peak RSS**. Parent Node CPU/RSS boundaries are measured separately. The
  resource sampler does not include PostgreSQL server CPU or RAM.
- PostgreSQL physical DB bytes and cumulative transaction/block/tuple counters
  are retained before/after. These asynchronously flushed counters are not
  per-query latency, per-game storage attribution, or exclusive DB CPU.
- Validated summaries expose nearest-rank per-control distributions with sample
  counts, measured wall/CPU hours per 1,000 games, and all raw denominators.
  Linear scaling of this quota sample is a planning scenario, not a tested
  sustained capacity promise. No cloud dollar rate is invented.

### Acceptance boundary

This supplies real variable-length recorded-game measurements, cache and
concurrency accounting, complete evidence/diagnosis publication and controlled
failure/cancellation observations. It does not automatically close #126 or
advance #128: production-setting long-game behavior, repeated recovery samples,
query-level/isolated PostgreSQL resources and a deployment-specific capacity
budget remain explicit review items. Keep the production depth-16/MultiPV-3 and
single-worker defaults unless measured evidence plus independent review justify
a separate runtime change.
