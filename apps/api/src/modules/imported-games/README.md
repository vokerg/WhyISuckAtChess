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
5. deterministic evidence references through `evidenceEventKeys`; and
6. the legacy annotation list, which remains presentation-only and does not own detector policy.

Replay/detail responses also expose a top-level `evidence` projection. The query service first resolves the ownership-scoped imported-game row, then asks the evidence repository for current evidence for that game. That repository revalidates `plyIndexedAt`, source analysis identity/status/coverage, and per-ply analysis-run provenance before returning a run, so `EvidenceRun.isCurrent` alone is never enough to publish evidence.

Only successful current runs and their bounded events are projected. Historical/superseded runs are not attached to normal replay/detail responses. Detector execution already caps one run at 256 findings, and successful publication keeps only one current run per detector key, so the read model does not load an unbounded detector history.

Each projected run carries detector key/version, explicit coverage status/reason/details, and source index/analysis provenance. Each event carries its stable evidence/finding keys, source ply range/position, availability, a contract-owned presentation family/kind/label, and detector measurements/details for known evidence types. Per-ply `evidenceEventKeys` are derived only from the persisted source range; the UI does not need to reconstruct detector ownership or range semantics.

The compatibility policy is `KNOWN_TYPES_WITH_OPAQUE_FALLBACK`: evidence types known to the current contract retain their structured measurements/details, while a future unknown type is represented only as `UNKNOWN` plus its original type name. Unknown detector payloads are deliberately not passed through. This keeps replay parseable across staggered deploys without inviting clients to infer semantics from an unversioned payload.

`ABSENT`, `INVALID`, `UNALIGNED`, partial timing, and missing engine coverage are represented as explicit states. They are never mapped to a good move or fabricated duration. The API maps database/provider values into contracts and does not expose Prisma rows or Lichess DTOs.

Replay provenance distinguishes the provider's last-move/source timestamp (`sourceUpdatedAt`, when available) from the local read-model timestamp (`readModelUpdatedAt`). Per-ply game-specific engine evidence is exposed only when it belongs to the latest complete engine run; reusable position evidence remains a separate optional layer.

The Angular replay store owns only navigation state. `ChessgroundBoardComponent` receives a FEN, last move, and evidence annotations; it does not calculate timing, engine results, or diagnosis policy.
