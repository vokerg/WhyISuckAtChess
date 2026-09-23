# diagnosis module seam

Owns bounded cross-game aggregation, evidence strength/coverage, finding construction, relationship/deduplication, and later diagnosis synthesis. This module must not import Lichess/provider DTOs directly.

Issue #52 adds the first implemented Phase 4 aggregate: `session-deterioration-v1` composes the `sessions` boundary with current complete engine move-quality evidence for `SESSION-001`. It remains aggregate evidence only; persistence, ranking, API/UI exposure, and psychological interpretation stay outside this slice.

Issue #54 adds `loss-streak-deterioration-v1` for `SESSION-002`: it reuses `session-v1` prior-loss-streak context, matches streak/non-streak candidates by ordinal and exact time control, and compares provenance-safe move quality without asserting tilt or causality.

Issue #79 adds `overlong-session-stopping-point-v1` for `SESSION-003`: it evaluates the fixed game-count thresholds 4–10, matches pre/post games inside the same session and exact control, requires material deterioration recurring across at least five distinct comparable sessions, and selects the earliest supported threshold without claiming fatigue or another psychological cause. It reuses the #52 provenance-safe `SessionGameQualityRepository`; see `docs/overlong-session-stopping-point.md`.

Issue #58 adds `rating-context-composition-v1` for `RATING-002`: it accepts two bounded disjoint owned game-ID arms, summarizes user-relative rating-difference bands using `time-behavior-v1`, and emits a nullable composition warning without adjusting another aggregate's measured effect. See `docs/rating-context-composition.md`.

Issue #59 adds `time-pressure-exposure-v1` for `TIME-001`: it performs a bounded owned-game timing read, counts only games with complete trustworthy user-decision timing for recurrence, preserves exact-control/increment strata, and reports first pressure entry with current phase context where available. It is exposure evidence only; `TIME-002` owns move-quality deterioration. See `docs/time-pressure-exposure.md`.

Issue #60 adds `time-pressure-quality-collapse-v1` for `TIME-002`: it compares current complete engine move quality in shared pressure/normal exact-control + phase strata, keeps timing/context/analysis loss explicit, and attaches `RATING-002` only when the analyzed game arms are disjoint. See `docs/time-pressure-quality-collapse.md`.

Issue #61 adds `exact-time-control-underperformance-v1` for `TIME-005`: it keeps exact controls distinct, selects a same-initial different-increment comparator through the shared evidence gate, reports result and current-engine quality with separate coverage, and attaches `RATING-002` as a non-adjusting confounder disclosure. See `docs/exact-time-control-underperformance.md`.

Issue #62 adds `increment-effect-v1` for `TIME-006`: it compares increment and no-increment games only within the same exact initial-time stratum, preserves represented exact controls, reports result/current-engine/pressure metrics with separate coverage and evidence grades, and attaches `RATING-002` per matched stratum without adjusting raw deltas. See `docs/increment-effect.md`.

Issue #63 adds `played-too-fast-v1` for `TIME-003`: it isolates policy-defined fast user decisions made with ample clock, compares current complete engine quality against exact-control/phase-matched normal-pace decisions, keeps low-clock fast moves as explicit exclusions, and only reports a positive mechanism status when sufficient evidence shows worse fast-arm quality. See `docs/played-too-fast.md`.

Issue #64 adds `early-time-overuse-v1` for `TIME-004`: it measures same-control OPENING-time overuse against the player median, requires later observed pressure followed by worse exact-control/phase-matched current-engine quality, and preserves every broken chain link and coverage gap. See `docs/early-time-overuse.md`.

Issue #65 adds `opponent-move-speed-effect-v1` for `TIME-007`: it joins each user response to the actual immediately preceding opponent ply, compares response speed and current-engine quality after fast versus normal opponent moves inside exact-control/phase strata, exposes fast-opponent sequence and phase-composition context, and attaches `RATING-002` when the compared game-ID arms are disjoint. See `docs/opponent-move-speed-effect.md`.

Issue #66 adds `opponent-strength-effect-v1` for `RATING-001`: it summarizes result/current-engine quality by the shared user-relative rating bands, exposes exact-control composition, and emits adjacent-band deltas only within one exact-control stratum with separate result/quality evidence grades. See `docs/opponent-strength-effect.md`.

Issue #67 adds the Phase 4B integration/acceptance boundary: `apps/api/test/phase-4b-acceptance.test.mjs` composes the `TIME-001`–`TIME-007` and `RATING-001/002` aggregate contracts over one synthetic account model, while `docs/phase-4b-acceptance.md` records the canonical integration matrix, provenance/coverage conclusions, and residual calibration limits. Phase 5 remains responsible for persistence, ranking, relationship consolidation, and diagnosis synthesis.

Issue #81 freezes the shared Phase 5 `diagnosis-synthesis-v1`, `diagnosis-consolidation-v1`, `diagnosis-ranking-v1`, and `diagnosis-event-identity-v1` policy in `docs/diagnosis-synthesis-ranking-policy.md` with framework-neutral constants in `packages/chess-domain`. Later Phase 5 leaves must consume that contract rather than inventing independent finding lifecycle, overlap, root-theme, or ranking semantics.

## Phase 5 canonical finding persistence

Issue #82 adds the durable current/superseded finding lifecycle described in `docs/diagnostic-finding-persistence.md`.

- `diagnosis-finding.types.ts` defines the canonical backend draft/read contract.
- `diagnosis-finding.service.ts` validates Phase 5 bounds, effect/count/coverage fields, JSON payloads, duplicate identities, representative limits, and source reference shapes before persistence.
- `diagnosis-finding.repository.prisma.ts` atomically replaces one owned `scopeKey`, retains historical finding sets, fences cross-owner/current-evidence references, and returns only persisted snapshots.
- `DiagnosisFindingRelationship` is a persistence seam only; #85 owns graph construction and relationship policy execution.
- Recalculation never mutates or deletes imported-game, engine-analysis, evidence-event, or aggregate source facts.

## Phase 5 candidate projection

Issue #83 adds `diagnosis-candidate-projection-v1`, the typed adapter/registry boundary described in `docs/diagnosis-candidate-projection.md`.

- `diagnosis-candidate.registry.ts` projects existing authoritative aggregate/evidence results into `DiagnosisFindingDraft` without rerunning detector or aggregate logic.
- The registry owns `OPEN-002/003`, `TIME-001..007`, `SESSION-001..003`, and `RATING-001/002`; remaining taxonomy IDs are explicitly unsupported until a taxonomy-safe recurrence/aggregate contract exists.
- Source evidence strength, coverage, raw effects/units, dimensions, producer versions, and available supporting game/ply references remain inspectable.
- Aggregates that do not expose stable game/event membership do not receive invented evidence IDs; they fail closed for future overlap work.
- Duplicate producer ownership, supported/unsupported overlap, taxonomy omission, and projection-version drift fail at module initialization.

Stable event overlap (#84), relationship construction (#85), consolidation (#86), root synthesis (#87), and ranking (#88) remain subsequent Phase 5 leaves.

