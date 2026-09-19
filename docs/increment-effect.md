# TIME-006 increment effect

**Status:** Phase 4B implemented aggregate  
**Diagnosis:** `TIME-006 INCREMENT_EFFECT`  
**Aggregate policy:** `increment-effect-v1`  
**Shared timing-behavior policy:** `time-behavior-v1`  
**Issue:** #62 under #56

## Purpose

`TIME-006` measures whether the player's observed results, trustworthy time-pressure exposure, and current engine-backed move quality differ between increment and no-increment games while holding exact initial time constant.

The aggregate is observational. It can represent increment-associated improvement, no material difference, or increment-associated deterioration. It does not assume increment helps and does not establish that increment caused a measured difference.

## Reference / Preserve / Change / Omit / Future seam

### Reference

The implementation composes existing Phase 4 boundaries rather than redefining them:

- `time-behavior-v1` for evidence grades, percentages, rounding, pressure thresholds, and same-initial increment comparison semantics;
- `time-pressure-exposure-v1` for conservative trustworthy timing coverage and pressure-entry/move rates;
- the current-complete engine-analysis fence used by `TIME-002` and `TIME-005`;
- `rating-context-composition-v1` for `RATING-002` opponent-strength composition disclosure.

### Preserve

- exact initial time as the mandatory comparison stratum;
- exact control identity inside each arm;
- separate result, timing, and engine-quality denominators;
- current timing derivation and current complete engine provenance only;
- explicit exclusions, unmatched populations, coverage, and weaker-arm evidence strength;
- bounded owned reads and snapshot-drift failure;
- rating composition as disclosure rather than effect adjustment.

### Change

`TIME-005` selects one exact-control comparator for each target. `TIME-006` instead groups all eligible no-increment controls and all eligible increment controls within the same exact initial-time stratum, while retaining each represented exact control in the output.

For example, `3+0` can be compared with the increment arm containing `3+1` and/or `3+2`. A `3+0` population is never compared with `5+3`, because the initial times differ.

### Omit

- comparisons across different initial times;
- broad-speed pooling or fallback matching;
- causal claims about increment;
- diagnosis persistence/ranking;
- API/UI/AI work;
- statistical-significance claims.

### Future seam

Phase 5 can consume `TIME-006` as structured aggregate evidence alongside `TIME-005`, `TIME-001`, and stronger mechanism evidence without treating the observed increment association as causal.

## Bounded source read

`getIncrementEffect(appUserId, scope, repository, ratingRepository)`:

1. validates the date range;
2. counts owned candidate games;
3. refuses scopes above 5,000 candidates before loading source rows;
4. loads the same bounded owned population once;
5. fails closed if the candidate count changes during the read;
6. builds same-initial-time increment/no-increment strata;
7. loads rating context once for all matched games;
8. builds `RATING-002` separately for each matched initial-time stratum.

The source repository selects only game identity/result facts and user-ply timing/engine fields needed by the aggregate.

## Game and control eligibility

The aggregate uses the shared timing-policy game cohort: supported standard chess variants in bullet, blitz, or rapid.

A usable control identity requires:

- a non-empty `exactTimeControlKey`;
- a non-negative integer initial time in seconds;
- a non-negative integer increment in seconds;
- consistent initial/increment metadata for every game carrying the same exact-control key.

Missing control identity is explicit coverage loss. If one exact-control key maps to conflicting initial/increment values within the selected population, every game using that key is excluded rather than silently split or reinterpreted.

## Matching semantics

Games are grouped by exact initial seconds. Within each initial-time stratum:

- `noIncrement` contains controls with increment = 0;
- `increment` contains controls with increment > 0.

A stratum contributes effect deltas only when both arms are non-empty. Strata containing only one arm remain explicit unmatched coverage loss.

Exact controls are never discarded by the grouping. Each arm reports the exact control keys it contains, their increment seconds, and their game counts.

## Result metrics

A game contributes result evidence only when `resultForUser` is `WIN`, `DRAW`, or `LOSS`.

Each arm reports:

- games;
- result-covered games and result coverage;
- wins, draws, and losses;
- score percentage;
- result evidence strength.

Score percentage is `100 * (wins + 0.5 * draws) / result-covered games`.

The result delta is always **increment minus no-increment**. Positive, zero, and negative values are all valid observations.

## Current engine-quality metrics

A user move contributes quality only when:

- its linked analysis run belongs to the same imported game;
- the game is currently indexed;
- the run succeeded;
- the run has `COMPLETE` coverage;
- the run's source ply snapshot equals the game's current `plyIndexedAt`;
- `scoreLossCp` is finite and non-negative.

Each arm reports analyzed games/coverage, analyzed user moves, move-weighted average score loss, mistake-or-blunder rate, blunder rate, and quality evidence strength.

Quality deltas are always **increment minus no-increment**. A negative average-score-loss delta means the increment arm measured better on that metric; a positive delta means it measured worse.

A valid game result can contribute to result metrics even when current engine evidence is absent. Result and analysis coverage are never collapsed into one denominator.

## Time-pressure metrics

Timing exposure is derived through `time-pressure-exposure-v1`, so `TIME-006` inherits its conservative game-level timing rule:

- only the current timing-derivation version is accepted;
- every derivable user decision in a timing-covered game must have `AVAILABLE`, reliable timing;
- finite non-negative before-move clocks are required;
- `POSSIBLE_EXTERNAL_CLOCK_ADJUSTMENT` excludes the game from timing recurrence;
- incomplete timing is coverage loss, never evidence of no pressure.

Each arm reports:

- timing-covered games and timing coverage;
- eligible user decisions;
- pressure moves and pressure-move rate;
- pressure-entering games and pressure-entry rate;
- timing evidence strength.

Pressure uses the shared `time-behavior-v1` thresholds. Increment does not change those thresholds.

Pressure-rate deltas are always **increment minus no-increment**.

## Evidence strength

Result, quality, and timing evidence are graded independently.

For each modality, comparative evidence uses the weaker arm under the shared policy:

- fewer than 5 supporting games = `INSUFFICIENT`;
- 5–14 = `LOW`;
- 15–39 = `MEDIUM`;
- 40 or more = `HIGH`;
- required modality coverage below 50% forces `INSUFFICIENT`.

Move counts remain visible for quality and timing metrics but do not substitute for cross-game recurrence.

## Opponent-strength composition

Each matched initial-time stratum attaches `RATING-002` to its no-increment and increment game sets.

The rating-context repository is read once across all matched games, then the pure composition aggregate is evaluated independently for each stratum. This keeps database work bounded while preserving per-stratum confounder disclosure.

The rating warning never modifies, normalizes, discounts, or otherwise rewrites `TIME-006` result, timing, or quality deltas.

## Interpretation boundary

Appropriate wording is descriptive, for example:

> Within games starting from three minutes, the increment arm had the reported result, move-quality, and pressure-rate differences versus the no-increment arm, with the stated coverage and opponent-strength composition.

The aggregate must not turn that association into statements such as "increment fixes your time management" or "you lose without increment because you panic." Those claims require stronger mechanism or causal evidence than `TIME-006` provides.
