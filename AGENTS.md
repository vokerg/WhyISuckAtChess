# Repository agent instructions

`WhyISuckAtChess` is an evidence-driven chess diagnosis product whose primary question is: **Why do I suck at chess?**

This file is the operational entry point for any coding, planning, review, or integration agent working in this repository.

Before doing anything else, read:

1. [`AGENTS.md`](AGENTS.md) — operating rules and task lifecycle.
2. [`BIBLE.md`](BIBLE.md) — product intent and non-negotiable invariants.
3. [`PLAN.md`](PLAN.md) — high-level phases and execution model.
4. The GitHub issue and any linked issues/PRs for the task being considered.

The reference implementation is [`vokerg/chess_repertoir_trainer`](https://github.com/vokerg/chess_repertoir_trainer), referred to below as **CRT**.

---

## 1. Core operating principle: reference first, delta second

This project is **not** a greenfield chess platform and is **not** a fork of CRT.

CRT already contains many of the required building blocks. Before starting feature development, architecture work, or a substantial refactor, an agent must inspect the corresponding CRT implementation first.

The default rule is:

> **If CRT already has a working building block, copy/adapt its implementation and operating pattern before inventing a replacement.**

For every feature or subsystem that has a CRT analogue, explicitly determine:

- **Reference:** the CRT files/modules/services/docs/tests that define the current behavior.
- **Preserve:** behavior and patterns that should remain equivalent.
- **Change:** product-specific deltas required by Why I Suck at Chess.
- **Omit:** CRT capabilities that do not belong in this narrower product.
- **Future seam:** the module/interface boundary that would allow duplicated code in both repositories to be replaced later by a shared library.

Do not start implementation until this delta is understood. The issue or PR description should record it when material.

CRT is the source of truth for the **baseline implementation pattern** of reused capabilities. `BIBLE.md`, `PLAN.md`, accepted Why I Suck at Chess documentation, and the active issue are the source of truth for **intentional differences**.

Examples of expected reuse/adaptation include authentication, Lichess OAuth, import/job patterns, Prisma repository patterns, Stockfish analysis, position caching, tactical detections, opening analysis, Chessground UI, contracts, testing conventions, and CI discipline.

Examples of known Why I Suck at Chess deltas include clock-complete Lichess ingestion, per-ply timing persistence, bullet analysis, exact time-control/increment analysis, opponent move-speed analysis, tactical motif classification, threat blindness, richer endgame diagnosis, sessions/tilt-consistent deterioration, and the unified diagnosis engine.

---

## 2. Do not build shared libraries prematurely

Some code will intentionally be duplicated/adapted from CRT during the early life of this project.

That is acceptable.

Do **not** create a cross-repository shared-library program merely to avoid duplication unless the user explicitly chooses to invest in that work later.

However, duplicated capabilities must remain modular:

- keep provider integration behind provider/application boundaries;
- keep chess-domain logic framework-neutral where practical;
- avoid deep cross-feature imports;
- use explicit contracts between modules;
- isolate persistence from transport and UI concerns;
- avoid application-specific assumptions in code that is likely to become a future shared package.

The goal is pragmatic duplication today with inexpensive library replacement tomorrow.

---

## 3. Data fidelity is a product invariant

This product diagnoses behavior from source evidence. Do not discard source data that may matter diagnostically.

In particular, preserve end-to-end where available:

- per-ply clock values;
- exact time control, initial time, and increment;
- timestamps;
- player colors and identities;
- ratings and opponent strength;
- result/status;
- moves and normalized positions;
- opening metadata;
- engine evidence and analysis provenance.

Derived features must not replace authoritative source values. Store/retain the source evidence and derive from it.

For Lichess import, clock data is not optional decoration. It is a first-class input to the product.

---

## 4. Deterministic evidence before AI

Deterministic algorithms, chess rules/geometry, imported source facts, and engine analysis establish authoritative evidence.

AI may explain, summarize, prioritize language, or help describe semantically ambiguous chess situations only from bounded evidence supplied by the application.

AI must not become the authority for whether a blunder occurred, whether a tactic existed, whether a clock event happened, or whether the user was psychologically tilted.

Prefer wording such as **session deterioration** or **evidence consistent with tilt** when the evidence is behavioral/correlational.

---

## 5. Task-selection loop

An agent beginning work must first inspect the current repository state, open issues, and open PRs. Do not blindly start the first feature named in a prompt if another agent is already changing the same surface.

Every active work session should enter one of two modes:

### A. Execute an issue

Pick an open, unblocked issue whose dependencies are satisfied and that does not already have conflicting active work.

Before coding:

1. Read the issue completely, including dependencies and acceptance criteria.
2. Inspect linked/open PRs and recent changes touching the same subsystem.
3. Inspect the corresponding CRT implementation and tests.
4. Record/confirm the **Reference / Preserve / Change / Omit / Future seam** delta.
5. Refresh from current `main` and create a short-lived task branch.

During implementation:

- stay within the issue scope;
- update tests with behavior;
- update canonical documentation with architecture or behavior changes;
- report newly discovered dependencies or contradictions rather than silently broadening scope;
- keep the feature modular and future-library-replaceable.

The result of meaningful implementation work must be a pull request. Do not leave completed work only on a branch.

### B. Review or complete a pull request

If implementation work is not the right next action, pick an open PR that needs review, requested-change completion, integration verification, or merge completion.

A review agent should, where practical, be independent from the implementation context.

A review must evaluate:

- issue acceptance criteria;
- correctness of the CRT reference/delta;
- product invariants in `BIBLE.md`;
- module boundaries and unnecessary reinvention;
- tests and failure cases;
- data fidelity;
- documentation changes;
- migrations/contracts/API compatibility where applicable;
- concurrency/integration effects with other open PRs.

Do not approve a PR merely because CI is green. CI is a gate, not a substitute for review.

If changes are required, leave concrete review feedback or, when explicitly operating in completion mode, make the required fixes on the PR branch and re-run validation.

---

## 6. Branch, PR, review, and merge policy

- Create work from current `main`.
- Do not implement meaningful changes directly on `main` unless the user explicitly requests an exception.
- Use a short-lived task branch for each coherent issue/change.
- One meaningful task should normally map to one PR.
- Keep PRs small enough to review independently when dependency boundaries permit.
- Link the PR to its GitHub issue and describe the CRT reference and intentional delta.
- Refresh/reconcile with current `main` before final review when concurrent work has moved the base materially.
- Do not merge with unresolved review findings or failing required validation.
- **Always squash-merge into `main`.** Never use merge commits or rebase merges.
- After a successful squash merge, verify the linked issue is closed/completed when appropriate and that dependent issues/PRs can now advance.
- Delete/retire obsolete task branches when the platform/workflow supports it.

A PR lifecycle should end in one of three explicit states:

1. **Squash-merged** — accepted and integrated.
2. **Changes requested / active completion** — concrete next work is recorded.
3. **Closed without merge** — superseded, invalid, or intentionally abandoned with a reason.

Do not allow PRs to become undocumented limbo.

---

## 7. Parallelism rules

Parallelism is encouraged only when dependency boundaries are real.

Before opening parallel implementation streams:

- identify shared contracts and migrations;
- stabilize or sequence the shared dependency first;
- ensure two agents are not independently redesigning the same module;
- make issue dependencies explicit;
- prefer parallel work across modules with stable interfaces.

Typical safe parallelism may include UI adaptation, a bounded diagnostic classifier, documentation/specification, and an independent infrastructure component after their interfaces are settled.

Typical unsafe parallelism includes multiple agents changing the same schema, import contract, analysis pipeline contract, or shared domain representation without an agreed base change.

After a wave of parallel PRs is merged, perform an explicit integration/acceptance pass. Individually green PRs do not prove that the combined system works.

---

## 8. Documentation is part of completion

Documentation is not optional cleanup.

Agents must keep repository documentation synchronized with accepted decisions and implemented behavior.

Use the documentation hierarchy deliberately:

- `BIBLE.md` — durable product philosophy and invariants.
- `PLAN.md` — high-level project phases and delivery model.
- `AGENTS.md` — stable operating rules for agents.
- future `docs/*` specifications — detailed architecture, diagnostic contracts, data models, algorithms, and integration behavior.
- GitHub issues — live scoped work, dependencies, acceptance criteria, and execution state.
- PR descriptions/reviews — implementation delta, validation, and review evidence.

When code changes a documented architecture or invariant, update the canonical document in the **same PR**.

When planning discovers a durable decision, commit it to the appropriate repository document rather than leaving it only in chat or an issue thread.

Do not duplicate the same specification across many documents. Link to the canonical source instead.

---

## 9. Issue quality requirements

Implementation issues should be executable by an agent without rediscovering the entire product direction.

Where applicable, include:

- objective;
- dependencies/blockers;
- CRT reference implementation;
- preserve/change/omit delta;
- expected module boundaries;
- source-data requirements;
- acceptance criteria;
- required tests/validation;
- documentation that must be updated;
- explicit non-goals.

Planning issues should produce committed specifications or concrete follow-up issues, not merely discussion.

If an issue lacks enough information to execute safely, improve the issue/specification before starting broad implementation.

---

## 10. Validation and reporting

As the repository implementation takes shape, preserve the same validation discipline used by CRT: build, tests, lint, architecture/hygiene checks, migration validation, and focused workspace checks where applicable.

Until scripts exist in this repository, use the nearest relevant CRT validation behavior as the reference and document what is not yet available.

Every PR should state:

- what validation ran;
- what was skipped and why;
- known warnings or residual risk;
- documentation updated;
- relevant CRT reference/delta.

Do not claim validation that was not executed.

---

## 11. Completion standard

A feature is not complete merely because code exists.

Completion means:

1. the issue acceptance criteria are satisfied;
2. implementation and tests are present;
3. required documentation is current;
4. the PR has been independently reviewed where practical;
5. required CI/validation is green;
6. integration implications are addressed;
7. the PR is **squash-merged**;
8. issue and dependency state is updated.

The repository, not chat history, must contain enough context for the next agent to continue correctly.