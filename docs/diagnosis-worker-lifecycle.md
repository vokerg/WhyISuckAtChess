# Durable diagnosis publication and refresh

Issue [#129](https://github.com/vokerg/WhyISuckAtChess/issues/129) adds the missing production link between processed source evidence and the Phase 5 ranked hierarchy. The API remains read only. The persistent worker owns materialization of the authenticated player's `overall` scope.

## Reference and intentional delta

Inspected CRT `apps/api/src/worker.ts`, `apps/api/src/modules/account-imports/providers/lichess/lichess-account-import.executor.ts`, and `apps/api/test/account-imports/account-import.lichess-worker.test.mjs`.

- Preserve: separate API/worker processes, durable database work, ownership, claim tokens, bounded retries, stale-claim recovery, and recorded-fixture acceptance.
- Change: a per-player diagnosis cursor composes Why's existing accepted aggregates, projection registry, immutable findings, overlap, relationships, consolidation, root synthesis, refreshed hierarchy, and ranking. CRT's account-profile product is not copied.
- Omit: new providers, training, a generalized scheduler, frontend calculations, AI, and new taxonomy families.
- Future seam: `materializeDiagnosis` receives an owned source snapshot and injected persistence; queue orchestration is separate from the accepted pure domain policies.

## Work identity and readiness

`DiagnosisMaterializationJob` has one durable row per `(appUserId, scopeKey)`. The worker scans at most 20 owners, in ID order, per cycle, rotating through all owners. The in-process cursor restarts at zero after process restart; the jobs, attempts, source identity, and publication survive independently. Existing imported accounts are discovered automatically. The discovery latency is one full traversal; no source trigger or HTTP calculation is required.

The SHA-256 source key incorporates the full calculation/policy tuple and compact per-table owned source checksums/counts over imports, games/indexing, analysis runs, and evidence runs. Per-row ID/`updatedAt` checksums detect changes to any source row and deletions, unlike a single maximum timestamp. Accepted source writes must advance `updatedAt`. Checksums are not a replacement for authoritative clocks, positions, engine snapshots, or evidence references. They only invalidate the derived publication.

Active import, indexing, analysis (including retry wait), or evidence work postpones publication. Readiness also checks unscheduled current analysis and each registered detector/source-analysis lineage, because the existing worker enqueues incrementally. Terminal failed/cancelled processing permits the accepted aggregates to describe coverage loss; it does not fabricate evidence or promote missing facts. Source/version changes reset the diagnosis cursor to queued work. The accepted producer limits remain in effect (generally 5,000 candidate games); oversized or excessive-finding scopes fail explicitly rather than silently sampling history.

## Claim, transaction, and recovery

1. Compare-and-set claims a queued source key with a unique token and increments its attempt count.
2. One serializable PostgreSQL transaction checks the claimed source key and ownership, reads the aggregates, publishes the immutable leaf finding revision, calculates overlap/relationships/consolidation, optionally publishes a root revision and refreshes its hierarchy, and persists ranking.
3. The same transaction marks the claimed job successful and records its finding-set ID. A failure rolls back all findings, hierarchy, and ranking; no partial revision becomes visible.
4. An independent new calculation must have a later `calculationAsOf`. The sole same-time continuation is `root-synth-v1-source-<exact current parent ID>`, preserving the accepted same-source root revision without admitting a competing leaf publication.
5. Failure retries after 1, then 2 seconds; three attempts exhaust the source key. A process dying with a claim leaves recoverable durable state. A five-minute stale lease is recovered on subsequent worker cycles. The publication transaction is capped at 60 seconds, shorter than the lease, so no separate heartbeat can conflict with the publication transaction.
6. Job token/source compare-and-set and serializable conflicts prevent competing workers from completing the same claim or replacing a newer owned revision. Superseded finding revisions are retained.

Repositories accept an injected database. Standalone calls retain their original transactions; inside publication their callbacks share the worker's outer transaction instead of opening independent nested transactions.

## Source normalization and rating comparisons

Ingestion's lowercase `white`/`black` and `win`/`loss`/`draw` values remain stored unchanged. Persistence adapters normalize known values for the accepted uppercase domain contracts. The composed acceptance fixture exposed that uppercase-only consumers had dropped real imported opening, result, and rating evidence. Production aggregate and evidence adapters accept only the newest attempt for the current index, engine version and settings. A newer failed attempt cannot fall back to older successful per-ply projections. Pure phase geometry remains analysis-independent. Obsolete detector queue rows are ignored for current readiness. User-color-sensitive detectors advance to `material-v2`, `tactical-motif-v2`, `defensive-threat-v2`, `conversion-v2`, and `opening-v2` so already processed imports are recalculated. Phase geometry remains `phase-v1`.

Each supported matched comparison supplies its actual `RATING-002` composition result to the existing candidate registry. Its finding key/dimensions identify the comparison it qualifies. `diagnosis-relationship-graph-v2` attaches `CONFOUNDED_BY` only to that comparison. Legacy single unscoped confounders retain their former behavior; ambiguous unscoped multiple confounders fail closed. No arbitrary overall rating split or new scoring rule is introduced.

## Read contract and UI

The summary recomputes source identity on read and returns `RANKING_STALE` if the persisted source key differs, including policy rollouts before worker discovery. Legacy finding sets without a source key are unavailable until the worker replaces them; they cannot prove current policy/source lineage. A new optional additive `refresh` object reports `NO_SOURCE`, `NO_GAMES`, `PROCESSING`, `QUEUED`, `RUNNING`, `FAILED`, `READY`, or `STALE`, source game count, attempts, and a bounded backend error code. Optional `evidenceState` distinguishes ranked findings, insufficient evidence, required evidence unavailable, and no eligible findings. An available empty list never establishes absence of chess weaknesses.

The Angular summary renders these states and has a read-only **Refresh status** button. Detail routes use the same summary freshness gate. Comparisons and replay retain their separate bounded, owned read contracts.

## Operational runbook

```bash
npm run db:migrate
npm run build
npm run dev
npm run dev:worker
```

Set `DATABASE_URL` to the intended application database before migration/worker startup. Test runs must use a separate disposable PostgreSQL database; the fixture deletes its own test users, never application users.

Inspect the owned `DiagnosisMaterializationJob` row alongside import/analysis/evidence progress. `SOURCE_PROCESSING` means downstream evidence is not ready. `P2034` indicates a serializable conflict; normal retry handles it. `FAILED` retains source games and prior immutable revisions. Fix the underlying fault before retrying a failed key:

```sql
UPDATE "DiagnosisMaterializationJob"
SET "status" = 'QUEUED', "attempts" = 0, "runAfter" = CURRENT_TIMESTAMP,
    "claimToken" = NULL, "heartbeatAt" = NULL, "errorCode" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "appUserId" = :owned_app_user_id AND "scopeKey" = 'overall'
  AND "status" = 'FAILED';
```

Do not reset a running claim or delete imported evidence to recover diagnosis. A new source/policy key resets attempts automatically.

## Acceptance

`apps/api/test/diagnosis-worker-acceptance.test.mjs` processes 80 legal recorded NDJSON-shaped synthetic Lichess fixture games with source clocks, exact controls, results and ratings through real import/index/engine-analysis/evidence persistence, using an explicit deterministic engine double. It verifies persisted ranked opening/time-control findings, owned detail/comparison/replay APIs, idempotence, unscheduled work, source invalidation, immutable replacement, rollback, retry, stale claims, competing workers, policy rollout, and exhausted-attempt recovery. A separate sparse fixture verifies no source, zero games, absent/short clocks, and no eligible findings without invented claims.

With `RUN_DIAGNOSIS_BROWSER_ACCEPTANCE=1`, real Chromium and Angular read the same fixture-backed Fastify API through a transport forwarding route. The browser sees no source, processing, and actual available ranked findings; it is not supplied mocked diagnosis responses. CI runs this alongside the existing onboarding browser smoke.

Live Lichess OAuth and real Stockfish are not part of this fixture. The separate Phase 7 native Stockfish gate (#123) remains authoritative for real engine execution. Exact validation results and Phase 6 exit state are recorded in [phase-6-acceptance.md](phase-6-acceptance.md).
