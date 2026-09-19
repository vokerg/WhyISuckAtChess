# Why I Suck at Chess

A lightweight, evidence-driven chess diagnosis product built to answer one question in depth:

> **Why do I suck at chess?**

## Project sources of truth

- [AGENTS.md](AGENTS.md) — operational entry point for agents: task selection, CRT-first development, PR review/completion, squash-only merges, validation, and documentation duties.
- [BIBLE.md](BIBLE.md) — canonical product intent, diagnostic philosophy, architecture principles, scope, and engineering invariants.
- [PLAN.md](PLAN.md) — high-level project phases, phase exit criteria, dependencies, parallelism, PR/review model, and agentic delivery process.
- [CRT-to-Why delta map](docs/crt-delta-map.md) — Phase 1 reference inventory and intentional preserve/change/omit seams for issue #2.
- [Diagnostic taxonomy and evidence contracts](docs/diagnostic-taxonomy.md) — canonical diagnosis IDs, evidence/coverage rules, finding semantics, and relationship contract from issue #3.
- [Lichess ingestion and timing contract](docs/lichess-ingestion-and-timing.md) — authoritative connected-account import, exact time-control, raw clock-state, alignment, timing-derivation, and bullet-eligibility contract from issue #4.
- [Phase 4 time-behavior analysis policy](docs/time-behavior-analysis.md) — shared versioned pressure, fast-move, matching, rating-confounder, coverage, and evidence-strength semantics for the Phase 4B timing aggregates.
- [Rating-context composition warning](docs/rating-context-composition.md) — reusable `RATING-002` opponent-strength composition disclosure for bounded comparison arms.
- [Implementation architecture and dependency graph](docs/implementation-architecture-and-dependency-graph.md) — module/data/worker boundaries and dependency-safe implementation sequence, updated through the Phase 3 evidence slice.
- [Phase 3 evidence acceptance](docs/phase-3-acceptance.md) — integration/acceptance matrix, validated invariants, and residual risks for the completed per-game evidence engine.
- [Sessionization and cross-game context](docs/sessionization.md) — initial Phase 4 deterministic session partition, chronology coverage, and bounded cross-game context policy.
- [Late-session deterioration aggregate](docs/session-deterioration.md) — first Phase 4 cross-game move-quality comparison for `SESSION-001`, with explicit coverage and evidence-strength semantics.
- [Loss-streak deterioration aggregate](docs/loss-streak-deterioration.md) — matched Phase 4 comparison for `SESSION-002`, using session ordinal and exact time control while keeping chronology/matching/analysis loss explicit.

The existing [`vokerg/chess_repertoir_trainer`](https://github.com/vokerg/chess_repertoir_trainer) project is the primary reference implementation. This repository adapts its modular workspace/process patterns but intentionally omits mobile, repertoire, course, and training product breadth.

## Workspace

```text
apps/api                 Fastify HTTP API plus a separate persistent-worker entry point
apps/web                 Angular application shell
packages/chess-domain    framework-neutral chess logic
packages/contracts       verified wire schemas/types
scripts                   architecture and repository guardrails
```

The API keeps explicit module seams for auth, Lichess, account imports, jobs, imported games, timing, positions, analysis, evidence, sessions, and diagnosis. Phase 3 now has a persistent deterministic-evidence registry with material, phase, tactical-motif, defensive-threat, conversion, and opening detectors. Phase 4 now has a bounded, versioned sessionization/context service, diagnosis-side aggregates for late-session and loss-streak-associated move-quality deterioration, the shared `time-behavior-v1` policy, and a reusable `RATING-002` opponent-strength composition warning for later timing/context comparisons. Owned imported-game list/detail/replay endpoints expose only current provenance-safe evidence, and the Angular replay surface renders evidence markers, coverage, measurements, and provenance without re-deriving chess facts in the UI.

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

The API exposes `GET /health`, authenticated imported-game list/detail/replay reads, and the Lichess connection/import endpoints. The persistent worker carries supported standard bullet/blitz/rapid games through indexing, timing derivation, Stockfish analysis, and the registered deterministic evidence detectors. The web app contains an investigation-first imported-game library and replay surface with inspectable deterministic evidence. The backend now has reusable session context, internal `SESSION-001` late-session and `SESSION-002` loss-streak move-quality aggregates, a versioned Phase 4B timing-behavior policy, and internal `RATING-002` opponent-strength composition warnings for bounded comparison arms. Timing mechanisms, broader contextual aggregation, diagnosis persistence/synthesis, ranking, API/UI exposure, and psychological interpretation remain later work; AI remains outside the authoritative evidence path.

## Guardrails

`npm run check:architecture` enforces the initial dependency rules: no Prisma imports from `packages/chess-domain`, no provider/Lichess imports from diagnosis, and no AI dependency inside deterministic detector directories when those directories appear. `npm run check:hygiene` rejects committed generated/vendor content, environment secrets, and omitted CRT product workspaces.

CI installs the workspace, validates and applies the full Prisma migration history against PostgreSQL, then runs typecheck, lint/guardrails, build, and tests.
