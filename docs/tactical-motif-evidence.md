# Tactical motif evidence

**Status:** Phase 3 implementation policy  
**Scope:** issue #30  
**Detector:** `tactical-motif@tactical-motif-v1`

## Purpose

This detector turns board geometry plus current Stockfish evidence into inspectable mechanism evidence for forks, absolute pins, skewers, and discovered attacks. It does not diagnose a player across games, infer intent/attention, generate prose, or create training content.

Framework-neutral geometry lives in `packages/chess-domain/src/tactics.ts`. The worker-owned detector lives behind the existing deterministic-evidence boundary in `apps/api/src/modules/evidence`.

## CRT reference / delta

The reference remains CRT commit `13a7e2791944ebd52113afe9f76413b10634ddff`, especially:

- `docs/tactical-detections.md`;
- `tactical-detection.service.ts`;
- `tactical-detection-policy.ts`;
- the tactical-detection persistence/tests listed in `docs/crt-delta-map.md` section 9.

**Preserve:** deterministic processing over already indexed/analyzed games, explicit policy/version identity, user-perspective score-loss evidence, bounded worker execution, and exact before/after replay references.

**Change:** CRT's missed-shot / punished-blunder / user-blunder buckets become richer chess-mechanism evidence. Geometry classification is isolated in the chess-domain package and the API detector binds it to the current evidence snapshot.

**Omit:** Lab UI/reporting, scenario training, diagnosis aggregation, psychology, and AI explanation.

**Future seam:** the pure geometry API plus `EvidenceDetector` input/output can move into a shared chess-analysis library later without changing persistence or consumers.

## Geometry contract

`detectTacticalMotifs(fen, color)` returns canonical current-position geometry:

- **FORK** — one attacker currently attacks at least two enemy pieces; all targets are grouped into one event per attacker instead of pairwise duplicates.
- **PIN** — an enemy non-king piece is the first blocker between a bishop/rook/queen ray and its own king (absolute pin).
- **SKEWER** — the first enemy target on a sliding ray is materially more valuable than the enemy target behind it; king value is treated as dominant for geometry ordering.
- **DISCOVERED_ATTACK** — move-dependent evidence where a legal move vacates a ray and reveals a previously blocked bishop/rook/queen attack on an enemy piece or king.

`detectTacticalMotifsCreatedByMove(fen, uci)` applies one legal move, diffs canonical static motifs, adds discovered-attack evidence, and deduplicates equivalent representations.

These are geometry facts only. A fork-shaped position is not by itself persisted as a severe user error.

## Consequence policy

The v1 detector requires complete current Stockfish analysis and uses a calibration-sensitive minimum played-move score loss of **80 cp**. Changing this threshold or the lifecycle semantics requires a detector-version bump.

For a materially bad user move, the detector can publish:

- `MISSED_TACTICAL_MOTIF / EXISTING` when the position already contains a motif and the engine best move directly exploits one of its targets;
- `MISSED_TACTICAL_MOTIF / CREATED_BY_BEST_MOVE` when the engine best move creates a fork, pin, skewer, or discovered attack that the played move missed;
- `ALLOWED_TACTICAL_MOTIF / NEWLY_ALLOWED` when the played move creates new opponent geometry and the engine best reply directly exploits a motif target;
- `OPPONENT_TACTICAL_MOTIF / CREATED_BY_BEST_REPLY` when the opponent's engine best reply itself creates one of the supported mechanisms.

This is deliberately conservative. Engine score loss establishes practical consequence; geometry establishes the human-readable mechanism. Neither substitutes for the other.

Issue #31 may consume these primitives for defensive-threat evidence, but #30 does not label a user as threat-blind or infer why the move was missed.

## Evidence payload

Every finding carries:

- source user ply and the persisted before/after position IDs;
- played move and relevant engine best move/reply;
- motif type and lifecycle state;
- attacker square/piece;
- target squares/pieces and material values;
- line squares for pins/skewers where available;
- revealing move for discovered attacks;
- score loss plus before/after score/mate measurements;
- detector threshold/version through the run/payload policy.

The evidence substrate binds the run to the exact `plyIndexedAt` and complete analysis snapshot, so stale analysis cannot remain current evidence.

## Coverage and boundedness

The detector is capped below the substrate's 256-finding limit. Missing board facts, mismatched engine provenance, missing score loss, or missing required position analysis produce explicit incomplete/unavailable coverage rather than a negative finding.

Bullet is eligible under the same rules as every other supported standard game. No speed-category exclusion exists in the detector.

## False-positive discipline

The fixtures intentionally cover geometry lookalikes:

- one attacked target is not a fork;
- a piece lined up with a non-king back target is not an absolute pin;
- a lower-value front target shielding a higher-value rear target is not a skewer;
- moving a blocker along the same ray is not a discovered attack;
- geometry with insignificant engine score loss is not promoted into severe tactical evidence.

One event may legitimately have different motif types, but equivalent representations of the same type/attacker/targets are deduplicated.
