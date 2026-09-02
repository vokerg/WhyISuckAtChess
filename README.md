# Why I Suck at Chess

A lightweight, evidence-driven chess diagnosis product built to answer one question in depth:

> **Why do I suck at chess?**

## Project sources of truth

- [BIBLE.md](BIBLE.md) — canonical product intent, diagnostic philosophy, architecture principles, scope, and engineering invariants.
- [PLAN.md](PLAN.md) — high-level project phases, phase exit criteria, dependencies, parallelism, PR/review model, and agentic delivery process.

The existing [`vokerg/chess_repertoir_trainer`](https://github.com/vokerg/chess_repertoir_trainer) project is the primary reference implementation for stack, authentication, Lichess integration, imported-game processing, Stockfish analysis, chess UI, and engineering procedures; this project is not intended to be a fork of it.

Implementation should follow the planning hierarchy documented in the Bible and plan rather than relying on chat history. Detailed architecture, diagnostic specifications, dependency graphs, GitHub issues, and PR boundaries will be added during the planning phase before broad implementation begins.
