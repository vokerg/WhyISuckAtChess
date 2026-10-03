import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDiagnosisRootCandidates,
  materializeCurrentDiagnosisRootCandidates,
} from '../dist/modules/diagnosis/diagnosis-root-cause.service.js';

function eventReference(findingKey, gameId, discriminator = '1', sessionKey = null, representative = false) {
  return {
    id: gameId * 100 + Number.parseInt(discriminator, 10),
    referenceKey: findingKey + '-game-' + gameId + '-' + discriminator,
    referenceType: 'IMPORTED_GAME',
    importedGameId: gameId,
    evidenceEventId: null,
    sourceAnalysisRunId: null,
    sourcePlyStart: null,
    sourcePlyEnd: null,
    sessionKey,
    eventIdentityKey:
      'diagnosis-event-identity-v1|game|g:' + gameId + '|k:ROOT_FIXTURE|v:v1|d:' + discriminator,
    provenance: { fixture: true, gameId, discriminator },
    representative,
  };
}

function mechanismFinding(id, diagnosisId = 'TIME-004', overrides = {}) {
  const findingKey = overrides.findingKey ?? diagnosisId.toLowerCase() + '-' + id;
  const games = overrides.games ?? [1, 2, 3, 4, 5];
  const references = overrides.evidenceReferences ?? games.map((gameId, index) => (
    eventReference(
      findingKey,
      gameId,
      String(index + 1),
      overrides.sessionKeys?.[index] ?? null,
      index < 3,
    )
  ));
  return {
    id,
    findingKey,
    diagnosisId,
    findingLevel: 'MECHANISM',
    observationState: overrides.observationState ?? 'PROBLEM_DETECTED',
    claimKey: overrides.claimKey ?? 'fixture.' + diagnosisId.toLowerCase(),
    producerKey: overrides.producerKey ?? 'fixture-mechanism',
    producerVersion: overrides.producerVersion ?? 'fixture-v1',
    sampleCount: overrides.sampleCount ?? references.length,
    distinctGameCount: overrides.distinctGameCount ?? new Set(games).size,
    distinctSessionCount: overrides.distinctSessionCount ?? 0,
    requiredEvidenceCoverage: overrides.requiredEvidenceCoverage ?? 0.8,
    evidenceStrength: overrides.evidenceStrength ?? 'LOW',
    dimensions: overrides.dimensions ?? {},
    coverage: overrides.coverage ?? {},
    effect: overrides.effect ?? {
      metric: 'fixture-delta',
      value: 10,
      unit: 'CENTIPAWNS',
      direction: 'HIGHER_IS_WORSE',
      comparator: null,
    },
    sourceVersions: overrides.sourceVersions ?? { fixture: 'v1' },
    evidenceReferences: references,
  };
}

function contextFinding(id, diagnosisId = 'TIME-002', overrides = {}) {
  return {
    id,
    findingKey: overrides.findingKey ?? diagnosisId.toLowerCase() + '-' + id,
    diagnosisId,
    findingLevel: overrides.findingLevel ?? 'CONTRIBUTING_CONDITION',
    observationState: overrides.observationState ?? 'PROBLEM_DETECTED',
    claimKey: overrides.claimKey ?? 'fixture.' + diagnosisId.toLowerCase(),
    producerKey: overrides.producerKey ?? 'fixture-context',
    producerVersion: overrides.producerVersion ?? 'fixture-v1',
    sampleCount: overrides.sampleCount ?? 8,
    distinctGameCount: overrides.distinctGameCount ?? 5,
    distinctSessionCount: overrides.distinctSessionCount ?? 0,
    requiredEvidenceCoverage: overrides.requiredEvidenceCoverage ?? 0.8,
    evidenceStrength: overrides.evidenceStrength ?? 'LOW',
    dimensions: overrides.dimensions ?? {},
    coverage: overrides.coverage ?? {},
    effect: overrides.effect ?? {
      metric: 'fixture-context-delta',
      value: 12,
      unit: 'CENTIPAWNS',
      direction: 'HIGHER_IS_WORSE',
      comparator: null,
    },
    sourceVersions: overrides.sourceVersions ?? { fixture: 'v1' },
    evidenceReferences: overrides.evidenceReferences ?? [],
  };
}

