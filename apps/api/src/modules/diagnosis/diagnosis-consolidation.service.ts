import {
  DIAGNOSIS_BOUNDEDNESS_POLICY,
  DIAGNOSIS_CONSOLIDATION_POLICY_VERSION,
  DIAGNOSIS_EVIDENCE_POLICY,
  DIAGNOSIS_EVENT_IDENTITY_VERSION,
  DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
} from '@why-i-suck-at-chess/chess-domain';
import type {
  DiagnosisFindingSetSnapshot,
  DiagnosisFindingVersionTuple,
  PersistedDiagnosisFinding,
  PersistedDiagnosisFindingConsolidation,
  PersistedDiagnosisFindingRelationship,
} from './diagnosis-finding.types';
import {
  calculateDiagnosisFindingOverlaps,
  type DiagnosisFindingOverlapRepository,
  type DiagnosisFindingOverlapResult,
} from './diagnosis-overlap.service';

export const DIAGNOSIS_CONSOLIDATION_STATES = [
  'INELIGIBLE',
  'TOP_LEVEL',
  'TOP_LEVEL_MATERIAL_OVERLAP',
  'SUPPRESSED_DRILLDOWN',
] as const;

export type DiagnosisConsolidationState =
  typeof DIAGNOSIS_CONSOLIDATION_STATES[number];

export const DIAGNOSIS_CONSOLIDATION_REASON_KEYS = [
  'SOURCE_FINDING_NOT_SUPPORTED',
  'SPECIFIC_MECHANISM_SPECIALIZES_GENERIC_FINDING',
  'SPECIFIC_MECHANISM_EXPLAINS_OBSERVATION',
  'MATERIAL_CONTEXT_RETAINED',
  'UNRESOLVED_MATERIAL_OVERLAP',
] as const;

export type DiagnosisConsolidationReasonKey =
  typeof DIAGNOSIS_CONSOLIDATION_REASON_KEYS[number];

export interface DiagnosisFindingConsolidationDraft {
  findingId: number;
  representativeFindingId: number | null;
  state: DiagnosisConsolidationState;
  topLevelEligible: boolean;
  clusterKey: string;
  reasonKeys: readonly DiagnosisConsolidationReasonKey[];
  policyVersion: typeof DIAGNOSIS_CONSOLIDATION_POLICY_VERSION;
  support: Readonly<Record<string, unknown>>;
}

export interface DiagnosisConsolidationRepository extends DiagnosisFindingOverlapRepository {
  replaceCurrentConsolidations(
    appUserId: number,
    findingSetId: number,
    policyVersion: typeof DIAGNOSIS_CONSOLIDATION_POLICY_VERSION,
    consolidations: readonly DiagnosisFindingConsolidationDraft[],
  ): Promise<readonly PersistedDiagnosisFindingConsolidation[]>;
}

export interface DiagnosisConsolidationResult {
  findingSetId: number;
  scopeKey: string;
  policyVersion: typeof DIAGNOSIS_CONSOLIDATION_POLICY_VERSION;
  consolidations: readonly PersistedDiagnosisFindingConsolidation[];
}

interface SuppressionCandidate {
  source: PersistedDiagnosisFinding;
  target: PersistedDiagnosisFinding;
  relationship: PersistedDiagnosisFindingRelationship;
  overlap: DiagnosisFindingOverlapResult;
}

