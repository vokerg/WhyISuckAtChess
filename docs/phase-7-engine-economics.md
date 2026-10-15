# Phase 7 engine economics: measured evidence and remaining gates (#126)

**Status:** **Partial benchmark instrumentation, not an economics sign-off.**
The first deliverable is a reproducible native Stockfish wall-clock **microbaseline**.
This document does **not** claim representative per-game cost, position-cache hit rate,
application worker throughput, representative child process CPU/RSS, or pilot capacity.
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
`phase-7-native-timing-microbaseline-v1`. It records per-search wall time,
nearest-rank p50/p90/p95, mean/min/max, engine name/version, binary SHA-256,
runtime, CPU model/logical core count, host-reported RAM, FEN sample definitions,
settings and settings hash. Timings are from the Node host monotonic clock
around the awaited real UCI search; process setup/teardown is reported as a
separate total session wall clock. No cloud price assumptions or computed
throughput denominators are inserted.

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
Its logs contain the measured JSON; do not extrapolate across runner/CPU/binary
differences without matching recorded provenance.

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
| Cold and warm persisted position cache | **Not yet measured** | Requires real DB-backed repeated position workloads |
| Imported game/position/ply throughput | **Not yet measured** | Existing small pipeline CI durations are acceptance-test times, not representative costs |
| CPU and peak RSS per engine/worker | **Partial, opt-in Linux native child sampling** during the single-game persisted-cache probe; no representative distribution or worker/DB process accounting | Real `/proc` child counters are distinct from host inventory; small depth-6 samples cannot bound production depth-16 or workload costs |
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
economics**). On Linux, the v2 JSON report additionally captures the **real
Stockfish child process's** cumulative user/system CPU ticks converted to
milliseconds using the host's `getconf CLK_TCK`, plus its kernel-reported
`VmHWM` peak resident bytes from `/proc/<pid>/status`. Sampling happens
before the native process closes on **each** cold/warm worker cycle, including
startup overhead on a cache hit. It does not measure Node worker or PostgreSQL
process CPU/RSS. CPU-time resolution is limited by kernel ticks and results
may show zero CPU time for very short work; values are **not** per-position
measurements. Non-Linux runs return null resources explicitly. The probe does not contact Lichess or run evidence/diagnosis.

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
node --test scripts/phase-7-worker-cache-policy.test.mjs scripts/phase-7-stockfish-process-metrics.test.mjs
```

The dedicated native workflow creates a separate disposable PostgreSQL 16
database for this probe so prior integration tests cannot contaminate a cold
cache. Its JSON output schema is `phase-7-persisted-stockfish-cache-probe-v2`.
Inspect the **exact run/head** and its CPU/binary/environment before citing
actual measured values; merely landing the script or passing a unit test is
not a measurement. This narrow synthetic case cannot establish statistically
representative distributions, Node/DB CPU/RSS and representative child CPU/RSS, concurrency, queue saturation,
provider ingestion, evidence/diagnosis throughput, or cloud capacity/cost. In
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
