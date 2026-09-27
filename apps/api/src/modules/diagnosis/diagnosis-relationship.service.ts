import {
  DIAGNOSIS_BOUNDEDNESS_POLICY,
  DIAGNOSIS_RELATIONSHIP_TYPES,
  DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
  type DiagnosisRelationshipType,
} from '@why-i-suck-at-chess/chess-domain';
import type {
  DiagnosisFindingSetSnapshot,
  DiagnosisFindingVersionTuple,
  PersistedDiagnosisFinding,
  PersistedDiagnosisFindingRelationship,
} from './diagnosis-finding.types';
import {
  calculateDiagnosisFindingOverlaps,
  type DiagnosisFindingOverlapRepository,
  type DiagnosisFindingOverlapResult,
} from './diagnosis-overlap.service';

export const DIAGNOSIS_RELATIONSHIP_GRAPH_VERSION = 'diagnosis-relationship-graph-v1' as const;

export interface DiagnosisRelationshipEdgeDraft {
  sourceFindingId: number;
  targetFindingId: number;
  relationshipType: DiagnosisRelationshipType;
  policyVersion: typeof DIAGNOSIS_SYNTHESIS_POLICY_VERSION;
  support: Readonly<Record<string, unknown>>;
}

export interface DiagnosisRelationshipRepository extends DiagnosisFindingOverlapRepository {
  replaceCurrentRelationships(
    appUserId: number,
    findingSetId: number,
    policyVersion: typeof DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
    relationships: readonly DiagnosisRelationshipEdgeDraft[],
  ): Promise<readonly PersistedDiagnosisFindingRelationship[]>;
}

export interface DiagnosisRelationshipGraphResult {
  findingSetId: number;
  scopeKey: string;
  graphVersion: typeof DIAGNOSIS_RELATIONSHIP_GRAPH_VERSION;
  policyVersion: typeof DIAGNOSIS_SYNTHESIS_POLICY_VERSION;
  relationships: readonly PersistedDiagnosisFindingRelationship[];
}

type RegistryRelationshipType = Exclude<
  DiagnosisRelationshipType,
  'SHARES_EVENTS_WITH' | 'CONFOUNDED_BY'
>;

interface DiagnosisRelationshipRule {
  key: string;
  relationshipType: RegistryRelationshipType;
  sourceDiagnosisIds: readonly string[];
  targetDiagnosisIds: readonly string[];
  requiresMaterialOverlap?: boolean;
}

const TACTICAL_MECHANISMS = Object.freeze([
  'TACT-001',
  'TACT-002',
  'TACT-003',
  'TACT-004',
  'TACT-005',
]);

export const DIAGNOSIS_RELATIONSHIP_RULES: readonly DiagnosisRelationshipRule[] = Object.freeze([
  Object.freeze({
    key: 'tactical-mechanism-specializes-tactical-error-rate',
    relationshipType: 'SPECIALIZES',
    sourceDiagnosisIds: TACTICAL_MECHANISMS,
    targetDiagnosisIds: Object.freeze(['TACT-006']),
  }),
  Object.freeze({
    key: 'rook-endgame-specializes-endgame-family',
    relationshipType: 'SPECIALIZES',
    sourceDiagnosisIds: Object.freeze(['END-003']),
    targetDiagnosisIds: Object.freeze(['END-002']),
  }),
  Object.freeze({
    key: 'overlong-session-manifests-as-late-session-deterioration',
    relationshipType: 'MANIFESTS_AS',
    sourceDiagnosisIds: Object.freeze(['SESSION-003']),
    targetDiagnosisIds: Object.freeze(['SESSION-001']),
  }),
  Object.freeze({
    key: 'early-time-overuse-contributes-to-pressure-quality-collapse',
    relationshipType: 'CONTRIBUTES_TO',
    sourceDiagnosisIds: Object.freeze(['TIME-004']),
    targetDiagnosisIds: Object.freeze(['TIME-002']),
  }),
  Object.freeze({
    key: 'tactical-mechanism-conditional-on-time-pressure-collapse',
    relationshipType: 'CONDITIONAL_ON',
    sourceDiagnosisIds: TACTICAL_MECHANISMS,
    targetDiagnosisIds: Object.freeze(['TIME-002']),
    requiresMaterialOverlap: true,
  }),
  Object.freeze({
    key: 'early-time-overuse-explains-frequent-pressure',
    relationshipType: 'EXPLAINS_OBSERVATION',
    sourceDiagnosisIds: Object.freeze(['TIME-004']),
    targetDiagnosisIds: Object.freeze(['TIME-001']),
  }),
]);

