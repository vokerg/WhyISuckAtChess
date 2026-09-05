# Lichess ingestion and timing data contract

**Status:** Phase 1 canonical specification  
**Scope:** issue #4  
**Parent:** issue #1  
**Depends on:** `BIBLE.md`, `PLAN.md`, `docs/crt-delta-map.md`, `docs/diagnostic-taxonomy.md`  
**CRT reference baseline:** `vokerg/chess_repertoir_trainer` at commit `13a7e2791944ebd52113afe9f76413b10634ddff`  
**Provider API reference:** `lichess-org/api` game-export specification as reviewed 2026-09-05  
**Provider implementation cross-check:** `lichess-org/lila` game export/clock-history implementation as reviewed 2026-09-05

## 1. Purpose

Why I Suck at Chess needs timing evidence to diagnose clock management, exact time-control effects, played-too-fast behavior, opponent move-speed effects, and interactions between timing and chess mistakes. That evidence is only trustworthy if ingestion preserves provider facts before any timing feature is derived.

This document defines the canonical Phase 1 contract for:

- the authoritative connected Lichess identity;
- authenticated clock-complete account-game export;
- exact time-control source evidence;
- lossless Lichess clock-state preservation;
- safe clock-state-to-ply alignment;
- timing derivation semantics and failure states;
- bullet analysis eligibility;
- timing evidence exposed to analysis, diagnostics, and replay UI.

It is a data/behavior contract, not a Prisma schema. Exact model and field names may change during implementation, but no implementation may weaken the source-data guarantees below.

## 2. Non-negotiable decisions

1. **The connected OAuth Lichess identity is authoritative.** One application user maps to one connected Lichess identity initially. Normal import never silently becomes an anonymous/public-account import.
2. **Every account-game export asks for clocks explicitly.** For NDJSON this means `clocks=true`.
3. **Provider clock values are immutable source facts.** Preserve every value exactly as returned, in provider order and provider units.
4. **Clock evidence is durable during import.** A successful import may not rely on re-fetching historical Lichess data later to recover clocks that were already received.
5. **Raw clock-state preservation and ply alignment are separate concerns.** Do not destroy a source value merely because it cannot yet be mapped safely to a ply.
6. **Exact time control is independent from broad speed.** Initial time, increment, provider/raw notation, and broad speed remain distinct.
7. **Derived timing never replaces source clocks.** Before-clock, move-time, pressure, and fast-play features are versioned nullable derivations.
8. **First-move think time is unavailable from the account-export clock sequence alone.** Do not infer it by subtracting the first post-move clock from the nominal initial clock.
9. **A clock-state sequence may legitimately contain one non-ply terminal state.** A longer sequence is not automatically corruption.
10. **Final-move increment semantics matter.** Lichess may omit the increment when the game ends directly on the move; derivation must account for that instead of adding increment blindly.
11. **Clock-delta move time is approximate.** Lichess lag compensation, player-specific clock modifiers, and out-of-band clock adjustments can make it differ from wall-clock thinking time.
12. **Bullet is a first-class diagnostic source.** Standard bullet, blitz, and rapid are eligible for indexing/analysis unless a later explicit policy documents a narrower analysis profile.

## 3. Provider semantics this contract relies on

### 3.1 Public API contract

The current Lichess `GET /api/games/user/{username}` specification states that:

- NDJSON streaming is supported;
- `clocks` defaults to `false`;
- `clocks=true` includes clock status when available;
- JSON `clocks` values are **centisecond integers**;
- PGN clock comments represent clock state after moves;
- `pgnInJson=true` embeds the PGN in each NDJSON record;
- a game-level `clock` object exposes `initial`, `increment`, and `totalTime` integers.

The Lichess examples and implementation use seconds for `clock.initial` and `clock.increment`; Why normalizes those values to seconds while preserving their source/provenance.

### 3.2 Lichess server implementation cross-check

The current Lichess server implementation is useful because the API schema alone does not fully explain edge cases:

- `modules/api/src/main/GameApiV2.scala` serializes JSON `clocks` from `game.bothClockStates`.
- `modules/core/src/main/game/data.scala` defines clock history as per-color vectors and interleaves them starting with the game start color.
- `modules/game/src/main/Game.scala` records the mover's remaining clock after a move.
- The same file records an additional active-player clock state when a game finishes asynchronously during that player's turn.
- `GameExt.computeMoveTimes` explicitly prepends a zero placeholder for each color's first move rather than deriving first-move time from the nominal initial clock.
- `GameExt.computeMoveTimes` also handles the case where the final move ends the game and no increment is applied to that final stored clock state.

