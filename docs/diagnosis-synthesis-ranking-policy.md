# Phase 5 diagnosis synthesis and ranking policy

**Status:** Phase 5 canonical policy v1  
**Scope:** issue #81 under #80  
**Depends on:** `docs/diagnostic-taxonomy.md` and accepted Phase 3/4 evidence contracts  
**Executable constants:** `packages/chess-domain/src/diagnosis-policy.ts`

## 1. Purpose

Phase 5 converts existing provenance-safe per-game and longitudinal evidence into a deterministic, inspectable diagnosis hierarchy. This document freezes the shared semantics that persistence, candidate projection, event-overlap, relationship, consolidation, root-candidate, and ranking implementations must consume.

This policy does not create new chess facts. It never weakens detector/aggregate provenance and never permits AI, UI, provider DTOs, or persistence details to become authoritative diagnosis policy.

The pipeline is:

```text
current authoritative evidence / aggregates
  -> candidate findings
  -> current canonical findings
  -> stable evidence-event references
  -> typed finding relationships
  -> deterministic consolidation
  -> registered root-cause candidates
  -> deterministic ranking
  -> ranked diagnosis hierarchy
```

## 2. CRT reference / Why delta

### Reference

CRT Player Chess Profile is the reference for deterministic evidence-strength gates, bounded owned-player aggregation, explicit denominator/coverage reporting, reproducible ordering, and keeping raw metrics visible. Its initial grades are `<5 INSUFFICIENT`, `5-14 LOW`, `15-39 MEDIUM`, and `>=40 HIGH`, with analysis evidence forced to insufficient below 50% coverage.

### Preserve

- bounded owned-player reads;
- explicit sample/coverage and recalculable derived output;
- framework-independent deterministic calculations;
- repository/service separation;
- stable deterministic tie-breaking;
- raw metrics alongside any normalized ranking value.

### Change

Why has a finite diagnosis taxonomy, heterogeneous metric families, stable evidence-event identity, typed inter-finding relationships, explicit overlap accounting, consolidation, and synthesized root-cause candidates. Ranking operates on a hierarchy rather than a flat metric list.

### Omit

- CRT repertoire/training/course concerns;
- AI ranking or free-form authoritative diagnosis;
- persistence or transport types in the policy package;
- hidden statistical or causal adjustment.

### Future seam

`packages/chess-domain` owns the framework-neutral policy vocabulary/constants. Backend diagnosis services may later be replaced or shared without changing the policy contract.

## 3. Version registry and change rule

Phase 5 v1 exposes four independent versions:

- synthesis: `diagnosis-synthesis-v1`;
- consolidation: `diagnosis-consolidation-v1`;
- ranking: `diagnosis-ranking-v1`;
- event identity: `diagnosis-event-identity-v1`.

A semantic or calibration-sensitive change must bump the owning version. Formatting-only documentation changes do not.

Examples:

- changing stable event identity -> event-identity version;
- changing the 60% material-overlap threshold -> consolidation version and, when ranking behavior changes, ranking version;
- changing root-theme prerequisites -> synthesis version;
- changing ranking weights/evidence multipliers/tie-break order -> ranking version.

Current output must expose the versions used. A row/artifact calculated under an older relevant version is not current merely because its source facts still exist.

## 4. Candidate, canonical finding, and stable identity

A **candidate finding** is an in-memory typed projection from an authoritative detector/aggregate. It is not persistence and cannot silently upgrade source evidence.

A **canonical finding** is the persisted/materialized current representation of an accepted candidate or synthesized root candidate.

Stable finding identity is semantic, not row/recalculation identity. The identity key is derived deterministically from:

1. owned player scope;
2. diagnosis ID;
3. finding level;
4. normalized finding dimensions/scope that materially define the claim;
5. producer ownership key.

It deliberately excludes calculated timestamps and policy versions. New calculation/detector/taxonomy/synthesis versions create a new revision of the same stable semantic finding where the semantics are unchanged. A semantic diagnosis/dimension change creates a different identity.

Persistence in #82 must make **current versus superseded** explicit. Recalculation replaces the current revision for the same stable identity/scope; it must not accumulate several rows that all masquerade as current.

Candidate projection must preserve:

- producer/detector/aggregate versions;
- raw effect and unit;
- baseline/comparator;
- denominators and distinct-game/session counts;
- required-evidence coverage;
- evidence strength;
- representative source references;
- insufficiency/unavailable state.

## 5. Observation states and fail-closed behavior

Consumers must distinguish exactly these states:

- `PROBLEM_DETECTED`;
- `NOT_DETECTED_WITH_ADEQUATE_COVERAGE`;
- `INSUFFICIENT_EVIDENCE`;
- `REQUIRED_EVIDENCE_UNAVAILABLE`.

No finding must infer strength from absence when source coverage is inadequate. Ranking eligibility requires a supported/current finding with at least `LOW` evidence after all required coverage gates.

The shared v1 gates remain:

- fewer than 5 required supporting items -> `INSUFFICIENT`;
- required-evidence coverage below 50% -> `INSUFFICIENT`;
- comparative evidence is limited by the weaker arm;
- `LOW` starts at 5, `MEDIUM` at 15, `HIGH` at 40.

