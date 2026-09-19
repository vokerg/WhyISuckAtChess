# TIME-004 early-time-overuse aggregate

**Status:** implemented Phase 4B aggregate  
**Aggregate version:** `early-time-overuse-v1`  
**Shared policy:** `time-behavior-v1`  
**Scope:** issue #64 under #56

## Purpose

`TIME-004 EARLY_TIME_OVERUSE` tests one ordered behavioral chain:

1. the player spends unusually much time during the trustworthy stabilized `OPENING` phase;
2. the same game later reaches the shared pressure/critical clock state;
3. current engine evidence shows worse move quality there than the player's exact-control/phase-matched normal-clock baseline.

All three links must be present in order. Early overuse by itself, later pressure by itself, or degraded play without the preceding links is reported separately and does not become a positive `TIME-004` mechanism.

The result is correlational. It does not claim that early thinking caused the later pressure or infer panic, indecision, or another psychological state.

## Early-time baseline

The aggregate uses the shared `time-behavior-v1` policy directly.

The early window is the trustworthy stabilized `OPENING` phase from phase evidence. It is not inferred from a move-number cutoff. First-move think time remains unavailable and is never fabricated.

For each timing-eligible game with an exact control, early expenditure is the sum of current trustworthy user move times in the covered `OPENING` window.

Within each exact-control group:

- at least 5 early-covered peer games are required;
- the player-relative baseline is the median early expenditure;
- early overuse means expenditure is at least `1.5x` that median.

Sparse controls remain unavailable. A 3+0 game never borrows a 3+2 baseline.

## Ordered later-pressure link

Only games classified as early-overuse candidates proceed to the pressure stage.

The later window begins after the last trustworthy `OPENING` user decision. Pressure uses the shared before-move clock bands:

- `PRESSURE`: more than 10 seconds and at most 30 seconds;
- `CRITICAL`: at most 10 seconds.

The aggregate records the first observed later pressure decision and the number of observed later pressure moves.

If pressure is positively observed, that link can be established even when another later timing value is unavailable. The timing gap remains explicit coverage loss and lowers the shared evidence gate. If no pressure is observed and later timing is incomplete, the pressure link is unavailable rather than treated as a no-pressure game.

## Later-quality link

For an early-overuse game with observed later pressure, each current-engine pressure move is compared only with current complete `NORMAL`-clock moves having the same:

1. exact time-control key; and
2. stabilized phase.

For each matched pressure move, the comparator is the player's average normal-clock score loss in that exact-control/phase stratum. The per-game later-quality effect is:

`average pressure score loss - average matched normal-clock benchmark`.

A positive delta marks degraded later play for that game. Missing phase, missing current complete engine analysis, or a missing normal-clock comparator is quality-coverage loss.

This matching is move-level. Comparator games may overlap the early-overuse game set; the aggregate does not pretend they are independent cohorts.

## Coverage, recurrence, and mechanism status

The output exposes:

- candidate and timing-eligible games;
- early-window coverage;
- same-control peer-baseline coverage;
- early-overuse games;
- later-pressure evaluability and full later-timing coverage;
- quality-evaluable pressure games;
- known and matched analyzed pressure moves;
- distinct normal-clock comparator games;
- each broken chain link;
- complete-chain recurrence;
- exact-control summaries and per-game evidence.

Evidence strength uses the shared weaker-arm rule across quality-evaluable early-overuse games and distinct normal-clock comparator games, with the minimum required modality coverage.

`mechanismStatus` is:

- `INSUFFICIENT` when the shared coverage/sample gate fails;
- `ORDERED_ASSOCIATION` when the gate passes and the complete ordered chain recurs in at least five games;
- `NOT_SUPPORTED` when the gate passes but complete-chain recurrence does not reach that minimum.

No statistical-significance or causal claim is implied.

## Bounded repository behavior

The Prisma repository:

- filters by `appUserId` and optional half-open `[from, to)` date scope;
- orders deterministically;
- caps reads at 5,000 candidate games;
- loads only user plies plus current phase and engine evidence needed by the aggregate;
- accepts phase evidence only from the current ply-index snapshot;
- accepts engine evidence only from a successful, complete analysis run for the current ply-index snapshot.

The service count-checks before loading and fails closed if the candidate set changes during the read.

## Validation focus

Focused tests cover:

- five-game recurrence of the complete chain;
- early overuse without later pressure;
- pressure without current matched quality evidence;
- pressure with equal/better quality;
- missing phase;
- unreliable early timing;
- exact-control peer isolation and sparse controls;
- observed pressure with incomplete later timing;
- deterministic result ordering;
- bounded reads and candidate-set drift;
- ownership/range-bounded Prisma loading;
- stale engine snapshot rejection.

## Caveats

The v1 policy thresholds are inspectable calibration choices, not universal chess truths.

Exact control and phase are mandatory for the relevant baselines, but v1 does not additionally equalize opening family, opponent strength, color, session context, or date. Those distributions can remain confounders for later diagnosis synthesis.
