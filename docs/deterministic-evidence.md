# Deterministic evidence substrate

**Status:** Phase 3 implementation contract  
**Scope:** issue #27  
**References:** `docs/diagnostic-taxonomy.md`, `docs/implementation-architecture-and-dependency-graph.md`, and CRT tactical-detection/job-worker patterns

## Purpose

Phase 3 detectors need one durable, inspectable way to publish deterministic chess evidence. This substrate owns detector execution provenance, coverage, stable event identity, retry/idempotence, and current-versus-historical publication. It does **not** own tactical policy, diagnosis aggregation, UI projection, or AI explanation.

The substrate deliberately adapts CRT's versioned tactical-detection runs and persistent-worker discipline while changing the output from compact detector-specific tags into general structured evidence with exact game/ply/position references.

## Typed detector boundary

A detector implements the `EvidenceDetector` interface under `apps/api/src/modules/evidence`:

- stable `key` and `version`;
- whether complete current Stockfish analysis is required;
- optionally, whether a board-capable detector should run before analysis and refresh against a new immutable source when complete analysis later becomes available;
- one typed `EvidenceInputSnapshot` containing one imported game, current indexed plies/positions, timing facts, and exact analysis provenance when present;
- one `EvidenceDetectorResult` containing explicit coverage plus bounded `EvidenceFindingDraft[]`.

Each finding has a stable detector-local key, evidence type, optional source ply range/position, structured measurements/details, and an explicit availability state. Missing evidence is represented as `UNAVAILABLE` or `INCOMPLETE`; it must not be silently converted into a negative finding.

Detector-specific payload types may become stricter as #28-#33 land. They remain behind the generic execution/persistence shape instead of adding separate run frameworks.

## Durable identity and provenance

`EvidenceRun` binds a detector invocation to:

- one imported game;
- one detector key/version;
- the exact `plyIndexedAt` projection;
- the exact current `GameAnalysisRun` id/snapshot when the detector requires engine evidence;
- durable run/claim/retry/coverage state.

Its `workKey` is deterministic over those immutable inputs. Re-running the same detector/version against the same source projection is therefore idempotent.

A detector with `refreshOnCompleteAnalysis=true` may first publish against the indexed board projection with no analysis id, then become eligible once more when a complete current analysis snapshot appears. The analysis-backed run has a distinct work key and supersedes the earlier board-only current run only after successful publication. If publication is staggered, that successful analysis-backed publication also fences any older board-only claim still in flight, so the older incomplete projection cannot become current again.

`EvidenceEvent` stores:

- a stable `evidenceKey`;
- detector-local `findingKey` and evidence type;
- source ply range and/or position reference;
- availability/unavailable reason;
- structured numeric or categorical measurements and details.

Events belong to their historical run. Reprocessing does not rewrite an older successful run.

## Current versus historical evidence

A successful run becomes `isCurrent=true` for its game and detector key. When a detector version or source projection produces a newer successful run, the previous current run is marked non-current and receives `supersededAt`; its run and events remain stored for debugging/provenance.

`isCurrent` is not sufficient by itself. Current-evidence reads revalidate:

1. the game is still indexed at the run's exact `sourcePlyIndexedAt`;
2. when analysis-backed, the referenced analysis run still matches that source projection and remains `SUCCEEDED / COMPLETE`;
3. every current ply still points at that exact game-analysis run.

A stale source/index/analysis projection therefore cannot be served as current evidence even before a replacement detector run finishes.

## Worker execution and boundedness

The API process never runs detectors. The persistent worker executes evidence after import, ply indexing, and Stockfish in the existing worker cycle.

One claimed evidence run is one **game x detector/version** unit. A detector result is capped at 256 findings per run. Detectors must query/compute only from the provided bounded snapshot. Cross-game aggregation belongs to later diagnosis work and must use separate bounded query interfaces.

The registry in `evidence.registry.ts` is intentionally explicit. #28-#33 register concrete detector families there as they land.

## Claims, retries, and stale work

Evidence claims use worker id plus claim token. Late writes from an expired claim are rejected. Stale claims retry with bounded exponential backoff up to the run's `maxAttempts`; terminal failures remain historical with `INCOMPLETE` coverage.

If the source or analysis projection moves while work is queued or running, the run becomes `SUPERSEDED`. The worker does not publish its findings.

## Coverage semantics

Run coverage uses these substrate states:

- `COMPLETE`: required evidence modalities for this detector were fully available and processed.
- `PARTIAL`: the detector deliberately produced usable evidence over only part of the eligible source.
- `UNAVAILABLE`: required source modality was absent, and that absence itself is the authoritative detector outcome.
- `INCOMPLETE`: execution/provenance failed or became stale before a trustworthy detector outcome was completed.

A detector may additionally persist unavailable/incomplete events when a source-local absence must be inspectable at a specific ply/position. Later APIs should expose these states rather than flattening them into “no finding”.

## Ownership and future seam

Persistence and worker orchestration live in `apps/api/src/modules/evidence`. Framework-neutral chess geometry/policy should live in `packages/chess-domain` where practical. Detector code must not import AI providers, provider DTOs, or transport/UI state.

The future replacement seam is the typed detector input/output plus evidence repository/query interfaces. No generalized workflow framework is introduced here.
