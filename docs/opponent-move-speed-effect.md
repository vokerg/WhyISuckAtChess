# Opponent move-speed effect

**Diagnosis:** `TIME-007 OPPONENT_MOVE_SPEED_EFFECT`  
**Aggregate policy:** `opponent-move-speed-effect-v1`  
**Shared policy:** `time-behavior-v1`

## Purpose

This Phase 4 aggregate measures whether the player's response time or current engine move quality differs after policy-defined unusually fast opponent moves. It is a deterministic within-player association, not a causal or psychological claim.

A fast opponent move is an eligible derived move time of at most 1.0 second. A fast-opponent sequence is a run of at least two consecutive trustworthy opponent decisions at that threshold. Sequence context is descriptive only and does not infer premove intent.

## Alignment and eligibility

The aggregate reads the authoritative versioned ply timing projection for both colors.

For every eligible user response, the immediately preceding opponent move is joined by exact ply number:

- user response ply `n`;
- preceding opponent ply `n - 1`;
- the row at `n - 1` must exist and be an opponent move;
- both the opponent move time and user response time must be current, `AVAILABLE`, non-negative, and free of the external-clock-adjustment reliability flag.

Missing plies, unavailable/inconsistent timing, or a mover mismatch are explicit timing-coverage loss. The implementation never uses array adjacency as a substitute for the actual ply relationship.

First-move timing remains unavailable under the shared timing contract and is never reconstructed.

## Comparison

The two timing arms are:

- **exposed:** user responses immediately following a trustworthy opponent move at or below 1.0 second;
- **baseline:** user responses immediately following a trustworthy opponent move above 1.0 second.

Responses are compared only inside the shared v1 matching dimensions:

1. exact time-control key; and
2. stabilized phase of the user's before-position boundary.

One-sided exact-control/phase strata are excluded rather than pooled with another control or phase.

## Metrics

Each arm reports:

- matched response count and distinct supporting games;
- average user response time;
- current-complete engine analysis count and analysis coverage;
- average score loss;
- mistake+blunder rate;
- blunder rate;
- separate timing and quality required-evidence coverage.

The aggregate reports exposed-minus-baseline deltas for response time and quality.

Evidence strength is modality-specific:

- **timing evidence** uses distinct games plus paired timing/context/matching coverage;
- **quality evidence** additionally requires current complete engine coverage in both arms.

This keeps a trustworthy response-speed comparison available when engine evidence is incomplete instead of collapsing the whole aggregate to unavailable.

## Fast-opponent sequence context

A qualifying sequence is a maximal run that reaches at least two consecutive trustworthy fast opponent decisions in the opponent's own move sequence. Consecutive means the opponent plies advance by exactly two; missing or unreliable opponent timing breaks the run.

The result exposes:

- qualifying fast-opponent sequence count;
- exposed responses whose preceding opponent move completes or extends a qualifying sequence;
- games containing at least one qualifying sequence.

## Provenance and confounders

Only current complete engine analysis from the same current ply-index snapshot contributes move-quality metrics. Stale, superseded, incomplete, or missing analysis is explicit quality-coverage loss.

The result also exposes phase composition for each arm, including opening share, because fast play can be concentrated in familiar opening positions.

When the matched baseline/exposed game-ID arms are disjoint, the service attaches the reusable `RATING-002` opponent-strength composition aggregate. If a game contributes to both arms, the rating comparison is left unavailable because `RATING-002` deliberately requires disjoint input game sets.

The rating warning never adjusts or rewrites TIME-007's measured deltas.

## Interpretation boundary

Allowed wording is descriptive, for example:

- "responses were faster after unusually fast opponent moves";
- "move quality was worse in the exposed arm";
- "the exposed arm had more opening-phase responses";
- "opponent-strength composition differed between the compared game sets."

Do not say that opponents "make the player panic", intimidate the player, force impulsive play, or otherwise establish a mental or causal explanation. Fast opponent moves may proxy opening familiarity, exact time control, opponent strength, or other unmeasured context.

## Coverage and bounds

The service:

- is ownership-scoped;
- accepts an optional bounded start-time range;
- rejects scopes above 5,000 candidate games before loading rows;
- fails closed on candidate-set drift;
- preserves missing timing, context, matching, and engine evidence as separate coverage loss;
- uses the shared 50% coverage and 5/15/40 distinct-game evidence thresholds.

Phase 5 may consume this structured aggregate as contributing-condition evidence without changing ingestion, timing, engine, or rating provenance rules.
