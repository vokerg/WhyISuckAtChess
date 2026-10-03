import type {
  DiagnosisSummaryItem,
  DiagnosisSummaryResponse,
} from '@why-i-suck-at-chess/contracts';
import {
  DIAGNOSIS_CONSOLIDATION_POLICY_VERSION,
  DIAGNOSIS_RANKING_POLICY_VERSION,
  DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
} from '@why-i-suck-at-chess/chess-domain';
import {
  prismaDiagnosisSummaryRepository,
  type DiagnosisSummaryFindingRow,
  type DiagnosisSummaryRepository,
} from './diagnosis-summary.repository.prisma';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unavailable(
  scopeKey: string,
  reason: Extract<DiagnosisSummaryResponse, { status: 'UNAVAILABLE' }>['reason'],
): DiagnosisSummaryResponse {
  return { status: 'UNAVAILABLE', scopeKey, reason };
}

function currentPolicyVersions(value: unknown): boolean {
  return isRecord(value)
    && value.consolidation === DIAGNOSIS_CONSOLIDATION_POLICY_VERSION
    && value.ranking === DIAGNOSIS_RANKING_POLICY_VERSION;
}

function validEffect(
  finding: DiagnosisSummaryFindingRow,
): DiagnosisSummaryItem['effect'] | null {
  const values = [
    finding.effectMetric,
    finding.effectValue,
    finding.effectUnit,
    finding.effectDirection,
  ];
  if (values.every((value) => value === null)) return null;
  if (
    typeof finding.effectMetric !== 'string'
    || finding.effectMetric.length === 0
    || typeof finding.effectValue !== 'number'
    || !Number.isFinite(finding.effectValue)
    || typeof finding.effectUnit !== 'string'
    || finding.effectUnit.length === 0
    || typeof finding.effectDirection !== 'string'
    || finding.effectDirection.length === 0
  ) {
    throw new Error('Diagnosis summary encountered a partially materialized effect.');
  }
  return {
    metric: finding.effectMetric,
    value: finding.effectValue,
    unit: finding.effectUnit,
    direction: finding.effectDirection,
  };
}

function stableTopLevelRows(
  findings: readonly DiagnosisSummaryFindingRow[],
): DiagnosisSummaryFindingRow[] | null {
  const eligible = findings.filter(
    (finding) => finding.consolidationState?.topLevelEligible === true,
  );

  for (const finding of findings) {
    const consolidation = finding.consolidationState;
    const ranking = finding.rankingState;
    if (!consolidation) return null;
    if (ranking && !consolidation.topLevelEligible) return null;
    if (consolidation.topLevelEligible && !ranking) return null;
    if (!ranking) continue;
    if (ranking.consolidationState !== consolidation.state) return null;
    if (ranking.topLevelRanked) {
      if (!Number.isSafeInteger(ranking.rankPosition) || (ranking.rankPosition ?? 0) <= 0) {
        return null;
      }
    } else if (ranking.rankPosition !== null) {
      return null;
    }
    if (!Number.isFinite(ranking.finalScore) || ranking.finalScore < 0 || ranking.finalScore > 1) {
      return null;
    }
  }

  const topLevel = eligible
    .filter((finding) => finding.rankingState?.topLevelRanked === true)
    .sort((left, right) => (
      (left.rankingState?.rankPosition ?? Number.MAX_SAFE_INTEGER)
      - (right.rankingState?.rankPosition ?? Number.MAX_SAFE_INTEGER)
    ));

  for (let index = 0; index < topLevel.length; index += 1) {
    if (topLevel[index]?.rankingState?.rankPosition !== index + 1) return null;
  }
  return topLevel;
}

export interface DiagnosisSummaryService {
  getSummary(appUserId: number, scopeKey: string): Promise<DiagnosisSummaryResponse>;
}

export function createDiagnosisSummaryService(
  repository: DiagnosisSummaryRepository = prismaDiagnosisSummaryRepository,
): DiagnosisSummaryService {
  return {
    async getSummary(appUserId, scopeKey) {
      if (!Number.isSafeInteger(appUserId) || appUserId <= 0) {
        throw new RangeError('appUserId must be a positive safe integer.');
      }
      if (scopeKey.length === 0 || scopeKey.length > 128) {
        throw new RangeError('scopeKey must contain 1-128 characters.');
      }

      const current = await repository.findCurrent(appUserId, scopeKey);
      if (!current) return unavailable(scopeKey, 'NO_CURRENT_DIAGNOSIS');

      if (
        current.synthesisPolicyVersion !== DIAGNOSIS_SYNTHESIS_POLICY_VERSION
        || !currentPolicyVersions(current.policyVersions)
      ) {
        return unavailable(scopeKey, 'RANKING_STALE');
      }

      if (current.findings.some((finding) => (
        !finding.consolidationState
        || finding.consolidationState.policyVersion !== DIAGNOSIS_CONSOLIDATION_POLICY_VERSION
      ))) {
        return unavailable(scopeKey, 'HIERARCHY_INCOMPLETE');
      }

      if (current.findings.some((finding) => (
        finding.rankingState !== null
        && finding.rankingState.rankingPolicyVersion !== DIAGNOSIS_RANKING_POLICY_VERSION
      ))) {
        return unavailable(scopeKey, 'RANKING_STALE');
      }

      const topLevel = stableTopLevelRows(current.findings);
      if (!topLevel) return unavailable(scopeKey, 'RANKING_INCOMPLETE');

      return {
        status: 'AVAILABLE',
        scopeKey: current.scopeKey,
        findingSetId: current.id,
        calculationAsOf: current.calculationAsOf.toISOString(),
        versions: {
          taxonomy: current.taxonomyVersion,
          synthesis: current.synthesisPolicyVersion,
          calculation: current.calculationVersion,
          ranking: DIAGNOSIS_RANKING_POLICY_VERSION,
        },
        items: topLevel.map<DiagnosisSummaryItem>((finding) => {
          const ranking = finding.rankingState;
          const consolidation = finding.consolidationState;
          if (!ranking || !consolidation || ranking.rankPosition === null) {
            throw new Error('Diagnosis summary lost validated ranking state.');
          }
          return {
            findingId: finding.id,
            findingKey: finding.findingKey,
            diagnosisId: finding.diagnosisId,
            findingLevel: finding.findingLevel as DiagnosisSummaryItem['findingLevel'],
            observationState: finding.observationState as DiagnosisSummaryItem['observationState'],
            claimKey: finding.claimKey,
            evidenceStrength: finding.evidenceStrength as DiagnosisSummaryItem['evidenceStrength'],
            sampleCount: finding.sampleCount,
            distinctGameCount: finding.distinctGameCount,
            distinctSessionCount: finding.distinctSessionCount,
            requiredEvidenceCoverage: finding.requiredEvidenceCoverage,
            effect: validEffect(finding),
            consolidationState: consolidation.state,
            rankPosition: ranking.rankPosition,
            finalScore: ranking.finalScore,
            representativeEvidence: finding.evidenceReferences.map((reference) => ({
              referenceKey: reference.referenceKey,
              referenceType: reference.referenceType,
              importedGameId: reference.importedGameId,
              sourcePlyStart: reference.sourcePlyStart,
              sourcePlyEnd: reference.sourcePlyEnd,
              eventIdentityKey: reference.eventIdentityKey,
            })),
          };
        }),
      };
    },
  };
}

export const diagnosisSummaryService = createDiagnosisSummaryService();
