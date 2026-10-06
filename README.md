# Why I Suck at Chess

A lightweight, evidence-driven chess diagnosis product built to answer one question in depth:

> **Why do I suck at chess?**

## Project sources of truth

- [AGENTS.md](AGENTS.md) — operational entry point for agents: task selection, CRT-first development, PR review/completion, squash-only merges, validation, and documentation duties.
- [BIBLE.md](BIBLE.md) — canonical product intent, diagnostic philosophy, architecture principles, scope, and engineering invariants.
- [PLAN.md](PLAN.md) — high-level project phases, phase exit criteria, dependencies, parallelism, PR/review model, and agentic delivery process.
- [CRT-to-Why delta map](docs/crt-delta-map.md) — Phase 1 reference inventory and intentional preserve/change/omit seams for issue #2.
- [Diagnostic taxonomy and evidence contracts](docs/diagnostic-taxonomy.md) — canonical diagnosis IDs, evidence/coverage rules, finding semantics, and relationship contract from issue #3.
- [Phase 5 diagnosis synthesis and ranking policy](docs/diagnosis-synthesis-ranking-policy.md) — versioned finding lifecycle, event identity/overlap, relationship, consolidation, root-candidate, ranking, and boundedness policy from issue #81.
- [Canonical diagnostic finding persistence](docs/diagnostic-finding-persistence.md) — immutable current/superseded scope materialization, finding/evidence-reference schema, ownership fencing, and recalculation safety from issue #82.
- [Diagnosis candidate projection](docs/diagnosis-candidate-projection.md) — typed producer registry that projects supported deterministic aggregates into canonical Phase 5 finding candidates and explicitly records unsupported taxonomy IDs from issue #83.
- [Diagnosis evidence overlap](docs/diagnosis-evidence-overlap.md) — stable evidence-event identity and bounded material-overlap accounting from issue #84.
- [Diagnosis relationship graph](docs/diagnosis-relationship-graph.md) — deterministic typed finding-to-finding relationship construction from issue #85.
- [Diagnosis consolidation](docs/diagnosis-consolidation.md) — versioned non-destructive hierarchy, deduplication, and top-level eligibility from issue #86.
- [Root-cause candidate synthesis](docs/diagnosis-root-cause-synthesis.md) — registered deterministic root-theme promotion, same-revision supporting-finding links, recurrence/concentration gates, and immutable recalculation from issue #87.
- [Deterministic diagnosis ranking](docs/diagnosis-ranking.md) — versioned fixed normalization, evidence/overlap multipliers, root-vs-child hierarchy, and persisted deterministic ordering from issue #88.
- [Phase 5 diagnosis-engine acceptance](docs/phase-5-acceptance.md) — end-to-end integration matrix, accepted deterministic hierarchy boundary, integration defect fixes, deferred taxonomy breadth, and Phase 6 handoff from issue #89.
- [Diagnosis summary read model](docs/diagnosis-summary-read-model.md) — authenticated bounded Phase 6 projection of the current persisted ranked hierarchy from issue #100, with the first Angular summary consumer from issue #102.
- [Lichess ingestion and timing contract](docs/lichess-ingestion-and-timing.md) — authoritative connected-account import, exact time-control, raw clock-state, alignment, timing-derivation, and bullet-eligibility contract from issue #4.
- [Phase 4 time-behavior analysis policy](docs/time-behavior-analysis.md) — shared versioned pressure, fast-move, matching, rating-confounder, coverage, and evidence-strength semantics for the Phase 4B timing aggregates.
- [Frequent time-pressure exposure](docs/time-pressure-exposure.md) — implemented `TIME-001` aggregate for pressure-entry recurrence, per-band rates, first-entry phase/ply, and exact-control/increment context.
- [Move-quality collapse under time pressure](docs/time-pressure-quality-collapse.md) — implemented `TIME-002` matched pressure-versus-normal move-quality aggregate with current engine provenance and optional `RATING-002` composition context.
- [Played-too-fast behavior](docs/played-too-fast.md) — implemented `TIME-003` ample-clock fast-decision aggregate with exact-control/phase-matched quality comparison.
- [Early time overuse](docs/early-time-overuse.md) — implemented `TIME-004` ordered early-overuse -> later-pressure -> quality-degradation aggregate.
- [Exact time-control underperformance](docs/exact-time-control-underperformance.md) — implemented `TIME-005` same-initial exact-control comparison, preserving controls such as 3+0 versus 3+2.
- [Increment effect](docs/increment-effect.md) — implemented `TIME-006` increment versus no-increment comparison with separate result, quality, and pressure evidence.
- [Opponent move-speed effect](docs/opponent-move-speed-effect.md) — implemented `TIME-007` preceding-opponent-move response-speed/quality aggregate.
- [Rating-context composition warning](docs/rating-context-composition.md) — reusable `RATING-002` opponent-strength composition disclosure for bounded comparison arms.
- [Opponent-strength effect aggregate](docs/opponent-strength-effect.md) — implemented `RATING-001` result/current-engine quality summaries by user-relative rating band with exact-control-matched adjacent comparisons.
- [Phase 4B timing/context acceptance](docs/phase-4b-acceptance.md) — integration matrix and canonical acceptance boundary for the complete `TIME-001`–`TIME-007` plus `RATING-001/002` slice.
- [Implementation architecture and dependency graph](docs/implementation-architecture-and-dependency-graph.md) — module/data/worker boundaries and dependency-safe implementation sequence, updated through the accepted Phase 5 diagnosis engine.
- [Phase 3 evidence acceptance](docs/phase-3-acceptance.md) — integration/acceptance matrix, validated invariants, and residual risks for the completed per-game evidence engine.
- [Sessionization and cross-game context](docs/sessionization.md) — initial Phase 4 deterministic session partition, chronology coverage, and bounded cross-game context policy.
- [Late-session deterioration aggregate](docs/session-deterioration.md) — first Phase 4 cross-game move-quality comparison for `SESSION-001`, with explicit coverage and evidence-strength semantics.
- [Loss-streak deterioration aggregate](docs/loss-streak-deterioration.md) — matched Phase 4 comparison for `SESSION-002`, using session ordinal and exact time control while keeping chronology/matching/analysis loss explicit.
- [Stable overlong-session stopping point](docs/overlong-session-stopping-point.md) — implemented `SESSION-003` fixed-threshold aggregate with same-session exact-control matching, distinct-session recurrence, and earliest-supported-threshold selection.