function rootAggregateFinding(id, overrides = {}) {
  return {
    id,
    findingKey: overrides.findingKey ?? 'session-003-threshold-6',
    diagnosisId: 'SESSION-003',
    findingLevel: 'ROOT_CAUSE_CANDIDATE',
    observationState: 'PROBLEM_DETECTED',
    claimKey: 'session.overlong-stopping-point',
    producerKey: 'overlong-session-stopping-point',
    producerVersion: 'diagnosis-candidate-projection-v1',
    sampleCount: 8,
    distinctGameCount: 8,
    distinctSessionCount: 4,
    requiredEvidenceCoverage: 0.8,
    evidenceStrength: 'LOW',
    dimensions: { selectedThreshold: 6 },
    coverage: {},
    effect: {
      metric: 'average-score-loss-delta',
      value: 20,
      unit: 'CENTIPAWNS',
      direction: 'HIGHER_IS_WORSE',
      comparator: null,
    },
    sourceVersions: { aggregate: 'overlong-session-stopping-point-v1' },
    evidenceReferences: [],
  };
}

function relationship(id, source, target, relationshipType, overrides = {}) {
  return {
    id,
    sourceFindingId: source.id,
    targetFindingId: target.id,
    relationshipType,
    policyVersion: 'diagnosis-synthesis-v1',
    support: overrides.support ?? {
      graphVersion: 'diagnosis-relationship-graph-v1',
      ruleKey: 'fixture',
    },
  };
}

function materialOverlapSupport() {
  return {
    graphVersion: 'diagnosis-relationship-graph-v1',
    ruleKey: 'fixture-material-overlap',
    overlap: {
      eventIdentityVersion: 'diagnosis-event-identity-v1',
      material: true,
      intersectionEventCount: 5,
      sharedDistinctGames: 5,
      sharedDistinctSessions: 3,
    },
  };
}

function consolidation(id, finding, overrides = {}) {
  return {
    id,
    findingId: finding.id,
    representativeFindingId: null,
    state: overrides.state ?? 'TOP_LEVEL',
    topLevelEligible: overrides.topLevelEligible ?? true,
    clusterKey: overrides.clusterKey ?? 'cluster:' + finding.findingKey,
    reasonKeys: overrides.reasonKeys ?? [],
    policyVersion: 'diagnosis-consolidation-v1',
    support: overrides.support ?? { fixture: true },
  };
}

function snapshot(findings, relationships = [], overrides = {}) {
  return {
    id: overrides.id ?? 90,
    appUserId: 7,
    materializationKey: overrides.materializationKey ?? 'fixture-materialization',
    scopeKey: overrides.scopeKey ?? 'scope-a',
    scope: overrides.scope ?? { account: 'fixture' },
    taxonomyVersion: 'diagnostic-taxonomy-v1',
    synthesisPolicyVersion: 'diagnosis-synthesis-v1',
    calculationVersion: 'finding-materialization-v1',
    policyVersions: {
      eventIdentity: 'diagnosis-event-identity-v1',
      consolidation: 'diagnosis-consolidation-v1',
      ranking: 'diagnosis-ranking-v1',
    },
    calculationAsOf: new Date('2026-10-03T10:00:00Z'),
    isCurrent: true,
    supersededAt: null,
    findings,
    relationships,
    consolidations: overrides.consolidations ?? findings.map(
      (finding, index) => consolidation(index + 1, finding),
    ),
    rootSupports: overrides.rootSupports ?? [],
  };
}

function clockFixture(overrides = {}) {
  const mechanism = overrides.mechanism ?? mechanismFinding(1, 'TIME-004');
  const context = overrides.context ?? contextFinding(2, 'TIME-002');
  const relationships = overrides.relationships ?? [
    relationship(10, mechanism, context, 'CONTRIBUTES_TO'),
  ];
  return {
    mechanism,
    context,
    snapshot: snapshot(
      overrides.findings ?? [mechanism, context],
      relationships,
      overrides.snapshotOverrides,
    ),
  };
}

function synthesizedRoot(result, themeKey) {
  const finding = result.findings.find((candidate) => candidate.diagnosisId === themeKey);
  assert.ok(finding, 'expected synthesized root ' + themeKey);
  return finding;
}