These implementation facts tighten the safe derivation policy below. They do **not** justify copying Lichess internals into the product; source values remain provider facts and derivation stays versioned.

### 3.3 Meaning of move-aligned clock states

For a clock state that has been safely aligned to ply `p`, the value represents the mover's remaining Lichess clock **after that ply**, in centiseconds.

The raw `clocks` array is therefore retained first as an ordered provider sequence. A later alignment step determines which values correspond to plies and whether an extra terminal state exists.

## 4. CRT reference and intentional delta

CRT is the baseline implementation pattern, not the product contract. Each subsection uses the repository-required **Reference / Preserve / Change / Omit / Future seam** format.

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
- Resolve account identity from the authenticated token after callback rather than trusting a browser-supplied username.
- Encrypt access tokens at rest with authenticated encryption.
- Never expose token material in API contracts.
- Best-effort upstream revoke followed by authoritative local disconnect.
- Keep provider identity separate from internal application-user ID.

**Change**

- The user's `LichessConnection` is the only normal import identity.
- Import account ID/username is derived from that connection, not from an arbitrary tracked public username.
- Missing, revoked, expired, or undecryptable credentials make import unavailable; they never trigger anonymous fallback.
- CRT's puzzle scopes are unrelated to Why. The currently reviewed Lichess account/game-export API declarations require OAuth but declare no endpoint-specific scope, so Why should request no unrelated broad scopes. If Lichess later requires a scope, add only the minimum required scope and document it.

**Omit**

- Multiple Lichess identities per application user initially.
- Chess.com/provider-selection flows.
- Anonymous public-account import as a normal path.
- CRT puzzle scopes/workflows.

**Future seam**

- A narrow credential/identity adapter exposes connected Lichess user ID, username, and usable token to the importer. Diagnostics never read OAuth storage.

### 4.2 Lichess export request and provider DTO

**Reference**

- CRT `apps/api/src/modules/account-imports/providers/lichess/lichess-account-import.ts`.
- CRT `apps/api/src/modules/account-imports/providers/lichess/lichess-account-import.executor.ts`.
- CRT `apps/api/src/modules/account-imports/account-import.types.ts`.
- Lichess API game-export and `GameJson` schemas.

**Preserve**

- Stream NDJSON rather than buffering account history.
- CRT half-open internal windows with provider `until = window.to - 1 ms` conversion.
- Explicit `since`, `until`, `perfType`, `finished=true`, stable sort, `pgnInJson=true`, and `opening=true` behavior.
- Defensive post-parse scope filtering.
- Malformed-record handling distinct from transport/rate-limit failures.
- Provider DTO parsing before normalization.

**Change**

- Every export request adds `clocks=true`.
- Every normal export request includes `Authorization: Bearer <connected token>`.
- The provider DTO's existing `clocks?: number[]` is preserved through normalization instead of dropped.
- Preserve provider `source`/game-origin metadata where supplied because timing rules can differ by game context.
- Validate clock arrays as ordered finite non-negative safe integers without coercion.
- Preserve enough time-control provenance to distinguish JSON `clock` values from PGN `TimeControl` fallback.

**Omit**

- Legacy synchronous `lichessImportService.ts` as a second semantics source.
- `evals=true` during ingestion; Why owns engine evidence separately.
- Provider-specific clock interpretation outside the Lichess adapter/alignment boundary.

**Future seam**

- The adapter emits normalized game source facts plus an ordered raw Lichess clock-state sequence. Durable import code does not depend on Lichess field names.

### 4.3 Durable import, retries, windows, and deduplication

**Reference**

- CRT durable Lichess account-import executor.
- CRT account-import provider-commit/lifecycle repositories.
- CRT account-import repository.
- CRT job-worker service/repository.
- CRT account-import/job tests.

**Preserve**

- Immutable persisted scope/range, scope hash, window plan, checkpoints, contiguous coverage, bounded writes, counters, cancellation, claim fencing, heartbeat/stale recovery, and retry behavior.
- Provider cooldown handling for `429`.
- Provider game identity as the idempotency key within the owned account/provider boundary.

**Change**

- A batch commit is not clock-preserving if it stores the game but discards the received clock-state sequence.
- Game facts and raw clock states become durable in the same logical import commit.
- Re-import may enrich a previously clock-incomplete game, but must never downgrade valid existing clock evidence or create a duplicate game.
- Import-window completeness and per-game timing completeness are separate metrics.

