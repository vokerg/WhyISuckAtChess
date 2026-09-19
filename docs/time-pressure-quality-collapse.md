# TIME-002 move-quality collapse under time pressure

**Status:** Phase 4B implemented aggregate  
**Diagnosis:** TIME-002 QUALITY_COLLAPSE_UNDER_TIME_PRESSURE  
**Aggregate policy:** time-pressure-quality-collapse-v1  
**Shared timing-behavior policy:** time-behavior-v1  
**Issue:** #60 under #56

## Purpose

TIME-002 measures whether the player's current engine-backed move quality differs when the trustworthy before-move clock is in PRESSURE or CRITICAL versus NORMAL-clock moves with the same exact time control and stabilized phase.

The aggregate is explicitly correlational. A positive pressure-minus-baseline score-loss or error-rate delta means the measured quality metric is worse in the pressure arm. It does not establish panic, tilt, a psychological state, or that clock pressure caused the deterioration. Neutral and negative deltas are valid outputs.

## Reference / Preserve / Change / Omit / Future seam

### Reference

The implementation follows the bounded aggregation pattern used by CRT's player chess profile:

- bounded ownership-scoped repository reads;
- deterministic metric construction outside persistence;
- one-decimal percentages/deltas;
- 5/15/40 supporting-game evidence grades with a 50% evidence-coverage floor.

Within Why, the implementation reuses:

- time-behavior-v1 for pressure classification, matching, coverage, rounding, and evidence strength;
- the same current-complete engine provenance fence used by the Phase 4 session aggregates;
- current phase-context evidence semantics from TIME-001;
- RATING-002 when the analyzed comparison game arms are disjoint.

### Preserve

- authoritative source clocks and timing derivation;
- exact-control identity;
- stabilized phase rather than move-number phase inference;
- current complete engine evidence only;
- explicit move and distinct-game denominators;
- bounded reads and snapshot-drift failure;
- separate confounder disclosure rather than effect adjustment.

### Change

TIME-002 is a move-level comparison rather than a game-level profile. Its mandatory matching key is exact time-control key plus stabilized phase, and evidence strength uses distinct games in the weaker arm instead of raw move count.

### Omit

- causal inference;
- panic/tilt/fatigue interpretation;
- significance testing;
- diagnosis persistence or ranking;
- API/UI/AI work;
- arbitrary broad-speed pooling.

### Future seam

TIME-004 can reuse the pressure-quality comparison as the final link in the early-overuse -> later-pressure -> later-degradation chain. TIME-007 can reuse the same quality/provenance and exact-control/phase matching boundary for opponent-speed exposure.

## Bounded source read

getTimePressureQualityCollapse(appUserId, scope, repository, ratingRepository):

1. validates from < to;
2. counts owned candidate games;
3. refuses scopes above 5,000 candidates before loading source rows;
4. loads the same bounded candidate population once;
5. fails closed if the candidate count changes during the read;
6. performs deterministic move matching and quality aggregation;
7. attaches RATING-002 only when the analyzed baseline and pressure game-ID arms are both non-empty and disjoint.

The Prisma repository selects only the source fields required by the aggregate. Ownership and date scope are enforced in the ImportedGame query.

## Timing and pressure eligibility

Only games supported by the existing standard timing policy are eligible.

For each user decision after the color's first move:

- the game and ply must publish the current timing-derivation version;
- timing status must be AVAILABLE;
- before-move clock must be finite and non-negative;
- POSSIBLE_EXTERNAL_CLOCK_ADJUSTMENT excludes the move;
- missing, inconsistent, stale, or unreliable timing is coverage loss.

The shared remaining-clock bands are used without modification:

- CRITICAL: <= 10 seconds;
- PRESSURE: > 10 and <= 30 seconds;
- NORMAL: > 30 seconds.

PRESSURE and CRITICAL form the pressure arm. NORMAL forms the baseline arm.

Unlike TIME-001's conservative complete-game recurrence denominator, TIME-002 is a move-level comparison: a trustworthy move may contribute even when another move in the same game lacks timing. The aggregate therefore exposes move-level timing coverage explicitly and bases recurrence strength on distinct analyzed games.

## Matching boundary

A move can enter matched comparison only when:

- exactTimeControlKey is present;
- the before-position boundary has current stabilized OPENING, MIDDLEGAME, or ENDGAME evidence.

The matching key is:

1. exact time-control key;
2. stabilized phase.

Only strata containing at least one pressure move and at least one baseline move are retained. One-sided strata are reported as unmatched comparison context and excluded rather than pooled with another control or phase.

The output retains every matched exact-control/phase stratum with per-arm move counts, analyzed moves, supporting games, average score loss, mistake-or-blunder rate, and blunder rate.

V1 does not equalize stratum frequencies. It also does not match opening family, session context, color, calendar period, or opponent strength. Those remain composition caveats.

## Engine provenance

A move contributes quality only when its linked GameAnalysisRun:

- succeeded;
- has COMPLETE coverage;
- points to the same sourcePlyIndexedAt snapshot as the current ImportedGame ply index;
- supplies a finite non-negative scoreLossCp.

Stale, superseded, incomplete, missing, or snapshot-mismatched analysis remains analysis-coverage loss.

The aggregate reports:

- number of distinct current analysis runs used;
- analysis snapshot IDs;
- analysis versions;
- settings hashes;
- engine name/version pairs.

This provenance summary is descriptive. It does not merge incompatible source rows or repair stale analysis.

## Metrics and deltas

Each arm reports:

- matched eligible moves;
- distinct eligible games;
- analyzed moves;
- distinct supporting analyzed games;
- engine-analysis coverage;
- required-evidence coverage;
- average score loss in centipawns;
- mistake-or-blunder rate;
- blunder rate.

Comparison deltas are always:

pressure - baseline

Therefore:

- positive score-loss delta means larger average loss under pressure;
- positive error-rate delta means a higher measured error rate under pressure;
- zero means no measured difference for that metric;
- negative means the measured metric is better in the pressure arm.

The implementation does not convert those signs into a causal or psychological verdict.

## Coverage and evidence strength

TIME-002 exposes separate coverage for:

- timing-eligible user decisions;
- trustworthy timed decisions;
- exact-control/phase context;
- shared matched strata;
- current complete engine quality.

Required evidence coverage for each arm is the minimum of timing, context, matching, and that arm's engine-analysis coverage. Below 50%, evidence strength is INSUFFICIENT.

Comparative evidence strength then uses the weaker distinct supporting-game arm:

- < 5 games: INSUFFICIENT;
- 5-14: LOW;
- 15-39: MEDIUM;
- >= 40: HIGH.

Move count remains visible but cannot substitute for cross-game recurrence.

## Opponent-strength composition

RATING-002 accepts disjoint game-ID arms. TIME-002 therefore attaches the existing rating-context-composition-v1 result only when the analyzed baseline and pressure supporting-game sets are both non-empty and disjoint.

If a game contributes analyzed moves to both arms, rating composition is reported as unavailable with reason comparison-game-arms-overlap. The implementation does not manufacture exclusive subsets, duplicate the same game into both RATING-002 arms, or mutate the pressure-quality effect.

When attached, RATING-002 remains a separate confounder disclosure. Its warning never adjusts TIME-002 deltas.

## Interpretation boundary

Preferred factual interpretation is limited to statements such as:

> In matched 3+0 middlegame decisions, average score loss was higher under the defined clock-pressure state than in normal-clock decisions.

The aggregate must not turn that association into claims such as:

> Time pressure makes you panic.

or:

> You blunder because you are bad under pressure.

Those stronger causal or psychological claims are outside the evidence contract.
