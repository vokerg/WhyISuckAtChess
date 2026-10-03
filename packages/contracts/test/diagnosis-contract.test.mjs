import assert from 'node:assert/strict';
import test from 'node:test';
import {
  diagnosisDrillDownParamsSchema,
  diagnosisDrillDownQuerySchema,
  diagnosisDrillDownResponseSchema,
  diagnosisSummaryQuerySchema,
  diagnosisSummaryResponseSchema,
} from '../dist/index.js';

test('diagnosis summary query requires one bounded scope key', () => {
  assert.deepEqual(diagnosisSummaryQuerySchema.parse({ scopeKey: 'overall' }), {
    scopeKey: 'overall',
  });
  assert.equal(diagnosisSummaryQuerySchema.safeParse({}).success, false);
  assert.equal(
    diagnosisSummaryQuerySchema.safeParse({ scopeKey: 'overall', extra: true }).success,
    false,
  );
});

test('diagnosis summary response is strict, bounded, and serializable', () => {
  const response = {
    status: 'AVAILABLE',
    scopeKey: 'overall',
    findingSetId: 41,
    calculationAsOf: '2026-10-03T16:00:00.000Z',
    versions: {
      taxonomy: 'diagnostic-taxonomy-v1',
      synthesis: 'diagnosis-synthesis-v1',
      calculation: 'finding-materialization-v1',
      ranking: 'diagnosis-ranking-v1',
    },
    items: [{
      findingId: 7,
      findingKey: 'time-management-root',
      diagnosisId: 'CLOCK_MANAGEMENT_DRIVING_TACTICAL_COLLAPSE',
      findingLevel: 'ROOT_CAUSE_CANDIDATE',
      observationState: 'PROBLEM_DETECTED',
      claimKey: 'root.clock-management-driving-tactical-collapse',
      evidenceStrength: 'MEDIUM',
      sampleCount: 18,
      distinctGameCount: 12,
      distinctSessionCount: 4,
      requiredEvidenceCoverage: 0.8,
      effect: null,
      consolidationState: 'TOP_LEVEL',
      rankPosition: 1,
      finalScore: 0.73,
      representativeEvidence: [{
        referenceKey: 'root-event-0001',
        referenceType: 'ROOT_SYNTHESIS_EVENT',
        importedGameId: 99,
        sourcePlyStart: 24,
        sourcePlyEnd: 24,
        eventIdentityKey: 'diagnosis-event-identity-v1|game|g:99|k:test|v:v1|d:1',
      }],
    }],
  };

  assert.deepEqual(diagnosisSummaryResponseSchema.parse(response), response);
  assert.equal(
    diagnosisSummaryResponseSchema.safeParse({
      ...response,
      internalProvenance: { mustNotLeak: true },
    }).success,
    false,
  );
  assert.equal(
    diagnosisSummaryResponseSchema.safeParse({
      ...response,
      items: [{
        ...response.items[0],
        representativeEvidence: Array.from({ length: 4 }, (_, index) => ({
          ...response.items[0].representativeEvidence[0],
          referenceKey: 'event-' + index,
        })),
      }],
    }).success,
    false,
  );
});

test('diagnosis summary explicitly represents unavailable current output', () => {
  const unavailable = {
    status: 'UNAVAILABLE',
    scopeKey: 'overall',
    reason: 'RANKING_INCOMPLETE',
  };
  assert.deepEqual(diagnosisSummaryResponseSchema.parse(unavailable), unavailable);
});

test('diagnosis drill-down validates scope and positive finding id', () => {
  assert.deepEqual(diagnosisDrillDownParamsSchema.parse({ findingId: '17' }), {
    findingId: 17,
  });
  assert.deepEqual(diagnosisDrillDownQuerySchema.parse({ scopeKey: 'overall' }), {
    scopeKey: 'overall',
  });
  assert.equal(diagnosisDrillDownParamsSchema.safeParse({ findingId: '0' }).success, false);
  assert.equal(diagnosisDrillDownParamsSchema.safeParse({ findingId: 'abc' }).success, false);
});

test('diagnosis drill-down exposes bounded persisted support without internal blobs', () => {
  const finding = {
    findingId: 7,
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
  };
  const support = {
    findingId: 8,
    findingKey: 'time-pressure-collapse',
    diagnosisId: 'TIME-002',
    findingLevel: 'MECHANISM',
    observationState: 'PROBLEM_DETECTED',
    claimKey: 'timing.move-quality-collapse-under-pressure',
    evidenceStrength: 'HIGH',
    sampleCount: 18,
    distinctGameCount: 11,
    distinctSessionCount: 3,
    requiredEvidenceCoverage: 0.81,
    effect: {
      metric: 'average-score-loss-delta',
      value: 52,
      unit: 'CENTIPAWNS',
      direction: 'HIGHER_IS_WORSE',
    },
    consolidationState: 'TOP_LEVEL',
    finalScore: 0.68,
    representativeEvidence: [{
      referenceKey: 'support-event-1',
      referenceType: 'IMPORTED_GAME',
      importedGameId: 91,
      sourcePlyStart: 30,
      sourcePlyEnd: 30,
      eventIdentityKey: 'diagnosis-event-identity-v1|ply|g:91|p:30|k:test|v:v1',
    }],
    supportRole: 'MECHANISM',
  };
  const response = {
    status: 'AVAILABLE',
    scopeKey: 'overall',
    findingSetId: 41,
    calculationAsOf: '2026-10-03T16:00:00.000Z',
    versions: {
      taxonomy: 'diagnostic-taxonomy-v1',
      synthesis: 'diagnosis-synthesis-v1',
      calculation: 'finding-materialization-v1',
      ranking: 'diagnosis-ranking-v1',
    },
    finding,
    supportingFindings: [support],
  };

  assert.deepEqual(diagnosisDrillDownResponseSchema.parse(response), response);
  assert.equal(
    diagnosisDrillDownResponseSchema.safeParse({
      ...response,
      supportingFindings: [{ ...support, rankingComponents: [] }],
    }).success,
    false,
  );
  assert.equal(
    diagnosisDrillDownResponseSchema.safeParse({
      ...response,
      supportingFindings: [{
        ...support,
        representativeEvidence: Array.from({ length: 4 }, (_, index) => ({
          ...support.representativeEvidence[0],
          referenceKey: 'support-' + index,
        })),
      }],
    }).success,
    false,
  );
});

test('diagnosis drill-down explicitly represents missing current top-level finding', () => {
  const unavailable = {
    status: 'UNAVAILABLE',
    scopeKey: 'overall',
    reason: 'FINDING_NOT_FOUND',
  };
  assert.deepEqual(diagnosisDrillDownResponseSchema.parse(unavailable), unavailable);
});
