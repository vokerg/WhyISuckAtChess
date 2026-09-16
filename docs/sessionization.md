# Versioned sessionization and cross-game context

**Status:** initial Phase 4 implementation contract  
**Scope:** issue #50  
**References:** `PLAN.md` Phase 4, `docs/diagnostic-taxonomy.md`, and `docs/implementation-architecture-and-dependency-graph.md`

## Purpose

Phase 4 needs a shared chronological context before individual diagnosis families can compare early-session versus late-session play, loss-streak state, or stopping points. Session membership is therefore a deterministic derived fact, not something each diagnosis query may infer independently.

The `sessions` module owns this boundary. It consumes only owned imported-game chronology and result source facts. It does not run engine analysis, derive per-ply timing, create diagnosis findings, infer psychology, or render UI.

## Policy identity

The initial policy is `session-v1`.

Two consecutive games remain in the same session when the next game's `startedAt` is no more than **30 minutes** after the previous game's `endedAt`. A gap greater than 30 minutes starts a new session. Overlapping timestamps are treated as a zero gap.

The 30-minute threshold is calibration-sensitive. Changing it changes session semantics and therefore requires a new policy version.

## Deterministic context

For each covered game, the sessionization service exposes:

- deterministic session key based on policy version and the first game in the session;
- 1-based game ordinal;
- elapsed milliseconds from the session start;
- inter-game gap in milliseconds, null for the first game;
- prior consecutive user losses within the current session.

The prior-loss counter is contextual evidence only. It increments after a `LOSS`, resets after any other result, and resets at a new session. It is not itself a tilt diagnosis.

Games are ordered by `startedAt`, then imported-game id as a stable tie breaker.

## Coverage and boundedness

Sessionization is bounded to at most 5,000 candidate games per query. The service counts before loading. An over-broad scope returns unavailable coverage rather than silently truncating history.

A game requires both `startedAt` and `endedAt`, with `endedAt >= startedAt`, to receive session membership. Missing or invalid chronology is reported as uncovered. Covered games may still be returned with `PARTIAL` coverage; later diagnosis work must preserve that coverage instead of treating omitted games as evidence of normal behavior.

Ranged repository queries are anchored on source `startedAt` and use an exclusive upper bound.

The count/load boundary also rejects a changed candidate set instead of combining two different source snapshots.

## Ownership and future seam

The Prisma repository selects only `id`, `startedAt`, `endedAt`, and `resultForUser` for one `appUserId`. Provider DTOs and evidence tables do not cross this boundary.

Later Phase 4 aggregators should consume the typed session context rather than reimplementing partition rules. If persistent `SessionizationRun` / session-membership storage becomes useful for scale or reproducibility, it should preserve this policy/version contract instead of changing diagnosis consumers.

## Non-goals

This slice does not implement:

- late-session deterioration statistics;
- loss-streak-associated error comparisons;
- stopping-point recommendations;
- time-of-day localization;
- diagnosis persistence/ranking;
- API/UI exposure;
- AI or psychological interpretation.
