import '@angular/compiler';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  diagnosisDrillDownResponseSchema,
  type DiagnosisSummaryItem,
  type DiagnosisSummaryRepresentativeEvidence,
} from '@why-i-suck-at-chess/contracts';
import { routes } from '../src/app/app.routes';
import { DOCUMENT } from '@angular/common';
import { createEnvironmentInjector, Injector, runInInjectionContext, type EnvironmentInjector } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { LichessOnboardingApiService } from '../src/app/features/lichess/data-access/lichess-onboarding-api.service';
import { LichessOnboardingStore } from '../src/app/features/lichess/state/lichess-onboarding.store';
import type { LichessConnectionStatus, LichessImportRun } from '@why-i-suck-at-chess/contracts';

import {
  apiErrorCode,
  apiErrorMessage,
  callbackDescription,
  credentialDescription,
  importScope,
  isActiveImport,
  localDateTimeValue,
  safeImportError,
} from '../src/app/features/lichess/helpers/lichess-onboarding-view-model';

import { diagnosisEvidenceGuideEntries } from '../src/app/features/diagnosis/components/diagnosis-evidence-guide.component';
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
  diagnosisEvidenceQueryParams,
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

test('diagnosis interpretation explains priority, evidence and source denominators without invented claims', () => {
  const entries = new Map(diagnosisEvidenceGuideEntries.map(({ label, description }) => [label, description]));
  assert.equal(entries.size, 6);
  assert.match(entries.get('Rank and score') ?? '', /not a probability/i);
  assert.match(entries.get('Rank and score') ?? '', /no independent top-level rank/i);
  assert.match(entries.get('Evidence strength') ?? '', /not statistical significance/i);
  assert.match(entries.get('Evidence strength') ?? '', /weaker group/i);
  assert.match(entries.get('Samples, games, and sessions') ?? '', /not interchangeable/i);
  assert.match(entries.get('Required coverage') ?? '', /not the percentage of games/i);
  assert.match(entries.get('Measured effect') ?? '', /not a forecast/i);
  assert.match(entries.get('Representative evidence') ?? '', /not the complete sample/i);
});

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
  assert.deepEqual(diagnosisEvidenceQueryParams(evidence), { ply: 31 });
  assert.equal(diagnosisEvidenceLabel(evidence), 'Game 42 · ply 31');
  assert.deepEqual(diagnosisEvidenceQueryParams({ ...evidence, sourcePlyEnd: 34 }), { ply: 31 });
  for (const ply of [null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(diagnosisEvidenceQueryParams({ ...evidence, sourcePlyStart: ply }), null);
  }
  assert.equal(diagnosisEvidenceQueryParams({ ...evidence, sourcePlyEnd: 30 }), null);
  assert.equal(diagnosisEvidenceQueryParams({ ...evidence, importedGameId: null }), null);
});

test('diagnosis is the default route while imported games remain directly reachable', () => {
  assert.equal(routes[0]?.path, '');
  assert.equal(routes[0]?.redirectTo, 'diagnosis');
  assert.equal(routes.some((route) => route.path === 'diagnosis'), true);
  assert.equal(routes.some((route) => route.path === 'games'), true);
});

