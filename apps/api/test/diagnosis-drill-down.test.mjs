import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosisDrillDownResponseSchema } from '@why-i-suck-at-chess/contracts';
import { buildApp } from '../dist/app.js';
import {
  createPrismaDiagnosisDrillDownRepository,
} from '../dist/modules/diagnosis/diagnosis-drill-down.repository.prisma.js';
import {
  createDiagnosisDrillDownService,
} from '../dist/modules/diagnosis/diagnosis-drill-down.service.js';

function summary(overrides = {}) {
  return {
    status: 'AVAILABLE',
    scopeKey: 'overall',
    findingSetId: 71,
    calculationAsOf: '2026-10-03T16:00:00.000Z',
    versions: {
      taxonomy: 'diagnostic-taxonomy-v1',
      synthesis: 'diagnosis-synthesis-v1',
      calculation: 'finding-materialization-v1',
      ranking: 'diagnosis-ranking-v1',
    },
    items: [{
      findingId: 1,
      findingKey: 'clock-root',
      diagnosisId: 'CLOCK_MANAGEMENT_DRIVING_TACTICAL_COLLAPSE',
      findingLevel: 'ROOT_CAUSE_CANDIDATE',
      observationState: 'PROBLEM_DETECTED',
      claimKey: 'root.clock-management-driving-tactical-collapse',
      evidenceStrength: 'HIGH',
      sampleCount: 20,
      distinctGameCount: 14,
      distinctSessionCount: 4,
      requiredEvidenceCoverage: 0.9,
      effect: null,
      consolidationState: 'TOP_LEVEL',
      rankPosition: 1,
      finalScore: 0.82,
      representativeEvidence: [],
    }],
    ...overrides,
  };
}

function childRanking(overrides = {}) {
  return {
    findingId: 2,
    finalScore: 0.68,
    rankingPolicyVersion: 'diagnosis-ranking-v1',
    consolidationState: 'TOP_LEVEL',
    parentRootFindingIds: [1],
    finding: {
      id: 2,
      findingKey: 'time-pressure-collapse',
      diagnosisId: 'TIME-002',
      findingLevel: 'MECHANISM',
      observationState: 'PROBLEM_DETECTED',
      claimKey: 'timing.move-quality-collapse-under-pressure',
      sampleCount: 18,
      distinctGameCount: 11,
      distinctSessionCount: 3,
      requiredEvidenceCoverage: 0.81,
      evidenceStrength: 'HIGH',
      effectMetric: 'average-score-loss-delta',
      effectValue: 52,
      effectUnit: 'CENTIPAWNS',
      effectDirection: 'HIGHER_IS_WORSE',
      evidenceReferences: [{
        referenceKey: 'support-event-1',
        referenceType: 'IMPORTED_GAME',
        importedGameId: 91,
        sourcePlyStart: 30,
        sourcePlyEnd: 30,
        eventIdentityKey: 'diagnosis-event-identity-v1|ply|g:91|p:30|k:test|v:v1',
      }],
      consolidationState: {
        state: 'TOP_LEVEL',
        policyVersion: 'diagnosis-consolidation-v1',
      },
      supportRoles: ['MECHANISM'],
    },
    ...overrides,
  };
}

test('diagnosis drill-down reuses summary authority and projects persisted child ranking state', async () => {
  const calls = [];
  const summaryService = {
    async getSummary(appUserId, scopeKey) {
      calls.push(['summary', appUserId, scopeKey]);
      return summary();
    },
  };
  const repository = {
    async findSupportingRankings(appUserId, findingSetId, scopeKey, findingId) {
      calls.push(['children', appUserId, findingSetId, scopeKey, findingId]);
      return [childRanking()];
    },
  };
  const service = createDiagnosisDrillDownService(repository, summaryService);

  const response = await service.getFinding(42, 'overall', 1);
  diagnosisDrillDownResponseSchema.parse(response);

  assert.equal(response.status, 'AVAILABLE');
  assert.equal(response.finding.findingId, 1);
  assert.deepEqual(
    response.supportingFindings.map((item) => [
      item.findingId,
      item.supportRole,
      item.finalScore,
    ]),
    [[2, 'MECHANISM', 0.68]],
  );
  assert.equal(response.supportingFindings[0].representativeEvidence.length, 1);
  assert.deepEqual(calls, [
    ['summary', 42, 'overall'],
    ['children', 42, 71, 'overall', 1],
  ]);
});

test('diagnosis drill-down rejects ids outside the current top-level summary', async () => {
  let repositoryCalled = false;
  const service = createDiagnosisDrillDownService(
    {
      async findSupportingRankings() {
        repositoryCalled = true;
        return [];
      },
    },
    { async getSummary() { return summary(); } },
  );

  assert.deepEqual(await service.getFinding(42, 'overall', 2), {
    status: 'UNAVAILABLE',
    scopeKey: 'overall',
    reason: 'FINDING_NOT_FOUND',
  });
  assert.equal(repositoryCalled, false);
});

