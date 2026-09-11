# Stockfish analysis and move-quality evidence

Issue #13 implements the worker-owned engine-evidence stage between deterministic ply indexing and later chess-mechanism diagnosis.

## Eligibility and invocation

Stockfish runs only in the persistent worker (`npm run dev:worker` in `apps/api`, or the root worker script). HTTP handlers do not spawn or wait for the engine.

Automatic analysis is eligible when an imported game:

- comes from Lichess;
- has completed ply indexing;
- is standard chess (`standard`, `chess`, or the existing null-compatible standard representation);
- is bullet, blitz, or rapid;
- contains indexed plies.

The default deterministic profile is:

- depth: 16;
- MultiPV: 3;
- threads: 1;
- hash: 64 MB;
- analysis version: `stockfish-depth16-multipv3-v1`.

`STOCKFISH_PATH` selects the executable when needed. `STOCKFISH_COMMAND_TIMEOUT_MS` bounds each UCI initialization/readiness/search wait and defaults to 30 seconds. A semantic engine-policy change must use a new analysis version; the settings JSON and SHA-256 settings hash are persisted on every game run.

The settings hash serializes the four profile fields in a fixed order, so equivalent settings objects produce the same provenance key.

## Reusable normalized-position cache

Engine search results are reusable position evidence, not game-run-owned rows.

`StockfishPositionAnalysis` is keyed by:

```text
position
+ analysisVersion
+ settingsHash
+ engineName
+ engineVersion
```

The `Position` identity is already normalized by the indexing stage, so transpositions and repeated positions across games/reanalysis can reuse the same engine evidence. A worker loads all compatible cached positions before starting Stockfish and searches only cache misses.

Position rows contain the principal evaluation, mate score, best move/PV, structured MultiPV lines, and raw UCI `info` lines. Centipawn and mate values are normalized to **White's perspective** before persistence so game-specific calculations do not depend on whose turn it was when Stockfish produced the score.

Cache rows are immutable for a provenance tuple. A different policy/settings/engine provenance produces a different cache key instead of mutating historical evidence.

## Game-specific score loss and classification

Reusable position evaluation remains separate from played-move evidence.

For each `ImportedGamePly`, the completed game-analysis run persists:

- `engineAnalysisRunId`;
- `scoreLossCp`;
- `classificationCode`.

Played-move evaluation is resolved from the matching MultiPV line when present, from the principal line when the played move is best, or otherwise from the analysed after-position. Mate scores are converted to a deterministic effective evaluation of +1000/-1000 centipawns before loss calculation.

Score loss is calculated from the mover's perspective and clamped to a non-negative bounded value. Baseline classifications preserve the CRT policy:

- Best: played best move or 0 cp loss;
- Good: under 30 cp;
- Inaccuracy: 30–79 cp;
- Mistake: 80–179 cp;
- Blunder: 180 cp or more.

These labels are move-quality evidence only. Tactical mechanism, timing cause, session context, and diagnosis remain later deterministic layers.

## Durable run state, coverage, and freshness

`GameAnalysisRun.snapshotId` identifies one game-specific analysis attempt/policy snapshot. A run records engine/settings provenance, retry state, worker claim state, and explicit progress:

- `positionsTotal` / `positionsDone`;
- `pliesTotal` / `pliesDone`;
- `cacheHits` / `cacheMisses`;
- `coverageStatus`.

A run may publish `SUCCEEDED` only when both position and ply progress are complete. Successful runs use `coverageStatus = COMPLETE`. Failed or interrupted work retains explicit partial/unavailable coverage instead of becoming implicit “no problem detected” evidence.

Consumers needing current engine evidence must select the newest compatible **SUCCEEDED + COMPLETE** run for the game and use the per-ply values associated with that run. They must not infer completeness from the mere existence of cached position rows.

## Retry, leases, fencing, and supersession

Claims use an opaque `claimToken`. Every write and completion transition verifies that the run is still `RUNNING`, the token still owns the lease, and cancellation has not been requested.

Workers reconcile stale `RUNNING` rows before claiming new work. A run whose heartbeat exceeds the stale threshold (five minutes by default, configurable with `STOCKFISH_STALE_AFTER_MS`) is returned to retry or terminally failed when attempts are exhausted. A replacement claim receives a new token, so a late write from the expired worker is rejected.

Explicit reanalysis marks active work `SUPERSEDED`, clears its claim, records incomplete coverage, and creates a new run. Position cache evidence with compatible provenance remains reusable.

Stockfish startup/search failures retry on the same run with bounded exponential backoff. The UCI timeout prevents a hung engine command from leaving the worker blocked indefinitely.

## Batch persistence and crash recovery

The service buffers engine results and game-specific ply results and persists them in bounded chunks. Each batch transaction:

1. verifies the current claim token;
2. inserts reusable position cache misses idempotently;
3. persists game-specific ply score loss/classification;
4. advances durable progress and heartbeat.

If execution fails after a completed batch, persisted progress and cache evidence remain available for retry. On retry, previously stored compatible position evidence becomes cache hits, while game-specific ply evidence is recomputed under the current run before it can publish complete coverage.

## Raw evidence versus interpretation

The engine stage establishes deterministic evidence: search output, normalized evaluations, score loss, and baseline move-quality classification. It does **not** infer why the error happened, label tactical motifs, synthesize sessions, or generate coaching.

Keeping reusable engine facts and per-game move quality separate from later interpretation allows detector and diagnosis policies to evolve without unnecessarily re-running Stockfish.

## CRT reference and Why-specific delta

The implementation follows the pinned reference `vokerg/chess_repertoir_trainer@13a7e2791944ebd52113afe9f76413b10634ddff` for:

- cache-first normalized-position analysis;
- isolated worker-owned Stockfish lifecycle;
- White-perspective evaluation normalization;
- mate normalization for score-loss calculation;
- deterministic move classification;
- chunked persistence and observable run progress;
- durable worker recovery/fencing.

Why-specific changes include explicit engine/settings provenance in the cache key, explicit run coverage semantics, and bullet eligibility alongside blitz and rapid.
