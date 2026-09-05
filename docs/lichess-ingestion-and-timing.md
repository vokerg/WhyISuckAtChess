# Lichess ingestion and timing data contract

**Status:** Phase 1 canonical specification  
**Scope:** issue #4  
**Parent:** issue #1  
**Depends on:** `BIBLE.md`, `PLAN.md`, `docs/crt-delta-map.md`, `docs/diagnostic-taxonomy.md`  
**CRT reference baseline:** `vokerg/chess_repertoir_trainer` at commit `13a7e2791944ebd52113afe9f76413b10634ddff`  
**Provider contract reference:** Lichess API specification as reviewed 2026-09-05

## 1. Purpose

Why I Suck at Chess needs timing evidence to diagnose clock management, exact time-control effects, played-too-fast behavior, opponent move-speed effects, and timing interactions with chess mistakes. That evidence is only trustworthy if ingestion preserves the provider facts before any derived timing feature is calculated.

This document defines the canonical Phase 1 contract for:

- the authoritative connected Lichess identity;
- clock-complete account-game export;
- exact time-control source evidence;
- lossless per-ply provider clocks;
- durable import and indexing ownership;
- timing derivation semantics and failure states;
- bullet analysis eligibility;
- timing evidence exposed to analysis, diagnostics, and replay UI.

It is deliberately a data and behavior contract, not a Prisma schema or importer implementation. Exact field and model names may change during implementation, but no implementation may weaken the source-data guarantees defined here.

## 2. Non-negotiable decisions

1. **The connected OAuth Lichess identity is authoritative.** One application user maps to one connected Lichess identity in the initial product. A normal import never silently becomes an anonymous/public-account import.
2. **Every account-game export request asks Lichess for clocks explicitly.** For NDJSON export this means `clocks=true`.
3. **Lichess clock samples are source facts.** They are retained as provider-supplied centisecond integers and are never replaced by calculated think times.
4. **Clock samples are durable before later indexing/analysis jobs run.** A successful import may not depend on reparsing or re-fetching historical Lichess data to recover clocks it already received.
5. **Every available provider clock sample is addressable by ply ordinal.** Successful ply indexing exposes the same source sample on the corresponding ply without changing its value or unit.
6. **Exact time control is independent from speed classification.** Initial time, increment, raw control notation, and broad speed are separate facts.
7. **Timing derivation is versioned and nullable.** Missing or inconsistent source evidence yields an explicit unavailable/unreliable result; it is never filled with zero, guessed, or silently clamped.
8. **Decision-time pressure uses the clock before a move, not merely the post-move clock.** Where reliable, that value is reconstructed from the same player's preceding source clock or from the initial clock for that player's first move.
9. **Clock-delta “think time” is not wall-clock latency.** It represents time deducted by the Lichess clock arithmetic, subject to Lichess lag compensation and provider behavior, and is therefore exposed as an approximate think-time feature.
10. **Bullet is a standard diagnostic source.** Standard bullet, blitz, and rapid games are eligible for indexing and analysis unless a later explicit policy excludes a specific analysis mode for a documented reason.

## 3. Provider semantics that this contract relies on

The current Lichess `GET /api/games/user/{username}` specification states that:

- the response may be streamed as NDJSON;
- `clocks` defaults to `false`;
- `clocks=true` includes clock status when available;
- in JSON, `clocks` is an array of **centisecond integers**;
- in PGN, the equivalent information appears as a clock comment after the corresponding move;
- `pgnInJson=true` includes the full PGN in each NDJSON object;
- authenticated requests are supported, and authenticated export of the connected user's own games receives the provider's higher own-game stream allowance.

The provider `GameJson` schema separately exposes a game-level `clock` object with `initial`, `increment`, and `totalTime`, plus the optional `clocks` array. CRT and Lichess examples treat `clock.initial` and `clock.increment` as seconds; this product normalizes those values to seconds while preserving provenance and raw time-control notation.

### 3.1 Clock sample meaning

For this contract, Lichess JSON `clocks[i]` is interpreted as the mover's **remaining clock after ply `i + 1`**, in centiseconds. This matches the provider's PGN representation, where clock status is attached after a move.

Implementation tests must pin this interpretation with real/official Lichess fixtures before timing-derived diagnostics are enabled. If provider behavior ever contradicts the pinned semantics, source values remain intact and the derivation version must stop treating affected samples as reliable until the adapter is updated.

## 4. CRT reference and intentional delta

CRT is the baseline implementation pattern, not the product contract. The following subsections use the required **Reference / Preserve / Change / Omit / Future seam** format.

### 4.1 Lichess OAuth, identity, and token lifecycle

**Reference**

