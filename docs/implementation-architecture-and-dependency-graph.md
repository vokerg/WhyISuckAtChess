# Implementation architecture and dependency graph

**Status:** Phase 1 canonical implementation architecture  
**Scope:** issue #8  
**Parent:** issue #1  
**Depends on:** issues #2, #3, and #4  
**CRT reference baseline:** `vokerg/chess_repertoir_trainer@13a7e2791944ebd52113afe9f76413b10634ddff`

## 1. Purpose

This document closes the gap between the accepted Phase 1 product/data contracts and executable implementation work.

The existing Phase 1 documents answer different questions:

- `docs/crt-delta-map.md` says what to reuse from Chess Repertoire Trainer (CRT), what to change, what to omit, and where future seams belong.
- `docs/diagnostic-taxonomy.md` defines the deterministic finding vocabulary, evidence/coverage requirements, source-reference invariants, and relationship semantics.
- `docs/lichess-ingestion-and-timing.md` defines the authoritative Lichess identity/import/timing contract, including lossless raw clock preservation, safe alignment, timing derivation semantics, and bullet eligibility.

This document does **not** restate those specifications. It defines the concrete implementation architecture that must preserve them:

1. workspace and module ownership;
2. conceptual persistence/data ownership;
3. synchronous versus durable-worker boundaries;
4. typed interfaces between source facts, derived evidence, aggregation, diagnosis, and UI;
5. dependency-safe implementation order and PR boundaries;
6. validation and architecture guardrails;
7. the Phase 1 closure decision.

Exact Prisma model names, SQL indexes, endpoint paths, and TypeScript symbol names may evolve during implementation. The ownership, source-versus-derived distinctions, version/provenance requirements, and dependency direction below are architectural constraints.

---

## 2. Reference / Preserve / Change / Omit / Future seam

### Reference

Use the CRT snapshot pinned above, particularly:

- workspace/process boundaries in `docs/architecture.md`, root/workspace package files, `apps/api/src/app.ts`, `apps/api/src/main.ts`, and `apps/api/src/worker.ts`;
- application auth, current-user resolution, OAuth token crypto, Lichess connection routes/services, and tests;
- durable account-import lifecycle, Lichess NDJSON adapter/executor, provider commit repository, retry/window/checkpoint behavior, and worker tests;
- Prisma models for users/connections, imported games/plies, positions/position analysis, import runs, game-analysis runs, and persistent jobs;
- imported-game ply indexing, position-key normalization, processing orchestration, and consumer-specific read projections;
- persistent job claiming, fencing, heartbeat, stale recovery, cancellation, retry, graceful shutdown, and engine isolation;
- cache-first Stockfish analysis and per-game score-loss/move classification;
- tactical detections, opening struggles, and player-profile aggregation as patterns for bounded deterministic evidence;
- Angular game-detail/replay state and Chessground component boundaries;
- CI/repository hygiene conventions.

### Preserve

- npm-workspace modular monolith with TypeScript;
- `apps/api`, `apps/web`, `packages/chess-domain`, and `packages/contracts` as the initial workspace shape;
- Fastify routes that delegate to application/query services rather than owning workflows;
- Prisma access owned by backend modules/repositories;
- framework/infrastructure-free chess logic in `packages/chess-domain`;
- verified wire contracts in `packages/contracts`;
- separate API and persistent-worker processes;
- durable, idempotent, bounded background work with explicit status, retries, cancellation, fencing, stale recovery, and graceful shutdown;
- reusable normalized positions and cache-first engine evidence;
- per-game evidence separated from reusable position analysis;
- consumer-specific read models rather than leaking broad persistence models;
- deterministic evidence before optional explanation;
- tests and CI as executable architecture constraints, not only conventions in prose.

### Change

- one application user has one authoritative connected Lichess identity initially;
- normal import is authenticated and never falls back anonymously;
- exact initial time, increment, raw time-control provenance, broad speed, and raw provider clock sequence are distinct facts;
- raw clock states are durable before any attempt to align them to plies;
- aligned ply clock facts and derived move-time/timing features are versioned, nullable derivations rather than replacements for source clocks;
- standard bullet joins blitz and rapid in the first supported standard-game indexing/analysis policy;
- immutable source facts are separate from versioned engine, timing, tactical, phase/endgame, session, and diagnosis outputs;
- cross-game/session work is a separate deterministic workflow over completed per-game evidence, not an extension of a single-game task;
- the terminal product representation is a structured finding/evidence graph, not CRT compact integer tags or a free-form insight string;
- all user-facing evidence exposes coverage/missing/unreliable states instead of treating unavailable evidence as negative evidence.

### Omit

- `apps/mobile`;
- Chess.com and other providers in the first product slice;
- arbitrary public-account import;
- repertoire authoring, courses, training, marathons, puzzles, and their worker/task kinds;
- AI explanation from the first deterministic implementation chain;
- a shared-library extraction program;
- a generic opaque provider-payload store as the sole source of timing truth;
- a universal untyped “facts JSON” table used in place of owned source/evidence schemas.

