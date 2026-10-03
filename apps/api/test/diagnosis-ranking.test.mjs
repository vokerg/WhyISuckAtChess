import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDiagnosisRanking,
  materializeCurrentDiagnosisRanking,
} from '../dist/modules/diagnosis/diagnosis-ranking.service.js';

function finding(id, diagnosisId, overrides = {}) {
  return {
    id,
    findingKey: overrides.findingKey ?? diagnosisId.toLowerCase() + '-' + id,
    diagnosisId,
    findingLevel: overrides.findingLevel ?? 'MECHANISM',
    observationState: overrides.observationState ?? 'PROBLEM_DETECTED',
    claimKey: overrides.claimKey ?? 'fixture.' + diagnosisId.toLowerCase(),
    producerKey: overrides.producerKey ?? 'fixture',
    producerVersion: overrides.producerVersion ?? 'fixture-v1',
    sampleCount: overrides.sampleCount ?? 10,
    distinctGameCount: overrides.distinctGameCount ?? 10,
    distinctSessionCount: overrides.distinctSessionCount ?? 0,
    requiredEvidenceCoverage: overrides.requiredEvidenceCoverage ?? 0.8,
    evidenceStrength: overrides.evidenceStrength ?? 'LOW',
    dimensions: overrides.dimensions ?? {},
    coverage: overrides.coverage ?? {},
    effect: overrides.effect === undefined
      ? {
          metric: 'average-score-loss-delta',
          value: 50,
          unit: 'CENTIPAWNS',
          direction: 'HIGHER_IS_WORSE',
          comparator: null,
        }
      : overrides.effect,
    sourceVersions: overrides.sourceVersions ?? { fixture: 'v1' },
    evidenceReferences: overrides.evidenceReferences ?? [],
  };
}

function consolidation(id, target, overrides = {}) {
  return {
    id,
    findingId: target.id,
    representativeFindingId: overrides.representativeFindingId ?? null,
    state: overrides.state ?? 'TOP_LEVEL',
    topLevelEligible: overrides.topLevelEligible ?? true,
    clusterKey: overrides.clusterKey ?? 'cluster:' + target.findingKey,
    reasonKeys: overrides.reasonKeys ?? [],
    policyVersion: overrides.policyVersion ?? 'diagnosis-consolidation-v1',
    support: overrides.support ?? {
      findingKey: target.findingKey,
      diagnosisId: target.diagnosisId,
      materialOverlapPeerFindingIds: [],
      confounderFindingIds: [],
    },
  };
}

function rootSupport(id, root, child, role) {
  return {
    id,
    rootFindingId: root.id,
    supportingFindingId: child.id,
    role,
    support: { fixture: true },
  };
}

function snapshot(findings, overrides = {}) {
  return {
    id: overrides.id ?? 100,
    appUserId: overrides.appUserId ?? 7,
    materializationKey: overrides.materializationKey ?? 'ranking-fixture',
    scopeKey: overrides.scopeKey ?? 'scope-a',
    scope: overrides.scope ?? { account: 'fixture' },
    taxonomyVersion: overrides.taxonomyVersion ?? 'diagnostic-taxonomy-v1',
    synthesisPolicyVersion: overrides.synthesisPolicyVersion ?? 'diagnosis-synthesis-v1',
    calculationVersion: overrides.calculationVersion ?? 'finding-materialization-v1',
    policyVersions: overrides.policyVersions ?? {
      eventIdentity: 'diagnosis-event-identity-v1',
      consolidation: 'diagnosis-consolidation-v1',
      ranking: 'diagnosis-ranking-v1',
    },
    calculationAsOf: overrides.calculationAsOf ?? new Date('2026-10-03T15:00:00Z'),
    isCurrent: overrides.isCurrent ?? true,
    supersededAt: overrides.supersededAt ?? null,
    findings,
    relationships: overrides.relationships ?? [],
    consolidations: overrides.consolidations
      ?? findings.map((item, index) => consolidation(index + 1, item)),
    rootSupports: overrides.rootSupports ?? [],
  };
}

function rowFor(result, findingId) {
  const row = result.rankings.find((candidate) => candidate.findingId === findingId);
  assert.ok(row, 'expected ranking row for finding ' + findingId);
  return row;
}

function topLevel(result) {
  return result.rankings.filter((candidate) => candidate.topLevelRanked);
}

test('stronger evidence ranks above otherwise equal weak evidence and raw effects remain inspectable', () => {
  const low = finding(1, 'TIME-002', {
    findingKey: 'low-evidence',
    evidenceStrength: 'LOW',
  });
  const high = finding(2, 'TIME-003', {
    findingKey: 'high-evidence',
    evidenceStrength: 'HIGH',
  });

  const result = buildDiagnosisRanking(snapshot([low, high]));
  assert.deepEqual(topLevel(result).map((row) => row.findingId), [high.id, low.id]);
  assert.equal(rowFor(result, high.id).evidenceMultiplier, 1);
  assert.equal(rowFor(result, low.id).evidenceMultiplier, 0.55);
  assert.deepEqual(rowFor(result, high.id).rawEffect, high.effect);
  assert.equal(rowFor(result, high.id).rankingPolicyVersion, 'diagnosis-ranking-v1');
});

