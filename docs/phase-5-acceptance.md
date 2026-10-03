# Phase 5 diagnosis-engine integration acceptance

**Status:** accepted Phase 5 integration contract  
**Scope:** issue #89 under #80  
**Accepted stack:** issues #81-#88 plus #79  
**Policy versions:** `diagnosis-synthesis-v1`, `diagnosis-consolidation-v1`, `diagnosis-ranking-v1`, `diagnosis-event-identity-v1`

## 1. Acceptance decision

Phase 5 now has a deterministic, inspectable path from supported longitudinal evidence into a ranked diagnosis hierarchy:

```text
authoritative evidence / bounded aggregates
  -> registered candidate projection
  -> immutable current finding-set revision
  -> stable evidence-event overlap
  -> typed relationship graph
  -> deterministic consolidation
  -> registered root-candidate synthesis
  -> replacement finding-set revision
  -> refreshed overlap / relationship / consolidation hierarchy
  -> deterministic ranking
```

The accepted boundary is backend diagnosis data and policy. Phase 6 owns product read models, user-facing explanation, board/replay presentation, and any bounded AI prose.

This acceptance pass does not claim that every taxonomy diagnosis has a current candidate producer. Unsupported breadth remains explicit in the registry and in section 8 below.

## 2. CRT reference / Why delta

### Reference

CRT Player Chess Profile remains the closest reference for:

- bounded owned-player aggregation;
- explicit denominator and analysis-coverage reporting;
- deterministic 5/15/40 evidence grades with a 50% minimum-coverage gate;
- stable ordering;
- preserving raw source metrics and bounded supporting-game references;
- separating repository queries from deterministic calculation.

Relevant CRT implementation remains:

- `apps/api/src/modules/player-chess-profile/player-chess-profile.service.ts`;
- `apps/api/src/modules/player-chess-profile/player-chess-profile.metrics.ts`;
- `apps/api/src/modules/player-chess-profile/player-chess-profile.repository.prisma.ts`;
- `docs/player-chess-profile.md`.

### Preserve

Phase 5 preserves CRT's evidence discipline: bounded inputs, explicit coverage, deterministic grades, raw effects, stable ordering, inspectable support, and recalculable outputs.

### Change

Why composes heterogeneous evidence families into immutable canonical findings with stable event identity, typed relationships, consolidation, registered root themes, and deterministic ranking. This is a product-specific synthesis layer rather than a CRT profile projection.

### Omit

Phase 5 does not copy CRT opening-personality presentation, course/repertoire writes, frontend profile surfaces, or free-form conclusion generation.

### Future seam

The reusable seam remains framework-neutral policy/constants in `packages/chess-domain` plus typed diagnosis service/repository boundaries in `apps/api`. No cross-repository shared-library program is introduced.

## 3. Accepted persistence and recalculation lifecycle

`DiagnosisFindingSet` is the immutable revision boundary. Recalculation never mutates an old current diagnosis in place.

A current revision owns or references:

- canonical `DiagnosisFinding` rows and bounded source evidence references;
- current typed `DiagnosisFindingRelationship` rows;
- current `DiagnosisFindingConsolidation` rows;
- same-revision `DiagnosisRootCandidateSupport` links for synthesized roots;
- current `DiagnosisFindingRanking` rows.

The lifecycle is:

1. candidate projection produces deterministic finding drafts from current source aggregates;
2. #82 atomically publishes a current finding-set revision and supersedes the previous revision;
3. overlap, relationship, and consolidation materialize against that exact current version tuple;
4. root synthesis may publish a replacement revision containing the prior leaf findings plus registered synthesized roots and durable same-revision child links;
5. the replacement revision gets a fresh overlap/relationship/consolidation calculation;
6. ranking consumes only that refreshed current hierarchy;
7. a taxonomy, synthesis, consolidation, event-identity, or ranking policy-version mismatch fails closed and requires recalculation rather than mixing generations.

The focused persistence, graph, consolidation, root, and ranking tests remain authoritative for repository transactions and version fencing. The Phase 5 acceptance harness composes their public deterministic contracts across module boundaries.