test('diagnosis drill-down links and route parameter validation are bounded', () => {
  assert.equal(diagnosisFindingHref(7), '/diagnosis/7');
  assert.equal(diagnosisFindingHref(Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(parseDiagnosisFindingId('7'), 7);
  for (const raw of [null, '', '0', '-2', '1.5', '7x', '01', '9007199254740992']) {
    assert.equal(parseDiagnosisFindingId(raw), null);
  }
  assert.equal(routes.some((route) => route.path === 'diagnosis/:findingId'), true);
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

test('Lichess onboarding is routed without replacing the diagnosis default or game replay', () => {
  assert.equal(routes.find((r) => r.path === '')?.redirectTo, 'diagnosis');
  assert.ok(routes.find((r) => r.path === 'settings/lichess')?.component);
  assert.ok(routes.find((r) => r.path === 'games/:gameId')?.component);
});

test('import scope uses explicit bounded UTC instants, validates invalid/future requests', () => {
  const now = new Date('2026-10-05T09:30:00.000Z');
  const from = '2026-09-05T07:30';
  const to = '2026-10-05T07:30';
  const all = importScope(from, to, 'any', now);
  assert.ok(all.request);
  assert.equal(all.error, null);
  assert.equal(all.request.from, new Date(from).toISOString());
  assert.equal(all.request.to, new Date(to).toISOString());
  assert.equal('rated' in all.request, false);
  assert.equal(importScope(from, to, 'rated', now).request?.rated, true);
  assert.equal(importScope(from, to, 'casual', now).request?.rated, false);
  assert.match(importScope(to, from, 'any', now).error ?? '', /after start/);
  assert.equal(importScope('', to, 'any', now).request, null);
  assert.equal(importScope(from, 'invalid', 'any', now).request, null);
  assert.equal(importScope('2026-02-30T07:30', to, 'any', now).request, null);
  assert.equal(importScope(from, '2027-01-01T10:00', 'any', now).request, null);
  assert.match(localDateTimeValue(new Date(from)), /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/);
});

test('OAuth query strings cannot assert connection and credential states remain distinct', () => {
  assert.match(callbackDescription('1') ?? '', /verified by the server/);
  assert.match(callbackDescription('cancelled') ?? '', /cancelled/);
  assert.match(callbackDescription('error') ?? '', /failed/);
  assert.match(callbackDescription('conflict') ?? '', /another application user/);
  assert.equal(callbackDescription('unexpected'), null);
  for (const state of ['expired', 'revoked', 'undecryptable'] as const) {
    assert.match(credentialDescription(state), /reconnect/i);
  }
  assert.match(credentialDescription('missing'), /No Lichess identity/);
  assert.match(credentialDescription('usable'), /Usable/);
});

test('import progress status and errors distinguish auth, provider and application authorization', () => {
  for (const state of ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'] as const) assert.equal(isActiveImport(state), true);
  for (const state of ['COMPLETED', 'CANCELLED', 'FAILED'] as const) assert.equal(isActiveImport(state), false);
  assert.match(safeImportError('RATE_LIMITED'), /retry automatically/);
  assert.match(safeImportError('AUTH_REVOKED'), /Reconnect/);
  assert.match(safeImportError('PROVIDER_HTTP_ERROR'), /provider/);
  assert.equal(apiErrorCode({ error: { code: 'ACTIVE_IMPORT' } }), 'ACTIVE_IMPORT');
  assert.equal(apiErrorCode({ error: { code: 7 } }), null);
  assert.match(apiErrorMessage({ status: 401 }, 'failed'), /Application authentication/);
  assert.equal(apiErrorMessage({ status: 500 }, 'failed'), 'failed');
});

function onboardingRun(status: LichessImportRun['status']): LichessImportRun {
  return {
    id: 7, provider: 'LICHESS', status,
    lichessUserIdSnapshot: 'lichess-owner', lichessUsernameSnapshot: 'Owner',
    scope: { provider: 'LICHESS', speeds: ['bullet', 'blitz', 'rapid'] },
    requestedFrom: '2026-09-01T00:00:00.000Z',
    requestedTo: '2026-09-30T00:00:00.000Z',
    windowsTotal: 1, windowsCompleted: 0, gamesSeen: 0, gamesMatchedScope: 0,
    gamesImported: 0, gamesDuplicate: 0, gamesUpdated: 0, gamesSkipped: 0,
    gamesFailed: 0, gamesSkippedOutOfScope: 0, errorCode: null, error: null,
    lastProgressAt: null, rateLimitUntil: null, startedAt: null, completedAt: null,
  };
}

const connected: LichessConnectionStatus = {
  connected: true, credentialState: 'usable', reconnectRequired: false,
  account: {
    lichessUserId: 'lichess-owner',
    username: 'Owner',
    scopes: [],
    connectedAt: '2026-09-01T00:00:00.000Z',
    expiresAt: null,
  },
};

function onboardingHarness(api: object) {
  const environment = createEnvironmentInjector([
    { provide: DOCUMENT, useValue: { defaultView: { confirm: () => true, location: { assign: () => undefined } } } },
    { provide: LichessOnboardingApiService, useValue: api },
  ], Injector.NULL as EnvironmentInjector);
  const store = runInInjectionContext(environment, () => new LichessOnboardingStore());
  return { store, destroy: () => environment.destroy() };
}

test('Lichess store recovers an active run and attaches to conflicts instead of issuing duplicates', async () => {
  let requested = 0;
  const api = {
    connection: () => of(connected),
    latest: () => of(onboardingRun('QUEUED')),
    create: () => { requested++; return of(onboardingRun('QUEUED')); },
  };
  const { store, destroy } = onboardingHarness(api);
  try {
    await store.load();
    assert.equal(store.usable, true);
    assert.equal(store.run()?.id, 7);
    await store.startImport();
    assert.equal(requested, 0, 'do not duplicate an already active run');
    assert.equal(store.run()?.status, 'QUEUED');
  } finally { destroy(); }

  const conflictApi = {
    connection: () => of(connected),
    latest: (() => {
      let calls = 0;
      return () => of(++calls === 1 ? null : onboardingRun('QUEUED'));
    })(),
    create: () => throwError(() => ({ status: 409, error: { code: 'ACTIVE_IMPORT' } })),
  };
  const conflict = onboardingHarness(conflictApi);
  try {
    await conflict.store.load();
    assert.equal(conflict.store.run(), null);
    await conflict.store.startImport();
    assert.equal(conflict.store.run()?.id, 7, 'recovers server run after 409');
    assert.match(conflict.store.notice() ?? '', /Recovered/);
  } finally { conflict.destroy(); }
});

test('polling cannot overlap and stale responses cannot restore a cancelled run', async () => {
  let requests = 0;
  const pending = new Subject<LichessImportRun>();
  const api = {
    connection: () => of(connected),
    latest: () => of(onboardingRun('RUNNING')),
    run: () => { requests++; return pending.asObservable(); },
    cancel: () => of(onboardingRun('CANCELLED')),
  };
  const { store, destroy } = onboardingHarness(api);
  try {
    await store.load();
    await new Promise((resolve) => setTimeout(resolve, 2650));
    assert.equal(requests, 1);
    await new Promise((resolve) => setTimeout(resolve, 2700));
    assert.equal(requests, 1, 'second poll cannot overlap pending request');
    await store.cancelImport();
    assert.equal(store.run()?.status, 'CANCELLED');
    pending.next(onboardingRun('RUNNING'));
    pending.complete();
    await Promise.resolve();
    assert.equal(store.run()?.status, 'CANCELLED', 'old poll is generation-fenced');
  } finally { destroy(); }
});