test('diagnosis drill-down fails closed on stale ranking or inconsistent support hierarchy', async () => {
  const stale = createDiagnosisDrillDownService(
    {
      async findSupportingRankings() {
        return [childRanking({ rankingPolicyVersion: 'diagnosis-ranking-v0' })];
      },
    },
    { async getSummary() { return summary(); } },
  );
  assert.deepEqual(await stale.getFinding(42, 'overall', 1), {
    status: 'UNAVAILABLE',
    scopeKey: 'overall',
    reason: 'RANKING_STALE',
  });

  const missingRole = createDiagnosisDrillDownService(
    {
      async findSupportingRankings() {
        const row = childRanking();
        row.finding = { ...row.finding, supportRoles: [] };
        return [row];
      },
    },
    { async getSummary() { return summary(); } },
  );
  assert.deepEqual(await missingRole.getFinding(42, 'overall', 1), {
    status: 'UNAVAILABLE',
    scopeKey: 'overall',
    reason: 'HIERARCHY_INCOMPLETE',
  });

  const wrongParent = createDiagnosisDrillDownService(
    {
      async findSupportingRankings() {
        return [childRanking({ parentRootFindingIds: [999] })];
      },
    },
    { async getSummary() { return summary(); } },
  );
  assert.deepEqual(await wrongParent.getFinding(42, 'overall', 1), {
    status: 'UNAVAILABLE',
    scopeKey: 'overall',
    reason: 'RANKING_INCOMPLETE',
  });
});

test('Prisma drill-down read is ownership scoped and projects only bounded evidence/support role', async () => {
  let captured = null;
  const repository = createPrismaDiagnosisDrillDownRepository({
    diagnosisFindingSet: {
      async findFirst(args) {
        captured = args;
        return { rankings: [] };
      },
    },
  });

  assert.deepEqual(
    await repository.findSupportingRankings(73, 71, 'overall', 1),
    [],
  );
  assert.deepEqual(captured.where, {
    id: 71,
    appUserId: 73,
    scopeKey: 'overall',
    isCurrent: true,
    supersededAt: null,
  });
  assert.deepEqual(captured.select.rankings.where, {
    topLevelRanked: false,
    parentRootFindingIds: { has: 1 },
    finding: { is: { findingSetId: 71 } },
  });
  assert.equal(
    captured.select.rankings.select.finding.select.evidenceReferences.take,
    3,
  );
  assert.deepEqual(
    captured.select.rankings.select.finding.select.supportsRootCandidates.where,
    { rootFindingId: 1, findingSetId: 71 },
  );
  assert.equal(
    captured.select.rankings.select.finding.select.supportsRootCandidates.take,
    2,
  );
  assert.equal('componentsJson' in captured.select.rankings.select, false);
  assert.equal('supportJson' in captured.select.rankings.select, false);
  assert.equal('coverageJson' in captured.select.rankings.select.finding.select, false);
  assert.equal('sourceVersionsJson' in captured.select.rankings.select.finding.select, false);
});

test('HTTP diagnosis drill-down route passes authenticated ownership and validates path/query', async () => {
  const calls = [];
  const drillDownService = {
    async getFinding(userId, scopeKey, findingId) {
      calls.push([userId, scopeKey, findingId]);
      return {
        status: 'UNAVAILABLE',
        scopeKey,
        reason: 'FINDING_NOT_FOUND',
      };
    },
  };
  const app = await buildApp({
    prisma: { $disconnect: async () => undefined },
    authConfig: { mode: 'dev-single-user' },
    currentUserService: {
      async resolveDevUser() {
        return { auth: { userId: 314, provider: 'dev', externalSubject: 'diagnosis-drilldown-test' } };
      },
      async resolveExternalUser() {
        throw new Error('not used in dev mode');
      },
    },
    diagnosisDrillDownService: drillDownService,
  });

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/diagnosis/findings/7?scopeKey=overall',
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: 'UNAVAILABLE',
      scopeKey: 'overall',
      reason: 'FINDING_NOT_FOUND',
    });

    const invalidId = await app.inject({
      method: 'GET',
      url: '/api/diagnosis/findings/nope?scopeKey=overall',
    });
    assert.equal(invalidId.statusCode, 400);

    const missingScope = await app.inject({
      method: 'GET',
      url: '/api/diagnosis/findings/7',
    });
    assert.equal(missingScope.statusCode, 400);
  } finally {
    await app.close();
  }

  assert.deepEqual(calls, [[314, 'overall', 7]]);
});
