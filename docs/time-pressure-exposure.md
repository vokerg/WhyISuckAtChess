# TIME-001 frequent time-pressure exposure

**Status:** Phase 4B implemented aggregate  
**Diagnosis:** `TIME-001 FREQUENT_TIME_PRESSURE`  
**Aggregate policy:** `time-pressure-exposure-v1`  
**Shared timing-behavior policy:** `time-behavior-v1`  
**Issue:** #59 under #56

## Purpose

`TIME-001` measures how often the player reaches the shared remaining-clock pressure bands and where the first observed pressure decision occurs.

It is deliberately **exposure evidence only**. It does not consume engine quality, does not claim that pressure caused worse play, and must not be described as panic, tilt, or deterioration. `TIME-002` owns the separate question of whether move quality is worse under pressure.

## Reference / Preserve / Change / Omit / Future seam

### Reference

The implementation follows the bounded player-profile aggregation pattern in CRT:

- `apps/api/src/modules/player-chess-profile/player-chess-profile.repository.prisma.ts` for ownership-scoped bounded reads and explicit grouped denominators;
- `apps/api/src/modules/player-chess-profile/player-chess-profile.metrics.ts` for deterministic one-decimal percentages and 5/15/40 evidence grades;
- `apps/api/src/modules/player-chess-profile/player-chess-profile.service.ts` for keeping persistence/query work outside pure metric construction.

### Preserve

- bounded owned-game reads over an explicit date/range scope;
- deterministic aggregation separated from Prisma;
- source-derived coverage rather than imputation;
- explicit sample denominators and evidence strength;
- no transport/UI coupling in the diagnosis module.

### Change

Why uses its authoritative per-ply Lichess timing projection rather than CRT game tags or summary accuracy:

- only standard timing-eligible games are eligible;
- only the current timing-derivation version is accepted;
- every derivable user decision in a game must have trustworthy current timing before that game contributes to game-level recurrence;
- remaining-clock bands come only from `time-behavior-v1`;
- exact initial/increment identity remains visible in the breakdown;
- current phase evidence is attached to the first pressure entry when the entry's before-position boundary is covered.

### Omit

- engine score loss, mistakes, blunders, or accuracy;
- a positive/negative "problem" threshold beyond the shared evidence-strength policy;
- diagnosis persistence/ranking;
- API/UI exposure;
- causal or psychological interpretation.

### Future seam

`TIME-002`, `TIME-004`, and `TIME-006` can consume the same pressure semantics and exact-control context without redefining the pressure bands or source-timing eligibility rules.

## Bounded source read

`getTimePressureExposure(appUserId, scope, repository)`:

1. validates `from < to`;
2. counts owned candidate games in the scope;
3. refuses scopes above 5,000 candidate games before loading the rows;
4. loads the same owned candidate population once;
5. fails closed if the candidate count changes during the read.

The Prisma repository selects only fields required by the aggregate plus user plies and current phase ranges. It never loads provider DTOs into diagnosis code.

## Timing eligibility

A candidate game is timing-eligible when the existing timing policy supports its variant and speed.

For game-level recurrence, `time-pressure-exposure-v1` is conservative:

- the game must publish the current timing-derivation version;
- every user decision after the user's first move must have current `AVAILABLE` timing;
- its before-move clock must be finite and non-negative;
- `POSSIBLE_EXTERNAL_CLOCK_ADJUSTMENT` excludes the game;
- a game with no derivable user decision is unavailable for `TIME-001`;
- partial, inconsistent, unsupported, stale, or unreliable timing is coverage loss and is never interpreted as "no pressure."

This stricter complete-game rule is what makes the pressure-entry denominator honest: a game with a timing gap cannot be counted as a no-pressure game merely because the observed subset did not contain pressure.

## Pressure classification

Each trustworthy user decision is classified from its before-move clock using the shared policy:

- `CRITICAL`: at or below 10 seconds;
- `PRESSURE`: above 10 and at or below 30 seconds;
- `NORMAL`: above 30 seconds.

Increment does not move those boundaries in v1.

The first observed user decision in `PRESSURE` or `CRITICAL` is the game's pressure entry. First-move clock is never fabricated.

## Output

The aggregate exposes:

- candidate, timing-eligible, and timing-covered game counts;
- timing coverage percentage and explicit exclusion counts;
- eligible user decisions;
- per-band move counts, distinct-game counts, move rates, and game rates;
- pressure move count/rate;
- pressure-entering game count/rate;
- first-entry average/earliest/latest ply and deterministic per-ply distribution;
- first-entry phase counts and phase coverage;
- exact-control/initial/increment strata with their own pressure entry and move rates;
- shared evidence strength based on timing-covered games and timing coverage.

Percentages and average ply use the shared one-decimal rounding policy. Zero denominators remain `null`.

## Phase semantics

Phase is optional context for `TIME-001`, not a prerequisite for pressure classification.

The repository consumes only the current successful `phase-context/phase-v1` evidence run whose source ply snapshot still matches the imported game. A user decision at ply `N` uses the phase covering before-position boundary `N - 1`.

If no current present phase range covers that boundary, first-entry phase is `UNKNOWN`. The implementation does not infer opening/middlegame/endgame from move number.

## Relationship to TIME-002

`TIME-001` answers:

> How often and how early does the player reach the defined pressure states?

It does **not** answer:

> Does the player play worse under pressure?

That second question requires current provenance-safe engine evidence, matched normal-clock moves, and the `TIME-002` aggregate. A high `TIME-001` exposure rate is not itself a quality-collapse finding.
