# Phase 7 security and resilience audit (#127)

**Status: partial, non-exhaustive engineering review.** This matrix tracks concrete regression coverage and outstanding tests; it is not a penetration-test certificate or a finding that all listed boundaries are safe. No production credentials, accounts, or Neon data were used.

| Boundary / threat | Required invariant | Reproduction or existing evidence | State |
| --- | --- | --- | --- |
| Imported-game URL ID aliases and overflow | Only canonical positive decimal IDs within the 32-bit game ID domain reach owned detail/replay services | `apps/api/test/imported-games-read-model.test.mjs`: both HTTP endpoints reject `09`, `9e0`, `0x9`, encoded `+9`, zero, negative and overflow IDs before service invocation | Verified on PR #144 exact-head CI run #314 (both jobs successful); broader ownership matrix pending |
| Imported-game owner isolation | An owned game cannot be read by another application user, including evidence/replay | Prisma `findDetail`/`findReplay` ownership predicates and cross-user service checks in `imported-games-read-model.test.mjs` | Existing scoped tests; broader hostile-ID matrix pending |
| Import run ID and cancellation | Only canonical positive signed-32-bit run IDs reach owner-scoped status/cancel services; unowned IDs are not disclosed | `lichess-onboarding.test.mjs` checks aliases, exact upper bound, overflow, missing runs, owner propagation, and no service invocation for invalid IDs on both routes | Additional regression; verify on exact-head CI |
| Summary and drill-down ownership | Current owned findings only; stale rankings fail closed | `diagnosis-read-model.test.mjs`, `diagnosis-drill-down.test.mjs` | Existing scoped tests; cross-user request matrix pending |
| Lichess OAuth/credential lifecycle | Single-use PKCE state, identity ownership, generation-fenced reconnect/disconnect; no plaintext token persistence | `auth-and-lichess.test.mjs`, `oauth-token-crypto.test.mjs` | Existing unit/route checks; broader OAuth/production logging review pending |
| Authentication configuration | Dev-single-user mode explicitly gated outside production; Clerk requests authenticated | `auth-config.test.mjs`, `auth-and-lichess.test.mjs` | Existing checks; deployed configuration review pending |
| Import errors, retries and cancellation | Recover safely from malformed source, provider errors, cancellation and stale work | `lichess-import.test.mjs`, `diagnosis-worker-acceptance.test.mjs` | Partial; transient-provider failure matrix pending |
| Lichess provider 429 rate-limit retry | A provider-supplied `Retry-After` cannot defer a run indefinitely or cause an immediate retry loop; numeric and HTTP-date values have the same 60-second to one-hour bounds | `lichess-import.test.mjs`: controlled 429 responses, numeric/date/invalid/past/missing headers, lease-scoped `deferRun` and durable retry timestamp | Scoped regression in PR; exact-head CI and independent review pending |
| Oversized Lichess NDJSON records | Streaming reader rejects one provider record above 2 MiB of UTF-8 bytes before string concatenation or JSON parsing; no silent dropping or checkpoint advancement | `lichess-import.test.mjs`: exact boundary, fragmented multi-byte overrun, split UTF-8 and worker failure/status regression | PR #150 squash-merged after exact-head CI #38515695916 passed both jobs; chunk allocation and whole-window workloads not benchmarked |
| Oversized Lichess history requests | User-selected valid ISO date spans must not allocate or persist unbounded 30-day provider windows | `lichess-import.test.mjs`: 256-window edge and pathological date range; `lichess-onboarding.test.mjs`: API 400 with no `createRun` invocation | Scoped proposed 256-window cap; latest-head CI and independent review pending; not a per-window throughput or storage budget |
| Stalled Lichess export response | Provider header and NDJSON body read must terminate within one bounded window; preserve lease-fenced failure and safe status text | `lichess-import.test.mjs`: controlled never-resolving headers and body stream, real abort signal and `PROVIDER_TIMEOUT` status, plus direct pending-read abort | Scoped timeout regression; exact-head CI/review pending; broader outage/retry matrix pending |
| Native Stockfish process failure | No stale evidence survives native process kill or worker recovery | `docs/phase-7-real-stockfish-acceptance.md`; opt-in native CI | Separate #123 gate, not re-executed here |
| Import failure persistence into browser-visible run status | Unexpected credential-adapter and provider exception text must never be serialized as import status; preserve stable failure codes | `apps/api/test/lichess-import.test.mjs`: injected token-bearing credential and fetch exceptions, asserted `AUTH_REQUIRED`/`IMPORT_FAILED` and no token in `toImportRunResponse` | PR #146 merged after both exact-head CI jobs passed; historical errors remain unmodified |
| OAuth callback request-target disclosure | No code/state/query descriptions or request credential headers in automatic API request logs; callback redirect responses must not leak via cache or referrer | `apps/api/test/request-logging.test.mjs`: real Fastify info logs, both redirect outcomes, unmatched path, explicit serializer assertion | Scoped regression added; exact-head CI and review pending; infrastructure/access logs not examined |
| End-to-end secret/log disclosure and adversarial request sizes | Never expose tokens, verifiers or another owner's data; bounded reads/writes | Full log/output review, oversized payload fuzzing and multi-user Clerk integration not performed by this PR | **Outstanding #127** |

