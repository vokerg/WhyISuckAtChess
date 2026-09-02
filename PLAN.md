# Why I Suck at Chess — High-Level Plan

**Status:** High-level execution roadmap  
**Source of product truth:** [BIBLE.md](BIBLE.md)  
**Reference implementation:** `vokerg/chess_repertoir_trainer`

This document defines the major project phases and the intended delivery model. It is deliberately higher level than the future architecture plan, diagnostic specification, issue graph, and PR breakdown.

The project should not move directly from this document into ad hoc implementation. The next planning work must turn these phases into explicit architecture decisions, diagnostic contracts, dependencies, GitHub issues, and PR boundaries.

---

## Phase 0 — Product foundation

Capture the durable product intent and engineering invariants before implementation begins.

This includes:

- the core product question: **Why do I suck at chess?**;
- evidence-first diagnosis rather than generic engine commentary;
- Lichess-only initial scope;
- authenticated Lichess connection as the authoritative identity source;
- full preservation of per-ply clock data;
- time-control analysis, including increment versus no increment and exact controls such as 3+0 versus 3+2;
- deterministic chess evidence as the authoritative layer;
- AI used only as a bounded explanatory/synthesis layer;
- modular architecture with replaceable seams;
- pragmatic duplication/adaptation from Chess Repertoire Trainer instead of premature shared-library extraction.

### Exit condition

The Bible is sufficient to constrain later architectural and product decisions without relying on chat history.

**Current status:** substantially complete.

---

## Phase 1 — Architecture and diagnostic design

Turn the product vision into a finite, implementable diagnostic system.

This phase must define:

- the complete diagnostic taxonomy;
- the evidence required to support every diagnosis;
- minimum sample sizes, coverage rules, confidence levels, and comparison baselines;
- the distinction between observation, mechanism, contributing condition, and root-cause candidate;
- the data model for users, Lichess identity, games, plies, clocks, analysis, tactical events, sessions, and diagnoses;
- analysis pipeline boundaries;
- worker/job architecture;
- module boundaries and interfaces;
- what will be copied/adapted from Chess Repertoire Trainer versus built specifically for this product;
- which duplicated modules must be structured so that a future shared package can replace them cleanly;
- the boundary between deterministic algorithms and AI explanation.

The diagnostic design must explicitly include at least:

- tactical mistakes and tactical motifs;
- defensive threat blindness;
- hanging/undefended material;
- missed mating attacks;
- opening and recurring-position weaknesses;
- conversion failures;
- endgame and endgame-subtype failures, including rook endgames;
- clock management;
- time pressure;
- played-too-fast behavior;
- opponent move-speed effects;
- exact time controls;
- increment versus no increment;
- phase-specific performance;
- sessions, fatigue, and measurable session deterioration;
- losing streaks / tilt-consistent deterioration;
- time-of-day effects;
- rating/opponent-strength effects.

### Exit condition

Every major diagnosis has a defined source of evidence and the architecture can support it without unresolved foundational gaps.

---

## Phase 2 — Core platform and trustworthy ingestion

Build the minimum reliable application platform and get trustworthy source data into the system.

Primary work includes:

- application skeleton and workspace structure;
- authentication;
- mandatory Lichess OAuth/token connection;
- one application user to one Lichess identity initially;
- encrypted token persistence and disconnect/revoke flow;
- Lichess game import;
- reliable incremental re-import/sync behavior;
- persistence and migrations;
- persistent jobs/workers;
- normalized game and ply indexing;
- preservation of timestamps, ratings, results, openings, exact time controls, increment, speed, and related metadata;
- **lossless per-ply clock preservation as a hard ingestion invariant**;
- board/game representation suitable for later replay and evidence display.

Clock data must survive the entire path:

**Lichess response -> import DTO -> normalized model -> database -> ply-level application DTO -> analysis/diagnostics.**

Bullet must not be silently excluded merely because the reference project currently limits parts of its standard analysis workflow to blitz and rapid.

### Exit condition

