# CRT to Why I Suck at Chess: building-block and product delta map

Status: Phase 1 planning baseline

Scope: [issue #2](https://github.com/vokerg/WhyISuckAtChess/issues/2)

Reference snapshot: local <code>vokerg/chess_repertoir_trainer</code> at commit <code>13a7e2791944ebd52113afe9f76413b10634ddff</code>
Reviewed: 2026-09-03

## Purpose

This document records what Why I Suck at Chess should borrow from Chess Repertoire Trainer (CRT), what it should deliberately change, and where the seams belong. It is an architecture and planning artifact for the initial setup; it does not copy CRT code or establish a shared library.

The product decision is to reuse proven patterns behind Why-specific boundaries:

- Keep the npm-workspaces TypeScript shape, Angular web app, Fastify API, Prisma/Postgres persistence, framework-neutral chess domain, shared contracts, and separate persistent worker.
- Start with one authenticated Lichess identity per Why user. Lichess is the only provider in the first product slice.
- Make exact time-control data and per-ply clock evidence first-class from ingestion through diagnosis.
- Treat deterministic evidence, not compact tags or an AI narrative, as the product's source of truth.
- Leave mobile, repertoire authoring, training courses, multi-provider support, and AI explanation outside the initial slice while preserving seams for them.

CRT is the reference implementation, not a product authority. BIBLE.md and PLAN.md remain authoritative for Why I Suck at Chess. If the CRT reference moves materially before implementation, re-check the relevant rows against a new commit.

## Vocabulary

Each subsystem below uses the following labels.

- **Reuse classification** — exactly one of `copy nearly as-is`, `copy/adapt`, `use only as a pattern`, `new for this product`, or `omit`, matching issue #2.
- **Reference** — the exact CRT implementation and tests to inspect when building the equivalent capability.
- **Preserve** — behavior or engineering discipline that has already proved useful and should carry over.
- **Change** — an intentional Why product or architecture delta.
- **Omit** — out of the initial scope, not a hidden future requirement.
- **Future seam** — the narrow boundary that keeps a later capability possible without forcing it into the first implementation.

“Preserve” does not mean “reuse the same files.” Why should adapt the pattern into its own modules and contracts.

## Reference snapshot and target shape

The CRT baseline is a modular monolith with these boundaries:

| CRT surface | Reference location | Why implication |
| --- | --- | --- |
| Workspace and commands | `README.md`, `package.json` | Use the same build/test/lint discipline where it serves the smaller product. |
| Web application | `apps/web/package.json` | Start with the game evidence and diagnosis workflows; mobile is not part of the first workspace. |
| HTTP API and workflows | `apps/api/src/app.ts` | Keep routes thin and put ownership, persistence, provider, and workflow logic in modules/services. |
| Persistent worker | `apps/api/src/worker.ts` | Keep long-running imports and engine work out of the HTTP process. |
| Chess domain | `packages/chess-domain/package.json` | Keep FEN, move, evaluation, and classification rules framework-neutral. |
| HTTP contracts | `packages/contracts/package.json` | Make timing, game evidence, and diagnosis payloads explicit and verified. |
| Database | `apps/api/prisma/schema.prisma` | Preserve ownership and durable-run patterns, but design a Why-specific evidence model. |

The intended initial repository shape is therefore:

    apps/
      api/
      web/
    packages/
      chess-domain/
      contracts/
    docs/

The worker may remain an entry point in apps/api initially, as it does in CRT. The important seam is process ownership, not the number of packages.

## Subsystem map

### 1. Workspace, runtime, and application boundaries

**Reuse classification:** `copy/adapt`

**Reference**

- `README.md` and `AGENTS.md`.
- `package.json`, `apps/api/package.json`, `apps/web/package.json`, `packages/chess-domain/package.json`, and `packages/contracts/package.json`.
- `docs/architecture.md`.
- `apps/api/src/app.ts`, `apps/api/src/main.ts`, and `apps/api/src/worker.ts`.

**Preserve**

- Node 22 and npm workspaces with TypeScript.
- Angular for the web client; Fastify, Prisma, and Postgres for the API; a framework-neutral chess package; a contracts package.
- Separate API and worker entry points.
- Feature-local modules with explicit dependency direction: web and routes consume application services, application services own workflows, the domain package stays infrastructure-free, and contracts describe verified wire shapes.

**Change**

- Organize the first product around imported-game evidence, sessions, timing, and diagnosis rather than repertoire/course workflows.
- Keep the workspace small enough that unused CRT breadth does not become accidental architecture.
- Establish a Why-specific domain vocabulary for evidence and diagnosis instead of importing CRT's feature names as the product model.

**Omit**

- `apps/mobile` and its independent navigation/state surface.
- Course authoring, repertoire authoring, training plans, and other learning-product modules.
- Any Chess.com/provider abstraction that is not needed for Lichess.

**Future seam**

- A provider-neutral import port can be introduced after the Lichess path is stable.
- A shared evidence model can serve web, later mobile, exports, and bounded AI explanations without making those consumers dependencies of ingestion.

### 2. Application identity, ownership, and authorization

**Reuse classification:** `copy/adapt`

**Reference**

- `apps/api/src/auth/auth.plugin.ts`.
- `apps/api/src/auth/current-app-user.service.ts` and `apps/api/src/auth/request-auth.ts`.
- `apps/api/src/services/oauthTokenCrypto.ts`.
- `apps/api/prisma/migrations/20260613120000_add_app_user_auth_identity/migration.sql`.
- `apps/api/prisma/migrations/20260701120000_add_lichess_oauth_connection/migration.sql`.
- `apps/api/test/auth/external-user-resolution.test.mjs`.
- `apps/api/test/auth/lichess-oauth-flow.test.mjs`.
- `apps/api/test/auth/oauth-token-crypto.test.mjs`.

**Preserve**

- Resolve an authenticated request to an internal app user before loading owned data.
- Keep provider subject identity separate from internal user IDs and enforce a unique external identity.
- Use a transaction for first-seen external-user resolution.
- Use short-lived, one-time OAuth state with PKCE.
- Encrypt provider tokens at rest with authenticated encryption; never place tokens in API response contracts.
- Keep stable 401/403 behavior and a development-only single-user path where local setup needs it.

**Change**

- Model the product around one authenticated Lichess identity/connection per Why user.
- Require a usable connected Lichess credential for private account import. CRT's durable loader intentionally falls back to an anonymous public Lichess request when a token is missing, revoked, expired, or cannot be decrypted; that fallback is not acceptable for the Why product because the connected identity is the product's source boundary.
- Keep the user-to-Lichess connection decision explicit rather than inheriting CRT's support for multiple provider accounts.
- Treat disconnect, revocation, and replacement as identity lifecycle events that invalidate or stop private imports.

**Omit**

- Chess.com authentication or account linking.
- Multiple active provider accounts in the initial user experience.
- Anonymous import as a normal product mode.

**Future seam**

- Keep an internal CurrentUser/request-auth boundary separate from the Lichess credential adapter.
- Keep token encryption and OAuth state in infrastructure services so another provider can be added later without changing diagnostic code.

### 3. Lichess OAuth and connected-account lifecycle

**Reuse classification:** `copy/adapt`

**Reference**

- `apps/api/src/services/lichessConnectionService.ts`.
- `apps/api/src/routes/lichessAuth.ts`.
- `packages/contracts/src/lichess/lichess.schemas.ts`.
- `apps/api/prisma/schema.prisma` models `LichessConnection`, `OAuthLoginState`, `ExternalAccount`, and `AppUser`.
- `apps/api/prisma/migrations/20260701120000_add_lichess_oauth_connection/migration.sql`.
- `apps/api/test/auth/lichess-oauth-flow.test.mjs`.

**Preserve**

- Authorization URL generation with state, PKCE verifier/challenge, expiry, and configured scopes.
- Callback validation before token exchange, account lookup after exchange, encrypted token persistence, and upserted provider identity.
- A status endpoint that exposes connection metadata but not secrets.
- Best-effort upstream revoke followed by local disconnect, with local ownership state remaining authoritative.

**Change**

- Make the connected Lichess account the only import source and expose the connection state as a prerequisite in the initial product flow.
- Decide Why's minimum scopes in the OAuth contract alongside the import design. Do not assume CRT's puzzle scopes are sufficient or necessary for the new product.
- Keep provider username/ID and connection state available as provenance on imported evidence.

**Omit**

- A provider selector, provider-specific UI for non-Lichess services, and unauthenticated public-account fallback.

**Future seam**

- A `LichessCredentialProvider`-style adapter may supply an access token to the importer without allowing provider response types into domain or web contracts.
- Account replacement can later be implemented behind the same one-connection boundary.

### 4. Lichess import and normalization

**Reuse classification:** `copy/adapt`

**Reference**

- `apps/api/src/modules/account-imports/providers/lichess/lichess-account-import.ts`.
- `apps/api/src/modules/account-imports/providers/lichess/lichess-account-import.executor.ts`.
- `apps/api/src/modules/account-imports/account-import.types.ts`.
- `apps/api/src/modules/account-imports/account-import.provider-commit.repository.prisma.ts`.
- `apps/api/src/modules/account-imports/account-import.lifecycle.repository.prisma.ts`.
- Legacy comparison: `apps/api/src/services/lichessImportService.ts`.
- `apps/api/test/account-imports/account-import.lichess.test.mjs`.
- `apps/api/test/account-imports/account-import.lichess-executor.test.mjs`.
- `apps/api/test/account-imports/account-import.lichess-worker.test.mjs`.
- `apps/api/test/account-imports/account-import.provider-commit.repository.test.mjs`.
- `apps/api/test/account-imports/account-import.lifecycle.test.mjs`.

**Preserve**

- The durable importer as the baseline: persisted windows, half-open date ranges, scope hashing, checkpoints, contiguous coverage, idempotent provider-game identity, bounded writes, exact counters, retry/defer behavior, rate-limit handling, and claim fencing.
- Stream Lichess NDJSON instead of buffering an entire history.
- Flush valid records in bounded batches and distinguish a malformed record, transport interruption, cancellation, and provider rate limiting.
- Keep scope filtering explicit and record enough run metadata to explain what was requested and what was accepted.
- Normalize provider metadata before persistence so downstream workflows do not parse Lichess response shapes.

**Change**

- Add the Lichess clock request and preserve the provider's per-ply clock array all the way through the normalized import value and persistence contract. The CRT provider type recognizes clocks, but its request URL does not ask for `clocks=true`, and its `NormalizedAccountImportGame` drops the array.
- Require authenticated connected-account loading. Do not silently remove Authorization and continue with a public endpoint when the connection is unusable.
- Select the durable account-import path as the only Why path. The legacy synchronous service is useful historical reference but should not become a second source of import semantics.
- Include bullet in the accepted downstream product scope, not merely in import metadata.
- Preserve exact time-control fields and raw provider notation. Do not collapse a clocked game into only a broad speed label.

**Omit**

- Chess.com or another provider adapter.
- The legacy synchronous `syncAccount` route/service as a product path.
- Importing an arbitrary public username without a connected Why identity.

**Future seam**

- A Lichess adapter should produce a normalized game plus source clock facts; the durable lifecycle/commit repository should not know Lichess field names.
- Provider adapters can later share the lifecycle and commit interfaces, but only after a second provider demonstrates that the abstraction is real.

### 5. Imported-game persistence, ply indexing, and position identity

**Reuse classification:** `copy/adapt`

**Reference**

- CRT models `ImportedGame`, `ImportedGamePly`, `Position`, `PositionAnalysis`, `ImportRun`, and `GameAnalysisRun` in `apps/api/prisma/schema.prisma`.
- `apps/api/src/modules/imported-games/ply-index.service.ts`.
- `apps/api/src/modules/imported-games/ply-index.repository.prisma.ts`.
- `apps/api/src/modules/imported-games/imported-game-index-workflow.service.ts`.
- `apps/api/src/modules/imported-games/imported-game-processing.service.ts`.
- `apps/api/src/modules/positions/position-key.ts`.
- `packages/chess-domain/src/position.ts`.
- `packages/contracts/src/imported-games/imported-games.schemas.ts`.

**Preserve**

- Ownership and provider-game identity constraints.
- Separate game-level metadata from one-row-per-ply evidence.
- Reconstruct a PGN once into verbose history, storing before/after position identity, ply number, and UCI move.
- Normalize FEN for position reuse by excluding halfmove/fullmove counters, hash the normalized position key, and verify collisions.
- Replace/index plies transactionally and make partial indexing visible as an error rather than silently serving incomplete data.
- Keep list, detail, and analysis projections separate so a broad persistence model does not leak into every response.

**Change**

- Extend the per-ply evidence model with source clock facts and explicit absence/unknown semantics. The exact field names, units, whether the value is before or after the move, and handling of the initial position belong to issue #4; the key decision here is that the information must not be discarded.
- Preserve exact `timeControlRaw`, initial seconds, increment seconds, and source-derived speed as separate values. Speed is a classification; it is not a substitute for the actual control.
- Record source provenance and normalization/derivation versions where a later diagnostic result could otherwise be impossible to reproduce.
- Allow standard bullet games into indexing and analysis eligibility. CRT's `STANDARD_IMPORTED_GAME_SPEEDS` currently limits the imported-game index workflow to blitz and rapid even though the account-import scope can accept bullet.
- Keep provider source facts immutable after import; store timing summaries and diagnostic features as derived, versioned data.

**Omit**

- Generic storage of an opaque provider payload unless a concrete retention/debugging requirement justifies it.
- Variant-specific persistence and analysis beyond standard chess in the first slice.

**Future seam**

- A normalized `ImportedGameFacts`/`PlyEvidence` boundary should feed both persistence and diagnostics.
- Position identity and reusable engine analysis can stay provider-neutral; timing and source provenance should sit beside, not inside, the position cache.

### 6. Durable runs, jobs, and worker execution

**Reuse classification:** `copy/adapt`

**Reference**

- `docs/imported-game-job-processing.md`.
- `apps/api/src/modules/jobs/job-worker.service.ts`.
- `apps/api/src/modules/jobs/job-worker.repository.prisma.ts`.
- `apps/api/src/modules/jobs/imported-game-job-executors.ts`.
- `apps/api/src/modules/account-imports/account-import.lifecycle.repository.prisma.ts`.
- `packages/contracts/src/jobs/job-run.schemas.ts`.
- `apps/api/test/jobs/job-worker.test.mjs`.
- `apps/api/test/jobs/imported-game-job-executors.test.mjs`.
- `apps/api/test/jobs/job-runs.test.mjs`.
- `apps/api/test/account-imports/account-import.lichess-worker.test.mjs`.
- `apps/api/test/account-imports/account-import.lifecycle.test.mjs`.

**Preserve**

- API and worker as separate processes.
- Durable run/task state, priorities, bounded execution slices, `FOR UPDATE SKIP LOCKED` claiming, one active task per game, opaque work-key fencing, heartbeats, stale recovery, cancellation, retries, and graceful shutdown.
- AbortSignal-aware provider streams and engine disposal.
- Engine-free indexing/tag tasks and isolated Stockfish lifecycle for analysis tasks.
- Idempotent executors that can be retried after process or provider failure.

**Change**

- Use the worker substrate for the Why import and analysis lifecycle without carrying over unused course or bulk-training task kinds.
- Make timing extraction and timing-derived feature computation observable as part of import/analysis progress, not an invisible side effect.
- Define session aggregation as a separate deterministic workflow over completed imported games; do not overload a single game task with cross-game diagnosis.

**Omit**

- Training/course job kinds and mobile-specific synchronization.
- A worker that owns HTTP request lifetimes or performs unbounded in-memory history processing.

**Future seam**

- Keep a generic claim/heartbeat executor context separate from feature-specific handlers.
- A later session/diagnosis run can consume immutable completed-game evidence and have its own versioned run record.

### 7. Stockfish analysis, cache, accuracy, and baseline move classification

**Reuse classification:** `copy/adapt`

**Reference**

- `docs/position-analysis-cache.md`.
- `apps/api/src/modules/analysis/stockfish-engine.ts`.
- `apps/api/src/modules/analysis/stockfish-engine.factory.ts`.
- `apps/api/src/modules/analysis/position-analysis.service.ts`.
- `apps/api/src/modules/analysis/imported-game-analysis.service.ts`.
- `apps/api/src/modules/analysis/imported-game-analysis-execution.service.ts`.
- `apps/api/src/modules/analysis/accuracy.ts`.
- `packages/chess-domain/src/stockfish-analysis.ts` and `packages/chess-domain/src/move-classification.ts`.
- `apps/api/test/analysis/accuracy.test.mjs`.
- `apps/api/test/analysis/imported-game-analysis-execution.test.mjs`.
- `apps/api/test/analysis/local-stockfish-engine.test.mjs`.
- `apps/api/test/analysis/analysis-response-contracts.test.mjs`.

**Preserve**

- A narrow engine interface, isolated engine lifecycle, AbortSignal-aware execution, and configurable depth/MultiPV.
- Cache reusable position analysis separately from game-specific played-move loss and classification.
- Cache-first analysis, batched writes, resumable run progress, current-analysis/version checks, and explicit failure/cleanup behavior.
- Keep score perspective conversion and move classification in tested domain/application logic.
- Preserve accuracy as a derived metric with a visible version, not as an unexplained provider value.
- Keep AI explanations out of the engine adapter.

**Change**

- Include bullet games in the supported standard-game analysis policy.
- Add timing-aware features only after source clock evidence is persisted. Time pressure, fast play, increment effects, and session deterioration must be derived in a dedicated timing/diagnostic layer rather than encoded as new generic Stockfish classifications.
- Keep the CRT baseline classifications as descriptive move quality. A Why diagnosis must explain a recurring mechanism across evidence, not rename a single `BLUNDER`.
- Define analysis coverage and engine/model versions in a way that allows a diagnosis to distinguish missing evidence from absence of a pattern.

**Omit**

- Repertoire-specific engine workflows, course coverage analysis, and interactive engine depth beyond what the first replay/diagnosis experience needs.
- Treating AI-generated text as a replacement for cached evaluations or deterministic evidence.

**Future seam**

- `StockfishEngine`, `PositionAnalysisRepository`, and move classification remain reusable inputs.
- Add a separate `TimingFeatureExtractor` and `DiagnosticDetector` boundary that consumes immutable game/ply/analysis evidence and emits versioned findings.

### 8. Story tags and game-level enrichment

**Reuse classification:** `use only as a pattern`

**Reference**

- `docs/imported-game-tags.md`.
- `apps/api/src/modules/imported-games/game-tagging.service.ts`.
- `apps/api/src/modules/imported-games/game-tags.ts`.
- `apps/api/test/imported-games/game-tagging.test.mjs`.

**Preserve**

- User-perspective tagging after analysis.
- Engine-free tag refresh as a separate step that can reuse cached analysis.
- Small game-level metadata useful for filtering and navigation.
- Explicit tag definitions and deterministic thresholds rather than arbitrary strings.

**Change**

- Do not make CRT's compact `ImportedGame.tagCodes Int[]` the canonical diagnostic representation. It has no category, confidence, detector version, source evidence, or explanation link.
- Keep story/enrichment facets separate from diagnosis findings. A game can be tagged “time pressure” or “repeated mistake,” but a diagnosis needs the exact plies, measurements, comparison baseline, detector version, and confidence.
- Implement the reserved clock story tags only when real per-ply clocks exist; do not infer `TIME_SCRAMBLE`, `MUTUAL_TIME_SCRAMBLE`, or `PLAYED_TOO_FAST` from elapsed game metadata.
- Keep classification/category names stable and user-facing only through contracts, not as magic integer meanings spread through the UI.

**Omit**

- Historical CRT tag breadth that does not help answer a first diagnosis question.
- Any tag that claims clock behavior while the source clock is absent.

**Future seam**

- A `GameStoryDetector` can emit structured facets for filtering.
- A separate `DiagnosisFinding` model can reference story facets without sharing their storage format.

### 9. Tactical detections and chess-mechanism evidence

**Reuse classification:** `copy/adapt`

**Reference**

- `docs/tactical-detections.md`.
- `apps/api/src/modules/lab/tactical-detections/tactical-detection.service.ts`.
- `apps/api/src/modules/lab/tactical-detections/tactical-detection-policy.ts`.
- `apps/api/src/modules/lab/tactical-detections/tactical-detection.repository.prisma.ts`.
- `apps/api/src/modules/lab/tactical-detections/tactical-detection-game.repository.prisma.ts`.
- `apps/api/test/tactical-detections/tactical-detection-policy.test.mjs`.

**Preserve**

- Deterministic, cache-based detections over already analyzed games.
- User-perspective evaluation math, explicit thresholds, persisted run metadata, processed markers, and bounded SQL-heavy aggregation.
- Before/after position semantics and evidence references that can be inspected in replay.
- A separation between a detector's policy/version and the stored result.

**Change**

- Promote tactical mechanisms from an optional Lab experiment into a first-class input to diagnosis, while keeping the detector isolated from UI and AI.
- Expand from only CRT's current missed-shot/opponent-blunder/user-blunder views to a taxonomy agreed in issue #3: for example, the detector may distinguish threat blindness, calculation/forcing-move failures, defensive omissions, and conversion failures. Names and thresholds are not decided in this map.
- Combine tactical evidence with timing, game phase, opening context, rating/opponent context, and session position only in the diagnostic aggregation layer.

**Omit**

- Making a tactical detection a psychological or personality claim.
- Training-board mutation or course generation as a consequence of a finding.

**Future seam**

- Detectors should consume a typed evidence snapshot and return findings with source ply IDs, numeric measurements, threshold/version, and confidence.
- A finding can later have an explanation adapter, export format, or training recommendation without changing the detector.

### 10. Opening struggles and recurring-position analysis

**Reuse classification:** `copy/adapt`

**Reference**

- `docs/opening-struggles.md`.
- `apps/api/src/modules/opening-struggles/opening-struggles.service.ts`.
- `apps/api/src/modules/opening-struggles/opening-struggles.repository.prisma.ts`.
- `apps/api/src/modules/opening-struggles/opening-struggles.routes.ts`.
- `apps/api/src/modules/opening-struggles/opening-struggles.schema.ts`.
- `apps/api/test/opening-struggles/opening-struggles.test.mjs`.

**Preserve**

- Count candidate games before loading early plies.
- Use bounded early-ply loading and a safety limit; report insufficient evidence rather than silently truncating.
- Preserve side-aware entry/threshold semantics and opening-group aggregation.
- Reuse SQL-side filtering and compact supporting-game references.

**Change**

- Reframe opening evidence as one possible recurring mechanism in a diagnosis, not as repertoire coverage or a course objective.
- Join opening recurrence with exact time control, user clock behavior, move quality, and session context only through explicit evidence queries.
- Include bullet under the same evidence and coverage rules as other standard speeds.

**Omit**

- Course coverage and repertoire-authoring workflows.
- A recommendation that the user memorize an opening solely because a correlation exists.

**Future seam**

- Keep an opening evidence query/aggregator independent from the diagnosis taxonomy.
- The same recurring-position interface can later support opening-specific views without making opening code the owner of all diagnosis logic.

### 11. Player profile, performance aggregation, and evidence quality

**Reuse classification:** `use only as a pattern`

**Reference**

- `docs/player-chess-profile.md`.
- `apps/api/src/modules/player-chess-profile/player-chess-profile.service.ts`.
- `apps/api/src/modules/player-chess-profile/player-chess-profile.repository.prisma.ts`.
- `apps/api/src/modules/player-chess-profile/player-chess-profile.metrics.ts`.
- `apps/api/src/modules/imported-games/performance-insights.service.ts`.
- `apps/api/test/player-chess-profile/player-chess-profile.service.test.mjs`.
- `apps/api/test/player-chess-profile/player-chess-profile.performance.test.mjs`.
- `apps/api/test/player-chess-profile/player-chess-profile.test.mjs`.

**Preserve**

- Deterministic, recalculable profile output.
- Explicit filters for account, date range, speed, and game scope.
- Database aggregation before bounded supporting-game loads.
- Evidence grades and coverage/analysis sufficiency checks.
- Personal baseline comparisons, uncertainty-aware wording, and supporting game references.
- Separation of preference signals from performance signals; no personality label.

**Change**

- Replace a broad profile summary as the terminal product with a diagnostic evidence graph: each conclusion must carry its denominator, analyzed coverage, relevant games/plies, comparison baseline, and detector/derivation version.
- Add session order, exact time control, clock-derived pressure, opponent/rating context, and phase as possible covariates. They must be reported as associations unless the product later defines a stronger causal design.
- Keep tags as optional facets; aggregate from structured evidence where a conclusion depends on more than one game-level label.
- Make insufficient evidence a normal result, not a UI failure.

**Omit**

- Persistent personality archetypes, ranking claims, and opaque “you are this type of player” outputs.
- LLM-generated conclusions without a deterministic evidence record.

**Future seam**

- A `DiagnosticEvidenceQuery` layer can assemble bounded evidence units.
- A pure aggregator can turn those units into findings, confidence, and wording inputs; a later explanation provider can consume the result without querying Prisma.

### 12. Web replay, board, and investigation UI

**Reuse classification:** `copy/adapt`

**Reference**

- `apps/web/src/app/features/games/pages/game-detail-page.component.ts`.
- `apps/web/src/app/features/games/pages/game-detail-page.component.spec.ts`.
- `apps/web/src/app/features/games/state/game-detail.store.ts`.
- `apps/web/src/app/features/games/state/game-detail.store.spec.ts`.
- `apps/web/src/app/features/games/helpers/game-tree.helpers.ts`.
- `apps/web/src/app/features/games/helpers/game-tree.helpers.spec.ts`.
- `apps/web/src/app/features/games/state/game-tactical-findings.store.ts`.
- `apps/web/src/app/features/games/state/game-tactical-findings.store.spec.ts`.
- `docs/ai-widgets.md` for the existing bounded game-review/replay context.

**Preserve**

- PGN replay through chess.js with before/after FEN, SAN, UCI, and a navigable main-line tree.
- URL/deep-linkable ply selection, keyboard navigation, and a board/workbench that can show evaluation and findings in context.
- A store that owns loading, selected ply, saved analysis, job state, and explicit refresh behavior.
- A graph that distinguishes user/white perspective and can emit a selected node.

**Change**

- Design the first web flow around “what happened, where, and under what clock/session conditions?” before adding broad insight dashboards.
- Show a clock timeline or per-ply clock value beside the move/evaluation timeline.
- Make every diagnosis finding link back to the exact game and ply evidence that generated it.
- Keep mobile out of the initial implementation while retaining a web contract that does not make board rendering own diagnosis logic.

**Omit**

- Mobile UI, repertoire editor, course lesson flow, and training-board generation.
- A dashboard that presents correlations without an evidence drill-down.

**Future seam**

- A replay model can expose move, position, clock, analysis, tags, and findings as separate fields.
- Board components should accept evidence annotations; they should not calculate diagnosis policy.

### 13. API routes, shared contracts, and generated documentation

**Reuse classification:** `copy/adapt`

**Reference**

- `docs/api-contracts.md` and `docs/openapi.md`.
- `apps/api/src/app.ts` and `apps/api/src/routes/index.ts`.
- `packages/contracts/src/lichess/lichess.schemas.ts`.
- `packages/contracts/src/imported-games/imported-games.schemas.ts`.
- `packages/contracts/src/jobs/job-run.schemas.ts`.
- `apps/api/test/analysis/analysis-response-contracts.test.mjs`.

**Preserve**

- Zod schemas in `packages/contracts` as the source of verified HTTP shapes.
- Fastify route schemas and typed response mapping.
- ISO date/time serialization, explicit nullable fields, ownership checks, and consumer-specific projections.
- OpenAPI generation from route metadata; avoid hand-maintained duplicate API descriptions.
- Never expose OAuth tokens, raw token material, or provider-only internals.

**Change**

- Make timing contracts explicit at list/detail/replay/finding boundaries rather than adding a private field only to the importer.
- Add a durable evidence/finding contract with source references, numeric measurements, sufficiency/confidence, and version metadata after issue #3 defines the taxonomy.
- Keep Lichess provider fields normalized and stable; expose exact controls and clock semantics without leaking NDJSON record shapes.
- Define diagnosis endpoints as read models over evidence, not as routes that run unbounded analysis synchronously.

**Omit**

- Contracts for unsupported providers, mobile-only screens, repertoire/course mutations, and AI review until the deterministic product path exists.

**Future seam**

- Keep contracts grouped by feature and versioned when wire semantics change.
- Route handlers should call application services; Prisma models and provider SDK types must not cross the HTTP boundary.

### 14. Engineering procedures, CI, and repository hygiene

**Reuse classification:** `copy/adapt`

**Reference**

- `package.json`.
- `.github/workflows/ci.yml`.
- `scripts/check-architecture-guardrails.mjs`.
- `scripts/check-repository-hygiene.mjs`.
- `docs/repository-hygiene.md`.
- `AGENTS.md` and `.github/instructions/docs.instructions.md`.
- `.github/skills/documentation-sync/SKILL.md`.

**Preserve**

- Read local instructions before changing a surface.
- Small, feature-local commits and PR review.
- Build the dependency chain before testing consumers.
- Run formatting/type/build/lint/tests and architecture/hygiene checks proportionally to the change.
- Keep docs current, use canonical indexes, validate relative links, and label direction/prototypes honestly.
- Keep secrets out of source and keep source free of generated artifacts.

**Change**

- Bootstrap only the checks that the smaller Why workspace actually has; do not fabricate mobile or CRT feature audits.
- Add clock-bearing fixtures, round-trip contract tests, and source/derived-field checks as soon as those surfaces exist.
- Add architecture guardrails for the Why-specific seams: no provider imports from diagnosis, no Prisma imports from the domain package, and no AI dependency in deterministic detectors.

**Omit**

- CRT checks whose only purpose is an omitted app or feature.
- A large CI scaffold before the workspace has code worth checking.

**Future seam**

- A compact root validation command can grow with the workspace.
- Documentation checks should remain independent of feature implementation so this map and later contracts can be reviewed early.

### 15. Optional AI explanation layer

**Reuse classification:** `use only as a pattern`

**Reference**

- `docs/ai-widgets.md`.
- `apps/api/src/modules/ai/ai.config.ts`.
- `apps/api/src/modules/ai/ai.routes.ts`.
- `apps/api/src/modules/ai/openai-compatible-llm.client.ts`.
- `apps/api/src/modules/ai/game-review/game-review-context.ts`.
- `apps/api/src/modules/ai/game-review/game-review.service.ts`.
- `apps/web/src/app/features/games/state/game-ai-review.store.ts`.
- `apps/web/src/app/features/games/state/game-ai-review.store.spec.ts`.

**Preserve**

- AI as an optional explanation layer over bounded, deterministic context.
- Server-only provider keys/models/prompts, validated request/response schemas, provider failure codes, reconciliation, and deterministic fallback.
- Replay context limited to relevant game facts and a bounded number of plies.
- No Stockfish execution or raw provider payloads inside the AI adapter.

**Change**

- Delay AI until the evidence and diagnostic contracts are stable.
- Explanations must cite the finding, games/plies, clock measurements, comparison baseline, and confidence supplied by deterministic services.
- Prompt wording may be empathetic and useful, but it may not promote correlation to causation or invent evidence.

**Omit**

- AI-generated diagnosis as the first implementation.
- AI repertoire/course builders and free-form coaching workflows.

**Future seam**

- Define an `ExplanationProvider` boundary that receives a typed, redacted finding context and returns a bounded explanation artifact.
- The core product must remain useful and testable with no provider key and no network call.

## Non-negotiable product deltas

These are the mismatches that must be resolved during implementation rather than inherited accidentally from CRT.

| Area | CRT baseline | Why I Suck at Chess decision |
| --- | --- | --- |
| Identity | App user can have provider accounts, and durable Lichess import can fall back to a public request without a token. | One authenticated Why user maps to one connected Lichess identity; private import fails clearly when that connection is unavailable. |
| Provider scope | Lichess plus existing provider-oriented seams and historical legacy paths. | Lichess only initially; keep the adapter seam but omit other providers. |
| Clocks | Lichess provider type can see optional clocks, but the URL omits `clocks=true`; normalization and `ImportedGamePly` do not retain per-ply clocks. | Request, persist, contract, replay, and derive from per-ply clock evidence end to end. |
| Time controls | Game-level raw/initial/increment values exist; downstream behavior often groups by speed. | Preserve exact control and increment, with speed as a separate label and timing derivations versioned. |
| Speed eligibility | Durable import scope includes bullet, but standard imported-game indexing/analysis currently accepts only blitz and rapid. | Bullet is in the first supported standard-game analysis scope. |
| Enrichment | Compact integer story tags and separate tactical/opening/profile views. | Keep useful facets, but diagnoses require structured, versioned evidence with source plies and sufficiency. |
| Diagnosis | CRT offers deterministic analyses and profile/insight views; it does not own a recurring-session deterioration diagnosis product. | Add a dedicated deterministic diagnosis layer over game, move, clock, phase, opening, tactical, and session evidence. |
| AI | Optional bounded review artifact and widget. | Future explanation only; AI cannot be the evidence source or initial root-cause engine. |
| Product surface | Web, mobile, repertoire, courses, training, and broad chess tooling. | Web-first investigation loop; omit mobile, training, repertoire, and course breadth from initial setup. |

## Clock-complete data path

The important architecture is a single source-fact path:

    Lichess NDJSON clocks=true
      -> Lichess adapter record
      -> normalized imported-game facts
      -> persisted per-ply source clock evidence
      -> API/replay timing contract
      -> versioned timing features
      -> deterministic findings and session aggregates

Rules for that path:

- Do not re-fetch or infer clocks later if the import already had them.
- Keep the source clock value and any derived elapsed/pressure value distinguishable.
- Represent unavailable clocks explicitly; absence is not zero and must affect evidence sufficiency.
- Define whether a clock value is captured before or after the move, how increments are applied, and how the initial position is represented in issue #4.
- Keep game-level exact time-control metadata alongside, not instead of, ply-level clock evidence.

## Implementation order implied by this map

This is a dependency order, not a second backlog.

1. Bootstrap the Why workspace and its domain/contracts boundaries.
2. Establish authenticated app-user and one-connection Lichess lifecycle.
3. Finalize the diagnostic taxonomy/evidence vocabulary in issue #3.
4. Finalize clock-complete import and timing contracts in issue #4.
5. Implement the durable Lichess import with exact time controls and persisted per-ply clocks.
6. Implement standard-game indexing and position identity with bullet included.
7. Add cache-first Stockfish analysis and baseline move classification.
8. Add versioned timing features, tactical/opening evidence, and deterministic diagnosis aggregation.
9. Build the web replay/investigation loop and evidence-linked findings.
10. Consider bounded AI explanations only after deterministic output is useful without them.

The critical dependency is that diagnosis code must consume a stable evidence contract; it must not reach into Lichess records, Prisma models, or board components directly.

## Decisions deliberately left to follow-up issues

This map does not silently decide the details that belong in the next design artifacts:

- The exact diagnostic taxonomy, finding kinds, confidence/evidence grades, and user-facing wording rules belong to issue #3.
- Clock units and semantics, persistence field names, missing-clock handling, derived timing formulas, and contract schemas belong to issue #4.
- Import date/window defaults, resumption UX, rate-limit policy, and replacement-account behavior need implementation-level decisions after those contracts.
- Analysis depth, MultiPV policy, engine version, and coverage thresholds should be selected with the initial runtime budget and evidence goals.
- Session boundaries, order, timezone, and “deterioration” comparison windows need an explicit deterministic definition.
- Retention/privacy policy for PGN, provider identifiers, clocks, ratings, and generated explanations needs a product/security decision.
- Hosting/deployment and local Postgres setup should follow the workspace bootstrap rather than be copied blindly from CRT.

## Evidence inventory

The following CRT artifacts are representative exact starting points at the pinned snapshot; subsystem Reference blocks above are authoritative when more detail is needed.

| Capability | Primary CRT documentation/code | Representative exact tests |
| --- | --- | --- |
| Architecture and process boundaries | `docs/architecture.md`, `apps/api/src/app.ts`, `apps/api/src/worker.ts` | `apps/api/test/app.test.mjs` |
| OAuth and identity | `apps/api/src/auth/current-app-user.service.ts`, `apps/api/src/services/lichessConnectionService.ts` | `apps/api/test/auth/external-user-resolution.test.mjs`, `apps/api/test/auth/lichess-oauth-flow.test.mjs` |
| Durable Lichess import | `apps/api/src/modules/account-imports/providers/lichess/lichess-account-import.ts`, `apps/api/src/modules/account-imports/providers/lichess/lichess-account-import.executor.ts` | `apps/api/test/account-imports/account-import.lichess.test.mjs`, `apps/api/test/account-imports/account-import.lichess-executor.test.mjs` |
| Ply/position indexing | `apps/api/src/modules/imported-games/ply-index.service.ts`, `apps/api/src/modules/positions/position-key.ts` | `apps/api/test/analysis/latest-analysis-snapshot.test.mjs` |
| Analysis/cache/classification | `docs/position-analysis-cache.md`, `apps/api/src/modules/analysis/imported-game-analysis-execution.service.ts` | `apps/api/test/analysis/imported-game-analysis-execution.test.mjs`, `apps/api/test/analysis/accuracy.test.mjs` |
| Jobs and worker | `docs/imported-game-job-processing.md`, `apps/api/src/modules/jobs/job-worker.service.ts` | `apps/api/test/jobs/job-worker.test.mjs`, `apps/api/test/jobs/imported-game-job-executors.test.mjs` |
| Story tags | `docs/imported-game-tags.md`, `apps/api/src/modules/imported-games/game-tagging.service.ts` | `apps/api/test/imported-games/game-tagging.test.mjs` |
| Tactical evidence | `docs/tactical-detections.md`, `apps/api/src/modules/lab/tactical-detections/tactical-detection.service.ts` | `apps/api/test/tactical-detections/tactical-detection-policy.test.mjs` |
| Opening evidence | `docs/opening-struggles.md`, `apps/api/src/modules/opening-struggles/opening-struggles.service.ts` | `apps/api/test/opening-struggles/opening-struggles.test.mjs` |
| Profile/evidence quality | `docs/player-chess-profile.md`, `apps/api/src/modules/player-chess-profile/player-chess-profile.service.ts` | `apps/api/test/player-chess-profile/player-chess-profile.service.test.mjs` |
| Web replay | `apps/web/src/app/features/games/pages/game-detail-page.component.ts`, `apps/web/src/app/features/games/state/game-detail.store.ts` | `apps/web/src/app/features/games/pages/game-detail-page.component.spec.ts`, `apps/web/src/app/features/games/state/game-detail.store.spec.ts` |
| Optional AI boundary | `docs/ai-widgets.md`, `apps/api/src/modules/ai/game-review/game-review.service.ts` | `apps/web/src/app/features/games/state/game-ai-review.store.spec.ts` |
| Procedures and hygiene | `AGENTS.md`, `.github/workflows/ci.yml`, `scripts/check-repository-hygiene.mjs` | CI and repository scripts themselves are the executable checks. |

The next implementation PRs should link back to this map when they make a deliberate preserve/change/omit decision, especially for clocks, bullet eligibility, and diagnosis evidence.