**Omit**

- Unrelated job kinds.
- Retry strategies that require unbounded in-memory history.

**Future seam**

- Durable-run mechanics remain separate from provider fetch/normalization, clock alignment, and timing derivation.

### 4.4 Imported-game persistence and ply indexing

**Reference**

- CRT `apps/api/prisma/schema.prisma` models `ImportedGame`, `ImportedGamePly`, `Position`, and analysis runs.
- CRT provider-commit repository.
- CRT `ply-index.service.ts` / repository.
- CRT imported-game index/processing workflows.
- CRT imported-game contracts.

**Preserve**

- One owned imported-game record per provider game.
- Separate game metadata from one-row-per-ply evidence.
- PGN reconstruction to ordered plies with move and position identity.
- Transactional ply replacement/indexing with visible failure.
- Position identity/cache independent from game-specific timing evidence.

**Change**

- CRT currently preserves exact time-control fields but drops the `clocks` array and has no ply clock source field. Why preserves the entire raw sequence at import time.
- Ply indexing consumes the durable source sequence; it does not depend on importer worker memory.
- Per-ply clock evidence is a projection of safely aligned source states, not a destructive replacement of the raw sequence.
- Legitimate non-ply terminal source states remain queryable as game-end timing evidence.

**Omit**

- Re-fetching Lichess just to recover clocks already received.
- Opaque full provider payload as the only timing store. A debug payload may exist, but typed source facts are canonical.

**Future seam**

- Provider-neutral `ImportedGameFacts` / `PlyEvidence` reads combine game, move/position, source clock, and derivation data without leaking storage layout.

### 4.5 Analysis eligibility and timing consumers

**Reference**

- CRT imported-game workflow eligibility/processing.
- CRT imported-game analysis service/execution.
- CRT game tagging.
- Why `docs/diagnostic-taxonomy.md`.

**Preserve**

- Eligibility is explicit policy.
- Engine analysis is separate from timing extraction.
- Story facets may summarize; structured evidence remains authoritative.
- Missing required modality yields insufficient evidence, not a negative finding.

**Change**

- Do not inherit CRT's `STANDARD_IMPORTED_GAME_SPEEDS = ['blitz', 'rapid']`; Why includes standard `bullet`, `blitz`, and `rapid`.
- Clock story facets such as time scramble / played too fast require persisted source clocks plus versioned timing derivations.
- Timing joins tactical/opening/endgame/session evidence only in bounded evidence/diagnostic layers.

**Omit**

- Treating missing clocks as normal timing.
- Psychological claims from timing alone.

**Future seam**

- A versioned `TimingFeatureExtractor` consumes immutable source/alignment facts and produces nullable derived timing facts.

## 5. Canonical authenticated import contract

### 5.1 Preconditions

A normal import may start only when:

- an authenticated application user exists;
- exactly one active connected Lichess identity exists for that user initially;
- its encrypted token can be decrypted;
- the token is not locally revoked/known expired;
- the imported Lichess ID/username matches the connected identity.

If a precondition fails, return a stable reconnect/import error. Do not make an anonymous provider request.

Provider `401`/`403` makes the credential unusable for the run and surfaces reconnect-required state; it must not be retried anonymously.

### 5.2 Required export request

At minimum:

```text
GET /api/games/user/{connectedUsername}
Accept: application/x-ndjson
Authorization: Bearer <connected token>

since=<window start epoch ms>
until=<inclusive provider end epoch ms>
perfType=<requested standard speeds>
finished=true
sort=dateAsc|dateDesc
pgnInJson=true
opening=true
clocks=true
rated=<optional scope filter>
```

`moves` and `tags` may rely on provider defaults only if contract tests pin those defaults; explicit parameters are preferred where practical.

### 5.3 Provider record validation

For accepted games:

- provider game ID is required;
- core CRT-required fields keep the same parser discipline;
- PGN/moves must support later standard-game reconstruction or indexing must expose failure;
- `clock.initial` and `clock.increment`, when present, are finite non-negative integers;
- `clocks`, when present, remain in exact provider order;
- each clock value is a finite non-negative safe integer in centiseconds;
- missing `clocks` differs from an explicitly empty sequence;
- invalid clock items are not coerced into source facts.

## 6. Canonical source-data ownership

Names below are conceptual.

### 6.1 Imported game source facts

Persist concepts equivalent to:

