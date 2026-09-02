# Why I Suck at Chess — Product & Engineering Bible

**Status:** Foundation / living source of truth  
**Project:** Why I Suck at Chess  
**Reference implementation:** `vokerg/chess_repertoir_trainer`  
**Purpose of this document:** preserve the product intent, diagnostic philosophy, architecture principles, reuse strategy, and engineering operating model before implementation planning begins.

This document is intentionally **not** a delivery plan and is **not** a task list. Detailed architecture decisions, milestones, GitHub issues, dependency graphs, and implementation PRs come later. When later planning contradicts an invariant in this document, the contradiction must be made explicit and this document must be updated deliberately.

---

## 1. The product question

The product exists to answer one deceptively simple question:

> **Why do I suck at chess?**

The answer must be considerably deeper than a generic accuracy report, a list of blunders, an opening dashboard, or a normal engine review.

The product should identify **recurring, evidenced reasons why the player underperforms**, quantify how important each reason appears to be, show when and where it happens, and connect the conclusion back to real games and positions.

Examples of valid answers include:

- You repeatedly leave pieces hanging.
- You miss short tactical shots after your opponents make mistakes.
- You fail to notice tactical threats your opponents are preparing.
- You enter time trouble too often.
- Your move quality collapses once you have less than 20 seconds.
- You play materially worse without increment than with increment.
- You play 3+0 far worse than 3+2 even after accounting for opponent rating.
- You use too much time early and then blunder later.
- You play too quickly in positions where you actually have time.
- You repeatedly lose the same opening structures.
- You are especially vulnerable when opponents blitz out their opening moves and you respond too quickly.
- You get acceptable positions but fail to convert advantages.
- You repeatedly throw drawable or winning endgames.
- Rook endgames are a recurring weakness.
- Your tactical vision deteriorates late in long playing sessions.
- After consecutive losses, your blunder and missed-tactic rates rise sharply.
- You keep playing after your measurable chess quality has already deteriorated.
- You play worse late at night.
- You lose differently when tired/tilted: not because openings suddenly become worse, but because you stop seeing short tactics.

The product should be able to answer at several levels simultaneously:

1. **What happens?** — e.g. high blunder rate.
2. **What chess mechanism causes it?** — e.g. hanging pieces, forks, mating threats, bad rook-endgame technique.
3. **When does it happen?** — e.g. under 20 seconds, after five games, after two losses, late at night, in 3+0.
4. **How important is it?** — frequency, severity, result impact, and confidence.
5. **What is the evidence?** — games, positions, moves, clocks, engine evaluations, and comparison baselines.

---

## 2. Product character: deep diagnosis, lightweight application

The product should be **lighter than Chess Repertoire Trainer** while going deeper on this one question.

Chess Repertoire Trainer is a broad chess-improvement platform with repertoire authoring, training, multiple providers, opening tools, progress, puzzles, mobile, and many other workflows. Why I Suck at Chess should not inherit breadth merely because code exists for it.

The initial product should be intentionally narrow:

- one authenticated application user;
- one connected Lichess identity per user;
- Lichess only;
- no anonymous account import;
- no Chess.com initially;
- no repertoire authoring;
- no training product initially;
- no mobile application initially;
- no attempt to become a general chess platform;
- no premature shared-library program.

The primary user journey should remain close to:

1. Sign in.
2. Connect Lichess.
3. Import trustworthy game data, including clocks.
4. Process/analyse enough games to obtain useful evidence.
5. Receive an increasingly detailed answer to **Why do I suck at chess?**
6. Drill into reasons, examples, comparisons, and board positions.

Everything else must justify itself against that loop.

---

## 3. Evidence before explanation

The application must be **evidence-driven**.

The authoritative chain should be:

```text
provider facts
  -> normalized game / ply facts
  -> indexed chess positions
  -> engine evidence
  -> deterministic / algorithmic detections
  -> cross-game aggregation and comparison
  -> conclusions with evidence strength
  -> optional AI interpretation
```

AI must not replace the lower layers.

### 3.1 Three different concepts must remain separate

#### Fact

Examples:

- game was 3+2;
- user had 11.4 seconds before a move;
- move lost 420 centipawns;
- a rook was undefended and capturable;
- Stockfish had mate in 4;
- game was the seventh game in a session;
- user had lost the previous two games.

#### Detection / inference

Examples:

- time scramble;
- played too fast;
- hanging-piece blunder;
- missed fork;
- failed to respond to mating threat;
- likely rook-endgame technique failure;
- measurable session deterioration.

#### Explanation

Examples:

- “Your biggest problem in 3+0 is not the opening. Your tactical error rate nearly doubles once you fall below 15 seconds.”
- “You perform normally in early-session games, but after consecutive losses you start moving faster and missing one- or two-move tactics.”

Facts and deterministic detections are authoritative. AI-generated prose is interpretation of those facts.

### 3.2 Avoid unsupported psychology

The application should not assert psychological states as facts.

Prefer:

> After two consecutive losses, your next-game blunder rate is substantially above your baseline and your average thinking time before major mistakes is lower.

over:

> You were angry and tilted.

“Likely tilt”, “session deterioration”, or similar wording is acceptable when backed by measurable behavioral changes and clearly presented as inference.

---

## 4. Reference architecture and stack

Chess Repertoire Trainer is the primary reference implementation. The new project should use the **same proven stack and engineering conventions wherever they still fit**, instead of experimenting with a new platform.

The expected starting shape is:

```text
apps/
  web/       Angular application
  api/       Fastify API + Prisma/PostgreSQL
              and persistent worker runtime
packages/
  chess-domain/   framework-neutral chess logic where useful
  contracts/      shared Zod HTTP wire contracts
```

Expected technology family:

- TypeScript;
- npm workspaces;
- Angular;
- Fastify;
- Prisma;
- PostgreSQL;
- Zod contracts;
- `chess.js` where appropriate;
- Chessground for board UI;
- Stockfish through the same backend engine abstraction/persistent-worker pattern used by Chess Repertoire Trainer;
- Clerk or the same application-authentication approach as the reference project unless later planning identifies a strong reason to change it;
- Lichess OAuth/PKCE and encrypted server-side token persistence based on the existing implementation.

There is no initial reason to bring across the Expo/mobile workspace.

---

## 5. Relationship to Chess Repertoire Trainer

This project is **not a fork**, but Chess Repertoire Trainer is the reference source for implementation patterns and selected code.

We should aggressively reuse knowledge and selectively duplicate/adapt code rather than reinventing solved infrastructure.

High-value reference areas include:

- application authentication;
- Lichess OAuth and encrypted token storage;
- Lichess account identity resolution;
- durable account import concepts;
- provider windowing/rate-limit/retry handling;
- imported-game persistence;
- game ply indexing;
- normalized position identity;
- position-analysis cache;
- Stockfish abstraction;
- whole-game analysis;
- move score-loss calculation;
- move classification;
- accuracy calculation;
- persistent jobs/workers;
- imported-game processing orchestration;
- deterministic tags / game-story concepts;
- Tactical Detections;
- Opening Struggles aggregation patterns;
- Player Chess Profile evidence-strength patterns;
- Chessground board components and game replay patterns;
- optional AI provider boundary and authoritative reconciliation philosophy;
- contracts, API conventions, architecture guardrails, tests, and CI procedures.

### 5.1 Reuse without premature library extraction

The two repositories are **not yet ready to depend on a common extracted library**, and this project should not spend major effort building one before product value is proven.

Some code duplication is therefore acceptable.

However, duplicated/adapted components must be designed so that future replacement by shared packages is practical.

The rule is:

> **Duplicate behind a seam, not throughout the application.**

Examples:

- Lichess import belongs behind a provider/import boundary rather than being called ad hoc from arbitrary features.
- engine access belongs behind an analysis boundary;
- position normalization belongs in one domain module;
- move classification belongs in one domain module;
- board rendering belongs behind one reusable Angular component;
- diagnostic detectors expose typed inputs/outputs rather than reaching directly across unrelated features;
- provider-specific fields are normalized at ingestion boundaries;
- persistence details should not leak into pure chess classifiers.

When copying substantial code from Chess Repertoire Trainer, preserve or improve its module boundary and record the reference source where useful. Avoid “clever” refactors whose only purpose is theoretical sharing.

If the new product succeeds and common abstractions stabilize, modules can later be replaced by libraries with limited application-level change.

---

## 6. Lichess identity and import invariants

Lichess is the only initial chess provider because it gives us the data required for deep diagnosis with a substantially simpler provider model.

### 6.1 Authentication

The user connects Lichess through OAuth/token-based authorization using the same overall procedure as Chess Repertoire Trainer.

Initial rule:

> One application user has one authoritative connected Lichess identity.

Unlike Chess Repertoire Trainer's broader account-import system, the initial product does not need multiple tracked chess accounts or multiple providers.

Anonymous public import is not the intended product path. The connected OAuth identity is the source of account identity and authenticated provider access.

### 6.2 Imported data must preserve diagnostic evidence

The import model must not throw away data that we will later need for diagnosis.

At minimum preserve:

- provider game ID and URL;
- start/end timestamps;
- rated/unrated;
- variant;
- speed category;
- exact time control;
- initial clock;
- increment;
- player identities;
- player ratings;
- user color;
- result and termination/status;
- opening metadata where supplied/derivable;
- complete moves/PGN needed for reconstruction;
- **per-ply clock values** when provided by Lichess.

### 6.3 Per-ply clocks are a first-class invariant

Chess Repertoire Trainer already recognizes Lichess's `clocks` payload at its provider type boundary but currently drops it before persistence. Its current `ImportedGamePly` model has no per-move clock storage, and its time-scramble tags are reserved/disabled for that reason.

Why I Suck at Chess must fix this from the start.

Per-ply clock information must survive:

```text
Lichess response
  -> provider parser
  -> normalized import game
  -> persisted game/ply model
  -> API/read models
  -> diagnostic calculations
  -> supporting evidence UI
```

No layer should require reparsing a historical provider payload merely to recover time information we already received.

Clock source precision and missing-data states should be preserved or represented explicitly.

---

## 7. Time controls are a diagnostic dimension, not metadata

Time control can itself explain performance differences.

The system must support analysis by more than broad speed labels.

Important dimensions include:

- broad pool: bullet / blitz / rapid / other supported standard controls;
- exact initial time;
- exact increment;
- increment present vs absent;
- increment size;
- exact normalized control such as `1+0`, `1+1`, `2+1`, `3+0`, `3+2`, `5+0`, `5+3`, `10+0`, `10+5`, etc.;
- nominal available time / equivalent-control groupings where useful;
- rated vs casual;
- performance conditional on user/opponent rating bands.

Examples of conclusions:

- You score 11 percentage points better with increment than without it in comparable blitz games.
- Your 3+2 performance is materially stronger than 3+0.
- Your raw 5+0 score looks better than 3+2, but the opponent pools are different; adjusted evidence is weak.
- In no-increment games you reach critical time far more often.
- Increment helps your result, but it does not reduce your early tactical error rate; its main effect is preventing late collapses.

### 7.1 Clock-behavior features

From per-ply clocks, the system should be able to derive features such as:

- remaining time before/after a move where reconstruction is reliable;
- approximate thinking time for the move;
- percentage of starting/effective time consumed;
- number of moves made below configurable remaining-time thresholds;
- when the player first entered time trouble;
- whether the player recovered through increment;
- average/median think time by phase;
- think time before inaccuracies, mistakes, blunders, and tactical misses;
- long-think blunders vs instant blunders;
- excessive early time usage;
- very fast play despite ample remaining time;
- opponent vs user clock pressure;
- mutual scramble;
- result/evaluation when flagging occurred;
- move-quality degradation as clock decreases.

Thinking-time reconstruction must account for increment correctly and must expose unknown/unreliable states rather than silently inventing precision.

### 7.2 Time should interact with other diagnoses

We care about interactions such as:

```text
time pressure x tactical blindness
time pressure x hanging pieces
time pressure x opening familiarity
time pressure x endgame technique
increment x late-game accuracy
session length x average move time
loss streak x instant-move frequency
opponent fast play x user's response speed
```

A key product goal is to identify whether a weakness is **general** or **conditional**.

“You miss forks” is useful.

“You miss forks mostly after your clock falls below 15 seconds, while your normal-time fork detection is fine” is much more useful.

---

## 8. Whole-game engine analysis

Whole-game analysis should follow the same fundamental model as Chess Repertoire Trainer:

- index every legal ply into reusable normalized positions;
- cache reusable position evaluations;
- use a backend Stockfish abstraction;
- execute expensive whole-game work through persistent workers;
- store per-ply game-specific score loss/classification separately from reusable position evaluation;
- batch persistence;
- persist analysis-run state and progress;
- make analysis recalculable/versionable;
- never make an LLM the source of engine truth.

The exact cost/depth strategy is a later planning decision.

The product should be capable of analysing all eligible games if economically reasonable. If full deep analysis of all historical games is too expensive, we should design explicit staged/coverage strategies rather than silently pretending partial analysis is complete.

Potential concepts for later planning include:

- cheap first-pass analysis;
- deeper analysis only for critical positions;
- cached-position reuse;
- prioritizing recent/relevant games;
- explicit analysis coverage in every conclusion.

No cost optimization should compromise the ability to distinguish “no problem detected” from “not enough positions analysed.”

### 8.1 Bullet must not inherit the reference project's exclusion blindly

Chess Repertoire Trainer's standard post-import analysis currently focuses on blitz and rapid. That restriction is inappropriate here.