- CRT `apps/api/src/services/lichessConnectionService.ts`.
- CRT `apps/api/src/routes/lichessAuth.ts`.
- CRT `apps/api/src/services/oauthTokenCrypto.ts`.
- CRT `packages/contracts/src/lichess/lichess.schemas.ts`.
- CRT Prisma models/migrations for `LichessConnection`, `OAuthLoginState`, `ExternalAccount`, and `AppUser`.
- CRT tests `apps/api/test/auth/lichess-oauth-flow.test.mjs` and `apps/api/test/auth/oauth-token-crypto.test.mjs`.

**Preserve**

- OAuth authorization-code flow with PKCE.
- Short-lived one-time state.
- Resolve the Lichess account from the authenticated token after callback rather than trusting a username supplied by the browser.
- Encrypt access tokens at rest with authenticated encryption.
- Keep token material out of HTTP response contracts.
- Best-effort upstream revoke followed by authoritative local disconnect.
- Keep provider identity separate from the internal application-user ID.

**Change**

- The `LichessConnection` for the application user is the only normal import identity. The import account ID/username must be derived from that connection, not from an arbitrary tracked public username.
- A missing, revoked, expired, or undecryptable credential makes authenticated import unavailable. It must not downgrade to anonymous export.
- CRT currently forces puzzle scopes (`puzzle:read`, `puzzle:write`) because of its broader product. Why does not inherit those scopes. The current Lichess API specifications for `GET /api/account` and account-game export require OAuth authentication but declare no endpoint-specific OAuth scopes; therefore the initial Why connection should request no unrelated broad scopes. If Lichess later requires a scope for these endpoints, add only that minimum scope and document the change.

**Omit**

- Multiple Lichess identities per application user in the initial product.
- Chess.com or provider-selection flows.
- Anonymous public-account import as a normal fallback.
- CRT puzzle scopes and puzzle workflows.

**Future seam**

- A narrow credential/identity adapter should expose the connected Lichess user ID, username, and usable access token to the importer. Diagnostic code must never consume OAuth storage directly.

### 4.2 Lichess export request and provider DTO

**Reference**

- CRT `apps/api/src/modules/account-imports/providers/lichess/lichess-account-import.ts`.
- CRT `apps/api/src/modules/account-imports/providers/lichess/lichess-account-import.executor.ts`.
- CRT `apps/api/src/modules/account-imports/account-import.types.ts`.
- Lichess API `doc/specs/tags/games/api-games-user-username.yaml`.
- Lichess API `doc/specs/schemas/GameJson.yaml`.

**Preserve**

- NDJSON streaming rather than buffering a full account history.
- Half-open internal import windows, with CRT's `until = window.to - 1 ms` conversion at the provider boundary.
- Explicit `since`, `until`, `perfType`, `finished=true`, stable sort direction, `pgnInJson=true`, and `opening=true` behavior.
- Scope filtering after parsing as a defensive second check.
- Malformed-record handling that distinguishes provider parse failure from transport/rate-limit failure.
- Provider DTO parsing before normalization.

**Change**

- Every export request adds `clocks=true`.
- Every normal export request includes `Authorization: Bearer <connected token>`. Absence of a usable credential is a connection/import error before the provider request is made.
- The provider DTO's existing `clocks?: number[]` field is carried through normalization instead of being dropped.
- Clock arrays are validated as arrays of finite, non-negative safe integers. Invalid samples are recorded as a timing-source anomaly; they are not coerced.
- Preserve enough provider time-control provenance to know whether exact initial/increment values came from the JSON `clock` object or PGN `TimeControl` fallback.

**Omit**

- The legacy synchronous `lichessImportService.ts` as a second source of import semantics.
- `evals=true` as part of ingestion; engine evidence is owned by Why's own versioned analysis pipeline.
- Provider-specific clock interpretation outside the Lichess adapter.

**Future seam**

- The Lichess adapter emits a normalized game plus normalized source clock samples. Durable import/persistence code must not know Lichess JSON field names.

### 4.3 Durable import, retries, windows, and deduplication

**Reference**

- CRT `apps/api/src/modules/account-imports/providers/lichess/lichess-account-import.executor.ts`.
- CRT `apps/api/src/modules/account-imports/account-import.provider-commit.repository.prisma.ts`.
- CRT `apps/api/src/modules/account-imports/account-import.lifecycle.repository.prisma.ts`.
- CRT `apps/api/src/modules/account-imports/account-import.repository.prisma.ts`.
- CRT `apps/api/src/modules/jobs/job-worker.service.ts` and `job-worker.repository.prisma.ts`.
- CRT tests under `apps/api/test/account-imports/` and `apps/api/test/jobs/`.

**Preserve**

- Persisted immutable scope/range, scope hash, window plan, checkpoints, contiguous coverage, bounded batches, exact counters, cancellation, claim fencing, heartbeats, stale recovery, and idempotent retry behavior.
- `429` handling with provider cooldown/retry time.
- Bounded database writes inside durable worker execution.
- Provider game identity as the deduplication key within an owned account/provider boundary.