```text
ImportedGameSourceFacts
  provider = LICHESS
  providerGameId
  providerUrl
  connectedLichessUserId
  connectedLichessUsername
  providerSource                 // e.g. provider game origin when supplied

  startedAt
  endedAt
  rated
  variant
  speedCategory
  perfCategory

  pgnTimeControlRaw?             // exact PGN source text when present
  initialTimeSeconds?            // normalized authoritative value
  incrementSeconds?              // zero != null
  timeControlSource              // LICHESS_CLOCK_OBJECT | PGN_TIME_CONTROL | UNKNOWN
  exactControlKey?               // derived display/group key, e.g. 180+2 / 3+2

  white/black identities + ratings
  userColor
  result
  status
  opening metadata
  PGN/move reconstruction source

  rawClockSequencePresence       // PRESENT | ABSENT | INVALID
  rawClockStateCount
  clockUnit = CENTISECONDS       // when valid values exist
  timingSourceAnomalies[]
```

Rules:

- `incrementSeconds = 0` is authoritative no-increment evidence, never null.
- Do not call a constructed display key “raw”; raw provider/PGN notation and normalized values are separate.
- `speedCategory` is classification, not a substitute for exact initial/increment.
- Preserve provider source/game-origin metadata needed to interpret possible clock modifiers/adjustments.

### 6.2 Raw Lichess clock-state source sequence

Every valid provider value is durably representable as:

```text
LichessClockSourceState
  importedGameId
  sourceOrdinal                // 1-based provider order
  valueCentiseconds            // exact provider integer
  provider = LICHESS
```

This sequence is immutable source evidence. It does **not** claim every ordinal is a ply.

### 6.3 Ply-aligned clock source facts

Alignment creates a projection such as:

```text
PlyClockSourceFact
  importedGameId
  plyNumber
  sourceOrdinal
  valueCentiseconds
  semantics = POST_MOVE_REMAINING
  alignmentVersion
```

A legitimate terminal state can instead be represented as:

```text
TerminalClockSourceFact
  importedGameId
  sourceOrdinal
  activeColor
  valueCentiseconds
  semantics = TERMINAL_ACTIVE_TURN_REMAINING
  alignmentVersion
```

Neither projection mutates the raw sequence.

## 7. Clock-state alignment and completeness

Let `moveCount` be reconstructed plies and `clockCount` valid raw source states.

### 7.1 Complete move-aligned sequence

When `clockCount == moveCount` and provider/game semantics are otherwise supported:

```text
source ordinal 1 -> ply 1
source ordinal 2 -> ply 2
...
source ordinal N -> ply N
```

Each aligned state is the mover's post-move remaining clock.

### 7.2 Legitimate terminal extra state

Current Lichess server behavior can append the active player's current clock when a finished game ends asynchronously during that player's turn (for example, a mid-turn termination rather than a move that itself ends the game). The JSON export serializes the interleaved clock history.

Therefore `clockCount == moveCount + 1` is **not automatically an anomaly**.

When status/source semantics and fixtures confirm the Lichess terminal-state case:

- ordinals `1..moveCount` align to plies `1..moveCount`;
- ordinal `moveCount + 1` is a terminal active-turn state, not an invented ply;
- move-level timing coverage can still be complete;
- the terminal state may support separate game-end/flag timing evidence.

If the extra state cannot be classified safely, retain it raw and mark alignment unsupported rather than deleting it.

### 7.3 Short or otherwise irregular sequences

A shorter sequence must never be padded/interpolated. Because the provider array contains values but no explicit ply numbers, partial alignment requires a pinned provider rule/fixture proving which plies those values represent.

Until such a rule exists:

- preserve all raw states;
- mark move alignment partial/unavailable;
- do not assume an arbitrary missing value is at the tail, head, or middle;
- do not emit clock-derived negative evidence for unaligned plies.

`clockCount > moveCount + 1` or another impossible shape is retained raw and marked anomalous.

PGN reconstruction failure never deletes raw clock states; it blocks ply-aligned timing until reconstruction succeeds.

## 8. Exact time-control evidence

### 8.1 Source precedence

For supported Lichess real-time games:

1. prefer a valid JSON `clock` object for normalized `initialTimeSeconds` / `incrementSeconds`;
2. retain PGN `TimeControl` raw text independently when present;
3. if JSON `clock` is absent, parse PGN `TimeControl` only for explicitly supported forms;
4. otherwise leave normalized fields unknown rather than guessing.

If valid JSON and PGN evidence disagree, retain both provenance sources, record a stable mismatch anomaly, and suppress derivations that depend on the disputed value until a versioned policy resolves it.

