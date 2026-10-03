# Deterministic diagnosis ranking

**Status:** Phase 5 ranking v1  
**Scope:** issue #88 under #80  
**Depends on:** #81 ranking policy, #82 canonical findings, #86 consolidation, #87 root synthesis  
**Policy version:** `diagnosis-ranking-v1`  
**Execution version:** `diagnosis-ranking-execution-v1`

## 1. Purpose

Ranking turns the current consolidated diagnosis hierarchy into a reproducible priority order without changing the underlying findings. It consumes only current `PROBLEM_DETECTED` findings that remain top-level eligible after `diagnosis-consolidation-v1`, have at least `LOW` evidence, and retain at least 50% required-evidence coverage.

The output is derived state attached to the same immutable `DiagnosisFindingSet`. Raw effects, units, coverage, evidence grade, hierarchy state, and support links remain inspectable.

## 2. Hierarchy boundary

A synthesized `diagnosis-root-synthesis` root remains top-level when supported. Eligible findings linked to that root through `DiagnosisRootCandidateSupport` remain available as drill-down ranking rows, but they do not receive an independent top-level rank position. This prevents the same supported mechanism/context evidence from appearing both as a root reason and as additional top-level reasons.

Consolidation remains authoritative before ranking:

- `TOP_LEVEL` -> independently rankable;
- `TOP_LEVEL_MATERIAL_OVERLAP` -> independently rankable with the v1 overlap multiplier;
- `SUPPRESSED_DRILLDOWN` / `INELIGIBLE` -> absent from ranking.

A synthesized root must retain both `MECHANISM` and `CONDITION_OR_OBSERVATION` support. Ranking fails closed if that durable proof is incomplete.

## 3. Required and optional components

The ranking service uses the #81 weights exactly:

| Component | Weight | V1 source |
| --- | ---: | --- |
| frequency | 0.20 | current finding `distinctGameCount` |
| severity | 0.20 | registered raw-effect normalization, or mandatory-child severity for synthesized roots |
| result impact | 0.15 | omitted when the current canonical finding does not expose a separate deterministic impact scalar |
| recurrence | 0.15 | `distinctSessionCount` when positive |
| evidence | 0.15 | `requiredEvidenceCoverage` |
| specificity/actionability | 0.05 | registered finding-level mapping |
| conditional concentration | 0.05 | omitted when no separate current canonical scalar is present |
| recency | 0.05 | omitted because the current finding contract does not expose a versioned recency scalar |

`frequency`, `severity`, and `evidence` are mandatory. Missing optional components are removed from both numerator and denominator, as required by #81; they are never silently scored as zero.

## 4. V1 normalization registry

All normalization is fixed by ranking-policy version. No current-scope min/max, percentile, z-score, or candidate-relative scaling is used.

### Frequency

`frequency.distinct-games.5-40.v1`

- method: `LINEAR_CLAMP`;
- raw field: `distinctGameCount`;
- lower anchor: 5 games;
- upper anchor: 40 games;
- direction: ascending.

### Evidence

`evidence.required-coverage.v1`

- method: `IDENTITY_0_1`;
- raw field: `requiredEvidenceCoverage`.

### Recurrence

`recurrence.distinct-sessions.1-5.v1`

- method: `LINEAR_CLAMP`;
- raw field: `distinctSessionCount`;
- lower anchor: 1 session;
- upper anchor: 5 sessions;
- direction: ascending.

The component is omitted when `distinctSessionCount === 0`.

### Specificity

`specificity.finding-level.v1`

- `MECHANISM`: 1.00;
- `ROOT_CAUSE_CANDIDATE`: 1.00;
- `CONTRIBUTING_CONDITION`: 0.75;
- `OBSERVATION`: 0.50.

These are deterministic taxonomy-level values, not learned actionability judgments.

### Severity

Each raw effect must match an exact registered metric/unit/direction. V1 uses zero as the lower anchor after orientation and the following upper anchors:

