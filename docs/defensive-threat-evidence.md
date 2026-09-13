# Defensive threat and mating evidence

**Status:** Phase 3 implementation policy  
**Scope:** issue #31  
**Detector:** `defensive-threat@defensive-threat-v1`

## Purpose

This detector distinguishes a materially bad defensive move from a concrete tactical mechanism. It emits inspectable per-game evidence for removal of a defender, overloaded defenders, back-rank mating mechanisms, missed forced mates, and conservative threat-blindness sequences.

It does not infer attention, psychology, intent, or cross-game diagnosis. Those remain later aggregation/explanation concerns.

Framework-neutral board primitives live in `packages/chess-domain/src/defensive-tactics.ts`. The worker-owned detector consumes only the existing current evidence snapshot and cached Stockfish output.

## CRT reference / delta

The reference remains CRT commit `13a7e2791944ebd52113afe9f76413b10634ddff`, especially the tactical-detection service/policy/persistence material catalogued in `docs/crt-delta-map.md` section 9.

**Preserve:** deterministic rescanning of cached analysis, explicit detector versions, exact trigger/reply plies, user-perspective score loss, bounded findings, and replayable source positions.

**Change:** promote the one-move-before defensive sequence into typed mechanism evidence, reuse the Phase 3 tactical geometry seam, and represent missing MultiPV/analysis as coverage gaps rather than negative findings.

**Omit:** training side effects, narrative explanations, generalized tactical search, human-intent claims, and cross-game ranking.

**Future seam:** the legal-move/defender/back-rank primitives are framework-neutral and can move to a shared chess-analysis package without changing evidence persistence or consumers.

## Board primitives

The v1 domain layer provides:

- `inspectLegalUciMove(fen, uci)` — verifies an exact legal move and reports capture/check/checkmate facts.
- `detectDefenderRemovalCreatedByMove(fen, uci)` — requires a legal capture of a piece that concretely defended another attacked friendly piece; the target must remain attacked and lose that defender after the move.
- `detectOverloadedDefenders(fen, color)` — identifies a single non-king defender simultaneously defending at least two friendly pieces that are currently attacked.
- `detectBackRankMateByMove(fen, uci)` — requires an actual legal rook/queen checkmate against a king on its home rank, with the mating piece delivering the back-rank attack.

These are board facts. They do not become user-error evidence until the engine consequence policy below is satisfied.

## Consequence and threat policy

The detector requires the current complete analysis snapshot and a calibration-sensitive minimum user score loss of **80 cp** for defensive-threat findings.

A `THREAT_BLINDNESS` event requires all of the following:

1. an immediately preceding opponent move;
2. a legal engine-backed defensive alternative for the user's response position;
3. MultiPV evidence containing that defensive move;
4. a materially worse played response;
5. a legal opponent best reply after the response; and
6. at least one concrete mechanism that the reply exploits.

The supported mechanisms are:

- removal of a defender where the reply captures the affected target;
- a newly created overloaded defender where the reply captures an overloaded target;
- a core fork/pin/skewer/discovered-attack motif created by the opponent move and directly exploited by the reply;
- a legal back-rank mating reply;
- a mating transition where the opponent did not have a forced mate before the response but does after the response (or has an immediate mating reply).

This deliberately does **not** label every engine blunder after an opponent move as threat blindness.

The evidence records both the creating opponent ply and the user's response ply, plus the defensive move/PV and exploiting reply.

## Mating evidence

When the user starts a move with a favorable engine mate score, the engine best move is legal, the user chooses another move, and the favorable mate disappears, the detector emits:

- `MISSED_FORCED_MATE`; or
- `MISSED_BACK_RANK_MATE` when the missed best move itself is a verified back-rank mate.

The payload preserves before/after mate scores, the engine best PV/MultiPV line, the played move, and whether the best move mates immediately.

A mate score is severity/forcing evidence, not a claim about what the player saw.

## Coverage and boundedness

The detector is capped below the evidence substrate's global finding limit. It publishes explicit `DEFENSIVE_THREAT_COVERAGE_GAP` evidence when required board facts, current analysis provenance, or MultiPV defensive alternatives are missing.

A missing MultiPV line is therefore not treated as proof that no defensive resource existed. Likewise, incomplete engine coverage cannot become a false negative mating/threat result.

Bullet remains eligible under exactly the same standard-chess policy as blitz and rapid.

## False-positive discipline

The v1 fixtures cover:

- a quiet opponent move followed by a missed defensive alternative and an actual back-rank mate;
- the same rook check with an escape square, which is not classified as back-rank mate/threat blindness;
- concrete defender removal tied to the later engine capture of the affected target;
- a newly created overload tied to the later engine capture of an overloaded target;
- a favorable-mate to no-mate transition;
- defender-removal geometry with insignificant score loss, which is not promoted into a severe finding;
- missing MultiPV defensive alternatives, which produce incomplete coverage rather than `no finding`.

Equivalent high-level threat-blindness evidence is emitted once per creating-opponent-ply/user-response pair even when more than one concrete mechanism supports the same event.