A derived display/group key such as `3+2` is allowed when normalized values are known, but it is not the raw provider value.

### 8.2 Required comparison dimensions

The model must support:

- 1+0 vs 1+1;
- 3+0 vs 3+2;
- 5+0 vs 5+3;
- increment present vs no increment;
- initial-time groups independent of increment;
- increment-size groups independent of initial time;
- broad speed as a separate dimension.

## 9. Derived timing model

Derived timing facts are nullable/versioned and never overwrite source values.

Conceptually:

```text
PlyTimingDerived
  importedGameId
  plyNumber
  derivationVersion

  clockBeforeMoveCentiseconds?
  sourceClockAfterMoveCentiseconds?
  effectiveIncrementCentiseconds?
  clockDeltaMoveTimeCentiseconds?

  beforeClockProvenance            // PREVIOUS_SAME_SIDE_SOURCE | UNAVAILABLE
  incrementProvenance              // GAME_CONTROL | FINAL_MOVE_NO_INCREMENT | UNAVAILABLE
  derivationStatus                 // AVAILABLE | UNAVAILABLE | INCONSISTENT | UNSUPPORTED
  reliabilityFlags[]
  unavailableReason?
```

Pressure bands, fast-move flags, phase aggregation, and session effects are downstream detector/feature outputs, not source fields.

### 9.1 Post-move remaining clock

For an aligned ply `p`:

```text
clockAfter(p) = alignedSourceClock(p)
```

No arithmetic is involved. This remains authoritative provider evidence.

### 9.2 Clock before a move

For a mover's non-first move, if the preceding same-color ply (`p - 2`) has an aligned source clock:

```text
clockBefore(p) = clockAfter(p - 2)
```

If that previous same-color source state is unavailable/unaligned, `clockBefore` is unavailable. Once a later aligned same-color source state exists, subsequent derivation may resume; never interpolate.

### 9.3 First-move semantics

Do **not** derive either player's first-move think time from:

```text
nominal initial clock - first post-move clock
```

Lichess itself does not derive move time this way: its current `computeMoveTimes` explicitly emits a zero placeholder for each color's first move because the clock history has no authoritative pre-first-move state and first-move/start behavior is special.

Therefore in Phase 1:

- game-level nominal `initialTimeSeconds` remains available as exact time-control evidence;
- the first move may still expose its authoritative post-move source clock;
- `clockBeforeMove` for the first move is null/unavailable for timing arithmetic;
- first-move approximate think time is null/unavailable;
- first moves are excluded from move-time denominators that require a reliable before-clock.

A later provider contract may change this only if it supplies an authoritative player-specific pre-first-move clock state.

### 9.4 Increment-aware move-time arithmetic

For a supported later move with known before/after clocks and known **effective** increment:

```text
clockDeltaMoveTime = clockBefore + effectiveIncrement - clockAfter
```

This is a Lichess-clock arithmetic feature, not exact wall-clock latency.

For ordinary non-final moves in a supported Fischer-increment game, effective increment is normally the game increment.

### 9.5 Final move that ends the game

Current Lichess move-time logic treats the final stored clock differently when the game ends directly on the move (for example mate/autodraw): the final move may be stored without the normal increment having been applied.

A derivation version must identify this provider case before applying arithmetic. When proven:

```text
effectiveIncrement(finalMove) = 0
```

Do not blindly add the configured game increment to every final ply.

The legitimate extra terminal-state case in section 7.2 is different: that extra state is not a move and receives no move-time derivation.

### 9.6 Player-specific modifiers such as arena berserk

Lichess can apply player-specific clock behavior. In particular, arena berserk can alter starting time and effective increment, while normal account-game JSON does not reliably expose a per-player berserk flag in the same way the tournament export can.

Consequences:

- raw source clocks remain fully usable;
- exact game-level nominal control remains source evidence;
- first-move think time is unavailable regardless;
- if a player-specific effective increment cannot be proven, increment-aware move-time derivation for affected moves is `UNSUPPORTED`/unavailable rather than guessed from the nominal game increment;
- provider `source`/arena metadata must remain available so such games can be identified and separately handled by a later version.

A zero-increment control is simpler because berserk cannot make the nominal zero increment positive, but other clock adjustments still require the caveats below.

### 9.7 Out-of-band clock adjustments

Lichess can support adding time in some game contexts. The account-game clock sequence is not a complete event log of every possible clock adjustment.

Therefore:

