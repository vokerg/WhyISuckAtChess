# Lichess ingestion/timing — exact CRT reference appendix

**Status:** Canonical reference appendix to `docs/lichess-ingestion-and-timing.md`  
**Scope:** issue #4  
**CRT baseline:** `vokerg/chess_repertoir_trainer` at commit `13a7e2791944ebd52113afe9f76413b10634ddff`

## Purpose

The main ingestion/timing specification records the required **Reference / Preserve / Change / Omit / Future seam** decisions. This appendix provides the exact CRT file/test lookup index for those decisions so implementation issues do not have to rediscover the baseline.

## OAuth, connected identity, and token handling

- `apps/api/src/services/lichessConnectionService.ts`
- `apps/api/src/routes/lichessAuth.ts`
- `apps/api/src/services/oauthTokenCrypto.ts`
- `packages/contracts/src/lichess/lichess.schemas.ts`
- `apps/api/prisma/schema.prisma` — `LichessConnection`, `OAuthLoginState`, `ExternalAccount`, `AppUser`
- `apps/api/prisma/migrations/20260701120000_add_lichess_oauth_connection/migration.sql`
- `apps/api/test/auth/lichess-oauth-flow.test.mjs`
- `apps/api/test/auth/oauth-token-crypto.test.mjs`

## Account-game export, provider DTO, normalization, and scope

- `apps/api/src/modules/account-imports/providers/lichess/lichess-account-import.ts`
- `apps/api/src/modules/account-imports/providers/lichess/lichess-account-import.executor.ts`
- `apps/api/src/modules/account-imports/providers/lichess/lichess-account-import.config.ts`
- `apps/api/src/modules/account-imports/account-import.types.ts`
- `apps/api/src/modules/imported-games/imported-game-workflow-eligibility.ts`
- `apps/api/test/account-imports/account-import.lichess.test.mjs`
- `apps/api/test/account-imports/account-import.lichess-executor.test.mjs`
- `apps/api/test/account-imports/account-import.lichess-worker.test.mjs`

Historical comparison only, not a second Why import path:

- `apps/api/src/services/lichessImportService.ts`

## Durable import persistence, deduplication, retries, and coverage

- `apps/api/src/modules/account-imports/account-import.provider-commit.repository.prisma.ts`
- `apps/api/src/modules/account-imports/account-import.lifecycle.repository.prisma.ts`
- `apps/api/src/modules/account-imports/account-import.repository.prisma.ts`
- `apps/api/src/modules/jobs/job-worker.service.ts`
- `apps/api/src/modules/jobs/job-worker.repository.prisma.ts`
- `apps/api/src/modules/jobs/imported-game-job-executors.ts`
- `packages/contracts/src/jobs/job-run.schemas.ts`
- `apps/api/test/account-imports/account-import.provider-commit.repository.test.mjs`
- `apps/api/test/account-imports/account-import.lifecycle.test.mjs`
- `apps/api/test/jobs/job-worker.test.mjs`
- `apps/api/test/jobs/imported-game-job-executors.test.mjs`
- `apps/api/test/jobs/job-runs.test.mjs`

## Imported-game persistence, ply indexing, and position identity

- `apps/api/prisma/schema.prisma` — `ImportedGame`, `ImportedGamePly`, `Position`, `PositionAnalysis`, `ImportRun`, `GameAnalysisRun`
- `apps/api/src/modules/imported-games/ply-index.service.ts`
- `apps/api/src/modules/imported-games/ply-index.repository.prisma.ts`
- `apps/api/src/modules/imported-games/imported-game-index-workflow.service.ts`
- `apps/api/src/modules/imported-games/imported-game-processing.service.ts`
- `apps/api/src/modules/positions/position-key.ts`
- `packages/chess-domain/src/position.ts`
- `packages/contracts/src/imported-games/imported-games.schemas.ts`

## Analysis eligibility and engine-processing assumptions

- `apps/api/src/modules/imported-games/imported-game-workflow-eligibility.ts`
- `apps/api/src/modules/imported-games/imported-game-processing.service.ts`
- `apps/api/src/modules/analysis/imported-game-analysis.service.ts`
- `apps/api/src/modules/analysis/imported-game-analysis-execution.service.ts`
- `apps/api/src/modules/analysis/position-analysis.service.ts`
- `apps/api/test/analysis/imported-game-analysis-execution.test.mjs`
- `apps/api/test/analysis/analysis-response-contracts.test.mjs`

The critical Why delta is that CRT's `STANDARD_IMPORTED_GAME_SPEEDS` currently contains only `blitz` and `rapid`; the timing specification makes standard `bullet`, `blitz`, and `rapid` diagnostic sources.

## Story/tagging assumptions that depend on clocks

- `docs/imported-game-tags.md`
- `apps/api/src/modules/imported-games/game-tagging.service.ts`
- `apps/api/src/modules/imported-games/game-tags.ts`
- `apps/api/test/imported-games/game-tagging.test.mjs`

Why may reuse the deterministic story-facet pattern, but clock-related facets are only valid after persisted source clocks and versioned timing derivation exist; compact tags are not the canonical diagnostic evidence model.

## Why-side downstream consumer contract

The authoritative Why consumer taxonomy is:

- `docs/diagnostic-taxonomy.md`

In particular, the ingestion/timing contract must support `TIME-001` through `TIME-007`, `OPEN-004`, timing joins to chess mechanisms, phase/session evidence, coverage denominators, and replay drill-down without exposing provider transport or OAuth secrets.
