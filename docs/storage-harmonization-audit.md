# CRT / Why database storage harmonization audit (#175)

## Verified source differences (2026-11-02)

Current CRT reference: `vokerg/chess_repertoir_trainer` `main`, `apps/api/prisma/schema.prisma`, `packages/chess-domain/src/position-binary-compact.ts`, `packages/chess-domain/src/uci-move-code.ts`, `docs/position-analysis-cache.md`, and `docs/operations/compact-position-storage-cleanup.md`.

| Layer | CRT | Why |
| --- | --- | --- |
| Position identity | Single reversible `positionDataCompact BYTEA` UNIQUE (10–26 bytes) | 16-byte SHA-256 prefix `positionKey` plus stored `normalizedFen`, each UNIQUE |
| Game moves | `moveCode SMALLINT`, `plyNumber SMALLINT`, `positionId` | `moveUci VARCHAR(16)`, `plyNumber INT`, `beforePositionId` and `afterPositionId` |
| Per-game ply facts | Minimal per-game engine class/loss | Many necessary raw-clock/timing/provenance columns, plus classification |
| Position analysis | Unique `positionId`, imported-game compact best-eval rows, `lines=NULL`, depth 12 / MultiPV 1 | Provenance-keyed multiple rows per position, full `bestPv`, `multiPvJson`, `rawInfoJson`, depth 16 / MultiPV 3 |
| Diagnosis | Different product model | Versioned evidence runs/events and finding materializations |

The Why delta map pinned CRT at `13a7e279...` on 2026-09-03. CRT later executed an October 2026 compact-position read/write cutover and storage cleanup. The implementations were **never one-to-one** in schema, but their shared move/position layer should be brought back into parity without dropping Why's required clock and diagnostic evidence.

A known avoidable amplification is at `apps/api/src/modules/engine-analysis/stockfish.adapter.ts`: `summarizeStockfishSearch` collects every intermediate UCI search `info` line in `rawInfo`. Before #175, the analysis repository persisted all intermediate lines in `rawInfoJson` while independently storing the final MultiPV rows (including their final raw lines). New writes now retain only one terminal raw UCI line per MultiPV result in `rawInfoJson`. This reduces duplicate intermediate-depth history while preserving scored final PVs, best move, evaluation and full provenance, and does not change depth or MultiPV settings, cache identity, or existing data. Historic raw UCI history remains untouched. The raw data retained is the *terminal PV evidence*, not a replayable full-depth search log.

## Measure first; do not infer why the reported project size exceeds 500 MB

Run `psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/db-storage-audit.sql` against Why using a **read-only** account/transaction where possible. Compare `pg_database_size` with the reported Neon project usage using the provider's appropriate metric; they include different storage categories/history. The script reports per-table heap, auxiliary/TOAST, indexes, approximate live/dead rows, actual entity counts, a 2%-page sample of large values, and cache provenance counts without exposing private account/game content. If the scan hits its 60-second timeout, collect the relation-size sections first or run off-peak. Run the same schema-agnostic `scripts/db-storage-relations.sql` against **both** Why and CRT (`psql "$WHY_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/db-storage-relations.sql` and `psql "$CRT_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/db-storage-relations.sql`) for apples-to-apples live relation bytes; do not mix up the two database URLs. The Why-specific detailed script cannot be run unmodified on CRT because its table names differ.

Only live measurements can establish whether the main bytes are raw engine histories, MultiPV, FEN/index duplication, ply timing arrays, evidence JSON, historical superseded runs, table bloat, or Neon history. A single account is not a meaningful normalization unit; compare game, ply, distinct-position and cached-analysis counts.

## Staged harmonization plan

1. **Growth prevention + telemetry (this change).** Bound raw UCI history on new cache entries. Regression-test that persisted score/PV evidence survives; inspect the live size distribution. Do not drop existing evidence or schedule an automatic rewrite.
2. **Compact position identity (separate PR).** Port and test CRT's reversible position bytes in `packages/chess-domain`, add a shadow nullable column and backfill in bounded batches with round-trip verification. Keep ID/FK identity, use concurrent safe indexes, cut over consumers, and drop old FEN/hash/index only after the read/write audit and verified backup. CRT's October 2026 rollout provides a validated sequencing pattern.
3. **Compact move encoding (separate PR).** Port CRT's UCI bit encoding, introduce a temporary `moveCode SMALLINT`, write both during transition, validate one-to-one mappings and promotions, migrate all read models through a single decode seam, and later remove `moveUci`. Do not change per-ply clocks, timing semantics or evidence IDs.
4. **Evidence retention and cache multiplicity (measured policy).** Inspect superseded evidence/finding/run rows and per-position provenance variants before considering retention. Do not merge or delete distinct engine provenance until recalculation/reproducibility guarantees are proven.
5. **Physical reclaim only with explicit authorization.** A SQL update or `DROP COLUMN` does not imply immediate disk release. Assess scoped maintenance, indexes, backups, availability windows, WAL/Neon retention and blocking locks before any `VACUUM FULL` or cleanup. Verify same game/ply/position identity, timing facts, findings, classification, and cache hit behavior before/after.

**Limitations of this PR:** No production DB access or measured Why relation sizes in this review. SQL is read-only and has not been executed against your live database. No disk bytes have been reclaimed. Issue #175 tracks the remaining harmonization work.
