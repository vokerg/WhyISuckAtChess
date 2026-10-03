import '@angular/compiler';
import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  DiagnosisSummaryItem,
  DiagnosisSummaryRepresentativeEvidence,
} from '@why-i-suck-at-chess/contracts';
import { routes } from '../src/app/app.routes';
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
