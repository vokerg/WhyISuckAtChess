# Phase 7 detector validation: scoped audit baseline (#124)

**Status:** Partial #124 groundwork. This is a machine-readable tactical motif *test-oracle audit*, not accepted chess-detector precision/recall. #124 remains open pending independently reviewed, representative cross-family evidence.

## Reproducible audit

From a fresh checkout with Node 22.12+, npm dependencies installed, and the API compiled:

```sh
npm ci
npm run build:domain
npm run build:contracts
npm run build:api
node --test apps/api/test/phase-7-detector-audit.test.mjs
node apps/api/test/support/phase-7-detector-audit.mjs > phase-7-detector-audit.json
npm run typecheck
npm run lint
npm test
```

The JSON report is generated from the checked-in v1 [corpus](../apps/api/test/fixtures/phase-7-gold-corpus.v1.json), the production tactical-motif detector, and one-ply synthetic analysis snapshots. The test invokes the same report producer. No database, Lichess request, Stockfish process, credentials, or production accounts are required. Engine annotations use a **deterministic test double**, not Stockfish. The report includes no personal identifiers or nondeterministic engine outputs.

It records per case: stable ID, synthetic ply/UCI, engine version/provenance, case kind, expected/observed coverage, scoped required/forbidden exact motif predictions, review status, and presence of a coverage-gap finding. Only *explicitly listed* required and forbidden labels are compared. An additional unlisted motif is exposed by its count, not assumed false-positive: no exhaustive reference labeling exists.

## V1 baseline and denominators

| Tactical fixture stratum | Cases | Label assertions | Check |
| --- | ---: | ---: | --- |
| Complete: missed existing fork, created fork, newly allowed pin | 3 | 3 required | Required type/motif/state equals the synthetic oracle |
| Complete: low-loss hard negative, incidental target | 2 | 2 forbidden | Specific forbidden labels are absent |
| Missing engine / missing after-position analysis | 2 | 0 | UNAVAILABLE / INCOMPLETE, coverage-gap flags, no emitted tactical motifs |

**7 tactical cases; 5 exact scoped label assertions; 2 coverage exclusions.** The other seven v1 cases exercise timing exposure or Phase 5 diagnosis projection; they do not contribute to detector accuracy or the tactical denominator.

All cases are `PENDING_DOMAIN_REVIEW`. Synthetic oracle agreements only measure implementation-to-fixture consistency. In JSON, `truePositives`, `falsePositives`, `falseNegatives`, `trueNegatives`, `precision` and `recall` are deliberately **null**, and `reviewedAssertions` is zero. They are not zero rates; even a 5/5 oracle match is *not* an accuracy estimate against independent chess truth. Hand-selected, overlapping test fixtures do not support population generalization.

## Audit interpretation and human review

- **Event identity:** each case is one legal FEN/SAN/UCI transition, not a sampled real game. Compare `type + motif + motifState`. Review other observed motifs separately rather than automatically declaring them FP.
- **Coverage:** assert known presence/absence only with `COMPLETE` expected and observed coverage. `UNAVAILABLE` or `INCOMPLETE` are exclusions, **not** TN/FN. Emitting a tactical motif during insufficient coverage is a separate integrity failure.
- **Domain truth:** use the [corpus adjudication protocol](phase-7-gold-corpus.md). Review legality, real engine line, continuation, coverage, chess mechanism and interpretation separately. Attach source evidence and human reviewer identity; retain disputes. Version the corpus and policy on revised labels.
- **Error classes:** distinguish a wrongly emitted event, a missed expected event, wrong mechanism/reason, source or analysis gap, and disputed/unreviewable position. A simulated centipawn loss does not independently validate the chess meaning.
- **Future metrics:** once independently adjudicated eligible positive and negative events exist, report per-family TP/FP/FN/TN, explicit denominators, precision/recall only where defined, and exclusions separately. Do not double-count aliases of the same game/ply.

## Boundaries and remaining #124 work

This harness audits only the seven `TACTICAL_MOTIF` cases. Material/hanging, other tactical offense, defensive threat, conversion/game story, phase/endgame, and opening detector families have **no adjudicated cases in this report**. Unmeasured is not zero incidence, measured accuracy, or unsupported implementation. Timing/ranking calibration belongs to #125.

#124 must still expand the rights-safe corpus to other *implemented* detectors with positives, hard negatives, wrong-reason and disputed cases; use real Stockfish evidence where it is essential; secure independent chess-domain labels; compare per-family event TP/FP/FN and exclusions; and file narrow correctness/versioning PRs when supported. Report selection bias, source/clock provenance, and ambiguous cases. This PR does not change production detector policies.

## CRT reference / Why delta

**Reference:** CRT `apps/api/test/tactical-detections/tactical-detection-policy.test.mjs` checks hard-negative tactical policy cases, including the winning-to-still-winning counterexample. **Preserve:** deterministic reproducible policy checks. **Change:** Why also audits explicit motif identity and coverage gating, separating simulated engine facts from human adjudication. **Omit:** CRT training eligibility, unverified Stockfish claims, new taxonomy producers. **Future seam:** a versioned structured audit into which separately reviewed labels and representative event identities can be added without changing detector interfaces.

## Validation record

Created in a GitHub-connected session without a local checkout; no local npm, PostgreSQL, or Stockfish execution is claimed. Focused tests are included by the API test glob. Review PR exact-head CI and request independent code/chess review before merge. This is partial #124 progress, not completion of issue #124 or Phase 7 acceptance.
