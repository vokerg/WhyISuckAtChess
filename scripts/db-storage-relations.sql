-- Read-only, schema-agnostic PostgreSQL storage inventory.
-- Run this same SQL against both the Why and CRT DATABASE_URLs to compare live
-- relation bytes on the same basis (not Neon project history/retention usage).
-- psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/db-storage-relations.sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

SELECT current_database() AS database_name,
       pg_database_size(current_database()) AS live_db_bytes,
       pg_size_pretty(pg_database_size(current_database())) AS live_db_size;

SELECT c.relname AS relation_name,
       c.reltuples::bigint AS estimated_rows,
       pg_relation_size(c.oid) AS heap_bytes,
       pg_table_size(c.oid) - pg_relation_size(c.oid) AS toast_and_aux_bytes,
       pg_indexes_size(c.oid) AS index_bytes,
       pg_total_relation_size(c.oid) AS total_bytes
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC, c.relname;

SELECT relname AS relation_name, n_live_tup AS estimated_live_rows,
       n_dead_tup AS estimated_dead_rows
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_dead_tup DESC, relname;

COMMIT;
