import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosisSummaryResponseSchema } from '@why-i-suck-at-chess/contracts';
import { buildApp } from '../dist/app.js';
import {
  createPrismaDiagnosisSummaryRepository,
} from '../dist/modules/diagnosis/diagnosis-summary.repository.prisma.js';
import {
  createDiagnosisSummaryService,
} from '../dist/modules/diagnosis/diagnosis-summary.service.js';

const CURRENT_POLICIES = {
  consolidation: 'diagnosis-consolidation-v1',
  ranking: 'diagnosis-ranking-v1',
};

function finding({
  id,
  findingKey,
  diagnosisId,
  rankPosition,
  topLevelRanked = true,
  topLevelEligible = true,
  effect = true,
}) {
  return {
    id,
    findingKey,
    diagnosisId,
    findingLevel: diagnosisId.startsWith('CLOCK_') ? 'ROOT_CAUSE_CANDIDATE' : 'MECHANISM',
    observationState: 'PROBLEM_DETECTED',
    claimKey: 'fixture.' + diagnosisId.toLowerCase(),
    sampleCount: 12,
    distinctGameCount: 8,
    distinctSessionCount: 3,
    requiredEvidenceCoverage: 0.75,
    evidenceStrength: 'MEDIUM',
    effectMetric: effect ? 'average-score-loss' : null,
    effectValue: effect ? 64 : null,
    effectUnit: effect ? 'CENTIPAWNS' : null,
    effectDirection: effect ? 'HIGHER_IS_WORSE' : null,
    evidenceReferences: [{
      referenceKey: findingKey + '-example',
      referenceType: 'IMPORTED_GAME',
      importedGameId: id + 100,
      sourcePlyStart: 20,
      sourcePlyEnd: 20,
      eventIdentityKey: 'diagnosis-event-identity-v1|game|g:' + (id + 100) + '|k:test|v:v1|d:1',
    }],
    consolidationState: {
      state: 'TOP_LEVEL',
      topLevelEligible,
      policyVersion: 'diagnosis-consolidation-v1',
    },
    rankingState: rankPosition === undefined
      ? null
      : {
          topLevelRanked,
          rankPosition,
          finalScore: topLevelRanked ? 0.8 - (rankPosition ?? 0) * 0.1 : 0.52,
          rankingPolicyVersion: 'diagnosis-ranking-v1',
          consolidationState: 'TOP_LEVEL',
        },
  };
}

function findingSet(overrides = {}) {
  return {
    id: 71,
    scopeKey: 'overall',
    taxonomyVersion: 'diagnostic-taxonomy-v1',
    synthesisPolicyVersion: 'diagnosis-synthesis-v1',
    calculationVersion: 'finding-materialization-v1',
    policyVersions: CURRENT_POLICIES,
    calculationAsOf: new Date('2026-10-03T16:00:00.000Z'),
    findings: [
      finding({
        id: 3,
        findingKey: 'opening-unrelated',
        diagnosisId: 'OPEN-003',
        rankPosition: 2,
      }),
      finding({
        id: 2,
        findingKey: 'time-child',
        diagnosisId: 'TIME-004',
        rankPosition: null,
        topLevelRanked: false,
      }),
      finding({
        id: 1,
        findingKey: 'clock-root',
        diagnosisId: 'CLOCK_MANAGEMENT_DRIVING_TACTICAL_COLLAPSE',
        rankPosition: 1,
        effect: false,
      }),
    ],
    ...overrides,
  };
}

test('diagnosis summary exposes persisted top-level ranking without recomputation', async () => {
  const calls = [];
  const repository = {
    async findCurrent(appUserId, scopeKey) {
      calls.push([appUserId, scopeKey]);
      return findingSet();
    },
  };
  const service = createDiagnosisSummaryService(repository);

  const response = await service.getSummary(42, 'overall');
  diagnosisSummaryResponseSchema.parse(response);

  assert.equal(response.status, 'AVAILABLE');
  assert.deepEqual(calls, [[42, 'overall']]);
  assert.deepEqual(
    response.items.map((item) => [item.findingId, item.rankPosition]),
    [[1, 1], [3, 2]],
  );
  assert.equal(response.items[0].effect, null);
  assert.equal(response.items[0].representativeEvidence.length, 1);
  assert.equal(response.items.some((item) => item.findingId === 2), false);
});

test('diagnosis summary fails closed on stale or incomplete hierarchy state', async () => {
  const stale = createDiagnosisSummaryService({
    async findCurrent() {
      return findingSet({
        policyVersions: { ...CURRENT_POLICIES, ranking: 'diagnosis-ranking-v0' },
      });
    },
  });
  assert.deepEqual(await stale.getSummary(42, 'overall'), {
    status: 'UNAVAILABLE',
    scopeKey: 'overall',
    reason: 'RANKING_STALE',
  });

  const incomplete = createDiagnosisSummaryService({
    async findCurrent() {
      const row = findingSet();
      row.findings[0] = { ...row.findings[0], rankingState: null };
      return row;
    },
  });
  assert.deepEqual(await incomplete.getSummary(42, 'overall'), {
    status: 'UNAVAILABLE',
    scopeKey: 'overall',
    reason: 'RANKING_INCOMPLETE',
  });

  const noHierarchy = createDiagnosisSummaryService({
    async findCurrent() {
      const row = findingSet();
      row.findings[0] = { ...row.findings[0], consolidationState: null };
      return row;
    },
  });
  assert.deepEqual(await noHierarchy.getSummary(42, 'overall'), {
    status: 'UNAVAILABLE',
    scopeKey: 'overall',
    reason: 'HIERARCHY_INCOMPLETE',
  });
});

test('Prisma diagnosis summary read is ownership scoped and bounds representative evidence', async () => {
  let captured = null;
  const repository = createPrismaDiagnosisSummaryRepository({
    diagnosisFindingSet: {
      async findFirst(args) {
        captured = args;
        return null;
      },
    },
  });

  assert.equal(await repository.findCurrent(73, 'overall'), null);
  assert.deepEqual(captured.where, {
    appUserId: 73,
    scopeKey: 'overall',
    isCurrent: true,
    supersededAt: null,
  });
  assert.deepEqual(
    captured.select.findings.select.evidenceReferences.where,
    { representative: true },
  );
  assert.equal(captured.select.findings.select.evidenceReferences.take, 3);
  assert.equal('coverageJson' in captured.select.findings.select, false);
  assert.equal('sourceVersionsJson' in captured.select.findings.select, false);
});

test('HTTP diagnosis summary route passes authenticated ownership and validates scope', async () => {
  const calls = [];
  const service = {
    async getSummary(userId, scopeKey) {
      calls.push([userId, scopeKey]);
      return {
        status: 'UNAVAILABLE',
        scopeKey,
        reason: 'NO_CURRENT_DIAGNOSIS',
      };
    },
  };
  const app = await buildApp({
    prisma: { $disconnect: async () => undefined },
    authConfig: { mode: 'dev-single-user' },
    currentUserService: {
      async resolveDevUser() {
        return { auth: { userId: 314, provider: 'dev', externalSubject: 'diagnosis-read-test' } };
      },
      async resolveExternalUser() {
        throw new Error('not used in dev mode');
      },
    },
    diagnosisSummaryService: service,
  });

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/diagnosis/summary?scopeKey=overall',
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: 'UNAVAILABLE',
      scopeKey: 'overall',
      reason: 'NO_CURRENT_DIAGNOSIS',
    });

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/diagnosis/summary',
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await app.close();
  }

  assert.deepEqual(calls, [[314, 'overall']]);
});