test('frequency and severity trade off through fixed registered normalization rather than scope-relative scaling', () => {
  const frequentMild = finding(1, 'TIME-001', {
    findingKey: 'frequent-mild',
    findingLevel: 'OBSERVATION',
    distinctGameCount: 40,
    effect: {
      metric: 'pressure-entry-rate',
      value: 30,
      unit: 'PERCENT',
      direction: 'HIGHER_IS_WORSE',
      comparator: null,
    },
    evidenceStrength: 'MEDIUM',
  });
  const rareSevere = finding(2, 'TIME-002', {
    findingKey: 'rare-severe',
    distinctGameCount: 5,
    effect: {
      metric: 'average-score-loss-delta',
      value: 100,
      unit: 'CENTIPAWNS',
      direction: 'HIGHER_IS_WORSE',
      comparator: null,
    },
    evidenceStrength: 'MEDIUM',
  });

  const result = buildDiagnosisRanking(snapshot([frequentMild, rareSevere]));
  const frequent = rowFor(result, frequentMild.id);
  const severe = rowFor(result, rareSevere.id);

  assert.ok(frequent.components.some((item) => (
    item.component === 'frequency'
    && item.normalizationKey === 'frequency.distinct-games.5-40.v1'
    && item.normalizedValue === 1
  )));
  assert.ok(severe.components.some((item) => (
    item.component === 'severity'
    && item.normalizationKey === 'severity.average-score-loss-delta-cp.v1'
    && item.normalizedValue === 1
  )));
  assert.notEqual(frequent.weightedScore, severe.weightedScore);
});

test('unresolved material overlap receives the v1 overlap multiplier without changing raw effect', () => {
  const clean = finding(1, 'TIME-002', { findingKey: 'clean' });
  const overlapping = finding(2, 'TIME-003', { findingKey: 'overlap' });
  const result = buildDiagnosisRanking(snapshot([clean, overlapping], {
    consolidations: [
      consolidation(1, clean),
      consolidation(2, overlapping, {
        state: 'TOP_LEVEL_MATERIAL_OVERLAP',
        reasonKeys: ['UNRESOLVED_MATERIAL_OVERLAP'],
        support: {
          findingKey: overlapping.findingKey,
          diagnosisId: overlapping.diagnosisId,
          materialOverlapPeerFindingIds: [clean.id],
          confounderFindingIds: [],
        },
      }),
    ],
  }));

  const cleanRow = rowFor(result, clean.id);
  const overlapRow = rowFor(result, overlapping.id);
  assert.equal(cleanRow.overlapMultiplier, 1);
  assert.equal(overlapRow.overlapMultiplier, 0.75);
  assert.ok(overlapRow.finalScore < cleanRow.finalScore);
  assert.deepEqual(overlapRow.rawEffect, overlapping.effect);
});

test('supported synthesized root ranks top-level while its eligible supporting children remain drill-down rows', () => {
  const mechanism = finding(1, 'TIME-004', {
    findingKey: 'early-time-overuse',
    findingLevel: 'MECHANISM',
    distinctGameCount: 8,
    evidenceStrength: 'MEDIUM',
    effect: {
      metric: 'later-average-score-loss-delta',
      value: 70,
      unit: 'CENTIPAWNS',
      direction: 'HIGHER_IS_WORSE',
      comparator: null,
    },
  });
  const context = finding(2, 'TIME-002', {
    findingKey: 'pressure-collapse',
    findingLevel: 'CONTRIBUTING_CONDITION',
    distinctGameCount: 8,
    evidenceStrength: 'MEDIUM',
    effect: {
      metric: 'average-score-loss-delta',
      value: 60,
      unit: 'CENTIPAWNS',
      direction: 'HIGHER_IS_WORSE',
      comparator: null,
    },
  });
  const root = finding(3, 'CLOCK_MANAGEMENT_DRIVING_TACTICAL_COLLAPSE', {
    findingKey: 'root-clock-management-driving-tactical-collapse',
    findingLevel: 'ROOT_CAUSE_CANDIDATE',
    producerKey: 'diagnosis-root-synthesis',
    producerVersion: 'diagnosis-synthesis-v1',
    distinctGameCount: 8,
    evidenceStrength: 'MEDIUM',
    effect: null,
  });

  const result = buildDiagnosisRanking(snapshot([mechanism, context, root], {
    rootSupports: [
      rootSupport(1, root, mechanism, 'MECHANISM'),
      rootSupport(2, root, context, 'CONDITION_OR_OBSERVATION'),
    ],
  }));

  assert.deepEqual(topLevel(result).map((row) => row.findingId), [root.id]);
  assert.equal(rowFor(result, root.id).rankPosition, 1);
  assert.equal(rowFor(result, mechanism.id).topLevelRanked, false);
  assert.equal(rowFor(result, context.id).topLevelRanked, false);
  assert.deepEqual(rowFor(result, mechanism.id).parentRootFindingIds, [root.id]);
  assert.deepEqual(rowFor(result, context.id).parentRootFindingIds, [root.id]);

  const rootSeverity = rowFor(result, root.id).components.find(
    (item) => item.component === 'severity',
  );
  assert.equal(rootSeverity.normalizationKey, 'severity.root-mandatory-child-max.v1');
  assert.equal(rootSeverity.normalizedValue, 0.7);
});