**Change**

- A batch commit is not clock-complete if it inserts the game row but discards clock samples. Game source facts and the received clock sequence must become durable in the same logical commit.
- Duplicate imports must not erase or downgrade existing clock-complete data. A later import that contains valid clocks for an earlier clock-incomplete row may enrich that same provider game idempotently; it must not create a second game.
- Import completeness and timing completeness are distinct states. A provider window can be fully imported while individual games legitimately have unavailable clock data; coverage metrics must expose that distinction.

**Omit**

- Job kinds unrelated to imported-game evidence/analysis.
- Any retry strategy that replays an unbounded history in memory.

**Future seam**

- Keep generic durable-run mechanics separate from provider fetch/normalization and from timing derivation. A future provider can reuse run mechanics without adopting Lichess clock semantics.

### 4.4 Imported-game persistence and ply indexing

**Reference**

- CRT `apps/api/prisma/schema.prisma`, especially `ImportedGame`, `ImportedGamePly`, `Position`, and analysis-run models.
- CRT `apps/api/src/modules/account-imports/account-import.provider-commit.repository.prisma.ts`.
- CRT `apps/api/src/modules/imported-games/ply-index.service.ts`.
- CRT `apps/api/src/modules/imported-games/ply-index.repository.prisma.ts`.
- CRT `apps/api/src/modules/imported-games/imported-game-index-workflow.service.ts`.
- CRT `packages/contracts/src/imported-games/imported-games.schemas.ts`.

**Preserve**

- One imported-game record per owned provider game.
- Separate game-level metadata from one-row-per-ply evidence.
- PGN reconstruction with chess.js into ordered plies, before-position identity, and UCI move.
- Transactional replace/index behavior and visible index failure.
- Position normalization/caching separately from game-specific evidence.

**Change**

- CRT's normalized game currently carries exact time-control fields but no clocks; its `ImportedGamePly` indexing rows contain position/move identity but no source clock. Why adds a durable source-clock sequence and a per-ply clock association.
- Clock samples must be persisted at import time even though ply indexing is a later job. The implementation may use a child source-clock table keyed by `(importedGameId, plyNumber)`, a lossless game-level source sequence plus transactional projection into plies, or an equivalent design. It may **not** hold clocks only in worker memory until indexing.
- After successful indexing, every reconstructed ply for which Lichess supplied a valid sample must expose the exact same centisecond source value.
- Exact time-control source fields remain on the game; timing derivations remain separate from both game source facts and ply source facts.

**Omit**

- Re-fetching Lichess merely to reconstruct source clocks already received previously.
- Opaque provider-payload storage as the primary timing model. A narrow raw/debug payload may be added later if justified, but typed source facts remain canonical.

**Future seam**

- A provider-neutral `ImportedGameFacts` / `PlyEvidence` read boundary should combine game metadata, move/position identity, and timing source facts for analysis without leaking persistence layout.

### 4.5 Analysis eligibility and story/diagnostic consumers

**Reference**

- CRT `apps/api/src/modules/imported-games/imported-game-workflow-eligibility.ts`.
- CRT `apps/api/src/modules/imported-games/imported-game-processing.service.ts`.
- CRT `apps/api/src/modules/analysis/imported-game-analysis.service.ts` and execution service.
- CRT `apps/api/src/modules/imported-games/game-tagging.service.ts` and `game-tags.ts`.
- Why `docs/diagnostic-taxonomy.md`.

**Preserve**

- Eligibility is an explicit policy rather than an accidental query filter.
- Engine analysis remains separate from timing feature extraction.
- Story tags/facets may summarize a game, but structured evidence remains the diagnostic authority.
- Missing required modality coverage produces insufficient evidence rather than a negative finding.

**Change**

- CRT's `STANDARD_IMPORTED_GAME_SPEEDS = ['blitz', 'rapid']` is not inherited. Why's standard real-time diagnostic set includes `bullet`, `blitz`, and `rapid`.
- `TIME_SCRAMBLE`, `MUTUAL_TIME_SCRAMBLE`, `PLAYED_TOO_FAST`, or equivalent story facets may only be emitted from persisted source clocks and versioned timing derivations.
- Timing conditions join engine/tactical/opening/endgame/session evidence only in dedicated evidence/diagnostic layers.

**Omit**

- Any inference that a missing clock means normal timing behavior.
- Psychological claims from timing alone.

**Future seam**

- A versioned `TimingFeatureExtractor` consumes immutable game/ply source facts and emits derived timing facts. Diagnostic detectors consume those facts without knowing Lichess or Prisma details.

## 5. Canonical authenticated import contract

### 5.1 Preconditions

A normal Lichess import run may start only when all are true:

