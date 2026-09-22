import type {
  DiagnosisEvidenceStrength,
  DiagnosisFindingLevel,
  DiagnosisObservationState,
} from '@why-i-suck-at-chess/chess-domain';

export interface DiagnosisFindingEvidenceReferenceDraft {
  referenceKey: string;
  referenceType: string;
  importedGameId?: number | null;
  evidenceEventId?: number | null;
  sourceAnalysisRunId?: number | null;
  sourcePlyStart?: number | null;
  sourcePlyEnd?: number | null;
  sessionKey?: string | null;
  eventIdentityKey?: string | null;
  provenance: Readonly<Record<string, unknown>>;
  representative?: boolean;
}

export interface DiagnosisFindingEffectDraft {
  metric: string;
  value: number;
  unit: string;
  direction: string;
  comparator?: Readonly<Record<string, unknown>> | null;
}

export interface DiagnosisFindingDraft {
  findingKey: string;
  diagnosisId: string;
  findingLevel: DiagnosisFindingLevel;
  observationState: DiagnosisObservationState;
  claimKey: string;
  producerKey: string;
  producerVersion: string;
  sampleCount: number;
  distinctGameCount: number;
  distinctSessionCount: number;
  requiredEvidenceCoverage: number | null;
  evidenceStrength: DiagnosisEvidenceStrength;
  dimensions: Readonly<Record<string, unknown>>;
  coverage: Readonly<Record<string, unknown>>;
  effect?: DiagnosisFindingEffectDraft | null;
  sourceVersions: Readonly<Record<string, unknown>>;
  evidenceReferences: readonly DiagnosisFindingEvidenceReferenceDraft[];
}

export interface DiagnosisFindingSetDraft {
  materializationKey: string;
  scopeKey: string;
  scope: Readonly<Record<string, unknown>>;
  taxonomyVersion: string;
  synthesisPolicyVersion: string;
  calculationVersion: string;
  policyVersions: Readonly<Record<string, unknown>>;
  calculationAsOf: Date;
  findings: readonly DiagnosisFindingDraft[];
}

export interface PersistedDiagnosisFindingEvidenceReference {
  id: number;
  referenceKey: string;
  referenceType: string;
  importedGameId: number | null;
  evidenceEventId: number | null;
  sourceAnalysisRunId: number | null;
  sourcePlyStart: number | null;
  sourcePlyEnd: number | null;
  sessionKey: string | null;
  eventIdentityKey: string | null;
  provenance: unknown;
  representative: boolean;
}

export interface PersistedDiagnosisFinding {
  id: number;
  findingKey: string;
  diagnosisId: string;
  findingLevel: string;
  observationState: string;
  claimKey: string;
  producerKey: string;
  producerVersion: string;
  sampleCount: number;
  distinctGameCount: number;
  distinctSessionCount: number;
  requiredEvidenceCoverage: number | null;
  evidenceStrength: string;
  dimensions: unknown;
  coverage: unknown;
  effect: {
    metric: string;
    value: number;
    unit: string;
    direction: string;
    comparator: unknown;
  } | null;
  sourceVersions: unknown;
  evidenceReferences: PersistedDiagnosisFindingEvidenceReference[];
}

export interface PersistedDiagnosisFindingRelationship {
  id: number;
  sourceFindingId: number;
  targetFindingId: number;
  relationshipType: string;
  policyVersion: string;
  support: unknown;
}

export interface DiagnosisFindingSetSnapshot {
  id: number;
  appUserId: number;
  materializationKey: string;
  scopeKey: string;
  scope: unknown;
  taxonomyVersion: string;
  synthesisPolicyVersion: string;
  calculationVersion: string;
  policyVersions: unknown;
  calculationAsOf: Date;
  isCurrent: boolean;
  supersededAt: Date | null;
  findings: PersistedDiagnosisFinding[];
  relationships: PersistedDiagnosisFindingRelationship[];
}

export interface DiagnosisFindingRepository {
  replaceCurrentScope(
    appUserId: number,
    draft: DiagnosisFindingSetDraft,
  ): Promise<DiagnosisFindingSetSnapshot>;
  getCurrentScope(
    appUserId: number,
    scopeKey: string,
  ): Promise<DiagnosisFindingSetSnapshot | null>;
}