- a negative arithmetic result is an obvious inconsistency and must not be clamped;
- a positive result does **not** prove no external adjustment occurred;
- derived move time is always described as approximate clock-delta time;
- derivation should carry an adjustment-risk/reliability flag when the game context permits unobserved clock changes;
- detectors requiring high-confidence move time may restrict to game contexts where effective clock rules are known.

### 9.8 Invalid arithmetic

If arithmetic produces a materially negative result or violates a pinned invariant:

- preserve source clocks unchanged;
- set the derived move-time field null;
- mark `INCONSISTENT` with a stable reason;
- exclude the ply from denominators requiring valid move time.

Any rounding tolerance must be explicit, tested, and versioned.

## 10. Edge cases and anomaly vocabulary

### 10.1 Missing clocks

Games with no clock sequence remain valid for non-clock diagnoses if their other evidence is valid. Clock-dependent findings expose clock coverage and become insufficient under taxonomy rules rather than treating missing data as normal timing.

### 10.2 Correspondence/unlimited/nonstandard controls

Correspondence, unlimited, variants, asymmetric controls, or other unsupported clock modes may be imported as source facts, but Phase 1 does not derive standard per-move clock-delta time from them.

Initial diagnostic timing support is standard chess bullet/blitz/rapid with supported real-time clock semantics.

### 10.3 Stable anomaly/unavailability classes

Implementation should expose machine-readable reasons equivalent to:

- `CLOCKS_ABSENT`
- `CLOCK_SAMPLE_INVALID`
- `CLOCK_SEQUENCE_UNALIGNED`
- `CLOCK_SEQUENCE_TOO_LONG`
- `TERMINAL_CLOCK_STATE_UNCLASSIFIED`
- `TIME_CONTROL_MISSING`
- `TIME_CONTROL_UNPARSEABLE`
- `TIME_CONTROL_SOURCE_MISMATCH`
- `PGN_RECONSTRUCTION_FAILED`
- `FIRST_MOVE_BEFORE_CLOCK_UNAVAILABLE`
- `PLAYER_CLOCK_MODIFIER_UNRESOLVED`
- `UNSUPPORTED_CLOCK_SEMANTICS`
- `NEGATIVE_CLOCK_DELTA`
- `POSSIBLE_EXTERNAL_CLOCK_ADJUSTMENT`

Names may differ, but consumers must distinguish absence, unsupported semantics, anomaly, and valid zero values.

## 11. Timing features consumed by diagnostics

The timing extractor supplies measurements; detector/aggregation policies own thresholds and comparisons.

### 11.1 Time pressure (`TIME-001`, `TIME-002`)

Decision-time pressure uses `clockBeforeMoveCentiseconds`, not post-move clock. First moves without authoritative before-clock are excluded.

Policies may use:

- absolute remaining thresholds;
- fraction of nominal starting time;
- exact-control-specific thresholds;
- broad speed only as an additional dimension.

Findings expose the threshold/policy version and clock coverage.

### 11.2 Played too fast (`TIME-003`)

A played-too-fast candidate requires:

- available approximate clock-delta move time;
- available before-clock showing sufficient remaining time;
- supported clock semantics/reliability policy;
- comparable context;
- move-quality/mechanism evidence when the finding claims worse outcomes.

An instant-move cutoff is versioned detector policy, never a source fact.

### 11.3 Early time overuse (`TIME-004`, `OPEN-004`)

Aggregate only supported move-time derivations over a bounded early/opening phase, then relate them to later pressure/quality with explicit denominators. Do not infer early time use from end-of-game clock alone.

### 11.4 Exact control/increment effects (`TIME-005`, `TIME-006`)

These primarily consume game-level normalized initial/increment source evidence. They do not require per-move think-time derivation merely to compare 3+0 with 3+2 or increment vs no-increment.

Comparisons follow `docs/diagnostic-taxonomy.md` sample, weaker-arm, coverage, baseline, and confounder rules.

### 11.5 Opponent move speed (`TIME-007`)

Opponent move speed comes from the opponent's own supported clock chain. The user's response at the following ply may be compared with:

- the opponent's immediately preceding derived move time;
- sequences of unusually fast opponent moves;
- the user's own response time/quality;
- opening phase and exact control.

Do not estimate opponent move speed from total game timestamps.

### 11.6 Timing around chess mechanisms

Tactical, hanging-piece, threat-blindness, conversion, endgame, and engine-loss evidence can join timing by imported game + ply.

Where supported, expose:

- authoritative post-move source clock;
- derived pre-move clock;
- approximate clock-delta move time;
- derivation status/version/reliability flags;
- exact game time control;
- user/opponent color.

