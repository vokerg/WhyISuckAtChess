# Diagnosis summary read model

**Status:** Phase 6 consumer boundary from issue #100  
**Source authority:** accepted Phase 5 current diagnosis finding set + persisted ranking  
**HTTP:** `GET /api/diagnosis/summary?scopeKey=<scope>`

## Purpose

Phase 6 needs a stable product-facing boundary over the accepted deterministic diagnosis hierarchy. This read model is deliberately not a second diagnosis engine: it reads persisted current hierarchy/ranking state and projects a bounded contract for web/product consumers.

The endpoint is authenticated and ownership-scoped by the current application user.

## Response states

The response is always explicit about readiness:

- `AVAILABLE` — the current finding set has current consolidation/ranking policy versions and a complete persisted ranking projection;
- `UNAVAILABLE / NO_CURRENT_DIAGNOSIS` — no owned current finding set exists for the requested scope;
- `UNAVAILABLE / HIERARCHY_INCOMPLETE` — the current finding set does not yet have complete current consolidation state;
- `UNAVAILABLE / RANKING_INCOMPLETE` — an eligible finding is missing persisted ranking state or persisted positions are inconsistent;
- `UNAVAILABLE / RANKING_STALE` — the current set or ranking rows use a non-current ranking/consolidation/synthesis policy generation.

The read path does not trigger synthesis, consolidation, or ranking recalculation. A stale/incomplete revision remains unavailable until the authoritative calculation path refreshes it.

## Available summary

An available response exposes only persisted top-level ranked findings, in persisted rank order. Each item contains:

- stable finding and diagnosis identifiers;
- finding level, observation state, and claim key;
- sample/game/session counts;
- required evidence coverage and evidence strength;
- the inspectable raw effect tuple when one exists;
- persisted consolidation state;
- persisted rank position and final score;
- up to three representative evidence references with owned game/ply/event identity linkage.

Root-support children remain drill-down ranking rows in persistence and are intentionally omitted from this summary list. Later Phase 6 drill-down read models may expose them without promoting them back into independent top-level reasons.

## Boundedness and privacy

The repository projects only fields needed by this consumer contract. It does not expose arbitrary `coverageJson`, `sourceVersionsJson`, ranking component blobs, relationship support blobs, provider credentials, or AI output.

Representative evidence is limited to the existing Phase 5 maximum of three examples per finding.

## Phase boundary

This endpoint is the first Phase 6 read boundary. Angular diagnosis summary/drill-down views and optional grounded explanation can build on it. AI may explain accepted output later, but it must not create, suppress, promote, or rank authoritative findings.


## Phase 6 web consumer

Issue #102 adds the first Angular consumer at `/diagnosis`.

- the application root redirects to the diagnosis summary rather than the imported-game library;
- the page requests only the current owned `overall` scope through the shared response schema;
- backend `UNAVAILABLE` states remain distinct from transport/schema failures;
- findings are rendered in the persisted response order with rank, evidence strength, sample/game/session counts, required coverage, raw effect data, and policy versions visible;
- representative evidence with an imported-game ID links to the existing `/games/:gameId` replay route;
- the web layer contains presentation labels only. It does not calculate scores, re-rank findings, promote/suppress hierarchy members, or infer new chess facts.

The summary remains intentionally shallow. Drill-down, comparison views, and optional grounded explanation require their own bounded backend contracts rather than reaching into diagnosis persistence from Angular.


## Phase 6 drill-down read model

Issue #104 adds the first bounded detail boundary:

`GET /api/diagnosis/findings/:findingId?scopeKey=<scope>`

The endpoint reuses the available diagnosis summary as the authority for the selected parent. A finding ID is accepted only when it is a current persisted top-level ranked finding in the authenticated user's requested scope. IDs outside that current summary return `UNAVAILABLE / FINDING_NOT_FOUND` and do not trigger a broader lookup.

For an available parent, the repository reads only child `DiagnosisFindingRanking` rows whose persisted `parentRootFindingIds` contains that parent. Each returned child must also have exactly one same-revision `DiagnosisRootCandidateSupport` row for that parent; the API exposes only its typed role (`MECHANISM`, `CONDITION_OR_OBSERVATION`, or `ADDITIONAL_SUPPORT`). It does not infer a relationship from diagnosis IDs, finding levels, effect similarity, or browser rules.

Supporting findings expose:

- stable finding/diagnosis identifiers and claim;
- finding level and observation state;
- evidence strength and sample/game/session counts;
- required evidence coverage;
- the raw effect tuple when complete;
- persisted consolidation state and persisted final score;
- the support role for the selected root;
- up to three representative evidence references.