test('exact score ties use evidence, distinct games, diagnosis id, then stable finding key', () => {
  const b = finding(1, 'TIME-003', { findingKey: 'b-key' });
  const a2 = finding(2, 'TIME-002', { findingKey: 'z-key' });
  const a1 = finding(3, 'TIME-002', { findingKey: 'a-key' });

  const result = buildDiagnosisRanking(snapshot([b, a2, a1]));
  assert.deepEqual(
    topLevel(result).map((row) => row.findingId),
    [a1.id, a2.id, b.id],
  );
  assert.deepEqual(
    topLevel(result).map((row) => row.rankPosition),
    [1, 2, 3],
  );
});

test('insufficient and suppressed findings never enter the current ranking', () => {
  const insufficient = finding(1, 'TIME-002', {
    evidenceStrength: 'INSUFFICIENT',
    observationState: 'INSUFFICIENT_EVIDENCE',
  });
  const suppressed = finding(2, 'TIME-003');
  const active = finding(3, 'TIME-004');

  const result = buildDiagnosisRanking(snapshot([insufficient, suppressed, active], {
    consolidations: [
      consolidation(1, insufficient, {
        state: 'INELIGIBLE',
        topLevelEligible: false,
        reasonKeys: ['SOURCE_FINDING_NOT_SUPPORTED'],
      }),
      consolidation(2, suppressed, {
        state: 'SUPPRESSED_DRILLDOWN',
        topLevelEligible: false,
        representativeFindingId: active.id,
      }),
      consolidation(3, active),
    ],
  }));

  assert.deepEqual(result.rankings.map((row) => row.findingId), [active.id]);
});

test('unregistered required severity normalization fails closed', () => {
  const unsupported = finding(1, 'TIME-002', {
    effect: {
      metric: 'unknown-ranking-metric',
      value: 10,
      unit: 'MYSTERY',
      direction: 'HIGHER_IS_WORSE',
      comparator: null,
    },
  });
  assert.throws(
    () => buildDiagnosisRanking(snapshot([unsupported])),
    /no registered severity normalization/,
  );
});

test('stale or incomplete hierarchy state fails closed', () => {
  const active = finding(1, 'TIME-002');
  assert.throws(
    () => buildDiagnosisRanking(snapshot([active], { consolidations: [] })),
    /complete current consolidation state/,
  );
  assert.throws(
    () => buildDiagnosisRanking(snapshot([active], {
      consolidations: [consolidation(1, active, {
        policyVersion: 'diagnosis-consolidation-v0',
      })],
    })),
    /stale consolidation policy version/,
  );
});

test('materialization persists the deterministic ranking for the current version tuple', async () => {
  const active = finding(1, 'TIME-002', { evidenceStrength: 'MEDIUM' });
  const source = snapshot([active]);
  let persistedDraft = null;
  let sourceChecks = 0;

  const repository = {
    async getCurrentScope(appUserId, scopeKey, versions) {
      assert.equal(appUserId, 7);
      assert.equal(scopeKey, source.scopeKey);
      assert.equal(versions.policyVersions.ranking, 'diagnosis-ranking-v1');
      return source;
    },
    async assertCurrentSourceReferences(appUserId, current) {
      assert.equal(appUserId, 7);
      assert.equal(current.id, source.id);
      sourceChecks += 1;
    },
    async replaceCurrentRankings(appUserId, findingSetId, policyVersion, rankings) {
      assert.equal(appUserId, 7);
      assert.equal(findingSetId, source.id);
      assert.equal(policyVersion, 'diagnosis-ranking-v1');
      persistedDraft = rankings;
      return rankings.map((row, index) => ({
        id: index + 1,
        findingSetId,
        ...row,
        components: row.components,
        rawEffect: row.rawEffect,
        support: row.support,
      }));
    },
  };

  const result = await materializeCurrentDiagnosisRanking(
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

  assert.equal(sourceChecks, 1);
  assert.ok(persistedDraft);
  assert.equal(persistedDraft.length, 1);
  assert.equal(result.findingSetId, source.id);
  assert.equal(result.rankingPolicyVersion, 'diagnosis-ranking-v1');
  assert.equal(result.calculationVersion, 'diagnosis-ranking-execution-v1');
});
