import {
  DIAGNOSIS_BOUNDEDNESS_POLICY,
  DIAGNOSIS_EVENT_IDENTITY_VERSION,
  diagnosisSmallerArmOverlapRate,
  isCurrentDiagnosisEventIdentityKey,
  isMaterialDiagnosisEventOverlap,
  type DiagnosisEventOverlapSummary,
} from '@why-i-suck-at-chess/chess-domain';
import type {
  DiagnosisFindingRepository,
  DiagnosisFindingVersionTuple,
} from './diagnosis-finding.types';

export interface DiagnosisOverlapEvidenceReference {
  referenceKey: string;
  importedGameId?: number | null;
  sessionKey?: string | null;
  eventIdentityKey?: string | null;
}

export interface DiagnosisOverlapFinding {
  id?: number;
  findingKey: string;
  diagnosisId: string;
  distinctGameCount: number;
  distinctSessionCount: number;
  evidenceReferences: readonly DiagnosisOverlapEvidenceReference[];
}

export type DiagnosisReferenceCoverageStatus =
  | 'COMPLETE'
  | 'NO_REFERENCES'
  | 'INCOMPLETE_GAME_SET'
  | 'EVENT_IDENTITY_UNAVAILABLE'
  | 'STALE_EVENT_IDENTITY';

export interface DiagnosisReferenceCoverage {
  status: DiagnosisReferenceCoverageStatus;
  referenceCount: number;
  identifiedReferenceCount: number;
  uniqueEventCount: number;
  referencedDistinctGames: number;
  referencedDistinctSessions: number;
  declaredDistinctGames: number;
  declaredDistinctSessions: number;
  gameSetComplete: boolean;
  eventIdentityComplete: boolean;
  sessionContextComplete: boolean;
}

export interface DiagnosisEventOverlapResult {
  calculable: boolean;
  reason: string | null;
  leftEventCount: number;
  rightEventCount: number;
  intersectionEventCount: number | null;
  unionEventCount: number | null;
  leftOverlapRate: number | null;
  rightOverlapRate: number | null;
  smallerArmOverlapRate: number | null;
  jaccardRate: number | null;
  sharedDistinctGames: number | null;
  sharedDistinctSessions: number | null;
  largestSharedGameEventShare: number | null;
  material: boolean;
}

export interface DiagnosisGameSetOverlapResult {
  calculable: boolean;
  reason: string | null;
  leftDistinctGames: number;
  rightDistinctGames: number;
  intersectionGameCount: number | null;
  unionGameCount: number | null;
  leftOverlapRate: number | null;
  rightOverlapRate: number | null;
  jaccardRate: number | null;
  sharedDistinctSessions: number | null;
}

export interface DiagnosisFindingOverlapResult {
  eventIdentityVersion: typeof DIAGNOSIS_EVENT_IDENTITY_VERSION;
  left: {
    id: number | null;
    findingKey: string;
    diagnosisId: string;
    coverage: DiagnosisReferenceCoverage;
  };
  right: {
    id: number | null;
    findingKey: string;
    diagnosisId: string;
    coverage: DiagnosisReferenceCoverage;
  };
  eventOverlap: DiagnosisEventOverlapResult;
  gameSetOverlap: DiagnosisGameSetOverlapResult;
}

export interface DiagnosisFindingOverlapScopeResult {
  findingSetId: number;
  scopeKey: string;
  eventIdentityVersion: typeof DIAGNOSIS_EVENT_IDENTITY_VERSION;
  pairs: readonly DiagnosisFindingOverlapResult[];
}

interface PreparedReference {
  eventIdentityKey: string;
  importedGameId: number;
  sessionKey: string | null;
}

interface PreparedFinding {
  finding: DiagnosisOverlapFinding;
  coverage: DiagnosisReferenceCoverage;
  events: ReadonlyMap<string, PreparedReference>;
  gameIds: ReadonlySet<number>;
  sessionKeys: ReadonlySet<string>;
}

function validGameId(value: number | null | undefined): value is number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0;
}

function nonEmptySessionKey(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function intersectionSize<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): number {
  let count = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const value of small) {
    if (large.has(value)) count += 1;
  }
  return count;
}

