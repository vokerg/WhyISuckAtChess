import '@angular/compiler';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  diagnosisDrillDownResponseSchema,
  type DiagnosisSummaryItem,
  type DiagnosisSummaryRepresentativeEvidence,
} from '@why-i-suck-at-chess/contracts';
import { readFile } from 'node:fs/promises';
import { routes } from '../src/app/app.routes';
import {
  diagnosisDrillDownUnavailableMessage,
  diagnosisFindingHref,
  diagnosisSupportRoleLabel,
  parseDiagnosisFindingId,
} from '../src/app/features/diagnosis/helpers/diagnosis-drill-down-view-model';
import {
  diagnosisCoverageLabel,
  diagnosisEffectLabel,
  diagnosisEvidenceHref,
  diagnosisEvidenceLabel,
  diagnosisTitle,
  diagnosisUnavailableMessage,
} from '../src/app/features/diagnosis/helpers/diagnosis-summary-view-model';

function finding(overrides: Partial<DiagnosisSummaryItem> = {}): DiagnosisSummaryItem {
  return {
    findingId: 7,
    findingKey: 'time-pressure-collapse',
    diagnosisId: 'TIME-002',
    findingLevel: 'MECHANISM',
    observationState: 'PROBLEM_DETECTED',
    claimKey: 'timing.move-quality-collapse-under-pressure',
    evidenceStrength: 'HIGH',
    sampleCount: 24,
    distinctGameCount: 12,
    distinctSessionCount: 4,
    requiredEvidenceCoverage: 0.82,
    effect: {
      metric: 'average-score-loss',
      value: 64,
      unit: 'CENTIPAWNS',
      direction: 'HIGHER_IS_WORSE',
    },
    consolidationState: 'TOP_LEVEL',
    rankPosition: 1,
    finalScore: 0.73,
    representativeEvidence: [],
    ...overrides,
  };
}

test('diagnosis presentation maps persisted findings without changing their semantics', () => {
  const item = finding();
  assert.equal(diagnosisTitle(item), 'Move quality collapses under time pressure');
  assert.equal(diagnosisCoverageLabel(item.requiredEvidenceCoverage), '82%');
  assert.equal(
    diagnosisEffectLabel(item),
    'Average score loss · 64 · Centipawns · (higher is worse)',
  );
});

test('diagnosis unavailable reasons remain explicit', () => {
  assert.match(
    diagnosisUnavailableMessage('NO_CURRENT_DIAGNOSIS'),
    /No current diagnosis is available yet/,
  );
  assert.match(
    diagnosisUnavailableMessage('RANKING_STALE'),
    /older policy generation/,
  );
});

test('representative imported-game evidence links to the existing replay route', () => {
  const evidence: DiagnosisSummaryRepresentativeEvidence = {
    referenceKey: 'event-42',
    referenceType: 'IMPORTED_GAME',
    importedGameId: 42,
    sourcePlyStart: 31,
    sourcePlyEnd: 31,
    eventIdentityKey: 'event-42',
  };
  assert.equal(diagnosisEvidenceHref(evidence), '/games/42');
  assert.equal(diagnosisEvidenceLabel(evidence), 'Game 42 · ply 31');
});

test('diagnosis is the default route while imported games remain directly reachable', () => {
  assert.equal(routes[0]?.path, '');
  assert.equal(routes[0]?.redirectTo, 'diagnosis');
  assert.equal(routes.some((route) => route.path === 'diagnosis'), true);
  assert.equal(routes.some((route) => route.path === 'games'), true);
});

test('diagnosis drill-down links and route parameter validation are bounded', async () => {
  assert.equal(diagnosisFindingHref(7), '/diagnosis/7');
  assert.equal(diagnosisFindingHref(Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(parseDiagnosisFindingId('7'), 7);
  for (const raw of [null, '', '0', '-2', '1.5', '7x', '01', '9007199254740992']) {
    assert.equal(parseDiagnosisFindingId(raw), null);
  }
  assert.equal(routes.some((route) => route.path === 'diagnosis/:findingId'), true);
  const source = await readFile(
    new URL('../src/app/features/diagnosis/pages/diagnosis-summary-page.component.html', import.meta.url),
    'utf8',
  );
  assert.match(source, /findingHrefFor\(item\.findingId\)/);
});

test('drill-down exposes explicit unavailable and backend support-role labels', () => {
  assert.match(diagnosisDrillDownUnavailableMessage('FINDING_NOT_FOUND'), /not in the current ranked diagnosis/);
  assert.equal(
    diagnosisDrillDownUnavailableMessage('RANKING_INCOMPLETE'),
    diagnosisUnavailableMessage('RANKING_INCOMPLETE'),
  );
  assert.equal(diagnosisSupportRoleLabel('MECHANISM'), 'Supporting mechanism');
  assert.equal(diagnosisSupportRoleLabel('CONDITION_OR_OBSERVATION'), 'Condition or observation');
  assert.equal(diagnosisSupportRoleLabel('ADDITIONAL_SUPPORT'), 'Additional support');
});

test('drill-down contract keeps unranked supporting findings and bounded evidence', () => {
  const parent = finding();
  const { rankPosition, ...childFields } = finding({
    findingId: 8,
    findingKey: 'time-pressure-context',
    diagnosisId: 'TIME-001',
  });
  assert.equal(rankPosition, 1);
  const child = { ...childFields, supportRole: 'MECHANISM' };
  const response = {
    status: 'AVAILABLE',
    scopeKey: 'overall',
    findingSetId: 12,
    calculationAsOf: '2026-10-04T05:00:00.000Z',
    versions: {
      taxonomy: 'diagnostic-taxonomy-v1',
      synthesis: 'diagnosis-synthesis-v1',
      calculation: 'diagnosis-candidates-v1',
      ranking: 'diagnosis-ranking-v1',
    },
    finding: parent,
    supportingFindings: [child],
  };
  const parsed = diagnosisDrillDownResponseSchema.parse(response);
  assert.equal(parsed.status, 'AVAILABLE');
  if (parsed.status === 'AVAILABLE') {
    assert.deepEqual(parsed.supportingFindings.map((item) => item.findingId), [8]);
    assert.equal(parsed.supportingFindings[0]?.finalScore, child.finalScore);
    assert.equal('rankPosition' in parsed.supportingFindings[0], false);
  }
  assert.throws(() => diagnosisDrillDownResponseSchema.parse({
    ...response,
    supportingFindings: [{ ...child, rankPosition: 2 }],
  }));
  assert.throws(() => diagnosisDrillDownResponseSchema.parse({
    ...response,
    supportingFindings: [{ ...child, supportRole: 'INFERRED_ROLE' }],
  }));
  assert.throws(() => diagnosisDrillDownResponseSchema.parse({
    ...response,
    supportingFindings: Array(201).fill(child),
  }));
  assert.throws(() => diagnosisDrillDownResponseSchema.parse({
    ...response,
    supportingFindings: [{
      ...child,
      representativeEvidence: Array(4).fill({
        referenceKey: 'event',
        referenceType: 'IMPORTED_GAME',
        importedGameId: 42,
        sourcePlyStart: 5,
        sourcePlyEnd: 5,
        eventIdentityKey: 'event',
      }),
    }],
  }));
});