### Future seam

The implementation must keep replaceable typed boundaries around:

- connected Lichess credentials and provider fetching;
- normalized imported-game source facts;
- durable worker claim/executor context;
- position identity and engine access;
- timing alignment/feature extraction;
- per-game detector families;
- bounded cross-game evidence queries;
- sessionization;
- diagnosis synthesis/ranking;
- replay/read models;
- optional future explanation.

A later shared package may replace duplicated CRT-derived internals behind these seams. Application features must not depend on that future extraction.

---

## 3. Target workspace and module map

Initial target shape:

```text
apps/
  api/
    prisma/
    src/
      auth/
      modules/
        lichess/
        account-imports/
        jobs/
        imported-games/
        timing/
        positions/
        analysis/
        evidence/
        sessions/
        diagnosis/
      routes/
      app.ts
      main.ts
      worker.ts
  web/
    src/app/
      core/
      features/
        connection/
        imports/
        games/
        diagnosis/          # introduced only when deterministic findings exist
packages/
  chess-domain/
    src/
      position/
      evaluation/
      move-classification/
      geometry/             # later detector work
      phase-endgame/        # later detector work
  contracts/
    src/
      lichess/
      imports/
      games/
      jobs/
      analysis/
      diagnosis/
docs/
```

The exact file tree is not sacred. Module ownership and dependency direction are.

### 3.1 Process ownership

`apps/api/src/app.ts` owns reusable Fastify construction, plugin/compiler registration, auth integration, route composition, validation/error mapping, and API lifecycle hooks.

`apps/api/src/main.ts` owns production environment loading, listen/bootstrap, and API-process signal handling.

`apps/api/src/worker.ts` is a separate process entry point. It may host more than one durable scheduling loop, as CRT does, but the API process must not start those loops. Each loop owns bounded claiming, cancellation, heartbeat/stale recovery, and graceful shutdown through explicit worker services.

`apps/web` submits work, reads status/evidence, and renders replay/findings. It never performs persisted whole-history import, indexing, engine analysis, sessionization, or diagnosis synthesis.

### 3.2 Module ownership table

| Module | Owns | Must not own |
| --- | --- | --- |
| `auth` | external-auth subject -> app-user resolution; request auth/ownership | Lichess provider semantics, diagnosis |
| `lichess` | OAuth/PKCE lifecycle, encrypted token persistence, connected identity/credential adapter | imported-game persistence, timing derivation, diagnosis |
| `account-imports` | durable import runs/windows/checkpoints, Lichess fetch/normalize executor, bounded provider commits | ply reconstruction, Stockfish, session aggregation |
| `imported-games` | imported-game source record ownership, game queries, ply indexing orchestration/read boundaries | provider token storage, diagnosis policy |
| `timing` | raw-clock alignment policy and versioned nullable timing derivation over persisted source facts | OAuth/fetching, engine evaluation, psychological interpretation |
| `positions` | normalized position key/identity and collision verification | game-specific clocks or diagnosis context |
| `analysis` | Stockfish abstraction/cache, position analysis, game-analysis runs, per-ply score-loss/classification | provider fetching, session aggregation, UI state |
| `jobs` | generic persistent per-game task/run mechanics and executor context | chess policy inside executors |
| `evidence` | typed deterministic per-game event/facet query interfaces and later detector orchestration | finding ranking, provider DTOs |
| `sessions` | versioned chronological sessionization and cross-game context | per-ply engine/timing derivation |
| `diagnosis` | bounded aggregation, findings, relationships, evidence strength/coverage, later ranking/synthesis | Lichess DTOs, Prisma types outside owned repositories, board/UI logic, AI authority |
| `packages/chess-domain` | pure position/evaluation/classification/geometry rules | Prisma, Fastify, Angular, provider/network code |
| `packages/contracts` | verified serializable wire schemas/types | database models or provider secrets |
| `apps/web` | Angular feature state, API clients, replay/board presentation, finding investigation | deterministic evidence generation |

### 3.3 Dependency direction

Allowed high-level direction:

```text
apps/web
  -> packages/contracts
  -> HTTP API

HTTP routes
  -> application/query services
  -> owned repositories / domain services

provider adapter
  -> normalized source-fact contract
  -> import commit repository

persisted source facts
  -> ply/timing indexing
  -> position identity
  -> engine evidence
  -> deterministic evidence detectors
  -> bounded cross-game/session aggregation
  -> diagnosis findings/relationships
  -> consumer read models
```

Forbidden shortcuts:

```text
diagnosis -> Lichess provider DTO
 diagnosis -> OAuth token repository
 diagnosis -> Angular/Chessground
 chess-domain -> Prisma/Fastify/provider client
 web -> Prisma
 position cache -> game clock/timing context
 provider adapter -> diagnosis tables
 AI/explanation -> authoritative detector state
```

---

