# TIME-003 played-too-fast aggregate

**Status:** implemented Phase 4B aggregate  
**Aggregate version:** `played-too-fast-v1`  
**Shared policy:** `time-behavior-v1`  
**Scope:** issue #63 under #56

## Purpose

`TIME-003 PLAYED_TOO_FAST` measures whether the player repeatedly makes unusually fast decisions while they still have ample clock and whether those decisions are associated with worse current engine move quality than their own matched normal-pace decisions.

This is behavioral, correlational evidence. It does not infer premove intent, impulsiveness, panic, confidence, or another psychological cause.

## Reference / Preserve / Change / Omit / Future seam

**Reference**

- CRT player-profile/performance aggregation patterns for bounded player-relative summaries and explicit coverage.
- Why's existing `TIME-002` repository/service split for provenance-safe timing plus engine-quality comparison.

**Preserve**

- bounded ownership-filtered database reads;
- source timing facts and timing derivation versioning;
- current-complete engine-analysis provenance;
- exact-control and stabilized-phase matching;
- explicit denominators, coverage loss, recurrence, and weaker-arm evidence strength.

**Change**

- the exposure arm is policy-defined fast user decisions with ample clock rather than pressure-state moves;
- normal-pace ample-clock moves form the comparator;
- a positive mechanism status requires worse average score loss in the fast arm after evidence gating.

**Omit**

- no premove-intent inference;
- no psychological labels or causal claim;
- no persistence, ranking, API, UI, or AI explanation;
- no statistical-significance claim.

**Future seam**

Phase 5 may consume this aggregate as one bounded evidence source while keeping its version, denominators, matched strata, and analysis provenance inspectable.

## Eligibility and exposure

The aggregate consumes the shared timing policy directly.

A user decision is timing-covered only when:

- the game is timing-eligible under the standard timing contract;
- the decision is after the first move for that color;
- `clockBeforeMoveCentiseconds` and derived move time are non-negative finite values;
- the timing derivation version is current and status is `AVAILABLE`;
- the move does not carry `POSSIBLE_EXTERNAL_CLOCK_ADJUSTMENT`.

The exact initial time must also be known to classify ample clock.

A decision has ample clock when:

`beforeMoveClock >= max(45 seconds, 25% of exact initial time)`.

Within ample-clock decisions:

- fast arm: derived move time `<= 1.0 second`;
- baseline arm: derived move time `> 1.0 second`.

Fast decisions without ample clock are counted separately as `fastWithoutAmpleClockMoves` and never enter the `PLAYED_TOO_FAST` arm.

## Matching

Quality comparison uses the mandatory `time-behavior-v1` key:

1. exact time-control key;
2. stabilized phase.

A stratum contributes to the comparison only when it contains both fast-ample and normal-pace ample-clock moves. Engine-backed quality remains matched inside the same stratum: if current analysis exists only on one arm, that stratum does not contribute its analyzed moves to the aggregate effect.

This prevents, for example, a fast 3+2 opening move from being compared against a normal 3+0 middlegame move.

## Engine-quality provenance

Only engine evidence attached to a current complete analysis run for the same ply-index snapshot contributes:

- score loss;
- major-error rate;
- blunder rate.

Stale, superseded, incomplete, or missing analysis is explicit coverage loss.

The result exposes the contributing snapshot IDs, analysis versions, settings hashes, and engine name/version pairs.

## Positive mechanism semantics

The aggregate always exposes raw fast-versus-baseline quality deltas when the comparison is available.

`mechanismStatus` is:

- `INSUFFICIENT` when the weaker arm fails the shared evidence/coverage gate or average score-loss delta is unavailable;
- `WORSE_QUALITY_ASSOCIATION` when sufficient evidence exists and fast-ample average score loss is higher than the matched baseline;
- `NOT_SUPPORTED` when sufficient evidence exists and fast-ample average score loss is equal or lower.

Therefore fast good moves, or fast moves with neutral quality, do not become a positive `TIME-003` mechanism finding merely because they are fast.

No statistical significance or causal meaning is implied by this status.

## Coverage and recurrence

The output keeps these stages separately inspectable:

- candidate games;
- timing-eligible games;
- timing-eligible user decisions;
- timing-covered user decisions;
- ample/non-ample/unknown-ample decisions;
- fast-without-ample decisions;
- ample-clock decisions with exact-control and phase context;
- matched fast/baseline decisions and strata;
- current-engine analyzed matched decisions.

Recurrence is reported as distinct games containing matched fast-ample or baseline moves, plus distinct games contributing current analysis to each arm. Evidence strength uses the shared weaker-arm distinct-game rule rather than raw move count.

## Bounded repository behavior

The Prisma repository:

- filters by `appUserId` and optional half-open `[from, to)` range;
- orders deterministically;
- caps reads at 5,000 candidates;
- loads only user plies and current phase evidence needed by the aggregate;
- fences stale engine snapshots before they enter service-level metrics.

The service count-checks before loading and fails closed if the candidate set changes during the read.

## Validation focus

Focused coverage includes:

- repeated fast-bad decisions;
- fast-good and neutral-quality decisions;
- low-clock fast decisions;
- first-move and unreliable/missing timing;
- missing initial time, exact control, or phase;
- stale engine analysis;
- exact-control/phase one-sided strata;
- cross-game recurrence;
- scope bounds and candidate-set drift;
- ownership/range-bounded Prisma loading.

## Caveats

V1 is intentionally transparent rather than fully adjusted. Exact control and phase are mandatory matching dimensions, but opening family, session context, color, date, and opponent strength are not equalized. Those distributions may remain confounders for later synthesis.

The one-second fast threshold and ample-clock rule are versioned policy choices that require later empirical calibration.