function prepareFinding(finding: DiagnosisOverlapFinding): PreparedFinding {
  if (
    !Number.isSafeInteger(finding.distinctGameCount)
    || finding.distinctGameCount < 0
    || !Number.isSafeInteger(finding.distinctSessionCount)
    || finding.distinctSessionCount < 0
  ) {
    throw new RangeError(`Finding ${finding.findingKey} has invalid distinct counts.`);
  }
  if (
    finding.evidenceReferences.length
    > DIAGNOSIS_BOUNDEDNESS_POLICY.maxEvidenceEventReferencesPerFinding
  ) {
    throw new RangeError(`Finding ${finding.findingKey} exceeds the evidence-reference bound.`);
  }

  const gameIds = new Set<number>();
  const sessionKeys = new Set<string>();
  const events = new Map<string, PreparedReference>();
  let identifiedReferenceCount = 0;
  let missingGameReference = false;
  let missingEventIdentity = false;
  let staleEventIdentity = false;

  for (const reference of finding.evidenceReferences) {
    if (validGameId(reference.importedGameId)) {
      gameIds.add(reference.importedGameId);
    } else {
      missingGameReference = true;
    }

    if (nonEmptySessionKey(reference.sessionKey)) {
      sessionKeys.add(reference.sessionKey);
    }

    if (!reference.eventIdentityKey) {
      missingEventIdentity = true;
      continue;
    }
    if (!isCurrentDiagnosisEventIdentityKey(reference.eventIdentityKey)) {
      staleEventIdentity = true;
      continue;
    }
    if (!validGameId(reference.importedGameId)) {
      continue;
    }

    identifiedReferenceCount += 1;
    const prepared: PreparedReference = {
      eventIdentityKey: reference.eventIdentityKey,
      importedGameId: reference.importedGameId,
      sessionKey: nonEmptySessionKey(reference.sessionKey) ? reference.sessionKey : null,
    };
    const prior = events.get(reference.eventIdentityKey);
    if (
      prior
      && (
        prior.importedGameId !== prepared.importedGameId
        || prior.sessionKey !== prepared.sessionKey
      )
    ) {
      throw new Error(
        `Event identity collision in ${finding.findingKey}: ${reference.eventIdentityKey}`,
      );
    }
    events.set(reference.eventIdentityKey, prepared);
  }

  const noReferences = finding.evidenceReferences.length === 0;
  const gameSetComplete = !noReferences
    && !missingGameReference
    && gameIds.size >= finding.distinctGameCount
    && finding.distinctGameCount > 0;
  const eventIdentityComplete = gameSetComplete
    && !missingEventIdentity
    && !staleEventIdentity
    && identifiedReferenceCount === finding.evidenceReferences.length;
  const sessionContextComplete = finding.distinctSessionCount === 0
    || (
      !noReferences
      && finding.evidenceReferences.every((reference) => nonEmptySessionKey(reference.sessionKey))
      && sessionKeys.size >= finding.distinctSessionCount
    );

  let status: DiagnosisReferenceCoverageStatus;
  if (noReferences) {
    status = 'NO_REFERENCES';
  } else if (!gameSetComplete) {
    status = 'INCOMPLETE_GAME_SET';
  } else if (staleEventIdentity) {
    status = 'STALE_EVENT_IDENTITY';
  } else if (!eventIdentityComplete) {
    status = 'EVENT_IDENTITY_UNAVAILABLE';
  } else {
    status = 'COMPLETE';
  }

  return {
    finding,
    coverage: {
      status,
      referenceCount: finding.evidenceReferences.length,
      identifiedReferenceCount,
      uniqueEventCount: events.size,
      referencedDistinctGames: gameIds.size,
      referencedDistinctSessions: sessionKeys.size,
      declaredDistinctGames: finding.distinctGameCount,
      declaredDistinctSessions: finding.distinctSessionCount,
      gameSetComplete,
      eventIdentityComplete,
      sessionContextComplete,
    },
    events,
    gameIds,
    sessionKeys,
  };
}

function eventUnavailableReason(
  left: PreparedFinding,
  right: PreparedFinding,
): string {
  return [
    `left:${left.coverage.status}`,
    `right:${right.coverage.status}`,
  ].join(',');
}

