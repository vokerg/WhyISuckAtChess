import type {
  DiagnosisDrillDownResponse,
  DiagnosisDrillDownSupportRole,
  DiagnosisDrillDownSupportingFinding,
} from '@why-i-suck-at-chess/contracts';
import {
  DIAGNOSIS_BOUNDEDNESS_POLICY,
  DIAGNOSIS_CONSOLIDATION_POLICY_VERSION,
  DIAGNOSIS_RANKING_POLICY_VERSION,
} from '@why-i-suck-at-chess/chess-domain';
import {
  prismaDiagnosisDrillDownRepository,
  type DiagnosisDrillDownFindingRow,
  type DiagnosisDrillDownRepository,
} from './diagnosis-drill-down.repository.prisma';
import {
  diagnosisSummaryService,
  type DiagnosisSummaryService,
} from './diagnosis-summary.service';

type SummaryBoundary = Pick<DiagnosisSummaryService, 'getSummary'>;

function unavailable(
  scopeKey: string,
  reason: Extract<DiagnosisDrillDownResponse, { status: 'UNAVAILABLE' }>['reason'],
): DiagnosisDrillDownResponse {
  return { status: 'UNAVAILABLE', scopeKey, reason };
}

function supportRole(value: string): DiagnosisDrillDownSupportRole | null {
  if (
    value === 'MECHANISM'
    || value === 'CONDITION_OR_OBSERVATION'
    || value === 'ADDITIONAL_SUPPORT'
  ) {
    return value;
  }
  return null;
}

function validEffect(
  finding: DiagnosisDrillDownFindingRow,
): DiagnosisDrillDownSupportingFinding['effect'] | null {
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
    throw new Error('Diagnosis drill-down encountered a partially materialized effect.');
  }
  return {
    metric: finding.effectMetric,
    value: finding.effectValue,
    unit: finding.effectUnit,
    direction: finding.effectDirection,
  };
}

export interface DiagnosisDrillDownService {
  getFinding(
    appUserId: number,
    scopeKey: string,
    findingId: number,
  ): Promise<DiagnosisDrillDownResponse>;
}

export function createDiagnosisDrillDownService(
  repository: DiagnosisDrillDownRepository = prismaDiagnosisDrillDownRepository,
  summaryService: SummaryBoundary = diagnosisSummaryService,
): DiagnosisDrillDownService {
  return {
    async getFinding(appUserId, scopeKey, findingId) {
      if (!Number.isSafeInteger(appUserId) || appUserId <= 0) {
        throw new RangeError('appUserId must be a positive safe integer.');
      }
      if (scopeKey.length === 0 || scopeKey.length > 128) {
        throw new RangeError('scopeKey must contain 1-128 characters.');
      }
      if (!Number.isSafeInteger(findingId) || findingId <= 0) {
        throw new RangeError('findingId must be a positive safe integer.');
      }

      const summary = await summaryService.getSummary(appUserId, scopeKey);
      if (summary.status === 'UNAVAILABLE') {
        return unavailable(scopeKey, summary.reason);
      }

      const finding = summary.items.find((item) => item.findingId === findingId);
      if (!finding) return unavailable(scopeKey, 'FINDING_NOT_FOUND');

      const rankings = await repository.findSupportingRankings(
        appUserId,
        summary.findingSetId,
        scopeKey,
        findingId,
      );
      if (!rankings) return unavailable(scopeKey, 'NO_CURRENT_DIAGNOSIS');
      if (rankings.length > DIAGNOSIS_BOUNDEDNESS_POLICY.maxCurrentFindingsPerScope) {
        return unavailable(scopeKey, 'RANKING_INCOMPLETE');
      }

      const seen = new Set<number>();
      const supportingFindings: DiagnosisDrillDownSupportingFinding[] = [];
      for (const ranking of rankings) {
        if (
          ranking.findingId !== ranking.finding.id
          || seen.has(ranking.findingId)
          || !ranking.parentRootFindingIds.includes(findingId)
          || !Number.isFinite(ranking.finalScore)
          || ranking.finalScore < 0
          || ranking.finalScore > 1
        ) {
          return unavailable(scopeKey, 'RANKING_INCOMPLETE');
        }
        seen.add(ranking.findingId);

        if (ranking.rankingPolicyVersion !== DIAGNOSIS_RANKING_POLICY_VERSION) {
          return unavailable(scopeKey, 'RANKING_STALE');
        }

        const consolidation = ranking.finding.consolidationState;
        if (
          !consolidation
          || consolidation.policyVersion !== DIAGNOSIS_CONSOLIDATION_POLICY_VERSION
        ) {
          return unavailable(scopeKey, 'HIERARCHY_INCOMPLETE');
        }
        if (ranking.consolidationState !== consolidation.state) {
          return unavailable(scopeKey, 'RANKING_INCOMPLETE');
        }

        if (ranking.finding.supportRoles.length !== 1) {
          return unavailable(scopeKey, 'HIERARCHY_INCOMPLETE');
        }
        const role = supportRole(ranking.finding.supportRoles[0] ?? '');
        if (!role) return unavailable(scopeKey, 'HIERARCHY_INCOMPLETE');

        supportingFindings.push({
          findingId: ranking.finding.id,
          findingKey: ranking.finding.findingKey,
          diagnosisId: ranking.finding.diagnosisId,
          findingLevel: ranking.finding.findingLevel as DiagnosisDrillDownSupportingFinding['findingLevel'],
          observationState: ranking.finding.observationState as DiagnosisDrillDownSupportingFinding['observationState'],
          claimKey: ranking.finding.claimKey,
          evidenceStrength: ranking.finding.evidenceStrength as DiagnosisDrillDownSupportingFinding['evidenceStrength'],
          sampleCount: ranking.finding.sampleCount,
          distinctGameCount: ranking.finding.distinctGameCount,
          distinctSessionCount: ranking.finding.distinctSessionCount,
          requiredEvidenceCoverage: ranking.finding.requiredEvidenceCoverage,
          effect: validEffect(ranking.finding),
          consolidationState: consolidation.state,
          finalScore: ranking.finalScore,
          representativeEvidence: ranking.finding.evidenceReferences.map((reference) => ({
            referenceKey: reference.referenceKey,
            referenceType: reference.referenceType,
            importedGameId: reference.importedGameId,
            sourcePlyStart: reference.sourcePlyStart,
            sourcePlyEnd: reference.sourcePlyEnd,
            eventIdentityKey: reference.eventIdentityKey,
          })),
          supportRole: role,
        });
      }

      return {
        status: 'AVAILABLE',
        scopeKey: summary.scopeKey,
        findingSetId: summary.findingSetId,
        calculationAsOf: summary.calculationAsOf,
        versions: summary.versions,
        finding,
        supportingFindings,
      };
    },
  };
}

export const diagnosisDrillDownService = createDiagnosisDrillDownService();
