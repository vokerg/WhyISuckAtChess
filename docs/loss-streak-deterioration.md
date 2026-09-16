# Loss-streak-associated move-quality deterioration aggregate

**Status:** initial Phase 4 matched streak aggregate evidence contract  
**Scope:** issue #54  
**Depends on:** `session-v1` from issue #50 and the current-complete game-quality boundary from issue #52

## Purpose

`SESSION-002 LOSS_STREAK_ASSOCIATED_DETERIORATION` needs a reproducible comparison before any diagnosis layer can describe a pattern as tilt-consistent. The `diagnosis` module therefore owns a typed aggregate that combines versioned prior-loss-streak context with current complete engine move-quality evidence.

This slice produces aggregate evidence only. It does not assert tilt, anger, frustration, causality, or a user-facing diagnosis.

## Policy identity

The initial aggregation policy is `loss-streak-deterioration-v1`.

- streak arm: `session-v1.priorLossStreak >= 2`;
- baseline candidates: `priorLossStreak = 0`;
- ordinals below 3 are outside the comparison because a two-loss prior streak cannot exist there;
- candidates with exactly one prior loss are excluded from both arms;
- matching key: session ordinal + exact time-control key;
- only strata represented in both arms enter the comparison;
- minimum required engine-analysis coverage: 50% in each matched arm;
- comparative evidence strength follows the weaker analysed-game arm: <5 `INSUFFICIENT`, 5–14 `LOW`, 15–39 `MEDIUM`, >=40 `HIGH`.

The >=2 streak threshold and matching policy are calibration-sensitive. Changing them requires a policy-version bump.

## Metrics and coverage

Each matched arm exposes eligible and analysed games, eligible and analysed distinct sessions, engine-analysis coverage, analysed user moves, equal-game-weighted mean score loss, mistake+blunder rate, and blunder rate. The comparison exposes after-streak minus baseline deltas.

Coverage also exposes:

- all candidate/session-covered/session-uncovered games;
- baseline and streak candidates;
- games excluded before a two-loss streak is possible;
- games excluded at exactly one prior loss;
- candidates missing exact time-control identity;
- matched and unmatched games in each arm;
- matched stratum count;
- analysed matched games and overall matched analysis coverage.

Missing chronology, exact-control identity, an opposite-arm stratum, or current complete engine analysis is never imputed as normal evidence.

## Matching boundary

Matching by ordinal and exact control is intentionally transparent and deterministic. It reduces two obvious composition differences:

1. a game after two losses cannot occur at the same session positions as games 1–2;
2. exact controls such as 3+0 and 3+2 should not be silently pooled when testing a streak-associated effect.

The v1 matcher does **not** yet equalize the number of games per matched stratum. Aggregate metrics retain equal game weighting, so different stratum frequencies can still affect composition.

It also does not yet match opponent strength, opening mix, color, or local time of day. Those remain explicit confounders for later diagnosis-building work.

## Interpretation boundary

Positive CPL or error-rate deltas mean the measured move-quality metric is worse in games played after at least two prior losses than in the matched non-streak arm. They do not establish that losing caused the deterioration or that the player experienced a psychological state.

Preferred later wording, if mechanism-specific evidence also supports it, is along the lines of: “Your tactical miss rate is higher after two consecutive losses; this is evidence consistent with tilt-like deterioration.”

A later `DiagnosticFindingDraft` builder may consume this aggregate together with tactical/timing mechanism evidence, opponent-strength composition, and other confounder checks. It must not reimplement sessionization or silently upgrade this association into a causal or psychological fact.
