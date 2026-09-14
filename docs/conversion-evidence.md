# Conversion, throw, and save evidence

**Status:** Phase 3 deterministic evidence policy  
**Scope:** issue #32  
**Detector:** `conversion-transition@conversion-v1`  
**Depends on:** complete current Stockfish analysis, `phase-context@phase-v1`, and the deterministic evidence substrate

## Purpose

This detector turns an analysed game's evaluation trajectory into bounded state-transition evidence. It records when the user loses a meaningful winning state, throws a non-losing state into a losing state, or preserves a recovery from a losing state.

It is per-game evidence only. It does not claim that the player has a recurring conversion weakness, explain the chess mechanism behind every transition, or adjudicate tablebase truth.

## CRT reference and intentional delta

The pinned Chess Repertoire Trainer reference (`vokerg/chess_repertoir_trainer@13a7e2791944ebd52113afe9f76413b10634ddff`) provides the baseline user-perspective evaluation math and story concepts such as endgame throw/save, lost winning position, and clean/failed conversion. Section 7 of `docs/crt-delta-map.md` also requires score perspective and analysis provenance to remain explicit.

Why preserves those deterministic principles and the practical `700cp` decisive threshold, but changes the representation from compact game tags to source-linked state transitions. Each event carries exact start/end plies, position IDs, raw white-perspective and user-perspective engine measurements, phase/endgame context, detector policy, and current analysis provenance through the evidence run.

The detector reuses `phase-v1` by calling the existing phase detector over the same immutable snapshot. It does not own or duplicate phase/endgame classification rules.

## Evaluation state policy

`conversion-v1` uses three practical engine bands from the user's perspective:

- **WINNING:** forced mate for the user, or centipawn evaluation `>= +700cp`.
- **LOSING:** forced mate against the user, or centipawn evaluation `<= -700cp`.
- **DRAWABLE:** every analysed non-mate position strictly between those decisive thresholds.

`DRAWABLE` is intentionally a practical non-decisive engine band. It does **not** mean a tablebase-proven theoretical draw. Tablebase adjudication is outside issue #32.

Stockfish scores remain stored in white perspective. The detector converts both centipawn and mate signs to the imported user's color before banding. A non-zero mate score overrides any centipawn value for state classification; raw centipawn and mate values are still retained separately in event measurements.

Changing either threshold, mate precedence, state meaning, overlap policy, or event payload semantics requires a detector-version bump.

## Event semantics

### `FAILED_CONVERSION`

A user move changes the state from `WINNING` to `DRAWABLE` without a deeper user-caused transition to `LOSING` in the same contiguous collapse sequence.

This is evidence that a meaningful advantage was lost. It does not assert why.

### `EVALUATION_THROW`

A user move changes `WINNING` or `DRAWABLE` to `LOSING`.

For a gradual `WINNING -> DRAWABLE -> LOSING` collapse where both downward boundaries are crossed by user moves, the detector emits **one** decisive throw spanning the whole sequence. It does not also emit a failed-conversion event for the intermediate state.

A direct `WINNING -> LOSING` transition has severity level 2 / `DECISIVE`; adjacent-band transitions have severity level 1 / `MAJOR`.

### `EVALUATION_SAVE`

A `LOSING` state becomes `DRAWABLE` or `WINNING`.

If the user move directly creates the recovery, the transition is immediately evidence. If an opponent move creates the recovery opportunity, the event is emitted only when the next user move preserves a non-losing state. An opponent gift that the user immediately gives back is therefore not labelled a save.

## Sequence and overlap policy

Consecutive boundaries in the same state are compacted into a single state run. Events are created only at meaningful band changes, never once per analysed ply.

The start of an event is the first move after the source state began; the end is the transition or confirmation ply. This makes a slow deterioration inspectable without producing repeated overlapping events for each intermediate evaluation change.

The detector is intentionally conservative about attribution:

- worsening transitions are evidence only when the band-crossing move is the user's;
- an opponent-created recovery requires user confirmation;
- gaps split the trajectory, so states are never interpolated across unknown evidence.

## Phase and endgame context

Every event records the `phase-v1` phase and endgame family at both endpoints. Phase context is descriptive evidence; it does not change the transition thresholds.

Unknown phase/endgame context breaks the sequence and yields incomplete conversion coverage. This prevents the detector from silently inventing context across a board/classification gap.

## Coverage and provenance

The detector requires a provenance-current complete analysis run. Each position boundary must have:

- the expected current analysis projection;
- a usable centipawn or mate evaluation;
- current `phase-v1` context.

Missing engine or phase evidence breaks the current trajectory segment and emits `CONVERSION_EVIDENCE_COVERAGE_GAP`. A gap is never interpreted as absence of a throw/save/conversion failure.

The detector uses the existing evidence substrate's source/index/analysis fencing and current-run publication rules. Bullet remains eligible under the same standard-chess policy as blitz and rapid.

## Boundedness

At most 96 conversion findings are persisted for one detector run. Reaching the cap marks coverage `PARTIAL` rather than silently pretending the event set is complete.

## Non-goals

`conversion-v1` does not:

- determine the tactical/endgame reason for every state transition;
- aggregate repeated events into a cross-game diagnosis;
- claim tablebase-perfect win/draw/loss truth;
- infer psychology, intent, tilt, or fatigue;
- replace the tactical/material/phase detectors with a monolithic story classifier.
