# Deterministic root-cause candidate synthesis

**Status:** Phase 5 root synthesis v1  
**Scope:** issue #87 under #80  
**Depends on:** #81 synthesis policy, #82 canonical finding lifecycle, #84 stable event identity, #85 typed relationships, #86 consolidation  
**Policy version:** `diagnosis-synthesis-v1`

## 1. Purpose

Root synthesis promotes a small registered set of explanations only when several already-supported canonical findings form an inspectable deterministic proof. It does not run a new chess detector, infer psychology, or invent a free-form explanation.

The input boundary is:

```text
current canonical findings
  + diagnosis-relationship-graph-v1
  + diagnosis-consolidation-v1
  -> registered root-theme proof
  -> canonical ROOT_CAUSE_CANDIDATE finding
```

The output remains a normal `DiagnosisFinding`. Supporting findings remain present for drill-down and are linked durably to the root inside the replacement finding-set revision.

## 2. CRT reference / Why delta

### Reference

CRT Player Chess Profile remains the reference for bounded owned-player aggregation, deterministic 5/15/40 evidence grades, the 50% required-evidence coverage gate, explicit denominators, stable ordering, and retaining raw source metrics.

### Preserve

- deterministic evidence gates and stable ordering;
- current provenance-safe source evidence only;
- bounded support and representative examples;
- raw child effects/units and coverage remain inspectable;
- repository/service separation and immutable derived revisions.

### Change

Why synthesizes across heterogeneous canonical findings. Promotion therefore requires a registered root theme, a repeated mechanism, a material context/observation, typed graph connectivity, consolidation eligibility, stable mechanism event support, and explicit recurrence/concentration gates.

### Omit

- causal or psychological claims;
- AI/semantic clustering;
- hidden score adjustment;
- final priority ranking;
- destructive merging of component findings.

### Future seam

#88 consumes the synthesized roots after the new finding-set revision has had its relationship graph and consolidation state recalculated. #89 proves the full candidate -> root -> ranking chain.

## 3. Registered themes

Only the two `DIAGNOSIS_ROOT_CAUSE_THEME_REGISTRY` entries from #81 can promote.

### `CLOCK_MANAGEMENT_DRIVING_TACTICAL_COLLAPSE`

At least one top-level supported mechanism must be one of:

- `TACT-001` through `TACT-005`;
- `TIME-003`;
- `TIME-004`.

At least one top-level supported material context must be one of:

- `TIME-001`;
- `TIME-002`;
- `TIME-005`;
- `TIME-006`.

The selected mechanism and context must be connected by an allowed typed root-link relationship.

### `LATE_SESSION_TACTICAL_DETERIORATION`

At least one top-level supported mechanism must be one of `TACT-001` through `TACT-005`.

At least one top-level supported context must be `SESSION-001` or `SESSION-002`, and the selected context must cover at least three distinct sessions.

A supported `SESSION-003` may be retained as `ADDITIONAL_SUPPORT` when it is connected to the selected proof, but it never satisfies the mandatory mechanism or context slot.

## 4. Mandatory support gates

A mandatory supporting finding must:

- be current and `PROBLEM_DETECTED`;
- have at least `LOW` evidence;
- expose required-evidence coverage of at least 50%;
- remain top-level eligible after `diagnosis-consolidation-v1`;
- use the current synthesis policy.

A root also requires:

- at least five distinct supporting games;
- stable current event identity for the repeated mechanism evidence used by the root;
- no one game contributing more than 50% of the root event support;
- a direct allowed typed relationship between each selected mechanism/context pair used in the proof;
- material overlap whenever the relationship rule itself requires overlap.

`SHARES_EVENTS_WITH` and the current overlap-backed `CONDITIONAL_ON` rule are accepted only when their persisted support says the overlap is material. Rules such as the registered `TIME-004 -> TIME-002 CONTRIBUTES_TO` edge already encode the required semantic connection and do not invent a second overlap requirement.

## 5. Mechanism evidence versus aggregate context

Some accepted Phase 4 context aggregates deliberately expose denominators, coverage, effects, and distinct-game/session counts without exposing a complete game-ID set. #87 does not fabricate those IDs.

