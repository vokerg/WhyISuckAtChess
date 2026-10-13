# Phase 7 security and resilience audit (#127)

**Status: partial, non-exhaustive engineering review.** This matrix tracks concrete regression coverage and outstanding tests; it is not a penetration-test certificate or a finding that all listed boundaries are safe. No production credentials, accounts, or Neon data were used.

| Boundary / threat | Required invariant | Reproduction or existing evidence | State |
| --- | --- | --- | --- |
| Imported-game URL ID aliases and overflow | Only canonical positive decimal IDs within the 32-bit game ID domain reach owned detail/replay services | `apps/api/test/imported-games-read-model.test.mjs`: both HTTP endpoints reject `09`, `9e0`, `0x9`, encoded `+9`, zero, negative and overflow IDs before service invocation | **New regression in this PR; verify on CI** |
| Imported-game owner isolation | An owned game cannot be read by another application user, including evidence/replay | Prisma `findDetail`/`findReplay` ownership predicates and cross-user service checks in `imported-games-read-model.test.mjs` | Existing scoped tests; broader hostile-ID matrix pending |
| Import run ID and cancellation | Only canonical positive signed-32-bit run IDs reach owner-scoped status/cancel services; unowned IDs are not disclosed | `lichess-onboarding.test.mjs` checks aliases, exact upper bound, overflow, missing runs, owner propagation, and no service invocation for invalid IDs on both routes | Additional regression; verify on exact-head CI |
| Summary and drill-down ownership | Current owned findings only; stale rankings fail closed | `diagnosis-read-model.test.mjs`, `diagnosis-drill-down.test.mjs` | Existing scoped tests; cross-user request matrix pending |
| Lichess OAuth/credential lifecycle | Single-use PKCE state, identity ownership, generation-fenced reconnect/disconnect; no plaintext token persistence | `auth-and-lichess.test.mjs`, `oauth-token-crypto.test.mjs` | Existing unit/route checks; production log leak review pending |
| Authentication configuration | Dev-single-user mode explicitly gated outside production; Clerk requests authenticated | `auth-config.test.mjs`, `auth-and-lichess.test.mjs` | Existing checks; deployed configuration review pending |
| Import errors, retries and cancellation | Recover safely from malformed source, provider errors, cancellation and stale work | `lichess-import.test.mjs`, `diagnosis-worker-acceptance.test.mjs` | Partial; transient-provider failure matrix pending |
| Native Stockfish process failure | No stale evidence survives native process kill or worker recovery | `docs/phase-7-real-stockfish-acceptance.md`; opt-in native CI | Separate #123 gate, not re-executed here |
| End-to-end secret/log disclosure and adversarial request sizes | Never expose tokens, verifiers or another owner's data; bounded reads/writes | Full log/output review, oversized payload fuzzing and multi-user Clerk integration not performed by this PR | **Outstanding #127** |

## Scoped finding: alternative numeric game IDs

Before this PR, `parseGameId` used `Number(value)` with an integer/range check. This parsed alternative representations of the same URL identifier (including scientific and hexadecimal notation, zero padding and a leading plus). It did **not** by itself demonstrate an authorization bypass because subsequent service and Prisma queries are owner-scoped. However, it violated strict path identifier validation and allowed multiple spellings to reach downstream services. The amended parser requires `^[1-9]\d*$` first, followed by safe-integer and maximum database ID bounds. Invalid IDs return 400; syntactically valid but unowned IDs continue to produce 404.

This patch does not change query responses for canonical IDs, authentication modes, provider authorization, import state or stored evidence. The API route test verifies both imported-game detail and replay, and asserts that invalid requests never reach the service.

## Next #127 gates

Exercise simultaneous cross-user application sessions and real auth, missing/oversized payloads, stale resource IDs after reimport, failure/retry logging with representative secrets, provider rate limiting and request timeouts, and worker/job source races. Record setup, observed responses and exact CI/head before claiming acceptance. Track any concrete high-severity failure as a dedicated, reviewable fix.

**CRT comparison:** preserve fail-closed ID/ownership and bounded worker/provider contracts; Why additionally fences immutable imported-game engine/evidence provenance. No auth or crypto redesign is proposed.

## Follow-up: import run numeric overflow

The run-status and cancellation paths previously rejected noncanonical decimal IDs and values outside JavaScript's safe-integer range, but still accepted positive values above the Prisma `ImportRun.id Int` domain. Such an ID could reach Prisma and fail as a server error rather than a bounded invalid-request response. Both routes now reject values above 2,147,483,647 before invoking their services; canonical but unowned IDs still return 404. The API regression matrix exercises both methods and asserts that invalid IDs never reach services. This is input hardening, **not** evidence of an owner-isolation bypass or full #127 acceptance.