## 4. Conceptual persistence and data ownership

### 4.1 General rules

1. **Provider/source facts are immutable evidence.** Re-import may enrich missing/incomplete facts when the accepted contract explicitly allows it, but a valid source value is not overwritten by a weaker/missing one.
2. **Derived data is versioned.** If semantics can change, a policy/detector/engine/sessionization/taxonomy version is stored with the result or its owning run.
3. **Derived data never substitutes for source data.** A post-move clock, reconstructed approximate move time, engine score, motif, session ordinal, and diagnosis are different layers.
4. **Coverage is data.** Incomplete indexing/analysis/timing/detector coverage must be queryable and cannot be represented as “no finding”.
5. **Ownership is explicit.** Cross-module consumers use typed reads/query services; they do not import another module's Prisma types and start composing policy around storage details.
6. **Idempotency is designed at each durable boundary.** Provider game identity, raw-clock ordinal, ply number, normalized position key, analysis run/version, sessionization version, and diagnosis run/finding identity each need stable uniqueness semantics.

### 4.2 Identity and connected provider state

Conceptual entities:

```text
AppUser
  id
  externalAuthSubject / auth identity relation
  createdAt / updatedAt

LichessConnection
  appUserId                    # one active authoritative connection initially
  lichessUserId
  lichessUsername
  encryptedAccessToken
  token metadata / connection state
  connectedAt / disconnectedAt

OAuthLoginState
  appUserId
  state
  PKCE verifier metadata
  expiresAt
  consumedAt
```

Important constraints:

- external auth identity is unique and resolves to one internal app user;
- a connected Lichess provider identity cannot silently become another user's source identity;
- exactly one active authoritative Lichess connection per app user initially;
- token material never appears in `packages/contracts` response DTOs;
- import code reads a narrow `ConnectedLichessCredential` view instead of querying OAuth tables itself.

### 4.3 Durable import lifecycle

Conceptual entities follow CRT's durable lifecycle pattern rather than a single request transaction:

```text
AccountImportRun
  id
  appUserId
  connectedLichessIdentity snapshot/provenance
  immutable requested range/scope
  scopeHash
  status
  counters
  checkpoint/coverage metadata
  startedAt / completedAt / failure

AccountImportWindow / task state
  runId
  stable ordinal/range
  status
  claim fence / attempts / heartbeat / retry/defer metadata
```

Exact decomposition may follow CRT's existing run/window/lifecycle tables. Required semantics are persisted windows/checkpoints, contiguous coverage, bounded work, restartability, cancellation, provider cooldown, and claim fencing.

An import run's coverage says what history was attempted/committed. It does not imply every game has usable timing evidence.

### 4.4 Imported game source facts

`ImportedGame` (or an equivalent owned source model) represents one imported Lichess game for the application user and preserves the source concepts required by `docs/lichess-ingestion-and-timing.md`:

```text
ImportedGame
  id
  appUserId
  provider = LICHESS
  providerGameId
  providerUrl
  connected Lichess identity provenance
  provider source/game-origin metadata

  startedAt / endedAt
  rated
  variant
  speedCategory
  perfCategory

  raw/provider time-control provenance
  initialTimeSeconds?
  incrementSeconds?             # 0 is authoritative, not null
  exactControlKey?              # derived grouping/display key

  white/black identity + rating facts
  userColor
  result / status
  opening source/derived metadata as specified
  PGN/move reconstruction source

  rawClockSequencePresence      # PRESENT | ABSENT | INVALID
  rawClockStateCount
  timing source anomalies/provenance

  sourceImportedAt / sourceUpdatedAt
```

Uniqueness is at least the owned provider-game boundary (`appUserId` + provider + providerGameId, or the equivalent authoritative connected-account key).

Broad speed is never the exact time control. `incrementSeconds = 0` is different from unknown increment.

### 4.5 Raw Lichess clock-state sequence

Persist the received valid provider clock sequence independently of ply indexing:

```text
LichessClockSourceState
  importedGameId
  sourceOrdinal                 # exact provider order
  valueCentiseconds             # exact provider integer
```

Required constraints:

- unique `(importedGameId, sourceOrdinal)`;
- provider order and centisecond value are immutable source evidence;
- a row does not assert that its ordinal equals a ply;
- the sequence can legitimately contain an extra terminal state;
- absent and invalid sequence states remain distinguishable even when there are no valid rows;
- a successful provider commit that received valid clocks commits the game and sequence in the same logical durable operation.

Do not delete a source state merely because the current alignment policy cannot map it to a ply.

### 4.6 Ply indexing and timing derivation

Conceptual indexed evidence:

```text
ImportedGamePly
  importedGameId
  plyNumber
  mover/color
  uci / SAN when needed for consumers
  beforePositionId
  afterPositionId

  alignedClockSourceOrdinal?    # points back to immutable source clock when safe
  postMoveClockCentiseconds?    # optional projection for efficient reads
  clockAlignmentStatus
  clockAlignmentPolicyVersion

  approximateMoveTimeCs?        # nullable derived fact
  timingReliability
  timingDerivationVersion
  timingCaveat/anomaly code(s)

  later game-specific engine fields/snapshot refs
```

