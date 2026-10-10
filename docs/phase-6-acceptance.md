# Phase 6 complete product-journey acceptance

**Status: BLOCKED — not accepted.**  
**Audit date:** 2026-10-10  
**Entry issue:** [#120](https://github.com/vokerg/WhyISuckAtChess/issues/120)  
**Blocking implementation issue:** [#129](https://github.com/vokerg/WhyISuckAtChess/issues/129)  
**Code baseline inspected:** `main` at `1aada3ebb58247442251bc928eed921fd53646a7` (merged #119).  
**Phase gate:** A user can understand major weaknesses, why the product believes them, and inspect the underlying evidence directly.

This report intentionally separates **code inspection**, **existing automated test coverage**, and **end-to-end execution**. A green isolated acceptance fixture or mocked browser test is **not** a fresh-user-to-ranked-diagnosis acceptance result. No live Lichess OAuth session, real Stockfish subprocess, disposable end-to-end database/browser journey, or commands in this report were executed as part of this audit. The existing `main` [CI run 38023092520](https://github.com/vokerg/WhyISuckAtChess/actions/runs/38023092520) concluded successfully on the inspected baseline; it does not exercise the missing production diagnosis lifecycle.

## 1. CRT reference / Why delta

**Reference (inspected):** CRT `apps/api/src/worker.ts`, `apps/api/src/modules/account-imports/providers/lichess/lichess-account-import.executor.ts`, and `apps/api/test/account-imports/account-import.lichess-worker.test.mjs`; see also `docs/crt-delta-map.md` for the pre-existing contract map.

- **Preserve:** explicit authenticated account ownership, durable worker execution, provider checkpoints, idempotence, retry/recovery, bounded imports, separated API/worker, and deterministic acceptance fixtures.
- **Change:** downstream work must create Why's immutable, provenance-safe cross-game diagnosis findings and ranked hierarchy, not CRT account-profile aggregates.
- **Omit:** provider expansion, CRT training/repertoire flows, frontend-side calculation, provider calls to build a diagnosis, and AI assertions.
- **Future seam:** an owned, durable diagnosis recalculation/materialization runner can be added after current deterministic evidence without coupling diagnosis policy to transport or UI.

## 2. Supported production path and hard boundary

```text
authenticated app user
  -> GET/POST Lichess connection (authoritative backend credential)
  -> POST /api/me/imports/lichess (explicit bounded import)
  -> persisted ImportRun status, retry and recovery
  -> persistent worker:
       Lichess importer -> ply index/timing -> Stockfish -> evidence detectors
  -X-> NO wired cross-game diagnosis trigger/publication/refresh
       (candidate projection -> immutable finding set -> overlap/relationships
        -> consolidation -> root synthesis -> refreshed hierarchy -> ranking)
  -> GET /api/diagnosis/summary?scopeKey=overall (READ ONLY)
  -> GET /api/diagnosis/findings/:findingId (READ ONLY)
  -> GET /api/diagnosis/time-controls (separate comparison read)
  -> GET /api/imported-games/:gameId/replay (owned evidence read)
  -> Angular /diagnosis -> /diagnosis/:findingId -> /games/:gameId?ply=N
```

### Verified from inspected source

1. `apps/api/src/app.ts` registers authenticated Lichess/import, imported-game, and diagnosis read routes. `apps/api/src/modules/diagnosis/diagnosis.routes.ts` registers only `GET` summary, detail and time-control comparison.
2. `apps/api/src/worker.ts` registers only import, ply index, Stockfish analysis and deterministic evidence executors. `runWorkerCycle` does not run cross-game diagnosis or ranking materialization.
3. `apps/api/src/modules/diagnosis/diagnosis-candidate.registry.ts`, `diagnosis-finding.service.ts`, `diagnosis-overlap.service.ts`, `diagnosis-relationship.service.ts`, `diagnosis-consolidation.service.ts`, `diagnosis-root-cause.service.ts` and `diagnosis-ranking.service.ts` provide accepted *reusable* primitives. The Phase 5 fixture manually composes policies, but the production API/worker does not compose them after fresh evidence.
4. `apps/api/src/modules/diagnosis/diagnosis-summary.service.ts` returns `UNAVAILABLE / NO_CURRENT_DIAGNOSIS` without an owned current finding set; it explicitly does **not** synthesize or rank on read. `docs/diagnosis-summary-read-model.md` correctly states that stale/incomplete reads are unavailable rather than recalculated.
5. The Angular diagnosis summary loads the owned `overall` scope, honors the server's unavailable state, and uses evidence-link helpers; it does not derive its own diagnosis. Lichess onboarding does not imply diagnosis readiness.

**Consequence:** Import and engine/evidence completion alone cannot publish a first ranked diagnosis on the supported product path. Existing read models may display **pre-materialized** current findings (as test fixtures demonstrate), but neither onboarding nor the worker produces those findings for a fresh user. This is a **product-blocking missing lifecycle**, not a UI empty-state defect. See #129. Until it is fixed and the integrated path is executed, Phase 6 exit fails.

## 3. Acceptance evidence matrix

| Step / invariant | Observed implementation and existing evidence | Test class / audit conclusion |
| --- | --- | --- |
| App auth and connected Lichess identity | `apps/api/test/auth-and-lichess.test.mjs`, `apps/api/test/lichess-onboarding.test.mjs`; backend connection read is authoritative | Focused API tests; live OAuth **not run** |
| Explicit bounded import, latest run, conflicts, cancellation, ownership | `apps/api/src/modules/account-imports/account-import.routes.ts`, `apps/api/test/lichess-import.test.mjs`, onboarding tests | Focused API/DB tests; missing/expired credential not interpreted as connected |
| User-visible onboarding and import recovery | `apps/web/e2e/lichess-onboarding-smoke.mjs` | **Real Chromium/Angular with intercepted API and mock OAuth**; does not prove live provider or DB pipeline |
| Imported source clock/time-control fidelity | `apps/api/test/pipeline-acceptance.test.mjs`, `apps/api/test/ply-index-timing.test.mjs`, `apps/api/test/imported-games-read-model.test.mjs` | Recorded synthetic Lichess NDJSON + disposable DB fixture; source clock presence and alignment asserted |
| Worker indexing, analysis, detector evidence, owned replay | `apps/api/test/pipeline-acceptance.test.mjs` | DB-backed four-stage executor fixture, **deterministic engine double**; **not** real Stockfish; test stops at replay/evidence |
| Cross-game candidate projection and hierarchy | `apps/api/test/phase-5-acceptance.test.mjs`, `docs/phase-5-acceptance.md` | **Synthetic in-memory policy orchestration**; not connected to import worker or production DB diagnosis revision |
| Automatic current finding-set publication/refresh | No production trigger in inspected `apps/api/src/worker.ts` or registered API route; no full-chain test | **FAIL / BLOCKED by #129** |
| Owned summary, unavailable/stale/incomplete/empty states | `apps/api/test/diagnosis-read-model.test.mjs`, `docs/diagnosis-summary-read-model.md` | Focused API/read-model fixtures; pass behavior conditional on existing persisted finding revision |
| Owned drill-down, hierarchy and support roles | `apps/api/test/diagnosis-drill-down.test.mjs`, `apps/web/test/diagnosis-summary.integration.test.ts` | Read-model and Angular fixture coverage; not a complete user journey |
| Time-control and increment comparisons | `apps/api/test/time-control-comparison-read-model.test.mjs`, `apps/web/test/diagnosis-summary.integration.test.ts` | Accepted bounded API/frontend coverage; separate from diagnosis publication |
| Representative game and exact replay ply | `apps/web/test/replay-evidence.integration.test.ts`, `apps/web/test/diagnosis-summary.integration.test.ts`, `apps/web/src/app/features/games/state/replay-deep-link.ts` | Fixtures validate `/games/:gameId?ply=N`; invalid/out-of-range ply fails safely; **not** an integrated owned finding-to-replay browser journey |
| No fabricated missing facts | `docs/phase-3-acceptance.md`, `docs/phase-4b-acceptance.md`, `docs/phase-5-acceptance.md` and focused missing-analysis/clock evidence tests | Contract boundaries reviewed; real composed sparse/partial-state run pending #129 |
| Clean migration/typecheck/lint/build/tests/architecture/browser | `.github/workflows/ci.yml`; baseline [successful CI run](https://github.com/vokerg/WhyISuckAtChess/actions/runs/38023092520) | Green **pre-audit baseline** only; no claim of fresh local execution or integrated release acceptance |

## 4. Ready, incomplete and stale states

- **Fresh account / no imported games:** `NO_CURRENT_DIAGNOSIS` is expected. No finding, statistical confidence, clock inference, or invented negative assertion is allowed.
- **Import queued/running/completed:** `ImportRun` is independent of index, engine, evidence, aggregate, and diagnosis readiness. A `COMPLETED` import is **not** permission to present a finding.
- **Evidence partial, unavailable clocks, or missing current complete engine analysis:** do not fill gaps or upgrade a diagnosis to adequate coverage. Individual source coverage/strength rules remain authoritative. A complete current finding revision is still required before the page can be `AVAILABLE`.
- **Hierarchy/ranking incomplete:** summary must return `HIERARCHY_INCOMPLETE` or `RANKING_INCOMPLETE`, not a partially sorted diagnosis.
- **Old policy / stale revision:** summary must return `RANKING_STALE`; no frontend override or hidden recalculation on GET.
- **Available zero ranked findings:** this is distinct from unavailable and from proof of no chess problems. Accepted read-model contract can display a current empty ranked list.
- **Ownership / replay:** diagnosis summary/detail, import status and imported-game replay are scoped to the authenticated app user. A supplied game/ply link is never a substitute for the owned replay API's authorization.

The read-model states above are **implemented/tested as independent surfaces**. The live transition from freshly processed evidence through diagnosis computation into those states remains unproven and currently unwired.

## 5. Reproduction / final acceptance instructions

The following are commands for **a future independent #129/#120 acceptance run**, **not** commands claimed to have run for this report. Use a disposable PostgreSQL database, Node 22 and npm 10+; never point migration/bootstrap tests at real user data.

```bash
npm ci
# DATABASE_URL must point to a disposable PostgreSQL 16 database
npm run db:validate
npm run db:migrate
npm run typecheck
npm run lint
npm run build
npm test
# Requires Playwright + Chromium (see .github/workflows/ci.yml)
node apps/web/e2e/lichess-onboarding-smoke.mjs
```

After #129 introduces a real materialization path, the new DB-backed acceptance must explicitly record and test:

1. Bootstrap a fresh owned application user and authoritative connected Lichess identity (recorded source response, **no live credentials committed**).
2. Request a bounded import, execute real persistence through the four existing worker stages, and assert complete or explicitly partial source/engine/evidence statuses. Distinguish **recorded Lichess**, **engine double**, and **real Stockfish**. Phase 7 #123 separately owns real-engine execution.
3. Execute the new durable diagnosis trigger, wait for its *owned completion* (not the import status), then assert one current immutable finding set, version tuple, ranking and representative game/ply references. Exercise both enough evidence for a supported finding and insufficient/no-evidence arms.
4. Through authenticated HTTP reads, assert `AVAILABLE` with correctly ranked supported findings or an explicit legitimate `UNAVAILABLE`; check summary, drill-down, comparison and exact owned replay/game/ply.
5. Simulate newer import/analysis/evidence revisions, older policy, overlapping worker claims and cross-owner reads; ensure old/stale work cannot publish a false current answer, replay cross-owner data, or regress to an invented `NOT_DETECTED`.
6. Add a browser/API acceptance check with actual persisted diagnosis responses, not a static `AVAILABLE` mock.

## 6. Exit decision and next action

**FAIL / BLOCKED. Do not close #120 or declare Phase 6 accepted.**

- **Blocker:** #129 must connect source readiness to diagnosis materialization, versioned re-publication and ranking through recoverable, bounded, owned production work.
- **Evidence still needed:** disposable-DB composite run, authenticated API reads, linked browser replay verification, negative/stale/retry state assertions, and independent review with executed CI results.
- **Independent Phase 7 work:** #122, #123 and #127 may proceed in parallel, but Phase 7 pilot acceptance #128 depends on closing the user journey.
- **No fabricated verification:** baseline CI being green and fixtures passing in earlier PRs do not establish that the real user loop succeeds.

Once #129 is merged, re-run this acceptance matrix on an actual composed fixture and amend the decision with exact commands and run links before closing #120.