- an authenticated application user exists;
- that user has exactly one active connected Lichess identity in the initial model;
- the connection has an encrypted access token that can be decrypted;
- the token is not locally revoked or known expired;
- the account ID and username selected for import match the connected Lichess identity.

If any condition fails, return a stable connection/import error and require reconnect/reauthorization as appropriate. Do not make an unauthenticated request.

A provider `401`/`403` marks the credential unusable for the run and should surface a reconnect-required state rather than being retried as an anonymous import.

### 5.2 Required account-game request

The durable adapter follows CRT's windowing/scope behavior and sends, at minimum:

```text
GET /api/games/user/{connectedUsername}
Accept: application/x-ndjson
Authorization: Bearer <connected access token>

since=<window start epoch ms>
until=<inclusive provider end epoch ms>
perfType=<requested standard speeds>
finished=true
sort=dateAsc|dateDesc (according to durable mode)
pgnInJson=true
opening=true
clocks=true
rated=<optional scope filter>
```

`moves` and `tags` may rely on provider defaults only if contract tests pin those defaults. Prefer explicit parameters where doing so makes the source contract more robust.

### 5.3 Provider-response validation

For each accepted game:

- provider game ID is required;
- rated/variant/speed/perf/timestamps/status follow the CRT parser's required-field discipline;
- moves/PGN must be sufficient for later standard-game ply reconstruction or the indexing state must expose failure;
- `clock.initial` / `clock.increment`, when present, must be finite non-negative integers;
- `clocks`, when present, must remain ordered exactly as received;
- each valid clock sample must be a finite non-negative safe integer and remain in centiseconds;
- a missing `clocks` field is legitimate source absence, not an empty clock sequence unless the provider explicitly returned an empty array.

Provider anomalies are recorded without manufacturing corrected source facts.

## 6. Canonical source-data model

The names below are conceptual. Implementations may map them to Prisma fields/relations differently.

### 6.1 Imported game source facts

An imported game must retain concepts equivalent to:

```text
ImportedGameSourceFacts
  provider = LICHESS
  providerGameId
  providerUrl
  connectedLichessUserId
  connectedLichessUsername

  startedAt
  endedAt
  rated
  variant
  speedCategory              // bullet/blitz/rapid/... classification
  perfCategory               // provider classification if retained separately

  timeControlRaw             // e.g. "180+2"; source/provider notation
  initialTimeSeconds         // e.g. 180
  incrementSeconds           // e.g. 2; zero is different from null
  timeControlSource          // LICHESS_CLOCK_OBJECT | PGN_TIME_CONTROL | UNKNOWN

  white identity/rating
  black identity/rating
  userColor
  result/status
  opening metadata
  PGN/move reconstruction source

  clockSequencePresence      // PRESENT | ABSENT | INVALID/PARTIAL
  clockSampleCount
  clockUnit = CENTISECONDS   // when samples exist
  clockSemantics = POST_MOVE_REMAINING
  timingSourceAnomalies[]
```

Important rules:

- `initialTimeSeconds = 0` is not the same as unknown; the same applies to increment.
- `incrementSeconds = 0` is authoritative no-increment evidence and must not be stored as null.
- broad `speedCategory` may be recomputed/classified later; it never replaces exact initial/increment values.
- `timeControlRaw` is retained even if it cannot be parsed into standard initial/increment values.
- the connection identity is provenance for ownership/import, not a replacement for the actual white/black player facts on the game.

### 6.2 Source clock samples

Every valid provider clock sample must be durably representable as:

```text
PlyClockSourceFact
  importedGameId
  plyNumber                  // 1-based; source array index + 1
  sourceOrdinal              // same ordering as provider sequence
  provider = LICHESS
  valueCentiseconds          // exact integer from provider
  semantics = POST_MOVE_REMAINING
```

The source fact is immutable except for a deliberate provider-source repair/reimport policy. Timing derivation must never update `valueCentiseconds`.

If the implementation stores source samples in a child relation before ply indexing, successful indexing must make the same value available in the `ImportedGamePly` evidence projection. If the implementation stores the value directly on an already-created ply row, the import/index workflow must still guarantee durability before the run claims clock-complete success.

### 6.3 Alignment and completeness

Let `moveCount` be the number of reconstructed plies and `clockSampleCount` the provider clock sequence length.

- `clockSampleCount == moveCount`: clock-sequence coverage is complete for the reconstructed game, subject to sample validation.
- `0 < clockSampleCount < moveCount`: preserve every available leading sample and mark clock coverage partial. Do not synthesize missing tail values.
- `clockSampleCount == 0` with an explicitly returned empty array: preserve that distinction from a missing field if useful for provider diagnostics; no ply has clock evidence.
- `clockSampleCount > moveCount`: preserve all source samples in the durable source sequence, mark a provider/alignment anomaly, and do not expose extra samples as invented plies. Timing-derived diagnostics for the game are unavailable until a versioned policy explicitly handles the anomaly.
- PGN reconstruction failure does not delete source clock samples. It blocks ply-aligned timing features and exposes board-reconstruction failure separately.

