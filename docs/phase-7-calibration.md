# Phase 7 timing / evidence / ranking calibration: deterministic sensitivity baseline (#125)

**Status:** Partial #125 groundwork, **not** independently reviewed empirical calibration and **not** Phase 7 sign-off. This change does not alter production timing, ranking, or evidence-policy versions.

## Purpose and reproducibility

This is a versioned, machine-readable **policy sensitivity audit** of the current production pure-policy functions. It complements the [synthetic gold corpus](phase-7-gold-corpus.md), [timing analysis](time-behavior-analysis.md), and [diagnosis synthesis/ranking policy](diagnosis-synthesis-ranking-policy.md); it does not establish chess-domain accuracy or generalization.

From Node >=22.12 with dependencies installed and the API compiled:

```sh
npm ci
npm run build:domain
npm run build:contracts
npm run build:api
node --test apps/api/test/phase-7-calibration-sensitivity.test.mjs
node apps/api/test/support/phase-7-calibration-sensitivity.mjs > phase-7-calibration-sensitivity.json
npm run typecheck
npm run lint
npm test
```

The report reads **production** `time-behavior-v1` and `diagnosis-ranking-v1` policy functions and reports exact deterministic outputs from hand-built synthetic inputs. It links the 14-case unreviewed v1 corpus by ID, but it does **not** pretend that these one-ply fixtures or synthetic aggregates are a representative sample of games. All values are simulated or policy thresholds, not newly observed player measurements. There is no Stockfish, database, Lichess call, new policy, migration, or real reviewer in this command.

## Sensitivity and negative-control matrix

| Probe | Baseline and perturbation | Current deterministic observation | Interpretation |
| --- | --- | --- | --- |
| Clock pressure | 1,000 / 1,001 and 3,000 / 3,001 centiseconds, absent clocks | Critical at <=1,000; pressure through 3,000; normal above; absent = unknown | No inferred pressure for missing clocks; absolute values are policy choices, not calibrated from users |
| Ample time | 60s, 180s, and 600s initial clocks, immediately below/at floor | Threshold uses max(45s, 25% of initial); for 600s it is 150s | Wide clock controls have a different ample-time boundary |
| Move speed | 100 / 101 centiseconds, absent | FAST at <=1s; null if absent | Does not establish rushing intent |
| Evidence coverage | 49.9% / 50% / 100%, with 4/5/14/15/39/40 supporting games | Missing or <50% => INSUFFICIENT; at >=50%, 5=LOW, 15=MEDIUM, 40=HIGH | Deterministic grading, **not** statistical confidence |
| Comparative weak arm | 40 vs 40, 14, 4 or 39 games; one arm under coverage | HIGH, LOW, INSUFFICIENT, MEDIUM respectively; insufficient if either arm loses coverage | No pooled-sample promotion of a weak arm |
| Rating composition | Mean delta 99.9/100 points, band share 19.9/20 pp, missing values | Warning at >=100 points or >=20 pp; unknown remains unknown | `RATING-002` discloses a confounder; no invented rating adjustment |
| Ranking insertion/order | Reverse source finding order; add an extreme-but-insufficient finding; add a neutral adequate-coverage finding | Baseline two-row top-level order and scores unchanged | Sparse outliers and no-effect controls cannot displace supported findings |
| Ranking 50% gate | Reduce a supported finding's coverage to 49.9%, restore to 50% | Excluded below gate; eligible at gate | Coverage validity dominates severe effect; does not imply a precise optimal threshold |
| Ranking score sensitivity | Increase supported severity from 60 to 100 cp, or grade MEDIUM to HIGH | Score increases with both; rank scores/provenance remain inspectable | Displays the v1 weighting response, not real-world importance |
| Hierarchy and staleness | Supported synthesized root plus both eligible children; mark a finding set noncurrent | Only root appears in top-level ranks; children remain drill-down; stale input rejected | No double-counted root/child ranking and no silent old-revision reinterpretation |

