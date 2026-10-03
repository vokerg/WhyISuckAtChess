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