## 4. Canonical acceptance fixture

`apps/api/test/phase-5-acceptance.test.mjs` composes one deterministic synthetic scope with:

- projected `TIME-004` early-time-overuse mechanism carrying five stable owned-game event identities;
- projected `TIME-002` pressure quality collapse;
- projected `RATING-002` material rating-composition warning;
- projected `SESSION-001` late-session deterioration;
- projected `SESSION-003` supported overlong-session stopping point;
- a canonical tactical-specific / tactical-generic pair sharing the same severe events, used only to exercise the already-accepted hierarchy contract while tactical cross-game candidate production remains deferred;
- an unrelated opening mechanism with disjoint event support.

The fixture then executes:

```text
candidate projection
  -> persisted-finding-shaped fixture
  -> all-pair overlap
  -> relationship graph
  -> consolidation
  -> root synthesis
  -> replacement-revision-shaped fixture
  -> refreshed overlap / relationship / consolidation
  -> ranking
```

The fixture deliberately does not fake provider transport, Prisma ownership checks, or aggregate SQL. Those have focused tests at their owning boundaries.

## 5. Acceptance matrix

| Requirement | Acceptance evidence |
| --- | --- |
| provenance-safe aggregate -> candidate | real candidate producers project TIME-002/TIME-004/RATING-002/SESSION-001/SESSION-003 in the acceptance harness; existing producer tests cover family-specific source contracts |
| candidate -> current immutable finding lifecycle | #82 persistence tests cover atomic replace-current publication, supersession, evidence references, and version tuple reads |
| stable evidence survives materialization | acceptance fixture asserts TIME-004 owned game ids and `diagnosis-event-identity-v1` keys; #82/#84 repository tests cover durable reference fields |
| shared events do not double-count | acceptance fixture gives TACT-001 and TACT-006 the same five events; typed specialization plus material overlap suppresses the generic duplicate to drill-down |
| typed finding relationships only | acceptance fixture requires `CONTRIBUTES_TO`, `CONFOUNDED_BY`, `MANIFESTS_AS`, and `SPECIALIZES` from the registered graph |
| confounders remain explicit | TIME-002 now retains its source rating-composition result in canonical coverage, enabling the graph to persist `TIME-002 -> RATING-002 CONFOUNDED_BY`; consolidation/ranking expose the confounder id without deleting or silently adjusting TIME-002 |
| root promotion requires mechanism + context + coverage | projected TIME-004 + TIME-002 promotes `CLOCK_MANAGEMENT_DRIVING_TACTICAL_COLLAPSE`; root tests retain the full negative matrix for missing support/coverage/concentration |
| synthesized support is not unresolved duplicate overlap | refreshed overlap correctly sees the root and TIME-004 share copied evidence, but consolidation excludes known root-child support from the unresolved-overlap penalty; ranking therefore does not penalize the root for its own proof |
| ranking consumes consolidated hierarchy | suppressed duplicate labels receive no ranking row; synthesized-root children remain drill-down rows with `parentRootFindingIds`; unrelated findings remain independently ranked |
| session integration includes SESSION-003 | projected SESSION-003 is related to SESSION-001 by the registered `MANIFESTS_AS` edge and remains traceable/rankable when supported |
| sparse evidence fails closed | a large TIME-002 raw delta with 25% required-evidence coverage remains `INSUFFICIENT_EVIDENCE`, consolidates as ineligible, and produces no ranking row |
| no-problem remains distinct from insufficient | the acceptance harness separately proves adequate-coverage/no-delta becomes `NOT_DETECTED_WITH_ADEQUATE_COVERAGE` |
| stale versions fail closed | root/ranking current-revision checks and ranking materialization reject stale synthesis/ranking versions before repository reads |
| deterministic recalculation | identical accepted current snapshots produce deep-equal ranking output with contiguous deterministic top-level positions |
| representative evidence traceability | synthesized root evidence references preserve the stable child event identity and source provenance; focused root tests cover bounded representative selection |
| no provider/UI/AI authority leakage | architecture guardrails now reject provider, Angular/Chessground/web, and AI imports anywhere inside the diagnosis module; deterministic detector AI guardrails remain in place |

