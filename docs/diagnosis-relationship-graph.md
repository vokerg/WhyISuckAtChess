# Phase 5 typed diagnosis relationship graph

**Status:** Phase 5 implementation for issue #85  
**Policy:** `diagnosis-synthesis-v1`  
**Graph implementation:** `diagnosis-relationship-graph-v1`  
**Consumes:** current canonical findings from #82/#83 and measured overlap from #84

## Purpose

This slice materializes the deterministic finding-to-finding graph required before consolidation, root-cause synthesis, and ranking. It does not create context-value nodes, infer semantic similarity, suppress findings, promote roots, or rank diagnoses.

Every persisted edge has two canonical current finding IDs, one of the seven taxonomy relationship types, the synthesis-policy version, and inspectable support describing the rule and source evidence used to create it.

## Allowed edges

The implementation accepts exactly the policy vocabulary:

- `SPECIALIZES`
- `MANIFESTS_AS`
- `CONTRIBUTES_TO`
- `CONDITIONAL_ON`
- `EXPLAINS_OBSERVATION`
- `SHARES_EVENTS_WITH`
- `CONFOUNDED_BY`

The registry fails initialization if an allowed policy type has no implementation path.

## Deterministic rule registry

`diagnosis-relationship.service.ts` owns a finite typed rule registry for relationships already justified by the taxonomy and upstream aggregate semantics.

Initial rules include:

- tactical mechanism findings specialize the generic tactical-error-rate observation;
- rook-endgame weakness specializes the broader endgame-family weakness;
- the supported overlong-session stopping-point candidate manifests as late-session deterioration;
- early-time overuse contributes to pressure-associated quality collapse;
- a tactical mechanism may be conditional on time-pressure collapse only when #84 reports material shared events;
- early-time overuse explains frequent time-pressure exposure.

These rules operate only on current `PROBLEM_DETECTED` findings. A diagnosis pair not present in the registry receives no semantic edge unless one of the two measured dynamic rules below applies.

## Shared-event edges

`SHARES_EVENTS_WITH` is never inferred from names, metrics, dimensions, or similar aggregate values. The graph consumes the pairwise result produced by `diagnosis-overlap-v1`.

An edge is emitted only when `eventOverlap.material === true`, retaining:

- overlap calculation version;
- event-identity version;
- intersection and union counts;
- smaller-arm and Jaccard rates;
- shared distinct games/sessions.

Because the relationship is semantically symmetric, it is stored once using stable finding-key lexical order, with database IDs used only as the persisted endpoints.

## Explicit confounding

`CONFOUNDED_BY` reuses explicit upstream rating-composition evidence. It is not a generic rule that every timing/session difference is confounded by rating.

The graph requires both:

1. a current detected `RATING-002` finding; and
2. the affected finding's own upstream `coverage.ratingComposition` payload to contain `materialCompositionWarning: true`.

If either side is absent, no confounder edge is created. The edge support retains the confounder finding key, effect, and evidence strength; the target finding ID remains the authoritative path to the full confounder evidence.

## Persistence and recalculation

The existing `DiagnosisFindingRelationship` table from #82 is the persistence seam.

`diagnosis-relationship.repository.prisma.ts`:

- accepts only a current finding set owned by the requested user;
- requires the finding set's synthesis policy to match `diagnosis-synthesis-v1`;
- rejects endpoints outside that current set;
- replaces the set's relationship rows atomically;
- stores support as JSON without changing source finding/evidence rows.

The current-scope service reuses #84's source-reference freshness/ownership check before graph calculation. A stale or superseded finding set therefore cannot be used to materialize a current graph.

## Boundedness and idempotence

The graph preserves the Phase 5 cap of 200 current findings. Static rules are evaluated over the bounded current set and dynamic overlap consumes the already bounded #84 pair set.

For the same current finding set, policy version, and overlap results, graph generation returns the same sorted semantic edge set. Duplicate semantic edges are collapsed by relationship type + source finding ID + target finding ID.

## Fixtures

`apps/api/test/diagnosis-relationship.test.mjs` covers:

- every allowed relationship type;
- specialization and directed semantic rules;
- material-overlap-backed conditional and shared-event edges;
- non-material overlap fail-closed behavior;
- explicit rating confounding;
- non-detected/no-edge behavior;
- deterministic generation independent of input ordering;
- current-scope materialization and stale-scope rejection.

## Phase boundary

#85 stops at relationship construction and persistence.

Subsequent ownership remains:

- #86: consolidation/deduplication;
- #87: synthesized root-cause candidates;
- #88: deterministic ranking;
- #89: Phase 5 integration acceptance.
