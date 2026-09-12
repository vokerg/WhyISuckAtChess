# Phase and endgame evidence

**Status:** Phase 3 deterministic evidence policy  
**Scope:** issue #29  
**Classifier / detector:** `phase-v1`, `phase-context@phase-v1`  
**Depends on:** `docs/deterministic-evidence.md` and indexed normalized positions

## Purpose

This feature provides reusable board-derived phase context for later tactical, conversion, opening, and diagnosis work. It is evidence only: it does not claim that the player is weak in a phase or endgame family.

Each indexed position is classified from reconstructed board state. Opening metadata, move number, engine score, clocks, result, and AI output are deliberately excluded from the classifier.

## CRT reference and intentional delta

The pinned Chess Repertoire Trainer reference (`vokerg/chess_repertoir_trainer` at `13a7e2791944ebd52113afe9f76413b10634ddff`) uses fixed move-number windows in imported-game tagging: opening moves 1-10, middlegame moves 11-35, and endgame from move 36 (with a separate late-endgame throw window from move 30).

Why preserves CRT's deterministic/versioned-policy discipline but changes the phase definition because issue #29 requires phase to come from board state rather than chronology or opening metadata. The classifier lives in `@why-i-suck-at-chess/chess-domain`; the API detector only projects those facts onto the evidence substrate. No CRT story tags, outcome coupling, engine thresholds, or subjective endgame-technique labels are copied.

Future consumers should depend on the classifier/evidence contract rather than duplicating the thresholds in tactical, conversion, API, or UI code.

## Phase policy (`phase-v1`)

The structural classifier uses a conventional non-pawn phase-unit measurement:

- knight = 1 phase unit;
- bishop = 1 phase unit;
- rook = 2 phase units;
- queen = 4 phase units;
- pawns and kings do not contribute phase units.

The initial position therefore has 24 phase units.

Classification order is deterministic:

1. **Endgame candidate** when either there are at most 6 total queens/rooks/bishops/knights on the board, or there are no queens and at most 10 phase units remain.
2. Otherwise **opening candidate** when at least 20 phase units remain, at least 12 pawns remain, and at least 5 of the original knights/bishops/queens are still on their home squares.
3. Otherwise **middlegame**.

The opening rule is intentionally structural. A long sequence that returns to an opening-like board is still normalized by the game-sequence rule below rather than by move number.

### Stable transition rule

Per-game evidence is monotonic: `OPENING -> MIDDLEGAME -> ENDGAME`. Once a game has entered middlegame it cannot become opening again, and once it has entered endgame it cannot become middlegame again.

This matters after promotions. A promotion can increase structural material enough that an isolated FEN would look middlegame-like, but the chronological game remains an endgame. The monotonic rule uses only the ordered reconstructed board sequence; it does not consult engine or provider metadata.

Invalid/unparseable positions classify as `UNKNOWN` and produce incomplete coverage rather than being forced into a phase.

## Endgame families

When the stabilized game phase is `ENDGAME`, material composition is classified into one of these deterministic families:

- `PAWN`: no queens, rooks, bishops, or knights remain and at least one pawn remains;
- `ROOK`: rook-only non-pawn material;
- `QUEEN`: one or more queens remain, with no rooks (minor pieces may also remain);
- `BISHOP_VS_KNIGHT`: minor-only material with bishop(s) on one side and knight(s) on the other;
- `OPPOSITE_COLORED_BISHOPS`: exactly one bishop per side, no knights, on opposite square colors;
- `SAME_COLORED_BISHOPS`: exactly one bishop per side, no knights, on the same square color;
- `MINOR_PIECE`: other bishop/knight-only endings;
- `ROOK_AND_MINOR`: rook plus bishop/knight material with no queens;
- `MIXED_PIECE`: remaining endgames containing both queens and rooks or another mixed major-piece composition;
- `UNKNOWN`: board state could not be classified, or the material does not map meaningfully to a supported family (for example bare kings).

Non-endgame positions use `NONE` as the family. Promotions are classified from the promoted board state, so a pawn ending may legitimately become a queen or mixed-piece ending without leaving the stabilized endgame phase.

These families are context labels, not claims of technique quality. More specific concepts such as passive rook, cut-off king, Lucena/Philidor, tablebase truth, or 'bad rook endgame technique' require separate deterministic evidence and are outside this detector.

## Evidence projection

`phase-context@phase-v1` is a board-only detector (`requiresCompleteAnalysis=false`). It classifies the initial indexed position at boundary ply 0 and every after-position at boundary ply N.

To stay safely below the generic per-run finding limit even for very long games, identical consecutive phase/family states are compacted into `POSITION_PHASE_RANGE` findings. A range records:

- start/end boundary plies;
- start/end position IDs;
- stabilized phase and endgame family;
- structural start/end phase (useful when monotonic stabilization differs after promotion);
- start/end phase-unit, major/minor-piece, and pawn measurements;
- the classifier version.

A consumer can therefore map every boundary in the range to the same phase/family without requiring one persisted event per ply.

If a required position is missing/invalid, or a valid board cannot be mapped meaningfully to a supported endgame family (for example bare kings), the affected range is marked `INCOMPLETE`, the detector emits `PHASE_EVIDENCE_COVERAGE_GAP`, and the run is `INCOMPLETE`. Missing or unsupported phase context is never treated as a negative finding.

## Versioning

A detector/classifier version bump is required for material changes to:

- phase-unit weights;
- opening/endgame thresholds;
- home-square opening heuristic;
- monotonic transition semantics;
- endgame-family definitions;
- range/event payload semantics.

Later calibration may change these thresholds, but consumers must be able to distinguish old and new evidence through the version.