function assertPositiveId(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(field + ' must be a positive safe integer.');
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableFindingOrder(
  left: PersistedDiagnosisFinding,
  right: PersistedDiagnosisFinding,
): number {
  const keyOrder = left.findingKey.localeCompare(right.findingKey);
  return keyOrder !== 0 ? keyOrder : left.id - right.id;
}

function overlapPairKey(leftId: number, rightId: number): string {
  return leftId < rightId ? leftId + '|' + rightId : rightId + '|' + leftId;
}

function isSupportedFinding(finding: PersistedDiagnosisFinding): boolean {
  return finding.observationState === 'PROBLEM_DETECTED'
    && finding.evidenceStrength !== 'INSUFFICIENT'
    && (
      finding.requiredEvidenceCoverage === null
      || finding.requiredEvidenceCoverage >= DIAGNOSIS_EVIDENCE_POLICY.minimumRequiredEvidenceCoverage
    );
}

function buildOverlapIndex(
  overlaps: readonly DiagnosisFindingOverlapResult[],
  findingsById: ReadonlyMap<number, PersistedDiagnosisFinding>,
): ReadonlyMap<string, DiagnosisFindingOverlapResult> {
  const index = new Map<string, DiagnosisFindingOverlapResult>();
  for (const overlap of overlaps) {
    const leftId = overlap.left.id;
    const rightId = overlap.right.id;
    if (leftId === null || rightId === null) {
      throw new Error('Diagnosis consolidation requires persisted finding IDs in overlap output.');
    }
    if (!findingsById.has(leftId) || !findingsById.has(rightId)) {
      throw new Error('Diagnosis consolidation overlap references a finding outside the current set.');
    }
    const key = overlapPairKey(leftId, rightId);
    if (index.has(key)) {
      throw new Error('Diagnosis consolidation overlap input contains a duplicate finding pair.');
    }
    index.set(key, overlap);
  }
  return index;
}

function validateRelationships(
  relationships: readonly PersistedDiagnosisFindingRelationship[],
  findingsById: ReadonlyMap<number, PersistedDiagnosisFinding>,
): void {
  const keys = new Set<string>();
  for (const relationship of relationships) {
    assertPositiveId(relationship.id, 'relationship.id');
    if (
      !findingsById.has(relationship.sourceFindingId)
      || !findingsById.has(relationship.targetFindingId)
    ) {
      throw new Error('Diagnosis consolidation relationship references a finding outside the current set.');
    }
    if (relationship.sourceFindingId === relationship.targetFindingId) {
      throw new Error('Diagnosis consolidation relationships cannot be self-referential.');
    }
    if (relationship.policyVersion !== DIAGNOSIS_SYNTHESIS_POLICY_VERSION) {
      throw new Error('Diagnosis consolidation cannot consume a stale relationship policy version.');
    }
    const key = [
      relationship.relationshipType,
      relationship.sourceFindingId,
      relationship.targetFindingId,
    ].join('|');
    if (keys.has(key)) {
      throw new Error('Diagnosis consolidation relationship input contains a duplicate edge.');
    }
    keys.add(key);
  }
}

function buildMaterialPeers(
  overlaps: readonly DiagnosisFindingOverlapResult[],
  supportedIds: ReadonlySet<number>,
): ReadonlyMap<number, ReadonlySet<number>> {
  const mutable = new Map<number, Set<number>>();
  for (const id of supportedIds) mutable.set(id, new Set<number>());

  for (const overlap of overlaps) {
    if (overlap.eventOverlap.material !== true) continue;
    const leftId = overlap.left.id;
    const rightId = overlap.right.id;
    if (
      leftId === null
      || rightId === null
      || !supportedIds.has(leftId)
      || !supportedIds.has(rightId)
    ) {
      continue;
    }
    mutable.get(leftId)?.add(rightId);
    mutable.get(rightId)?.add(leftId);
  }

  return mutable;
}

function buildClusterKeys(
  findings: readonly PersistedDiagnosisFinding[],
  materialPeers: ReadonlyMap<number, ReadonlySet<number>>,
): ReadonlyMap<number, string> {
  const findingsById = new Map(findings.map((finding) => [finding.id, finding]));
  const result = new Map<number, string>();
  const visited = new Set<number>();

  for (const finding of [...findings].sort(stableFindingOrder)) {
    if (visited.has(finding.id)) continue;
    const members: PersistedDiagnosisFinding[] = [];
    const pending = [finding.id];
    visited.add(finding.id);

    while (pending.length > 0) {
      const currentId = pending.pop();
      if (currentId === undefined) break;
      const current = findingsById.get(currentId);
      if (!current) continue;
      members.push(current);
      const peers = [...(materialPeers.get(currentId) ?? [])]
        .sort((left, right) => left - right);
      for (const peerId of peers) {
        if (visited.has(peerId)) continue;
        visited.add(peerId);
        pending.push(peerId);
      }
    }

    const anchor = [...members].sort(stableFindingOrder)[0];
    if (!anchor) continue;
    const clusterKey = 'cluster:' + anchor.findingKey;
    for (const member of members) result.set(member.id, clusterKey);
  }

  return result;
}

function suppressionCandidateOrder(
  left: SuppressionCandidate,
  right: SuppressionCandidate,
): number {
  const relationshipOrder = (value: string): number => (
    value === 'SPECIALIZES' ? 0 : 1
  );
  const typeOrder = relationshipOrder(left.relationship.relationshipType)
    - relationshipOrder(right.relationship.relationshipType);
  if (typeOrder !== 0) return typeOrder;
  return stableFindingOrder(left.source, right.source);
}

function suppressionReason(
  relationship: PersistedDiagnosisFindingRelationship,
): DiagnosisConsolidationReasonKey {
  return relationship.relationshipType === 'SPECIALIZES'
    ? 'SPECIFIC_MECHANISM_SPECIALIZES_GENERIC_FINDING'
    : 'SPECIFIC_MECHANISM_EXPLAINS_OBSERVATION';
}

function overlapSupport(overlap: DiagnosisFindingOverlapResult): Readonly<Record<string, unknown>> {
  return {
    calculationVersion: overlap.calculationVersion,
    eventIdentityVersion: overlap.eventIdentityVersion,
    intersectionEventCount: overlap.eventOverlap.intersectionEventCount,
    unionEventCount: overlap.eventOverlap.unionEventCount,
    smallerArmOverlapRate: overlap.eventOverlap.smallerArmOverlapRate,
    sharedDistinctGames: overlap.eventOverlap.sharedDistinctGames,
    sharedDistinctSessions: overlap.eventOverlap.sharedDistinctSessions,
    material: overlap.eventOverlap.material,
    calculable: overlap.eventOverlap.calculable,
  };
}

function resolveRepresentative(
  targetId: number,
  selected: ReadonlyMap<number, SuppressionCandidate>,
): number {
  const seen = new Set<number>([targetId]);
  let current = selected.get(targetId)?.source.id;
  if (current === undefined) {
    throw new Error('Suppressed finding is missing a representative candidate.');
  }

  while (selected.has(current)) {
    if (seen.has(current)) {
      throw new Error('Diagnosis consolidation suppression contains a cycle.');
    }
    seen.add(current);
    const next = selected.get(current)?.source.id;
    if (next === undefined) break;
    current = next;
  }

  if (seen.has(current)) {
    throw new Error('Diagnosis consolidation suppression contains a cycle.');
  }
  return current;
}

function sortedUniqueIds(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

export function buildDiagnosisConsolidation(
  findings: readonly PersistedDiagnosisFinding[],
  relationships: readonly PersistedDiagnosisFindingRelationship[],
  overlaps: readonly DiagnosisFindingOverlapResult[],
): readonly DiagnosisFindingConsolidationDraft[] {
  if (findings.length > DIAGNOSIS_BOUNDEDNESS_POLICY.maxCurrentFindingsPerScope) {
    throw new RangeError('Diagnosis consolidation scope exceeds the current-finding bound.');
  }

  const findingsById = new Map<number, PersistedDiagnosisFinding>();
  const findingKeys = new Set<string>();
  for (const finding of findings) {
    assertPositiveId(finding.id, 'finding.id');
    if (findingsById.has(finding.id)) {
      throw new Error('Duplicate diagnosis finding id: ' + finding.id);
    }
    if (findingKeys.has(finding.findingKey)) {
      throw new Error('Duplicate diagnosis finding key: ' + finding.findingKey);
    }
    findingsById.set(finding.id, finding);
    findingKeys.add(finding.findingKey);
  }

  validateRelationships(relationships, findingsById);
  const overlapIndex = buildOverlapIndex(overlaps, findingsById);
  const supportedFindings = findings.filter(isSupportedFinding);
  const supportedIds = new Set(supportedFindings.map((finding) => finding.id));
  const materialPeers = buildMaterialPeers(overlaps, supportedIds);
  const clusterKeys = buildClusterKeys(findings, materialPeers);

  const candidatesByTarget = new Map<number, SuppressionCandidate[]>();
  for (const relationship of relationships) {
    if (
      relationship.relationshipType !== 'SPECIALIZES'
      && relationship.relationshipType !== 'EXPLAINS_OBSERVATION'
    ) {
      continue;
    }

    const source = findingsById.get(relationship.sourceFindingId);
    const target = findingsById.get(relationship.targetFindingId);
    if (!source || !target || !supportedIds.has(source.id) || !supportedIds.has(target.id)) {
      continue;
    }
    if (source.findingLevel !== 'MECHANISM') continue;
    if (target.findingLevel !== 'OBSERVATION' && target.findingLevel !== 'MECHANISM') continue;

    const overlap = overlapIndex.get(overlapPairKey(source.id, target.id));
    if (overlap?.eventOverlap.material !== true) continue;

    const candidate: SuppressionCandidate = {
      source,
      target,
      relationship,
      overlap,
    };
    const current = candidatesByTarget.get(target.id) ?? [];
    current.push(candidate);
    candidatesByTarget.set(target.id, current);
  }

  const selectedSuppression = new Map<number, SuppressionCandidate>();
  for (const [targetId, candidates] of candidatesByTarget) {
    const selected = [...candidates].sort(suppressionCandidateOrder)[0];
    if (selected) selectedSuppression.set(targetId, selected);
  }

  const suppressedIds = new Set(selectedSuppression.keys());
  for (const targetId of suppressedIds) {
    resolveRepresentative(targetId, selectedSuppression);
  }

  const contextRelationshipIds = new Map<number, number[]>();
  const confounderFindingIds = new Map<number, number[]>();
  for (const relationship of relationships) {
    if (
      relationship.relationshipType === 'CONDITIONAL_ON'
      || relationship.relationshipType === 'CONTRIBUTES_TO'
    ) {
      const endpointIds = [relationship.sourceFindingId, relationship.targetFindingId];
      for (const findingId of endpointIds) {
        const finding = findingsById.get(findingId);
        const otherId = findingId === relationship.sourceFindingId
          ? relationship.targetFindingId
          : relationship.sourceFindingId;
        if (
          finding?.findingLevel === 'CONTRIBUTING_CONDITION'
          && supportedIds.has(findingId)
          && supportedIds.has(otherId)
        ) {
          const current = contextRelationshipIds.get(findingId) ?? [];
          current.push(relationship.id);
          contextRelationshipIds.set(findingId, current);
        }
      }
    }
    if (relationship.relationshipType === 'CONFOUNDED_BY') {
      const current = confounderFindingIds.get(relationship.sourceFindingId) ?? [];
      current.push(relationship.targetFindingId);
      confounderFindingIds.set(relationship.sourceFindingId, current);
    }
  }

  const topLevelIds = new Set(
    supportedFindings
      .filter((finding) => !suppressedIds.has(finding.id))
      .map((finding) => finding.id),
  );

  return [...findings]
    .sort(stableFindingOrder)
    .map<DiagnosisFindingConsolidationDraft>((finding) => {
      const clusterKey = clusterKeys.get(finding.id) ?? ('cluster:' + finding.findingKey);

      if (!supportedIds.has(finding.id)) {
        return {
          findingId: finding.id,
          representativeFindingId: null,
          state: 'INELIGIBLE',
          topLevelEligible: false,
          clusterKey,
          reasonKeys: ['SOURCE_FINDING_NOT_SUPPORTED'],
          policyVersion: DIAGNOSIS_CONSOLIDATION_POLICY_VERSION,
          support: {
            findingKey: finding.findingKey,
            diagnosisId: finding.diagnosisId,
            observationState: finding.observationState,
            evidenceStrength: finding.evidenceStrength,
            requiredEvidenceCoverage: finding.requiredEvidenceCoverage,
          },
        };
      }

      const selected = selectedSuppression.get(finding.id);
      if (selected) {
        const representativeFindingId = resolveRepresentative(
          finding.id,
          selectedSuppression,
        );
        const alternatives = (candidatesByTarget.get(finding.id) ?? [])
          .map((candidate) => candidate.source.id);
        return {
          findingId: finding.id,
          representativeFindingId,
          state: 'SUPPRESSED_DRILLDOWN',
          topLevelEligible: false,
          clusterKey,
          reasonKeys: [suppressionReason(selected.relationship)],
          policyVersion: DIAGNOSIS_CONSOLIDATION_POLICY_VERSION,
          support: {
            findingKey: finding.findingKey,
            diagnosisId: finding.diagnosisId,
            directParentFindingId: selected.source.id,
            representativeFindingId,
            relationshipId: selected.relationship.id,
            relationshipType: selected.relationship.relationshipType,
            alternativeRepresentativeFindingIds: sortedUniqueIds(alternatives),
            overlap: overlapSupport(selected.overlap),
          },
        };
      }

      const topLevelMaterialPeers = [...(materialPeers.get(finding.id) ?? [])]
        .filter((peerId) => topLevelIds.has(peerId));
      const contextEdges = sortedUniqueIds(contextRelationshipIds.get(finding.id) ?? []);
      const confounders = sortedUniqueIds(confounderFindingIds.get(finding.id) ?? []);
      const reasonKeys: DiagnosisConsolidationReasonKey[] = [];
      if (contextEdges.length > 0) reasonKeys.push('MATERIAL_CONTEXT_RETAINED');
      if (topLevelMaterialPeers.length > 0) reasonKeys.push('UNRESOLVED_MATERIAL_OVERLAP');

      return {
        findingId: finding.id,
        representativeFindingId: null,
        state: topLevelMaterialPeers.length > 0
          ? 'TOP_LEVEL_MATERIAL_OVERLAP'
          : 'TOP_LEVEL',
        topLevelEligible: true,
        clusterKey,
        reasonKeys,
        policyVersion: DIAGNOSIS_CONSOLIDATION_POLICY_VERSION,
        support: {
          findingKey: finding.findingKey,
          diagnosisId: finding.diagnosisId,
          materialOverlapPeerFindingIds: sortedUniqueIds(topLevelMaterialPeers),
          retainedContextRelationshipIds: contextEdges,
          confounderFindingIds: confounders,
        },
      };
    });
}

export async function materializeCurrentDiagnosisConsolidation(
  appUserId: number,
  scopeKey: string,
  versions: DiagnosisFindingVersionTuple,
  repository: DiagnosisConsolidationRepository,
): Promise<DiagnosisConsolidationResult> {
  if (!Number.isSafeInteger(appUserId) || appUserId <= 0) {
    throw new RangeError('appUserId must be a positive safe integer.');
  }
  if (scopeKey.length === 0 || scopeKey.length > 128) {
    throw new RangeError('scopeKey must contain 1-128 characters.');
  }
  if (versions.synthesisPolicyVersion !== DIAGNOSIS_SYNTHESIS_POLICY_VERSION) {
    throw new Error('Diagnosis consolidation only supports the current synthesis-policy version.');
  }
  if (
    !isRecord(versions.policyVersions)
    || versions.policyVersions.consolidation !== DIAGNOSIS_CONSOLIDATION_POLICY_VERSION
  ) {
    throw new Error('Diagnosis consolidation only supports the current consolidation-policy version.');
  }
  if (versions.policyVersions.eventIdentity !== DIAGNOSIS_EVENT_IDENTITY_VERSION) {
    throw new Error('Diagnosis consolidation only supports the current event-identity version.');
  }

  const snapshot: DiagnosisFindingSetSnapshot | null = await repository.getCurrentScope(
    appUserId,
    scopeKey,
    versions,
  );
  if (!snapshot || !snapshot.isCurrent || snapshot.supersededAt !== null) {
    throw new Error('Current diagnosis finding scope is unavailable for consolidation.');
  }
  await repository.assertCurrentSourceReferences(appUserId, snapshot);

  const overlaps = calculateDiagnosisFindingOverlaps(snapshot.findings);
  const draft = buildDiagnosisConsolidation(
    snapshot.findings,
    snapshot.relationships,
    overlaps,
  );
  const consolidations = await repository.replaceCurrentConsolidations(
    appUserId,
    snapshot.id,
    DIAGNOSIS_CONSOLIDATION_POLICY_VERSION,
    draft,
  );

  return {
    findingSetId: snapshot.id,
    scopeKey: snapshot.scopeKey,
    policyVersion: DIAGNOSIS_CONSOLIDATION_POLICY_VERSION,
    consolidations,
  };
}
