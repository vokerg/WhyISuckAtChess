# Phase 6 time-control comparison read model

**Status:** consumer boundary for issues #116 and #118  
**HTTP:** `GET /api/diagnosis/time-controls`  
**Web:** `/diagnosis/time-controls`  
**Source authority:** accepted Phase 4B `TIME-005` exact-control and `TIME-006` increment-effect aggregates

## Purpose

Phase 6 needs a product-facing comparison boundary without making the browser, API route, or future AI layer reimplement timing policy. This endpoint composes the existing deterministic aggregate services and projects only the fields a product consumer needs.

It is deliberately not another analysis engine. Comparator selection, exact-control eligibility, current-engine provenance, timing reliability, evidence strength, and rating-composition semantics remain owned by the existing Phase 4B services.

## Request scope

The endpoint is authenticated and uses the current application user as the ownership boundary.

Optional `from` and `to` query parameters are UTC/offset-aware instants and form the same half-open source-game window used by the underlying aggregate repositories:

```text
from <= game.startedAt < to
```

Either bound may be omitted. When both are present, `from` must be strictly earlier than `to`. Invalid instants or reversed/empty ranges return HTTP 400.

The endpoint does not accept an account ID, Lichess username, imported-game IDs, or another ownership selector.

## Exact-control projection

The `exactControl` section is a bounded projection of `TIME-005 EXACT_TIME_CONTROL_UNDERPERFORMANCE`.

For each returned target comparison it preserves:

- the exact control key and its initial/increment seconds;
- the selected same-initial-time comparator control;
- eligible/result-covered/engine-analysed game counts;
- score percentage and current-engine score-loss/error metrics;
- result and quality evidence strength;
- raw target-minus-comparator deltas;
- the separate `RATING-002` material opponent-strength-composition warning.

Controls such as **3+0** and **3+2** are therefore not collapsed into a broad `blitz` bucket. The read model neither chooses a different comparator nor recomputes the aggregate.

## Increment-effect projection

The `incrementEffect` section is a bounded projection of `TIME-006 INCREMENT_EFFECT`.

Each returned stratum preserves one matched initial-time population and exposes separate no-increment and increment arms, including:

- the exact controls represented in each arm;
- result score;
- current-engine score-loss/error metrics;
- trustworthy timing coverage and pressure rates;
- result, quality, and timing evidence strength;
- deltas in the authoritative direction: **increment minus no-increment**;
- the separate `RATING-002` material composition warning.

The projection does not merge different initial-time strata or convert association into a causal claim.

## Boundedness

The Phase 4 services already cap candidate games at 5,000. This consumer boundary adds independent response caps so a future browser does not receive an unbounded aggregate shape:

- at most **25** exact-control comparisons;
- at most **25** increment-effect strata;
- at most **12** exact-control identities per increment arm;
- at most **20** caveats per aggregate section.

Every capped collection exposes `total`, `returned`, and `truncated` metadata. Truncation affects only presentation volume; it does not alter the underlying aggregate calculation.

## Coverage and interpretation

The response keeps result, engine-quality, and timing coverage separate. Missing engine analysis is not converted into good move quality, and missing/unreliable clock data is not converted into no time pressure.

Evidence grades are deterministic policy grades, not p-values or causal confidence. `RATING-002` remains a disclosure about opponent-strength composition and never adjusts a measured `TIME-005` or `TIME-006` delta.

The response excludes internal game IDs, raw aggregate source rows, Prisma records, ranking/support blobs, provider credentials, and AI output.

## CRT reference / Why delta

**Reference:** CRT `apps/api/src/services/accountPerformanceStatsService.ts` and account-profile time-control presentation patterns.

**Preserve:** bounded owned projections, exact structured time controls, W/D/L/result context, and typed consumer contracts.

**Change:** Why projects the already-accepted provenance-safe timing aggregates instead of deriving product comparisons from raw imported games. Engine/timing coverage, evidence grades, exact 3+0/3+2 identity, matched initial-time increment strata, and rating-composition disclosure remain first-class.

**Omit:** CRT profile breadth, new comparison algorithms, browser UI, diagnosis ranking changes, and AI narrative generation.

**Future seam:** an Angular comparison page or grounded explanation layer can consume this endpoint without importing Phase 4 persistence or policy code.

## Angular consumer

Issue #118 adds the first read-only browser surface at `/diagnosis/time-controls`.

The page:

- parses the backend payload through the shared strict contract;
- keeps exact controls such as 3+0 and 3+2 visibly distinct;
- presents `TIME-005` deltas only as **target minus comparator**;
- presents `TIME-006` deltas only as **increment minus no-increment** within one matched initial-time stratum;
- keeps result, engine-quality, and timing coverage/evidence separate;
- renders missing measurements as unavailable rather than zero;
- surfaces `RATING-002` material-composition warnings, backend caveats, and collection truncation;
- links from the ranked diagnosis summary without changing diagnosis rank or policy.

The first consumer intentionally requests the endpoint without date bounds and therefore presents the backend's all-available-history scope. Date-range editing remains a later presentation enhancement; adding it must continue to pass only validated UTC/offset-aware bounds to this existing endpoint.

No comparison, comparator choice, evidence grade, timing reconstruction, or causal interpretation is calculated in Angular.

## Phase boundary

Issue #116 adds the backend consumer contract and issue #118 adds its first Angular consumer. Together they still do not add:

- date-range editing UI;
- AI-generated explanation;
- new calibration/statistical significance;
- a new aggregate or persisted diagnosis;
- causal claims about increment or time control.

Those consumers may present the accepted measurements later, but they must preserve the authority and caveats exposed here.
