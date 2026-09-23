# Stable overlong-session stopping-point aggregate

**Status:** implemented Phase 4 `SESSION-003` aggregate evidence contract  
**Scope:** issue #79  
**Depends on:** `session-v1` (#50), current-complete game-quality projection (#52), and exact-control matching precedent (#54)

## Purpose

`SESSION-003 OVERLONG_SESSION_STOPPING_POINT` identifies the earliest fixed game-count threshold after which the player's current provenance-safe move quality deteriorates materially and repeatedly across distinct sessions.

This is a deterministic within-player association. It supports wording such as “Your play deteriorates after about game 6 in long sessions.” It does not establish fatigue, tilt, tiredness, or another psychological cause.

## Reference / Preserve / Change / Omit / Future seam

**Reference**

- CRT `player-chess-profile.metrics.ts` for deterministic one-decimal metrics, 50% required-analysis coverage, and 5/15/40 evidence grades.
- CRT player-profile repository/service separation for bounded owned-player reads feeding pure aggregation.
- Why `session-deterioration-v1` for the current-complete per-game move-quality projection.
- Why `loss-streak-deterioration-v1` for explicit exact-time-control matching and unmatched-coverage reporting.

**Preserve**

- bounded, ownership-scoped source reads;
- current complete engine-analysis provenance tied to the current ply-index projection;
- explicit denominators and missing-analysis coverage;
- deterministic one-decimal metrics;
- 5/15/40 evidence grades;
- source sessionization from `session-v1` rather than reimplementing chronology.

**Change**

- session game ordinal is the primary threshold dimension;
- thresholds are a fixed policy registry, not a free-form optimizer;
- matching is performed within `sessionKey + exactTimeControlKey`;
- support requires recurrence across distinct analysed comparable sessions;
- the earliest supported threshold wins even when a later threshold has a larger effect.

**Omit**

- no persistence/ranking/API/UI/AI;
- no recommendation engine beyond exposing the measured threshold;
- no local-time inference;
- no causal fatigue/tilt/psychological claim;
- no opponent/opening/color adjustment beyond explicit caveats.

**Future seam**

Phase 5 candidate projection can consume the typed `SESSION-003` result directly and relate it to timing/chess mechanisms without reopening sessionization or engine provenance.

## Policy identity

The initial policy version is `overlong-session-stopping-point-v1`.

The candidate threshold registry is fixed to:

`[4, 5, 6, 7, 8, 9, 10]`

Candidate-set drift fails closed. Changing the registry or any materiality/recurrence threshold requires a policy-version bump.

For each candidate threshold `N`:

1. consider only sessions that reached at least game `N`;
2. split those sessions into pre-threshold games (ordinal `< N`) and threshold-and-later games (ordinal `>= N`);
3. retain only exact time controls represented on both sides inside the same session;
4. aggregate current-complete move quality over those matched games;
5. compute a separate per-session comparison for recurrence;
6. select the earliest candidate satisfying all support rules.

## Required coverage and recurrence

A candidate can be supported only when:

- both matched arms have engine-analysis coverage >= 50%;
- at least 5 distinct sessions have analysable games on both matched arms;
- the material broad-deterioration rule holds on the pooled comparison;
- at least 60% of analysed comparable sessions independently satisfy the same material broad-deterioration rule.

Evidence strength uses distinct analysed comparable sessions:

- fewer than 5 -> `INSUFFICIENT`;
- 5-14 -> `LOW`;
- 15-39 -> `MEDIUM`;
- 40+ -> `HIGH`.

This prevents one marathon session from establishing a stable stopping point.

## Broad-deterioration rule

The v1 material rule is intentionally conservative and inspectable.

A comparison counts as broad deterioration only when:

- average per-game score loss worsens by at least **10 cp**; and
- either mistake+blunder rate worsens by at least **2 percentage points**, or blunder rate worsens by at least **1 percentage point**.

All three raw deltas are still exposed even when the rule is not met.

These thresholds are v1 product-policy choices, not statistically calibrated population claims. Their purpose is to prevent tiny/noisy positive deltas from manufacturing a stopping point. Future calibration must advance the policy version.

## Exact-control matching

Matching uses `sessionKey + exactTimeControlKey`.

For a given session and threshold, 3+0 pre-threshold games are compared only when that same session also has 3+0 games at/after the threshold. A 3+0 pre arm is never silently pooled against a 3+2 post arm.

The candidate summary exposes:

- sessions reaching the threshold;
- comparable and analysed-comparable distinct sessions;
- pre/post candidate games;
- games missing exact-control identity;
- matched and unmatched games in each arm;
- matched stratum count;
- per-arm analysis coverage.

Missing exact-control identity remains coverage loss rather than being imputed.

## Move-quality metrics

The aggregate reuses the existing `SessionGameQualityRepository`.

Only current complete engine analysis bound to the current ply-index projection contributes analysed move quality. Each arm reports:

- eligible games;
- analysed games;
- eligible and analysed distinct sessions;
- analysis coverage;
- analysed user moves;
- equal-game-weighted average score loss;
- move-weighted mistake+blunder rate;
- move-weighted blunder rate.

The comparison exposes threshold-and-later minus pre-threshold deltas.

No new Prisma repository or source-fact ownership is introduced by `SESSION-003`; the existing #52 repository remains the authoritative bounded ownership/provenance fence.

## Selection semantics

Every candidate summary is returned so selection is inspectable.

`selectedThreshold` is:

- the earliest supported candidate among 4 through 10; or
- `null` when no candidate satisfies the support rules.

A larger later effect never replaces an already-supported earlier threshold.

## Coverage and failure behavior

The aggregate fails closed when:

- sessionization is unavailable;
- the session-covered game set changes during the quality read;
- the candidate-threshold registry drifts.

Candidate-level coverage remains explicit for:

- no sessions reaching a threshold;
- no same-session exact-control strata shared across both arms;
- missing exact-control identity;
- unmatched strata;
- incomplete/stale engine analysis;
- partial session chronology.

Incomplete/stale engine analysis stays represented by zero analysed moves/null average score loss from the shared provenance-safe quality projection and therefore lowers arm coverage.

## Interpretation boundary

Allowed:

> Your play deteriorates after about game 6 in long sessions in this sample.

Not allowed:

> You get tired after game 6.

The aggregate does not establish why the deterioration occurs. Opponent strength, opening mix, color, local time, and unequal matched-stratum sizes can still affect the observed association. Later diagnosis synthesis may connect the threshold to supported timing or chess mechanisms while preserving those caveats.
