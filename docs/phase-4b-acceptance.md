# Phase 4B timing/context integration and acceptance

**Status:** acceptance implementation for issue #67  
**Date:** 2026-09-20  
**Umbrella:** #56 — Phase 4B time-management and contextual longitudinal evidence  
**Phase boundary:** deterministic aggregate evidence only; diagnosis persistence, ranking, relationship synthesis, API/UI exposure, and AI explanation remain outside this acceptance pass.

## Accepted product slice

Phase 4B composes the trustworthy timing, engine, and imported-game projections into these bounded longitudinal aggregates:

- `TIME-001` — frequent time-pressure exposure;
- `TIME-002` — move-quality collapse under time pressure;
- `TIME-003` — played-too-fast behavior with ample clock;
- `TIME-004` — early time overuse -> later pressure -> degraded play;
- `TIME-005` — exact time-control underperformance;
- `TIME-006` — increment versus no-increment effect;
- `TIME-007` — opponent move-speed effect;
- `RATING-001` — opponent-strength effect;
- `RATING-002` — opponent-strength composition warning.

All nine aggregates consume the shared `time-behavior-v1` policy for the semantics they share. Timing aggregates consume the current timing-derivation projection; quality aggregates consume only current complete engine evidence tied to the current ply-index source snapshot.

The composed authority chain is:

```text
authenticated Lichess import
  -> normalized game + exact control/increment + source clocks + ratings
  -> ply indexing + current timing derivation
  -> current complete engine projection
  -> Phase 4B bounded repository views
  -> time-behavior-v1 aggregate policy
  -> deterministic timing/rating evidence with explicit coverage
  -> future Phase 5 diagnosis synthesis
```

There is intentionally no new Phase 4B orchestration framework. Integration is proved at three existing seams:

1. `pipeline-acceptance.test.mjs` proves import -> indexing/timing -> current analysis;
2. each Phase 4B Prisma repository test proves the aggregate reads the authoritative owned/current projection and fences stale or foreign rows;
3. `phase-4b-acceptance.test.mjs` proves the leaf aggregates compose consistently over one synthetic account model.

## Canonical synthetic account fixture

`apps/api/test/phase-4b-acceptance.test.mjs` models one synthetic account with scoped cohorts rather than forcing every mechanism into the same games.

The fixture demonstrates:

- a 3+0 cohort with repeated pressure exposure and worse quality under pressure;
- a 3+2 cohort at the same initial time with better result/quality/pressure metrics;
- an ample-clock cohort with repeated unusually fast decisions and worse quality;
- an early-overuse cohort with the ordered overuse -> later pressure -> quality-degradation chain;
- an opponent-speed cohort with faster/worse responses after unusually fast opponent moves;
- a rating cohort with exact-control-matched adjacent opponent-strength bands;
- materially different opponent-strength composition attached to the increment comparison;
- neutral/no-effect fast-play and early-overuse fixtures that retain exposure but do not emit a positive mechanism status.

The synthetic service fixture is not a replacement for the database-backed leaf tests. It is the cross-aggregate composition proof; persistence, ownership, range, timing derivation, phase projection, and engine-provenance correctness stay covered at their owning boundaries.

## Integration acceptance matrix

