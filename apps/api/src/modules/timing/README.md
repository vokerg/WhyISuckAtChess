# timing module

Owns versioned clock alignment and derived timing semantics; it never mutates imported Lichess source rows.

Policy version 1 aligns the durable raw sequence only when its shape is provably safe: exactly one state per ply, or one additional classifiable terminal active-turn state. Short, excessive, invalid, and unclassified sequences remain preserved raw and are not guessed into plies.

Derived per-ply timing keeps authoritative post-move source clock separate from nullable arithmetic. The first move by each color has no invented before-clock/think-time. Later supported moves use `previous same-side post-move clock + effective increment - current post-move clock`; direct game-ending final moves use zero effective increment when the provider case is proven. Negative results are inconsistent, never clamped. Timing coverage is published independently of import-window coverage.