This rule is why clock samples must survive independently of the later ply-index job.

## 7. Exact time-control evidence

### 7.1 Source precedence

For Lichess real-time games:

1. prefer a valid provider JSON `clock` object for normalized initial/increment seconds;
2. preserve/construct a raw exact control representation from those values;
3. if the JSON object is absent, parse PGN `TimeControl` only when it is a supported simple `initial+increment` form;
4. otherwise keep the raw notation and set normalized values to unknown rather than guessing.

If valid JSON and PGN values disagree, retain the JSON-derived normalized values as the primary provider source, preserve enough raw PGN evidence for debugging, record `TIME_CONTROL_SOURCE_MISMATCH`, and suppress timing derivations whose correctness depends on the disputed value until policy explicitly resolves it.

### 7.2 Required comparison dimensions

The model must support exact grouping and comparisons such as:

- `60+0` (1+0) versus `60+1` (1+1);
- `180+0` (3+0) versus `180+2` (3+2);
- `300+0` (5+0) versus `300+3` (5+3);
- increment present (`incrementSeconds > 0`) versus no increment (`incrementSeconds == 0`);
- exact initial-time groups independent of increment;
- exact increment-size groups independent of initial time;
- broad speed as a separate stratification dimension.

A canonical display key such as `3+2` may be derived from normalized seconds when both are known, but storage/comparison logic must not depend only on the display string.

## 8. Derived timing model

Derived timing facts are computed from source clocks; they do not replace them.

A derived timing record should expose concepts equivalent to:

```text
PlyTimingDerived
  importedGameId
  plyNumber
  derivationVersion

  clockBeforeMoveCentiseconds?
  clockAfterMoveCentiseconds?       // copied/read from source for convenience, still identified as source
  clockConsumedCentiseconds?
  approximateThinkTimeCentiseconds?

  beforeClockProvenance             // INITIAL | PREVIOUS_SAME_SIDE_SOURCE_CLOCK | UNAVAILABLE
  derivationStatus                  // RELIABLE | UNAVAILABLE | INCONSISTENT | UNSUPPORTED_CONTROL
  unavailableReason?
```

Additional features such as pressure bands, fast-move flags, opening-time usage, or session aggregates belong to downstream versioned feature/detector outputs, not to source clock storage.

### 8.1 Remaining clock after a move

For ply `p`, when the source sample exists:

```text
clockAfterMoveCentiseconds(p) = sourceClockSample(p)
```

No arithmetic is needed. This remains authoritative provider evidence.

### 8.2 Remaining clock before a move

For a standard real-time game and mover color `c`:

- if `p` is not that color's first move and the previous same-color ply (`p - 2`) has a source clock, then:

```text
clockBeforeMoveCentiseconds(p) = clockAfterMoveCentiseconds(p - 2)
```

- for that color's first move, `clockBeforeMoveCentiseconds` may be derived as `initialTimeSeconds * 100` only when the game's initial clock applies symmetrically and no known provider/game mode invalidates that assumption.

The `beforeClockProvenance` field makes the first-move assumption inspectable.

### 8.3 Increment-aware clock consumption / approximate think time

For a supported standard Fischer-increment game with known increment and reliable before/after values:

```text
incrementCentiseconds = incrementSeconds * 100
clockConsumedCentiseconds =
  clockBeforeMoveCentiseconds
  + incrementCentiseconds
  - clockAfterMoveCentiseconds
```

This is the amount of time deducted by the provider clock equation for the move. For supported Lichess games it is the product's best approximate think-time feature:

```text
approximateThinkTimeCentiseconds = clockConsumedCentiseconds
```

However, the UI/API must not present it as exact wall-clock latency. Online clock behavior can include lag compensation and other provider mechanics.

### 8.4 Invalid arithmetic

Never clamp a negative result to zero merely to make a feature look plausible.

If the equation produces a materially negative value, or another invariant is violated:

- keep all source clock values unchanged;
- set the derived value to null;
- mark `derivationStatus = INCONSISTENT`;
- record a stable reason such as `NEGATIVE_CLOCK_CONSUMPTION`;
- exclude that ply from derived-time denominators that require reliable think time.

A future derivation version may define a narrowly justified tolerance for provider rounding, but that tolerance must be explicit, tested, and versioned.

### 8.5 Missing clock chain

A missing post-move source clock has a local and next-turn effect:

- that ply has no `clockAfterMove` and therefore no think-time derivation;
- the same player's following move cannot derive its `clockBeforeMove` from the missing prior sample;
- once a later valid sample exists, it becomes the previous-source anchor for that player's subsequent move and reliable derivation can resume.

Do not interpolate between clock samples.