## Scoped finding: alternative numeric game IDs

Before this PR, `parseGameId` used `Number(value)` with an integer/range check. This parsed alternative representations of the same URL identifier (including scientific and hexadecimal notation, zero padding and a leading plus). It did **not** by itself demonstrate an authorization bypass because subsequent service and Prisma queries are owner-scoped. However, it violated strict path identifier validation and allowed multiple spellings to reach downstream services. The amended parser requires `^[1-9]\d*$` first, followed by safe-integer and maximum database ID bounds. Invalid IDs return 400; syntactically valid but unowned IDs continue to produce 404.

PR #144 does not change query responses for canonical IDs, authentication modes, provider authorization, import state or stored evidence. The API route test verifies both imported-game detail and replay, and asserts that invalid requests never reach the service.

## Next #127 gates

Exercise simultaneous cross-user application sessions and real auth, missing/oversized payloads, stale resource IDs after reimport, failure/retry logging with representative secrets, provider rate limiting and request timeouts, and worker/job source races. Record setup, observed responses and exact CI/head before claiming acceptance. Track any concrete high-severity failure as a dedicated, reviewable fix.

**CRT comparison:** preserve fail-closed ID/ownership and bounded worker/provider contracts; Why additionally fences immutable imported-game engine/evidence provenance. No auth or crypto redesign is proposed.

## Follow-up: import run numeric overflow

The run-status and cancellation paths previously rejected noncanonical decimal IDs and values outside JavaScript's safe-integer range, but still accepted positive values above the Prisma `ImportRun.id Int` domain. Such an ID could reach Prisma and fail as a server error rather than a bounded invalid-request response. Both routes now reject values above 2,147,483,647 before invoking their services; canonical but unowned IDs still return 404. The API regression matrix exercises both methods and asserts that invalid IDs never reach services. This is input hardening, **not** evidence of an owner-isolation bypass or full #127 acceptance.

## Follow-up: sanitize import failure status

The import worker previously persisted arbitrary `Error.message` text from credential adapter failures and provider/stream/normalization errors into `ImportRun.error`, which is returned to the authenticated browser through both owned run-status endpoints. Exception messages may include provider request details, authorization headers or other sensitive implementation data; no real production leak has been demonstrated. `AUTH_REQUIRED` and `IMPORT_FAILED` now persist stable, user-actionable messages rather than raw exception text, without altering lease fencing, the error codes, the existing safe NDJSON line-number classification, or the rate-limit retry path. The regression injects token-bearing errors from both failure paths and checks the browser-visible serialization. This is a scoped status-output fix, not an audit of worker crash logs, historical persisted errors, OAuth callback logs, or actual multi-user security.

## Follow-up: OAuth callback query strings in API logs and redirects

Production `main.ts` previously passed `logger: true` to Fastify. Its automatic incoming-request/completed-request log records include the request target, and the public OAuth callback receives the one-use authorization `code` and PKCE `state` as query parameters. Such raw URL data must not enter application logs. The API's production logger now serializes the HTTP method, **pathname only** and remote socket metadata, intentionally omitting **all** query strings and request headers for every route (including unrecognized paths). Fastify's built-in 404 handler also emitted the raw request URL as a separate free-form info message, which bypassed that serializer; the API now installs a safe not-found handler preserving the 404 response shape without query strings in either logs or responses. The existing structured request log lifecycle remains enabled. Both OAuth callback success and controlled-error redirects carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

The bounded regression instantiates Fastify with the actual production logger options and exercises sensitive OAuth query values, callback error descriptions, unmatched routes and both response paths. It asserts the log output is free of the injected strings and redirects carry the defensive headers. CI initially caught the default 404 free-form log leak; the regression now asserts that both logs and 404 response bodies omit injected query values. This identifies a log disclosure **risk**, not proof that a production authorization code was exposed.