Implementation may split aligned source-clock facts and derived timing features into separate tables rather than columns on `ImportedGamePly`. That choice is acceptable if the API can still distinguish:

1. raw provider source state;
2. safe source-state-to-ply alignment;
3. derived approximate timing feature;
4. reliability/caveat/version.

Hard constraints from issue #4 remain:

- the aligned source value is the mover's post-move Lichess clock;
- first-move think time is unavailable from this sequence alone;
- an extra terminal source state can remain game-end evidence without a ply;
- final-move increment semantics are handled by the versioned derivation policy;
- lag compensation/player-specific modifiers/out-of-band adjustments can make clock-delta move time approximate or unreliable;
- missing/unreliable timing is null/caveated, not fabricated.

### 4.7 Normalized positions and reusable engine evidence

Conceptual provider-neutral cache:

```text
Position
  id
  normalizedPositionKey / normalizedFen
  hash
  collision-verification data

PositionAnalysis
  positionId
  engine identity/version
  analysis policy/config version
  depth/nodes/etc as selected by implementation
  evaluation / mate representation
  best move / PV data when retained
  createdAt
```

`Position` and `PositionAnalysis` must not contain game-specific clock, user, session, or diagnosis fields.

The position key follows the accepted CRT pattern: normalize irrelevant move counters for reusable identity while retaining enough canonical value to verify hash collisions.

### 4.8 Whole-game analysis runs and game-specific engine evidence

Conceptual entities:

```text
GameAnalysisRun
  id
  importedGameId
  analysisPolicyVersion
  engineVersion/config provenance
  status / progress
  coverage
  startedAt / completedAt / failure

ImportedGamePly engine evidence
  evaluation before/after references or snapshots
  scoreLoss
  moveClassification
  gameAnalysisRun/version provenance
```

Reusable engine output and game-specific interpretation stay separate. A newer/valid analysis run must not be replaced by stale concurrent completion from an older run.

“No engine evidence” is an explicit coverage state, not an implicit good move/game.

### 4.9 Deterministic per-game evidence

The architecture should not force every detector into one generic JSON/EAV table. Different detector families may need different query/index shapes.

However, downstream diagnosis needs a common **typed evidence-reference boundary**. Conceptually each persisted detector result/event must expose:

```text
EvidenceReference
  evidenceKind
  stableEvidenceId              # when the detector persists a first-class event
  importedGameId
  optional plyNumber / plyId
  optional positionId
  detectorVersion
  mechanismConfidence when applicable
  source modality requirements
```

Family-specific persistent evidence may include tactical events, phase/endgame classifications, conversion events, opening/recurring-position events, or timing behavior events. Persist when a result is expensive, reusable, needs replay evidence, or must be reproducible across diagnosis runs. Cheap aggregate-only values may remain query-time derivations if bounded and versioned.

A detector may not write directly into `DiagnosticFinding` merely because a per-game event sounds user-facing. Findings are cross-game claims governed by sample, coverage, baseline, effect, and relationship rules.

### 4.10 Sessionization and cross-game context

Sessions are derived chronological context, not provider source facts. Because multiple diagnosis families need the same chronological partition and ordinal values, sessionization should be versioned and reusable rather than reimplemented per query.

Conceptual shape:

```text
SessionizationRun
  appUserId
  date/range scope
  sessionizationPolicyVersion
  status / coverage

GameSession
  sessionizationRunId
  sessionKey/id
  startedAt / endedAt
  gameCount

GameSessionMembership
  sessionId
  importedGameId
  ordinal
  elapsedFromSessionStart
  priorLossStreak / other deterministic context where policy defines it
```

The exact gap threshold and session semantics are later calibration/policy details. Changing semantics bumps the sessionization policy version.

Session workflows consume completed imported-game chronology and source/derived game evidence. They do not own per-ply reconstruction or engine execution.

### 4.11 Diagnosis runs, findings, evidence links, and relationships

Diagnosis persistence must preserve the concepts in `docs/diagnostic-taxonomy.md` without treating its illustrative field list as a required Prisma layout.

Conceptual durable ownership:

```text
DiagnosisRun
  appUserId
  requested scope/date range
  taxonomyVersion
  aggregation/ranking policy version(s)
  upstream evidence/session versions/coverage snapshot
  status
  calculationAsOf

DiagnosticFinding
  diagnosisRunId
  diagnosisId
  taxonomyVersion
  detectorOrAggregatorVersion
  level
  deterministic title/summary key
  scope
  sample denominators
  coverage denominators/exclusions
  observed metric
  baseline/comparator
  effect/severity/result-impact measures where defined
  evidenceStrength
  mechanismConfidence
  caveats/confounders

DiagnosticFindingEvidence
  findingId
  importedGameId
  optional ply/position reference
  optional persisted evidence reference
  role / representative ordering

DiagnosticFindingRelationship
  sourceFindingId
  targetFindingId
  registered relationship type
```

