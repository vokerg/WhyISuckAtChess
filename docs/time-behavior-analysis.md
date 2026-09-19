# Phase 4 time-behavior analysis policy

**Status:** Phase 4B canonical aggregation policy  
**Policy version:** `time-behavior-v1`  
**Scope:** issue #57 under #56  
**Consumes:** the versioned clock alignment/timing derivation contract, current complete engine move-quality evidence, exact source time controls, phase evidence, and imported-game ratings

## Purpose

This document defines the shared Phase 4 policy vocabulary for `TIME-001` through `TIME-007` and the rating-composition checks used beside them. It prevents each aggregate from inventing its own clock bands, fast-move threshold, matching rules, evidence gates, or rounding.

The values below are **v1 policy choices, not statistically calibrated chess truths**. They are deliberately simple, inspectable, player-relative where possible, and versioned so later validation can replace them without changing source ingestion semantics. Any semantic change to a threshold, matching rule, eligibility rule, sample unit, or warning rule requires a time-behavior policy-version bump.

This policy does not implement a diagnosis, persist/rank findings, infer psychology, or prove causality.

## 1. Source and eligibility contract

The authoritative clock contract remains `docs/lichess-ingestion-and-timing.md` and `apps/api/src/modules/timing/timing-policy.ts`. This policy consumes those facts; it never reconstructs clocks independently.

A move may contribute to a timing-behavior metric only when the required facts for that metric are trustworthy:

- the game is supported by the existing standard timing policy;
- the required aligned source clock exists;
- a required move time has `derivationStatus = AVAILABLE`;
- required clock/move-time values are non-null and non-negative;
- reliability flags that indicate possible external clock adjustment exclude the affected timing value from behavioral comparisons;
- first-move think time for each color remains unavailable and is excluded whenever move time or before-move clock is required;
- `UNAVAILABLE`, `INCONSISTENT`, and `UNSUPPORTED` timing is coverage loss, never normal/no-pressure/no-fast evidence;
- missing phase, exact-control, rating, engine, or other required comparison context is separately counted as coverage loss for the metric that needs it.

A game can remain eligible for result-only metrics while being ineligible for timing or engine-quality metrics. Aggregates must publish those denominators separately.

## 2. Shared clock and speed terms

The pure constants/helpers live in `apps/api/src/modules/timing/time-behavior-policy.ts`.

### 2.1 Remaining-clock bands

The relevant remaining clock is the trustworthy **before-move clock** for the decision being classified.

| Band | v1 boundary |
| --- | ---: |
| `CRITICAL` | `<= 10.0 s` |
| `PRESSURE` | `> 10.0 s` and `<= 30.0 s` |
| `NORMAL` | `> 30.0 s` |

A game has **entered pressure** at the first eligible user decision whose before-move clock is `PRESSURE` or `CRITICAL`. Because first-move think-time/before-clock derivation is unavailable from the current source sequence, pressure entry means first **observed eligible** pressure decision, not a fabricated transition.

For v1, increment does **not** shift the 10/30-second band boundaries. Increment is preserved as part of exact-control identity and comparison context. This is intentional: 3+0 and 3+2 can share the same remaining-clock definition without being pooled into one population.

### 2.2 Ample clock

`TIME-003` requires a fast decision to occur with enough available time that "fast" is not merely forced by the clock.

A user decision has **ample clock** when:

`beforeMoveClock >= max(45 seconds, 25% of exact initial time)`.

The exact initial time must be known. Increment does not alter this threshold in v1. Missing initial time or before-move clock makes ample-clock status unavailable.

This rule keeps ample-clock and pressure states disjoint while scaling the ample threshold upward for longer controls.

### 2.3 Fast user and opponent moves

An unusually fast move is an eligible derived move time of `<= 1.0 second`.