## 6. Stable evidence-event identity

Event overlap is based on source identity, never diagnosis text, matching effect values, or heuristic string similarity.

An event reference must identify the authoritative source shape strongly enough to be stable under repeated materialization. Supported v1 shapes are:

### 6.1 Ply/event evidence

Use:

```text
event-identity-version
+ owned imported-game ID
+ trigger/user ply
+ source detector/evidence kind
+ source detector/version
+ detector-stable event discriminator when one ply can own multiple events
```

### 6.2 Game-level evidence

When no causal ply exists, one owned imported game may be a stable event unit:

```text
event-identity-version
+ owned imported-game ID
+ source aggregate/evidence kind
+ source version
```

### 6.3 Aggregate game/event sets

Aggregates retain a bounded set of stable game/event references plus denominators. The aggregate itself is not one synthetic event for overlap purposes.

If a producer cannot expose stable event/game identity, overlap is **not calculable**. Downstream code must not invent identity from diagnosis ID, timestamps alone, effect similarity, or representative-example lists.

## 7. Relationship semantics and direction

Allowed relationship types are exactly:

- `SPECIALIZES`;
- `MANIFESTS_AS`;
- `CONTRIBUTES_TO`;
- `CONDITIONAL_ON`;
- `EXPLAINS_OBSERVATION`;
- `SHARES_EVENTS_WITH`;
- `CONFOUNDED_BY`.

Every endpoint is a current canonical finding ID. Raw context values never become graph nodes.

Direction rules:

- `SPECIALIZES`: specific child -> broader parent;
- `MANIFESTS_AS`: higher-level condition/root -> concrete mechanism/outcome;
- `CONTRIBUTES_TO`: contributor -> affected finding;
- `CONDITIONAL_ON`: affected mechanism/observation -> contextual finding;
- `EXPLAINS_OBSERVATION`: mechanism/condition -> observation;
- `CONFOUNDED_BY`: weakened finding -> confounder finding;
- `SHARES_EVENTS_WITH` is semantically symmetric but stored once in canonical stable-finding-ID lexical order to avoid duplicate edges.

Relationship creation must be deterministic from typed registry/policy rules and measured overlap/context. Free-form semantic similarity is not an allowed edge generator.

## 8. Event overlap and materiality

For two current findings expose, where calculable:

- left/right event counts;
- intersection;
- union;
- left-arm overlap rate;
- right-arm overlap rate;
- smaller-arm overlap rate = `intersection / min(left, right)`;
- shared distinct games;
- shared distinct sessions when available;
- calculability/coverage state.

Phase 5 v1 calls overlap **material** only when all are true:

- overlap identity is calculable;
- at least 2 events are shared;
- shared events span at least 2 distinct games;
- at least 60% of the smaller event arm is shared.

The 60% threshold is calibration-sensitive and owned by the consolidation policy version. One spectacular game therefore cannot by itself trigger material-overlap consolidation.

## 9. Consolidation and deduplication

Consolidation changes hierarchy/top-level eligibility; it never deletes component findings or their evidence.

Rules, in order:

1. Never consolidate when required event overlap is unavailable and the relationship policy cannot establish an equivalent typed relationship deterministically.
2. When a specific supported mechanism `SPECIALIZES` or `EXPLAINS_OBSERVATION` for a generic observation and overlap is material, the mechanism is top-level eligible and the generic observation is demoted into drill-down.
3. A contributing/context finding remains top-level eligible when it materially changes mechanism frequency, severity, or result impact; context is not discarded merely because it overlaps.
4. `SHARES_EVENTS_WITH` alone prevents independent double reward but does not choose a winner. Specificity/relationship semantics choose hierarchy.
5. A `CONFOUNDED_BY` finding remains visible; confounding weakens interpretation/ranking support and never rewrites the raw effect.
6. Every demotion records a deterministic consolidation reason and policy version.

An unresolved materially overlapping finding that remains independently rankable receives the v1 ranking multiplier `0.75`. Once consolidation has selected a top-level representative, suppressed children are not separately top-level ranked.

## 10. Root-cause candidate synthesis

A root candidate is a new synthesis artifact. It must not be emitted directly by a detector because a single detector cannot satisfy the required cross-finding proof.

Global minimums:

- at least one repeated `MECHANISM` finding;
- at least one material `OBSERVATION` or `CONTRIBUTING_CONDITION`;
- at least 5 distinct supporting games;
- required-evidence coverage >= 50%;
- no one game contributes more than 50% of the root candidate's event support;
- relevant overlap is calculable or explicitly shown not to be required for the theme;
- supporting findings are connected by allowed typed relationships;
- every mandatory child is current and not `INSUFFICIENT`;
- deterministic summary key/template and complete supporting finding IDs are preserved.

Only registered v1 themes may promote:

### `CLOCK_MANAGEMENT_DRIVING_TACTICAL_COLLAPSE`

