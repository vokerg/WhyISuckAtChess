# diagnosis module seam

Owns bounded cross-game aggregation, evidence strength/coverage, finding construction, relationship/deduplication, and later diagnosis synthesis. This module must not import Lichess/provider DTOs directly.

Issue #52 adds the first implemented Phase 4 aggregate: `session-deterioration-v1` composes the `sessions` boundary with current complete engine move-quality evidence for `SESSION-001`. It remains aggregate evidence only; persistence, ranking, API/UI exposure, and psychological interpretation stay outside this slice.

Issue #54 adds `loss-streak-deterioration-v1` for `SESSION-002`: it reuses `session-v1` prior-loss-streak context, matches streak/non-streak candidates by ordinal and exact time control, and compares provenance-safe move quality without asserting tilt or causality.