### 11.7 Phase and session deterioration

Game phase and sessionization are separately versioned evidence dimensions. Timing aggregation may examine pressure exposure, fast-move frequency, and supported move-time summaries by phase/session ordinal, but the timing layer does not infer fatigue, anger, or tilt.

## 12. Analysis eligibility and coverage

### 12.1 Standard-game policy

Initial standard diagnostic eligibility:

```text
variant: standard chess
speed: bullet | blitz | rapid
```

Bullet passes through:

```text
import
  -> source persistence
  -> ply indexing/alignment
  -> engine/position analysis
  -> timing extraction
  -> deterministic detectors
  -> diagnostic aggregation
```

A later cheaper engine profile for bullet is an explicit profile decision, not silent exclusion.

### 12.2 Modality-specific coverage

Every timing-dependent finding exposes at least:

- eligible games;
- included games;
- games with exact usable time control;
- games with any raw clock source data;
- games with fully aligned move clocks;
- games with an extra classified terminal clock state;
- relevant eligible plies/events;
- plies/events with supported before/after/move-time derivation;
- exclusions by stable reason.

Apply `docs/diagnostic-taxonomy.md` coverage/evidence-strength rules. Unobserved timing never counts as absence of a problem.

## 13. API and read contracts

### 13.1 Internal bounded evidence model

Conceptually:

```text
GameEvidence
  importedGameId
  providerGameId
  providerSource
  exact time-control source fields
  speed / variant / user color
  timestamps / ratings / result / opening
  timingSourceCoverage
  terminalClockState?
  plies[]
    plyNumber
    move / before-after position identity
    sourceClockAfterCentiseconds?
    timingDerived?
      clockBeforeMoveCentiseconds?
      clockDeltaMoveTimeCentiseconds?
      status
      version
      reliabilityFlags[]
```

Consumers request bounded projections; no diagnostic consumer needs OAuth transport details.

### 13.2 Game/replay HTTP contract

Replay/detail should expose:

- exact normalized control and broad speed;
- clock evidence state: complete/partial/unavailable/anomalous;
- post-move source clock per aligned ply;
- optional classified terminal clock state;
- nullable derived pre-move/move-time values;
- derivation status/version where useful;
- diagnosis/story annotations separately.

A UI may render seconds/milliseconds, but the canonical source centisecond integer is not discarded.

### 13.3 Diagnostic finding contract

Timing-backed findings carry/refer to:

- timing derivation version;
- threshold/detector version;
- exact-control scope;
- clock coverage denominator;
- representative game/ply evidence;
- reliability caveats when clock modifiers/adjustments limit interpretation.

## 14. Provenance, versioning, idempotency

### 14.1 Source provenance

Retain enough to identify:

- provider and game ID;
- connected identity used for import;
- provider game source/origin when supplied;
- clock unit;
- raw sequence ordinal/value;
- time-control source;
- import/source-adapter version when needed to diagnose historical normalization differences.

Provider values are source facts, not versioned calculations.

### 14.2 Derived provenance

Bump derivation version when changing, for example:

- clock-state alignment rules;
- terminal-state classification;
- first-move handling;
- final-move increment handling;
- player-specific modifier support;
- external-adjustment/reliability policy;
- rounding tolerance;
- supported control modes.

Threshold detectors carry their own version separately.

### 14.3 Re-import/enrichment

Provider game identity remains the idempotency anchor.

On re-import:

- identical source facts are a no-op;
- a previously absent sequence may be enriched with newly available valid source clocks;
- valid existing source clocks are never overwritten by missing/shorter later evidence;
- conflicting non-null source values record an anomaly and use an explicit repair policy rather than “latest wins”;
- alignment/derived records affected by enriched/repaired source facts are invalidated/recomputed.

This deliberately extends CRT's insert/`skipDuplicates` pattern: Why requires idempotent evidence enrichment, not duplicate counting alone.

## 15. Required implementation tests

### 15.1 Authentication/request

- connected identity comes from OAuth connection;
- missing/revoked/expired/undecryptable token blocks import;
- no anonymous fallback request;
- request includes Authorization, NDJSON Accept, and `clocks=true`;
- CRT window/rated/perf/sort/PGN/opening behavior retained.

### 15.2 Provider normalization

- exact centisecond values/order preserved;
- missing vs empty vs invalid sequence distinguished;
- provider `source` retained;
- initial/increment separate from speed;
- JSON-clock vs PGN fallback provenance retained;
- increment zero stays zero;
- raw PGN time-control text is not confused with a derived display key.