function assertPositiveId(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive safe integer.`);
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function containsMaterialCompositionWarning(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || value === undefined) return false;
  if (Array.isArray(value)) {
    return value.some((item) => containsMaterialCompositionWarning(item, depth + 1));
  }
  if (!isRecord(value)) return false;
  if (value.materialCompositionWarning === true) return true;
  return Object.values(value).some((item) => containsMaterialCompositionWarning(item, depth + 1));
}

function hasExplicitRatingConfounder(finding: PersistedDiagnosisFinding): boolean {
  if (!isRecord(finding.coverage)) return false;
  return containsMaterialCompositionWarning(finding.coverage.ratingComposition);
}

function stableFindingOrder(
  left: PersistedDiagnosisFinding,
  right: PersistedDiagnosisFinding,
): number {
  const keyOrder = left.findingKey.localeCompare(right.findingKey);
  return keyOrder !== 0 ? keyOrder : left.id - right.id;
}

function overlapPairKey(leftId: number, rightId: number): string {
  return leftId < rightId ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;
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
      throw new Error('Relationship graph requires persisted finding IDs in overlap output.');
    }
    if (!findingsById.has(leftId) || !findingsById.has(rightId)) {
      throw new Error('Relationship overlap references a finding outside the current set.');
    }
    const key = overlapPairKey(leftId, rightId);
    if (index.has(key)) {
      throw new Error('Relationship overlap input contains a duplicate finding pair.');
    }
    index.set(key, overlap);
  }
  return index;
}

function relationshipSupport(
  rule: DiagnosisRelationshipRule,
  source: PersistedDiagnosisFinding,
  target: PersistedDiagnosisFinding,
  overlap: DiagnosisFindingOverlapResult | null,
): Readonly<Record<string, unknown>> {
  return {
    graphVersion: DIAGNOSIS_RELATIONSHIP_GRAPH_VERSION,
    ruleKey: rule.key,
    source: {
      findingKey: source.findingKey,
      diagnosisId: source.diagnosisId,
      producerKey: source.producerKey,
      producerVersion: source.producerVersion,
    },
    target: {
      findingKey: target.findingKey,
      diagnosisId: target.diagnosisId,
      producerKey: target.producerKey,
      producerVersion: target.producerVersion,
    },
    ...(overlap
      ? {
          overlap: {
            calculationVersion: overlap.calculationVersion,
            eventIdentityVersion: overlap.eventIdentityVersion,
            intersectionEventCount: overlap.eventOverlap.intersectionEventCount,
            smallerArmOverlapRate: overlap.eventOverlap.smallerArmOverlapRate,
            sharedDistinctGames: overlap.eventOverlap.sharedDistinctGames,
            sharedDistinctSessions: overlap.eventOverlap.sharedDistinctSessions,
            material: overlap.eventOverlap.material,
          },
        }
      : {}),
  };
}

function edgeKey(edge: DiagnosisRelationshipEdgeDraft): string {
  return [
    edge.relationshipType,
    String(edge.sourceFindingId).padStart(12, '0'),
    String(edge.targetFindingId).padStart(12, '0'),
  ].join('|');
}

function addEdge(
  edges: Map<string, DiagnosisRelationshipEdgeDraft>,
  edge: DiagnosisRelationshipEdgeDraft,
): void {
  if (edge.sourceFindingId === edge.targetFindingId) {
    throw new Error('Diagnosis relationships cannot be self-referential.');
  }
  const key = edgeKey(edge);
  if (!edges.has(key)) edges.set(key, edge);
}

function assertRelationshipRuleRegistry(): void {
  const supportedTypes = new Set<DiagnosisRelationshipType>([
    ...DIAGNOSIS_RELATIONSHIP_RULES.map((rule) => rule.relationshipType),
    'SHARES_EVENTS_WITH',
    'CONFOUNDED_BY',
  ]);
  for (const relationshipType of DIAGNOSIS_RELATIONSHIP_TYPES) {
    if (!supportedTypes.has(relationshipType)) {
      throw new Error(`Relationship graph does not implement ${relationshipType}.`);
    }
  }
  const keys = DIAGNOSIS_RELATIONSHIP_RULES.map((rule) => rule.key);
  if (new Set(keys).size !== keys.length) {
    throw new Error('Diagnosis relationship rule keys must be unique.');
  }
}

assertRelationshipRuleRegistry();

export function buildDiagnosisRelationshipGraph(
  findings: readonly PersistedDiagnosisFinding[],
  overlaps: readonly DiagnosisFindingOverlapResult[],
): readonly DiagnosisRelationshipEdgeDraft[] {
  if (findings.length > DIAGNOSIS_BOUNDEDNESS_POLICY.maxCurrentFindingsPerScope) {
    throw new RangeError('Diagnosis relationship scope exceeds the current-finding bound.');
  }

  const findingsById = new Map<number, PersistedDiagnosisFinding>();
  const findingKeys = new Set<string>();
  for (const finding of findings) {
    assertPositiveId(finding.id, 'finding.id');
    if (findingsById.has(finding.id)) {
      throw new Error(`Duplicate diagnosis finding id: ${finding.id}`);
    }
    if (findingKeys.has(finding.findingKey)) {
      throw new Error(`Duplicate diagnosis finding key: ${finding.findingKey}`);
    }
    findingsById.set(finding.id, finding);
    findingKeys.add(finding.findingKey);
  }

  const activeFindings = findings
    .filter((finding) => finding.observationState === 'PROBLEM_DETECTED')
    .sort(stableFindingOrder);
  const activeIds = new Set(activeFindings.map((finding) => finding.id));
  const overlapIndex = buildOverlapIndex(overlaps, findingsById);
  const edges = new Map<string, DiagnosisRelationshipEdgeDraft>();

  for (const rule of DIAGNOSIS_RELATIONSHIP_RULES) {
    const sources = activeFindings.filter((finding) => rule.sourceDiagnosisIds.includes(finding.diagnosisId));
    const targets = activeFindings.filter((finding) => rule.targetDiagnosisIds.includes(finding.diagnosisId));
    for (const source of sources) {
      for (const target of targets) {
        if (source.id === target.id) continue;
        const overlap = overlapIndex.get(overlapPairKey(source.id, target.id)) ?? null;
        if (rule.requiresMaterialOverlap && overlap?.eventOverlap.material !== true) continue;
        addEdge(edges, {
          sourceFindingId: source.id,
          targetFindingId: target.id,
          relationshipType: rule.relationshipType,
          policyVersion: DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
          support: relationshipSupport(rule, source, target, overlap),
        });
      }
    }
  }

  for (const overlap of overlaps) {
    if (overlap.eventOverlap.material !== true) continue;
    const leftId = overlap.left.id;
    const rightId = overlap.right.id;
    if (leftId === null || rightId === null || !activeIds.has(leftId) || !activeIds.has(rightId)) {
      continue;
    }
    const left = findingsById.get(leftId);
    const right = findingsById.get(rightId);
    if (!left || !right) continue;
    const [source, target] = stableFindingOrder(left, right) <= 0
      ? [left, right]
      : [right, left];
    addEdge(edges, {
      sourceFindingId: source.id,
      targetFindingId: target.id,
      relationshipType: 'SHARES_EVENTS_WITH',
      policyVersion: DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
      support: {
        graphVersion: DIAGNOSIS_RELATIONSHIP_GRAPH_VERSION,
        ruleKey: 'material-event-overlap',
        overlap: {
          calculationVersion: overlap.calculationVersion,
          eventIdentityVersion: overlap.eventIdentityVersion,
          intersectionEventCount: overlap.eventOverlap.intersectionEventCount,
          unionEventCount: overlap.eventOverlap.unionEventCount,
          smallerArmOverlapRate: overlap.eventOverlap.smallerArmOverlapRate,
          jaccardRate: overlap.eventOverlap.jaccardRate,
          sharedDistinctGames: overlap.eventOverlap.sharedDistinctGames,
          sharedDistinctSessions: overlap.eventOverlap.sharedDistinctSessions,
          material: true,
        },
      },
    });
  }

  const ratingConfounders = activeFindings.filter((finding) => finding.diagnosisId === 'RATING-002');
  if (ratingConfounders.length > 1) {
    throw new Error('Relationship graph cannot choose between multiple active RATING-002 confounders.');
  }
  const confounder = ratingConfounders[0] ?? null;
  if (confounder) {
    for (const finding of activeFindings) {
      if (finding.id === confounder.id || !hasExplicitRatingConfounder(finding)) continue;
      addEdge(edges, {
        sourceFindingId: finding.id,
        targetFindingId: confounder.id,
        relationshipType: 'CONFOUNDED_BY',
        policyVersion: DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
        support: {
          graphVersion: DIAGNOSIS_RELATIONSHIP_GRAPH_VERSION,
          ruleKey: 'explicit-rating-composition-warning',
          sourceFindingKey: finding.findingKey,
          confounderFindingKey: confounder.findingKey,
          confounderEffect: confounder.effect,
          confounderEvidenceStrength: confounder.evidenceStrength,
        },
      });
    }
  }

  return [...edges.values()].sort((left, right) => edgeKey(left).localeCompare(edgeKey(right)));
}

export async function materializeCurrentDiagnosisRelationshipGraph(
  appUserId: number,
  scopeKey: string,
  versions: DiagnosisFindingVersionTuple,
  repository: DiagnosisRelationshipRepository,
): Promise<DiagnosisRelationshipGraphResult> {
  if (!Number.isSafeInteger(appUserId) || appUserId <= 0) {
    throw new RangeError('appUserId must be a positive safe integer.');
  }
  if (scopeKey.length === 0 || scopeKey.length > 128) {
    throw new RangeError('scopeKey must contain 1-128 characters.');
  }
  if (versions.synthesisPolicyVersion !== DIAGNOSIS_SYNTHESIS_POLICY_VERSION) {
    throw new Error('Relationship graph only supports the current synthesis-policy version.');
  }

  const snapshot: DiagnosisFindingSetSnapshot | null = await repository.getCurrentScope(
    appUserId,
    scopeKey,
    versions,
  );
  if (!snapshot || !snapshot.isCurrent || snapshot.supersededAt !== null) {
    throw new Error('Current diagnosis finding scope is unavailable for relationship synthesis.');
  }
  await repository.assertCurrentSourceReferences(appUserId, snapshot);

  const overlaps = calculateDiagnosisFindingOverlaps(snapshot.findings);
  const draft = buildDiagnosisRelationshipGraph(snapshot.findings, overlaps);
  const relationships = await repository.replaceCurrentRelationships(
    appUserId,
    snapshot.id,
    DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
    draft,
  );

  return {
    findingSetId: snapshot.id,
    scopeKey: snapshot.scopeKey,
    graphVersion: DIAGNOSIS_RELATIONSHIP_GRAPH_VERSION,
    policyVersion: DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
    relationships,
  };
}
