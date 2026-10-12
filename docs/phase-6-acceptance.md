# Phase 6 complete product-journey acceptance

**Recorded integration status: PASS (2026-10-12).**
**Entry issue:** [#120](https://github.com/vokerg/WhyISuckAtChess/issues/120)
**Implementation:** [#129](https://github.com/vokerg/WhyISuckAtChess/issues/129)

The original 2026-10-10 audit found that import/index/analysis/evidence never initiated diagnosis publication. That historical blocked report is retained in [PR #130](https://github.com/vokerg/WhyISuckAtChess/pull/130). The production worker now composes the accepted diagnosis layers and refreshes the owned `overall` scope. API reads remain read only. The canonical source/queue/transaction contract, CRT reference delta, and operational recovery runbook are in [diagnosis-worker-lifecycle.md](diagnosis-worker-lifecycle.md).

## Executed integration matrix

| Link / invariant | Executed evidence | Result and limits |
| --- | --- | --- |
| Owned Lichess import, source identity, exact controls, clocks and results | `apps/api/test/diagnosis-worker-acceptance.test.mjs`: 80 NDJSON-shaped recorded legal synthetic games, through the real import and indexing services | PASS; recorded provider fixture, not live OAuth/Lichess |
| Stockfish analysis and all six detector stages | Same DB fixture invokes the real analysis service with an explicit deterministic engine double, then the registered evidence service | PASS; 80 current successful phase runs remain independent of engine identity; color-sensitive detectors recalculate at v2 |
| Ranked diagnosis publication | Production `runWorkerCycle` invokes the durable diagnosis runner after evidence, composing the real accepted aggregate/project/overlap/relationship/consolidation/root/rank services against PostgreSQL | PASS; persisted OPEN-002 and TIME-005 findings, accepted ranking order and inspectable game/ply evidence; roots are promoted only when existing support rules permit |
| Summary, finding detail, comparisons and owned replay | Real Fastify `app.inject` routes read the published finding set, comparison aggregates and representative game replay | PASS; cross-owner detail/replay denied; no read triggers computation |
| Angular availability transition | Optional Chromium run of the same acceptance fixture forwards API traffic to its real Fastify server | PASS; no-source -> processing -> real persisted ranked finding list, through read-only refresh |
| No-source/zero games/sparse/partial clocks | Separate three-game fixture with absent, short and complete clocks | PASS; unknown/insufficient states stay distinct from no detected problem; no invented clock values or ranked claims |
| Unscheduled source work | Materialization attempts before scheduling analysis/evidence | PASS; quiet queues do not imply readiness |
| Stale source/policy and immutable replacement | Source mutation and calculation-policy rollout | PASS; old ranking hidden immediately, new immutable current revision published, superseded revision retained |
| Retry/crash/restart and competing claims | Injected mid-composition failure, exhausted attempts/new-source recovery, stale lease and competing workers | PASS; full transaction rollback and bounded recovery |
| Newer source racing old publication | New source/claim/publication during an older serializable snapshot | PASS; old attempt loses with P2034; one current revision matches the new source key |
| Immutable continuation recovery | Actual fixture leaves/hierarchy retained in a same-source continuation revision, then job requeued | PASS; final current revision reused after leaf materialization key has been superseded |
| Detector/engine policy upgrades | Obsolete queued opening-v1 work, latest failed analysis with retained older ply projections, material refresh after failure, indexed zero-ply source | PASS; obsolete work does not permanently block readiness, stale analysis is excluded, unschedulable empty games remain uncovered |
| Rating context ownership | Per-comparison registry projections and graph regression | PASS; composition disclosure remains attached to its own comparison, without an arbitrary overall comparator |
| Independent review | Separate review context inspected source/policy fences, retries, transactions, ownership and bounds | PASS after fixes; no unresolved code findings; review did not claim to execute tests |

## Validation executed locally

Disposable PostgreSQL 16 databases were initialized locally with UTC timezone, separate from the existing Neon application database. Full migration deployment succeeded, including the new durable diagnosis job table. The Prisma schema explicitly maps the existing PostgreSQL-truncated ranking index name; `migrate diff` reports no difference.

```bash
DATABASE_URL=<disposable-postgres> npm run db:migrate
DATABASE_URL=<disposable-postgres> npm run db:validate
DATABASE_URL=<disposable-postgres> npx prisma migrate diff \
  --from-url <disposable-postgres> \
  --to-schema-datamodel apps/api/prisma/schema.prisma --exit-code
DATABASE_URL=<disposable-postgres> npm run typecheck
DATABASE_URL=<disposable-postgres> npm run lint
DATABASE_URL=<disposable-postgres> npm run build
DATABASE_URL=<disposable-postgres> npm test
DATABASE_URL=<separate-disposable-postgres> RUN_DIAGNOSIS_BROWSER_ACCEPTANCE=1 \
  node --test apps/api/test/diagnosis-worker-acceptance.test.mjs
```

Results: **400 passed**, zero failed, one explicitly opt-in native-Stockfish test skipped in the normal suite; two composed diagnosis tests passed again with real Chromium/Angular. Typecheck, lint/architecture/hygiene, full build, schema validation and clean migration deployment passed. The Angular build retains its existing CommonJS optimization warning for the shared contracts package.

An additional opt-in native Stockfish pass executed all **nine tests successfully**, including bullet/blitz/rapid, missing/short/excess clocks, process crash recovery, search timeout retry and pending-search subprocess exit. It uses configured depth-6 real UCI searches and a separate recorded single-game pipeline, not the 80-game diagnosis double:

```bash
DATABASE_URL=<disposable-postgres> RUN_REAL_STOCKFISH_ACCEPTANCE=1 \
  node --test apps/api/test/pipeline-acceptance.test.mjs
```

The PR adds the composed browser fixture to the existing browser CI job with its own disposable PostgreSQL service. Required CI and squash merge must complete before marking the implementation gate integrated. Live provider consent, production deployment, real-user diagnostic credibility/calibration, and throughput economics are not established by these fixtures. Phase 7 gates remain separate.

## Product boundary after #129

```text
owned authenticated identity -> explicit Lichess import
  -> indexed source clocks/positions -> current engine/evidence work
  -> durable source/policy refresh -> atomic accepted diagnosis publication
  -> read-only summary/detail/comparisons -> owned exact-ply replay
```

Import completion remains distinct from evidence and diagnosis readiness. A large processing backlog reports PROCESSING. Empty ranked lists expose insufficient/unavailable or no-eligible evidence rather than claiming that no weakness exists. Existing timing/session producer breadth and representative-reference limitations remain explicit in the accepted registry; this change does not invent unsupported taxonomy families, root support, psychological facts, or AI conclusions.