function calculatePreparedOverlap(
  left: PreparedFinding,
  right: PreparedFinding,
): DiagnosisFindingOverlapResult {
  const gameSetCalculable = left.coverage.gameSetComplete && right.coverage.gameSetComplete;
  const sharedGameCount = gameSetCalculable
    ? intersectionSize(left.gameIds, right.gameIds)
    : null;
  const gameUnionCount = gameSetCalculable
    ? left.gameIds.size + right.gameIds.size - (sharedGameCount ?? 0)
    : null;
  const gameSessionCalculable = gameSetCalculable
    && left.coverage.sessionContextComplete
    && right.coverage.sessionContextComplete
    && (left.sessionKeys.size > 0 || right.sessionKeys.size > 0);
  const sharedGameSessions = gameSessionCalculable
    ? intersectionSize(left.sessionKeys, right.sessionKeys)
    : null;

  const eventCalculable = left.coverage.eventIdentityComplete
    && right.coverage.eventIdentityComplete;
  let eventOverlap: DiagnosisEventOverlapResult;

  if (!eventCalculable) {
    eventOverlap = {
      calculable: false,
      reason: eventUnavailableReason(left, right),
      leftEventCount: left.events.size,
      rightEventCount: right.events.size,
      intersectionEventCount: null,
      unionEventCount: null,
      leftOverlapRate: null,
      rightOverlapRate: null,
      smallerArmOverlapRate: null,
      jaccardRate: null,
      sharedDistinctGames: null,
      sharedDistinctSessions: null,
      largestSharedGameEventShare: null,
      material: false,
    };
  } else {
    const [smallEvents, largeEvents] = left.events.size <= right.events.size
      ? [left.events, right.events]
      : [right.events, left.events];
    const sharedEvents: PreparedReference[] = [];
    const sharedSessionKeys = new Set<string>();
    let sharedSessionContextComplete = true;

    for (const [eventIdentityKey, smallReference] of smallEvents) {
      const largeReference = largeEvents.get(eventIdentityKey);
      if (!largeReference) continue;
      if (smallReference.importedGameId !== largeReference.importedGameId) {
        throw new Error(`Cross-finding event identity collision: ${eventIdentityKey}`);
      }
      sharedEvents.push(smallReference);
      if (
        smallReference.sessionKey === null
        || largeReference.sessionKey === null
        || smallReference.sessionKey !== largeReference.sessionKey
      ) {
        sharedSessionContextComplete = false;
      } else {
        sharedSessionKeys.add(smallReference.sessionKey);
      }
    }

    const intersectionEventCount = sharedEvents.length;
    const unionEventCount = left.events.size + right.events.size - intersectionEventCount;
    const sharedEventGames = new Set(sharedEvents.map((reference) => reference.importedGameId));
    const eventsByGame = new Map<number, number>();
    for (const reference of sharedEvents) {
      eventsByGame.set(
        reference.importedGameId,
        (eventsByGame.get(reference.importedGameId) ?? 0) + 1,
      );
    }
    const largestSharedGameEventShare = intersectionEventCount === 0
      ? null
      : Math.max(...eventsByGame.values()) / intersectionEventCount;
    const summary: DiagnosisEventOverlapSummary = {
      calculable: true,
      leftEventCount: left.events.size,
      rightEventCount: right.events.size,
      intersectionEventCount,
      sharedDistinctGames: sharedEventGames.size,
      sharedDistinctSessions: sharedSessionContextComplete
        ? sharedSessionKeys.size
        : null,
    };

    eventOverlap = {
      calculable: true,
      reason: null,
      leftEventCount: left.events.size,
      rightEventCount: right.events.size,
      intersectionEventCount,
      unionEventCount,
      leftOverlapRate: ratio(intersectionEventCount, left.events.size),
      rightOverlapRate: ratio(intersectionEventCount, right.events.size),
      smallerArmOverlapRate: diagnosisSmallerArmOverlapRate(summary),
      jaccardRate: ratio(intersectionEventCount, unionEventCount),
      sharedDistinctGames: sharedEventGames.size,
      sharedDistinctSessions: summary.sharedDistinctSessions ?? null,
      largestSharedGameEventShare,
      material: isMaterialDiagnosisEventOverlap(summary),
    };
  }

  return {
    eventIdentityVersion: DIAGNOSIS_EVENT_IDENTITY_VERSION,
    left: {
      id: left.finding.id ?? null,
      findingKey: left.finding.findingKey,
      diagnosisId: left.finding.diagnosisId,
      coverage: left.coverage,
    },
    right: {
      id: right.finding.id ?? null,
      findingKey: right.finding.findingKey,
      diagnosisId: right.finding.diagnosisId,
      coverage: right.coverage,
    },
    eventOverlap,
    gameSetOverlap: {
      calculable: gameSetCalculable,
      reason: gameSetCalculable ? null : eventUnavailableReason(left, right),
      leftDistinctGames: left.gameIds.size,
      rightDistinctGames: right.gameIds.size,
      intersectionGameCount: sharedGameCount,
      unionGameCount: gameUnionCount,
      leftOverlapRate: sharedGameCount === null ? null : ratio(sharedGameCount, left.gameIds.size),
      rightOverlapRate: sharedGameCount === null ? null : ratio(sharedGameCount, right.gameIds.size),
      jaccardRate: sharedGameCount === null || gameUnionCount === null
        ? null
        : ratio(sharedGameCount, gameUnionCount),
      sharedDistinctSessions: sharedGameSessions,
    },
  };
}