## 9. Edge cases and safe failure semantics

### 9.1 First moves

First-move think time is allowed only if the initial clock is known and is valid for that player under the game mode. Its provenance must be `INITIAL`.

If Lichess introduces or reports asymmetric start-time modifiers, berserk-style behavior, handicap clocks, or another mode where the game-level initial clock cannot prove the player's actual start clock, first-move think time is unavailable unless the provider adapter captures a player-specific authoritative starting value.

### 9.2 Increment handling

- `incrementSeconds == 0` is a known no-increment control and the formula reduces to `before - after`.
- `incrementSeconds == null` means unknown; do not assume zero.
- Think-time arithmetic requires the increment that actually applies to the move. If provider evidence indicates a non-Fischer or asymmetric rule that the derivation version does not model, mark the move/game unsupported.

### 9.3 Correspondence and nonstandard controls

Correspondence, unlimited, from-position/variant clock rules, or other controls whose timing semantics do not match the standard real-time clock equation may still be imported as source games if product scope later allows them, but this Phase 1 timing derivation contract does not infer per-move think time from them.

For the initial diagnostic path, standard chess bullet/blitz/rapid are the supported real-time categories. Variant support is a separate future decision.

### 9.4 Missing provider clocks

Some historical/provider games legitimately have no clock sequence. Such games remain valid for diagnoses that do not require clocks, provided their other evidence is valid.

Clock-dependent findings must:

- count the game in `eligibleGames` only according to the finding's scope definition;
- separately expose `clockCompleteGames`/clock coverage;
- exclude missing-clock plies from clock-derived event denominators;
- become `INSUFFICIENT` under the taxonomy's coverage rules rather than treating missing data as normal timing.

### 9.5 Provider inconsistency/anomaly vocabulary

The implementation should expose stable machine-readable anomalies equivalent to:

- `CLOCKS_ABSENT`
- `CLOCK_SAMPLE_INVALID`
- `CLOCK_SAMPLE_COUNT_SHORT`
- `CLOCK_SAMPLE_COUNT_LONG`
- `TIME_CONTROL_MISSING`
- `TIME_CONTROL_UNPARSEABLE`
- `TIME_CONTROL_SOURCE_MISMATCH`
- `PGN_RECONSTRUCTION_FAILED`
- `UNSUPPORTED_CLOCK_SEMANTICS`
- `NEGATIVE_CLOCK_CONSUMPTION`

Names may change, but consumers must be able to distinguish these failure classes from a normal zero/fast clock value.

## 10. Timing feature semantics for diagnostics

The timing extractor supplies measurements. Detectors/aggregators decide thresholds and comparisons under their own versions.

### 10.1 Time pressure (`TIME-001`, `TIME-002`)

Decision-time pressure should use `clockBeforeMoveCentiseconds` because it represents the time available when choosing the move.

Threshold policies may combine:

- absolute remaining time (for example below 10s/20s/30s);
- remaining time as a fraction of initial time;
- time-control-specific thresholds;
- exact-control stratification.

A finding must name the threshold/policy version and expose clock coverage.

### 10.2 Played too fast (`TIME-003`)

A played-too-fast candidate requires at least:

- reliable approximate think time for the move;
- reliable clock-before-move showing sufficient available time;
- comparable position/game context under a versioned policy;
- downstream move-quality or mechanism evidence when the claim includes worse outcomes.

An “instant move” threshold is a derived policy, not a source fact.

### 10.3 Early time overuse (`TIME-004`, `OPEN-004`)

Compute time expenditure over a bounded opening/early phase from reliable per-ply clock consumption. Relate it to later time-pressure and move-quality outcomes only in a detector/aggregator with explicit denominators.

Do not infer early overuse solely from the game-end clock.

### 10.4 Exact control and increment effects (`TIME-005`, `TIME-006`)

These diagnoses consume game-level `initialTimeSeconds` and `incrementSeconds`, with speed kept as a separate covariate. Comparisons must follow `docs/diagnostic-taxonomy.md` sample, coverage, weaker-arm, baseline, and confounder rules.

### 10.5 Opponent move speed (`TIME-007`)

For an opponent move at ply `p`, opponent approximate think time is derived from the opponent's own clock chain, not from the user's clock and not from `startedAt`/`endedAt` gaps.

The user's response at ply `p + 1` may then be compared with:

- the opponent's immediately preceding reliable move time;
- sequences of consecutive unusually fast opponent moves;
- the user's own response time and move quality;
- opening phase and exact time control.

“Opponent blitzing” is a versioned sequence feature; provider clocks remain the underlying evidence.

### 10.6 Timing around chess mechanisms

Tactical, hanging-piece, threat-blindness, conversion, endgame, and engine-loss evidence may join to timing by `importedGameId` + `plyNumber`.

The timing contract must therefore make the following available for any evidence ply where reliable:

- source post-move clock;
- derived pre-move clock;
- derived approximate think time;
- derivation status/version;
- exact game time control;
- user/opponent color identity.

This enables questions such as whether tactical misses rise below 20 seconds or whether conversion failures follow unusually fast decisions without making the timing layer own chess classification.

### 10.7 Game phase

Timing-by-phase consumes a separately versioned phase classification (opening/middlegame/endgame or a later richer phase model) and the per-ply timing facts. Neither subsystem should infer the other's policy.

### 10.8 Session deterioration

Sessionization consumes game timestamps and produces session identity/ordinal under its own version. Timing deterioration across sessions may aggregate:

- median/mean reliable approximate think time;
- fast-move frequency;
- time-pressure exposure;
- early-time-use patterns;
- interaction with tactical/move-quality errors.

The timing extractor does not infer fatigue or tilt. Session diagnoses retain the taxonomy's correlational wording.

## 11. Analysis eligibility and coverage

### 11.1 Standard-game policy

Initial standard analysis eligibility is:

```text
variant: standard chess
speed: bullet | blitz | rapid
```

Bullet must pass through:

```text
import
  -> persistence
  -> ply indexing
  -> position/engine analysis policy
  -> timing extraction
  -> deterministic chess detectors
  -> diagnostic aggregation
```

If a later engine-cost policy uses a different depth/profile for bullet, that is an explicit analysis-profile decision; it is not exclusion from diagnosis.

### 11.2 Modality-specific coverage

For every timing-dependent finding expose, at minimum:

- eligible games;
- included games;
- games with exact usable time control;
- games with any clock source data;
- clock-complete games;
- eligible relevant plies/events;
- plies/events with reliable before/after timing derivation;
- exclusions grouped by anomaly/unavailable reason.

Apply the coverage/evidence-strength rules in `docs/diagnostic-taxonomy.md`. Missing clock evidence cannot count as absence of a timing problem.

## 12. API and contract exposure

### 12.1 Internal analysis read model

A bounded game/ply evidence read used by analysis should expose concepts equivalent to:

```text
GameEvidence
  importedGameId
  providerGameId
  exact time-control source fields
  speed / variant / user color
  timestamps / ratings / result / opening metadata
  timingSourceCoverage
  plies[]
    plyNumber
    move / before-and-after position identity
    sourceClockAfterCentiseconds?
    timingDerived?
      clockBeforeMoveCentiseconds?
      approximateThinkTimeCentiseconds?
      status
      version
```

Consumers must be able to request only the bounded projection they need.

### 12.2 Game/replay HTTP contract

The game detail/replay experience should be able to show:

- exact control (initial + increment) and broad speed;
- whether clock evidence is complete/partial/unavailable;
- source post-move clock for each ply when available;
- derived pre-move/approximate think-time values with explicit nullability;
- timing derivation status/version where needed for debugging/evidence explanation;
- diagnosis/story annotations as separate fields.

The API should serialize display-friendly seconds/milliseconds only as derived views. It must not lose the canonical source centisecond integer.

### 12.3 Diagnostic finding contract

Findings defined in `docs/diagnostic-taxonomy.md` can reference timing evidence by game/ply ID and carry:

- clock/timing derivation version;
- threshold/detector version;
- exact time-control scope;
- clock coverage denominator;
- representative games/plies.

A finding never needs OAuth/provider transport details.

## 13. Provenance and versioning

Source evidence and derived evidence have different version requirements.

### 13.1 Source provenance

Retain enough metadata to identify:

- provider (`LICHESS`);
- provider game ID;
- connected account identity used for import;
- clock unit/semantics;
- time-control source (`clock` object vs PGN fallback);
- import run/source adapter version if needed to diagnose historical normalization changes.

Provider source values themselves are not versioned calculations.

### 13.2 Derived provenance

Any persisted/reused timing derivation whose semantics may change must include a derivation version. A version bump is required when changing, for example:

- first-move eligibility;
- increment arithmetic;
- anomaly tolerance;
- supported clock modes;
- provider-semantics interpretation.

Threshold-based findings such as “under time pressure” or “played too fast” also carry their detector/policy version separately from the timing derivation version.

## 14. Idempotency and enrichment rules

Provider-game identity remains the idempotency anchor.

On re-import of the same provider game:

- identical source facts are a no-op;
- a previously missing clock sequence may be enriched with newly available valid provider clocks;
- valid existing source clocks must not be overwritten by missing/shorter evidence from a later response;
- conflicting non-null source clocks/time-control values must record an anomaly and follow an explicit repair policy rather than silently choosing the latest response;
- derived timing records affected by newly enriched/repaired source data must be invalidated/recomputed under their derivation version.

This extends CRT's `skipDuplicates` behavior: Why needs idempotent source enrichment, not only duplicate counting, because clock completeness is a product invariant.

