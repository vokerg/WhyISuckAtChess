# Diagnosis candidate projection

Status: implemented by issue #83.  
Depends on: Phase 5 policy #81, canonical finding persistence #82, and the accepted Phase 3/4 evidence contracts.

## Purpose

The candidate projection layer is the deterministic adapter boundary between existing evidence/aggregate outputs and the canonical Phase 5 finding draft. It does not rerun chess detectors, recalculate aggregate statistics, invent missing event identity, or reinterpret stale evidence.

The flow is:

    authoritative detector / aggregate result
      -> registered candidate producer
      -> DiagnosisFindingDraft[]
      -> canonical finding-set materialization (#82)
      -> event overlap (#84) and later Phase 5 synthesis

The registry lives in apps/api/src/modules/diagnosis/diagnosis-candidate.registry.ts and is versioned as diagnosis-candidate-projection-v1.

## CRT reference / Why delta

### Reference

The primary CRT references are:

- apps/api/src/modules/player-chess-profile/player-chess-profile.metrics.ts for the deterministic 5/15/40 evidence grades, 50% analysis gate, explicit denominators, and reproducible metric helpers;
- apps/api/src/modules/player-chess-profile/player-chess-profile.service.ts for bounded repository/service separation and transparent coverage/supporting evidence;
- apps/api/src/modules/opening-struggles/opening-struggles.service.ts for keeping poor-result, repeated-move, and recurring-bad-position questions distinct instead of flattening them into one opening label.

### Preserve

- owned-player bounded inputs;
- the source aggregate's evidence grade and coverage gate;
- raw source effects and units;
- explicit comparison baselines and dimensions;
- deterministic stable ordering/identity inputs;
- source provenance and representative supporting games when the source exposes them;
- insufficient/unavailable states as normal outputs.

### Change

Why projects heterogeneous chess, timing, session, and rating evidence into one canonical Phase 5 finding contract. The adapter registry also records which taxonomy diagnoses are not yet safely projectable, so per-game evidence cannot silently masquerade as a repeated cross-game diagnosis.

### Omit

- CRT repertoire/course/training concerns;
- UI presentation models;
- AI-authored diagnoses;
- new chess detection or aggregate thresholds inside the adapter layer;
- inferred source-event identity when an aggregate does not expose game/event IDs.

### Future seam

The typed producer interface is intentionally independent of Prisma and transport code. A later shared library could own pure projection helpers while the backend keeps source-query and persistence boundaries local.

## Registry contract

Each producer has:

- one stable producer key;
- diagnosis IDs it exclusively owns;
- the shared candidate-projection version;
- a typed source-result contract;
- a pure projection function returning canonical DiagnosisFindingDraft values.

Registry invariants fail closed when:

- two producers claim the same diagnosis ID;
- one diagnosis is both supported and explicitly unsupported;
- the canonical v1 taxonomy contains an ID absent from both sets;
- producer projection versions drift.

The v1 supported set is:

| Producer | Canonical diagnoses |
| --- | --- |
| opening recurrence | OPEN-002, OPEN-003 |
| time-pressure exposure | TIME-001 |
| time-pressure quality collapse | TIME-002 |
| played too fast | TIME-003 |
| early-time overuse | TIME-004 |
| exact-control underperformance | TIME-005 |
| increment effect | TIME-006 |
| opponent move-speed effect | TIME-007 |
| opponent-strength effect | RATING-001 |
| rating-context composition | RATING-002 |
| late-session deterioration | SESSION-001 |
| loss-streak deterioration | SESSION-002 |
| overlong-session stopping point | SESSION-003 |

## Explicitly unsupported taxonomy IDs

The registry deliberately marks these IDs unsupported in v1 rather than emitting empty or fabricated canonical findings:

- TACT-001 through TACT-006: Phase 3 has useful per-game tactical/material/defensive evidence, but no taxonomy-safe cross-game recurrence aggregate yet;
- OPEN-001: no current opening result-baseline aggregate owns its semantics;
- OPEN-004: timing evidence exists through TIME-003/TIME-004, but no separate opening-time aggregate owns OPEN-004;
- CONV-001 through CONV-003: current conversion evidence is per-game and does not yet provide the required repeated cross-game diagnosis contract;
- PHASE-001: phase is available as context, but no player-relative phase-underperformance aggregate exists;
- END-001 through END-003: no repeated endgame-family diagnosis aggregate exists yet;
- CAL-001: remains unavailable until explicit user IANA timezone data exists.

This is intentional. A single HANGING_MATERIAL, THREAT_BLINDNESS, FAILED_CONVERSION, or other source event is evidence for later aggregation; it is not by itself proof that the player repeatedly has that diagnosis.

## State preservation

Projection uses the four Phase 5 observation states without upgrading source evidence:

- source UNAVAILABLE -> REQUIRED_EVIDENCE_UNAVAILABLE;
- source evidence strength INSUFFICIENT -> INSUFFICIENT_EVIDENCE;
- adequate source evidence with the source-defined pattern/effect present -> PROBLEM_DETECTED;
- adequate source evidence without the pattern/effect -> NOT_DETECTED_WITH_ADEQUATE_COVERAGE.

Where the source service already exposes an explicit support status, such as TIME-003, TIME-004, RATING-002, or SESSION-003, projection uses that status directly. For comparison aggregates, projection only interprets the already-computed signed raw delta; it does not introduce a new materiality threshold.

Comparative producers use the weaker source evidence grade. Missing optional evidence is never converted into stronger evidence.

## Effects, dimensions, and provenance

Candidate effects retain source metrics instead of replacing them with ranking scores. Examples include:

- average score-loss delta in centipawns;
- score-percentage-point delta;
- pressure-entry rate;
- rating-composition delta;
- opening average score loss/evaluation.

Exact control, increment, rating band, session threshold, and matching policy remain dimensions/comparator metadata rather than graph nodes.

Producer/source versions are copied into sourceVersions. Aggregates that already fence engine data to CURRENT_COMPLETE_SOURCE_SNAPSHOT keep that provenance unchanged; the candidate adapter never reloads or widens the evidence set.

## Source references and #84

OPEN-002/003 retain the opening recurrence service's supporting game/ply references. TIME-004 retains its explicit complete-chain game IDs.

Several accepted Phase 4 aggregates currently expose correct bounded counts and provenance but do not expose their complete member game/event IDs. Those candidates therefore carry no invented evidenceReferences and explicitly report SOURCE_AGGREGATE_DOES_NOT_EXPOSE_GAME_IDS in coverage.

That is a fail-closed input to #84: stable event overlap is not calculable from those findings until the authoritative source aggregate exposes stable game/event identity or a bounded repository-side overlap computation supplies it. Representative examples are never used as a substitute for complete event identity.

## Phase boundary

Implemented here:

- typed candidate producer interface and registry;
- candidate projection for OPEN-002/003, TIME-001..007, SESSION-001..003, and RATING-001/002;
- explicit unsupported taxonomy inventory;
- duplicate ownership/taxonomy drift guardrails;
- canonical effects, dimensions, coverage, evidence strength, source versions, and available representative references;
- deterministic heterogeneous regression fixtures.

Deferred:

- new Phase 3 recurrence aggregates for tactical/conversion/phase/endgame diagnoses;
- stable event identity and overlap computation (#84);
- relationship graph construction (#85);
- consolidation (#86);
- registered root synthesis (#87);
- ranking (#88);
- Phase 6 API/UI/AI explanation.
