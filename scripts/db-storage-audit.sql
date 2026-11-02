-- Read-only WhyISuckAtChess PostgreSQL storage audit.
-- Run on the intended database: psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/db-storage-audit.sql
-- No rows, PGNs, game identities or tokens are returned; only aggregate sizes and counts.
-- pg_database_size is PostgreSQL live storage, not Neon project history/retention usage.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

SELECT current_database() AS database_name,
       pg_database_size(current_database()) AS live_db_bytes,
       pg_size_pretty(pg_database_size(current_database())) AS live_db_size;

-- Heap, TOAST/visibility/free-space and indexes. Both bytes and readable sizes
-- are included for machine-comparable before/after reports.
SELECT c.relname AS relation_name,
       c.reltuples::bigint AS estimated_rows,
       pg_relation_size(c.oid) AS heap_bytes,
       pg_table_size(c.oid) - pg_relation_size(c.oid) AS toast_and_aux_bytes,
       pg_indexes_size(c.oid) AS index_bytes,
       pg_total_relation_size(c.oid) AS total_bytes,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC, c.relname;

SELECT relname AS relation_name, n_live_tup AS estimated_live_rows,
       n_dead_tup AS estimated_dead_rows, last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_dead_tup DESC, relname;

SELECT relname AS relation_name, indexrelname AS index_name,
       pg_relation_size(indexrelid) AS index_bytes,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC, relname, indexrelname;

-- Actual counts on the principal storage layers. Large installations may prefer
-- to rely on the estimated relation rows above if the scan budget is tight.
SELECT (SELECT count(*) FROM "ImportedGame") AS games,
       (SELECT count(*) FROM "ImportedGamePly") AS plies,
       (SELECT count(*) FROM "Position") AS positions,
       (SELECT count(*) FROM "StockfishPositionAnalysis") AS engine_cache_rows,
       (SELECT count(*) FROM "GameAnalysisRun") AS engine_runs,
       (SELECT count(*) FROM "LichessClockState") AS source_clock_states,
       (SELECT count(*) FROM "EvidenceRun") AS evidence_runs,
       (SELECT count(*) FROM "EvidenceEvent") AS evidence_events;

-- Sample only ~2% of heap pages. Values report physical column sizes, not
-- total relation footprint; use the relation report above for real disk usage.
SELECT count(*) AS sampled_analysis_rows,
       round(avg(pg_column_size("rawInfoJson"))) AS avg_raw_uci_bytes,
       max(pg_column_size("rawInfoJson")) AS max_raw_uci_bytes,
       round(avg(pg_column_size("multiPvJson"))) AS avg_multipv_bytes,
       round(avg(pg_column_size("bestPv"))) AS avg_bestpv_bytes
FROM "StockfishPositionAnalysis" TABLESAMPLE SYSTEM (2);

SELECT count(*) AS sampled_position_rows,
       round(avg(pg_column_size("normalizedFen"))) AS avg_fen_bytes,
       round(avg(pg_column_size("positionKey"))) AS avg_hash_bytes
FROM "Position" TABLESAMPLE SYSTEM (2);

SELECT count(*) AS sampled_ply_rows,
       round(avg(pg_column_size(ply))) AS avg_ply_tuple_bytes
FROM "ImportedGamePly" AS ply TABLESAMPLE SYSTEM (2);

SELECT count(*) AS sampled_event_rows,
       round(avg(pg_column_size("measurementsJson"))) AS avg_measurements_bytes,
       round(avg(pg_column_size("detailsJson"))) AS avg_details_bytes
FROM "EvidenceEvent" TABLESAMPLE SYSTEM (2);

-- Spot multiplicative cache identities without exposing FEN or move data.
SELECT "analysisVersion", "engineName", "engineVersion",
       left("settingsHash", 12) AS settings_hash_prefix, count(*) AS analysis_rows
FROM "StockfishPositionAnalysis"
GROUP BY "analysisVersion", "engineName", "engineVersion", "settingsHash"
ORDER BY count(*) DESC;

COMMIT;
