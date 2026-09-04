# Diagnostic taxonomy and evidence contracts

Status: Phase 1 canonical specification  
Scope: issue #3  
Parent: issue #1  
Reference baseline: `vokerg/chess_repertoir_trainer` (CRT) at commit `13a7e2791944ebd52113afe9f76413b10634ddff`  
Depends on: `BIBLE.md`, `PLAN.md`, `docs/crt-delta-map.md`  
Feeds: issue #4 and later evidence, aggregation, ranking, API, and UI implementation work

## 1. Purpose

Why I Suck at Chess must answer a narrower and harder question than a normal game review: **which recurring, evidenced mechanisms and conditions materially explain this player's underperformance?**

This document defines the finite diagnostic vocabulary and the evidence contract that downstream classifiers, aggregators, ranking code, APIs, and UI may rely on. It intentionally separates:

1. source facts;
2. per-game or per-ply observations;
3. chess mechanisms;
4. contributing conditions;
5. root-cause candidates;
6. optional human-language explanation.

A diagnosis is not an arbitrary label and is not an LLM opinion. It is a versioned deterministic claim backed by inspectable evidence, a denominator, a baseline, coverage information, an effect measure, and representative games/positions where applicable.

The exact numeric thresholds in this document that are marked **calibration-sensitive** are initial policy defaults, not permanent product truth. Changing them later must bump the relevant detector/aggregation policy version.

## 2. Core semantic model

### 2.1 Authority order

The authoritative evidence chain is:

```text
provider facts
  -> normalized game / ply facts
  -> board geometry / reconstructed positions
  -> cached engine evidence
  -> deterministic detections and derived features
  -> bounded cross-game aggregation and comparison
  -> diagnostic findings and relationships
  -> optional AI explanation
```

A later layer may summarize or relate earlier evidence, but it may not overwrite it.

### 2.2 Finding levels

Every finding has exactly one `level`:

| Level | Meaning | Example |
| --- | --- | --- |
| `OBSERVATION` | A repeated measured outcome or pattern, without claiming why it occurs. | `3+0 score is lower than 3+2 score.` |
| `MECHANISM` | A chess or behavioral mechanism directly supported by board/engine/timing evidence. | `Major losses frequently begin with one-move hanging-piece oversights.` |
| `CONTRIBUTING_CONDITION` | A context in which another observation/mechanism becomes materially more common or severe. | `The hanging-piece rate rises sharply below 20 seconds.` |
| `ROOT_CAUSE_CANDIDATE` | A synthesized, inspectable explanation that unifies multiple recurring observations/mechanisms/conditions. It remains a candidate, not metaphysical truth. | `Clock management is a major driver of late tactical collapses in no-increment blitz.` |

The ranking engine may promote a structured cluster into a `ROOT_CAUSE_CANDIDATE`; individual detectors should normally emit observations, mechanisms, or contributing conditions.

### 2.3 Claim language

The system must distinguish what it knows from what it infers.

Allowed factual language:

- `In 18 of 42 analysed games, ...`
- `Your blunder rate was 9.2% below 20 seconds versus 4.1% otherwise.`
- `The position was +4.8 before the move and -0.6 after it.`

Allowed correlational language:

- `This pattern is associated with ...`
- `The deterioration is concentrated after ...`
- `The evidence is consistent with tilt/overplaying.`
- `You perform worse in this context, after accounting for the comparison shown.`

Disallowed without a stronger future causal design:

- `3+0 causes you to blunder.`
- `You were angry.`
- `You got tired after game 6.`
- `Your opponent's fast play intimidated you.`

Psychological labels are never authoritative facts.

## 3. Canonical finding contract

A future persistence or wire model may choose different field names, but it must preserve these concepts.

```text
DiagnosticFinding
  id
  diagnosisId
  taxonomyVersion
  detectorOrAggregatorVersion
  level
  titleKey / deterministic summary
  scope
    account/user identity
    date range
    speed / exact time control
    color
    rated/casual
    optional opening / phase / session / rating filters
  sample
    eligibleGames
    includedGames
    analysedGames
    clockCompleteGames
    eligibleEvents or plies when event-based
    includedEvents or plies
  coverage
    analysisCoveragePct
    clockCoveragePct
    boardReconstructionCoveragePct
    detectorCoveragePct
    exclusionsByReason
  observedMetric
  baselineMetric
  effect
    absoluteDelta
    relativeDelta when meaningful
    severity aggregate
    resultImpact proxy when defined
  evidenceStrength
  mechanismConfidence
  confounders / caveats
  supportingGames[]
  supportingPliesOrPositions[]
  relatedFindingIds[]
  relationshipEdges[]
  createdAt / calculationAsOf
```

### 3.1 Source-reference invariants

A chess-specific mechanism finding must be able to lead back to the evidence that made it true. Supporting records should include, where relevant:

- imported game ID/provider game ID;
- user color;
- ply number and side to move;
- before/after position identity;
- played move and best move where relevant;
- score loss/evaluation transition;
- clock facts and timing feature version where relevant;
- detected motif/endgame/phase/opening context;
- session context where relevant.

Aggregated context-only findings such as time-of-day effects may use game references without a single causal ply, but they still need representative games and the exact denominator/comparator.

### 3.2 Source facts versus derived facts

Source facts and derived facts must remain distinguishable.

Examples of source facts:

- provider timestamps;
- exact time control and increment;
- provider clocks;
- result/status;
- ratings;
- moves.

Examples of derived facts:

- reconstructed think time;
- game phase;
- session ordinal;
- time-pressure state;
- tactical motif;
- endgame family;
- score loss;
- diagnostic finding.

Derived values must carry a derivation/detector version when their semantics can change.

## 4. Evidence strength, sample size, and coverage

### 4.1 Evidence strength grades

Reuse CRT Player Chess Profile's deterministic sample philosophy as the default initial policy:

| Supporting sample | Grade |
| ---: | --- |
| `< 5` | `INSUFFICIENT` |
| `5-14` | `LOW` |
| `15-39` | `MEDIUM` |
| `>= 40` | `HIGH` |

These are **evidence grades, not statistical-significance claims**.

For event-based findings, the supporting sample is the relevant event denominator (for example, tactical opportunities) but the response must also expose the number of distinct games so 40 events from one game cannot masquerade as high cross-game recurrence.

### 4.2 Comparative claims

A comparative finding (for example 3+0 vs 3+2, increment vs no increment, late-session vs early-session) is limited by its weaker arm.

Initial policy:

- either arm `< 5` relevant games/events -> `INSUFFICIENT`;
- both arms `>= 5` -> at most `LOW`;
- both arms `>= 15` -> at most `MEDIUM`;
- both arms `>= 40` -> eligible for `HIGH`.

A finding dominated by one player-day, one opening, one opponent, or one extreme outlier should be downgraded or carry an explicit concentration caveat.

### 4.3 Required-evidence coverage

Coverage is modality-specific. The system must report the denominator for every modality it relies on.

Hard rules:

- no engine-derived conclusion may treat unanalysed games as negative evidence;
- no clock-derived conclusion may impute missing provider clocks as zero or normal behavior;
- no board-geometry mechanism may claim coverage over plies that could not be reconstructed;
- no session finding may include games whose chronological/session context is unavailable under the chosen sessionization version.

Initial coverage gate, inherited from CRT's Player Chess Profile philosophy: if fewer than 5 required-evidence items exist **or required-evidence coverage is below 50%**, the finding is `INSUFFICIENT` regardless of raw sample size.

Issue #4 may define stricter clock-completeness requirements once Lichess clock semantics are finalized. This document deliberately does not invent clock values or move-time reconstruction rules.

### 4.4 Mechanism confidence

Evidence strength and mechanism confidence are separate dimensions.

| Mechanism confidence | Meaning |
| --- | --- |
| `DIRECT` | Board rules/geometry or exact source facts prove the mechanism. Example: an undefended rook was legally capturable and was lost. |
| `SUPPORTED` | Engine sequence plus deterministic structural features strongly support the mechanism, but another label could also describe the same sequence. |
| `HEURISTIC` | A versioned rule identifies a plausible mechanism from bounded evidence; wording must acknowledge uncertainty. |

A `HIGH` sample grade does not upgrade a heuristic chess label to `DIRECT`.

### 4.5 Effect and severity

Findings should expose the actual effect measure rather than a generic score.

Possible measures include:

- percentage-point rate difference;
- score percentage difference;
- average/median score-loss difference;
- frequency per game or per opportunity;
- evaluation swing;
- conversion rate difference;
- time-pressure exposure rate;
- average remaining clock difference;
- session slope or early-vs-late delta;
- estimated result-impact proxy.

The future ranking engine may normalize these internally, but user-facing evidence must retain the original metric and units.

### 4.6 Supporting examples

A finding must include bounded representative evidence when such evidence exists.

Initial policy:

- `LOW`: at least 1 representative game/event if available;
- `MEDIUM`: at least 2 distinct games;
- `HIGH`: at least 3 distinct games spanning the finding scope where practical.

Examples should prioritize typical/high-severity evidence, not only the most dramatic outlier.

## 5. Baseline selection and confounders

### 5.1 Default baseline

The default comparison is the player's own eligible baseline over the same requested date/account scope.

A narrower comparison should hold constant, where practical and material:

- speed or exact time control;
- color;
- rated/casual;
- opponent-strength band;
- analysis/clock coverage;
- major opening mix;
- session context.

The system should prefer a transparent matched/stratified comparison over an opaque model. More sophisticated adjustment may be added later, but raw group differences must not be presented as causal effects.

### 5.2 Confounder disclosure

Every comparative family must be able to disclose material composition differences, especially:

- opponent rating distribution;
- user's rating distribution over time;
- exact time-control mix;
- color mix;
- rated/casual mix;
- opening mix;
- date/recency mix;
- analysis/clock coverage imbalance;
- session position/time-of-day imbalance.

If a material confounder cannot be controlled or clearly displayed, downgrade the wording and evidence strength rather than silently ignoring it.

## 6. Finite diagnostic registry

Diagnosis IDs are stable semantic identifiers. Display text may change without changing an ID; semantic changes require a taxonomy version or a new ID.

### 6.1 Move quality and tactical mechanisms

| ID | Canonical name | Default level | Core claim |
| --- | --- | --- | --- |
| `TACT-001` | `TACTICAL_MISSED_OPPORTUNITIES` | `MECHANISM` | The player repeatedly fails to preserve tactical chances created by opponent mistakes or forcing opportunities. |
| `TACT-002` | `OFFENSIVE_TACTICAL_MOTIF_MISSES` | `MECHANISM` | Repeated missed offensive tactics cluster in one or more deterministic motifs/mechanism classes. |
| `TACT-003` | `DEFENSIVE_THREAT_BLINDNESS` | `MECHANISM` | Major losses repeatedly begin one move before the opponent's tactic, when a defensive response was available. |
| `TACT-004` | `HANGING_OR_UNDEFENDED_MATERIAL` | `MECHANISM` | The player repeatedly leaves material loose, en prise, insufficiently defended, or fails an obvious recapture. |
| `TACT-005` | `MATING_ATTACK_BLINDNESS` | `MECHANISM` | The player repeatedly misses their own forcing mating chances and/or fails to answer opponent mating threats. |
| `TACT-006` | `TACTICAL_ERROR_RATE` | `OBSERVATION` | Major tactical/engine losses recur above the player's comparison baseline, without yet specifying a single mechanism. |

### 6.2 Opening and recurring positions

