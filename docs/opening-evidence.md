# Opening-phase and recurring-position evidence

**Status:** Phase 3 deterministic evidence policy  
**Scope:** issue #33  
**Per-game detector:** `opening-context@opening-v1`  
**Cross-game query:** bounded opening recurrence aggregation over current `opening-context` evidence  
**Depends on:** complete current Stockfish analysis, `phase-context@phase-v1`, exact normalized position identity, and the deterministic evidence substrate

## Purpose

Issue #33 needs two different evidence scopes without collapsing their provenance boundaries.

The per-game detector records deterministic early-game facts that later recurrence analysis can safely compare: user move quality in positions that are still canonically classified as opening, plus the exact positions where the user's evaluation first crosses into a materially worse opening state.

The cross-game query then asks whether those source-linked facts recur across enough current analysed games to support either:

- `REPEATED_EARLY_MOVE_ERROR`; or
- `RECURRING_BAD_OPENING_POSITION`.

This is opening evidence, not repertoire training. It does not recommend lines, infer memorization gaps, rank final diagnoses, or use opening names as position identity.

## CRT reference and intentional delta

The pinned Chess Repertoire Trainer reference uses:

- `docs/opening-struggles.md`;
- `opening-struggles.service.ts`;
- `opening-struggles.repository.prisma.ts`; and
- the corresponding opening-struggles tests.

Why preserves CRT's most important operational properties:

- count the candidate game scope before loading recurrence rows;
- reject an over-broad scope rather than silently truncating it;
- keep early-game work bounded;
- preserve side-aware semantics;
- keep repeated-move and recurring-bad-position denominators distinct;
- return compact supporting game/ply references.

Why changes the representation and ownership:

- `phase-v1`, rather than a UI/request-only ply limit, decides whether a sampled move is still opening;
- exact normalized position IDs and user color are the recurrence keys;
- opening name/ECO is enrichment only and never replaces position identity;
- per-game source facts are persisted through the general evidence substrate;
- cross-game recurrence is a separate bounded evidence query, consistent with the architecture rule that one evidence worker claim remains one game x detector/version;
- bullet uses the same supported standard-game policy as blitz and rapid;
- repertoire/course coverage and recommendations are omitted.

## Per-game opening policy

`opening-v1` has an additional hard safety ceiling of ply 20. A ply is eligible only when its **before-position boundary** is classified as `OPENING` by the current `phase-v1` logic. The ceiling limits work; it is not a second phase classifier.

For every eligible user move with current complete engine evidence, the detector emits `OPENING_MOVE_QUALITY_SAMPLE` containing:

- exact before/after position IDs;
- played UCI move;
- score loss and classification;
- user-perspective evaluation before and after;
- user color;
- opening name/ECO, speed category, and exact time control as descriptive context.

A move sample is not itself a recurring mistake. It is the inspectable source fact from which recurrence can later be established.

## Bad-position threshold-entry policy

The initial policy uses a user-perspective threshold of **-80cp**.

When an eligible opening transition moves from above `-80cp` to at or below `-80cp`, the detector emits one `OPENING_BAD_POSITION_ENTRY` for that transition and references the exact resulting position.

This is threshold-entry evidence. Descendants that merely remain below the threshold are not emitted as additional bad-position entries. That preserves CRT's anti-duplication idea while moving identity from an opening prefix label to the exact normalized position.

A policy change to the threshold, phase boundary semantics, or payload meaning requires a detector-version bump.

## Cross-game recurrence policy

The recurrence query operates only on **current, provenance-valid, successful, complete** `opening-context@opening-v1` runs. It rechecks:

- the run's indexed source timestamp against the current game;
- the source analysis snapshot and indexed source;
- successful complete analysis status;
- that every current ply still points at the same analysis run.

Stale or superseded evidence therefore cannot contribute to recurrence.

The query first counts all eligible indexed standard Lichess games for the user. If more than **5000** games are in scope, it returns explicit unavailable coverage and does not load event rows.

Before absence of recurrence can be considered meaningful, the policy requires:

- at least **5 analysed games**; and
- at least **50% analysis coverage** of eligible games.

Below five analysed games, recurrence evidence is `UNAVAILABLE`. Below 50% coverage, it is `INCOMPLETE`. Neither state is converted into a no-finding result.

### Repeated early move error

Samples are grouped by:

`user color + exact before-position ID + played move`

A repeated early move error requires at least **5 distinct games** and average score loss of at least **60cp**. Multiple samples from one game cannot inflate the cross-game denominator.

Opening name/ECO values are retained only as metadata, so transpositions with different provider opening labels still group when the exact position and move match.

### Recurring bad opening position

Threshold-entry samples are grouped by:

`user color + exact resulting position ID`

A recurring bad opening position requires at least **5 distinct games** reaching the same threshold-entry position. Opposite colors never share one group.

Both finding types include aggregate measurements, deterministic evidence-strength grading, and up to eight representative game/ply/position references.

## Coverage semantics

Missing phase context, engine position evaluation, or user-move score loss is explicit incomplete per-game coverage. It is never interpreted as evidence that no opening problem occurred.

At the cross-game layer, adequate coverage with fewer than the recurrence threshold is a valid complete no-finding result. Inadequate game or analysis coverage is not.

## Boundedness and ownership

The worker persists only bounded game-local opening events. It never loads another game or the user's game history.

The recurrence repository performs SQL-side scope/provenance filtering, counts the scope before event loading, and only then loads the compact current opening events needed for aggregation. It does not load PGNs, complete ply histories, historical detector runs, or unrelated evidence families.

The output remains deterministic evidence for later diagnosis aggregation. Issue #33 does not add a diagnosis endpoint, cross-game ranking, recommendation engine, or UI.

## Non-goals

This policy does not:

- create or evaluate a repertoire;
- recommend openings or memorization;
- group unrelated positions merely because they share an opening name;
- infer that every poor opening result is caused by opening knowledge;
- perform Phase 4 timing/session/rating comparisons;
- rank `OPEN-002` or `OPEN-003` against other diagnosis families;
- generate AI prose.