Supporting rows intentionally have no independent rank position. Phase 5 persists them as drill-down ranking state beneath supported synthesized roots, so Phase 6 preserves the parent assignment and final score without promoting children back into the top-level list.

The drill-down response reuses the summary's finding-set identity, calculation timestamp, and version tuple. Stale/incomplete ranking or hierarchy state remains unavailable, and a current-revision race fails closed rather than mixing finding generations.

The same privacy boundary applies as the summary: no `coverageJson`, `sourceVersionsJson`, ranking components/support blobs, root-support proof blobs, provider credentials, or AI output cross the HTTP contract. The current finding-set policy bounds the drill-down population to at most 200 current findings and representative evidence remains capped at three references per finding.

This backend contract is a future seam for an Angular drill-down page and optional grounded explanation. Those consumers may present accepted facts, but they must not recalculate hierarchy, assign child ranks, or create new diagnosis claims.

## Phase 6 drill-down web consumer

Issue #106 consumes the bounded detail endpoint in a standalone Angular page at `/diagnosis/:findingId`. Every ranked parent on `/diagnosis` links to its corresponding detail page; the browser requests only the `overall` scope and uses the strict shared `DiagnosisDrillDownResponse` schema. Invalid/non-positive/unsafe route IDs do not reach the API. Responses for a different scope or selected parent are rejected instead of displayed.

The page preserves backend semantics:
- the selected parent retains its **persisted** top-level rank, score, evidence strength, counts, effect, coverage, observation/hierarchy state, revision and policy versions;
- supporting findings appear in the **received order** with their persisted `supportRole`, final score, raw effect, source coverage and representative evidence; they have no assigned rank or inferred relationship;
- up to three existing imported-game evidence references per finding navigate to the owned game replay route;
- transport/schema errors are distinct from backend `UNAVAILABLE` reasons (including a finding no longer present in the current ranked summary), and an available parent with zero children is shown as a distinct valid empty state;
- route changes invalidate in-flight UI requests so a delayed prior response cannot overwrite the newly selected finding.

The consumer is presentation-only. It does not fetch ranking-component blobs, support proof blobs, provider data or AI output; it does not synthesize new claims or modify the persisted hierarchy. Future comparison/explanation work must use its own bounded authority-preserving contract.

## Phase 6 read-only evidence interpretation

Issue #110 adds a reusable accessible `How to read this diagnosis` disclosure to the AVAILABLE summary and drill-down views. It adapts CRT's Player Chess Profile coverage-note presentation pattern, without importing the profile's derived metrics or introducing any new data access.

The guide distinguishes normalized persisted *ranking priority* from causal probability, evidence *strength grade* from statistical significance, eligible supporting *sample observations* from distinct game/session counts, *required evidence coverage* from the frequency of a weakness, and raw *effect* from a prediction. It also states that comparative grades can be limited by the weaker arm and concentration, without inferring why any individual finding received its grade.

Representative references remain a maximum of three examples, not a reconstructed denominator. Drill-down children remain unranked independently. This is deliberately static policy interpretation, not an AI explanation or an additional authority for scores, coverage, ranking, or relationships.

## Phase 6 evidence-to-replay navigation

Issue #108 connects representative references to a *position*, not just a game. Both the ranked summary and drill-down parent/child cards link owned imported-game evidence to `/games/:gameId?ply=<sourcePlyStart>` when the persisted start ply is a positive safe integer and its optional end does not precede it. A reference without a usable ply still links to the game; a reference without an imported-game ID is not linked. A range selects its first recorded ply, without claiming that all range events are shown at that one move.

The replay route parses only canonical positive safe integer ply query values, waits for its owned replay response, then selects that ply only when it exists in the indexed game. Missing, malformed, or out-of-range targets display the starting position rather than substituting another move. A query-only change updates the current selection without fetching the game again; stale results from an earlier game route are ignored. This browser-only navigation adds no diagnosis recomputation, source-data mutation or access to unsanitized evidence blobs.


## Phase 6 time-control comparison boundary

Issue #116 adds the first dedicated comparison read model at `GET /api/diagnosis/time-controls`; its canonical contract is documented in `docs/time-control-comparison-read-model.md`.

Unlike the persisted hierarchy summary/drill-down endpoints, this boundary composes the already-accepted Phase 4B `TIME-005` and `TIME-006` aggregate services. It does not read diagnosis persistence, recalculate ranking, or infer a new finding. Exact-control identity, matched initial-time increment strata, separate result/engine/timing coverage and evidence grades, and `RATING-002` composition disclosure remain authoritative from their owning aggregate services.

The response is independently capped for product consumption and reports truncation metadata. A later Angular comparison page or grounded explanation layer must consume this bounded projection rather than importing aggregate repositories or reimplementing comparison policy.