export function calculateDiagnosisFindingOverlap(
  left: DiagnosisOverlapFinding,
  right: DiagnosisOverlapFinding,
): DiagnosisFindingOverlapResult {
  if (left.findingKey === right.findingKey) {
    throw new Error('Diagnosis overlap requires two distinct findings.');
  }
  return calculatePreparedOverlap(prepareFinding(left), prepareFinding(right));
}

function findingSortKey(finding: DiagnosisOverlapFinding): string {
  return [
    finding.id === undefined ? 'z' : 'a' + String(finding.id).padStart(12, '0'),
    finding.findingKey,
  ].join('|');
}

export function calculateDiagnosisFindingOverlaps(
  findings: readonly DiagnosisOverlapFinding[],
): readonly DiagnosisFindingOverlapResult[] {
  if (findings.length > DIAGNOSIS_BOUNDEDNESS_POLICY.maxCurrentFindingsPerScope) {
    throw new RangeError('Diagnosis overlap scope exceeds the current-finding bound.');
  }
  const keys = findings.map((finding) => finding.findingKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error('Diagnosis overlap scope contains duplicate finding keys.');
  }

  const prepared = [...findings]
    .sort((left, right) => findingSortKey(left).localeCompare(findingSortKey(right)))
    .map(prepareFinding);
  const pairs: DiagnosisFindingOverlapResult[] = [];
  for (let leftIndex = 0; leftIndex < prepared.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < prepared.length; rightIndex += 1) {
      pairs.push(calculatePreparedOverlap(prepared[leftIndex], prepared[rightIndex]));
    }
  }
  return pairs;
}

export async function getCurrentDiagnosisFindingOverlaps(
  appUserId: number,
  scopeKey: string,
  versions: DiagnosisFindingVersionTuple,
  repository: DiagnosisFindingRepository,
): Promise<DiagnosisFindingOverlapScopeResult> {
  if (!Number.isSafeInteger(appUserId) || appUserId <= 0) {
    throw new RangeError('appUserId must be a positive safe integer.');
  }
  if (scopeKey.length === 0 || scopeKey.length > 128) {
    throw new RangeError('scopeKey must contain 1-128 characters.');
  }

  const snapshot = await repository.getCurrentScope(appUserId, scopeKey, versions);
  if (!snapshot || !snapshot.isCurrent || snapshot.supersededAt !== null) {
    throw new Error('Current diagnosis finding scope is unavailable for the requested versions.');
  }

  return {
    findingSetId: snapshot.id,
    scopeKey: snapshot.scopeKey,
    eventIdentityVersion: DIAGNOSIS_EVENT_IDENTITY_VERSION,
    pairs: calculateDiagnosisFindingOverlaps(snapshot.findings),
  };
}
