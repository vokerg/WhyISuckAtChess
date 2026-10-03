import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
