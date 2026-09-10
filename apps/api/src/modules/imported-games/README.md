# imported-games module

Owns durable game-to-ply reconstruction and publication of complete per-ply projections.

`ply-index.service.ts` adapts the pinned CRT indexing pattern: reconstruct legal plies from PGN, resolve reusable normalized before/after positions, attach user/opponent side semantics, consume the already-durable Lichess clock sequence, and atomically replace the game's ply projection. A failed retry removes the projection and publishes `FAILED`; a consumer never sees a partial projection marked complete.

Eligibility is standard chess at bullet, blitz, or rapid speed. Correspondence and nonstandard variants are explicitly skipped. Engine analysis remains a separate follow-up concern.
