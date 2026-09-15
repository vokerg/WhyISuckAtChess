# Phase 3 evidence integration and acceptance

**Status:** acceptance implementation for issue #36  
**Date:** 2026-09-15  
**Phase exit target:** important events in an individual game are represented as inspectable, versioned, provenance-safe structured evidence suitable for later cross-game aggregation.

## Accepted product slice

The accepted Phase 3 path is:

```text
authenticated Lichess import
  -> normalized game + lossless source clocks
  -> ply indexing + timing derivation
  -> complete current Stockfish game analysis
  -> explicit evidence detector registry
  -> versioned EvidenceRun / EvidenceEvent persistence
  -> current-evidence provenance revalidation
  -> owned imported-game replay/detail contract
  -> Angular replay evidence markers and inspection
```

The registered detector families are:

- material state / hanging and missed material;
- position phase and endgame family context;
- tactical motifs;
- defensive threats / threat blindness / missed mates;
- conversion, throws, and saves;
- opening move quality and recurring opening-position evidence.

No diagnosis ranking, cross-game behavioral aggregation, recommendation system, or AI prose is part of this acceptance boundary.

## Integration acceptance matrix

| Requirement | Acceptance evidence |
| --- | --- |
| Refresh from current `main` and exercise the composed Phase 3 slice | `apps/api/test/pipeline-acceptance.test.mjs` uses the post-#35 tree and drives one DB-backed fixture through import, indexing/timing, analysis, all registered detectors, persistence, typed replay projection, and stale-source invalidation. |
| Import -> indexing/timing -> Stockfish -> detectors -> replay | The pipeline acceptance test uses the real importer, ply indexer/timing derivation, game-analysis service with a deterministic engine double, real evidence snapshot loading/publication, and `createImportedGamesQueryService()`. |
| Bullet remains eligible | The acceptance fixture is a standard **bullet** game with source clocks. Additional policy coverage remains in `ply-index-timing.test.mjs`, `engine-analysis-persistence.test.mjs`, and detector tests. |
| Stale source/index/analysis cannot remain current | `evidence-persistence.test.mjs`, `imported-games-read-model.test.mjs`, and the pipeline acceptance test verify source/analysis fencing and that changing `plyIndexedAt` immediately removes stale replay evidence. |
| Retry/reprocessing does not duplicate current evidence | Evidence work keys are source/detector/version deterministic; `evidence-persistence.test.mjs` covers idempotence/claim fencing, and the pipeline acceptance test verifies a drained projection does not enqueue duplicate work and event identities do not collide. |
| Incomplete evidence cannot become a false negative | Detector tests explicitly exercise missing engine, MultiPV, board, timing, and recurrence coverage. The pipeline fixture intentionally lacks richer MultiPV evidence and verifies non-complete detector coverage remains visible in the typed replay projection. |
| Detector overlap / deduplication | Curated detector tests cover material missed-capture vs hanging suppression, tactical motif identity dedupe, defensive-threat creation vs pre-existing geometry, and conversion trajectory compaction. |
| Boundedness | Evidence scheduling claims one game x detector/version unit, persistence caps detector output at 256 findings, detector-local caps are lower where appropriate, candidate queries use bounded selection, replay reads one owned game/current evidence projection, and opening recurrence tests reject over-broad history. |
| Ownership/security | Imported-game repository/read-model tests enforce `appUserId` ownership for list/detail/replay; HTTP route tests pass authenticated ownership through the boundary. Evidence reads occur only after the owned game row is resolved. |
| Frontend inspection | `apps/web/test/replay-evidence.integration.test.ts` covers mocked HTTP -> contract parser -> `GameReplayStore` -> Angular-rendered evidence details, including partial coverage and multiple events. |
| Full repository/DB validation | GitHub CI validates Prisma schema/migrations, typecheck, architecture/hygiene guardrails, production build, and the full test suite. CI on the #36 PR is the merge gate for this acceptance pass. |

## Review conclusions

The Phase 3 modules compose without requiring a new orchestration framework. The worker remains the owner of import/index/analysis/evidence execution; HTTP reads remain bounded and ownership-scoped; detector outputs remain versioned facts with explicit coverage; the UI consumes the typed projection instead of recalculating chess policy.

The acceptance pass did not identify a concrete production defect requiring a detector-policy change. It did identify an integration-test gap: the existing pipeline acceptance stopped after Stockfish/replay and therefore did not prove that the detector registry, persistence, and read model composed with the upstream pipeline. Issue #36 closes that gap by extending the existing acceptance harness instead of adding a second competing pipeline test.

## Residual risks

These are accepted Phase 3 residual risks, not hidden blockers:

- The DB-backed acceptance test uses a deterministic engine double, not a real Stockfish subprocess. Real-engine binary/process economics and calibration remain Phase 7 validation work.
- There is no browser E2E test that launches API, worker, and Angular together. The backend DB acceptance test and Angular contract/store/render integration test cover the seam independently.
- Detector thresholds and motif precision still require broader curated/manual chess calibration; Phase 3 acceptance establishes software/provenance correctness, not final product calibration.
- Cross-game overlap/root-cause consolidation is intentionally deferred to longitudinal analysis and diagnosis phases. Phase 3 only prevents misleading duplicates within each detector's defined per-game evidence contract.
- Performance is bounded by current query/result caps, but production-scale throughput and Stockfish cost measurement remain Phase 7 operational validation.

## Exit decision

Once the #36 PR passes full CI and is reviewed/merged, the Phase 3 exit condition is satisfied: an imported standard game can produce inspectable, structured, versioned deterministic evidence tied to exact games/positions/plies, with explicit coverage and provenance suitable for later aggregation.