Bullet may be especially diagnostically valuable because clock technique, premoving, speed-induced tactical blindness, and no-increment behavior can be major reasons for poor results.

If bullet requires a different analysis profile for cost or practical relevance, that profile should be explicit rather than excluding bullet from diagnosis.

---

## 9. Move quality is evidence, not the final diagnosis

The existing centipawn-loss classifier (best/good/inaccuracy/mistake/blunder etc.) is reusable and useful, but saying “you blunder too much” is not sufficient.

The new product needs a second layer answering:

> **What kind of error was it?**

A 400-centipawn loss can have very different causes:

- hanging a queen;
- overlooking a fork;
- missing an opponent mating threat;
- choosing the wrong rook-endgame plan;
- failing to recapture;
- overlooking a zwischenzug;
- allowing a passed pawn;
- playing an opening move repeatedly without understanding the position;
- flagging after obtaining a winning position.

Evaluation severity and chess mechanism must remain separate fields/concepts.

---

## 10. Tactical diagnosis

Chess Repertoire Trainer already has a valuable Tactical Detections mechanism for:

- missed shots after opponent mistakes;
- punished opponent blunders;
- user blunders.

Why I Suck at Chess should reuse that idea and go considerably further.

### 10.1 Offensive tactical vision

Classify tactical opportunities the user fails to see, ideally including motifs such as:

- hanging/loose piece capture;
- fork/double attack;
- pin;
- skewer;
- discovered attack;
- discovered check;
- double check;
- removal of defender;
- deflection;
- decoy;
- overload;
- interference;
- clearance;
- zwischenzug/intermezzo;
- trapped piece;
- promotion tactic;
- back-rank tactic;
- mating net;
- direct mate sequence;
- sacrifice leading to forced material/mate;
- other forcing capture/check/threat sequences.

The taxonomy does not have to be perfect on day one. It should be versioned and extensible.

### 10.2 Defensive tactical awareness

The application must also diagnose tactics that the **opponent is threatening or about to execute**.

This is distinct from missing your own tactic.

Examples:

- opponent threatens a fork and user ignores it;
- piece becomes loose and opponent captures it next move;
- mating threat is visible but not answered;
- back-rank weakness is exploited;
- defender becomes overloaded;
- user walks into a pin/skewer;
- user fails to create luft;
- user misses an obvious forcing check/capture sequence against their king.

We want answers such as:

> You are not primarily missing your own combinations. Your larger tactical problem is threat awareness: a high proportion of your major losses begin one move before the opponent's tactic, when you had a defensive move available.

### 10.3 Tactical difficulty / horizon

Where possible, distinguish tactical complexity:

- immediate one-move hanging material;
- one-ply/one-response threat;
- short 2–3 move forcing sequence;
- longer combination;
- forced mate;
- non-forcing engine tactic.

This allows conclusions such as:

> Your problem is not deep calculation. Most of your tactical losses are one-move loose-piece or fork oversights.

### 10.4 Algorithmic first

Tactical motif identification should be algorithmic/deterministic wherever practical, using:

- board geometry;
- attack/defense maps;
- legal moves;
- material before/after;
- engine best moves/PVs;
- checks/captures/threats;
- short move-sequence structure;
- resulting evaluation change.

AI may help describe ambiguous or multi-motif sequences but should not be required to decide that a queen was hanging or that a fork occurred when these can be computed.

---

## 11. Opening diagnosis

Opening analysis should reuse lessons from Chess Repertoire Trainer's imported-game/opening systems and Opening Struggles, without importing repertoire-management scope.

Questions include:

- Which openings correlate with poor results?
- Which repeated early moves lose significant evaluation?
- Which recurring positions become bad?
- Are problems side-specific?
- Are they exact openings, structures, or move-order issues?
- Does the user perform differently against common vs unusual replies?
- Does opening performance differ by time control?
- Does the user burn excessive time early in unfamiliar openings?
- Does the user move too quickly in familiar-looking but tactically different positions?
- Does the user perform worse when opponents play the opening very quickly?

### 11.1 Opponent “blitzing out moves”

Opponent move speed can be a contextual feature.

Potential questions:

- Does the user respond faster when the opponent responds instantly?
- Does user accuracy drop after sequences of fast opponent moves?
- Does the user leave known theory earlier in these games?
- Is the effect specific to certain openings?
- Is it merely correlated with stronger/opening-prepared opponents?

The product must compare evidence carefully rather than turning opponent speed into a causal claim without support.

---

## 12. Game phase and endgame diagnosis

The product should classify recurring problems by phase:

- opening;
- middlegame;
- transition/simplification;
- endgame;
- specific endgame families where reliably detectable.

Examples:

- frequent middlegame one-move collapses;
- slow positional deterioration;
- entering losing endgames from acceptable middlegames;
- throwing drawn endgames;
- failing to convert winning endgames;
- time-management failure concentrated in endgames.

### 12.1 Endgame families

Potential deterministic classifications include material-based families such as:

- rook endgames;
- queen endgames;
- minor-piece endgames;
- bishop vs knight structures;
- pawn endgames;
- rook + minor piece;
- opposite-colored bishops;
- same-colored bishops;
- major-piece-heavy simplified positions;
- other recognizable material classes.

Rook endgames are a particularly important target example.

The system should be able to establish facts such as:

- entry evaluation;
- material balance at entry;
- whether the position was theoretically/engine drawable or winning;
- where evaluation changed decisively;
- king activity;
- rook activity/passivity proxies;
- passed pawns;
- cut-off king / checking distance patterns where reliably computable;
- whether the player was already materially lost before “technique” becomes relevant;
- clock state during the endgame.

For nuanced explanations such as “passive rook placement made the defense impossible” or “being a pawn down was still holdable until the king was cut off,” algorithmic features and engine evidence should provide the facts; AI can help synthesize the explanation when deterministic wording would be brittle.

---

## 13. Conversion, saving, and game-story diagnosis

Existing Chess Repertoire Trainer tags contain useful game-story concepts that should inspire/reuse deterministic logic, including ideas such as:

- opening trouble/disaster;
- early mistake/blunder;
- one-move collapse;
- missed knockout;
- missed draw;
- middlegame turnaround;
- endgame throw/save;
- clean conversion;
- slow bleed;
- opponent blundered;
- punished opponent blunder;
- comeback;
- flagged while winning;
- opponent flagged in a winning/losing position;
- high-accuracy loss;
- chaotic game.

Why I Suck at Chess should treat these as **story/evaluation categories**, then connect them to deeper mechanism classifiers.

Example:

```text
story: ENDGAME_THROW
mechanism: ROOK_ENDGAME / PASSIVE_ROOK
context: 3+0 / 6.2 seconds remaining
session: game 9 / after 2 consecutive losses
severity: -0.2 -> -4.8
```

This composition is far more useful than one monolithic tag.

---

## 14. Session behavior, fatigue, and tilt

A core differentiator is that analysis must span games chronologically.

### 14.1 Playing sessions

Games should be grouped into sessions using a documented, versioned sessionization rule based primarily on time gaps. The exact threshold is a later decision and may eventually be configurable or empirically tuned.

Derived session context can include:

- session ID;
- game ordinal in session;
- session elapsed time;
- games in recent rolling windows;
- wins/draws/losses so far;
- consecutive wins/losses;
- cumulative rating change;
- time since previous game;
- previous game's result;
- previous game's severity/story (e.g. painful throw, flag, quick loss);
- local time of day;
- day of week;
- speed/time-control switching;
- current estimated performance degradation relative to personal baseline.

### 14.2 What “tilt” should mean in this product

Tilt is not merely “lost several games.”

We are interested in **measurable deterioration associated with session state**.

Potential evidence:

- increasing CPL/blunder rate by game ordinal;
- increasing tactical-miss rate;
- increasing defensive-threat misses;
- shorter think time before errors;
- more instant moves while ample time remains;
- earlier time trouble;
- worsening clock utilization;
- more hanging-piece blunders;
- worse conversion;
- changing resignation/flag patterns;
- worsening score after consecutive losses;
- significant deviation from the player's normal performance at the same time control/opponent level.

A strong conclusion may look like:

> In games 1–3 of a session your short-tactic miss rate is near baseline. From game 7 onward it is 80% higher, and the increase is strongest after consecutive losses. Your opening results do not materially change; your tactical awareness and move timing do.

That is much more useful than “stop tilting.”

### 14.3 “You play too many games”

The application should be able to identify a practical stopping point when evidence supports it.

Examples:

- performance falls after N games;
- quality falls after N minutes;
- deterioration appears only in bullet;
- deterioration appears after a loss streak rather than pure session length;
- no measurable deterioration exists, so the product should not invent one.

This should eventually support statements like:

> Your sessions longer than 45 minutes produce substantially worse chess. Most of the damage comes from tactical oversights, not openings or endgames.

---

## 15. Time of day and calendar context

Provider timestamps plus an explicit user IANA timezone allow local-time analysis.

Potential dimensions:

- morning / afternoon / evening / night;
- exact hour bands where sample size permits;
- weekday/weekend;
- long late-night sessions;
- interaction with time control and session length.