A user can connect Lichess, import games reliably, and the database contains all raw information required for later diagnoses.

---

## Phase 3 — Chess evidence engine

Create the factual per-game and per-position evidence layer.

Reuse/adapt the strongest parts of Chess Repertoire Trainer where practical:

- Stockfish execution;
- reusable normalized-position analysis;
- engine caching;
- best moves and evaluations;
- CPL / score-loss calculations;
- move classification;
- game analysis runs;
- background processing;
- cancellation/retry/recovery;
- tactical candidate detection;
- board reconstruction and replay.

Then add the missing product-specific deterministic classifiers, including where feasible:

- hanging pieces / undefended material;
- missed captures;
- forks;
- pins;
- skewers;
- discovered attacks;
- overload / removal of defender;
- back-rank motifs;
- mating nets and missed mates;
- threat blindness;
- material-state changes;
- position phase;
- endgame type/subtype;
- conversion/throw/save evidence;
- opening-phase disasters and repeated early mistakes.

The engine should distinguish factual evidence from narrative interpretation. A finding such as “evaluation dropped 420cp because the move left a rook en prise” should be algorithmically defensible before AI is allowed to explain it.

### Exit condition

For an individual game, important events can be represented as rich structured evidence rather than only generic engine classifications.

---

## Phase 4 — Behavioral and longitudinal analysis

Move from individual-game evidence to recurring patterns across games.

This phase should build bounded aggregations and comparisons across dimensions such as:

- exact time control;
- speed category;
- increment versus no increment;
- increment size;
- remaining clock;
- time spent per move;
- clock state before blunders/missed tactics;
- opponent move speed;
- opening / opening family / recurring sequence;
- color;
- game phase;
- material/evaluation state;
- result;
- opponent rating / rating difference;
- game number within a session;
- session length;
- inter-game gaps;
- recent games played;
- losing streak length;
- local time of day.

The default comparison should usually be against the player’s own baseline rather than arbitrary universal claims.

Examples of questions this layer should answer:

- Is the player materially better with increment than without it?
- Is 3+0 specifically much worse than 3+2?
- Does tactical accuracy collapse below a certain remaining time?
- Does the player spend too much time early and then blunder late?
- Does the player move too quickly despite having ample time?
- Do opponents who blitz out opening moves induce worse decisions?
- Does move quality deteriorate after several games in one session?
- After consecutive losses, which specific chess errors become more common?
- Is late-night play measurably worse than the user’s normal baseline?

Tilt/fatigue must be treated carefully. The system should first establish measurable deterioration and only then describe it as evidence **consistent with** tilt, fatigue, or overplaying. It must not pretend to read psychological state from chess games.

### Exit condition

The system can identify statistically meaningful recurring weaknesses and conditions under which they become worse.

---

## Phase 5 — “Why I Suck” diagnosis engine

Combine the evidence into coherent ranked diagnoses.

This is the core product layer.

Each diagnosis should carry, where applicable:

- diagnosis type;
- concise claim;
- mechanism;
- frequency;
- severity;
- result impact;
- comparison baseline;
- effect size;
- sample size and denominator;
- analysis coverage;
- confidence/evidence strength;
- important dimensions/conditions;
- representative games;
- representative positions/moves;
- supporting clock/time-control evidence;
- related diagnoses;
- possible parent/root-cause relationship.

The system must avoid flooding the user with correlated duplicates. For example:

- “you enter time trouble often”;
- “you blunder below 20 seconds”;
- “you perform badly in 3+0”; and
- “you do much better with increment”

may all be separate observations but could represent one larger time-management weakness. The diagnosis engine should preserve the evidence while producing a coherent hierarchy rather than four disconnected accusations.

The deterministic diagnosis system must be useful before AI is added.

### Exit condition

Structured deterministic evidence can produce a credible ranked answer to **Why do I suck at chess?**

---

## Phase 6 — Explanation and product experience

Build the user-facing experience around the diagnosis engine.

Likely product surfaces include:

- overall diagnostic summary;
- ranked weaknesses;
- diagnosis drill-down;
- time-control comparisons;
- increment versus no-increment comparisons;
- clock/time-pressure views;
- opening weakness views;
- tactical motif breakdowns;
- offensive versus defensive tactical failures;
- session/tilt-consistent deterioration views;
- endgame subtype views;
- board replay with evidence markers;
- representative games and positions;
- supporting metrics and confidence explanations.

The board and replay UI should be adapted from Chess Repertoire Trainer where possible.

### AI role

AI may synthesize and explain bounded verified evidence. It is especially useful where a human-readable chess explanation is semantically richer than the deterministic labels, for example:

- why a rook endgame technique failed;
- how several related findings fit together;
- explaining the practical meaning of a recurring positional problem.

AI must not invent:

- evaluations;
- moves;
- openings;
- tactical events;
- clock facts;
- statistical effects;
- intentions;
- psychological states.

### Exit condition

A user can understand what the major weaknesses are, why the product believes them, and inspect the underlying evidence directly.

---

## Phase 7 — Validation, calibration, economics, and hardening

Validate both software correctness and diagnostic credibility.

This phase includes ordinary quality work:

- unit tests;
- integration tests;
- end-to-end flows;
- migrations;
- worker recovery;
- import resilience;
- cancellation/retry behavior;
- API contracts;
- performance;
- security and token handling.

It also includes domain-specific validation:

- curated known-game scenarios;
- deliberately constructed tactical/time-management examples;
- manual chess review of generated diagnoses;
- false-positive analysis;
- false-negative analysis;
- threshold calibration;
- confidence calibration;
- sample-size behavior;
- analysis-coverage behavior;
- overlapping/root-cause diagnosis checks;
- AI grounding/hallucination checks.

Stockfish economics should be measured here and throughout implementation:

- average analysis cost/time per game;
- position-cache reuse;
- depth/quality trade-offs;
- backlog throughput;
- worker concurrency;
- incremental re-analysis strategy.

Do not weaken the product’s evidence quality prematurely merely to optimize theoretical cost.

### Exit condition

We trust the diagnoses enough to show them to real users and understand the operational cost of producing them.

---

## Phase 8 — Product iteration and optional expansion

Only after the core product has demonstrated value should we consider broader investment such as:

- Chess.com or other providers;
- multiple external chess identities per user;
- improvement plans or training recommendations;
- longitudinal progress tracking;
- richer tablebase/endgame systems;
- additional AI workflows;
- mobile;
- deeper interoperability with Chess Repertoire Trainer;
- extraction of duplicated modules into maintained shared libraries/packages.

Shared-library extraction is deliberately deferred. Until reuse pressure and product success justify the investment, modules may be copied/adapted between repositories, provided their internal boundaries remain sufficiently clean to allow later replacement.

---

# Delivery model: agentic, parallel, review-driven

The phases above describe product development, but execution should itself be treated as a designed system.

## 1. Plan before implementation

Before implementation work starts in earnest, Phase 1 must produce:

- an architecture plan;
- a diagnostic specification;
- a dependency graph;
- a reusable-versus-new component map;
- module/interface boundaries;
- migration/data-model plan;
- acceptance criteria;
- GitHub issues with explicit dependencies;
- intended PR boundaries.

Do not let implementation details hidden inside one agent’s branch become the de facto architecture.

## 2. Decompose work into independently reviewable issues

A GitHub issue should represent a coherent outcome with:

- scope;
- context and relevant Bible/plan links;
- dependencies/blockers;
- required interfaces/contracts;
- acceptance criteria;
- test expectations;
- explicit non-goals.

Large features should be split where independent implementation and review are genuinely possible, not merely to maximize issue count.

## 3. Execute independent work in parallel

Once dependency boundaries are stable, independent workstreams should proceed concurrently.

Examples that may eventually run in parallel include:

- application/bootstrap infrastructure;
- Lichess OAuth;
- clock-preserving importer;
- worker/job foundation;
- Stockfish adapter;
- board/replay component adaptation;
- tactical motif classifiers;
- session-analysis foundation;
- contracts/test fixtures.

