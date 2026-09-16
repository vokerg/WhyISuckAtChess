# Late-session move-quality deterioration aggregate

**Status:** initial Phase 4 aggregate evidence contract  
**Scope:** issue #52  
**Depends on:** `session-v1` from issue #50 and current complete Stockfish move-quality evidence

## Purpose

`SESSION-001 LATE_SESSION_DETERIORATION` needs a reproducible cross-game comparison before the diagnosis layer can persist, rank, or explain a finding. The `diagnosis` module therefore owns a typed aggregate that composes the existing session boundary with current complete engine evidence.

This slice produces aggregate evidence only. It does not assert fatigue, tilt, causality, a stopping point, or a user-facing diagnosis.

## Reference / delta

The implementation follows CRT's `player-chess-profile` pattern for bounded SQL aggregation, explicit denominators, deterministic evidence grades, and pure metrics separated from Prisma.

Why-specific changes are:

- `session-v1` is the sole authority for chronology, session membership, and ordinal;
- the baseline is the player's own games 1–3 within covered sessions;
- the comparison arm is game 4+;
- move quality uses current complete engine analysis tied to the current ply-index source projection;
- per-game average score loss is averaged with equal game weight, while mistake/blunder rates retain their analysed-move denominator.

## Policy identity

The initial aggregation policy is `session-deterioration-v1`.

- early arm: session ordinals 1–3;
- late arm: ordinal 4+;
- minimum required engine-analysis coverage: 50% in each arm;
- comparative evidence strength uses the weaker analysed-game arm: <5 `INSUFFICIENT`, 5–14 `LOW`, 15–39 `MEDIUM`, >=40 `HIGH`.

These thresholds are calibration-sensitive. Changing them requires a policy-version bump.

The grade is an evidence-strength label, not a statistical-significance claim.

## Metrics and coverage

Each arm exposes eligible and analysed games, eligible and analysed distinct sessions, analysis coverage, analysed user moves, mean per-game score loss, mistake+blunder rate, and blunder rate. The comparison exposes late-minus-early deltas.

Games without trustworthy `session-v1` chronology are not assigned heuristically. Games whose engine analysis is absent, incomplete, stale, or tied to a superseded ply-index projection remain eligible session games but do not count as analysed evidence.

The Prisma query receives only owned, session-covered game ids and aggregates move-quality fields in SQL. It does not load whole game/ply graphs into Node.

## Interpretation boundary

Positive CPL or error-rate deltas mean the measured move-quality metric is worse in the late arm. They do not by themselves prove fatigue or tilt. The v1 aggregate also does not yet match or adjust exact time control, opponent strength, opening mix, or local time; those composition differences remain caveats for later diagnosis-building work.

A later `DiagnosticFindingDraft` builder may consume this aggregate together with mechanism-specific evidence and confounder checks. It must not reimplement sessionization or silently upgrade this association into a causal claim.