Synthetic corpus strata retained for subsequent end-to-end calibration: `time-control-separation` distinguishes `180+0` vs `180+2`, `time-rapid-clocks-absent` is **unavailable**, and `time-mixed-coverage` is **partial**, not a clean negative. These are source/fixture assertions covered by the gold-corpus tests; this new matrix only audits policy functions and cannot claim to have run the ingestion or ranking pipeline for those entire games.

## What is still unknown

- **Independent judgment:** 0 independently adjudicated calibration cases, 0 domain reviewers, 0 qualitative disagreements recorded. Every v1 gold-corpus case still says `PENDING_DOMAIN_REVIEW`; neither consensus nor absence of disagreements may be inferred.
- **Empirical denominator:** no representative user games/positions, no outcome/quality/clock denominators per exact-control + increment stratum, no observed sampling variance or rank-change frequency. Rates, confidence intervals, p-values, causal claims and accuracy estimates are **not available**.
- **Stale engine analysis:** current-finding-set rejection is mechanically probed. Real stale analysis run / snapshot-to-ranking suppression requires end-to-end fixture or real-engine verification, not this pure ranking test.
- **Outcomes and confounding:** result, quality and timing denominators must be reported separately in follow-up measurements; opposing rating composition must be shown rather than removed by a fabricated adjustment. A high rank is not a claim of causation or psychological state.
- **Coverage and taxonomy:** unsupported candidate families and unavailable clocks are not zero observed incidence. The detector [audit](phase-7-detector-validation.md) and adjudicated error/counterexample labels remain necessary inputs before calibration sign-off.

## Decision register (no runtime threshold change)

| Candidate | Mechanical signal / potential benefit | Risk / evidence needed | Decision |
| --- | --- | --- | --- |
| Change pressure or ample-clock cutoffs | Sharp deterministic boundary; alternative cutoffs could reclassify plies | No adjudicated timing data or observed false positive/negative costs | **Defer** |
| Change evidence grades 5/15/40 or coverage 50% | Sparse and missing-data cases currently fail closed | Changing cutoffs without denominators/reviewer decisions could overstate support | **Keep v1**, empirically evaluate later |
| Pool comparative arms to strengthen rating/time findings | Could lift weak-arm grades | Overstates evidence and obscures composition/confounding | **Reject without study design** |
| Adjust ranking weights or severity anchors | Scores respond monotonically to controlled input | No reviewed preference labels, outcome relevance, or measured stability distributions | **Defer** |
| Count synthesized root and children as independent top-level reasons | Would increase apparent finding count | Duplicates the same supporting evidence | **Keep suppression** |
| Apply a new policy to historical findings in place | Simpler implementation | Breaks immutable evidence provenance / version tuple | **Prohibit** |

**Change protocol if future evidence justifies recalibration:** add a new explicitly named timing/evidence/ranking policy version (and component normalization keys as needed), save before/after results on the *same independently reviewed* source cases and exact-control strata, assess side effects on rank and false-positive/miss judgments, and independently review a narrow change PR. Recompute each affected **owned player scope** with the full version tuple using the current provenance-safe evidence; materialize new revisions and atomically supersede old current findings/relationships/root supports/rankings. Do not mutate imported source facts or historical revisions, mix version tuples, or backfill stale engine outputs. Rollout/migration must state cost and rollback strategy before production use.

## CRT reference / Why delta

**Reference:** CRT `apps/api/test/tactical-detections/tactical-detection-policy.test.mjs` uses deterministic adversarial boundary controls; inspect alongside Why's [Phase 4B acceptance](phase-4b-acceptance.md). **Preserve:** explicit boundary and no-effect regressions. **Change:** Why adds per-clock/increment evidence, weaker-arm grading, immutable ranking/root semantics and provenance-aware re-evaluation. **Omit:** CRT training-eligibility policy, statistical conclusions from synthetic cases, new producers. **Future seam:** structured sensitivity reports for independently reviewed calibration fixtures and version-to-version comparisons.

## Validation status

Created through the connected GitHub workflow. The files are checked in for GitHub Actions validation and independent review; this session **did not execute local npm, Stockfish, PostgreSQL, or human calibration**. Require exact-head API test, full CI, independent implementation review and subsequent chess-domain review. This is one bounded #125 input, **not** grounds to close #125 or #128.