The repeated mechanism side must provide a complete stable event set relative to its declared distinct-game count. Root event support is the deterministic union of those mechanism events. Context findings contribute their authoritative aggregate counts/effects through the typed relationship and durable support link.

This means:

- `TIME-004` can currently supply complete game-level chain identities;
- a mechanism with no complete stable event set fails closed for root promotion;
- a context aggregate can still participate when the registered relationship does not require event overlap;
- a relationship that requires material overlap cannot be created or consumed without the #84 overlap proof.

## 6. Root evidence contract

For each promoted root, #87 persists:

- deterministic root theme, finding key, diagnosis ID, and claim/template key;
- `ROOT_CAUSE_CANDIDATE` level;
- `diagnosis-root-synthesis` producer identity;
- `diagnosis-synthesis-v1` producer/policy version;
- unique mechanism event count and distinct-game count;
- relevant distinct-session count;
- minimum required-evidence coverage across mandatory children;
- evidence strength capped by both the root support sample and the weakest mandatory child;
- largest single-game event share;
- complete selected child finding keys and source finding-set identity;
- the child raw effects, coverage, source versions, consolidation state, and typed relationship context;
- bounded deterministic root evidence references and representative examples.

The root has no synthetic cross-family `effect` value. Its child effects retain their original metrics and units instead of being combined into an invented scalar.

## 7. Durable supporting-finding links

`DiagnosisRootCandidateSupport` links a root to supporting findings in the **same** immutable finding-set revision.

Roles are exactly:

- `MECHANISM`;
- `CONDITION_OR_OBSERVATION`;
- `ADDITIONAL_SUPPORT`.

Each row also retains inspectable synthesis support including the source revision's finding ID, raw child evidence contract, consolidation state, and relationship IDs/support that justified the synthesis.

The repository validates root/support keys before persistence and creates the links only after all findings in the replacement revision have their new persisted IDs.

## 8. Recalculation and immutable revision lifecycle

Root publication does not mutate the consolidated source set in place.

When at least one theme promotes:

1. read the current version-tuple-gated finding set;
2. verify current source references;
3. consume its current relationships and complete consolidation state;
4. copy the existing canonical findings into a replacement draft;
5. append synthesized roots and same-revision root-support links;
6. atomically publish the replacement through the #82 replace-current lifecycle;
7. supersede the prior finding-set revision.

The replacement set deliberately starts without copied #85 relationship or #86 consolidation rows. Those derived artifacts are recalculated against the new immutable revision before #88 ranking. The root support rows preserve the source proof across that boundary.

If no theme qualifies, #87 performs no replacement. If the current revision already contains roots produced by the current synthesis version, the operation is idempotent.

A later upstream recalculation publishes another finding-set revision. Running #87 against that revision creates fresh roots and naturally leaves prior roots historical with their old finding set.

## 9. Determinism and boundedness

- root themes are iterated in registry order and final findings/support links use stable lexical ordering;
- event support is keyed by current `diagnosis-event-identity-v1` identity;
- duplicate mechanism references to the same event are counted once;
- support is capped by the shared 1,000 evidence-reference limit;
- representative count remains 1/2/3 for LOW/MEDIUM/HIGH evidence;
- representative selection prefers already-deterministic upstream representatives and distinct games, then stable event identity;
- timestamps and database row IDs never determine promotion.

## 10. Focused fixture matrix

`apps/api/test/diagnosis-root-cause.test.mjs` covers:

- successful clock-theme promotion;
- missing mechanism;
- missing condition/observation;
- inadequate required-evidence coverage;
- one-game support concentration above 50%;
- overlapping mechanism evidence deduplicated by stable event identity;
- late-session recurrence across at least three sessions;
- optional `SESSION-003` additional support;
- immutable replacement publication with durable child links;
- no-root no-op behavior;
- already-current synthesized-root idempotency.

## 11. Non-goals

This slice does not:

- execute final ranking (#88);
- add API/UI presentation;
- add new detector or aggregate thresholds;
- infer fatigue, tilt, attention, intimidation, or other mental state;
- convert correlation into causation;
- use AI to create, promote, or rank findings.
