# Why I Suck at Chess

A lightweight, evidence-driven chess diagnosis product built to answer one question in depth:

> **Why do I suck at chess?**

## Project sources of truth

- [AGENTS.md](AGENTS.md) — operational entry point for agents: task selection, CRT-first development, PR review/completion, squash-only merges, validation, and documentation duties.
- [BIBLE.md](BIBLE.md) — canonical product intent, diagnostic philosophy, architecture principles, scope, and engineering invariants.
- [PLAN.md](PLAN.md) — high-level project phases, phase exit criteria, dependencies, parallelism, PR/review model, and agentic delivery process.
- [CRT-to-Why delta map](docs/crt-delta-map.md) — Phase 1 reference inventory and intentional preserve/change/omit seams for issue #2.

The existing [`vokerg/chess_repertoir_trainer`](https://github.com/vokerg/chess_repertoir_trainer) project is the primary reference implementation for stack, authentication, Lichess integration, imported-game processing, Stockfish analysis, chess UI, and engineering procedures; this project is not intended to be a fork of it.

Before meaningful feature work, agents must inspect the corresponding Chess Repertoire Trainer implementation and define the intentional delta. Implementation should follow the repository sources of truth and GitHub issue/PR state rather than relying on chat history.