test('registered clock theme promotes from a repeated mechanism plus typed material context', () => {
  const fixture = clockFixture();
  const result = buildDiagnosisRootCandidates(fixture.snapshot);
  const root = synthesizedRoot(result, 'CLOCK_MANAGEMENT_DRIVING_TACTICAL_COLLAPSE');

  assert.equal(root.findingLevel, 'ROOT_CAUSE_CANDIDATE');
  assert.equal(root.producerKey, 'diagnosis-root-synthesis');
  assert.equal(root.producerVersion, 'diagnosis-synthesis-v1');
  assert.equal(root.sampleCount, 5);
  assert.equal(root.distinctGameCount, 5);
  assert.equal(root.requiredEvidenceCoverage, 0.8);
  assert.equal(root.evidenceStrength, 'LOW');
  assert.equal(root.effect, null);
  assert.equal(root.evidenceReferences.length, 5);
  assert.equal(root.evidenceReferences.filter((reference) => reference.representative).length, 1);
  assert.deepEqual(
    result.supports.map((support) => support.role).sort(),
    ['CONDITION_OR_OBSERVATION', 'MECHANISM'],
  );
  assert.ok(result.supports.every((support) => support.support.sourceFindingSetId === 90));
});

test('missing mechanism or missing registered context does not promote a root', () => {
  const mechanism = mechanismFinding(1);
  const context = contextFinding(2);

  assert.deepEqual(
    buildDiagnosisRootCandidates(snapshot([context], [])).findings,
    [],
  );
  assert.deepEqual(
    buildDiagnosisRootCandidates(snapshot([mechanism], [])).findings,
    [],
  );
});

test('mandatory child coverage below 50 percent fails closed', () => {
  const context = contextFinding(2, 'TIME-002', { requiredEvidenceCoverage: 0.49 });
  const fixture = clockFixture({ context });

  const result = buildDiagnosisRootCandidates(fixture.snapshot);
  assert.equal(result.findings.length, 0);
});

test('stale mechanism event identity cannot promote a root', () => {
  const mechanism = mechanismFinding(1, 'TIME-004');
  mechanism.evidenceReferences = mechanism.evidenceReferences.map((reference) => ({
    ...reference,
    eventIdentityKey: reference.eventIdentityKey.replace(
      'diagnosis-event-identity-v1',
      'diagnosis-event-identity-v0',
    ),
  }));
  const fixture = clockFixture({ mechanism });

  const result = buildDiagnosisRootCandidates(fixture.snapshot);
  assert.equal(result.findings.length, 0);
});

test('stale relationship graph support is rejected', () => {
  const mechanism = mechanismFinding(1, 'TIME-004');
  const context = contextFinding(2, 'TIME-002');
  const source = snapshot([mechanism, context], [
    relationship(10, mechanism, context, 'CONTRIBUTES_TO', {
      support: {
        graphVersion: 'diagnosis-relationship-graph-v0',
        ruleKey: 'stale-fixture',
      },
    }),
  ]);

  assert.throws(
    () => buildDiagnosisRootCandidates(source),
    /stale relationship graph version/,
  );
});

test('one-game event concentration above the v1 maximum cannot promote', () => {
  const findingKey = 'time-004-concentrated';
  const games = [1, 1, 1, 1, 1, 1, 2, 3, 4, 5];
  const references = games.map((gameId, index) => (
    eventReference(findingKey, gameId, String(index + 1), null, index < 3)
  ));
  const mechanism = mechanismFinding(1, 'TIME-004', {
    findingKey,
    games,
    evidenceReferences: references,
    distinctGameCount: 5,
    sampleCount: 10,
  });
  const fixture = clockFixture({ mechanism });

  const result = buildDiagnosisRootCandidates(fixture.snapshot);
  assert.equal(result.findings.length, 0);
});

test('overlapping mechanism evidence is deduplicated by stable event identity', () => {
  const first = mechanismFinding(1, 'TIME-004', { findingKey: 'early-overuse' });
  const sharedReferences = first.evidenceReferences.map((reference, index) => ({
    ...reference,
    id: 500 + index,
    referenceKey: 'tactical-' + index,
  }));
  const second = mechanismFinding(3, 'TACT-004', {
    findingKey: 'hanging-material',
    evidenceReferences: sharedReferences,
    games: [1, 2, 3, 4, 5],
  });
  const context = contextFinding(2, 'TIME-002');
  const relationships = [
    relationship(10, first, context, 'CONTRIBUTES_TO'),
    relationship(11, second, context, 'CONDITIONAL_ON', {
      support: materialOverlapSupport(),
    }),
  ];
  const source = snapshot([first, context, second], relationships);

  const result = buildDiagnosisRootCandidates(source);
  const root = synthesizedRoot(result, 'CLOCK_MANAGEMENT_DRIVING_TACTICAL_COLLAPSE');

  assert.equal(root.sampleCount, 5);
  assert.equal(root.evidenceReferences.length, 5);
  assert.equal(result.supports.filter((support) => support.role === 'MECHANISM').length, 2);
});

