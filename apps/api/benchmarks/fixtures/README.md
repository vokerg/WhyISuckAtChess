# Recorded engine workload

`recorded-cc0-workload.json` contains 18 complete, legal recorded games from the
January 2025 [Lichess standard rated archive](https://database.lichess.org/standard/lichess_db_standard_rated_2025-01.pgn.zst).
Lichess releases its database exports under [CC0](https://database.lichess.org/).
The archive license permits modification and redistribution.

This is the first game with complete clocks in each exact-control/length slot
within an 8 MiB compressed archive prefix: 60+0, 60+1, 180+0, 180+2, 600+0, 600+5,
and 20–40, 41–80, 81–160 plies. The decompressed prefix hash, scanned game count,
source ordinal and individual original PGN hash are in the fixture. It is a
chronological quota sample, not a random sample or a population distribution.

Moves, result, exact controls, source dates, ratings and clocks are preserved.
Names/sites are replaced by benchmark identities. The original games belong to
different players; pooling them tests lifecycle/cost, not anyone's diagnosis.
Archive clocks have **second precision**. Multiplication by 100 expresses those
source values in the application's centisecond units; it does not recover API
centisecond precision. Unknown termination reasons remain unknown.

Preparation is offline using `scripts/phase-7-recorded-workload.mjs`. Keep the
source prefix outside the repository and pass its archive URL explicitly. The
benchmark uses the checked-in fixture and makes no external provider requests.
The PGN-to-NDJSON adapter is a benchmark adapter, not an API export capture.
