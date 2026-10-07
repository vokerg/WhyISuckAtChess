import type {
  TimeControlComparisonQuery,
  TimeControlComparisonResponse,
} from '@why-i-suck-at-chess/contracts';
import {
  getExactTimeControlUnderperformance,
  type ExactTimeControlArm,
  type ExactTimeControlScope,
  type ExactTimeControlUnderperformanceResult,
} from './exact-time-control-underperformance.service';
import { prismaExactTimeControlRepository } from './exact-time-control-underperformance.repository.prisma';
import {
  getIncrementEffect,
  type IncrementEffectArm,
  type IncrementEffectResult,
  type IncrementEffectScope,
} from './increment-effect.service';
import { prismaIncrementEffectRepository } from './increment-effect.repository.prisma';
import { prismaRatingContextCompositionRepository } from './rating-context-composition.repository.prisma';

export const TIME_CONTROL_COMPARISON_ITEM_LIMIT = 25;
export const TIME_CONTROL_COMPARISON_EXACT_CONTROL_LIMIT = 12;
export const TIME_CONTROL_COMPARISON_CAVEAT_LIMIT = 20;

export interface TimeControlComparisonDependencies {
  getExactTimeControl(
    appUserId: number,
    scope: ExactTimeControlScope,
  ): Promise<ExactTimeControlUnderperformanceResult>;
  getIncrementEffect(
    appUserId: number,
    scope: IncrementEffectScope,
  ): Promise<IncrementEffectResult>;
}

export interface TimeControlComparisonService {
  getComparison(
    appUserId: number,
    query: TimeControlComparisonQuery,
  ): Promise<TimeControlComparisonResponse>;
}

function parseScope(query: TimeControlComparisonQuery): {
  exact: ExactTimeControlScope;
  increment: IncrementEffectScope;
} {
  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(query.to) : undefined;

  for (const value of [from, to]) {
    if (value && !Number.isFinite(value.getTime())) {
      throw new RangeError('Time-control comparison scope contains an invalid date.');
    }
  }
  if (from && to && from.getTime() >= to.getTime()) {
    throw new RangeError('Time-control comparison scope "from" must be earlier than "to".');
  }

  return {
    exact: { from, to },
    increment: { from, to },
  };
}

function collectionMeta(total: number, returned: number) {
  return {
    total,
    returned,
    truncated: returned < total,
  };
}

function ratingDisclosure(value: {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  reason: string | null;
  result: {
    comparison: {
      materialCompositionWarning: boolean | null;
    };
  } | null;
}) {
  return {
    status: value.status,
    reason: value.reason,
    materialCompositionWarning:
      value.result?.comparison.materialCompositionWarning ?? null,
  };
}

function exactArm(arm: ExactTimeControlArm) {
  return {
    exactTimeControlKey: arm.exactTimeControlKey,
    initialSeconds: arm.initialSeconds,
    incrementSeconds: arm.incrementSeconds,
    eligibleGames: arm.eligibleGames,
    resultCoveredGames: arm.resultCoveredGames,
    scorePercent: arm.scorePercent,
    analysedGames: arm.analysedGames,
    averageScoreLossCp: arm.averageScoreLossCp,
    majorErrorRatePercent: arm.majorErrorRatePercent,
    blunderRatePercent: arm.blunderRatePercent,
    resultEvidenceStrength: arm.resultEvidenceStrength,
    qualityEvidenceStrength: arm.qualityEvidenceStrength,
  };
}

function incrementArm(arm: IncrementEffectArm) {
  const exactControls = arm.exactControls.slice(
    0,
    TIME_CONTROL_COMPARISON_EXACT_CONTROL_LIMIT,
  );

  return {
    games: arm.games,
    exactControls: {
      ...collectionMeta(arm.exactControls.length, exactControls.length),
      items: exactControls,
    },
    resultCoveredGames: arm.resultCoveredGames,
    scorePercent: arm.scorePercent,
    analysedGames: arm.analysedGames,
    averageScoreLossCp: arm.averageScoreLossCp,
    majorErrorRatePercent: arm.majorErrorRatePercent,
    blunderRatePercent: arm.blunderRatePercent,
    pressure: {
      timingCoveredGames: arm.pressure.timingCoveredGames,
      timingCoveragePercent: arm.pressure.timingCoveragePercent,
      pressureMoveRatePercent: arm.pressure.pressureMoveRatePercent,
      pressureEntryRatePercent: arm.pressure.pressureEntryRatePercent,
    },
    evidenceStrength: arm.evidenceStrength,
  };
}

