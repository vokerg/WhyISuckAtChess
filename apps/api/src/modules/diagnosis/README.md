# diagnosis module seam

Owns bounded cross-game aggregation, evidence strength/coverage, finding construction, relationship/deduplication, and later diagnosis synthesis. This module must not import Lichess/provider DTOs directly.

Issue #52 adds the first implemented Phase 4 aggregate: `session-deterioration-v1` composes the `sessions` boundary with current complete engine move-quality evidence for `SESSION-001`. It remains aggregate evidence only; persistence, ranking, API/UI exposure, and psychological interpretation stay outside this slice.

Issue #54 adds `loss-streak-deterioration-v1` for `SESSION-002`: it reuses `session-v1` prior-loss-streak context, matches streak/non-streak candidates by ordinal and exact time control, and compares provenance-safe move quality without asserting tilt or causality.

Issue #58 adds `rating-context-composition-v1` for `RATING-002`: it accepts two bounded disjoint owned game-ID arms, summarizes user-relative rating-difference bands using `time-behavior-v1`, and emits a nullable composition warning without adjusting another aggregate's measured effect. See `docs/rating-context-composition.md`.

Issue #59 adds `time-pressure-exposure-v1` for `TIME-001`: it performs a bounded owned-game timing read, counts only games with complete trustworthy user-decision timing for recurrence, preserves exact-control/increment strata, and reports first pressure entry with current phase context where available. It is exposure evidence only; `TIME-002` owns move-quality deterioration. See `docs/time-pressure-exposure.md`.

Issue #60 adds `time-pressure-quality-collapse-v1` for `TIME-002`: it compares current complete engine move quality in shared pressure/normal exact-control + phase strata, keeps timing/context/analysis loss explicit, and attaches `RATING-002` only when the analyzed game arms are disjoint. See `docs/time-pressure-quality-collapse.md`.

Issue #61 adds `exact-time-control-underperformance-v1` for `TIME-005`: it keeps exact controls distinct, selects a same-initial different-increment comparator through the shared evidence gate, reports result and current-engine quality with separate coverage, and attaches `RATING-002` as a non-adjusting confounder disclosure. See `docs/exact-time-control-underperformance.md`.

Issue #62 adds `increment-effect-v1` for `TIME-006`: it compares increment and no-increment games only within the same exact initial-time stratum, preserves represented exact controls, reports result/current-engine/pressure metrics with separate coverage and evidence grades, and attaches `RATING-002` per matched stratum without adjusting raw deltas. See `docs/increment-effect.md`.

Issue #63 adds `played-too-fast-v1` for `TIME-003`: it isolates policy-defined fast user decisions made with ample clock, compares current complete engine quality against exact-control/phase-matched normal-pace decisions, keeps low-clock fast moves as explicit exclusions, and only reports a positive mechanism status when sufficient evidence shows worse fast-arm quality. See `docs/played-too-fast.md`.

Issue #64 adds `early-time-overuse-v1` for `TIME-004`: it measures same-control OPENING-time overuse against the player median, requires later observed pressure followed by worse exact-control/phase-matched current-engine quality, and preserves every broken chain link and coverage gap. See `docs/early-time-overuse.md`.

Issue #65 adds `opponent-move-speed-effect-v1` for `TIME-007`: it joins each user response to the actual immediately preceding opponent ply, compares response speed and current-engine quality after fast versus normal opponent moves inside exact-control/phase strata, exposes fast-opponent sequence and phase-composition context, and attaches `RATING-002` when the compared game-ID arms are disjoint. See `docs/opponent-move-speed-effect.md`.
