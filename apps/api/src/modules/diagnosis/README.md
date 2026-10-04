# diagnosis module seam

Owns bounded cross-game aggregation, evidence strength/coverage, finding construction, relationship/deduplication, root synthesis, and deterministic ranking. This module must not import provider/Lichess DTOs, web/UI code, or AI-provider code directly.

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

## Phase 5 evidence identity and overlap

Issue #84 implements `diagnosis-event-identity-v1` and deterministic pair/cluster overlap accounting; see `docs/diagnosis-evidence-overlap.md`.

- `diagnosis-overlap.service.ts` keeps event overlap separate from game-set overlap, exposes arm/union/rate/distinct-game/session context, and fails closed when complete stable identity is unavailable.
- `diagnosis-overlap.repository.prisma.ts` reuses the current finding boundary and rejects missing, unavailable, non-succeeded, superseded, or cross-owner referenced evidence events.
- opening recurrence plies and complete `TIME-004` chain games carry stable event identity where the upstream source shape is sufficient.
- cluster work is bounded by the shared 200-current-findings / 1,000-references-per-finding policy; truncated reference sets are not upgraded to authoritative overlap.

Relationship construction (#85), consolidation (#86), root synthesis (#87), and deterministic ranking (#88) now consume this overlap boundary.

## Phase 5 typed relationship graph

Issue #85 adds `diagnosis-relationship-graph-v1`; see `docs/diagnosis-relationship-graph.md`.

- `diagnosis-relationship.service.ts` builds only the seven taxonomy relationship types from current `PROBLEM_DETECTED` findings, explicit typed rules, #84 overlap output, and explicit `RATING-002` confounder evidence.
- `SHARES_EVENTS_WITH` and overlap-backed `CONDITIONAL_ON` edges consume `diagnosis-overlap-v1`; they do not recompute or approximate event overlap.
- `diagnosis-relationship.repository.prisma.ts` atomically replaces the current finding set's relationship rows and rejects endpoints outside the owned current set.
- context values remain dimensions; they are never persisted as graph nodes.
- graph generation is bounded, deterministic, and versioned with `diagnosis-synthesis-v1`.

Consolidation (#86), synthesized root candidates (#87), and ranking (#88) consume this graph; ranking still treats the graph only through persisted hierarchy/overlap state.


## Phase 5 deterministic consolidation

Issue #86 adds `diagnosis-consolidation-v1`; see `docs/diagnosis-consolidation.md`.

- `diagnosis-consolidation.service.ts` consumes current canonical findings, #84 overlap, and persisted #85 relationship edges without recomputing detector facts.
- specific supported mechanisms may suppress materially overlapping generic observations/broader mechanisms only through `SPECIALIZES` or `EXPLAINS_OBSERVATION`; incomplete or sub-material overlap fails closed.
- contributing conditions and explicit confounders remain visible, while unresolved material overlap remains independently rankable but explicitly marked for #88's overlap multiplier.
- `DiagnosisFindingConsolidation` persists one explicit hierarchy state per current finding, including top-level eligibility, representative/cluster membership, deterministic reason keys, policy version, and inspectable support.
- recalculation atomically replaces derived consolidation state for the current finding set; canonical findings and source evidence are never deleted or rewritten.

Root-cause synthesis (#87) and deterministic ranking (#88) consume this hierarchy.

## Phase 5 deterministic root-cause synthesis

Issue #87 implements registered `diagnosis-synthesis-v1` root promotion; see `docs/diagnosis-root-cause-synthesis.md`.

- `diagnosis-root-cause.service.ts` consumes only current supported top-level consolidated findings and current typed relationships.
- mandatory mechanism evidence must expose a complete current stable event set; aggregate context may contribute authoritative counts/effects without invented game IDs when its typed relationship does not require overlap.
- promotion enforces at least five distinct supporting games, the 50% coverage gate, the 50% maximum single-game event share, and theme-specific distinct-session recurrence.
- only `CLOCK_MANAGEMENT_DRIVING_TACTICAL_COLLAPSE` and `LATE_SESSION_TACTICAL_DETERIORATION` can promote under the v1 registry; supported `SESSION-003` plugs into the late-session proof only as additional support.
- `DiagnosisRootCandidateSupport` preserves same-revision child finding IDs plus the source relationship/consolidation/effect/coverage proof for drill-down.
- root publication uses the #82 immutable replacement lifecycle. The replacement keeps every component finding, appends synthesized roots, supersedes the source revision, and intentionally requires #85/#86 refresh before #88 ranking.

Deterministic ranking (#88) consumes the refreshed hierarchy.


## Phase 5 deterministic ranking

Issue #88 implements persisted `diagnosis-ranking-v1` execution; see `docs/diagnosis-ranking.md`.

- `diagnosis-ranking.service.ts` ranks only current supported top-level consolidation state and supported synthesized roots.
- frequency, severity, evidence, optional session recurrence, and deterministic finding-level specificity use fixed versioned normalization keys; optional unavailable components are omitted and weights renormalized rather than treated as zero.
- synthesized roots derive severity from the strongest normalized mandatory child effect without inventing a cross-family raw metric; supporting children remain drill-down ranking rows and receive no independent top-level rank.
- unresolved material overlap receives the policy-defined 0.75 multiplier; raw effects, coverage, evidence grade, confounder IDs, and hierarchy state remain inspectable.
- `DiagnosisFindingRanking` persists one derived ranking row per ranked/drill-down finding on the immutable finding set; stale/superseded set writes fail closed.
- exact-score ties use evidence grade, distinct-game count, diagnosis ID, then stable finding key.

## Phase 5 integration acceptance

Issue #89 accepts the complete deterministic Phase 5 hierarchy described in `docs/phase-5-acceptance.md`.

- `phase-5-acceptance.test.mjs` composes current candidate projection, event overlap, typed relationships, consolidation, root synthesis, hierarchy refresh, and ranking across one canonical synthetic scope.
- `TIME-002` candidate projection preserves its `RATING-002` composition result so the generic graph can persist explicit `CONFOUNDED_BY` semantics without silently adjusting the measured effect.
- material overlap between a current synthesized root and the child finding whose stable events it deliberately copies remains measurable, but consolidation no longer treats that known support pair as unresolved duplicate evidence or applies the #88 overlap penalty to the root.
- overlapping specific/generic labels collapse to drill-down through the accepted typed relationship + material-overlap contract; root children remain non-top-level ranking rows while unrelated findings retain independent ranks.
- sparse evidence remains `INSUFFICIENT_EVIDENCE` rather than becoming either a positive or a clean negative; stale synthesis/ranking versions fail closed.
- the candidate registry continues to expose unsupported taxonomy breadth rather than inventing aggregates. `CAL-001` remains deferred until authoritative user IANA timezone data exists.
- diagnosis architecture guardrails reject provider, Angular/Chessground/web UI, and AI-provider imports. Phase 6 explanation may consume bounded accepted outputs but cannot become calculation authority.

With #89 merged, #80's Phase 5 deterministic engine milestone is complete; the next product work is Phase 6 read models/explanation/UI.

## Phase 6 diagnosis summary read model

Issue #100 introduces the first Phase 6 consumer boundary; see `docs/diagnosis-summary-read-model.md`.

- `diagnosis-summary.repository.prisma.ts` performs an ownership-scoped read of the one current finding set and projects only fields required by the product contract.
- `diagnosis-summary.service.ts` validates current synthesis/consolidation/ranking generations and persisted rank completeness; it never runs diagnosis recalculation.
- `diagnosis.routes.ts` exposes authenticated `GET /api/diagnosis/summary?scopeKey=...` through strict shared contracts.
- only persisted top-level ranked findings cross the summary boundary; synthesized-root children remain drill-down state and representative evidence is bounded to three references.
- stale/incomplete hierarchy state is returned explicitly as unavailable instead of exposing a partially recalculated diagnosis.

This is a read boundary only. Later Phase 6 UI and optional AI explanation must consume it (or similarly bounded drill-down contracts) rather than importing diagnosis persistence or becoming calculation authority.


## Phase 6 diagnosis drill-down read model

Issue #104 extends the consumer boundary with authenticated `GET /api/diagnosis/findings/:findingId?scopeKey=...`; see `docs/diagnosis-summary-read-model.md`.

- the selected parent must already appear in the current persisted top-level summary;
- `diagnosis-drill-down.repository.prisma.ts` reads only same-revision child ranking rows whose persisted `parentRootFindingIds` contains that parent and projects a bounded representative-evidence slice;
- same-revision `DiagnosisRootCandidateSupport` supplies the typed child role; missing/ambiguous support state fails closed instead of reconstructing hierarchy;
- `diagnosis-drill-down.service.ts` preserves persisted final scores and parent assignment but gives children no independent top-level rank;
- current policy/version, consolidation, ownership, and boundedness checks remain authoritative;
- internal coverage/source-version/ranking/support JSON blobs and AI output stay behind the module boundary.

A later Angular drill-down consumer can use this contract without importing Prisma or duplicating Phase 5 policy.
