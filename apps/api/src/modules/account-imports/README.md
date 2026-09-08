# account-imports module

Issue #11 implements the first durable provider importer for the authenticated Lichess connection.

- `account-import.service.ts` creates immutable scoped runs, plans contiguous half-open windows, and executes queued work.
- `account-import.repository.prisma.ts` owns claim/heartbeat/checkpoint/cancellation state and commits each game with its raw ordered clock values in one transaction.
- `providers/lichess/lichess-account-import.ts` owns authenticated NDJSON request construction, defensive normalization, exact time-control provenance, and clock presence/invalidity semantics.
- `account-import.routes.ts` exposes queue/status/cancel endpoints; `worker.ts` claims and executes runs.

Raw clock values are stored in centiseconds and are intentionally not aligned to plies or converted into timing features here. Those are follow-up concerns for issues #12 and #13.
