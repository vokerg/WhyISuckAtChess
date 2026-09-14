# Evidence module

This module owns deterministic evidence detector execution, persistence/read boundaries, and bounded evidence queries. The persistent worker runs registered per-game detectors; API/UI code does not execute detector policy.

Canonical behavior is documented in:

- `docs/deterministic-evidence.md` — run identity, provenance, coverage, retries, and current-versus-historical publication.
- `docs/material-evidence.md`
- `docs/phase-evidence.md`
- `docs/tactical-motif-evidence.md`
- `docs/defensive-threat-evidence.md`
- `docs/conversion-evidence.md`
- `docs/opening-evidence.md`

Opening recurrence is intentionally split across two seams: `opening-context@opening-v1` persists bounded game-local opening samples through the normal evidence worker, while `opening-recurrence.service.ts` aggregates only current provenance-valid samples through the bounded Prisma query in `opening-recurrence.repository.prisma.ts`. Cross-game aggregation does not run inside a per-game detector claim.