Relationships are finding-to-finding. Raw contextual dimensions are not disguised as finding targets.

A diagnosis run references immutable/versioned upstream evidence. Re-running newer policy creates new output or supersedes through explicit latest-run selection; it does not mutate historical evidence into a different meaning.

### 4.12 Read models are not source-of-truth migrations

Consumer projections such as an imported-game list row, replay DTO, time-control comparison card, or ranked-diagnosis response should normally be assembled by bounded query/application services over owned persisted facts.

Create migration-backed snapshots only when they are needed for correctness, durable workflow state, reproducibility, or demonstrated query cost. Do not persist every UI aggregate merely because it appears on a page.

---

## 5. Pipeline and worker boundaries

### 5.1 End-to-end authoritative pipeline

```text
App auth
  -> connected Lichess OAuth identity
  -> durable authenticated account import
  -> normalized + persisted game source facts
  -> persisted raw clock sequence
  -> ply reconstruction + clock alignment + timing derivation
  -> normalized position identity
  -> cache-first whole-game engine analysis
  -> deterministic per-game evidence detectors
  -> versioned sessionization / cross-game context
  -> bounded aggregations + comparisons
  -> diagnostic findings + relationships/ranking
  -> API read models / replay / diagnosis UI
  -> optional future explanation
```

Each arrow crosses a typed boundary. Later layers may reference earlier evidence but do not overwrite it.

### 5.2 What is synchronous

Appropriate synchronous API/application work:

- resolve current app user;
- create OAuth authorization URL/state;
- process bounded OAuth callback exchange/identity lookup;
- read connection/import/job status;
- create an import/job request;
- bounded imported-game list/detail/replay queries;
- bounded diagnosis/finding reads;
- small deterministic contract mapping/validation;
- cancellation/retry requests that mutate durable state and return promptly.

The request lifecycle must not stream an entire account history, index a whole imported game, run Stockfish across a game, sessionize long history, or synthesize a broad diagnosis scope.

### 5.3 What is durable background work

Durable worker-owned work:

1. **Account import**
   - stream provider windows;
   - normalize and commit source games/raw clocks in bounded batches;
   - retry/defer/cancel with persisted progress.

2. **Per-game preparation/indexing**
   - reconstruct PGN/moves;
   - establish normalized positions;
   - align raw clock states;
   - derive current-version timing facts;
   - publish complete preparation atomically/visibly.

3. **Whole-game engine analysis**
   - resolve/cache position evidence;
   - compute game-specific score loss/classification;
   - persist versioned run coverage/progress.

4. **Later per-game detectors**
   - run deterministic expensive/reusable event detectors after their required modalities are complete;
   - persist detector version and evidence references.

5. **Cross-game/session workflows**
   - versioned sessionization over chronological games;
   - bounded account-scope aggregation/diagnosis runs when scopes exceed a safe synchronous query.

### 5.4 Worker substrate decision

Preserve CRT's separation between a durable account-import lifecycle and generic imported-game job/task processing. They solve different claim shapes:

- account import owns streamed provider windows/checkpoints and provider cooldown semantics;
- per-game jobs own fair claiming of discrete imported-game tasks such as indexing/analysis.

They may run in the same `worker.ts` process and share generic cancellation/heartbeat utilities, but do not collapse them into one table merely for conceptual tidiness.

Future session/diagnosis runs should reuse generic claim/heartbeat/executor patterns where useful while retaining their own scope/version/result ownership. Do not overload a per-game `JobTask` with an account-wide diagnosis merely because a worker already exists.

### 5.5 Durable handoffs

Workflow chaining must be recoverable from database state, not dependent on an in-memory callback completing.

Examples:

- successful/enriched import makes a game eligible for current-version indexing;
- successful indexing makes the game eligible for engine analysis and replay source reads;
- successful engine analysis makes engine-dependent detector families eligible;
- completion/version change of per-game evidence makes account/session diagnosis stale/eligible for recalculation.

The implementation may use explicit enqueued tasks, an outbox/handoff table, or an idempotent reconciler. The invariant is that process death between step A and step B cannot permanently lose the handoff.

### 5.6 Eligibility and coverage gates

Standard Phase 2/3 game eligibility starts with:

- provider = Lichess;
- standard chess variant;
- supported standard speeds = bullet, blitz, rapid;
- reconstructable game/moves for indexing;
- explicit status for any excluded/nonstandard game.

Timing findings additionally require the clock completeness/reliability defined by issue #4. Missing clocks do not make the game globally unusable for engine/opening evidence; they make clock-required modalities unavailable.

Engine findings require completed compatible engine analysis. Unanalysed positions/games are excluded from the engine denominator rather than treated as no error.

Board-geometry findings require reconstructable positions. Session findings require versioned chronological/session context.