Avoid overfitting small samples. “You suck at 01:00” is not a valid conclusion from three games.

---

## 16. Opponent and rating context

Raw result rates can be misleading if opponent strength differs between groups.

Useful context includes:

- user rating at game time;
- opponent rating;
- rating difference;
- opponent rating bands;
- rated vs casual;
- speed/time-control pool;
- possibly opponent title/known bot state where relevant.

Where comparisons are used (increment vs no increment, morning vs night, early vs late session), the application should at minimum surface material differences in opponent strength/sample composition.

More sophisticated adjustment can be planned later, but the product must not imply that a raw score difference proves the context caused the difference.

---

## 17. Diagnostic evidence model

A future implementation should conceptually support a structured diagnostic record containing ideas like:

```text
reason
category
mechanism
scope/filter context
sample size
eligible sample size
analysis coverage
observed metric
baseline/comparison metric
effect size
severity/result impact
confidence/evidence grade
supporting games
supporting plies/positions
calculation/detector version
human-readable deterministic summary
optional AI interpretation
```

The exact schema comes later.

### 17.1 Evidence strength

Reuse the philosophy of Chess Repertoire Trainer's Player Chess Profile:

- always expose denominator/coverage;
- distinguish insufficient, low, medium, and high evidence;
- use higher evidence requirements for narrow claims;
- do not present statistical confidence language unless actual statistical methods justify it;
- do not treat “no detected issue” as evidence of strength when analysis coverage is poor.

A conclusion should answer:

- How many games support this?
- How many eligible games were examined?
- How many had engine analysis?
- How many had clock data?
- How large is the difference from baseline?
- Is this repeated or dominated by one outlier?

---

## 18. Ranking “why you suck” reasons

Eventually the product needs to prioritize findings rather than dump hundreds of metrics.

The ranking system should be deterministic and inspectable.

Candidate ranking dimensions include:

- frequency;
- average severity;
- estimated points/results affected;
- recurrence across time;
- recent relevance;
- evidence strength;
- specificity/actionability;
- conditional concentration (e.g. huge problem only in 3+0);
- uniqueness vs overlapping diagnoses.

Avoid double-counting one event through many labels.

For example, one move might be:

- a BLUNDER;
- a USER_BLUNDER tactical detection;
- a hanging queen;
- under time pressure;
- during late-session deterioration.

Those are useful dimensions of one event, not necessarily four independent top-level reasons.

The final product should be capable of composing them into a coherent finding.

---

## 19. Board and evidence presentation

Board visualization is central, not decoration.

Reuse/adapt the Chessground-based board and game replay patterns from Chess Repertoire Trainer.

Every important chess-specific conclusion should be able to link to representative evidence:

- game;
- move/ply;
- position;
- played move;
- best move/line where relevant;
- evaluation change;
- clock state;
- detected motif/mechanism;
- surrounding game/session context.

The user should be able to verify the diagnosis rather than trust a black-box label.

---

## 20. AI role

AI is allowed and likely useful, but its role is **interpretation**, not primary measurement.

Good AI use cases:

- synthesize several deterministic signals into understandable coaching prose;
- explain a rook-endgame failure using supplied material/king/rook/evaluation evidence;
- explain a mating attack using an authoritative engine line and board features;
- compare several representative examples;
- produce a concise “what this means” explanation;
- describe interaction between time pressure, session state, and tactical errors;
- translate structured evidence into human language.

Bad AI use cases:

- deciding the engine evaluation from scratch;
- inventing clock behavior;
- inventing opening names;
- declaring the user “tilted” without measured evidence;
- deciding that a piece was hanging when board geometry can prove it;
- silently assigning tactical motifs without provenance/confidence;
- making persistence/ranking decisions that deterministic code cannot reproduce.

The AI integration should follow the existing Chess Repertoire Trainer philosophy:

1. bounded authoritative context;
2. structured output schema;
3. server-side validation;
4. reconcile referenced moves/plies/facts against authoritative state;
5. fail safely to deterministic evidence;
6. keep AI isolated from Stockfish execution and core writes;
7. no provider keys/prompts/raw provider payloads in the browser.

AI should be optional enough that the core product remains diagnostically useful without it.

---

## 21. Processing architecture

The product will likely need a pipeline similar to:

```text
Lichess connect
  -> durable import
  -> persist game + clocks
  -> index plies/positions
  -> opening assignment
  -> Stockfish analysis
  -> basic move classification
  -> game-story detections
  -> tactical/mechanism detections
  -> endgame/phase detections
  -> clock/time-management features
  -> sessionization
  -> cross-game aggregates
  -> diagnostic findings
  -> optional AI explanation
```