| ID | Canonical name | Default level | Core claim |
| --- | --- | --- | --- |
| `OPEN-001` | `RECURRING_OPENING_POOR_RESULTS` | `OBSERVATION` | A recurring opening family/prefix has materially worse results than the player's baseline. |
| `OPEN-002` | `REPEATED_EARLY_MOVE_ERROR` | `MECHANISM` | The player repeatedly chooses the same early move with material score loss. |
| `OPEN-003` | `RECURRING_BAD_OPENING_POSITION` | `MECHANISM` | A recurring opening sequence repeatedly reaches an objectively worse threshold-entry position. |
| `OPEN-004` | `OPENING_TIME_USE_PROBLEM` | `CONTRIBUTING_CONDITION` | Opening play is associated with excessive early time use or overly fast decisions, and later quality/clock outcomes deteriorate. |

### 6.3 Conversion and game-story mechanisms

| ID | Canonical name | Default level | Core claim |
| --- | --- | --- | --- |
| `CONV-001` | `FAILED_ADVANTAGE_CONVERSION` | `MECHANISM` | The player repeatedly obtains a meaningful advantage but fails to preserve/convert it. |
| `CONV-002` | `MISSED_KNOCKOUT_OR_DRAW_SAVE` | `MECHANISM` | The player repeatedly misses decisive wins or drawable-saving continuations in critical positions. |
| `CONV-003` | `SLOW_BLEED_DERIORATION` | `MECHANISM` | Losses repeatedly accumulate through several smaller errors rather than one dominant collapse. |

### 6.4 Phase and endgame

| ID | Canonical name | Default level | Core claim |
| --- | --- | --- | --- |
| `PHASE-001` | `PHASE_SPECIFIC_UNDERPERFORMANCE` | `OBSERVATION` | Move quality/result/evaluation loss is materially worse in one phase than the player's own other-phase baseline. |
| `END-001` | `ENDGAME_THROW_OR_FAILED_CONVERSION` | `MECHANISM` | Drawable/winning endgames are repeatedly spoiled or not converted. |
| `END-002` | `ENDGAME_FAMILY_WEAKNESS` | `MECHANISM` | Errors/results are concentrated in a deterministic endgame material family. |
| `END-003` | `ROOK_ENDGAME_WEAKNESS` | `MECHANISM` | Rook endgames specifically show repeated material/evaluation/technique failures beyond the player's comparable endgame baseline. |

### 6.5 Clock and time-control behavior