A diagnosis family declares its required modalities and calculates coverage from eligible versus available evidence under that family, matching `docs/diagnostic-taxonomy.md`.

---

## 6. Typed interfaces between layers

Names below are conceptual and may become TypeScript interfaces, application DTOs, repository read models, or package contracts depending on whether they cross a process/HTTP boundary.

### 6.1 Credential boundary

```text
ConnectedLichessCredential
  appUserId
  lichessUserId
  lichessUsername
  accessToken                 # backend-only, never wire-serializable
  connection status/provenance
```

Only Lichess/provider infrastructure consumes the secret-bearing form.

### 6.2 Provider normalization boundary

```text
NormalizedImportedGameSource
  provider identity/game facts
  exact time-control facts + provenance
  PGN/moves/opening/source facts
  rawClockSequence
  rawClockSequencePresence
```

The durable import lifecycle consumes this normalized representation and must not expose the raw Lichess DTO downstream.

### 6.3 Source evidence read boundary

```text
ImportedGameSourceFacts
  game/source metadata
  exact control
  reconstruction source
  raw clock completeness/provenance

RawClockSequence
  ordered source states
```

Ply indexing/timing consumes persisted source reads, not the provider executor's in-memory object.

### 6.4 Per-ply evidence boundary

```text
PlyEvidence
  game/ply identity
  before/after position identity
  move
  aligned source clock reference/value?
  timing derivation?
  timing reliability/version
  engine evidence? + engine coverage/version
  later detector evidence references
```

This is the main provider-neutral input boundary for replay and later deterministic detector/aggregation work.

### 6.5 Position analysis boundary

```text
PositionAnalysisEvidence
  normalized position identity
  engine/config policy version
  evaluation/mate representation
  best move / reusable lines where retained
```

Game-specific score loss/classification is not smuggled into this reusable cache contract.

### 6.6 Deterministic evidence boundary

Detector families should expose typed outputs, for example:

```text
DetectedEvidenceEvent<TKind>
  kind
  game/ply/position source refs
  detectorVersion
  mechanismConfidence
  typed measurements/details
  required-modality coverage state
```

The diagnosis layer consumes stable detector/evidence query interfaces, not detector persistence tables directly.

### 6.7 Cross-game evidence query boundary

Aggregation services need bounded query methods that return only required dimensions/measurements, e.g. conceptual operations such as:

```text
queryMoveQualityByClockState(scope, policyVersions)
queryExactTimeControlPerformance(scope)
queryTacticalEvents(scope, detectorVersion)
queryOpeningRecurrence(scope, policyVersion)
querySessionContext(scope, sessionizationVersion)
```

These are examples of ownership, not a prescribed API. The key is SQL/bounded-query aggregation and typed outputs rather than loading an account's complete object graph into Node and improvising joins.

### 6.8 Diagnosis boundary

```text
DiagnosticFindingDraft
  registered diagnosisId/level
  scope
  sample + coverage
  observed/baseline/effect measurements
  strength/confidence
  caveats/confounders
  evidence references
  proposed registered relationships
```

Ranking/synthesis validates and persists drafts under the taxonomy/aggregation policy version. Optional future explanation consumes the persisted bounded finding context; it cannot create or mutate authoritative evidence.

### 6.9 Replay/read-model boundary

```text
ImportedGameReplay
  safe game provenance
  exact time control
  ordered plies
    move/positions
    source clock state?
    derived timing/reliability?
    engine evidence/status?
    evidence annotations?
  coverage/status metadata
```

The board receives annotations as data. Chessground/Angular components do not run timing or diagnosis policy.

---

## 7. Initial dependency graph and PR boundaries

Do not start multiple branches that independently define the same foundational schema or evidence contract. The initial implementation wave is intentionally serialized until the source/per-ply boundary is stable.

```text
#8  Phase 1 implementation architecture (this document)
 |
 v
#9  Bootstrap workspace + CI/architecture guardrails
 |
 v
#10 Auth + authoritative Lichess OAuth connection
 |
 v
#11 Durable clock-complete Lichess source ingestion
 |
 v
#12 Ply indexing + raw-clock alignment + timing facts + position identity
 |\
 | \
 v  v
#13 #14
Stockfish    Evidence read model + replay foundation
analysis     (engine fields optional/coverage-aware)
```

### 7.1 Issue #9 — bootstrap workspace and guardrails

Owns only the executable monorepo/process/package skeleton, Prisma wiring, CI, and architecture checks. It must not pre-decide product schemas that belong to later issues.

Why it is first: every later issue needs a common compilable/testable home and guardrails before substantial CRT code is adapted.

### 7.2 Issue #10 — auth and authoritative Lichess connection

Owns app-user identity, Lichess OAuth/PKCE, encrypted token lifecycle, one active connection, and the backend credential seam.

Why it precedes import: issue #4 makes the connected OAuth identity an import precondition; building import first would invite arbitrary/public-account semantics or a temporary anonymous fallback that the product explicitly rejects.