- `TIME-003`: a fast user decision candidate is a user move at or below one second with ample clock.
- `TIME-007`: a fast-opponent exposure is an opponent move at or below one second. A fast-opponent **sequence** means at least two consecutive eligible opponent decisions at or below one second.
- the matched normal-pace arm is eligible moves above one second; there is no arbitrary upper think-time cap in v1.

A near-zero move is not automatically called a premove. The aggregate may describe the measured clock delta only; premove intent is not inferred.

### 2.4 Early phase for `TIME-004`

"Early" is not a move-number guess. The v1 early window is the trustworthy stabilized `OPENING` phase from the existing versioned phase-evidence contract. Unknown/uncovered phase is excluded.

Per-game early time expenditure is the sum of eligible user move times whose decision belongs to `OPENING`. First user-move timing remains unavailable and is not invented.

Within an exact-control peer group, **early overuse** means early time expenditure is at least `1.5x` the peer-group median. The median baseline requires at least five eligible peer games. This threshold is a v1 heuristic requiring later calibration.

## 3. Matching and baseline rules

### 3.1 Move-level quality comparisons

For `TIME-002`, `TIME-003`, and `TIME-007`, the minimum mandatory matching key is:

1. exact time-control key; and
2. stabilized phase.

Phase is the trustworthy stabilized phase of the move's before-position boundary. If that boundary has unknown/uncovered phase, the move is excluded from matched quality comparison.

A comparison never silently pools 3+0 with 3+2 or opening with middlegame. Other composition dimensions (rating difference, opening family, session context, color, date) remain inspectable confounders but are not mandatory matching dimensions in v1 unless a leaf issue explicitly narrows the comparison further.

Only current complete provenance-safe engine evidence contributes to move-quality metrics. Stale/superseded/incomplete analysis is engine-coverage loss, not negative evidence.

### 3.2 `TIME-005` exact-control baseline

Each exact control is its own target group. Its v1 comparator is another exact control with the **same exact initial seconds and a different increment**. There is no fallback that pools arbitrary controls from the same broad speed label.

Examples:

- 3+0 and 3+2 are distinct groups and are eligible comparators;
- 10+0 and 10+5 are distinct groups and are eligible comparators;
- 3+0 is not automatically compared with 5+0 merely because both may be blitz.

If no comparator with the same initial seconds passes sample/coverage gates, `TIME-005` is insufficient/unavailable for that target control rather than choosing an opaque fallback.

Result coverage and current-engine-quality coverage are reported independently.

### 3.3 `TIME-006` increment baseline

Increment/no-increment comparisons are stratified by **exact initial seconds**.

Within one initial-time stratum:

- no-increment arm: increment = 0;
- increment arm: increment > 0;
- every exact control represented in either arm remains visible.

V1 does not produce a single pooled cross-initial-time effect by mixing, for example, 1+0/1+1 with 10+0/10+5. A later implementation may summarize multiple eligible strata, but it must retain the per-stratum effects and denominators.

### 3.4 `TIME-001` exposure baseline

`TIME-001` is exposure evidence, not a quality comparison. It reports pressure-entry and pressure-frequency metrics by exact control/increment context. It does not require an engine baseline and must not imply that pressure caused worse play.

Issue #59 implements this contract as `time-pressure-exposure-v1`, documented in `docs/time-pressure-exposure.md`. Game-level recurrence uses only games whose derivable user decisions are completely covered by current reliable timing; partial games remain explicit coverage loss rather than implicit no-pressure evidence.

### 3.5 `TIME-004` chain baseline

A complete `TIME-004` mechanism requires the ordered chain in the same game:

1. early overuse versus the same-exact-control median baseline;
2. a later eligible pressure entry after the early window;
3. later current-engine quality deterioration relative to matched normal-clock moves under the move-level matching rule.

Games missing any required modality remain visible as broken/incomplete chain evidence. Early overuse alone, pressure alone, or poor later play alone is not a complete `TIME-004` chain.

## 4. Rating-difference and composition policy