| ID | Canonical name | Default level | Core claim |
| --- | --- | --- | --- |
| `TIME-001` | `FREQUENT_TIME_PRESSURE` | `OBSERVATION` | The player enters low-clock states unusually often or unusually early. |
| `TIME-002` | `QUALITY_COLLAPSE_UNDER_TIME_PRESSURE` | `CONTRIBUTING_CONDITION` | Move quality/tactical awareness materially deteriorates below a defined remaining-clock state. |
| `TIME-003` | `PLAYED_TOO_FAST` | `MECHANISM` | The player repeatedly makes very fast decisions despite sufficient available time, with worse subsequent move quality than comparable normally-paced decisions. |
| `TIME-004` | `EARLY_TIME_OVERUSE` | `MECHANISM` | Excessive early time expenditure is repeatedly followed by avoidable late time pressure and degraded play. |
| `TIME-005` | `EXACT_TIME_CONTROL_UNDERPERFORMANCE` | `OBSERVATION` | One exact control (for example 3+0) materially underperforms a transparent comparable baseline (for example 3+2 or the player's other blitz controls). |
| `TIME-006` | `INCREMENT_EFFECT` | `CONTRIBUTING_CONDITION` | Performance/timing quality differs materially with increment versus comparable no-increment games. |
| `TIME-007` | `OPPONENT_MOVE_SPEED_EFFECT` | `CONTRIBUTING_CONDITION` | The player's response speed or move quality changes materially after unusually fast opponent moves/sequences. |

### 6.6 Session, streak, and calendar context

| ID | Canonical name | Default level | Core claim |
| --- | --- | --- | --- |
| `SESSION-001` | `LATE_SESSION_DETERIORATION` | `CONTRIBUTING_CONDITION` | Chess quality measurably worsens with game ordinal or elapsed session duration. |
| `SESSION-002` | `LOSS_STREAK_ASSOCIATED_DETERIORATION` | `CONTRIBUTING_CONDITION` | Specific chess/timing errors increase after consecutive losses relative to matched session baseline. |
| `SESSION-003` | `OVERLONG_SESSION_STOPPING_POINT` | `ROOT_CAUSE_CANDIDATE` | A stable session-duration/game-count threshold is associated with broad, repeated quality deterioration and supports a practical stopping-point conclusion. |
| `CAL-001` | `LOCAL_TIME_OF_DAY_EFFECT` | `CONTRIBUTING_CONDITION` | Performance or a specific mechanism is materially worse in a local-time band than in the player's matched baseline. |

### 6.7 Rating and opponent context

| ID | Canonical name | Default level | Core claim |
| --- | --- | --- | --- |
| `RATING-001` | `OPPONENT_STRENGTH_EFFECT` | `CONTRIBUTING_CONDITION` | Results or error mechanisms change materially across opponent-rating/rating-difference bands. |
| `RATING-002` | `RATING_CONTEXT_COMPOSITION_WARNING` | `OBSERVATION` | A claimed group difference is materially confounded by opponent/user rating composition and must be interpreted cautiously. |

The registry is intentionally finite for Phase 1. Motif/subtype values are dimensions of a diagnosis, not new top-level diagnosis IDs unless future evidence shows they need independent lifecycle/ranking semantics.

## 7. Family evidence contracts

### 7.1 Tactical family (`TACT-*`)

**Authoritative source facts**

- legal move sequence and reconstructed positions;
- user color/side to move;
- engine best score/best move/PV where applicable;
- played-move score loss/classification;
- material before/after;
- analysis and detector versions.

**Board/engine evidence**

- attack/defense maps, legal captures/checks, piece values and material deltas;
- forcing-line structure where the motif requires it;
- user-perspective before/after evaluations;
- opportunity/gift/reply sequence for missed-shot style detections.

**Aggregation dimensions**

- motif/mechanism subtype;
- offensive vs defensive;
- tactical horizon/complexity;
- phase;
- exact time control and clock state;
- opening/recurring position;
- opponent rating/rating difference;
- session ordinal/streak state.

**Baseline**

- opportunities of the same class where the player succeeded;
- the player's overall analysed move/tactical opportunity rate;
- matched normal-clock vs time-pressure opportunities for conditional claims.

**Sample/coverage**

- use event-based sample grade plus distinct-game count;
- engine/board coverage under the common 50% gate -> `INSUFFICIENT`;
- motif-specific claims must not use unclassified tactical events as proof that a motif was absent.

**Effect/severity**

- missed-opportunity rate;
- mechanism rate per opportunity/game;
- median/mean score loss;
- material loss;
- mate transition/decisive evaluation transition;
- result-impact proxy.

**Supporting proof**

- exact before-position, played move, best/defensive move, after-position, eval transition, and motif geometry;
- representative successes may also be shown to explain the comparison baseline.

**Caveats**

- one event may legitimately have multiple motifs;
- engine score loss proves severity, not the human-readable mechanism;
- long tactical sequences may remain `SUPPORTED` or `HEURISTIC` even with strong engine evidence.

**Wording**

- say `missed`, `overlooked`, `left en prise`, `failed to answer the threat` only when deterministic evidence supports it;
- do not say `you cannot calculate` or infer attention/psychology.

**Diagnosis-specific notes**

- `TACT-001`: adapt CRT `MISSED_SHOT` / `PUNISHED_OPPONENT_BLUNDER` complement logic; compare missed chances with tactical chances preserved.
- `TACT-002`: motif is a dimension such as hanging capture, fork/double attack, pin, skewer, discovered attack/check, removal of defender, deflection/decoy, overload, interference, clearance, zwischenzug, trapped piece, promotion, back-rank, mating net, sacrifice/forcing sequence, or `OTHER_FORCING`.
- `TACT-003`: requires evidence at the position before the user's defensive failure and a credible defensive move; the opponent's next tactic alone is not enough.
- `TACT-004`: prefer `DIRECT` geometry when a piece is legally capturable/undefended or a forced recapture is omitted.
- `TACT-005`: split dimensions `MISSED_OWN_MATE`, `IGNORED_MATING_THREAT`, `BACK_RANK`, `MATING_NET`, `FORCED_MATE`; mate evidence must come from engine/board analysis, never AI.
- `TACT-006`: is a fallback observation when move-quality evidence is strong but a mechanism classifier is unavailable/uncertain; it should be suppressed beneath a stronger recurring mechanism when the same events explain it.

### 7.2 Opening family (`OPEN-*`)

**Authoritative source facts**

- game moves/positions, color, opening metadata where available;
- indexed early plies;
- exact time control/result;
- score loss/evaluation for analysed early plies;
- timing facts for `OPEN-004` only.

**Board/engine evidence**

- `OPEN-001` can exist from result recurrence without engine evidence but must not claim a chess mechanism;
- `OPEN-002` requires analysed repeated occurrences of the same owner move from the same normalized position/prefix;
- `OPEN-003` requires post-prefix evaluations and threshold-entry semantics;
- `OPEN-004` requires clock-derived timing evidence defined by issue #4.

**Aggregation dimensions**

- normalized opening family/ECO/name;
- recurring prefix/position identity;
- color;
- exact time control;
- opponent rating;
- opponent fast-play context;
- result and early move quality.

**Baseline**

- player's overall result/move-quality baseline for comparable color/time control;
- parent prefix for threshold-entry position claims;
- alternate occurrences where the same position was handled well.

**Sample/coverage**

- count candidate games before loading early plies;
- never silently truncate a scope; reject/narrow it if boundedness would otherwise bias the result;
- engine-dependent opening claims obey common analysis-coverage gate.

**Effect/severity**

- loss/score rate delta;
- repeated-move average/median CPL;
- average post-prefix evaluation;
- threshold-entry frequency;
- time spent/remaining-clock delta for timing context.

**Supporting proof**

- opening/prefix line and normalized position;
- repeated played move and stronger alternatives;
- game references from distinct occurrences.

**Caveats**

- opening poor results may reflect opponent strength or later play;
- `OPEN-001` is not a recommendation to memorize theory;
- opening name/ECO is metadata, not proof of why the position failed.

**Wording**

- `You score worse from this recurring line` is acceptable;
- `This opening is bad for you because you don't understand it` is not.

### 7.3 Conversion family (`CONV-*`)

**Authoritative source facts**

- ordered user-perspective evaluation timeline;
- result/termination;
- user move score losses/classifications;
- phase and clock context where available.

**Board/engine evidence**

- proof of a meaningful advantage/drawable state before a failure;
- critical move(s) where the advantage materially falls;
- for slow bleed, an ordered sequence of smaller losses with no single dominant collapse under the policy.

**Aggregation dimensions**

- advantage size at entry;
- phase/endgame family;
- exact time control/clock state;
- conversion length;
- session/rating/opening context.

**Baseline**

- the player's comparable winning/drawable positions successfully converted/saved;
- aggregate conversion success at similar advantage bands.

**Sample/coverage**

- denominator is opportunities, not all games;
- a user with only three +5 positions cannot receive a strong conversion diagnosis from a large unrelated game history.

**Effect/severity**

- conversion/save success rate;
- eval lost from peak/entry state;
- number/severity of critical errors before result;
- result points foregone proxy.

**Supporting proof**

- advantage entry position and critical failure positions;
- at least one successful comparator when available.

**Caveats**

- engine-winning does not imply trivial human conversion;
- a flag while winning may be primarily a time-management mechanism and should be related rather than double-ranked.

**Wording**

- describe `failed to convert a winning engine advantage` rather than `should have won easily` unless difficulty evidence supports that stronger claim.

### 7.4 Phase/endgame family (`PHASE-*`, `END-*`)

**Authoritative source facts**

- reconstructed positions and deterministic phase classifier version;
- material inventory/endgame-family classifier;
- engine evaluations and user move losses;
- result and clock context.

**Board/engine evidence**

- `PHASE-001`: phase label plus comparable move/event metrics;
- `END-001`: endgame entry state and decisive evaluation transitions;
- `END-002`/`END-003`: deterministic material-family membership plus recurring failures.

**Aggregation dimensions**

- opening/middlegame/transition/endgame;
- endgame family: rook, queen, pawn, minor-piece, bishop-vs-knight, opposite-colored bishops, same-colored bishops, rook+minor, major-piece-heavy, other;
- material/evaluation state at entry;
- time control/clock state;
- color and opponent strength.

**Baseline**

- player's other phases or other endgame families;
- comparable entry-evaluation bands;
- successful positions in the same endgame family.

**Sample/coverage**

- denominator is moves/positions/games actually classified into the phase/family;
- family claims require distinct games, not many plies from one long endgame;
- tablebase/advanced technique labels are optional future evidence and must not be implied when unavailable.

**Effect/severity**

- score-loss per user move;
- throw/conversion rate;
- evaluation delta from phase/endgame entry to exit;
- result score delta.

**Supporting proof**

- entry position, material family, critical position(s), evaluation transition, and clock state.

**Caveats**

- being worse in an endgame family may reflect entering it already lost; compare entry state;
- nuanced technique terms such as passive rook/cut-off king require explicit deterministic features or must remain `HEURISTIC`.

**Wording**

- `Rook endgames are a recurring weak area in this sample` is allowed when evidence supports it;
- `You don't understand rook endgames` is not a deterministic conclusion.

### 7.5 Clock/time-control family (`TIME-*`)

**Authoritative source facts**

- exact initial time and increment;
- broad speed category as a separate label;
- per-ply provider clocks and their source semantics;
- timestamps, moves, user color, result;
- engine move-quality evidence for quality-effect claims.

Issue #4 owns the exact clock unit, before/after-move semantics, think-time reconstruction, missing-clock rules, and timing derivation version. This taxonomy consumes that contract; it does not redefine it.

**Board/engine evidence**

- `TIME-001` may be computed from timing facts alone;
- `TIME-002`, `TIME-003`, and `TIME-004` require move-quality/tactical evidence to claim deterioration;
- `TIME-005`/`TIME-006` may use result score as observation but need move/timing metrics to explain mechanism;
- `TIME-007` requires opponent and user move-time features plus move-quality comparison.

**Aggregation dimensions**

- exact control (`1+0`, `1+1`, `3+0`, `3+2`, etc.);
- increment presence/size;
- remaining-clock band;
- think-time band;
- phase;
- opening;
- opponent move-speed band;
- rating difference;
- session ordinal/streak state.

**Baseline**

- player's own normal-clock moves/games under comparable control;
- comparable exact controls for `TIME-005`;
- increment/no-increment groups within similar speed/nominal-time contexts for `TIME-006`;
- same-player moves not preceded by fast opponent play for `TIME-007`.

**Sample/coverage**

- required clock evidence must be explicitly counted;
- missing clocks are excluded, not treated as normal pace;
- comparative groups use the weaker-arm evidence grade;
- if exact-control groups have materially different opponent rating distributions, create/link `RATING-002` and downgrade causal wording.

**Effect/severity**

- fraction of games/moves below pressure thresholds;
- first pressure-entry move/phase;
- move-quality/tactical error-rate delta in pressure;
- think-time and remaining-clock distributions;
- score/result difference by control/increment;
- response-time/quality difference following fast opponent moves.

**Supporting proof**

- representative move timeline with clocks and critical errors for behavioral claims;
- group summary and comparator composition for time-control claims.

**Caveats**

- correspondence/nonstandard controls may be unsupported by timing derivations;
- provider inconsistencies or missing clocks must lower coverage;
- opponent fast play may proxy opening familiarity or stronger opposition;
- premoves/near-zero think times require careful semantics from issue #4.

**Wording**

- `Your error rate rises when your remaining clock is below ...` is acceptable;
- `You panic under time pressure` is not.

**Diagnosis-specific notes**

- `TIME-001` describes exposure, not consequence. It should normally be grouped with `TIME-002` when pressure also predicts worse play.
- `TIME-003` requires ample-clock context plus unusually short think time **and** worse quality than an appropriate pace baseline; fast good moves are not a problem.
- `TIME-004` requires an ordered chain: above-normal early time expenditure -> later pressure -> degraded outcome/mechanism at a rate above baseline. Otherwise report the components separately.
- `TIME-005` is an observation. It should not outrank a supported mechanism such as pressure-induced tactical collapse.
- `TIME-006` may be positive or negative; do not assume increment helps every player.
- `TIME-007` must remain correlational unless a stronger design is introduced.

### 7.6 Session/streak/calendar family (`SESSION-*`, `CAL-*`)

**Authoritative source facts**

- game start/end timestamps;
- deterministic, versioned sessionization output;
- game ordinal/session elapsed time/inter-game gap;
- prior results/streak state;
- local time derived from an explicit user IANA timezone;
- engine/tactical/timing metrics used as outcome variables.

**Board/engine evidence**

- session/calendar findings need no single chess motif, but a root-cause-style conclusion should identify which measurable chess/timing mechanisms deteriorate.

**Aggregation dimensions**

- game ordinal;
- elapsed session duration;
- rolling game count;
- loss/win streak length;
- exact time control;
- local hour/daypart/day-of-week;
- opponent rating;
- opening/phase/mechanism.

**Baseline**

- early-session or non-streak games within comparable control/opponent bands;
- the player's other local-time bands;
- within-player baseline over the same date scope.

**Sample/coverage**

- use distinct sessions as an additional recurrence denominator;
- a pattern repeated across many games in one session is weaker than the same pattern across multiple sessions;
- timezone must be explicit for `CAL-001`; no guessed locale timezone.

**Effect/severity**

- quality slope by ordinal/duration;
- early-vs-late blunder/tactical-miss/CPL/think-time delta;
- score difference;
- mechanism-specific rate changes after losses;
- stable threshold where deterioration begins for `SESSION-003`.

**Supporting proof**

- session summaries plus representative games before and after deterioration;
- for streak findings, show matched non-streak comparator games when possible.

**Caveats**

- session length correlates with time of day and game type;
- losing streaks can reflect stronger opponents rather than tilt;
- rating drift over months can confound calendar comparisons;
- `SESSION-003` requires repeated threshold-like behavior across sessions, not one marathon session.

**Wording**

- preferred: `Your tactical miss rate is higher after two consecutive losses; this is evidence consistent with tilt-like deterioration.`
- prohibited: `You were tilted/angry/frustrated.`
- preferred: `Your play deteriorates after about game 7 in long sessions.`
- prohibited: `You get tired after game 7.`

### 7.7 Rating/opponent family (`RATING-*`)

**Authoritative source facts**

- user/opponent ratings at game time;
- rating difference;
- result and exact time control;
- mechanism metrics used in the comparison.

**Aggregation dimensions**

- opponent rating band;
- rating difference band;
- exact time control;
- rated/casual;
- color;
- opening/session/time-of-day.

**Baseline**

- adjacent or matched opponent-strength bands within the player's own sample.

**Sample/coverage**

- comparative weaker-arm rule;
- avoid tiny rating bins that create unstable claims.

**Effect/severity**

- score percentage;
- move-quality/tactical/clock-mechanism rate difference;
- composition difference between other compared groups.

**Supporting proof**

- group summaries and representative games; chess-specific plies only when a mechanism is part of the claim.

**Caveats**

- rating systems/pools differ by speed;
- user rating itself changes over time;
- causality should not be inferred from opponent strength.

**Wording**

- `Against opponents 100-200 points higher, your defensive tactical miss rate is ...` is acceptable;
- `Strong players make you panic` is not.

## 8. Relationship and deduplication model

### 8.1 Allowed relationship edges

A finding may relate to another finding through one or more typed edges. Every relationship edge is directed from one `DiagnosticFinding.id` to another `DiagnosticFinding.id`; raw context values such as `3+0`, `no increment`, a clock band, or an interpretation string belong in finding scope/dimensions and are never relationship targets.

| Edge | Meaning |
| --- | --- |
| `SPECIALIZES` | Child is a more specific form of parent. Example `TACT-004` specializes `TACT-006`. |
| `MANIFESTS_AS` | Higher-level condition/root candidate produces or is evidenced through a concrete mechanism/outcome. |
| `CONTRIBUTES_TO` | Finding plausibly contributes to another based on ordered/conditional evidence, without asserting full causality. |
| `CONDITIONAL_ON` | Finding is materially concentrated when another contextual finding/condition is present. Example `TACT-004 CONDITIONAL_ON -> TIME-002` when hanging-material errors rise under time pressure. |
| `EXPLAINS_OBSERVATION` | Mechanism/condition provides a more specific explanation for an observation. |
| `SHARES_EVENTS_WITH` | Findings use materially overlapping game/ply events and should not be ranked independently without penalty. |
| `CONFOUNDED_BY` | A material composition difference weakens interpretation. |

### 8.2 Event identity and overlap

The same ply may support multiple dimensions:

```text
BLUNDER classification
+ hanging queen mechanism
+ 8.2 seconds remaining
+ game 9 of session
+ after two losses
```

These are not five independent reasons.

A future evidence event should have stable source identity (game + trigger/user ply + detector version as appropriate). Findings must retain the event IDs or equivalent source references they aggregate. The ranking layer can then calculate overlap.

Initial deduplication policy:

1. prefer a specific mechanism over a generic outcome when it explains most of the same severe events;
2. preserve a contextual condition when it materially changes the mechanism rate/severity;
3. suppress or demote a raw context observation when a supported mechanism chain explains the same performance gap;
4. never discard evidence—suppressed findings remain drill-down relationships;
5. do not promote a `ROOT_CAUSE_CANDIDATE` unless it unifies repeated evidence across distinct games and, where relevant, distinct sessions.

### 8.3 Canonical example: 3+0 time-management cluster

Possible raw findings:

```text
TIME-005  3+0 result score is 12pp below 3+2
TIME-001  low-clock exposure is 1.8x higher in 3+0
TIME-002  tactical blunder rate doubles below 20s
TACT-004  hanging-material errors dominate those low-clock blunders
TIME-006  increment games show less late pressure
```

The exact-control and increment values remain in each finding's scope/dimensions; the relationship graph contains finding IDs only:

```text
TIME-001 FREQUENT_TIME_PRESSURE (observation; scope: 3+0)
  CONTRIBUTES_TO -> TIME-005 EXACT_TIME_CONTROL_UNDERPERFORMANCE
TIME-002 QUALITY_COLLAPSE_UNDER_TIME_PRESSURE (contributing condition)
  EXPLAINS_OBSERVATION -> TIME-005 EXACT_TIME_CONTROL_UNDERPERFORMANCE
  MANIFESTS_AS -> TACT-004 HANGING_OR_UNDEFENDED_MATERIAL
TIME-006 INCREMENT_EFFECT (contributing condition)
  CONTRIBUTES_TO -> TIME-001 FREQUENT_TIME_PRESSURE
```

A ranking engine may synthesize a root candidate such as:

> `Clock management in no-increment blitz is a major driver of your late tactical collapses.`

It should not show all five raw findings as equal top-level accusations.

## 9. Root-cause-candidate promotion rules

A root candidate is a synthesis artifact, not a detector output.

Minimum requirements:

- at least one repeated `MECHANISM` finding;
- at least one material observation or contributing condition that changes frequency/severity/result impact;
- meaningful evidence across multiple distinct games;
- adequate required-evidence coverage;
- relationship graph that explains event overlap;
- deterministic summary template or bounded evidence payload sufficient for reproducible explanation.

Examples of legitimate root-candidate themes:

- `CLOCK_MANAGEMENT_DRIVING_TACTICAL_COLLAPSE`;
- `DEFENSIVE_THREAT_BLINDNESS` when it is broad, repeated, and not merely a symptom of low clock;
- `LATE_SESSION_TACTICAL_DETERIORATION`;
- `ROOK_ENDGAME_CONVERSION_WEAKNESS`.

The exact root-candidate registry/ranking formula belongs to the later diagnosis-ranking implementation issue. This specification only constrains promotion semantics and evidence requirements.

## 10. Observation versus absence

The product must distinguish:

- `problem detected`;
- `pattern not detected with adequate coverage`;
- `insufficient evidence`;
- `required detector not implemented/coverage unavailable`.

Absence of a finding is not evidence of strength unless the relevant eligible sample and detector/analysis coverage are sufficient.

UI/API consumers must be able to distinguish these states.

## 11. CRT reference / preserve / change / omit / future seam

The CRT reference is pinned to commit `13a7e2791944ebd52113afe9f76413b10634ddff`, matching `docs/crt-delta-map.md`.

### 11.1 Move classification

**Reference**

- `packages/chess-domain/src/move-classification.ts`.
- `apps/api/src/modules/analysis/imported-game-analysis.service.ts`.

CRT classifies analysed moves into `BOOK`, `BEST`, `GOOD`, `INACCURACY`, `MISTAKE`, `BLUNDER`, `MISSED_OPPORTUNITY`, `BRILLIANT`, and `FORCED`; the baseline CPL bands are deterministic.

**Preserve**

- move quality as versioned deterministic evidence;
- user-perspective score-loss semantics;
- tested pure classification logic.

**Change**

- treat move classification as severity/outcome evidence, not the final diagnosis;
- attach recurring chess mechanisms and conditions separately.

**Omit**

- any assumption that a `BLUNDER` label alone explains why the user played badly.

**Future seam**

- a provider/framework-neutral move-quality input consumed by diagnostic detectors.

### 11.2 Tactical detections

**Reference**

- `docs/tactical-detections.md`.
- `apps/api/src/modules/lab/tactical-detections/tactical-detection.service.ts`.
- `apps/api/src/modules/lab/tactical-detections/tactical-detection-policy.ts`.
- `apps/api/src/modules/lab/tactical-detections/tactical-detection.repository.prisma.ts`.

CRT persists deterministic `MISSED_SHOT`, `PUNISHED_OPPONENT_BLUNDER`, and `USER_BLUNDER` findings from already analysed games, with explicit thresholds, user-centric evaluation math, processed markers, and a detection-version hash.

**Preserve**

- engine-free rescanning over cached analysis;
- explicit detector policy/version;
- processed-game markers including zero-detection games;
- exact trigger/reply ply evidence;
- bounded SQL-heavy aggregation.

**Change**

- promote tactical evidence from a Lab report into first-class diagnosis input;
- add deterministic motif, hanging-material, threat-blindness, and mating-threat dimensions;
- keep timing/session context in the aggregation layer rather than tactical detector internals.

**Omit**

- training-product side effects and psychological conclusions.

**Future seam**

- typed `TacticalEvidenceEvent` emitted independently from diagnosis aggregation and explanation.

### 11.3 Imported-game story tags and performance insights

**Reference**

- `docs/imported-game-tags.md`.
- `apps/api/src/modules/imported-games/game-tagging.service.ts`.
- `apps/api/src/modules/imported-games/game-tags.ts`.
- `apps/api/src/modules/imported-games/performance-insights.service.ts`.

CRT's tags encode useful deterministic story concepts such as opening trouble, early blunder, missed knockout, endgame throw/save, clean conversion, slow bleed, opponent blunder, flagged while winning, and chaos. Performance Insights groups those tags into broad buckets.

**Preserve**

- deterministic story/evaluation concepts;
- user-perspective semantics;
- separate post-analysis enrichment step;
- useful high-level buckets for navigation.

**Change**

- do not use compact integer tags as the canonical diagnosis model;
- diagnoses require category/level, denominator, coverage, effect, source events, detector version, evidence strength, and relationships;
- reserved clock tags must only exist when real per-ply clock evidence supports them.

**Omit**

- disabled/historical compatibility tags as product truth;
- bucket frequency as a root-cause claim.

**Future seam**

- a lightweight game-story facet model that diagnostic findings may reference without sharing storage format.

### 11.4 Opening Struggles

**Reference**

- `docs/opening-struggles.md`.
- `apps/api/src/modules/opening-struggles/opening-struggles.service.ts`.
- `apps/api/src/modules/opening-struggles/opening-struggles.repository.prisma.ts`.

CRT separates poor results, repeated owner-move mistakes, and recurring bad positions. It counts the candidate scope first, applies bounded early-ply loads, and rejects over-broad scopes instead of silently truncating.

**Preserve**

- distinct denominators for result, repeated-move, and evaluated-position questions;
- threshold-entry semantics for recurring bad positions;
- boundedness without silent truncation;
- side-aware recurring-prefix evidence.

**Change**

- remove repertoire/course-coverage ownership from the diagnosis;
- add exact-control, clock, rating, and session dimensions only through explicit evidence joins;
- represent each output as an observation/mechanism finding with confidence/coverage.

**Omit**

- repertoire coverage and course recommendation behavior.

**Future seam**

- reusable opening evidence query/aggregator independent from diagnosis ranking.

### 11.5 Player Chess Profile evidence strength

**Reference**

- `docs/player-chess-profile.md`.
- `apps/api/src/modules/player-chess-profile/player-chess-profile.service.ts`.
- `apps/api/src/modules/player-chess-profile/player-chess-profile.metrics.ts`.

CRT grades result evidence `<5 / 5-14 / 15-39 / >=40` as `INSUFFICIENT / LOW / MEDIUM / HIGH`, and forces analysis evidence to `INSUFFICIENT` with fewer than 5 analysed games or below 50% coverage.

**Preserve**

- explicit filters and denominators;
- evidence grades as deterministic sufficiency labels, not significance claims;
- personal baseline comparisons;
- supporting-game references;
- insufficient evidence as a normal output state.

**Change**

- apply modality-specific coverage and comparative weaker-arm rules;
- add event/game/session denominators and relationship/overlap metadata;
- separate mechanism confidence from sample evidence strength.

**Omit**

- personality/archetype conclusions.

**Future seam**

- pure evidence-grade utilities usable by all diagnostic families.

### 11.6 AI widget evidence philosophy

**Reference**

- `docs/ai-widgets.md`.
- `apps/api/src/modules/ai/game-review/game-review-context.ts`.
- `apps/api/src/modules/ai/game-review/game-review.service.ts`.

CRT supplies bounded authoritative facts, validates structured output, reconciles referenced moves/facts, rejects unsupported references/causal claims, and leaves deterministic evidence usable when AI fails.

**Preserve**

- bounded/redacted context;
- server-side validation and reconciliation;
- deterministic fallback;
- no Stockfish execution or core writes inside AI adapters;
- no invented psychological/causal claims.

**Change**

- AI may explain an already-produced diagnostic finding and relationship graph only after deterministic contracts exist;
- explanation context must include denominator, coverage, baseline, effect, supporting games/plies, confidence, and caveats.

**Omit**

- AI-generated diagnosis, ranking, evidence creation, or hidden correction of deterministic output.

**Future seam**

- an `ExplanationProvider` that accepts a typed redacted finding graph and returns optional prose.

## 12. Boundaries with issue #4 (clock-complete ingestion and timing)

This taxonomy requires timing evidence but intentionally leaves provider/time arithmetic semantics to issue #4.

Issue #4 must make it possible to populate, at minimum:

- exact control/increment dimensions used by `TIME-005` and `TIME-006`;
- authoritative per-ply clock coverage used by `TIME-001..004` and `TIME-007`;
- reliable/unknown timing-derived states rather than fabricated precision;
- separate source-clock and derived-think-time provenance;
- clock evidence usable in supporting ply references;
- bullet games as eligible diagnostic evidence.

If issue #4 cannot supply these semantics losslessly, affected timing diagnoses remain unavailable/insufficient rather than falling back to heuristics from game duration.

## 13. Implementation guidance for later issues

### 13.1 Suggested module seams

Later implementation should preserve boundaries similar to:

```text
ImportedGameFacts / PlyEvidence
  -> MoveQualityEvidence
  -> TacticalEvidence / OpeningEvidence / EndgameEvidence / TimingFeatures
  -> SessionContext
  -> DiagnosticEvidenceQuery
  -> family-specific pure aggregators
  -> relationship/deduplication builder
  -> ranking/root-candidate synthesis
  -> API read models
  -> optional ExplanationProvider
```

No diagnostic detector should import Lichess provider DTOs, Prisma models directly into pure domain logic, Angular UI code, or AI provider code.

### 13.2 Versioning

Version independently where semantics can change:

- taxonomy version;
- sessionization version;
- timing derivation version;
- tactical/motif detector version;
- phase/endgame classifier version;
- evidence-strength policy version;
- ranking/deduplication version.

A new explanation prompt must not require re-importing provider games. A new detector must not rewrite source facts.

### 13.3 Calibration-sensitive policy

The following should be centrally configurable/versioned rather than scattered literals:

- CPL/severity thresholds beyond the reused baseline classifier;
- tactical gift/drop/recovery thresholds;
- low-clock thresholds;
- `played too fast` timing bands;
- significant advantage/drawable bands;
- phase boundaries;
- session gap and deterioration thresholds;
- effect-size thresholds for surfacing a conclusion;
- rating bins and time-of-day bands.

This specification defines semantics; empirical calibration belongs to later validation work.

## 14. Acceptance checklist

This specification is complete for Phase 1 issue #3 when all of the following remain true:

- the top-level diagnosis registry is finite and every required family from the issue/Plan is represented;
- each family has source, engine/geometry, aggregation, baseline, sample/coverage, effect, supporting-proof, caveat, level, and wording rules;
- evidence strength is distinct from mechanism confidence and from statistical significance;
- observations, mechanisms, contributing conditions, and root-cause candidates have explicit semantics;
- overlapping findings retain evidence but can be related and deduplicated for ranking;
- session/tilt wording remains behavioral/correlational;
- exact time controls, increment, opponent move speed, local time, and opponent strength are diagnostic dimensions rather than unexamined metadata;
- CRT reuse is explicit through Reference / Preserve / Change / Omit / Future seam decisions;
- AI is optional explanation over bounded authoritative evidence, never the diagnosis authority;
- issue #4 has a concrete list of timing evidence the ingestion contract must preserve.
