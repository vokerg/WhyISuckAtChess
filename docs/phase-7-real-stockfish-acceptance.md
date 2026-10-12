# Phase 7: bounded real-Stockfish integration gate (#123)

**Status: real-binary gate #132, durable native crash/retry extension #133, adapter timeout hardening #134, Phase 6 diagnosis publication #139, clock-integrity gate #140, and source-supersession PR #141 merged; Phase 7 #123 not yet accepted.** This remains a distinct real-binary gate. The tampered-clock and pinned-package checks have successful native CI evidence below. The in-flight source-supersession regression passed native CI (recorded below); independent review and remaining worker/resource gates are still required.

## Reference / Why delta

- **Reference:** CRT `apps/api/src/modules/analysis/local-stockfish-engine.service.ts`, `stockfish-engine.factory.ts` and `apps/api/test/analysis/local-stockfish-engine.test.mjs` (inspected), plus Why's existing `stockfish.adapter.ts`, `engine-analysis.service.ts` and `pipeline-acceptance.test.mjs`.
- **Preserve:** native UCI subprocess, bounded single-thread search, worker-owned closing, cache/provenance and persisted source/claim fencing.
- **Change:** the same disposable-database/import/index/evidence/replay fixture runs real binary searches across standard bullet, blitz and rapid with source clock coverage; no engine output is fabricated.
- **Omit:** unbounded historical search, production provider credentials, new taxonomy/AI, claims that independent tests constitute diagnosis publication.
- **Future seam:** opt-in gate and explicitly measured engine settings can be reused by #126 economics benchmarking.

## How to run

Requires Node 22, npm 10+, PostgreSQL 16 with a **disposable** database and a native Stockfish binary. GitHub's [dedicated workflow](../.github/workflows/real-stockfish-acceptance.yml) uses `ubuntu-24.04`, installs **`stockfish=16-1build1`** on `ubuntu-24.04` (fails if unavailable), records the installed package, UCI name, executable SHA-256 digest and runner CPU model/architecture in its logs, and points to `/usr/games/stockfish`. This pins the distribution package version, **not** a portable binary checksum across architectures or an archived executable; preserve the logged digest/CPU for any comparison with #126 benchmarks.

```bash
npm ci
export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/why_chess_real_engine_ci'
export STOCKFISH_PATH='/usr/games/stockfish'
npm run db:validate
npm run db:migrate
npm run build:api
RUN_REAL_STOCKFISH_ACCEPTANCE=1 timeout 360s node --test apps/api/test/pipeline-acceptance.test.mjs
```

`npm test` **does not start a native engine**. Without `RUN_REAL_STOCKFISH_ACCEPTANCE=1` the fixture continues using the old deterministic engine double. The separate workflow is manually dispatchable and also runs for pull requests touching the engine adapter, its pipeline fixture or the gate itself. It has a 20-minute job limit, an overall 360-second fixture limit and a 15-second UCI command timeout.

## Fixture and checks

The provider side is **recorded synthetic NDJSON** (in-memory `fetchImpl`), not live Lichess; authentication and claiming are fixture-controlled. Each game contains four legal plies (`e4 e5 Nf3 Nc6`) with retained source clocks and exact control:

| Control | Initial + increment | Raw post-ply clock centiseconds | Engine |
| --- | --- | --- | --- |
| Bullet | 30+0 | 2950, 2950, 2900, 2900 | native depth 6, MultiPV 1 |
| Blitz | 180+2 | 18150, 18100, 18100, 18000 | native depth 6, MultiPV 1 |
| Rapid | 600+5 | 60400, 60350, 60200, 60200 | native depth 6, MultiPV 1 |

