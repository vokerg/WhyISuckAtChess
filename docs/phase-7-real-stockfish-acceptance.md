# Phase 7: bounded real-Stockfish integration gate (#123)

**Status: implementation under review; Phase 7 #123 not yet accepted.** This is a distinct real-binary gate, not the Phase 6 ranked-diagnosis acceptance gate (#120/#129).

## Reference / Why delta

- **Reference:** CRT `apps/api/src/modules/analysis/local-stockfish-engine.service.ts`, `stockfish-engine.factory.ts` and `apps/api/test/analysis/local-stockfish-engine.test.mjs` (inspected), plus Why's existing `stockfish.adapter.ts`, `engine-analysis.service.ts` and `pipeline-acceptance.test.mjs`.
- **Preserve:** native UCI subprocess, bounded single-thread search, worker-owned closing, cache/provenance and persisted source/claim fencing.
- **Change:** the same disposable-database/import/index/evidence/replay fixture runs real binary searches across standard bullet, blitz and rapid with source clock coverage; no engine output is fabricated.
- **Omit:** unbounded historical search, production provider credentials, new taxonomy/AI, claims that independent tests constitute diagnosis publication.
- **Future seam:** opt-in gate and explicitly measured engine settings can be reused by #126 economics benchmarking.

## How to run

Requires Node 22, npm 10+, PostgreSQL 16 with a **disposable** database and a native Stockfish binary. GitHub's [dedicated workflow](../.github/workflows/real-stockfish-acceptance.yml) uses `ubuntu-24.04`, installs the distribution `stockfish` package, records the exact installed package/UCI name in its logs, and points to `/usr/games/stockfish`. The package is **identified at run time, not version-pinned**: a subsequent run can have a different version if distribution package indexes change. Before using this as a reproducibility/calibration baseline, pin or archive the binary/checksum and log CPU identity.

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

All three use 1 thread, 16 MiB hash and <=15 seconds per UCI command. Database game/import/run rows have random owned identifiers and are removed in `finally`; the server's source clocks, index, coverage and evidence remain authoritative. The check uses real engine process creation and UCI handshake/search, asserts recorded `engineName`/`engineVersion`, cache misses and complete position/ply counts, checks persisted current detector runs and typed owned replay with correct game, control and ply positions. It invalidates the indexed projection afterward and verifies that the old evidence disappears rather than presenting it as current. Each native process must exit after the worker closes it.

A separate opt-in crash test force-terminates the spawned engine and asserts a pending search rejects without an invented result. Mock-based unit tests in `apps/api/test/engine-analysis.test.mjs` still cover initialization/search timeouts and bounded retry behavior; **those are doubles, not real-process timeout or worker-crash/restart acceptance**.

The tests assert structural/range/identity invariants rather than fixed centipawn values: native Stockfish can produce different legal PVs and evaluations across binary builds and CPU configurations.

## Evidence / limits still needed before closing #123

- Link the exact successful native GitHub Actions run and record its package/UCI version, settings, run duration, and test result. This document does not claim any successful native execution before the CI run exists.
- Extend integration negatives for incomplete/missing/tampered clocks and superseded or concurrent source/analysis claims, distinguishing what is currently covered by independent double-backed tests.
- Verify native engine timeout/retry/recovery beyond the current forced crash and adapter unit doubles; record actual resource use/cleanup and any failed/partial database states.
- Carry over stable fixtures into #126 cost measurements; these tiny four-ply cases are **not** representative throughput/economics benchmarks.
- This gate ends at owned replay/evidence. It cannot publish a ranked diagnosis until #129 connects the production diagnosis lifecycle.

Do not treat this initial gate as satisfying the entire #123 exit checklist without independent review and the remaining negative cases.
