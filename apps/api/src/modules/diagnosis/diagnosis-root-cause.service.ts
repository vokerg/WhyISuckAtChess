import {
  DIAGNOSIS_BOUNDEDNESS_POLICY,
  DIAGNOSIS_CONSOLIDATION_POLICY_VERSION,
  DIAGNOSIS_EVIDENCE_POLICY,
  DIAGNOSIS_EVENT_IDENTITY_VERSION,
  DIAGNOSIS_ROOT_CAUSE_THEME_REGISTRY,
  DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
  isCurrentDiagnosisEventIdentityKey,
  type DiagnosisEvidenceStrength,
  type DiagnosisFindingLevel,
  type DiagnosisObservationState,
  type DiagnosisRootCauseThemePolicy,
} from '@why-i-suck-at-chess/chess-domain';
import type {
  DiagnosisFindingDraft,
  DiagnosisFindingEvidenceReferenceDraft,
  DiagnosisFindingSetDraft,
  DiagnosisFindingSetSnapshot,
  DiagnosisFindingVersionTuple,
  DiagnosisRootCandidateSupportDraft,
  PersistedDiagnosisFinding,
  PersistedDiagnosisFindingConsolidation,
  PersistedDiagnosisFindingEvidenceReference,
  PersistedDiagnosisFindingRelationship,
} from './diagnosis-finding.types';
import type { DiagnosisFindingOverlapRepository } from './diagnosis-overlap.service';
import { DIAGNOSIS_RELATIONSHIP_GRAPH_VERSION } from './diagnosis-relationship.service';

export const DIAGNOSIS_ROOT_SYNTHESIS_PRODUCER_KEY = 'diagnosis-root-synthesis' as const;

export type DiagnosisRootSynthesisRepository = DiagnosisFindingOverlapRepository;

export interface DiagnosisRootCandidateBuildResult {
  findings: readonly DiagnosisFindingDraft[];
  supports: readonly DiagnosisRootCandidateSupportDraft[];
}

export interface DiagnosisRootSynthesisResult {
  sourceFindingSetId: number;
  findingSetId: number;
  scopeKey: string;
  synthesisPolicyVersion: typeof DIAGNOSIS_SYNTHESIS_POLICY_VERSION;
  materialized: boolean;
  requiresHierarchyRefresh: boolean;
  roots: readonly PersistedDiagnosisFinding[];
}

interface RootEventSource {
  finding: PersistedDiagnosisFinding;
  reference: PersistedDiagnosisFindingEvidenceReference;
}

interface RootEventGroup {
  eventIdentityKey: string;
  importedGameId: number;
  sessionKey: string | null;
  sources: RootEventSource[];
}

interface ThemeSelection {
  theme: DiagnosisRootCauseThemePolicy;
  mechanisms: PersistedDiagnosisFinding[];
  contexts: PersistedDiagnosisFinding[];
  additional: PersistedDiagnosisFinding[];
  relationships: PersistedDiagnosisFindingRelationship[];
  events: RootEventGroup[];
  requiredCoverage: number;
  evidenceStrength: DiagnosisEvidenceStrength;
  distinctSessionCount: number;
  largestSingleGameEventShare: number;
}