### 15.3 Persistence/alignment

- clocks become durable in the same logical import commit as the game;
- retry/dedup does not create duplicate games or lose clocks;
- enrichment is idempotent;
- `clockCount == moveCount` maps one-to-one;
- current Lichess `clockCount == moveCount + 1` async-terminal fixture maps first N states to plies and final state to terminal evidence;
- irregular/short sequences remain raw without invented alignment;
- PGN/index failure does not delete raw clocks.

### 15.4 Timing derivation

Fixed fixtures cover:

- 1+0, 1+1, 3+0, 3+2, 5+0, 5+3;
- first white/black moves expose post-move source clock but **no derived first-move time**;
- later same-side move uses `p - 2` source clock;
- normal increment arithmetic;
- zero increment;
- final move ending the game uses no increment when pinned Lichess semantics require it;
- extra terminal state receives no move-time derivation;
- missing previous same-side clock and later recovery;
- negative arithmetic is not clamped;
- unknown increment;
- arena/player-modifier case is unavailable unless effective increment is authoritative;
- correspondence/unsupported control;
- external clock adjustment risk is represented.

### 15.5 Eligibility/downstream contracts

- standard bullet is eligible for indexing/analysis;
- clock findings receive coverage + timing version/reliability data;
- non-clock diagnoses can still use games with missing clocks;
- replay exposes source clock separately from derived timing;
- derived writes cannot overwrite source clocks.

## 16. Implementation boundaries

Follow-up implementation can be split after shared contracts/schema are agreed:

1. **Connection/import admission** — authoritative identity, mandatory usable token, minimal scopes, no anonymous fallback.
2. **Provider adapter** — `clocks=true`, provider source, clock/time-control validation, raw sequence normalization.
3. **Schema/provider commit** — durable raw clock states, provenance/anomaly state, idempotent enrichment.
4. **Ply indexing/alignment** — raw-state-to-ply projection, terminal-state classification, bullet eligibility.
5. **Timing extractor** — versioned before-clock, effective-increment, final-move, modifier-risk, and approximate move-time rules.
6. **Contracts/read models** — bounded game/ply timing evidence for analysis/replay.
7. **Timing detectors/aggregation** — pressure, fast play, opponent speed, exact-control comparisons, phase/session interactions.

Schema/provider-commit and normalized provider contracts are shared dependencies; do not run parallel branches that independently redefine them.

## 17. Acceptance-criteria traceability

| Issue #4 acceptance criterion | Contract decision |
| --- | --- |
| CRT importer behavior referenced concretely | Section 4 names the CRT OAuth/import/persistence/indexing/eligibility surfaces and baseline behavior. |
| Preserve/Change/Omit/Future seam explicit | Every material CRT subsystem in section 4 uses that format. |
| Per-ply clocks are a hard end-to-end invariant | Sections 2, 6, and 7 preserve every provider clock state durably and expose every safely aligned move clock without discarding terminal/unmapped evidence. |
| Exact control / increment comparisons supported | Sections 6 and 8 keep initial seconds, increment seconds, raw/provider notation, and speed distinct. |
| Source clocks not replaced by think time | Sections 6 and 9 separate immutable source state from versioned derived timing. |
| Timing semantics / edge cases defined | Sections 7, 9, and 10 cover terminal states, first moves, final-move increment, missing alignment, modifiers, adjustments, unsupported controls, and anomalies. |
| Bullet reflected | Section 12 makes standard bullet first-class. |
| #3 consumers receive required timing evidence | Sections 11-13 map source/derived timing to TIME-001..007, OPEN-004, chess mechanisms, phase/session, replay, and finding contracts. |
| Durable decisions committed | This document is the canonical Phase 1 ingestion/timing specification. |

## 18. Final invariant

```text
Lichess authoritative connection
  -> authenticated clock-requesting NDJSON export
  -> normalized exact time control + raw ordered clock states
  -> durable game + raw clock-state persistence
  -> versioned safe ply/terminal alignment
  -> immutable per-ply post-move source clocks
  -> versioned nullable timing derivation
  -> engine/chess/session joins
  -> bounded diagnostic evidence
  -> replay/explanation
```

No arrow may discard provider clock evidence, pretend every raw clock state is necessarily a ply, fabricate first-move think time, add increment blindly to a game-ending move, collapse exact control into broad speed, substitute a derived value for source evidence, or treat missing/unsupported timing as normal behavior.