### 7.3 Issue #11 — durable clock-complete source ingestion

Owns the import lifecycle and the initial imported-game/raw-clock source schema. This is deliberately one coherent PR boundary because run/window semantics, idempotent provider commits, and atomic clock preservation must agree on the same persistence contract.

It must not add ply/timing-derived fields merely for convenience.

### 7.4 Issue #12 — ply/timing/position preparation

Owns the first derived game schema: legal ply reconstruction, normalized positions, raw-clock alignment, and timing derivation/version/reliability.

Why it is serialized after #11: it consumes the raw-source contract and is the shared dependency for both engine analysis and user-facing replay. Parallel branches before this point would likely redefine `ImportedGamePly`, source clock semantics, or position identity independently.

### 7.5 Issue #13 — cache-first Stockfish analysis

After #12, engine work can proceed independently against stable `Position`/`PlyEvidence` identities. It owns reusable `PositionAnalysis`, game-analysis runs, and game-specific score-loss/classification.

### 7.6 Issue #14 — evidence read model and replay foundation

After #12, read-model/UI work can proceed in parallel with #13 because source/ply/timing semantics are stable. Engine fields are optional and coverage-aware until #13 lands; #14 may not duplicate engine analysis or mutate the source contract to satisfy UI convenience.

### 7.7 Merge/integration rule for #13 and #14

Either may merge first if it remains contract-compatible with #12. After both merge, perform an integration pass that verifies:

- replay can display source/timing evidence for indexed games;
- engine evidence/status appears when available without changing source semantics;
- bullet games traverse import -> index -> analysis/replay eligibility;
- missing clocks and missing engine coverage remain independent explicit states.

### 7.8 What is deliberately not created yet

Do not create the full Phase 3–5 backlog now.

The next issues after the first wave should be based on implemented/stable evidence interfaces and will likely cover bounded families such as:

- deterministic tactical/geometry evidence;
- phase/endgame/conversion evidence;
- opening/recurring-position evidence;
- sessionization and timing/context aggregation;
- diagnosis aggregation/relationship/ranking;
- diagnosis UI.

Their exact PR boundaries should be chosen after #12/#13 expose real interfaces and costs. This avoids speculative schema ownership and satisfies the repository rule against generating dozens of premature tasks.

---

## 8. Validation and architecture guardrails

### 8.1 Workspace/CI baseline

As soon as the workspace exists, CI should run the checks the repository actually owns:

- install/lockfile consistency;
- TypeScript build/typecheck;
- unit tests;
- lint;
- Prisma schema validation and migration checks appropriate to the environment;
- contract schema tests;
- architecture/repository hygiene checks.

Do not copy CRT audits for omitted mobile/course/repertoire features.

### 8.2 Architecture checks

Add executable checks or lint/import rules for at least:

- `packages/chess-domain` cannot import Prisma, Fastify, Angular, provider clients, or application modules;
- `packages/contracts` cannot import Prisma models;
- `diagnosis` cannot import Lichess provider adapter/DTO modules;
- deterministic `evidence`/`diagnosis` code cannot depend on an AI provider;
- `apps/web` cannot import backend/Prisma modules;
- provider adapters cannot import diagnosis/UI modules;
- position-analysis cache code cannot depend on game timing/session modules.

Directory existence can gate checks during bootstrap so the rule does not require placeholder code.

### 8.3 Clock-bearing fixtures

Issue #11/#12 must introduce version-controlled Lichess fixtures or equivalent captured provider records that cover at minimum:

- normal ordered clock sequence;
- no clock sequence;
- zero increment;
- bullet game;
- invalid clock item/sequence;
- legitimate extra terminal active-player clock state;
- game-ending move where increment handling differs;
- provider auth failure and rate limiting;
- truncated/interrupted NDJSON stream;
- a case exercising re-import clock enrichment.

Fixtures must assert the round trip:

```text
provider value
  -> normalized source value
  -> durable raw clock state
  -> safe alignment where applicable
  -> replay/source evidence read
```

No fixture should encode first-move think time as if it were derivable from nominal initial time.

### 8.4 Migration/data integrity tests

For each schema-owning issue, test the relevant invariants:

- identity/provider uniqueness;
- provider game idempotency;
- raw clock ordinal uniqueness;
- atomic/enrichment behavior for source games/clocks;
- complete versus failed ply indexing state;
- normalized position collision verification;
- analysis-run freshness/concurrency;
- finding relationship target integrity when diagnosis persistence arrives.

### 8.5 Worker failure tests

Adapt CRT's persistent-worker discipline:

- claim fencing prevents stale workers from committing after lease loss/cancellation;
- heartbeats/stale recovery are tested;
- retries are idempotent;
- cancellation reaches provider streams/Stockfish through `AbortSignal` where applicable;
- graceful shutdown is bounded and disconnects the worker's Prisma client;
- process death between durable pipeline stages can be reconciled/resumed without manual row repair.

