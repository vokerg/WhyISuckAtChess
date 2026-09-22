# Canonical diagnostic finding persistence

Status: implemented by issue #82.

This document defines the durable Phase 5 boundary between deterministic candidate production and later overlap/relationship/consolidation/ranking work. The canonical synthesis and ranking semantics remain owned by `docs/diagnosis-synthesis-ranking-policy.md`.

## Purpose

Phase 5 findings are derived, recalculable artifacts. They must retain the evidence contract that produced them without becoming a second source of truth for imported games, detector events, engine snapshots, or session aggregates.

The persistence boundary therefore uses an immutable **finding set** per owned player scope:

```text
owned current source evidence / aggregates
  -> candidate findings
  -> DiagnosisFindingSet (one complete scope revision)
     -> DiagnosisFinding
        -> DiagnosisFindingEvidenceReference
     -> DiagnosisFindingRelationship (persistence seam only)
```

A recalculation creates a new set and supersedes the previous current set atomically. Historical sets remain queryable. Current reads require the caller's expected taxonomy, synthesis, calculation, and complete policy-version tuple; a row from an older tuple fails closed rather than masquerading as current.

## Durable entities

### `DiagnosisFindingSet`

A set is one complete materialization of an explicit owned-player scope.

It persists:

- `appUserId`;
- deterministic `materializationKey` for idempotency;
- `scopeKey` plus inspectable `scopeJson`;
- taxonomy, synthesis, calculation, and complete policy-version metadata;
- `calculationAsOf`;
- current/superseded lifecycle state.

The database enforces at most one `isCurrent = true` set for one `appUserId + scopeKey`. Materialization keys are unique per owner, so independently identical version/scope inputs for two users cannot collide.

### `DiagnosisFinding`

Each finding belongs to exactly one finding set and persists:

- stable `findingKey` and canonical diagnosis ID;
- finding level and observation state;
- deterministic claim/template key;
- producer identity/version;
- sample, distinct-game, and distinct-session counts;
- required-evidence coverage and evidence strength;
- family-specific dimensions and complete coverage payload;
- raw effect metric/value/unit/direction plus comparator payload where applicable;
- upstream source-version/provenance metadata.

The model deliberately supports `ROOT_CAUSE_CANDIDATE` through the same lifecycle. Root candidates identify their synthesis producer/version and supporting provenance; they do not masquerade as detector outputs.

### `DiagnosisFindingEvidenceReference`

Evidence references are child records, not copies of source facts. A reference can retain:

- imported game identity;
- persisted evidence-event identity;
- exact source analysis run;
- ply range;
- session key;
- future stable event-identity key;
- reference-specific provenance;
- deterministic representative-example selection.

Recalculation or deletion of finding sets only deletes derived reference rows. It never cascades from a finding into imported games, evidence events, or analysis runs.

### `DiagnosisFindingRelationship`

Issue #82 reserves the durable finding-to-finding relationship seam with source/target canonical finding IDs, registered relationship type, policy version, and support payload.

Issue #85 owns relationship construction, allowed-edge enforcement, current-graph replacement, and graph semantics. Context values such as time control, phase, rating band, or session ordinal remain dimensions rather than relationship targets.

## Replace-current-scope lifecycle

`replaceCurrentDiagnosisFindingScope` validates the complete bounded draft before persistence and the Prisma repository publishes it in one transaction:

1. verify the owner exists;
2. treat a still-current matching `materializationKey` as an idempotent replay;
3. reject reuse of a materialization key that has already been superseded;
4. verify referenced games/analysis/evidence belong to the same owner;
5. require referenced persisted evidence events to come from current successful evidence runs;
6. reject one reference that mixes sources from different games;
7. supersede the previous current set for the scope;
8. create the replacement set, findings, and evidence references;
9. return the newly current immutable snapshot.

A transaction failure leaves the previous set current.

## Bounds

The service consumes the Phase 5 bounds from `packages/chess-domain`:

- at most 200 current findings per scope;
- at most 1,000 evidence references per finding;
- at most 3 representative examples per finding.

Counts, coverage, finite raw effects, JSON payloads, duplicate finding/reference keys, and ply ranges are validated before persistence.

## Staleness and provenance

`isCurrent` answers only whether a finding set is the latest published revision for its exact owned scope. It does not rewrite upstream provenance.

A later policy/taxonomy/producer/source-version change creates a new materialization. Historical findings remain attached to the version tuple under which they were calculated. Later Phase 5 services must consume the current set and must fail closed when mandatory upstream evidence has changed.

## Ownership and source-fact safety

The Prisma repository rejects cross-user source references. Evidence-event references must point to a current successful `EvidenceRun` at materialization time. When multiple source identifiers are provided on one reference, they must resolve to the same imported game.

Foreign keys from diagnosis references use `SET NULL` toward authoritative source rows; deleting/superseding diagnosis artifacts therefore cannot delete imported games, evidence events, or analysis runs.

## CRT reference / Why delta

**Reference**

- CRT `player-chess-profile.repository.prisma.ts` and `player-chess-profile.service.ts` for bounded ownership-scoped repository/service separation.
- CRT tactical-detection run/repository/service persistence for explicit run identity, version/hash provenance, transaction-owned replacement work, and durable supporting-game linkage.

**Preserve**

- Prisma stays behind a backend repository boundary;
- owned-player scoping is explicit;
- derived output carries durable version/provenance metadata;
- replacement/materialization is transactional rather than piecemeal;
- supporting source games remain traceable.

**Change**

- Why persists heterogeneous canonical findings rather than CRT profile summaries or tactical detections;
- one immutable finding set owns a complete scope revision;
- current reads are version-tuple gated;
- evidence references can retain detector events, analysis runs, plies, sessions, and future stable event identity without copying those source facts;
- root-cause candidates share the finding lifecycle without becoming detector outputs.

**Omit**

- CRT repertoire/training/course state;
- UI denormalization;
- destructive replacement of authoritative source evidence;
- AI-authored findings.

**Future seam**

The typed draft/read repository contract can be replaced by another persistence implementation without moving Prisma into `packages/chess-domain` or changing the Phase 5 synthesis policy.

## Phase boundary

Implemented here:

- schema and migration;
- finding-set/current-vs-superseded lifecycle;
- canonical finding persistence;
- evidence/source-reference persistence;
- bounded validation and ownership fencing;
- relationship persistence seam;
- PostgreSQL-backed lifecycle regression coverage.

Deferred:

- #83 candidate producer registry;
- #84 stable event identity and overlap computation;
- #85 relationship graph construction;
- #86 consolidation;
- #87 root-cause synthesis execution;
- #88 ranking execution;
- Phase 6 API/UI/AI explanation.