Mechanism must be drawn from tactical mechanism IDs `TACT-001` through `TACT-005` or timing mechanisms `TIME-003`/`TIME-004`. Material condition/observation must be one of `TIME-001`, `TIME-002`, `TIME-005`, or `TIME-006`. At least 5 distinct games are required.

### `LATE_SESSION_TACTICAL_DETERIORATION`

Mechanism must be one of `TACT-001` through `TACT-005`. Material session context must be `SESSION-001`, `SESSION-002`, or `SESSION-003`. At least 5 distinct games across at least 3 distinct sessions are required.

Adding/removing a root theme or changing prerequisites requires a synthesis-policy version bump.

## 11. Deterministic ranking

Ranking consumes only **current top-level consolidated findings and supported root candidates**. It never ranks stale revisions or raw duplicate children as independent top-level reasons.

Every producer retains its original metric/unit and may additionally provide deterministic normalized component values in [0,1]. Family-specific normalization belongs to the owning producer/ranking adapter and must be versioned/inspectable; normalization never replaces raw evidence.

V1 component weights sum to 1:

| Component | Weight |
| --- | ---: |
| frequency | 0.20 |
| severity | 0.20 |
| result impact | 0.15 |
| recurrence across games/time/sessions | 0.15 |
| evidence/coverage | 0.15 |
| specificity/actionability | 0.05 |
| conditional concentration | 0.05 |
| recency | 0.05 |

`frequency`, `severity`, and `evidence` are required for ranking. Optional components are omitted from both numerator and denominator and the remaining present weights are renormalized. Missing optional data is therefore not silently treated as zero.

The normalized weighted score is multiplied by evidence strength:

- `INSUFFICIENT` -> 0 and ineligible;
- `LOW` -> 0.55;
- `MEDIUM` -> 0.80;
- `HIGH` -> 1.00.

Then apply overlap state:

- consolidated top-level representative -> 1.00;
- unresolved independent finding with material overlap -> 0.75;
- consolidated/suppressed child -> not top-level eligible.

Ranking must expose component values, raw metric/effect, evidence multiplier, overlap/consolidation state, final score, and ranking-policy version.

### 11.1 Tie breaking

Exact final-score ties are ordered deterministically by:

1. stronger evidence grade;
2. larger distinct-game count;
3. diagnosis ID lexical order;
4. stable finding identity lexical order.

No wall-clock timestamp or database row ID participates in tie-breaking.

## 12. Representative-example selection

Examples remain bounded and deterministic.

Required count when available:

- `LOW`: 1;
- `MEDIUM`: 2 distinct games;
- `HIGH`: 3 distinct games.

Selection policy:

1. highest-severity representative event;
2. event closest to the finding's median severity from a different game;
3. highest-severity remaining event from another distinct game/session where practical.

Ties use game chronology, owned game ID, then ply/event identity. This keeps examples inspectable without showing only extreme outliers.

## 13. Recalculation and staleness

A recalculation run operates on one explicit owned-player scope and a declared complete policy/version tuple.

A finding/relationship/consolidation/root/ranking artifact is stale when any version that materially owns its semantics no longer matches the requested current tuple or when any mandatory source finding has been superseded.

Recalculation must:

1. read only current provenance-safe source evidence;
2. materialize the new current finding set atomically or with an equivalent replace-current-scope boundary;
3. supersede old current revisions/edges/root candidates/rankings;
4. never delete or rewrite authoritative detector/aggregate source facts;
5. fail closed rather than mixing old and new synthesis graphs.

## 14. Boundedness

Phase 5 synthesis is always scoped to one owned player plus explicit filters/date scope. No global all-player graph or unbounded history Cartesian join is allowed.

For v1 in-memory synthesis:

- maximum 200 current findings per synthesis scope;
- maximum 1000 retained event references per finding;
- maximum 3 representative examples per finding.

Hitting a cap must be observable. Truncated event identity is not sufficient for authoritative overlap/consolidation/root promotion; the service must fail closed or use a repository-side bounded computation that preserves complete required counts/identity.

Pairwise work therefore operates only over the accepted bounded current-finding set. Repositories should pre-aggregate counts in SQL where practical instead of loading unbounded raw histories into Node.

## 15. Module and dependency flow

`packages/chess-domain/src/diagnosis-policy.ts` owns only policy constants, enums/types, invariant validation, and pure overlap helpers.

Later leaf ownership:

- #82: persistence/current-vs-superseded lifecycle;
- #83: producer registry and candidate normalization;
- #84: stable event identity and overlap calculation;
- #85: relationship graph;
- #86: consolidation;
- #87: registered root synthesis;
- #88: ranking;
- #89: end-to-end acceptance.

Backend `diagnosis` services may consume `chess-domain` policy, current evidence/session query boundaries, and owned repositories. `chess-domain` must not import Prisma, Fastify, providers, AI, or UI code.

## 16. Non-goals

This policy does not implement:

- database schema/migrations;
- candidate adapters;
- graph persistence;
- consolidation execution;
- ranking execution;
- Phase 6 API/UI;
- AI explanation;
- causal or psychological inference;
- `CAL-001` without explicit user timezone data.
