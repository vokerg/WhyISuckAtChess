# TIME-005 exact time-control underperformance

**Status:** Phase 4B implemented aggregate  
**Diagnosis:** TIME-005 EXACT_TIME_CONTROL_UNDERPERFORMANCE  
**Aggregate policy:** exact-time-control-underperformance-v1  
**Shared timing-behavior policy:** time-behavior-v1  
**Issue:** #61 under #56

## Purpose

TIME-005 measures how the player's observed results and current engine-backed move quality differ across exact time controls without collapsing controls into a broad speed label. A control such as 3+0 is a separate population from 3+2 even when both are categorized as blitz.

The aggregate is observational. A lower result score or worse engine-quality metric at one exact control does not establish a timing mechanism, a psychological cause, or that the increment itself caused the difference. More specific supported timing mechanisms such as TIME-002, TIME-004, and TIME-006 remain independently inspectable.

## Reference / Preserve / Change / Omit / Future seam

### Reference

The implementation adapts CRT's player-chess-profile aggregation patterns:

- ownership- and range-bounded game populations;
- SQL-side W/D/L and analysis aggregation seams;
- score percentage as (wins + 0.5 * draws) / covered results;
- one-decimal metric rounding;
- 5/15/40 supporting-game evidence grades with a 50% required-evidence coverage floor.

Within Why, it reuses time-behavior-v1 for coverage, rounding, evidence strength, and exact-control comparator semantics, the current-complete engine provenance fence already used by Phase 4 diagnosis aggregates, and RATING-002 for opponent-strength composition disclosure.

### Preserve

- exact source time-control identity;
- separate result and engine-quality coverage;
- current complete engine analysis only;
- explicit sample sizes and denominators;
- bounded owned reads and snapshot-drift failure;
- rating composition as a disclosure rather than an effect adjustment.

### Change

CRT's broader performance/profile grouping is narrowed to Why's exact-control question. TIME-005 compares one exact control only with a same-initial-time, different-increment comparator and exposes result plus move-quality deltas for that selected pair.

### Omit

- broad-speed fallback matching;
- causal inference or significance testing;
- diagnosis persistence/ranking;
- API/UI/AI work;
- psychological interpretation.

### Future seam

TIME-006 can reuse the same exact-control arm metrics while changing the comparison unit to increment-versus-no-increment arms within each exact initial-time stratum.

## Bounded source read

getExactTimeControlUnderperformance(appUserId, scope, repository, ratingRepository):

1. validates from < to;
2. counts owned candidate games;
3. refuses scopes above 5,000 candidates before loading grouped source rows;
4. loads one SQL-grouped row per candidate game with exact-control identity, result, and current complete engine-quality totals;
5. fails closed if the candidate set changes during the read;
6. builds exact-control arms and deterministic comparator selections;
7. attaches RATING-002 separately for each selected target/comparator pair.

The repository groups engine-quality facts at game level before the service combines games into exact-control populations. Stale, failed, incomplete, or source-snapshot-mismatched engine runs do not enter the quality counts.

## Game eligibility and exact-control identity

TIME-005 uses the existing standard timing-policy game cohort: supported standard chess variants in bullet, blitz, or rapid. Result-only metrics do not require trustworthy per-ply timing, but the game still belongs to the shared timing-behavior population.

An eligible exact-control group requires a non-empty exactTimeControlKey, a non-negative integer initial time in seconds, a non-negative integer increment in seconds, and consistent initial/increment metadata for every game carrying the same exact-control key.

Missing identity is explicit coverage loss. If one exact-control key is associated with conflicting initial/increment metadata inside the selected population, that key is excluded rather than silently split or reinterpreted.

## Comparator definition and deterministic selection

For target control T, a comparator candidate must:

1. be a different exact-control key;
2. have the same exact initial seconds as T;
3. have a different increment;
4. pass the shared result evidence gate: at least 50% result coverage and at least five result-covered games.

There is no broad-speed fallback. For example, 3+0 may compare with 3+1 or 3+2; 10+0 may compare with 10+5; 3+0 does not compare with 5+0 merely because both are blitz.

If multiple candidates qualify, v1 selects exactly one comparator using this deterministic order:

1. stronger result evidence grade;
2. larger result-covered sample;
3. smaller absolute increment difference from the target;
4. smaller increment;
5. lexicographically smaller exact-control key.

This rule is part of exact-time-control-underperformance-v1. A target with no qualifying same-initial comparator is reported as unavailable for comparison rather than receiving an arbitrary baseline.

The target itself is not hidden merely because its sample is weak. Its arm remains visible and the pair's comparative evidence strength falls to INSUFFICIENT when the target does not meet the shared gate.

## Result metrics

A game contributes result evidence only when resultForUser is WIN, DRAW, or LOSS.

Each arm exposes eligible games, result-covered games and result coverage, wins/draws/losses, score percentage, and result evidence strength.

Score percentage is 100 * (wins + 0.5 * draws) / result-covered games.

The result delta is always target score percentage minus comparator score percentage. Positive, zero, and negative deltas are all valid observations.

## Current engine-quality metrics

A user move contributes quality only when its linked analysis run belongs to the same imported game, succeeded, has COMPLETE coverage, points to the current plyIndexedAt source snapshot, and supplies a finite non-negative scoreLossCp.

The game-level SQL projection exposes analyzed user-move count, score-loss total, mistake-or-blunder count, and blunder count. Exact-control arms then expose analyzed games and analysis coverage, analyzed user moves, move-weighted average score loss, mistake-or-blunder rate, blunder rate, and quality evidence strength.

Quality deltas are always target minus comparator. Positive score-loss/error-rate deltas mean the target measured worse on that metric; negative deltas mean it measured better. No sign is converted into a causal conclusion.

A game with a valid result but no current complete engine evidence still contributes to result metrics. Result coverage and analysis coverage are never collapsed into one denominator.

## Evidence strength

Result evidence uses result-covered games and result coverage. Quality evidence uses distinct analyzed games and analysis coverage. Comparative evidence uses the weaker target/comparator arm.

The shared thresholds are fewer than 5 supporting games = INSUFFICIENT, 5-14 = LOW, 15-39 = MEDIUM, and 40 or more = HIGH. Any required modality below 50% coverage is INSUFFICIENT.

Move count remains visible for quality metrics but cannot substitute for cross-game recurrence.

## Opponent-strength composition

Every selected target/comparator pair has disjoint exact-control game sets, so the reusable RATING-002 contract can compare their opponent-strength composition directly.

The attached result reports rating coverage, mean rating-difference differences, rating-band composition, and the material-composition warning. The warning is a confounder disclosure only. It never normalizes, discounts, or rewrites TIME-005 result or quality deltas.

## Interpretation boundary

Preferred factual interpretation is limited to statements such as:

> In the selected games, 3+0 scored fewer points and had higher average engine score loss than the selected 3+2 comparator, with the reported result and engine coverage.

TIME-005 must not turn that observation into claims such as "You play badly because you have no increment" or "3+0 makes you panic." Those statements require mechanism or causal evidence that this aggregate does not provide.
