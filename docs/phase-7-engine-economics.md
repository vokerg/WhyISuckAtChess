# Phase 7 engine economics: measured evidence and remaining gates (#126)

**Status:** **Partial benchmark instrumentation, not an economics sign-off.**
The first deliverable is a reproducible native Stockfish wall-clock **microbaseline**.
This document does **not** claim representative per-game cost, position-cache hit rate,
application worker throughput, child process CPU/RSS, or pilot capacity.
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
| CPU and peak RSS per engine/worker | **Not yet measured** | Host CPU model/RAM inventory is **not** process resource usage |
| Concurrent workers, cancellation, backlog, recovery | **Not yet measured** | Crash tests establish bounded behavior, not performance under load |
| Cloud cost/capacity and uncertainty | **Not yet measured** | Requires operational CPU/DB/RAM observations and explicitly sourced rates |

Do not treat synthetic success or green CI as fulfillment of #126's
resource/cost acceptance criteria. Historical native acceptance runs and
their machine/binary details are linked in the real-engine gate document;
none currently constitute a statistically useful economics sample.

## 2. Required full-pipeline measurement plan (not completed)

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