The existing [`vokerg/chess_repertoir_trainer`](https://github.com/vokerg/chess_repertoir_trainer) project is the primary reference implementation. This repository adapts its modular workspace/process patterns but intentionally omits mobile, repertoire, course, and training product breadth.

## Workspace

```text
apps/api                 Fastify HTTP API plus a separate persistent-worker entry point
apps/web                 Angular application shell
packages/chess-domain    framework-neutral chess logic
packages/contracts       verified wire schemas/types
scripts                   architecture and repository guardrails
```

The API keeps explicit module seams for auth, Lichess, account imports, jobs, imported games, timing, positions, analysis, evidence, sessions, and diagnosis. Phase 3 has a persistent deterministic-evidence registry with material, phase, tactical-motif, defensive-threat, conversion, and opening detectors. Phase 4 has bounded sessionization/context aggregates for `SESSION-001/002/003` plus the accepted Phase 4B timing/rating slice: shared `time-behavior-v1`, `TIME-001` through `TIME-007`, and `RATING-001/002`, with exact-control/increment identity, current-engine provenance, explicit coverage, weaker-arm evidence gating, and rating-composition confounder disclosure. Owned imported-game list/detail/replay endpoints expose only current provenance-safe evidence, and the Angular replay surface renders evidence markers, coverage, measurements, and provenance without re-deriving chess facts in the UI.

## Developer setup

Requirements: Node.js 22.12+, npm 10+, and PostgreSQL for the API/worker persistence path.

```bash
npm ci
cp .env.example .env
npm run db:validate
npm run db:generate
npm run build
npm run typecheck
npm test
npm run lint
```

The root `package-lock.json` is committed and covers the complete npm workspace. Use `npm ci` for a clean checkout so local development resolves the same dependency graph as CI. When intentionally changing dependency declarations, use `npm install` (or the appropriate `npm install <package>` command), review the resulting `package-lock.json` change, and commit the manifest and lockfile together.

`AUTH_MODE` must be set explicitly. The checked-in `.env.example` uses `AUTH_MODE=dev-single-user` for local development; production-like deployments must configure Clerk explicitly and may not use the development single-user mode.

For a PostgreSQL migration smoke check, point `DATABASE_URL` at a disposable database and run:

```bash
npm run db:migrate
```

Development processes are intentionally separate (the Angular dev server proxies `/api` to the local Fastify server):

```bash
npm run dev          # API + Angular web shell
npm run dev:worker   # persistent Lichess import -> ply indexing -> Stockfish worker
```

The API exposes `GET /health`, authenticated imported-game list/detail/replay reads, and the Lichess connection/import endpoints. The persistent worker carries supported standard bullet/blitz/rapid games through indexing, timing derivation, Stockfish analysis, and the registered deterministic evidence detectors. The web app contains an investigation-first imported-game library and replay surface with inspectable deterministic evidence. The backend now has reusable session context, internal `SESSION-001/002/003` aggregates, and the accepted Phase 4B `TIME-001`–`TIME-007` plus `RATING-001/002` aggregate evidence described in `docs/phase-4b-acceptance.md`. Remaining Phase 4 breadth is `CAL-001` once explicit user timezone data exists. Phase 5 is now accepted end to end: the framework-neutral synthesis/ranking policy, immutable finding persistence, typed candidate projection, stable event overlap, relationship graph, non-destructive consolidation, registered root-cause synthesis, hierarchy refresh, and deterministic ranking are covered by the #89 integration pass in `docs/phase-5-acceptance.md`. Supported roots consume consolidated findings without independently ranking their children, explicit rating confounders remain inspectable, and known synthesized-root/child evidence reuse is not misclassified as unresolved duplicate overlap. Remaining taxonomy producer breadth is explicit, including `CAL-001` pending authoritative user IANA timezone data. Phase 6 now begins with the authenticated bounded `GET /api/diagnosis/summary?scopeKey=...` read model from #100, which projects only current persisted top-level ranking and representative evidence without recalculating diagnosis policy. Issue #102 adds `/diagnosis` as the default Angular surface over the owned `overall` summary, preserving backend rank order and linking representative game evidence to the existing replay view. PR #105 adds the bounded current-top-level drill-down API with persisted child support roles, and issue #106 exposes it through the `/diagnosis/:findingId` Angular page linked from each summary finding. Each page preserves authority and revision state, including missing/stale data, while displaying bounded game evidence. Issue #108 links the accepted representative game evidence from both views to an exact replay ply via a validated `?ply=` route target; absent, invalid, or out-of-range targets safely open at the starting position without recalculating any evidence. A shared, read-only interpretation guide on both diagnosis views explains policy-normalized priority, evidence grades, sample/coverage semantics, raw effects and the limits of representative examples without reinterpreting any finding. Later Phase 6 comparison/explanation work can consume dedicated bounded read models; AI remains outside the authoritative evidence path.


### Lichess browser onboarding (Phase 6)

Start the API and Angular app (`npm run dev`) plus the persistent worker (`npm run dev:worker`). Open `/settings/lichess` directly or follow **Connect / import Lichess** from `/diagnosis` or `/games`. In local `dev-single-user` mode there is no separate app sign-in form; production-like application authentication remains independently required. OAuth requires `LICHESS_OAUTH_CLIENT_ID`, `LICHESS_OAUTH_REDIRECT_URI`, `WEB_APP_URL`, and a configured token-encryption key from `.env.example`.

Choose **Connect Lichess**, complete authorization, and verify the authoritative connection state on return. The callback query parameter alone does not establish a connection. Expired/revoked/unreadable credentials require reconnect, and disconnect revokes the local connection without deleting imported evidence.

An import **never starts automatically**. Confirm the connected identity, editable local-time window (default last 30 days), UTC instants and rated/casual scope, then select **Start bounded import**. The supported standard bullet/blitz/rapid import keeps source clocks and exact time controls. The page recovers the authenticated user's active-first/latest persisted run after navigation or reload; progress, queued retry, cancellation and counters are backend-owned. A conflicting active request attaches to the existing run. **Completed import ≠ completed engine/evidence processing or available diagnosis**; check `/games` and `/diagnosis` independently. The bounded recovery contract is documented in `apps/api/src/modules/account-imports/README.md`.

## Guardrails

`npm run check:architecture` enforces the dependency rules: no Prisma imports from `packages/chess-domain`; no provider/Lichess, Angular/Chessground/web UI, or AI imports from diagnosis; and no AI dependency inside deterministic detector directories. `npm run check:hygiene` rejects committed generated/vendor content, environment secrets, and omitted CRT product workspaces.

CI installs the workspace, validates and applies the full Prisma migration history against PostgreSQL, then runs typecheck, lint/guardrails, build, and tests.