export function createTimeControlComparisonService(
  dependencies: TimeControlComparisonDependencies,
): TimeControlComparisonService {
  return {
    async getComparison(appUserId, query) {
      const scope = parseScope(query);
      const [exact, increment] = await Promise.all([
        dependencies.getExactTimeControl(appUserId, scope.exact),
        dependencies.getIncrementEffect(appUserId, scope.increment),
      ]);

      const exactComparisons = exact.comparisons.slice(
        0,
        TIME_CONTROL_COMPARISON_ITEM_LIMIT,
      );
      const incrementStrata = increment.strata.slice(
        0,
        TIME_CONTROL_COMPARISON_ITEM_LIMIT,
      );

      return {
        scope: {
          from: query.from ?? null,
          to: query.to ?? null,
        },
        exactControl: {
          diagnosisId: exact.diagnosisId,
          policyVersion: exact.policyVersion,
          timeBehaviorPolicyVersion: exact.timeBehaviorPolicyVersion,
          coverage: {
            status: exact.coverage.status,
            reason: exact.coverage.reason,
            candidateGames: exact.coverage.candidateGames,
            eligibleGames: exact.coverage.eligibleGames,
            exactControls: exact.coverage.exactControls,
            controlsWithComparator: exact.coverage.controlsWithComparator,
            resultCoveragePercent: exact.coverage.resultCoveragePercent,
            analysisCoveragePercent: exact.coverage.analysisCoveragePercent,
          },
          comparisonCount: collectionMeta(
            exact.comparisons.length,
            exactComparisons.length,
          ),
          comparisons: exactComparisons.map((comparison) => ({
            status: comparison.status,
            reason: comparison.reason,
            target: exactArm(comparison.target),
            comparator: comparison.comparator
              ? exactArm(comparison.comparator)
              : null,
            deltas: comparison.deltas,
            evidenceStrength: comparison.evidenceStrength,
            ratingComposition: ratingDisclosure(comparison.ratingComposition),
          })),
          caveats: exact.caveats.slice(0, TIME_CONTROL_COMPARISON_CAVEAT_LIMIT),
        },
        incrementEffect: {
          diagnosisId: increment.diagnosisId,
          policyVersion: increment.policyVersion,
          timeBehaviorPolicyVersion: increment.timeBehaviorPolicyVersion,
          timingDerivationVersion: increment.timingDerivationVersion,
          coverage: {
            status: increment.coverage.status,
            reason: increment.coverage.reason,
            candidateGames: increment.coverage.candidateGames,
            eligibleGames: increment.coverage.eligibleGames,
            matchedGames: increment.coverage.matchedGames,
            unmatchedGames: increment.coverage.unmatchedGames,
            matchedInitialTimeStrata: increment.coverage.matchedInitialTimeStrata,
            resultCoveragePercent: increment.coverage.resultCoveragePercent,
            analysisCoveragePercent: increment.coverage.analysisCoveragePercent,
            timingCoveragePercent: increment.coverage.timingCoveragePercent,
          },
          stratumCount: collectionMeta(
            increment.strata.length,
            incrementStrata.length,
          ),
          strata: incrementStrata.map((stratum) => ({
            initialSeconds: stratum.initialSeconds,
            noIncrement: incrementArm(stratum.noIncrement),
            increment: incrementArm(stratum.increment),
            deltas: stratum.deltas,
            evidenceStrength: stratum.evidenceStrength,
            ratingComposition: ratingDisclosure(stratum.ratingComposition),
          })),
          caveats: increment.caveats.slice(
            0,
            TIME_CONTROL_COMPARISON_CAVEAT_LIMIT,
          ),
        },
      };
    },
  };
}

export const timeControlComparisonService = createTimeControlComparisonService({
  getExactTimeControl: (appUserId, scope) =>
    getExactTimeControlUnderperformance(
      appUserId,
      scope,
      prismaExactTimeControlRepository,
      prismaRatingContextCompositionRepository,
    ),
  getIncrementEffect: (appUserId, scope) =>
    getIncrementEffect(
      appUserId,
      scope,
      prismaIncrementEffectRepository,
      prismaRatingContextCompositionRepository,
    ),
});
