# Rating-context composition warning

**Status:** Phase 4B implemented aggregate  
**Diagnosis:** `RATING-002 RATING_CONTEXT_COMPOSITION_WARNING`  
**Aggregate policy:** `rating-context-composition-v1`  
**Shared timing/rating policy:** `time-behavior-v1`  
**Scope:** issue #58 under #56

## Purpose

`RATING-002` is a reusable confounder disclosure for comparisons produced by other diagnosis aggregates. Given two bounded, disjoint sets of owned imported-game IDs, it describes whether the arms contain materially different opponent-strength populations.

It does not correct, normalize, regress, reweight, or otherwise rewrite another aggregate's measured effect. A material-composition warning means only that opponent-strength composition differs enough under the versioned policy that the raw comparison should be interpreted with that caveat.

## Inputs and ownership

The caller supplies two non-empty game-ID arms. The service:

- rejects duplicate IDs within an arm and IDs appearing in both arms;
- caps the combined comparison at 5,000 games;
- performs one bounded repository read scoped by `appUserId` and the supplied IDs;
- requires the returned owned-game ID set to match the requested set exactly;
- fails closed if a game disappeared, changed ownership, or otherwise makes the returned population differ from the caller's population.

The repository maps source ratings into the user's perspective from `userColor`:

- White user: user rating = `whiteRating`, opponent rating = `blackRating`;
- Black user: user rating = `blackRating`, opponent rating = `whiteRating`;
- unknown user color leaves rating context unavailable.

Missing ratings are never imputed.

## Arm metrics

For each arm the aggregate exposes:

- input games;
- games with both user and opponent ratings;
- rating coverage percentage;
- mean user rating;
- mean opponent rating;
- mean rating difference, defined as `opponent - user`;
- counts and shares for every `time-behavior-v1` rating-difference band.

Band boundaries come from the shared classifier and are not redefined by `RATING-002`.

## Comparison and warning

The comparison exposes:

- right-minus-left mean rating-difference delta;
- absolute mean rating-difference delta;
- signed percentage-point deltas for every rating band;
- maximum absolute rating-band share delta;
- weaker-arm evidence strength using the shared 50% coverage and 5/15/40 game gates;
- nullable material-composition warning.

The warning is evaluated only when the shared evidence strength is not `INSUFFICIENT`. It becomes true when the shared `time-behavior-v1` policy says either:

- the absolute mean rating-difference delta is at least 100 points; or
- any corresponding rating-band share differs by at least 20 percentage points.

If either arm is under the shared sample/coverage gate, the warning is `null`, not false. That distinction prevents weak evidence from being presented as evidence of balanced composition.

## Coverage semantics

- `COMPLETE`: every requested owned game has both ratings.
- `PARTIAL`: the owned game set is stable, each arm has some rating evidence, but at least one requested game lacks complete ratings.
- `UNAVAILABLE`: invalid/empty/overlapping input, over-size input, owned-game set drift, duplicate repository rows, or an arm with no usable rating evidence.

Partial rating coverage remains visible even when the 50% gate is met.

## Consumption by other aggregates

Later consumers such as `TIME-005`, `TIME-006`, and `TIME-007` should attach the `RATING-002` result beside their measured effect. They must not modify their result/quality/timing deltas based on this warning.

Session, calendar, opening, or other comparisons may reuse the same service when they already have bounded owned game-ID arms. The calling aggregate remains responsible for defining its own comparison population; `RATING-002` only describes that population's rating composition.

## Non-claims

The aggregate does not establish that opponent strength caused another measured effect, does not model confidence or intimidation, and does not perform statistical significance testing or causal adjustment.