test('late-session theme requires cross-session recurrence and can retain SESSION-003 as additional support', () => {
  const mechanism = mechanismFinding(1, 'TACT-004', {
    findingKey: 'late-hanging-material',
    sessionKeys: ['s1', 's1', 's2', 's2', 's3'],
  });
  const context = contextFinding(2, 'SESSION-001', {
    findingKey: 'late-session-quality',
    distinctSessionCount: 3,
  });
  const stoppingPoint = rootAggregateFinding(3);
  const relationships = [
    relationship(10, mechanism, context, 'SHARES_EVENTS_WITH', {
      support: materialOverlapSupport(),
    }),
    relationship(11, stoppingPoint, context, 'MANIFESTS_AS'),
  ];

  const result = buildDiagnosisRootCandidates(
    snapshot([mechanism, context, stoppingPoint], relationships),
  );
  const root = synthesizedRoot(result, 'LATE_SESSION_TACTICAL_DETERIORATION');

  assert.equal(root.distinctSessionCount, 3);
  assert.equal(root.distinctGameCount, 5);
  assert.deepEqual(
    result.supports.map((support) => [support.supportingFindingKey, support.role]),
    [
      ['late-hanging-material', 'MECHANISM'],
      ['late-session-quality', 'CONDITION_OR_OBSERVATION'],
      ['session-003-threshold-6', 'ADDITIONAL_SUPPORT'],
    ],
  );
});

test('late-session theme does not promote below three distinct sessions', () => {
  const mechanism = mechanismFinding(1, 'TACT-004', {
    sessionKeys: ['s1', 's1', 's1', 's2', 's2'],
  });
  const context = contextFinding(2, 'SESSION-001', { distinctSessionCount: 2 });
  const relationships = [
    relationship(10, mechanism, context, 'SHARES_EVENTS_WITH', {
      support: materialOverlapSupport(),
    }),
  ];

  const result = buildDiagnosisRootCandidates(snapshot([mechanism, context], relationships));
  assert.equal(result.findings.length, 0);
});

function persistedFromDraft(draft, id) {
  return {
    id,
    findingKey: draft.findingKey,
    diagnosisId: draft.diagnosisId,
    findingLevel: draft.findingLevel,
    observationState: draft.observationState,
    claimKey: draft.claimKey,
    producerKey: draft.producerKey,
    producerVersion: draft.producerVersion,
    sampleCount: draft.sampleCount,
    distinctGameCount: draft.distinctGameCount,
    distinctSessionCount: draft.distinctSessionCount,
    requiredEvidenceCoverage: draft.requiredEvidenceCoverage,
    evidenceStrength: draft.evidenceStrength,
    dimensions: draft.dimensions,
    coverage: draft.coverage,
    effect: draft.effect ?? null,
    sourceVersions: draft.sourceVersions,
    evidenceReferences: draft.evidenceReferences.map((reference, index) => ({
      id: id * 1000 + index,
      referenceKey: reference.referenceKey,
      referenceType: reference.referenceType,
      importedGameId: reference.importedGameId ?? null,
      evidenceEventId: reference.evidenceEventId ?? null,
      sourceAnalysisRunId: reference.sourceAnalysisRunId ?? null,
      sourcePlyStart: reference.sourcePlyStart ?? null,
      sourcePlyEnd: reference.sourcePlyEnd ?? null,
      sessionKey: reference.sessionKey ?? null,
      eventIdentityKey: reference.eventIdentityKey ?? null,
      provenance: reference.provenance,
      representative: reference.representative ?? false,
    })),
  };
}