## 6. Integration defects fixed by this pass

### 6.1 TIME-002 rating-composition provenance

The TIME-002 aggregate already exposed `ratingComposition`, but its candidate projection did not preserve that field. The relationship graph therefore could not see a material composition warning after the candidate boundary.

The accepted projection now stores the rating-composition result under `finding.coverage.ratingComposition`. This preserves the source warning and allows the existing generic `CONFOUNDED_BY` rule to operate without family-specific graph code.

No score is silently adjusted for the confounder. The relationship and consolidation/ranking support expose it explicitly.

### 6.2 Synthesized-root support overlap

A synthesized root deliberately copies the stable mechanism events that prove it. After root publication, the generic overlap pass therefore observes material overlap between the root and its supporting child.

Treating that known parent-child overlap as unresolved material duplication applies the ranking overlap penalty to the root for possessing its own required proof. That is not an unresolved cluster.

Consolidation now recognizes current `diagnosis-root-synthesis` roots and the child finding keys already frozen into the root coverage contract. Material root-child support overlap remains measurable and inspectable, but it is excluded from the unresolved-material-peer cluster. Unrelated material overlap is unchanged.

## 7. Architecture boundary accepted for Phase 6

Authoritative Phase 5 calculation code may consume:

- owned/canonical evidence and aggregate query boundaries;
- framework-neutral diagnosis policy from `packages/chess-domain`;
- diagnosis-owned Prisma repositories;
- immutable current diagnosis revisions.

It must not consume:

- Lichess/provider DTOs or credential boundaries;
- Angular, Chessground, or web presentation code;
- OpenAI/Anthropic/Gemini/AI SDKs or another model provider as calculation authority.

Phase 6 may read the accepted diagnosis hierarchy and use AI to explain bounded verified evidence, but AI cannot create, promote, suppress, or score an authoritative finding.

## 8. Explicit deferred taxonomy breadth

Phase 5 acceptance is an engine acceptance, not a claim of full taxonomy producer coverage.

The candidate registry still deliberately marks these families unsupported until their required cross-game aggregate exists:

- `TACT-001` through `TACT-006`;
- `OPEN-001` and `OPEN-004`;
- `CONV-001` through `CONV-003`;
- `PHASE-001`;
- `END-001` through `END-003`.

`CAL-001` remains explicitly deferred until the product stores an authoritative user IANA timezone. Provider timestamps or guessed local time must not be substituted for that missing source fact.

The registered `LATE_SESSION_TACTICAL_DETERIORATION` root theme therefore remains a valid deterministic future seam but cannot arise from the currently supported candidate producer set until an accepted tactical recurrence producer exists. SESSION-001/002/003 themselves are accepted current candidate families.

## 9. Validation inventory

The acceptance PR is expected to pass the full repository CI path:

- workspace build and TypeScript checks;
- unit/integration tests, including `phase-5-acceptance.test.mjs`;
- lint;
- Prisma schema/migration validation owned by CI;
- architecture guardrails;
- repository hygiene checks.

Focused Phase 5 tests remain in:

- `diagnosis-candidate-registry.test.mjs`;
- `diagnosis-finding-persistence.test.mjs`;
- `diagnosis-overlap.test.mjs`;
- `diagnosis-relationship.test.mjs`;
- `diagnosis-consolidation.test.mjs`;
- `diagnosis-root-cause.test.mjs`;
- `diagnosis-ranking.test.mjs`;
- `phase-5-acceptance.test.mjs`.

## 10. Exit decision

With this acceptance pass green, the deterministic Phase 5 engine boundary is complete enough to close #80.

The next product milestone is Phase 6: bounded diagnosis read models, evidence inspection, explanation, and user-facing experience over this accepted hierarchy. Phase 6 must consume the deterministic result rather than moving provider, UI, or AI concerns back into authoritative diagnosis calculation.
