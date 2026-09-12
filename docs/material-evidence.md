# Material evidence detector

**Status:** Phase 3 deterministic evidence policy  
**Scope:** issue #28  
**Detector:** `material-state@material-v1`  
**Depends on:** `docs/deterministic-evidence.md`, current ply indexing, and current Stockfish analysis when engine-dependent mechanisms are evaluated

## Purpose

This detector turns reconstructed positions plus existing Stockfish evidence into inspectable material facts. It produces evidence only; it does not aggregate across games, rank diagnoses, infer intent, or generate recommendations.

The detector runs in the persistent worker through the generic evidence substrate and is eligible for standard bullet, blitz, and rapid under the same source/provenance rules as the substrate.

## Framework-neutral material accounting

`packages/chess-domain/src/material.ts` owns deterministic material accounting and legal-capture inspection.

The measurement scale is intentionally conventional and simple:

- pawn = 1
- knight = 3
- bishop = 3
- rook = 5
- queen = 9
- king is excluded from material totals

These values are measurements for explaining material changes; they are not a substitute for engine evaluation.

Normalized four-field position FENs are accepted directly. Legal moves are verified with chess.js before they can support capture evidence.

## Evidence types

### `MATERIAL_STATE_CHANGE`

Emitted whenever a ply changes the user's material balance.

The event records the exact ply/after-position, move, captured/promoted piece, material balance before and after, and the delta from the user's perspective. Captures by either side are represented with the same user-perspective sign.

This event is factual board evidence. It does not by itself say that the move was good, bad, forced, or tactical.

### `HANGING_MATERIAL`

A user move is labeled simple hanging/undefended material only when all of these are true:

1. the current game-analysis projection is complete and provenance-current;
2. the user move loses at least 80 centipawns under the existing per-ply score-loss calculation;
3. Stockfish's best reply from the exact after-position is a legal on-board capture;
4. the captured piece belongs to the user;
5. the target square has no user defender in the board attack map.

This deliberately requires both direct geometry and engine-backed practical consequence. Geometry alone does not imply severity.

An engine-approved sacrifice with negligible score loss is therefore not labeled as simple hanging material even when the opponent's best reply is to capture it.

### `MISSED_MATERIAL_WIN`

A user move is labeled a missed material win only when:

1. the played move differs from Stockfish's best move;
2. the played move loses at least 80 centipawns;
3. the engine best move is a legal on-board capture; and
4. that capture is conservatively favorable because either:
   - the captured target is undefended, or
   - the captured piece is worth more than the attacking piece.

The event records the played move, engine best move, attacker/target squares and pieces, defender squares, material values, immediate material gain, and score loss.

A defended equal exchange is not called a missed material win merely because the engine happened to prefer that capture.

## Overlap and deduplication

One chess event should not explode into duplicate mechanisms.

When the player misses a favorable capture with a piece and the opponent's immediate best reply simply captures that same would-be attacker, the detector keeps the more specific `MISSED_MATERIAL_WIN` event and suppresses the redundant `HANGING_MATERIAL` event for that ply.

Independent mechanisms on the same ply remain representable when they involve different pieces/events.

## Coverage semantics

Material evidence is intentionally board-first. The detector declares `requiresCompleteAnalysis=false` and `refreshOnCompleteAnalysis=true`.

That means an indexed game can produce factual `MATERIAL_STATE_CHANGE` events before Stockfish is complete. When complete current analysis is absent, the same run also publishes `INCOMPLETE` coverage plus a `MATERIAL_EVIDENCE_COVERAGE_GAP` event whose unavailable reason is `complete-engine-analysis-unavailable`; engine-dependent `HANGING_MATERIAL` and `MISSED_MATERIAL_WIN` findings are not guessed.

Once a complete provenance-current Stockfish run exists and every ply points at it, the evidence scheduler creates a new immutable material-evidence run bound to that analysis snapshot. Successful publication supersedes the earlier board-only current run, so consumers do not retain a stale "analysis unavailable" gap after engine evidence becomes available.

The detector also validates supplied snapshots defensively. Missing board positions, illegal source moves, mismatched analysis-run provenance, missing position analysis, or missing user score-loss evidence produce explicit incomplete coverage rather than a negative finding.

Detector output is capped below the substrate's per-run event limit. Hitting the detector cap produces `PARTIAL` coverage instead of silently truncating a supposedly complete run.

## Versioning

The following are detector-policy semantics and require a detector-version bump when changed materially:

- piece-value measurement scale;
- score-loss threshold;
- definition of "undefended";
- favorable-capture predicate;
- overlap/deduplication rules;
- event payload semantics.

Cross-game recurrence thresholds and diagnosis ranking remain future aggregation work and are intentionally outside this detector.
