import {
  DIAGNOSIS_BOUNDEDNESS_POLICY,
  DIAGNOSIS_EVIDENCE_STRENGTHS,
  DIAGNOSIS_FINDING_LEVELS,
  DIAGNOSIS_OBSERVATION_STATES,
} from '@why-i-suck-at-chess/chess-domain';
import type {
  DiagnosisFindingDraft,
  DiagnosisFindingRepository,
  DiagnosisFindingSetDraft,
  DiagnosisFindingSetSnapshot,
} from './diagnosis-finding.types';

function assertNonEmptyString(
  value: string,
  field: string,
  maximumLength: number,
): void {
  if (value.length === 0 || value.length > maximumLength) {
    throw new RangeError(`${field} must contain 1-${maximumLength} characters.`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
}

function assertPositiveInteger(value: number | null | undefined, field: string): void {
  if (value === null || value === undefined) return;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive safe integer when present.`);
  }
}

function assertJsonSerializable(value: unknown, field: string): void {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('undefined JSON');
    JSON.parse(encoded);
  } catch {
    throw new TypeError(`${field} must be JSON-serializable.`);
  }
}

function validateReference(
  reference: DiagnosisFindingDraft['evidenceReferences'][number],
  findingKey: string,
): void {
  assertNonEmptyString(reference.referenceKey, 'referenceKey', 128);
  assertNonEmptyString(reference.referenceType, 'referenceType', 48);
  assertPositiveInteger(reference.importedGameId, 'importedGameId');
  assertPositiveInteger(reference.evidenceEventId, 'evidenceEventId');
  assertPositiveInteger(reference.sourceAnalysisRunId, 'sourceAnalysisRunId');

  if (reference.sourcePlyStart === null || reference.sourcePlyStart === undefined) {
    if (reference.sourcePlyEnd !== null && reference.sourcePlyEnd !== undefined) {
      throw new RangeError('sourcePlyEnd requires sourcePlyStart.');
    }
  } else {
    assertPositiveInteger(reference.sourcePlyStart, 'sourcePlyStart');
    if (reference.sourcePlyEnd !== null && reference.sourcePlyEnd !== undefined) {
      assertPositiveInteger(reference.sourcePlyEnd, 'sourcePlyEnd');
      if (reference.sourcePlyEnd < reference.sourcePlyStart) {
        throw new RangeError('sourcePlyEnd must be greater than or equal to sourcePlyStart.');
      }
    }
  }

  if (reference.sessionKey !== null && reference.sessionKey !== undefined) {
    assertNonEmptyString(reference.sessionKey, 'sessionKey', 128);
  }
  if (reference.eventIdentityKey !== null && reference.eventIdentityKey !== undefined) {
    assertNonEmptyString(reference.eventIdentityKey, 'eventIdentityKey', 192);
  }
  assertJsonSerializable(reference.provenance, `provenance for ${findingKey}/${reference.referenceKey}`);
}

function validateFinding(finding: DiagnosisFindingDraft): void {
  assertNonEmptyString(finding.findingKey, 'findingKey', 128);
  assertNonEmptyString(finding.diagnosisId, 'diagnosisId', 64);
  assertNonEmptyString(finding.claimKey, 'claimKey', 128);
  assertNonEmptyString(finding.producerKey, 'producerKey', 96);
  assertNonEmptyString(finding.producerVersion, 'producerVersion', 64);
  if (!DIAGNOSIS_FINDING_LEVELS.includes(finding.findingLevel)) {
    throw new RangeError(`Unsupported finding level: ${finding.findingLevel}`);
  }
  if (!DIAGNOSIS_OBSERVATION_STATES.includes(finding.observationState)) {
    throw new RangeError(`Unsupported observation state: ${finding.observationState}`);
  }
  if (!DIAGNOSIS_EVIDENCE_STRENGTHS.includes(finding.evidenceStrength)) {
    throw new RangeError(`Unsupported evidence strength: ${finding.evidenceStrength}`);
  }

  assertNonNegativeInteger(finding.sampleCount, 'sampleCount');
  assertNonNegativeInteger(finding.distinctGameCount, 'distinctGameCount');
  assertNonNegativeInteger(finding.distinctSessionCount, 'distinctSessionCount');

  if (
    finding.requiredEvidenceCoverage !== null
    && (
      !Number.isFinite(finding.requiredEvidenceCoverage)
      || finding.requiredEvidenceCoverage < 0
      || finding.requiredEvidenceCoverage > 1
    )
  ) {
    throw new RangeError('requiredEvidenceCoverage must be null or in [0, 1].');
  }

  assertJsonSerializable(finding.dimensions, `dimensions for ${finding.findingKey}`);
  assertJsonSerializable(finding.coverage, `coverage for ${finding.findingKey}`);
  assertJsonSerializable(finding.sourceVersions, `sourceVersions for ${finding.findingKey}`);

  if (finding.effect) {
    assertNonEmptyString(finding.effect.metric, 'effect.metric', 96);
    assertNonEmptyString(finding.effect.unit, 'effect.unit', 48);
    assertNonEmptyString(finding.effect.direction, 'effect.direction', 32);
    if (!Number.isFinite(finding.effect.value)) {
      throw new RangeError('effect.value must be finite.');
    }
    if (finding.effect.comparator !== null && finding.effect.comparator !== undefined) {
      assertJsonSerializable(finding.effect.comparator, `effect comparator for ${finding.findingKey}`);
    }
  }

  if (
    finding.evidenceReferences.length
    > DIAGNOSIS_BOUNDEDNESS_POLICY.maxEvidenceEventReferencesPerFinding
  ) {
    throw new RangeError(
      `Finding ${finding.findingKey} exceeds the evidence-reference bound.`,
    );
  }

  const referenceKeys = new Set<string>();
  let representativeCount = 0;
  for (const reference of finding.evidenceReferences) {
    validateReference(reference, finding.findingKey);
    if (referenceKeys.has(reference.referenceKey)) {
      throw new Error(
        `Finding ${finding.findingKey} contains duplicate reference key ${reference.referenceKey}.`,
      );
    }
    referenceKeys.add(reference.referenceKey);
    if (reference.representative) representativeCount += 1;
  }
  if (representativeCount > DIAGNOSIS_BOUNDEDNESS_POLICY.maxRepresentativeExamplesPerFinding) {
    throw new RangeError(
      `Finding ${finding.findingKey} exceeds the representative-example bound.`,
    );
  }
}

export function validateDiagnosisFindingSetDraft(
  appUserId: number,
  draft: DiagnosisFindingSetDraft,
): void {
  if (!Number.isSafeInteger(appUserId) || appUserId <= 0) {
    throw new RangeError('appUserId must be a positive safe integer.');
  }
  assertNonEmptyString(draft.materializationKey, 'materializationKey', 64);
  assertNonEmptyString(draft.scopeKey, 'scopeKey', 128);
  assertNonEmptyString(draft.taxonomyVersion, 'taxonomyVersion', 64);
  assertNonEmptyString(draft.synthesisPolicyVersion, 'synthesisPolicyVersion', 64);
  assertNonEmptyString(draft.calculationVersion, 'calculationVersion', 64);
  if (!Number.isFinite(draft.calculationAsOf.getTime())) {
    throw new RangeError('calculationAsOf must be a valid date.');
  }
  assertJsonSerializable(draft.scope, 'scope');
  assertJsonSerializable(draft.policyVersions, 'policyVersions');

  if (draft.findings.length > DIAGNOSIS_BOUNDEDNESS_POLICY.maxCurrentFindingsPerScope) {
    throw new RangeError('Diagnosis finding scope exceeds the current-finding bound.');
  }

  const findingKeys = new Set<string>();
  for (const finding of draft.findings) {
    validateFinding(finding);
    if (findingKeys.has(finding.findingKey)) {
      throw new Error(`Duplicate diagnosis finding key: ${finding.findingKey}`);
    }
    findingKeys.add(finding.findingKey);
  }
}

export async function replaceCurrentDiagnosisFindingScope(
  appUserId: number,
  draft: DiagnosisFindingSetDraft,
  repository: DiagnosisFindingRepository,
): Promise<DiagnosisFindingSetSnapshot> {
  validateDiagnosisFindingSetDraft(appUserId, draft);
  return repository.replaceCurrentScope(appUserId, draft);
}