| Normalization key | Source metric / unit / direction | Orientation | Upper anchor |
| --- | --- | --- | ---: |
| `severity.average-score-loss-cp.v1` | `average-score-loss` / centipawns / higher worse | as-is | 150 cp |
| `severity.average-user-evaluation-cp.v1` | `average-user-evaluation` / centipawns / lower worse | negate | 150 cp |
| `severity.pressure-entry-rate-percent.v1` | `pressure-entry-rate` / percent / higher worse | as-is | 100% |
| `severity.average-score-loss-delta-cp.v1` | `average-score-loss-delta` / centipawns / higher worse | as-is | 100 cp |
| `severity.average-score-loss-delta-context-cp.v1` | same metric / context difference | absolute | 100 cp |
| `severity.later-average-score-loss-delta-cp.v1` | `later-average-score-loss-delta` / centipawns / higher worse | as-is | 100 cp |
| `severity.major-error-rate-delta-pp.v1` | `major-error-rate-delta` / percentage points / higher worse | as-is | 25 pp |
| `severity.major-error-rate-delta-context-pp.v1` | same metric / context difference | absolute | 25 pp |
| `severity.blunder-rate-delta-pp.v1` | `blunder-rate-delta` / percentage points / higher worse | as-is | 20 pp |
| `severity.blunder-rate-delta-context-pp.v1` | same metric / context difference | absolute | 20 pp |
| `severity.score-delta-lower-is-worse-pp.v1` | `score-percentage-point-delta` / percentage points / lower worse | negate | 25 pp |
| `severity.score-delta-context-pp.v1` | same metric / context difference | absolute | 25 pp |
| `severity.pressure-move-rate-context-pp.v1` | `pressure-move-rate-delta` / percentage points / context difference | absolute | 25 pp |
| `severity.pressure-entry-rate-context-pp.v1` | `pressure-entry-rate-delta` / percentage points / context difference | absolute | 25 pp |
| `severity.response-time-context-cs.v1` | `average-response-time-delta` / centiseconds / context difference | absolute | 300 cs |
| `severity.rating-composition-points.v1` | `absolute-mean-rating-difference-delta` / rating points / more confounding | as-is | 200 points |

A rankable non-root finding with an unregistered or missing severity effect fails closed. This makes any new metric family or normalization calibration an explicit ranking-policy change.

Synthesized roots deliberately have no synthetic cross-family raw effect. Their `severity.root-mandatory-child-max.v1` value is the maximum already-normalized severity across mandatory mechanism/context children. Child raw effects and normalization keys are preserved in the root component support.

## 5. Score calculation

For present components:

```text
weightedScore =
  sum(normalizedComponent * configuredWeight)
  / sum(configuredWeight for present components)

finalScore =
  weightedScore
  * evidenceStrengthMultiplier
  * overlapMultiplier
```

Evidence multipliers remain the #81 values:

- `LOW` -> 0.55;
- `MEDIUM` -> 0.80;
- `HIGH` -> 1.00;
- `INSUFFICIENT` -> ineligible.

Overlap multiplier:

- normal current top-level state -> 1.00;
- unresolved material overlap -> 0.75.

Explicit confounder finding IDs remain exposed from consolidation support. V1 does not invent a separate numeric confounder penalty because #81 defines no such multiplier.

## 6. Deterministic ordering

Top-level findings sort by:

1. final score descending;
2. stronger evidence grade;
3. larger `distinctGameCount`;
4. diagnosis ID lexical order;
5. stable `findingKey` lexical order.

Database IDs and timestamps never break ties.

## 7. Persistence

`DiagnosisFindingRanking` stores one derived ranking row per ranked/drill-down finding:

- top-level eligibility and nullable rank position;
- weighted and final score;
- evidence and overlap multipliers;
- complete normalized component payload;
- unchanged raw effect payload;
- consolidation state;
- parent synthesized-root IDs for hierarchy drill-down;
- ranking policy version and calculation support.

`diagnosis-ranking.repository.prisma.ts` replaces ranking rows transactionally only on an owned current finding set. Stale or superseded sets reject writes. Rank positions must be unique and contiguous from 1.

A later canonical finding-set revision naturally receives its own ranking rows; historical ranking state remains attached to the historical set.

## 8. Fail-closed rules

Ranking rejects:

- stale/superseded finding sets;
- incomplete or stale consolidation state;
- unsupported evidence grades or finding levels;
- current top-level findings below the evidence/coverage gate;
- rankable findings without a registered severity effect;
- synthesized roots without mandatory mechanism + context support;
- out-of-range normalization values;
- stale ranking/consolidation version tuples;
- ranking writes to findings outside the current owned set.

## 9. Fixture matrix

`apps/api/test/diagnosis-ranking.test.mjs` covers:

- strong versus weak evidence;
- frequency/severity tradeoffs under fixed normalization;
- unresolved material-overlap penalty;
- root candidate versus supporting-child hierarchy;
- deterministic tie-breaking;
- insufficient/suppressed exclusion;
- unregistered severity failure;
- stale/incomplete hierarchy failure;
- current-version materialization.

Full repository CI remains the acceptance gate for Prisma schema/migration, typecheck, lint/guardrails, build, and all tests.

## 10. Non-goals

This slice does not:

- add learned or AI ranking;
- calibrate anchors from a user population;
- infer recency from timestamps that are not part of the current canonical ranking contract;
- invent a result-impact scalar when one is not independently exposed;
- change source detector/aggregate metrics;
- add Phase 6 presentation or coaching recommendations.