const EVIDENCE_ORDER: Readonly<Record<DiagnosisEvidenceStrength, number>> = {
  INSUFFICIENT: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

const ROOT_LINK_RELATIONSHIP_TYPES = new Set([
  'MANIFESTS_AS',
  'CONTRIBUTES_TO',
  'CONDITIONAL_ON',
  'EXPLAINS_OBSERVATION',
  'SHARES_EVENTS_WITH',
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(field + ' must be an object.');
  return value;
}

function relationshipOverlapMaterial(
  relationship: PersistedDiagnosisFindingRelationship,
): boolean | null {
  if (!isRecord(relationship.support)) return null;
  const overlap = relationship.support.overlap;
  if (!isRecord(overlap)) return null;
  return typeof overlap.material === 'boolean' ? overlap.material : null;
}

function relationshipSupportsRootLink(
  relationship: PersistedDiagnosisFindingRelationship,
): boolean {
  if (!ROOT_LINK_RELATIONSHIP_TYPES.has(relationship.relationshipType)) return false;
  if (
    relationship.relationshipType === 'SHARES_EVENTS_WITH'
    || relationship.relationshipType === 'CONDITIONAL_ON'
  ) {
    return relationshipOverlapMaterial(relationship) === true;
  }
  return true;
}

function relationshipConnects(
  relationship: PersistedDiagnosisFindingRelationship,
  leftId: number,
  rightId: number,
): boolean {
  return (
    (
      relationship.sourceFindingId === leftId
      && relationship.targetFindingId === rightId
    )
    || (
      relationship.sourceFindingId === rightId
      && relationship.targetFindingId === leftId
    )
  );
}

function stableFindingOrder(
  left: PersistedDiagnosisFinding,
  right: PersistedDiagnosisFinding,
): number {
  const keyOrder = left.findingKey.localeCompare(right.findingKey);
  return keyOrder !== 0 ? keyOrder : left.id - right.id;
}

function isMandatoryRootFindingSupported(
  finding: PersistedDiagnosisFinding,
): boolean {
  return (
    finding.observationState === 'PROBLEM_DETECTED'
    && finding.evidenceStrength !== 'INSUFFICIENT'
    && finding.requiredEvidenceCoverage !== null
    && finding.requiredEvidenceCoverage >= DIAGNOSIS_EVIDENCE_POLICY.minimumRequiredEvidenceCoverage
  );
}

function isAdditionalRootSupportEligible(
  finding: PersistedDiagnosisFinding,
): boolean {
  return (
    finding.observationState === 'PROBLEM_DETECTED'
    && finding.evidenceStrength !== 'INSUFFICIENT'
    && (
      finding.requiredEvidenceCoverage === null
      || finding.requiredEvidenceCoverage >= DIAGNOSIS_EVIDENCE_POLICY.minimumRequiredEvidenceCoverage
    )
  );
}

function validateCurrentHierarchy(
  snapshot: DiagnosisFindingSetSnapshot,
): ReadonlyMap<number, PersistedDiagnosisFindingConsolidation> {
  if (snapshot.consolidations.length !== snapshot.findings.length) {
    throw new Error('Root synthesis requires a complete current consolidation state.');
  }

  const findingIds = new Set(snapshot.findings.map((finding) => finding.id));
  const result = new Map<number, PersistedDiagnosisFindingConsolidation>();
  for (const consolidation of snapshot.consolidations) {
    if (!findingIds.has(consolidation.findingId)) {
      throw new Error('Root synthesis consolidation references a finding outside the current set.');
    }
    if (result.has(consolidation.findingId)) {
      throw new Error('Root synthesis consolidation contains duplicate finding state.');
    }
    if (consolidation.policyVersion !== DIAGNOSIS_CONSOLIDATION_POLICY_VERSION) {
      throw new Error('Root synthesis cannot consume a stale consolidation policy version.');
    }
    result.set(consolidation.findingId, consolidation);
  }
  return result;
}

function validateCurrentRelationships(
  snapshot: DiagnosisFindingSetSnapshot,
): void {
  const findingIds = new Set(snapshot.findings.map((finding) => finding.id));
  for (const relationship of snapshot.relationships) {
    if (
      !findingIds.has(relationship.sourceFindingId)
      || !findingIds.has(relationship.targetFindingId)
    ) {
      throw new Error('Root synthesis relationship references a finding outside the current set.');
    }
    if (relationship.policyVersion !== DIAGNOSIS_SYNTHESIS_POLICY_VERSION) {
      throw new Error('Root synthesis cannot consume a stale relationship policy version.');
    }
    if (
      !isRecord(relationship.support)
      || relationship.support.graphVersion !== DIAGNOSIS_RELATIONSHIP_GRAPH_VERSION
    ) {
      throw new Error('Root synthesis cannot consume a stale relationship graph version.');
    }
  }
}

function mechanismEventGroups(
  finding: PersistedDiagnosisFinding,
): RootEventGroup[] | null {
  if (finding.evidenceReferences.length === 0 || finding.distinctGameCount <= 0) {
    return null;
  }

  const groups = new Map<string, RootEventGroup>();
  const referencedGames = new Set<number>();

  for (const reference of finding.evidenceReferences) {
    if (
      reference.importedGameId === null
      || !Number.isSafeInteger(reference.importedGameId)
      || reference.importedGameId <= 0
      || reference.eventIdentityKey === null
      || !isCurrentDiagnosisEventIdentityKey(reference.eventIdentityKey)
    ) {
      return null;
    }

    referencedGames.add(reference.importedGameId);
    const current = groups.get(reference.eventIdentityKey);
    if (current) {
      if (
        current.importedGameId !== reference.importedGameId
        || (
          current.sessionKey !== null
          && reference.sessionKey !== null
          && current.sessionKey !== reference.sessionKey
        )
      ) {
        throw new Error('Root synthesis detected an event-identity collision.');
      }
      current.sources.push({ finding, reference });
      continue;
    }

    groups.set(reference.eventIdentityKey, {
      eventIdentityKey: reference.eventIdentityKey,
      importedGameId: reference.importedGameId,
      sessionKey: reference.sessionKey,
      sources: [{ finding, reference }],
    });
  }

  if (referencedGames.size < finding.distinctGameCount) {
    return null;
  }
  return [...groups.values()];
}

function mergeRootEvents(
  mechanisms: readonly PersistedDiagnosisFinding[],
): RootEventGroup[] | null {
  const merged = new Map<string, RootEventGroup>();

  for (const mechanism of mechanisms) {
    const groups = mechanismEventGroups(mechanism);
    if (!groups) return null;

    for (const group of groups) {
      const existing = merged.get(group.eventIdentityKey);
      if (!existing) {
        merged.set(group.eventIdentityKey, {
          ...group,
          sources: [...group.sources],
        });
        continue;
      }
      if (
        existing.importedGameId !== group.importedGameId
        || (
          existing.sessionKey !== null
          && group.sessionKey !== null
          && existing.sessionKey !== group.sessionKey
        )
      ) {
        throw new Error('Root synthesis detected conflicting support for one event identity.');
      }
      existing.sources.push(...group.sources);
      if (existing.sessionKey === null && group.sessionKey !== null) {
        existing.sessionKey = group.sessionKey;
      }
    }
  }

  const events = [...merged.values()].sort(
    (left, right) => left.eventIdentityKey.localeCompare(right.eventIdentityKey),
  );
  if (events.length > DIAGNOSIS_BOUNDEDNESS_POLICY.maxEvidenceEventReferencesPerFinding) {
    return null;
  }
  return events;
}

function evidenceStrengthFromSample(
  sample: number,
  coverage: number,
): DiagnosisEvidenceStrength {
  if (
    sample < DIAGNOSIS_EVIDENCE_POLICY.minimumSupportingSample
    || coverage < DIAGNOSIS_EVIDENCE_POLICY.minimumRequiredEvidenceCoverage
  ) {
    return 'INSUFFICIENT';
  }
  if (sample < DIAGNOSIS_EVIDENCE_POLICY.mediumSupportingSample) return 'LOW';
  if (sample < DIAGNOSIS_EVIDENCE_POLICY.highSupportingSample) return 'MEDIUM';
  return 'HIGH';
}

function weakestEvidenceStrength(
  findings: readonly PersistedDiagnosisFinding[],
  sampleStrength: DiagnosisEvidenceStrength,
): DiagnosisEvidenceStrength {
  let weakest = sampleStrength;
  for (const finding of findings) {
    const strength = finding.evidenceStrength as DiagnosisEvidenceStrength;
    if (EVIDENCE_ORDER[strength] < EVIDENCE_ORDER[weakest]) weakest = strength;
  }
  return weakest;
}

function largestSingleGameShare(events: readonly RootEventGroup[]): number {
  const counts = new Map<number, number>();
  for (const event of events) {
    counts.set(event.importedGameId, (counts.get(event.importedGameId) ?? 0) + 1);
  }
  let maximum = 0;
  for (const count of counts.values()) maximum = Math.max(maximum, count);
  return events.length === 0 ? 1 : maximum / events.length;
}

function themeClaimKey(theme: DiagnosisRootCauseThemePolicy): string {
  return 'root.' + theme.key.toLowerCase().replaceAll('_', '-');
}

function themeFindingKey(theme: DiagnosisRootCauseThemePolicy): string {
  return 'root-' + theme.key.toLowerCase().replaceAll('_', '-');
}

function selectedRelationshipIds(
  findingId: number,
  relationships: readonly PersistedDiagnosisFindingRelationship[],
): number[] {
  return relationships
    .filter((relationship) => (
      relationship.sourceFindingId === findingId
      || relationship.targetFindingId === findingId
    ))
    .map((relationship) => relationship.id)
    .sort((left, right) => left - right);
}

function selectTheme(
  theme: DiagnosisRootCauseThemePolicy,
  snapshot: DiagnosisFindingSetSnapshot,
  consolidationByFindingId: ReadonlyMap<number, PersistedDiagnosisFindingConsolidation>,
): ThemeSelection | null {
  const topLevelSupported = snapshot.findings.filter((finding) => {
    const consolidation = consolidationByFindingId.get(finding.id);
    return consolidation?.topLevelEligible === true && isMandatoryRootFindingSupported(finding);
  });

  const mechanismCandidates = topLevelSupported
    .filter((finding) => (
      finding.findingLevel === 'MECHANISM'
      && theme.mechanismDiagnosisIds.includes(finding.diagnosisId)
      && mechanismEventGroups(finding) !== null
    ))
    .sort(stableFindingOrder);
  const contextCandidates = topLevelSupported
    .filter((finding) => (
      (
        finding.findingLevel === 'OBSERVATION'
        || finding.findingLevel === 'CONTRIBUTING_CONDITION'
      )
      && theme.conditionOrObservationDiagnosisIds.includes(finding.diagnosisId)
    ))
    .sort(stableFindingOrder);

  if (mechanismCandidates.length === 0 || contextCandidates.length === 0) return null;

  const pairRelationships: PersistedDiagnosisFindingRelationship[] = [];
  const selectedMechanismIds = new Set<number>();
  const selectedContextIds = new Set<number>();

  for (const mechanism of mechanismCandidates) {
    for (const context of contextCandidates) {
      const links = snapshot.relationships.filter((relationship) => (
        relationshipConnects(relationship, mechanism.id, context.id)
        && relationshipSupportsRootLink(relationship)
      ));
      if (links.length === 0) continue;
      selectedMechanismIds.add(mechanism.id);
      selectedContextIds.add(context.id);
      pairRelationships.push(...links);
    }
  }

  const mechanisms = mechanismCandidates.filter((finding) => selectedMechanismIds.has(finding.id));
  const contexts = contextCandidates.filter((finding) => selectedContextIds.has(finding.id));
  if (mechanisms.length === 0 || contexts.length === 0) return null;

  const events = mergeRootEvents(mechanisms);
  if (!events || events.length === 0) return null;

  const distinctGames = new Set(events.map((event) => event.importedGameId)).size;
  if (distinctGames < theme.minimumDistinctGames) return null;

  const largestShare = largestSingleGameShare(events);
  if (largestShare > DIAGNOSIS_EVIDENCE_POLICY.rootCandidateMaximumSingleGameEventShare) {
    return null;
  }

  const distinctSessionCount = Math.max(
    0,
    ...contexts.map((finding) => finding.distinctSessionCount),
  );
  if (distinctSessionCount < theme.minimumDistinctSessions) return null;

  const mandatory = [...mechanisms, ...contexts];
  const requiredCoverage = Math.min(
    ...mandatory.map((finding) => finding.requiredEvidenceCoverage ?? 0),
  );
  if (requiredCoverage < DIAGNOSIS_EVIDENCE_POLICY.minimumRequiredEvidenceCoverage) {
    return null;
  }

  const sampleStrength = evidenceStrengthFromSample(events.length, requiredCoverage);
  const evidenceStrength = weakestEvidenceStrength(mandatory, sampleStrength);
  if (evidenceStrength === 'INSUFFICIENT') return null;

  const selectedMandatoryIds = new Set(mandatory.map((finding) => finding.id));
  const additional = theme.key !== 'LATE_SESSION_TACTICAL_DETERIORATION'
    ? []
    : snapshot.findings
        .filter((finding) => {
          if (
            finding.diagnosisId !== 'SESSION-003'
            || selectedMandatoryIds.has(finding.id)
            || !isAdditionalRootSupportEligible(finding)
            || consolidationByFindingId.get(finding.id)?.topLevelEligible !== true
          ) {
            return false;
          }
          return snapshot.relationships.some((relationship) => (
            relationshipSupportsRootLink(relationship)
            && (
              selectedMandatoryIds.has(relationship.sourceFindingId)
              || selectedMandatoryIds.has(relationship.targetFindingId)
            )
            && (
              relationship.sourceFindingId === finding.id
              || relationship.targetFindingId === finding.id
            )
          ));
        })
        .sort(stableFindingOrder);

  const additionalIds = new Set(additional.map((finding) => finding.id));
  const allRelationships = [
    ...pairRelationships,
    ...snapshot.relationships.filter((relationship) => (
      relationshipSupportsRootLink(relationship)
      && (
        additionalIds.has(relationship.sourceFindingId)
        || additionalIds.has(relationship.targetFindingId)
      )
      && (
        selectedMandatoryIds.has(relationship.sourceFindingId)
        || selectedMandatoryIds.has(relationship.targetFindingId)
      )
    )),
  ];
  const relationshipKeys = new Set<string>();
  const relationships = allRelationships
    .filter((relationship) => {
      const key = [
        relationship.relationshipType,
        relationship.sourceFindingId,
        relationship.targetFindingId,
      ].join('|');
      if (relationshipKeys.has(key)) return false;
      relationshipKeys.add(key);
      return true;
    })
    .sort((left, right) => left.id - right.id);

  return {
    theme,
    mechanisms,
    contexts,
    additional,
    relationships,
    events,
    requiredCoverage,
    evidenceStrength,
    distinctSessionCount,
    largestSingleGameEventShare: largestShare,
  };
}

function representativeCount(strength: DiagnosisEvidenceStrength): number {
  if (strength === 'HIGH') return 3;
  if (strength === 'MEDIUM') return 2;
  if (strength === 'LOW') return 1;
  return 0;
}

function rootEvidenceReferences(
  selection: ThemeSelection,
): DiagnosisFindingEvidenceReferenceDraft[] {
  const desired = representativeCount(selection.evidenceStrength);
  const representativeCandidates = [...selection.events].sort((left, right) => {
    const leftRepresentative = left.sources.some((source) => source.reference.representative);
    const rightRepresentative = right.sources.some((source) => source.reference.representative);
    if (leftRepresentative !== rightRepresentative) return leftRepresentative ? -1 : 1;
    return left.eventIdentityKey.localeCompare(right.eventIdentityKey);
  });

  const representativeEventKeys = new Set<string>();
  const representativeGames = new Set<number>();
  for (const event of representativeCandidates) {
    if (representativeEventKeys.size >= desired) break;
    if (representativeGames.has(event.importedGameId)) continue;
    representativeEventKeys.add(event.eventIdentityKey);
    representativeGames.add(event.importedGameId);
  }

  return selection.events.map((event, index) => {
    const sources = [...event.sources].sort((left, right) => {
      const findingOrder = stableFindingOrder(left.finding, right.finding);
      if (findingOrder !== 0) return findingOrder;
      return left.reference.referenceKey.localeCompare(right.reference.referenceKey);
    });
    const first = sources[0];
    if (!first) throw new Error('Root synthesis event is missing its source reference.');

    return {
      referenceKey: 'root-event-' + String(index + 1).padStart(4, '0'),
      referenceType: 'ROOT_SYNTHESIS_EVENT',
      importedGameId: event.importedGameId,
      evidenceEventId: first.reference.evidenceEventId,
      sourceAnalysisRunId: first.reference.sourceAnalysisRunId,
      sourcePlyStart: first.reference.sourcePlyStart,
      sourcePlyEnd: first.reference.sourcePlyEnd,
      sessionKey: event.sessionKey,
      eventIdentityKey: event.eventIdentityKey,
      provenance: {
        synthesisPolicyVersion: DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
        themeKey: selection.theme.key,
        sources: sources.map((source) => ({
          findingKey: source.finding.findingKey,
          sourceFindingId: source.finding.id,
          referenceKey: source.reference.referenceKey,
          referenceType: source.reference.referenceType,
          provenance: source.reference.provenance,
        })),
      },
      representative: representativeEventKeys.has(event.eventIdentityKey),
    };
  });
}

function rootSupportDraft(
  rootFindingKey: string,
  finding: PersistedDiagnosisFinding,
  role: DiagnosisRootCandidateSupportDraft['role'],
  selection: ThemeSelection,
  snapshot: DiagnosisFindingSetSnapshot,
  consolidationByFindingId: ReadonlyMap<number, PersistedDiagnosisFindingConsolidation>,
): DiagnosisRootCandidateSupportDraft {
  const consolidation = consolidationByFindingId.get(finding.id);
  if (!consolidation) {
    throw new Error('Root synthesis support is missing consolidation state.');
  }

  return {
    rootFindingKey,
    supportingFindingKey: finding.findingKey,
    role,
    support: {
      sourceFindingSetId: snapshot.id,
      sourceFindingId: finding.id,
      diagnosisId: finding.diagnosisId,
      findingLevel: finding.findingLevel,
      observationState: finding.observationState,
      sampleCount: finding.sampleCount,
      distinctGameCount: finding.distinctGameCount,
      distinctSessionCount: finding.distinctSessionCount,
      requiredEvidenceCoverage: finding.requiredEvidenceCoverage,
      evidenceStrength: finding.evidenceStrength,
      effect: finding.effect,
      coverage: finding.coverage,
      sourceVersions: finding.sourceVersions,
      consolidation: {
        state: consolidation.state,
        topLevelEligible: consolidation.topLevelEligible,
        clusterKey: consolidation.clusterKey,
        reasonKeys: consolidation.reasonKeys,
        policyVersion: consolidation.policyVersion,
      },
      sourceRelationshipIds: selectedRelationshipIds(finding.id, selection.relationships),
      sourceRelationships: selection.relationships
        .filter((relationship) => (
          relationship.sourceFindingId === finding.id
          || relationship.targetFindingId === finding.id
        ))
        .map((relationship) => ({
          id: relationship.id,
          sourceFindingId: relationship.sourceFindingId,
          targetFindingId: relationship.targetFindingId,
          relationshipType: relationship.relationshipType,
          policyVersion: relationship.policyVersion,
          support: relationship.support,
        })),
    },
  };
}

function buildRootFinding(
  selection: ThemeSelection,
  snapshot: DiagnosisFindingSetSnapshot,
): DiagnosisFindingDraft {
  const rootFindingKey = themeFindingKey(selection.theme);
  const mechanismEffects = selection.mechanisms.map((finding) => ({
    findingKey: finding.findingKey,
    diagnosisId: finding.diagnosisId,
    effect: finding.effect,
  }));
  const contextEffects = selection.contexts.map((finding) => ({
    findingKey: finding.findingKey,
    diagnosisId: finding.diagnosisId,
    effect: finding.effect,
  }));

  return {
    findingKey: rootFindingKey,
    diagnosisId: selection.theme.key,
    findingLevel: 'ROOT_CAUSE_CANDIDATE',
    observationState: 'PROBLEM_DETECTED',
    claimKey: themeClaimKey(selection.theme),
    producerKey: DIAGNOSIS_ROOT_SYNTHESIS_PRODUCER_KEY,
    producerVersion: DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
    sampleCount: selection.events.length,
    distinctGameCount: new Set(selection.events.map((event) => event.importedGameId)).size,
    distinctSessionCount: selection.distinctSessionCount,
    requiredEvidenceCoverage: selection.requiredCoverage,
    evidenceStrength: selection.evidenceStrength,
    dimensions: {
      rootThemeKey: selection.theme.key,
    },
    coverage: {
      sourceFindingSetId: snapshot.id,
      eventSupportCount: selection.events.length,
      distinctGameCount: new Set(selection.events.map((event) => event.importedGameId)).size,
      distinctSessionCount: selection.distinctSessionCount,
      largestSingleGameEventShare: selection.largestSingleGameEventShare,
      mechanismFindingKeys: selection.mechanisms.map((finding) => finding.findingKey),
      conditionOrObservationFindingKeys: selection.contexts.map((finding) => finding.findingKey),
      additionalSupportFindingKeys: selection.additional.map((finding) => finding.findingKey),
      relationshipIds: selection.relationships.map((relationship) => relationship.id),
      mechanismEffects,
      contextEffects,
    },
    effect: null,
    sourceVersions: {
      synthesis: DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
      sourceFindingSetId: snapshot.id,
      children: [...selection.mechanisms, ...selection.contexts, ...selection.additional].map(
        (finding) => ({
          findingKey: finding.findingKey,
          diagnosisId: finding.diagnosisId,
          producerKey: finding.producerKey,
          producerVersion: finding.producerVersion,
          sourceVersions: finding.sourceVersions,
        }),
      ),
    },
    evidenceReferences: rootEvidenceReferences(selection),
  };
}

export function buildDiagnosisRootCandidates(
  snapshot: DiagnosisFindingSetSnapshot,
): DiagnosisRootCandidateBuildResult {
  if (snapshot.findings.length > DIAGNOSIS_BOUNDEDNESS_POLICY.maxCurrentFindingsPerScope) {
    throw new RangeError('Root synthesis scope exceeds the current-finding bound.');
  }
  if (!snapshot.isCurrent || snapshot.supersededAt !== null) {
    throw new Error('Root synthesis requires a current canonical finding set.');
  }
  if (snapshot.synthesisPolicyVersion !== DIAGNOSIS_SYNTHESIS_POLICY_VERSION) {
    throw new Error('Root synthesis only supports the current synthesis-policy version.');
  }

  validateCurrentRelationships(snapshot);
  const consolidationByFindingId = validateCurrentHierarchy(snapshot);

  const findings: DiagnosisFindingDraft[] = [];
  const supports: DiagnosisRootCandidateSupportDraft[] = [];

  for (const theme of DIAGNOSIS_ROOT_CAUSE_THEME_REGISTRY) {
    const selection = selectTheme(theme, snapshot, consolidationByFindingId);
    if (!selection) continue;

    const root = buildRootFinding(selection, snapshot);
    findings.push(root);

    for (const mechanism of selection.mechanisms) {
      supports.push(rootSupportDraft(
        root.findingKey,
        mechanism,
        'MECHANISM',
        selection,
        snapshot,
        consolidationByFindingId,
      ));
    }
    for (const context of selection.contexts) {
      supports.push(rootSupportDraft(
        root.findingKey,
        context,
        'CONDITION_OR_OBSERVATION',
        selection,
        snapshot,
        consolidationByFindingId,
      ));
    }
    for (const additional of selection.additional) {
      supports.push(rootSupportDraft(
        root.findingKey,
        additional,
        'ADDITIONAL_SUPPORT',
        selection,
        snapshot,
        consolidationByFindingId,
      ));
    }
  }

  return {
    findings: findings.sort((left, right) => left.findingKey.localeCompare(right.findingKey)),
    supports: supports.sort((left, right) => {
      const rootOrder = left.rootFindingKey.localeCompare(right.rootFindingKey);
      return rootOrder !== 0
        ? rootOrder
        : left.supportingFindingKey.localeCompare(right.supportingFindingKey);
    }),
  };
}

function persistedFindingToDraft(
  finding: PersistedDiagnosisFinding,
): DiagnosisFindingDraft {
  const dimensions = asRecord(finding.dimensions, 'persisted finding dimensions');
  const coverage = asRecord(finding.coverage, 'persisted finding coverage');
  const sourceVersions = asRecord(finding.sourceVersions, 'persisted finding sourceVersions');

  let comparator: Readonly<Record<string, unknown>> | null = null;
  if (finding.effect?.comparator !== null && finding.effect?.comparator !== undefined) {
    comparator = asRecord(finding.effect.comparator, 'persisted finding comparator');
  }

  return {
    findingKey: finding.findingKey,
    diagnosisId: finding.diagnosisId,
    findingLevel: finding.findingLevel as DiagnosisFindingLevel,
    observationState: finding.observationState as DiagnosisObservationState,
    claimKey: finding.claimKey,
    producerKey: finding.producerKey,
    producerVersion: finding.producerVersion,
    sampleCount: finding.sampleCount,
    distinctGameCount: finding.distinctGameCount,
    distinctSessionCount: finding.distinctSessionCount,
    requiredEvidenceCoverage: finding.requiredEvidenceCoverage,
    evidenceStrength: finding.evidenceStrength as DiagnosisEvidenceStrength,
    dimensions,
    coverage,
    effect: finding.effect
      ? {
          metric: finding.effect.metric,
          value: finding.effect.value,
          unit: finding.effect.unit,
          direction: finding.effect.direction,
          comparator,
        }
      : null,
    sourceVersions,
    evidenceReferences: finding.evidenceReferences.map((reference) => ({
      referenceKey: reference.referenceKey,
      referenceType: reference.referenceType,
      importedGameId: reference.importedGameId,
      evidenceEventId: reference.evidenceEventId,
      sourceAnalysisRunId: reference.sourceAnalysisRunId,
      sourcePlyStart: reference.sourcePlyStart,
      sourcePlyEnd: reference.sourcePlyEnd,
      sessionKey: reference.sessionKey,
      eventIdentityKey: reference.eventIdentityKey,
      provenance: asRecord(reference.provenance, 'persisted evidence-reference provenance'),
      representative: reference.representative,
    })),
  };
}

function preservedRootSupports(
  snapshot: DiagnosisFindingSetSnapshot,
): DiagnosisRootCandidateSupportDraft[] {
  if (snapshot.rootSupports.length === 0) return [];

  const findingsById = new Map(snapshot.findings.map((finding) => [finding.id, finding]));
  const result: DiagnosisRootCandidateSupportDraft[] = [];
  for (const support of snapshot.rootSupports) {
    const root = findingsById.get(support.rootFindingId);
    const child = findingsById.get(support.supportingFindingId);
    if (!root || !child) {
      throw new Error('Persisted root support references a finding outside its finding set.');
    }
    if (
      root.producerKey === DIAGNOSIS_ROOT_SYNTHESIS_PRODUCER_KEY
      && root.producerVersion === DIAGNOSIS_SYNTHESIS_POLICY_VERSION
    ) {
      continue;
    }
    if (
      support.role !== 'MECHANISM'
      && support.role !== 'CONDITION_OR_OBSERVATION'
      && support.role !== 'ADDITIONAL_SUPPORT'
    ) {
      throw new Error('Persisted root support has an unsupported role.');
    }
    result.push({
      rootFindingKey: root.findingKey,
      supportingFindingKey: child.findingKey,
      role: support.role,
      support: asRecord(support.support, 'persisted root support'),
    });
  }
  return result;
}

function replacementDraft(
  snapshot: DiagnosisFindingSetSnapshot,
  build: DiagnosisRootCandidateBuildResult,
): DiagnosisFindingSetDraft {
  const leafFindings = snapshot.findings
    .filter((finding) => !(
      finding.producerKey === DIAGNOSIS_ROOT_SYNTHESIS_PRODUCER_KEY
      && finding.producerVersion === DIAGNOSIS_SYNTHESIS_POLICY_VERSION
    ))
    .sort(stableFindingOrder)
    .map(persistedFindingToDraft);

  if (
    leafFindings.length + build.findings.length
    > DIAGNOSIS_BOUNDEDNESS_POLICY.maxCurrentFindingsPerScope
  ) {
    throw new RangeError('Root synthesis replacement exceeds the current-finding bound.');
  }

  return {
    materializationKey: 'root-synth-v1-source-' + snapshot.id,
    scopeKey: snapshot.scopeKey,
    scope: asRecord(snapshot.scope, 'persisted finding-set scope'),
    taxonomyVersion: snapshot.taxonomyVersion,
    synthesisPolicyVersion: snapshot.synthesisPolicyVersion,
    calculationVersion: snapshot.calculationVersion,
    policyVersions: asRecord(snapshot.policyVersions, 'persisted finding-set policyVersions'),
    calculationAsOf: snapshot.calculationAsOf,
    findings: [...leafFindings, ...build.findings],
    rootSupports: [...preservedRootSupports(snapshot), ...build.supports],
  };
}

function currentSynthesizedRoots(
  snapshot: DiagnosisFindingSetSnapshot,
): PersistedDiagnosisFinding[] {
  return snapshot.findings
    .filter((finding) => (
      finding.findingLevel === 'ROOT_CAUSE_CANDIDATE'
      && finding.producerKey === DIAGNOSIS_ROOT_SYNTHESIS_PRODUCER_KEY
      && finding.producerVersion === DIAGNOSIS_SYNTHESIS_POLICY_VERSION
    ))
    .sort(stableFindingOrder);
}

export async function materializeCurrentDiagnosisRootCandidates(
  appUserId: number,
  scopeKey: string,
  versions: DiagnosisFindingVersionTuple,
  repository: DiagnosisRootSynthesisRepository,
): Promise<DiagnosisRootSynthesisResult> {
  if (!Number.isSafeInteger(appUserId) || appUserId <= 0) {
    throw new RangeError('appUserId must be a positive safe integer.');
  }
  if (scopeKey.length === 0 || scopeKey.length > 128) {
    throw new RangeError('scopeKey must contain 1-128 characters.');
  }
  if (versions.synthesisPolicyVersion !== DIAGNOSIS_SYNTHESIS_POLICY_VERSION) {
    throw new Error('Root synthesis only supports the current synthesis-policy version.');
  }
  if (!isRecord(versions.policyVersions)) {
    throw new Error('Root synthesis requires an inspectable policy-version tuple.');
  }
  if (versions.policyVersions.consolidation !== DIAGNOSIS_CONSOLIDATION_POLICY_VERSION) {
    throw new Error('Root synthesis only supports the current consolidation-policy version.');
  }
  if (versions.policyVersions.eventIdentity !== DIAGNOSIS_EVENT_IDENTITY_VERSION) {
    throw new Error('Root synthesis only supports the current event-identity version.');
  }

  const snapshot = await repository.getCurrentScope(appUserId, scopeKey, versions);
  if (!snapshot || !snapshot.isCurrent || snapshot.supersededAt !== null) {
    throw new Error('Current diagnosis finding scope is unavailable for root synthesis.');
  }
  await repository.assertCurrentSourceReferences(appUserId, snapshot);

  const existingRoots = currentSynthesizedRoots(snapshot);
  if (existingRoots.length > 0) {
    return {
      sourceFindingSetId: snapshot.id,
      findingSetId: snapshot.id,
      scopeKey: snapshot.scopeKey,
      synthesisPolicyVersion: DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
      materialized: false,
      requiresHierarchyRefresh: snapshot.consolidations.length !== snapshot.findings.length,
      roots: existingRoots,
    };
  }

  const build = buildDiagnosisRootCandidates(snapshot);
  if (build.findings.length === 0) {
    return {
      sourceFindingSetId: snapshot.id,
      findingSetId: snapshot.id,
      scopeKey: snapshot.scopeKey,
      synthesisPolicyVersion: DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
      materialized: false,
      requiresHierarchyRefresh: false,
      roots: [],
    };
  }

  const replacement = await repository.replaceCurrentScope(
    appUserId,
    replacementDraft(snapshot, build),
  );
  const roots = currentSynthesizedRoots(replacement);
  if (roots.length !== build.findings.length) {
    throw new Error('Root synthesis replacement did not persist every synthesized root.');
  }

  return {
    sourceFindingSetId: snapshot.id,
    findingSetId: replacement.id,
    scopeKey: replacement.scopeKey,
    synthesisPolicyVersion: DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
    materialized: true,
    requiresHierarchyRefresh: true,
    roots,
  };
}
