# Deterministic diagnosis consolidation

**Status:** Phase 5 consolidation v1  
**Scope:** issue #86 under #80  
**Depends on:** #81 policy, #82 canonical findings, #84 event overlap, #85 typed relationships  
**Policy version:** `diagnosis-consolidation-v1`

## 1. Purpose

Consolidation turns the current canonical finding graph into an explicit hierarchy without deleting findings or source evidence. Its job is to prevent materially duplicated labels from appearing as independent top-level reasons while preserving every component for drill-down.

The input boundary is:

```text
current canonical findings
  + diagnosis-overlap-v1
  + diagnosis-relationship-graph-v1
  -> diagnosis-consolidation-v1
```

The output is one persisted consolidation row for every current finding. A row records top-level eligibility, cluster membership, an optional representative finding, deterministic reason keys, policy version, and inspectable support.

## 2. CRT reference / Why delta

### Reference

CRT Player Chess Profile is the reference for deterministic evidence-strength gates, bounded player-owned calculation, explicit coverage, stable ordering, and retaining raw metrics instead of replacing them with an opaque score.

### Preserve

- deterministic output and stable tie-breaking;
- evidence-strength and coverage gates;
- bounded owned-player reads;
- repository/service separation;
- source evidence and raw effects remain unchanged and inspectable.

### Change

Why consolidates a finite diagnosis taxonomy using typed finding-to-finding relationships and measured source-event overlap. Consolidation produces hierarchy state rather than a flat ordered metric list.

### Omit

- semantic/AI clustering;
- destructive duplicate deletion;
- hidden statistical adjustment;
- root-cause promotion and final ranking.

### Future seam

The persisted consolidation rows are the input boundary for #87 root-cause synthesis, #88 ranking, and later Phase 6 drill-down presentation.

## 3. Eligibility states

Every current finding receives exactly one state:

| State | Top-level eligible | Meaning |
| --- | --- | --- |
| `INELIGIBLE` | no | Source finding is not a current supported problem: not detected, insufficient evidence, or below the required 50% coverage gate. |
| `TOP_LEVEL` | yes | Supported finding is independently eligible and has no unresolved material overlap with another top-level finding. |
| `TOP_LEVEL_MATERIAL_OVERLAP` | yes | Supported finding remains independently eligible, but material overlap with another top-level finding is explicit. #88 applies the versioned overlap multiplier rather than treating the evidence as independent. |
| `SUPPRESSED_DRILLDOWN` | no | A more specific supported mechanism represents the materially overlapping generic finding at top level. The suppressed finding remains persisted and inspectable. |

Suppression never mutates the canonical finding row, its evidence references, its raw effect, or its relationships.

## 4. Material-overlap gate

The service consumes #84 overlap output directly. It does not approximate overlap from diagnosis names, effect values, or representative examples.

A suppression candidate is eligible only when #84 marks the pair material under the shared v1 rule:

- event identity is calculable;
- at least 2 events are shared;
- shared events span at least 2 distinct games;
- at least 60% of the smaller event arm is shared.

If event identity is incomplete or overlap is below the threshold, the service fails closed and does not suppress the generic finding.

Material overlap also defines deterministic connected clusters. A cluster key is anchored to the lexically first stable finding key in the connected component, so input ordering and database row ordering cannot change cluster identity within a finding-set revision.

## 5. Suppression rules

Only two typed relationships can demote a finding in v1:

1. `SPECIALIZES`: a supported `MECHANISM` may represent a materially overlapping generic `OBSERVATION` or broader `MECHANISM`.
2. `EXPLAINS_OBSERVATION`: a supported `MECHANISM` may represent a materially overlapping observation it deterministically explains.

Both endpoints must be current supported findings and the pair must have material event overlap.

When several specific mechanisms can represent the same generic finding, v1 chooses deterministically:

1. `SPECIALIZES` before `EXPLAINS_OBSERVATION`;
2. source `findingKey` lexical order;
3. source finding ID only as a final within-revision tie-break.

All alternative representative IDs remain in the support payload. If a selected representative is itself suppressed by a more specific mechanism, the persisted representative is flattened to the ultimate top-level finding. Cycles fail closed.

## 6. Context and confounders

`CONTRIBUTING_CONDITION` findings are not suppressed merely because they overlap a mechanism. A supported condition connected through `CONDITIONAL_ON` or `CONTRIBUTES_TO` remains top-level eligible and records `MATERIAL_CONTEXT_RETAINED`.

`CONFOUNDED_BY` also never deletes or suppresses either finding. The affected finding retains the confounder finding ID in consolidation support so #88 can weaken interpretation/ranking without changing the source effect.

`SHARES_EVENTS_WITH` by itself never chooses a winner. If two supported unsuppressed findings materially overlap and no specificity relationship resolves the duplication, both remain top-level with `TOP_LEVEL_MATERIAL_OVERLAP` and `UNRESOLVED_MATERIAL_OVERLAP`.

## 7. Persistence and recalculation

`DiagnosisFindingConsolidation` belongs to one immutable `DiagnosisFindingSet` and contains:

- source finding ID;
- optional representative finding ID;
- state and top-level eligibility;
- deterministic cluster key;
- reason keys;
- consolidation policy version;
- inspectable JSON support.

The repository requires exactly one consolidation row for every finding in the current set, fences representative IDs to that same set, and atomically replaces the current set's derived consolidation rows.

Publishing a new canonical finding-set revision already supersedes the previous set. Historical sets keep their historical consolidation rows through the existing finding-set lifecycle. Recalculation never edits or removes imported games, engine analysis, evidence events, canonical findings, or finding evidence references.

A requested version tuple must contain both current `diagnosis-synthesis-v1` and `diagnosis-consolidation-v1`; stale policy tuples fail closed.

## 8. Determinism and boundedness

The service inherits the Phase 5 maximum of 200 current findings per scope and consumes bounded #84 overlap output. It validates that all relationship and overlap endpoints belong to the same current finding set.

Output ordering is by stable finding key, then finding ID. Ambiguous representative selection and cluster anchoring use deterministic ordering only; timestamps and wall-clock values never participate.

## 9. Test matrix

The focused consolidation fixtures cover:

- full material overlap with generic-vs-specific suppression;
- partial overlap that does not suppress;
- `EXPLAINS_OBSERVATION` demotion;
- contextual-condition retention;
- unrelated findings remaining separate;
- ambiguous specific mechanisms with stable tie-breaking;
- unavailable event identity failing closed;
- insufficient/non-detected source findings becoming explicitly ineligible;
- current-scope replacement and stale-policy/stale-scope rejection.

The Phase 5 integration gate in #89 remains responsible for proving the complete candidate -> persistence -> overlap -> relationship -> consolidation -> root -> ranking chain.

## 10. Non-goals

This slice does not:

- synthesize root-cause candidates;
- calculate final diagnosis scores/order;
- infer causal or psychological state;
- add UI/API presentation;
- use AI or semantic similarity to merge findings.