Stages should be independently rerunnable/versionable where practical.

A new detector version should not require reimporting provider games. A new prose prompt should not require rerunning Stockfish. A sessionization-rule change should not mutate raw provider facts.

---

## 22. Performance and boundedness

Deep analysis can become expensive. Design should preserve the performance discipline of Chess Repertoire Trainer:

- aggregate in PostgreSQL where appropriate;
- never load unbounded game corpora into Node just to count/group them;
- bound queries that genuinely require in-memory chess reconstruction;
- cache reusable position analysis;
- use persistent worker jobs for expensive work;
- expose progress and failures;
- use explicit scope/coverage limits instead of silent truncation when truncation would make conclusions misleading;
- separate compact list projections from rich game/evidence details.

The product can be lightweight in feature breadth while still being rigorous in data processing.

---

## 23. Modularity doctrine

Everything should be **as modular as practical**.

The reason is both normal maintainability and the possibility that Chess Repertoire Trainer and Why I Suck at Chess eventually share libraries or even partially converge.

### 23.1 Desired module qualities

A module should preferably have:

- one clear owner/purpose;
- typed boundaries;
- limited infrastructure dependencies;
- independently testable domain logic;
- explicit version/threshold configuration for heuristic detectors;
- no cross-feature deep imports;
- provider normalization at the edge;
- DB access behind repositories/services rather than embedded across algorithms.

### 23.2 Future-replaceable duplicated modules

We accept temporary duplication between repositories, but likely duplicated areas should be shaped so future extraction/replacement is straightforward:

- chess position normalization;
- move classification;
- accuracy calculation;
- Stockfish engine interface;
- position-analysis shapes;
- Lichess OAuth utilities;
- Lichess game-export parser;
- import windowing/retry logic;
- game indexing;
- tactical detection primitives;
- Chessground board wrapper;
- AI provider client / reconciliation helpers;
- selected HTTP contracts where products genuinely converge.

Do **not** create a shared package merely because two files look similar. Extract only when both applications have proven the abstraction.

---

## 24. Development operating model

The implementation process should reuse and strengthen the disciplined workflow already used in Chess Repertoire Trainer.

Before major coding begins, perform an extensive planning phase that defines:

- product capabilities;
- diagnostic taxonomy;
- architecture boundaries;
- data model;
- detector responsibilities;
- dependencies between features;
- acceptance criteria;
- validation strategy.

After planning is accepted:

```text
accepted feature definition
  -> GitHub issue
  -> short-lived task branch
  -> implementation PR
  -> independent review pass
  -> CI / automated tests
  -> integration / functional acceptance
  -> squash merge
```

### 24.1 Parallelization

The program should be structured for agentic parallel work.

Features that do not share an unstable contract should be implementable concurrently. Up-front architecture should intentionally create safe seams for parallelization.

Examples of potentially parallel lanes after foundations exist:

- clock/time-control diagnostics;
- tactical motif classification;
- opening diagnostics;
- session/tilt analytics;
- endgame classification;
- report UI/evidence presentation;
- AI explanation layer.

This is illustrative only, not the current task plan.

### 24.2 Separate implementation and review

Where practical, the engine/agent that reviews a PR should not simply be the same execution context that authored it.

Review should verify:

- architecture boundaries;
- correctness;
- data semantics;
- edge cases;
- SQL boundedness;
- evidence/denominator correctness;
- tests;
- documentation;
- no unsupported causal claims;
- compatibility with parallel work.

Functional/integration testing may be another distinct pass.

### 24.3 Branch policy

The desired normal policy is consistent with Chess Repertoire Trainer:

- do not implement meaningful feature work directly on `main`;
- short-lived task branches;
- one meaningful concern per PR;
- update from current `main` before final review when parallel integration has moved the base;
- squash merge;
- do not merge without the intended review/acceptance gate.

Repository-bootstrap/documentation actions may be performed directly when explicitly requested by the repository owner, as with the initial creation of this Bible.

---

## 25. Testing philosophy

Tests must protect meaning, not just endpoints.

Important future test families include:

- provider parsing fixtures including clocks;
- clock reconstruction with increment;
- missing/incomplete clock data;
- position indexing/reconstruction;
- score-loss and classification regression;
- deterministic tactical motif fixtures;
- threat-awareness fixtures;
- endgame-family classification;
- sessionization boundaries;
- tilt/session-deterioration aggregation;
- increment vs no-increment comparison denominators;
- opponent-strength/context grouping;
- evidence-strength rules;
- overlapping-diagnosis deduplication;
- AI fact-reference reconciliation;
- API contracts;
- database integration tests;
- worker cancellation/retry/idempotence;
- UI evidence navigation;
- CI architecture/hygiene checks.