## 15. Required implementation tests

Implementation issues derived from this spec must cover at least the following.

### 15.1 Authentication and request construction

- connected identity is resolved from OAuth connection;
- missing/revoked/expired/undecryptable token blocks import;
- no anonymous fallback request is made;
- request has `Authorization` and `Accept: application/x-ndjson`;
- request includes `clocks=true`;
- request preserves CRT window/rated/perf/sort/PGN/opening behavior.

### 15.2 Provider normalization

- `clocks` values remain exact centisecond integers and order is unchanged;
- missing field differs from present values;
- invalid values create explicit anomalies and are not coerced;
- exact initial/increment values remain separate from speed;
- JSON-clock versus PGN fallback provenance is represented;
- `increment=0` remains zero, not null.

### 15.3 Persistence and indexing

- clocks are durable in the same logical import commit as the game;
- retry/deduplication does not create a second game or lose source clocks;
- clock enrichment of a prior clock-incomplete duplicate is idempotent;
- exact source samples map to corresponding ply numbers;
- shorter/longer arrays produce partial/anomalous coverage without invented values;
- PGN/index failure does not delete imported clock source evidence.

### 15.4 Timing arithmetic

Use fixed fixtures for:

- 1+0, 1+1, 3+0, 3+2, 5+0, and 5+3;
- first white and first black move from initial clock;
- later same-side moves using `p - 2` source clock;
- increment addition in the clock-consumption equation;
- zero increment;
- missing current sample;
- missing previous same-side sample and later recovery;
- negative/inconsistent arithmetic with no clamping;
- unknown increment;
- unsupported/correspondence control.

### 15.5 Eligibility and downstream evidence

- bullet is accepted by standard indexing/analysis eligibility;
- clock-dependent findings receive clock coverage and timing version data;
- non-clock diagnoses can still use games with missing clocks;
- replay/detail contracts expose source clock separately from derived timing;
- source clocks cannot be overwritten by a timing feature write.

## 16. Implementation boundaries suggested by this contract

This planning issue intentionally does not implement the importer. Follow-up implementation can be split safely along these boundaries after shared schema/contracts are agreed:

1. **Connection/import admission adaptation** — authoritative connected identity, mandatory token, no anonymous fallback, minimal scopes.
2. **Provider adapter adaptation** — `clocks=true`, DTO validation, normalized source clock sequence/time-control provenance.
3. **Schema and provider-commit migration** — durable source-clock samples, timing completeness/anomaly state, idempotent enrichment.
4. **Ply-index adaptation** — source sample alignment/exposure on per-ply evidence; bullet eligibility.
5. **Timing feature extractor** — versioned before-clock and increment-aware approximate think-time derivation.
6. **Contracts/read models** — bounded game/ply timing evidence for analysis and replay.
7. **Timing detector/aggregation work** — thresholds, played-too-fast, opponent speed, exact-control comparisons, session interactions.

Schema/provider-commit and normalized provider contracts are shared dependencies; avoid parallel branches that independently redefine them.

## 17. Acceptance-criteria traceability

| Issue #4 acceptance criterion | Contract decision |
| --- | --- |
| CRT behavior referenced concretely | Section 4 names the exact CRT modules/tests and the copied/adapted behavior. |
| Preserve/Change/Omit/Future seam explicit | Each CRT subsystem in section 4 uses that format. |
| Per-ply clocks are end-to-end invariant | Sections 2, 6, and 14 require lossless durable source samples before indexing and exact per-ply mapping afterward. |
| Exact controls and increment comparisons supported | Sections 6–7 preserve initial seconds, increment seconds, raw notation, and speed independently. |
| Source clocks not replaced by think time | Sections 6 and 8 separate immutable source facts from versioned derivations. |
| Timing semantics/edge cases defined | Sections 8–9 define post-move clocks, before-move reconstruction, increment arithmetic, missing chains, first moves, unsupported controls, and anomalies. |
| Bullet reflected | Section 11 makes standard bullet a first-class analysis source. |
| #3 consumers receive timing evidence | Sections 10–12 map timing facts to TIME-001..007, OPEN-004, chess mechanisms, phase, session, findings, and replay. |
| Durable decisions committed | This document is the canonical Phase 1 timing/ingestion specification. |

## 18. Final invariant

The decisive implementation rule is:

```text
Lichess authoritative connection
  -> authenticated clock-complete NDJSON export
  -> normalized exact time control + ordered source clock samples
  -> durable game + source clock persistence
  -> ply-aligned immutable source clocks
  -> versioned timing derivation
  -> engine/chess/session joins
  -> bounded diagnostic evidence
  -> replay/explanation
```

No arrow may discard provider clock evidence, collapse exact control into a broad speed label, substitute a derived value for a source fact, or treat missing timing evidence as normal behavior.