The real-engine gate also runs five deliberately untrusted clock sequences under the 180+2 blitz control: **no `clocks` field (ABSENT)**, **two clocks for four plies (UNALIGNED)**, **six clocks for four plies (ANOMALOUS)**, **one negative provider clock value (INVALID)** and **four integer clocks with an impossible elapsed-time delta (COMPLETE clock alignment but PARTIAL timing coverage)**. The invalid sample is not aligned, although the three valid raw values remain stored; the impossible-but-integer sample is retained at its actual ply with `INCONSISTENT` timing, a null derived duration and an explicit `NEGATIVE_CLOCK_DELTA` reason. All five retain authoritative engine results. Missing or malformed clock sequences yield no attributed per-ply clock, while the complete-but-inconsistent sequence retains the actual source clock without inventing elapsed time. These cases test the same persisted import/index/analysis/evidence/owned-replay path, not a standalone timing calculation.

All eleven DB-backed games use 1 thread and 16 MiB hash, with <=15 seconds per UCI command except the controlled native deadline/retry case (2-second UCI command limit). Database game/import/run rows have random owned identifiers and are removed in `finally`; the server's source clocks, index, coverage and evidence remain authoritative. The check uses real engine process creation and UCI handshake/search, asserts recorded `engineName`/`engineVersion`, cache misses and complete position/ply counts, checks persisted current detector runs and typed owned replay with correct game, control and ply positions. It invalidates the indexed projection afterward and verifies that the old evidence disappears rather than presenting it as current. Each native process must exit after the worker closes it.

A separate opt-in crash test force-terminates the spawned engine and asserts a pending search rejects without an invented result. An additional **DB-backed native crash/retry fixture** uses real imported four-ply 180+2 blitz source facts. During the first native search it sends SIGKILL to Stockfish, then asserts the durable `GameAnalysisRun` is `RETRY_WAIT` with one attempt, pending coverage, no finished positions/plies and an explicit subprocess error. Before retry, owned replay must not claim completed engine evidence or expose detector runs. The test advances the fixture's `runAfter` timestamp (it does **not** test real elapsed backoff), reclaims the **same immutable snapshot** with a new native process, and verifies two attempts, complete analysis, detector publication and owned replay. Native process shutdown is checked after completion. This tests service-level persistence and retry, **not abrupt termination/restart of the Node worker process**. Mock-based unit tests in `apps/api/test/engine-analysis.test.mjs` cover initialization/search timeouts and bounded retry behavior. The adapter now attempts immediate subprocess termination on failed or timed-out position searches, rejects any subsequent search on that engine instance, and treats a later `close()` as idempotent. The regression injects late UCI info/bestmove lines after the timeout and checks that no new search can consume them. **The late-output injection is double-backed, not native**; the independent SIGSTOP-controlled native deadline fixture below tests actual subprocess timeout and recovery. Production workers must create a fresh Stockfish instance for any retry.

A **native in-flight source-supersession** case (native CI passed, see below) imports a clock-complete 180+2 blitz game, starts a real Stockfish subprocess, and completes one real UCI position search. Before that result can be persisted, the test explicitly advances the game's indexed-source timestamp and requests replacement analysis while the original worker claim remains active. The database must mark the original run `SUPERSEDED`, reject its position/ply writes, and expose no completed engine evidence or detector runs through owned replay. A second native subprocess then processes the replacement snapshot to completion, after which the existing evidence/replay assertions must refer to the new run. The interleaving and timestamp advance are **fixture-controlled**; this is a database-backed service/claim-fencing regression, not a real parallel Node worker, provider reimport, or external worker restart. Its isolated interleaving passed native CI; do not extend that verdict to parallel Node worker claims.

A **native search-deadline/retry** case imports clock-complete 180+2 blitz source facts into disposable PostgreSQL, starts a real Stockfish process, and pauses it with an operating-system `SIGSTOP` before a pending search. The adapter's 2-second UCI deadline must abort the search and send `SIGTERM` immediately; the fixture resumes the process with `SIGCONT` to permit termination and verifies the old child exits. The durable run must be `RETRY_WAIT` with `PENDING` coverage, one attempt, zero completed positions/plies, and no current owned replay engine/evidence. After advancing only the test's backoff, the **same snapshot** is retried through a newly spawned native Stockfish process, with two attempts and current evidence/owned replay published only after success. This exercises actual operating-system process control and the adapter's real timeout path, but **not** a naturally CPU-hung Stockfish binary, external Node worker restart, or measured resource ceilings. The native deadline fixture was subsequently included in successful PR #139 native CI; the earlier 2026-10-11 result remains historical.