Synthetic fixtures should be complemented by curated real-game fixtures when licensing/privacy permits.

---

## 26. What we deliberately are not deciding yet

This Bible preserves direction without prematurely locking implementation detail.

Open for the planning phase:

- exact database schema;
- exact copied-vs-reimplemented source files;
- whether the monorepo starts with `packages/chess-domain` immediately or a smaller package set;
- exact application authentication setup/configuration;
- exact Lichess OAuth scopes;
- first-import historical range;
- continuous refresh policy;
- engine depth/MultiPV profiles by speed;
- whether all historical games receive full analysis immediately;
- exact session-gap threshold;
- exact time-trouble thresholds;
- exact evidence-grade thresholds;
- statistical adjustment methods for opponent pool differences;
- exact tactical taxonomy v1;
- exact endgame taxonomy v1;
- exact diagnostic-ranking formula;
- exact AI provider/model;
- hosting/deployment choices;
- monetization;
- whether/how the two chess projects eventually share packages or merge capabilities.

These should become explicit decisions during planning, not accidental implementation facts.

---

## 27. Reference-project deltas already identified

The following are known differences from Chess Repertoire Trainer and must not be lost during later copying/reuse.

### 27.1 Accounts/providers

**Reference:** multiple Lichess/Chess.com tracked accounts.  
**This project:** one connected Lichess identity initially.

### 27.2 Anonymous import

**Reference:** Lichess durable import can continue through public/anonymous export if the optional credential is unavailable.  
**This project:** token-connected Lichess identity is the intended authoritative product path.

### 27.3 Clocks

**Reference:** provider type can see `clocks`, normalized/persisted model drops them, per-ply schema lacks clocks.  
**This project:** per-ply clocks are mandatory diagnostic evidence where Lichess provides them.

### 27.4 Time tags

**Reference:** `TIME_SCRAMBLE`, `MUTUAL_TIME_SCRAMBLE`, and `PLAYED_TOO_FAST` are reserved because move clocks are unavailable downstream.  
**This project:** implement the data foundation required to make these and richer clock diagnostics real.

### 27.5 Bullet analysis

**Reference:** standard whole-game workflow currently focuses on blitz and rapid.  
**This project:** bullet is diagnostically important and should have an explicit supported analysis strategy.

### 27.6 Tactical depth

**Reference:** excellent evaluation-based Tactical Detections, but motifs are not the primary persisted classification.  
**This project:** add mechanism-level tactical and defensive-threat taxonomy.

### 27.7 Session analysis

**Reference:** primarily game/account/opening/player-profile aggregates.  
**This project:** chronological session state, deterioration, loss streaks, fatigue/tilt evidence, and time-of-day are core.

### 27.8 Product breadth

**Reference:** repertoire/training/openings/progress/tools/mobile ecosystem.  
**This project:** diagnosis-first and intentionally lighter.

---

## 28. North-star quality bar for an answer

A good final diagnosis is not:

> You made 37 blunders.

It is closer to:

> **Your largest measurable problem is late-clock tactical blindness in no-increment blitz.** Across 86 analysed 3+0 games with complete clocks, your major tactical-error rate below 15 seconds is 2.1× your rate above 30 seconds. Most of those errors are short: hanging pieces, forks, and immediate threats rather than deep combinations. You reach this clock zone unusually early because you spend more time than your own baseline during moves 8–18. In 3+2, the same late-game collapse is much smaller.
>
> **Your second problem is session deterioration.** In sessions of 7+ games, your opening evaluation is stable, but from game 6 onward you move faster and miss significantly more opponent tactical threats. The effect is strongest after consecutive losses.
>
> **Your third problem is rook endgames.** You reach roughly equal rook endings often enough, but your score and evaluation conversion are substantially below your own other endgame families. Representative games show recurring passive-rook and king-activity problems.

Every important statement should be drillable into:

- sample/coverage;
- comparison baseline;
- representative games;
- board positions;
- moves/evaluations;
- clocks;
- detector/calculation semantics;
- confidence/evidence strength.

That is the standard the rest of the architecture should serve.

---

## 29. Canonical principle

The project should continuously prefer:

> **observable chess behavior + reproducible algorithms + explicit evidence + careful interpretation**

rather than:

> **generic coaching prose + opaque AI judgments + isolated engine blunder counts**.

The product's personality can be playful and blunt because of its name. Its analysis must remain rigorous.
