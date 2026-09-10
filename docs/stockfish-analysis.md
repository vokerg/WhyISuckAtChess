# Stockfish analysis snapshots

Issue #13 introduces worker-owned Stockfish analysis as the raw engine stage between deterministic ply indexing and later mistake interpretation.

## Invocation and engine settings

Stockfish runs only in the persistent worker (`npm run dev:worker` in `apps/api`, or the root worker script). HTTP handlers do not spawn or wait for the engine. The worker automatically discovers indexed games that have no run for the current analysis version/settings and creates durable work before claiming it.

The default analysis profile is intentionally explicit and deterministic:

- depth: 16
- MultiPV: 3
- threads: 1
- hash: 64 MB
- analysis version: `stockfish-depth16-multipv3-v1`

`STOCKFISH_PATH` may point at the Stockfish executable; otherwise the worker invokes `stockfish` from `PATH`. Changing any search setting requires an analysis-version change when the semantic contract changes. The settings JSON and its SHA-256 hash are persisted on every run.

## Snapshot provenance and freshness

`GameAnalysisRun.snapshotId` is the stable freshness identifier. A run records the imported game, analysis version, complete settings JSON/hash, discovered engine name/version, lifecycle state, retry attempts, and timestamps.

Raw engine output is stored in `StockfishPositionAnalysis`, keyed uniquely by `(analysisRunId, positionId)`. Each row contains depth, centipawn or mate score, best move/PV, structured MultiPV lines, the raw UCI `info` lines, engine identity, and settings hash. Indexed plies already reference canonical before/after `Position` rows, so one result per position supplies both sides of every move while avoiding duplicate analysis for transpositions. The final after-position is included because the worker collects both before and after positions from the indexed main line.

Consumers must select the newest **SUCCEEDED** `GameAnalysisRun` for a game and use only rows belonging to that snapshot. They must never construct freshness by mixing the newest individual position rows across runs.

## Retry, idempotency, and supersession

Claiming a run moves `QUEUED` or due `RETRY_WAIT` work to `RUNNING` and increments its attempt count. Failures retry on the same snapshot with bounded exponential backoff; the default maximum is three attempts. Position results use an upsert on `(analysisRunId, positionId)`, so a retry is idempotent and can safely recompute already-written positions.

The default workflow permits one active (`QUEUED`, `RUNNING`, or `RETRY_WAIT`) run per game. A partial unique PostgreSQL index enforces that rule. Explicit reanalysis first marks any active run `SUPERSEDED` with `cancelRequestedAt`, then creates a new snapshot. Workers cooperate at persistence boundaries: a stale run may finish the current Stockfish search, but its next write is rejected and it cannot publish success after supersession.

Terminal `FAILED` and historical `SUPERSEDED` runs are retained as provenance and are never current.

## Raw analysis versus interpretation

This stage persists engine facts only. It does **not** label mistakes, classify causes, generate coaching, or apply timing heuristics. Those downstream stages must treat the completed engine snapshot as immutable input. Keeping raw search evidence separate from interpretation allows thresholds and classifiers to evolve without re-running Stockfish when engine provenance is still current.

## Reference reuse review

The Stockfish boundary was reviewed against the sibling reference repository pinned by this project (`vokerg/chess_repertoir_trainer@13a7e2791944ebd52113afe9f76413b10634ddff`). The reusable idea is the worker-owned position-analysis boundary; this implementation deliberately adapts it to WhyISuckAtChess's canonical `Position` identity, durable run lifecycle, snapshot freshness, and retry/supersession requirements rather than copying a request-time analysis path.