### 8.6 Coverage tests

Deterministic finding work must test that missing required modality lowers coverage/strength rather than producing a negative finding:

- unanalysed engine game != no engine mistake;
- missing clock game != normal clock behavior;
- unreconstructable ply != no tactical motif;
- missing session context != early-session baseline;
- partial detector coverage remains visible in finding denominators.

---

## 9. Concurrency and consistency rules

1. **Source enrichment is monotonic.** Re-import can improve incomplete source evidence but cannot silently downgrade valid raw clocks/time-control facts.
2. **Derived writes are version/freshness checked.** Stale indexing/analysis/detector runs cannot overwrite newer compatible output.
3. **Do not join entire history in memory by default.** Cross-game evidence services use bounded SQL-side filtering/aggregation or explicit safety limits, following CRT Opening Struggles/Profile discipline.
4. **One module owns a transaction.** Cross-feature orchestration calls owned service/repository operations instead of sharing Prisma transaction details across unrelated modules unless a documented atomic boundary requires it.
5. **Read models tolerate independent modality completion.** A game can be indexed with timing unavailable, engine analysis pending, or detectors partially complete without corrupting source evidence.
6. **Version changes make derived data stale, not source data invalid.** A new timing/engine/detector/sessionization policy schedules/recomputes affected derived output; it does not require Lichess re-import unless source facts were genuinely absent and provider enrichment is requested.

---

## 10. API/read-model policy

- Endpoint contracts are added after actual consumers and service outputs are understood, following CRT's `packages/contracts` discipline.
- List endpoints remain lean; replay/detail endpoints may return ordered plies/evidence but should not include raw clock source rows that are not needed by the consumer.
- Raw source clock sequence stays available through backend evidence/debug/audit reads even when the normal replay projection only returns aligned source values plus terminal-state/anomaly metadata.
- API schemas expose null/unavailable/reliability/coverage explicitly.
- No endpoint returns OAuth tokens or provider-secret material.
- Diagnosis responses expose the actual observed/baseline/effect metrics, denominators, coverage, evidence strength, caveats/confounders, and supporting evidence required by the taxonomy.
- A future AI explanation endpoint receives a bounded finding context; it cannot accept arbitrary provider/database access as part of explanation generation.

---

## 11. Phase 1 closure check

`PLAN.md` Phase 1 and issue #1 require the project to leave planning with the major diagnosis evidence requirements, data/pipeline/module boundaries, CRT reuse deltas, and an executable next dependency graph.

| Phase 1 requirement | Canonical source after #8 |
| --- | --- |
| CRT reusable building blocks vs product deltas | `docs/crt-delta-map.md` (#2) |
| Diagnostic taxonomy / evidence / strength / coverage / relationships | `docs/diagnostic-taxonomy.md` (#3) |
| Clock-complete authenticated Lichess source/timing contract | `docs/lichess-ingestion-and-timing.md` + CRT appendix (#4) |
| Workspace/module/interface ownership | this document (#8) |
| Conceptual data model and source-vs-derived boundaries | this document + issue #4 source contract (#8/#4) |
| Analysis pipeline / worker boundaries | this document + CRT delta map (#8/#2) |
| Future shared-library seams | CRT delta map + this document (#2/#8) |
| Deterministic-vs-AI boundary | Bible, diagnostic taxonomy, CRT delta map, this document |
| Dependency graph / first implementation PR boundaries | this document; issues #9–#14 |
| Validation/architecture guardrails | this document; executable work starts in #9 |

### Closure decision

After issue #8 is accepted, there is **no remaining foundational Phase 1 blocker** that requires another planning issue before implementation can begin.

The following are intentionally implementation/calibration details, not Phase 1 blockers:

- exact Prisma table/column names and SQL index choices;
- final route names;
- Stockfish depth/cost policy;
- calibration-sensitive detector thresholds;
- exact session gap threshold;
- later ranking weights;
- later AI explanation design;
- providers beyond Lichess.

Issue #1 can close when #8 is merged. Phase 2 should begin with #9 and proceed through the dependency graph above.

If implementation uncovers a contradiction with the accepted source/taxonomy contracts, create a focused design correction issue rather than silently changing semantics inside an implementation PR.

---

## 12. Implementation-agent checklist

Before implementing any issue in the graph:

1. read `AGENTS.md`, `BIBLE.md`, `PLAN.md`, this document, and the active issue;
2. read the corresponding CRT files/tests at the pinned baseline, then re-check current CRT if a materially newer behavior matters;
3. confirm Reference / Preserve / Change / Omit / Future seam in the PR description;
4. branch from current `main` and avoid overlapping an active shared-schema/contract PR;
5. keep source facts immutable and derived output versioned;
6. add tests/fixtures with the behavior;
7. update canonical docs only when architecture/semantics genuinely change;
8. open a PR, run available validation, resolve review findings, and squash-merge only when accepted;
9. after shared-contract merges, verify downstream issue assumptions before continuing parallel work.
