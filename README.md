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
- [Implementation architecture and dependency graph](docs/implementation-architecture-and-dependency-graph.md) — Phase 1 module/data/worker boundaries and dependency-safe implementation sequence from issue #8.

The existing [`vokerg/chess_repertoir_trainer`](https://github.com/vokerg/chess_repertoir_trainer) project is the primary reference implementation. This repository adapts its modular workspace/process patterns but intentionally omits mobile, repertoire, course, and training product breadth.

## Workspace

```text
apps/api                 Fastify HTTP API plus a separate persistent-worker entry point
apps/web                 Angular application shell
packages/chess-domain    framework-neutral chess logic
packages/contracts       verified wire schemas/types
scripts                   architecture and repository guardrails
```

The API reserves module seams for auth, Lichess, account imports, jobs, imported games, timing, positions, analysis, evidence, sessions, and diagnosis. The imported-game evidence read model now provides owned, bounded list/detail/replay endpoints while later detector and diagnosis modules remain separate.

## Developer setup

Requirements: Node.js 22.12+ and npm 10+. PostgreSQL is required only for migration/database checks at this stage.

```bash
npm install
cp .env.example .env
npm run db:validate
npm run db:generate
npm run build
npm run typecheck
npm test
npm run lint
```

For a PostgreSQL migration smoke check, point `DATABASE_URL` at a disposable database and run:

```bash
npm run db:migrate
```

Development processes are intentionally separate (the Angular dev server proxies `/api` to the local Fastify server):

```bash
npm run dev          # API + Angular web shell
npm run dev:worker   # persistent worker process; no executors are registered yet
```

The API exposes `GET /health`, authenticated imported-game list/detail/replay reads, and the previously delivered Lichess connection/import endpoints. The web app contains an investigation-first imported-game library and replay surface. Provider/OAuth/import/Stockfish/diagnosis behavior remains split across its owning modules; this issue does not add diagnosis aggregation or tactical detection.

## Guardrails

`npm run check:architecture` enforces the initial dependency rules: no Prisma imports from `packages/chess-domain`, no provider/Lichess imports from diagnosis, and no AI dependency inside deterministic detector directories when those directories appear. `npm run check:hygiene` rejects committed generated/vendor content, environment secrets, and omitted CRT product workspaces.

CI installs the workspace, validates and deploys the empty bootstrap Prisma migration against PostgreSQL, then runs typecheck, lint/guardrails, build, and tests.
