# imported-games module

Owns durable game-to-ply reconstruction and the consumer-facing evidence read boundary.

`ply-index.service.ts` adapts the pinned CRT indexing pattern: reconstruct legal plies from PGN, resolve reusable normalized before/after positions, attach user/opponent side semantics, consume the already-durable Lichess clock sequence, and atomically replace the game's ply projection. A failed retry removes the projection and publishes `FAILED`; a consumer never sees a partial projection marked complete.

Eligibility is standard chess at bullet, blitz, or rapid speed. Correspondence and nonstandard variants are explicitly skipped.

## Read model

`imported-games.repository.prisma.ts` keeps the query boundary ownership-scoped and projection-specific:

- `GET /api/imported-games` returns a cursor-paginated list without plies, PGN, or raw clock rows. The query is bounded to `limit + 1` rows so `hasMore` does not require loading the account history.
- `GET /api/imported-games/:gameId` returns the rich detail/replay projection, including PGN for an explicit detail read.
- `GET /api/imported-games/:gameId/replay` returns the same replay evidence without loading raw PGN for the board consumer.

Every detail/replay ply keeps the layers separate:

1. before/after normalized position identity and the move;
2. aligned source-clock state, when alignment is safe;
3. nullable derived timing plus reliability/unavailable reason;
4. optional engine evidence/status;
5. an empty typed annotation list reserved for later deterministic findings.

`ABSENT`, `INVALID`, `UNALIGNED`, partial timing, and missing engine coverage are represented as explicit states. They are never mapped to a good move or fabricated duration. The API maps database/provider values into contracts and does not expose Prisma rows or Lichess DTOs.

Replay provenance distinguishes the provider's last-move/source timestamp (`sourceUpdatedAt`, when available) from the local read-model timestamp (`readModelUpdatedAt`). Per-ply game-specific engine evidence is exposed only when it belongs to the latest complete engine run; reusable position evidence remains a separate optional layer.

The Angular replay store owns only navigation state. `ChessgroundBoardComponent` receives a FEN, last move, and evidence annotations; it does not calculate timing, engine results, or diagnosis policy.
