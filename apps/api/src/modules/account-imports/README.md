# account-imports module

Issue #11 implements the first durable provider importer for the authenticated Lichess connection.

- `account-import.service.ts` creates immutable scoped runs, plans contiguous half-open windows, and executes queued work.
- `account-import.repository.prisma.ts` owns claim/heartbeat/checkpoint/cancellation state and commits each game with its raw ordered clock values in one transaction.
- `providers/lichess/lichess-account-import.ts` owns authenticated NDJSON request construction, defensive normalization, exact time-control provenance, and clock presence/invalidity semantics.
- `account-import.routes.ts` exposes queue/status/cancel endpoints; `worker.ts` claims and executes runs.

Raw clock values are stored in centiseconds and are intentionally not aligned to plies or converted into timing features here. Those are follow-up concerns for issues #12 and #13.


## Phase 6 browser progress recovery (#112)

`GET /api/me/imports/lichess/latest` returns `{ "importRun": null }` or one owned Lichess run. The repository first chooses an active `QUEUED`, `RUNNING`, or `CANCEL_REQUESTED` run, otherwise the latest terminal run, always filtered by authenticated `appUserId` and `LICHESS` and ordered by `createdAt DESC, id DESC`. No browser-selected user or account identifier is accepted; the read is bounded to one run and never starts work. Run/recovery responses use strict shared contracts and no-store caching.

`POST /api/me/imports/lichess` remains the only import admission action. It requires a usable owned Lichess connection and optional validated UTC `from`/`to` and `rated` scope. When `from` is omitted, the API defaults to the preceding **30 days** relative to the supplied `to`, or to the server's current time when `to` is also omitted; a no-date request therefore plans exactly one contiguous 30-day window. Explicit `from`/`to` ranges may span more than 30 days and continue to use the existing half-open window planner. A second active request returns HTTP 409 with code `ACTIVE_IMPORT`; callers should recover `latest` rather than starting another run. Missing/expired/revoked/undecryptable OAuth credentials return HTTP 409 `LICHESS_RECONNECT_REQUIRED`, never an anonymous import. Bad date order returns HTTP 400 `INVALID_RANGE`.

Existing `GET /api/me/imports/:runId` and `POST /api/me/imports/:runId/cancel` remain ownership-scoped; the browser polls the selected run while it is active and requests cancellation through the existing worker lifecycle. Persisted counters, identity snapshot, error codes and rate-limit retry timing remain backend-owned. Completion of import is not proof that engine analysis/evidence/diagnosis is complete.