Remaining #127: any historical reverse-proxy/CDN/load-balancer access logs, provider-side logging, arbitrary exception messages/worker crash stack traces, real Clerk multi-user behavior, OAuth error matrices, oversized inputs and operational failure races remain unaudited. Production log retention/redaction/deletion is an operational action, not performed here. No production secrets or user data were inspected.


## Follow-up: bounded Lichess provider export deadline

An import previously awaited provider response headers and each NDJSON `reader.read()` without a deadline. A stalled upstream socket or stream could leave a worker occupied until an external termination, while stale-run recovery did not itself stop the live blocked await. Each 30-day Lichess export window now has a fixed **10-minute** provider deadline (below the existing 15-minute stale-lease threshold). The abort signal is passed into Fetch and the streamed NDJSON reader, which also interrupts a pending read for injected streams. Deadline failures persist `PROVIDER_TIMEOUT` and a stable no-secret status message through existing run/lease fencing. Already-committed batches remain durable; checkpointing still advances only after a complete window. No production engine data, user accounts, migrations, environment files, or credentials are touched.

The focused tests simulate indefinitely stalled headers and bodies; they do **not** establish real provider outage behavior, byte/record-size limits, complete worker CPU/RSS budgets, immediately propagated user cancellation, or measured large-account throughput. These remain in #127 / #126. The deadline is a conservative operational bound, not an observed Lichess service-level guarantee. GitHub-only code changes require exact-head CI and independent review before merge.

## Follow-up: bound HTTP-date Retry-After deferrals

The import worker previously capped a numeric 429 `Retry-After` (seconds) at one hour, but returned an HTTP-date value without that cap. A provider-supplied far-future date could leave an otherwise recoverable `QUEUED` import deferred for days or longer; a past date or zero seconds could schedule immediate reattempts. Both header forms now produce a bounded **60-second to one-hour** backoff, and missing/invalid headers retain the 60-second fallback. The change uses the existing durable, lease-fenced `deferRun` path; it does not introduce a new retry mechanism or affect completed-window checkpoints.

The focused unit test injects 429 responses with near/far/past HTTP dates and numeric, missing or invalid headers, and asserts the exact persisted requeue deadline. It does not establish actual Lichess rate-limit semantics under a live account, distributed-worker contention, or workload throughput. This is a scoped #127 mitigation; keep the parent issue open until the remaining gates are independently reviewed.


## Follow-up: cap Lichess NDJSON record bytes

A single provider NDJSON line previously accumulated without limit in the import reader. A malformed or adversarial game/PGN field could force unbounded application-side line buffering before JSON parsing, independently of the ten-minute export deadline. The streaming reader now enforces a conservative **2 MiB UTF-8 byte cap per record**, checking each segment before buffering or parsing; newline-delimited *collections* of legitimate smaller records may exceed this total. A split UTF-8 character is decoded only after a complete line is assembled. Any oversized record stops the window with stable `PROVIDER_RECORD_TOO_LARGE` status and a line number, rather than silently dropping a source game. The upstream reader is cancelled on error/early exit.

Committed batches from earlier in the window remain idempotent through the existing repository path; the window checkpoint does not advance on oversize. The cap is an engineering safety policy, **not a measured Lichess payload limit**, and unusually large legitimate provider records require explicit follow-up rather than truncation. This scope does not bound one upstream network chunk already allocated by Fetch, per-window game count/CPU, all normalization costs, or concurrent-worker memory. Controlled fixture and CI evidence are not real-provider or operational throughput measurements. #127 remains open.

## Follow-up: bound oversized import history ranges

The authenticated import endpoint accepts explicit ISO timestamp bounds and previously
planned the entire range into 30-day windows without a count limit. Even a syntactically
valid start in year 2000 and an end in year 9999 could allocate excessive in-memory work
and persist a long-lived job, despite the per-provider-window deadline and per-record
NDJSON cap. This is an adversarial input risk, not an observed workload incident.

The planner now rejects requests that would exceed **256 windows** (approximately 21
years at 30 days each) before creating a run. The API returns stable HTTP 400
`IMPORT_RANGE_TOO_LARGE` without echoing input or exposing another user's state.
Defaults remain 30 days, and valid wider backfills are supported within the cap.
The planner also rejects invalid dates and nonpositive window sizes. Previously
persisted malformed/oversized ranges enter the worker's lease-fenced failure handling
instead of crashing before it can record a safe failure.

The engineering cap is not evidence of provider-side maximum history or acceptable
total import cost. Large but permitted accounts, pending queue backlog, concurrent
workers, real Clerk ownership, and provider outages still require the Phase 7 #127/#126
resilience and economics gates. Tests are synthetic; no live Lichess or Neon data is used.