function replacementSnapshot(source, draft) {
  const findings = draft.findings.map((finding, index) => persistedFromDraft(finding, 100 + index));
  const byKey = new Map(findings.map((finding) => [finding.findingKey, finding]));
  return {
    ...source,
    id: source.id + 1,
    materializationKey: draft.materializationKey,
    findings,
    relationships: [],
    consolidations: [],
    rootSupports: (draft.rootSupports ?? []).map((support, index) => ({
      id: index + 1,
      rootFindingId: byKey.get(support.rootFindingKey).id,
      supportingFindingId: byKey.get(support.supportingFindingKey).id,
      role: support.role,
      support: support.support,
    })),
  };
}

test('materialization publishes a replacement canonical finding-set revision with durable child links', async () => {
  const fixture = clockFixture();
  let replacement = null;
  let sourceChecks = 0;

  const repository = {
    async getCurrentScope() {
      return fixture.snapshot;
    },
    async assertCurrentSourceReferences(appUserId, current) {
      sourceChecks += 1;
      assert.equal(appUserId, 7);
      assert.equal(current.id, fixture.snapshot.id);
    },
    async replaceCurrentScope(appUserId, draft) {
      assert.equal(appUserId, 7);
      replacement = draft;
      return replacementSnapshot(fixture.snapshot, draft);
    },
  };

  const versions = {
    taxonomyVersion: fixture.snapshot.taxonomyVersion,
    synthesisPolicyVersion: fixture.snapshot.synthesisPolicyVersion,
    calculationVersion: fixture.snapshot.calculationVersion,
    policyVersions: fixture.snapshot.policyVersions,
  };
  const result = await materializeCurrentDiagnosisRootCandidates(
    7,
    'scope-a',
    versions,
    repository,
  );

  assert.equal(sourceChecks, 1);
  assert.equal(result.materialized, true);
  assert.equal(result.sourceFindingSetId, 90);
  assert.equal(result.findingSetId, 91);
  assert.equal(result.requiresHierarchyRefresh, true);
  assert.equal(result.roots.length, 1);
  assert.ok(replacement);
  assert.equal(replacement.materializationKey, 'root-synth-v1-source-90');
  assert.equal(replacement.findings.length, 3);
  assert.equal(replacement.rootSupports.length, 2);
  assert.deepEqual(
    replacement.findings
      .filter((finding) => finding.producerKey !== 'diagnosis-root-synthesis')
      .map((finding) => finding.findingKey)
      .sort(),
    [fixture.context.findingKey, fixture.mechanism.findingKey].sort(),
  );
});

test('materialization is a no-op when no root qualifies', async () => {
  const context = contextFinding(2);
  const source = snapshot([context], []);
  let replacements = 0;
  const repository = {
    async getCurrentScope() {
      return source;
    },
    async assertCurrentSourceReferences() {},
    async replaceCurrentScope() {
      replacements += 1;
      throw new Error('should not replace');
    },
  };

  const result = await materializeCurrentDiagnosisRootCandidates(
    7,
    source.scopeKey,
    {
      taxonomyVersion: source.taxonomyVersion,
      synthesisPolicyVersion: source.synthesisPolicyVersion,
      calculationVersion: source.calculationVersion,
      policyVersions: source.policyVersions,
    },
    repository,
  );

  assert.equal(result.materialized, false);
  assert.equal(result.roots.length, 0);
  assert.equal(replacements, 0);
});

test('an already-current synthesized root is idempotent even before hierarchy refresh', async () => {
  const fixture = clockFixture();
  const build = buildDiagnosisRootCandidates(fixture.snapshot);
  const rootDraft = build.findings[0];
  assert.ok(rootDraft);
  const existingRoot = persistedFromDraft(rootDraft, 50);
  const source = snapshot(
    [fixture.mechanism, fixture.context, existingRoot],
    [],
    { consolidations: [], rootSupports: [] },
  );
  let replacements = 0;
  const repository = {
    async getCurrentScope() {
      return source;
    },
    async assertCurrentSourceReferences() {},
    async replaceCurrentScope() {
      replacements += 1;
      throw new Error('should not replace');
    },
  };

  const result = await materializeCurrentDiagnosisRootCandidates(
    7,
    source.scopeKey,
    {
      taxonomyVersion: source.taxonomyVersion,
      synthesisPolicyVersion: source.synthesisPolicyVersion,
      calculationVersion: source.calculationVersion,
      policyVersions: source.policyVersions,
    },
    repository,
  );

  assert.equal(result.materialized, false);
  assert.equal(result.roots.length, 1);
  assert.equal(result.requiresHierarchyRefresh, true);
  assert.equal(replacements, 0);
});
