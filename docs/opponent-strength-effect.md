# Opponent-strength effect aggregate

**Status:** Phase 4B implemented aggregate  
**Diagnosis:** `RATING-001 OPPONENT_STRENGTH_EFFECT`  
**Aggregate policy:** `opponent-strength-effect-v1`  
**Shared timing/rating policy:** `time-behavior-v1`  
**Scope:** issue #66 under #56

## Purpose

`RATING-001` describes how the player's results and current provenance-safe move quality vary across the versioned opponent-strength bands defined by `time-behavior-v1`.

The aggregate is observational. It does not claim that stronger opponents cause panic, intimidation, lower confidence, or any other psychological state. It also does not predict rating or infer causal effects.

## Reference / Preserve / Change / Omit / Future seam

**Reference:** CRT's player chess profile repository/metrics/service pattern for bounded grouped reads, W/D/L score summaries, one-decimal metrics, explicit coverage, and 5/15/40 evidence grades.

**Preserve:** bounded ownership-scoped reads, deterministic pure aggregation, separate result and engine-analysis denominators, explicit missing-data coverage, and weaker-arm evidence grading.

**Change:** rating difference is the primary dimension; it is always `opponent - user` at game time. Exact time control remains first-class context, and effect deltas are computed only inside one exact-control stratum.

**Omit:** peer-rating prediction, cross-pool normalization, significance testing, causal adjustment, psychological interpretation, diagnosis persistence/ranking, API/UI, and AI prose.

**Future seam:** Phase 5 can consume the typed `RATING-001` aggregate as contextual evidence without changing imported source facts, engine provenance, or the `RATING-002` confounder service.

## Eligible population

The repository first performs a bounded owned-game read by optional `from` / `to` start-time scope. The service then keeps the current standard bullet/blitz/rapid cohort used by the Phase 4 timing policy.

A game needs:

- both user and opponent ratings;
- a non-empty exact time-control key;
- a rating difference classifiable by `time-behavior-v1`.

Missing ratings are never imputed. Games without exact control remain explicit coverage loss rather than being pooled by broad speed.

The aggregate is capped at 5,000 candidate games and rejects candidate-set drift between count and load.

## Rating bands

Rating difference is `opponent rating - user rating`.

| Band | Difference |
| --- | ---: |
| `MUCH_WEAKER` | `<= -200` |
| `WEAKER` | `-199 .. -100` |
| `EVEN` | `-99 .. +99` |
| `STRONGER` | `+100 .. +199` |
| `MUCH_STRONGER` | `>= +200` |

The output includes these definitions directly so a consumer does not need to duplicate threshold semantics.

## Band summaries

For every represented band the aggregate exposes:

- games;
- average user, opponent, and rating-difference values;
- result-covered games, W/D/L counts, score percentage, and result evidence strength;
- analysed games and current-engine analysis coverage;
- analysed user moves;
- average score loss;
- major-error and blunder counts/rates;
- quality evidence strength;
- the same metrics broken down by every represented exact time control.

The top-level band summary is descriptive. Its exact-control composition is always visible and is not itself treated as a matched effect estimate.

## Adjacent matched comparisons

Effect deltas are never produced by silently pooling exact controls.

Inside each exact time-control stratum, non-even bands use the adjacent band toward `EVEN`:

```text
MUCH_WEAKER -> WEAKER -> EVEN <- STRONGER <- MUCH_STRONGER
```

Therefore:

- `MUCH_WEAKER` compares with `WEAKER`;
- `WEAKER` compares with `EVEN`;
- `STRONGER` compares with `EVEN`;
- `MUCH_STRONGER` compares with `STRONGER`.

`EVEN` is the center/reference band and does not create a target comparison of its own.

If the adjacent band does not exist in the same exact control, the comparison is `UNAVAILABLE`. The implementation does not borrow a baseline from another time control or skip across bands to manufacture one.

Each matched comparison exposes target-minus-baseline deltas for:

- score percentage points;
- average score loss in centipawns;
- major-error rate percentage points;
- blunder-rate percentage points.

A positive score delta means the target band scored better than its baseline. A positive score-loss/error-rate delta means the target band had worse measured move quality. These are associations, not causal effects.

## Evidence strength and sparse bands

Result and quality evidence are graded independently with the shared policy:

- less than 50% required-modality coverage: `INSUFFICIENT`;
- fewer than 5 supporting games: `INSUFFICIENT`;
- 5-14: `LOW`;
- 15-39: `MEDIUM`;
- 40 or more: `HIGH`.

Comparative strength uses the weaker exact-control-matched arm.

Sparse comparisons keep their descriptive metrics and deltas inspectable but are marked `INSUFFICIENT`. Weak evidence is therefore not converted into a stable opponent-strength conclusion.

## Engine provenance

Move-quality metrics include only user plies attached to a `GameAnalysisRun` that is:

- `SUCCEEDED`;
- `COMPLETE`;
- for the same imported game;
- sourced from the game's current `plyIndexedAt` snapshot.

Stale, superseded, incomplete, missing, or otherwise non-current engine analysis contributes no quality metric and reduces analysis coverage.

Result coverage and engine-analysis coverage remain separate.

## Coverage semantics

The output reports:

- candidate, supported, and unsupported games;
- rating-covered and missing-rating games;
- exact-control-covered and missing-exact-control games;
- eligible games;
- result and analysis coverage;
- represented bands and exact controls;
- count of adjacent matched comparisons.

`COMPLETE` requires full supported/rating/exact-control/result/analysis coverage and at least one adjacent comparison. Otherwise the aggregate is `PARTIAL` when a comparison exists, or `UNAVAILABLE` when no eligible/matched comparison can be formed.

## Non-claims

`RATING-001` does not establish why performance differs by opponent strength. It does not normalize rating systems across speed pools, model confidence or intimidation, perform significance testing, or adjust another aggregate's measurements.

`RATING-002` remains the reusable two-arm composition warning for other comparisons. `RATING-001` instead describes the player's own rating-band performance and quality context.