Parallelism must respect data-model and contract dependencies. Avoid starting several branches that each independently redefine the same schema or interface.

## 4. One meaningful change per task branch / PR

Use short-lived task branches. Every meaningful implementation unit should land through a PR rather than direct changes to `main`, except for explicit repository/bootstrap exceptions.

PRs should be small enough to review rigorously and large enough to represent a coherent outcome.

## 5. Separate implementation from review

A feature is not done when its implementation agent says it is done.

Each PR should receive an independent review pass that checks at minimum:

- correctness;
- architecture boundaries;
- agreement with Bible/plan/issue;
- data integrity;
- bounded queries/workloads;
- error behavior;
- test quality;
- accidental coupling;
- unnecessary duplication;
- whether copied reference-project code was adapted rather than blindly transplanted;
- whether future shared-library replacement remains feasible.

Where practical, the reviewer should be a separate agent/context from the implementation agent.

## 6. CI is a merge gate, not the review

CI should validate objective repository guarantees such as:

- lint;
- type/build correctness;
- unit tests;
- integration tests;
- migrations;
- architecture rules;
- hygiene checks;
- relevant fixture/audit validation.

A green CI run does not substitute for architectural or chess-domain review.

## 7. Merge in dependency-safe order

Parallel PRs should not simply be merged in completion order.

The coordinating agent should:

1. maintain the dependency graph;
2. identify which PRs are ready to integrate;
3. refresh/rebase branches as necessary;
4. re-run affected tests after upstream changes;
5. merge in a dependency-safe sequence;
6. verify downstream PR assumptions after each shared-contract/schema change.

Prefer squash merges so each issue/PR remains a clean unit in repository history.

## 8. Integration/acceptance stage after feature PRs

A collection of individually correct PRs is not automatically a working product slice.

For each meaningful milestone, perform a separate integration pass covering:

- end-to-end data flow;
- cross-module contracts;
- migrations from a clean database;
- realistic Lichess fixtures;
- worker execution;
- engine analysis;
- diagnosis production;
- frontend consumption where applicable;
- performance and failure behavior.

Integration failures should create explicit follow-up issues/PRs instead of being silently patched into unrelated branches.

## 9. Keep the source-of-truth documents current

When implementation reveals a genuine change in architecture or product assumptions:

- update the relevant design document deliberately;
- do not allow code and planning documents to drift silently;
- record important reversals and their rationale.

The hierarchy is:

1. **BIBLE.md** — durable product and engineering principles;
2. **PLAN.md** — high-level project phases and delivery model;
3. future architecture/diagnostic specifications — detailed system design;
4. GitHub issues — executable work units;
5. PRs — implementation and review history.

---

# Phase relationships and parallelism

These phases are not intended to become a waterfall.

Phase 1 is the major planning gate. After its contracts and dependencies are sufficiently stable, substantial portions of Phases 2 and 3 can proceed in parallel. Later Phase 3 classifiers can also progress independently once the common game/position evidence interfaces exist. Phase 4 can begin as soon as enough structured evidence and imported games exist, rather than waiting for every possible chess classifier.

The central dependency chain is approximately:

**Foundation -> architecture/diagnostic contracts -> trustworthy ingestion -> structured chess evidence -> cross-game pattern analysis -> diagnosis engine -> product explanation/UI -> validation/calibration -> product iteration.**

Inside each stage, maximize safe parallelism without sacrificing coherent contracts.

---

# What matters most

Infrastructure such as authentication, Lichess import, Stockfish execution, job workers, and Chessground-based replay is important, but much of it can be adapted from Chess Repertoire Trainer.

The distinctive product work lies mainly in Phases 3–5:

1. extracting richer chess mechanisms from engine/game evidence;
2. identifying recurring behavioral and situational patterns across games;
3. converting those facts into a defensible, ranked, non-redundant explanation of why the player underperforms.

That diagnostic chain should receive the strongest architecture, review, testing, and calibration effort in the project.