| Requirement | Acceptance evidence |
| --- | --- |
| All Phase 4B leaf issues are integrated on the same main-equivalent tree | #57 through #66 are merged before #67. The acceptance PR is based on current `main` after the final `RATING-001` merge. |
| Import -> ply timing -> current engine projection -> timing aggregates | `pipeline-acceptance.test.mjs` proves the upstream persisted pipeline. Each `TIME-*` Prisma test indexes owned fixture games and validates the aggregate-specific repository view; quality aggregates additionally verify current-analysis provenance. |
| Exact control and increment identity survive relevant comparisons | `phase-4b-acceptance.test.mjs` asserts 3+0 remains `180+0`, 3+2 remains `180+2`, `TIME-005` selects the same-initial/different-increment comparator, and `TIME-006` preserves both exact controls inside its matched initial-time stratum. |
| Missing, inconsistent, or externally adjustable timing is coverage loss | Focused `TIME-001/002/003/004/006/007` tests cover unavailable/inconsistent timing and reliability flags. They report partial/unavailable coverage rather than silently treating the move/game as normal evidence. |
| Stale or superseded engine analysis is fenced from every quality-effect aggregate | Prisma tests for `TIME-002/003/004/005/006/007` and `RATING-001` tie quality evidence to the current ply-index snapshot/current complete analysis and verify stale analysis does not contribute. |
| Shared pressure, ample-clock, fast-decision, early-phase, opponent-speed, rating-band, sample, and rounding semantics come from #57 | Every cross-slice result in `phase-4b-acceptance.test.mjs` is asserted to carry `TIME_BEHAVIOR_POLICY_VERSION`; focused policy boundary tests remain in `time-behavior-policy.test.mjs`. |
| Pressure exposure and pressure-quality collapse compose | The acceptance fixture reports five pressure-entering games at 50% exposure and a +70cp matched pressure quality delta with LOW evidence, while keeping exposure and quality as separate aggregates. |
| Played-too-fast behavior requires ample clock and worse matched quality | The acceptance fixture produces repeated fast ample-clock decisions with a +70cp matched quality delta and `WORSE_QUALITY_ASSOCIATION`. The no-effect fixture keeps five fast ample-clock exposures but returns `NOT_SUPPORTED`. |
| Early time overuse requires the ordered chain | The acceptance fixture has five early-overuse games, five later-pressure games, five degraded-quality chains, and `ORDERED_ASSOCIATION`. A neutral-quality fixture retains early-overuse and pressure exposure but returns zero complete chains and `NOT_SUPPORTED`. |
| Opponent move-speed effect uses the actual preceding opponent ply | `phase-4b-acceptance.test.mjs` shows a -250cs response-time delta and +70cp quality delta. Focused `opponent-move-speed-effect.test.mjs` covers preceding-ply identity, missing predecessors, fast sequences, and exact-control/phase matching. |
| 3+0 versus 3+2 remains distinguishable | The shared acceptance fixture reports `TIME-005` and `TIME-006` deltas without pooling the controls: 3+0 and 3+2 remain explicit arm identities throughout. |
| Increment effect preserves separate result, quality, and timing evidence | The acceptance fixture asserts result, score-loss, and pressure-entry deltas in the same 180-second initial-time stratum. Focused tests cover independent coverage/evidence gates for the three modalities. |
| `RATING-002` attaches as confounder context without mutating the measured effect | The acceptance fixture runs `getIncrementEffect()` with a material rating-composition difference, verifies the warning is attached, and verifies the already measured increment deltas are unchanged. |
| `RATING-001` compares adjacent bands only inside exact control | The acceptance fixture demonstrates a +60cp STRONGER-vs-EVEN quality delta in 3+0 and a zero delta in 3+2. Focused tests cover all five bands, boundary values, sparse arms, and adjacent-band rules. |
| Weaker-arm/sample/coverage behavior is consistent | Cross-slice positive fixtures use five supporting games per relevant arm and resolve to LOW evidence. Focused tests for every comparison aggregate cover weaker-arm insufficiency and the shared 50% evidence-coverage floor. |
| Negative/no-effect exposure does not become a positive mechanism | `phase-4b-acceptance.test.mjs` explicitly exercises neutral `TIME-003` and `TIME-004` fixtures. Existing focused tests also preserve neutral/negative deltas for `TIME-002/005/006/007` and `RATING-001`. |
| Rating composition is disclosure, not adjustment | `RATING-002` remains a separate typed aggregate. Consumers attach it alongside the raw effect; no consumer changes result/quality/timing deltas in response to the warning. |
| Bounded-query, snapshot-drift, ownership, and range invariants hold | Every Phase 4B service test covers candidate caps/snapshot drift where applicable; every Prisma repository test enforces `appUserId` ownership and bounded/ranged reads. `RATING-002` additionally fails closed when requested game IDs are foreign/deleted/changed. |
| Documentation describes implemented capability and residual gaps | This document is canonical for the Phase 4B acceptance decision. Root README and diagnosis-module README link the complete implemented timing/rating slice and identify Phase 5 as the next diagnosis-synthesis boundary. |
| Full repository/DB validation | GitHub CI on the #67 PR is the merge gate for Prisma schema validation/migration bootstrap, typecheck, lint plus architecture/hygiene guardrails, production build, and the complete test suite including this acceptance harness. |

## Integration conclusions

The Phase 4B leaf aggregates compose without a new shared persistence model or orchestration service.

The accepted boundaries are:

- source clocks, exact time controls, increments, ratings, and results remain authoritative imported facts;
- timing classification is versioned and never reconstructed from missing clocks;
- current engine evidence is a separate provenance-sensitive modality;
- exact control and stabilized phase are matching dimensions where the policy requires them;
- comparison evidence is gated by the weaker arm rather than by a pooled denominator;
- opponent-strength composition is a confounder disclosure, not an explanation or correction;
- exposure is not automatically promoted into a mechanism;
- outputs remain deterministic aggregate evidence suitable for a later diagnosis builder.

## Residual calibration and interpretation limits

These are accepted limitations, not hidden blockers for #67:

- `time-behavior-v1` thresholds are explicit product-policy choices and still require Phase 7 calibration against broader real-game samples.
- Evidence grades are deterministic sample/coverage grades, not statistical-significance claims or confidence intervals.
- `RATING-002` reports composition differences but does not statistically adjust an effect for rating or other covariates.
- Exact-control and increment comparisons remain observational and player-relative; they do not establish that the control or increment caused the measured difference.
- `TIME-003/004/007` remain behavioral associations and do not infer premove intent, panic, intimidation, fatigue, tilt, or another psychological state.
- The acceptance fixture uses deterministic synthetic analysis objects. Real Stockfish process economics, threshold calibration, and broader false-positive/false-negative review remain Phase 7 work.
- Phase 4 still has optional breadth outside this milestone, notably `CAL-001` local-time analysis once an explicit user IANA timezone exists and `SESSION-003` stopping-point recommendation.
- There is no persisted/ranked diagnosis graph yet. Phase 5 owns finding construction, relationship consolidation, prioritization, and the product-level answer to “Why do I suck at chess?”

## Exit decision

When the #67 PR passes the full repository gate and independent review, Phase 4B satisfies umbrella #56:

- the complete timing/rating aggregate slice is integrated;
- provenance, timing loss, matching loss, and evidence strength remain inspectable;
- 3+0 versus 3+2 and increment effects remain explicit rather than pooled away;
- positive and neutral mechanism fixtures behave differently for evidence-backed reasons;
- rating composition is visible as confounder context without rewriting measured effects;
- the repository has a canonical acceptance matrix that future Phase 5 work can reference.

After merge, #56 can close and the next planning decision can be made explicitly between remaining Phase 4 breadth and Phase 5 diagnosis persistence/synthesis.
