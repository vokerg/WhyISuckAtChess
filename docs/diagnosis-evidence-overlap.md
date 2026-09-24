# Phase 5 evidence-event identity and overlap

**Status:** Phase 5 implementation for issue #84  
**Policy:** `diagnosis-event-identity-v1` from `docs/diagnosis-synthesis-ranking-policy.md`  
**Consumes:** canonical diagnosis finding drafts/snapshots from #82/#83

## Purpose

This slice makes shared evidence measurable before relationship construction, consolidation, root synthesis, or ranking. It compares stable source identities, not diagnosis labels, effect values, prose, timestamps, or representative-example similarity.

The implementation has two layers:

- `packages/chess-domain/src/diagnosis-policy.ts` owns framework-neutral stable event-identity builders and the material-overlap policy helpers.
- `apps/api/src/modules/diagnosis/diagnosis-overlap.service.ts` validates bounded finding reference coverage and calculates deterministic pair/cluster overlap.
- `diagnosis-overlap.repository.prisma.ts` fences persisted overlap reads on current/succeeded source evidence events and owned games.

No relationship edge, consolidation decision, root promotion, or ranking penalty is created here.

## CRT reference / Why delta

### Reference

CRT source-game/ply support records and deterministic diagnosis evidence linkage are the reference boundary.

### Preserve

- authoritative imported-game/source-event linkage;
- source detector/aggregate versions;
- deterministic recalculation;
- bounded player-scoped work;
- raw finding denominators and evidence references.

### Change

Why needs quantified overlap across heterogeneous canonical findings. It therefore carries a versioned event identity and reports both event overlap and game-set overlap explicitly.

### Omit

- semantic relationship inference;
- approximate string/effect matching;
- destructive deduplication;
- ranking;
- AI or UI concerns.

### Future seam

#85 can consume the pairwise result directly for `SHARES_EVENTS_WITH`; #86/#87/#88 can consume the same event/game overlap without recomputing identity.

## Stable identity

Supported v1 identity constructors are:

### Ply/event identity

```text
diagnosis-event-identity-v1
+ owned imported-game ID
+ trigger/user ply
+ source detector/evidence kind
+ source detector/version
+ optional detector-stable discriminator
```

Use `diagnosisPlyEventIdentityKey(...)`. Numeric game/ply values must be positive safe integers. Source kind/version/discriminator are bounded and escaped before becoming a key.

### Game-level identity

When the authoritative evidence unit is the game rather than one causal ply:

```text
diagnosis-event-identity-v1
+ owned imported-game ID
+ source aggregate/evidence kind
+ source version
+ optional stable discriminator
```

Use `diagnosisGameEventIdentityKey(...)`.

The #83 adapters now attach these identities where the source contract is sufficient:

- opening recurrence supporting plies use the opening evidence kind + `opening-v1`;
- complete `TIME-004` chain games use a game-level identity owned by the early-time-overuse aggregate.

Other #83 aggregates that expose only denominators/representative metrics and no complete game/event set remain explicitly non-calculable for event overlap.

## Coverage and fail-closed behavior

Each finding is prepared independently before a pair is compared.

Event overlap is authoritative only when:

1. the finding has evidence references;
2. every reference has an owned imported-game ID;
3. referenced distinct games cover the finding's declared distinct-game denominator;
4. every reference has a current `diagnosis-event-identity-v1` key;
5. the reference count stays within the Phase 5 bound.

If any condition fails, event overlap returns `calculable: false` and an explicit per-arm coverage status. Missing identity is never inferred from diagnosis ID, effect value, reference key, timestamp, or representative examples.

Game-set overlap is reported separately. It can remain calculable when every required game is referenced even if stable event identity is unavailable. This allows consumers to see contextual game-population overlap without mislabeling different source events as the same event.

For persisted current scopes, the Prisma overlap repository additionally checks referenced `EvidenceEvent` rows. Missing, unavailable, non-succeeded, superseded, or cross-owner source events fail closed before overlap is calculated.

## Pair output

For calculable event overlap the service exposes:

- left/right unique event denominators;
- intersection and union event counts;
- left-arm, right-arm, smaller-arm, and Jaccard rates;
- distinct games and sessions containing the intersecting events;
- largest single-game share of intersecting events;
- the material-overlap boolean from the shared #81 policy.

Game-set output exposes:

- left/right distinct-game denominators;
- game intersection and union;
- left/right/Jaccard game rates;
- shared session count when session context is complete.

The material decision still requires at least two shared events, at least two distinct shared-event games, and the 60% smaller-arm threshold. Several matching events concentrated in one game therefore cannot establish material cross-game overlap.

## Boundedness and determinism

- one finding may retain at most 1,000 evidence references;
- one current scope may contain at most 200 findings;
- cluster calculation sorts findings deterministically and evaluates each unordered pair once;
- a 200-finding scope therefore has a hard maximum of 19,900 pairs;
- `TIME-004` source game references are capped at the shared 1,000-reference limit; when the source contains more games, the declared distinct-game denominator makes overlap non-calculable rather than silently treating the truncated set as complete.

No all-history Cartesian query is introduced.

## Fixtures

`apps/api/test/diagnosis-overlap.test.mjs` covers:

- full overlap;
- partial overlap;
- no overlap;
- repeated shared events concentrated in one game;
- aggregate game-set overlap across different event kinds;
- missing event identity with calculable game-set overlap;
- stale event-identity version;
- incomplete/truncated reference coverage;
- deterministic bounded cluster ordering;
- current-scope version/source fencing.