The tests assert structural/range/identity invariants rather than fixed centipawn values: native Stockfish can produce different legal PVs and evaluations across binary builds and CPU configurations.

## Executed native integration evidence (2026-10-11)

**PASS — [native Stockfish GitHub Actions run 38144705642](https://github.com/vokerg/WhyISuckAtChess/actions/runs/38144705642), head `08ef1ee27f8cb7a5fe319995d0b3c4d881efdb08`.** The `real-stockfish-pipeline` job completed successfully against PostgreSQL 16 on Ubuntu 24.04 with distribution package `stockfish 16-1build1`, UCI identity `Stockfish 16`, Node 22 and the bounded depth-6 / MultiPV-1 / single-thread / 16 MiB settings. The log records **7 tests passed, 0 failed**: three clock-complete bullet/blitz/rapid cases, missing/short/excess Lichess clock sequences that remained explicitly unavailable, and a forced native subprocess termination. Reported Node test-run duration was about **5.58 seconds**; this is a small synthetic-fixture duration, not a throughput/economics estimate. These are fixture test durations, **not capacity/per-game operational economics**. The test and engine configuration are committed; the package is only identified, not checksum-pinned.

The standard CI/build/browser checks are tracked separately. The later [PR #139 native workflow run 38302296171](https://github.com/vokerg/WhyISuckAtChess/actions/runs/38302296171) passed nine opt-in native pipeline/retry/timeout tests for the earlier eight-game suite plus the standalone subprocess test. This predates the **two new clock-integrity fixtures and package pin**, whose CI result is recorded below. A native success is not itself Phase 7 #123 acceptance.

## New native regression evidence (2026-10-12, PR #140)

**PASS — [native run 38303608176](https://github.com/vokerg/WhyISuckAtChess/actions/runs/38303608176), commit `f990b720714ad0c42c3bdfaf3b05de507b2d41c9`.** The same disposable PostgreSQL 16 pipeline ran **10 DB-backed cases plus one standalone real subprocess-exit case: 11 passed, 0 failed**, including both new malformed/impossible source-clock cases, native SIGKILL recovery, and SIGSTOP deadline/retry. The dedicated job passed. These tests check actual engine results, current detector publication, typed owned replay, provenance invalidation, and process exit. They do not simulate full Node worker restarts.

Recorded environment: Ubuntu 24.04 x86_64, four reported CPUs, AMD EPYC 7763, Node 22, apt package `stockfish 16-1build1`, UCI `Stockfish 16`, binary SHA-256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`, depth 6, MultiPV 1, threads 1, 16 MiB hash. Node test-run duration was ~10.27 seconds, **not** a representative per-game analysis or operational capacity measurement. Standard build/lint/browser CI and independent review are separate gates.

## In-flight source-supersession regression (2026-10-12, PR #141)

**PASS — [native Stockfish/PostgreSQL run 38305664973](https://github.com/vokerg/WhyISuckAtChess/actions/runs/38305664973), tested head `f6ec46b737ed90ca11146bee515ab6cda7775bdf`.** The opt-in pipeline completed **11 DB-backed cases plus the standalone subprocess exit check: 12 passed, 0 failed**, including the new in-flight source revision case (test #9). The case passed in ~0.76 seconds; the full Node test-run duration was ~11.59 seconds, **not** a measured per-game capacity or throughput figure.

Environment recorded by the job: PostgreSQL 16; Ubuntu 24.04 x86_64; AMD EPYC 7763 (four reported CPUs); Node 22; native Stockfish 16 package `16-1build1`, SHA-256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`; depth 6, one thread, 16 MiB hash, MultiPV 1. The source-revision interleaving was fixture-controlled inside a single Node worker, not a genuine concurrent process or external restart. Standard CI and independent review remain separate gates.

## External Node worker termination and lease-recovery gate (PR follow-up to #141)

The opt-in `apps/api/test/native-worker-restart.test.mjs` fixture tests a **separate Node process boundary** on Linux, using disposable PostgreSQL and actual Stockfish 16 under the same depth-6, single-thread, 16 MiB configuration. It creates one minimal already-indexed blitz ply and a durable analysis run. A detached child Node process claims the run and completes one actual native UCI search, signals the parent via IPC, and remains suspended before the first result batch is persisted. The parent sends SIGKILL to **the child's whole Linux process group** (Node and native Stockfish), then confirms the run is still RUNNING with no completed positions/plies. It advances only the fixture's stale-lease cutoff, invokes production Prisma recovery, checks RETRY_WAIT and the old claim token's rejection, then runs a second independently instantiated native engine/service in the parent Node process. The **same snapshot and run ID** must complete on attempt 2 with current classified ply data, two position-cache rows, and explicit second-engine closure.

This is a true cross-process **termination/recovery** test, unlike the prior in-process native crash/deadline interleavings. It is **not** a live deployment-worker restart, concurrent competing claims from two running Node workers, live provider reimport, a real elapsed five-minute lease interval, downstream evidence/replay publication, or CPU/RSS resource-limit enforcement. Those gates are not waived. Run the dedicated workflow or use `RUN_REAL_STOCKFISH_ACCEPTANCE=1 node --test apps/api/test/native-worker-restart.test.mjs` after build/migration in a disposable DB. **PASS:** the new process-kill recovery fixture completed on native CI run 38307956033 (details below). This result does not establish the remaining concurrent-worker or resource-limit gates.

## External native worker termination/recovery CI evidence (2026-10-12, PR #142)

**PASS — [dedicated native run 38307956033](https://github.com/vokerg/WhyISuckAtChess/actions/runs/38307956033) on code/documentation head `6a952862ad634802f5de6cc1f36b12478eb57ed0`.** The earlier real import/index/evidence/replay suite passed **12/12**, then the **separate Node-process SIGKILL/lease-recovery test passed 1/1** against the same disposable PostgreSQL 16 service. The extra process-boundary test's Node runner duration was **~0.75 seconds** (not an operational per-game cost or worker-restart-time benchmark). The native job reports **success**. Standard build and browser CI are independent checks.

Native job environment: Ubuntu 24.04 Linux x86_64, AMD EPYC 7763, Node 22; apt `stockfish 16-1build1`, SHA-256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`; depth 6, 1 thread, 16 MiB hash. The lease expiry is fixture-accelerated and the second worker instance runs in the parent Node process; no CPU/RSS ceiling measurements are inferred from runner timing.

## Evidence / limits still needed before closing #123

- Missing, short, excessive and now negative/impossible-value clock sequences have DB-backed real-engine fixtures (the last two **passed in native run 38303608176**). The source-supersession fixture passed native CI in run 38305664973; actual parallel claims across Node processes and concurrent provider reimport remain untested; the dedicated external Node termination/lease-recovery regression passed native CI on PR #142.
- The merged native crash/retry extension adds database-backed `RETRY_WAIT` -> same-snapshot successful recovery, with the backoff advanced by the test. The adapter's late-UCI rejection regression remains **mock-only**; the native SIGSTOP-controlled deadline fixture exercises real process expiry, cleanup and durable retry in disposable PostgreSQL. Remaining: real concurrent source/analysis claims (beyond the fixture-controlled supersession regression), and **measured** memory/CPU resource observations rather than merely bounded engine settings and runner identity.
- Carry over stable fixtures into #126 cost measurements; these tiny four-ply cases are **not** representative throughput/economics benchmarks.
- This gate intentionally ends at owned replay/evidence. PR #139 separately connected ranked diagnosis publication; the native gate does **not** prove the full ranked diagnosis lifecycle with a real engine.

Do not treat this initial gate as satisfying the entire #123 exit checklist without independent review and the remaining negative cases.