Rating difference is always defined from the user's perspective as:

`opponent rating - user rating`.

V1 bands are:

| Band | Difference |
| --- | ---: |
| `MUCH_WEAKER` | `<= -200` |
| `WEAKER` | `-199 .. -100` |
| `EVEN` | `-99 .. +99` |
| `STRONGER` | `+100 .. +199` |
| `MUCH_STRONGER` | `>= +200` |

Missing either rating is rating-coverage loss and is never imputed.

For a two-arm comparison, `RATING-002` exposes at minimum:

- rated-game coverage in each arm;
- mean rating difference in each arm;
- count/share in every v1 rating-difference band;
- absolute mean-difference delta between arms;
- maximum absolute percentage-point delta among corresponding band shares.

After the ordinary sample/coverage gates are met, v1 marks composition as materially different when **either**:

- absolute arm-to-arm mean rating-difference delta is at least 100 rating points; or
- any rating-difference-band share differs by at least 20 percentage points.

The warning is a confounder disclosure. It does not modify the measured timing/result effect and is not a causal adjustment.

Issue #58 implements this contract as the reusable `rating-context-composition-v1` aggregate documented in `docs/rating-context-composition.md`. Consumers attach its result beside their own effect metrics; they do not feed the warning back into those metrics.

## 5. Sample, recurrence, coverage, and evidence strength

### 5.1 Coverage gate

For every required modality, coverage is:

`eligible items with trustworthy required evidence / eligible items`.

Below 50% required-evidence coverage, the corresponding finding evidence is `INSUFFICIENT`. A zero denominator is `null`, not zero percent.

Aggregates must report modality-specific coverage rather than collapse timing, engine, phase, rating, and result coverage into one number when they differ.

### 5.2 Evidence strength

The shared supporting-game thresholds are:

| Supporting games | Strength |
| ---: | --- |
| `< 5` | `INSUFFICIENT` |
| `5-14` | `LOW` |
| `15-39` | `MEDIUM` |
| `>= 40` | `HIGH` |

Comparative claims use the weaker arm.

For move-level timing comparisons, the leaf aggregate still exposes move counts, but evidence strength is based on **distinct supporting games in each arm**, not the number of moves. This prevents many moves from one game from masquerading as cross-game recurrence.

### 5.3 Recurrence units by diagnosis

- `TIME-001`: eligible/timing-covered games, pressure-entering games, pressure moves, and first-entry phase/ply distribution.
- `TIME-002`: pressure/baseline moves plus distinct games contributing current engine evidence to each arm.
- `TIME-003`: fast-ample/baseline moves plus distinct games containing each arm.
- `TIME-004`: games at each ordered chain stage and complete-chain games; distinct sessions may be exposed as a concentration caveat when session context is available.
- `TIME-005`: games per exact-control arm; result and engine-quality coverage separate.
- `TIME-006`: games per increment/no-increment arm within each initial-time stratum; timing and engine coverage separate.
- `TIME-007`: exposed/baseline response moves plus distinct games containing each arm and count of qualifying fast-opponent sequences.

One player-day, session, opening, or opponent dominating a sample is a concentration caveat. V1 does not invent an automatic numeric downgrade for those distributions.

## 6. Rounding and null behavior

- source clocks and derived move times remain integer centiseconds;
- ratings and rating differences remain integer source values;
- percentages, averages, and deltas exposed by this policy round to one decimal place;
- threshold comparisons happen on unrounded values;
- zero/missing denominators return `null`;
- unavailable inputs return `null`/explicit exclusion rather than zero;
- rates must expose numerator and denominator beside the rounded percentage.

## 7. Diagnosis-by-diagnosis executable contract

### `TIME-001 FREQUENT_TIME_PRESSURE`

