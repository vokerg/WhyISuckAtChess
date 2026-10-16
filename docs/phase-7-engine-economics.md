# Phase 7 engine economics: measured evidence and remaining gates (#126)

**Status:** **Partial benchmark instrumentation, not an economics sign-off.**
The first deliverables are a reproducible native Stockfish timing microbaseline
and a real persisted-cache probe on one synthetic game. Linux-only, live-child
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
| Cold and warm persisted position cache | Real DB-backed 4-ply synthetic probe: 0/5 to 5/5 hits (see #156 and its exact-head native workflow) | **Partial**; only one game, not representative cross-game reuse |
| Imported game/position/ply throughput | **Not yet measured** | Existing small pipeline CI durations are acceptance-test times, not representative costs |
| Stockfish child CPU/peak RSS | One Linux live-child snapshot per synthetic engine session/pass, available only from new exact-head benchmark runs | **Partial**; not a representative per-game distribution, and not application worker CPU/RSS |
| Node benchmark parent CPU/RSS | `process.cpuUsage()` delta plus `process.memoryUsage.rss()` before/after each cache worker cycle | **Partial**; inclusive Node parent-process CPU, not an isolated worker, child engine, or PostgreSQL sample; RSS endpoints are **not peaks** |
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
against freshly migrated PostgreSQL. It then **requests reanalysis as a new
durable run** with identical indexed source, engine identity, analysis version,
settings hash, and actual cache rows. Without that new run, the normal
already-complete scheduling path would skip work, making a "warm" result invalid.

The cold run must report zero hits and all distinct positions as misses; the
warm run must report all hits and zero misses. Both durable runs must have
`SUCCEEDED/COMPLETE` coverage with all plies, one attempt, matching provenance,
and unchanged `StockfishPositionAnalysis` row count after the warm run.
The report includes wall-clock worker-cycle times **including engine startup**
and Postgres persistence, indexed PGN time, database-reported queue/claim times,
cache ratios, row counts, OS/engine identifiers, binary SHA-256 and database
size before/after (affected by physical allocation; **not per-game storage
economics**). Each cold/warm run independently samples the live Stockfish
child's cumulative CPU time and peak RSS before engine shutdown on Linux.
These readings exclude the Node process and PostgreSQL, and the two single-game
samples are not a useful CPU/RSS distribution. Persisted `createdAt`, `claimedAt`,
and `completedAt` timestamps must be valid, chronologically ordered, and yield
safe integer millisecond intervals; invalid timing is rejected instead of
silently being clamped to zero. These database timestamps are not monotonic
wall-clock timers and do not replace the separate measured worker-cycle wall
time. The v3 JSON also reports
`nodeHostResources` for each cold/warm `service.runOnce()` call. The resource
window uses `process.cpuUsage()` to obtain the **parent benchmark Node process's**
user/system CPU delta in milliseconds, and `process.memoryUsage.rss()` for
resident bytes at the start and end. These Node readings include parent
benchmark and database-client overhead but exclude native Stockfish child and
PostgreSQL server CPU/memory; the RSS change may be negative and is **not**
a cycle peak. No isolated application worker or per-position footprint is
established. The probe does not contact Lichess or run evidence/diagnosis.

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
node --test scripts/phase-7-worker-cache-policy.test.mjs scripts/phase-7-stockfish-child-resources.test.mjs scripts/phase-7-node-host-resources.test.mjs
```

The dedicated native workflow creates a separate disposable PostgreSQL 16
database for this probe so prior integration tests cannot contaminate a cold
cache. Its JSON output schema is `phase-7-persisted-stockfish-cache-probe-v3`.
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
not a measurement. This narrow synthetic case cannot establish statistically
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