Evidence: eligible user before-move clocks.  
Operation: classify each eligible decision into the shared clock band; first observed `PRESSURE`/`CRITICAL` decision is pressure entry.  
Output basis: game recurrence, pressure-move rate, first-entry ply/phase, exact-control/increment breakdown, timing coverage.  
No engine evidence is required. Exposure must not be described as deterioration.

### `TIME-002 QUALITY_COLLAPSE_UNDER_TIME_PRESSURE`

Pressure arm: user moves in `PRESSURE` or `CRITICAL`.  
Baseline arm: eligible `NORMAL`-clock user moves matched by exact control + phase.  
Quality: current complete engine score-loss/error metrics only.  
Strength: weaker distinct-game arm plus per-arm required-evidence coverage.  
Result is correlational.

Issue #60 implements this contract as `time-pressure-quality-collapse-v1`, documented in `docs/time-pressure-quality-collapse.md`. The implementation retains exact-control/phase strata, fences quality to current complete engine analysis, and reuses `RATING-002` only when its disjoint-game-arm precondition holds.

### `TIME-003 PLAYED_TOO_FAST`

Candidate arm: user moves `<= 1.0 s` with ample clock.  
Baseline arm: user moves `> 1.0 s` with ample clock, matched by exact control + phase.  
Positive mechanism evidence additionally requires worse current-engine quality in the fast arm; fast moves with equal/better quality remain exposure only, not a positive mechanism finding.

### `TIME-004 EARLY_TIME_OVERUSE`

Early window: trustworthy `OPENING` phase.  
Overuse: per-game eligible opening time at least 1.5x the median among same-exact-control eligible peer games.  
Required later chain: later pressure, then later quality degradation against matched normal-clock evidence.  
All three chain stages must be present in-order for complete mechanism evidence.

### `TIME-005 EXACT_TIME_CONTROL_UNDERPERFORMANCE`

Target: one exact control.  
Comparator: same exact initial seconds, different increment; no broad-speed fallback.  
Metrics: result score with result coverage; quality/error metrics with separate current-engine coverage.  
Attach `RATING-002` composition metrics/warning without altering raw deltas.

Issue #61 implements this contract as `exact-time-control-underperformance-v1`, documented in `docs/exact-time-control-underperformance.md`. The leaf aggregate keeps result and engine-quality evidence separate, selects only a same-initial different-increment comparator that passes the shared result gate, and attaches `RATING-002` without adjusting the raw deltas.

### `TIME-006 INCREMENT_EFFECT`

Comparison: increment > 0 versus increment = 0 within the same exact initial seconds.  
Metrics: result, pressure exposure, and current-engine quality where each modality is covered.  
Exact controls remain visible; positive, neutral, and negative effects are all valid outputs.  
Attach rating-composition warning separately.

### `TIME-007 OPPONENT_MOVE_SPEED_EFFECT`

Exposure: immediately preceding eligible opponent move `<= 1.0 s`; sequence context is at least two consecutive fast opponent decisions.  
Baseline: user responses not preceded by fast opponent play, matched by exact control + phase.  
Metrics: eligible user response time and current-engine quality. Opponent and user timing must be aligned by actual ply/color; missing timing on either side excludes the affected event.  
Attach rating-composition and opening/phase composition caveats; remain correlational.

## 8. Versioning and future calibration

The following changes require a `TIME_BEHAVIOR_POLICY_VERSION` bump:

- clock/ample/fast thresholds or boundary inclusivity;
- increment treatment;
- early-phase or early-overuse semantics;
- mandatory matching keys or game-level comparator selection;
- rating bands or composition-warning thresholds;
- sample unit, coverage gate, evidence-strength thresholds;
- rounding/null semantics that alter outputs.

Clock alignment/derivation versions remain independently versioned. Later aggregate outputs should identify both the time-behavior policy version and the source timing derivation/alignment versions they consumed.

Future work should validate these v1 values empirically and may introduce control-specific calibration or stronger confounder adjustment. Such work must not rewrite historical source clocks or silently reinterpret old aggregate versions.
