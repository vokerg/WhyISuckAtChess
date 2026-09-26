import {
  DIAGNOSIS_BOUNDEDNESS_POLICY,
  diagnosisGameEventIdentityKey,
  diagnosisPlyEventIdentityKey,
  type DiagnosisEvidenceStrength,
  type DiagnosisFindingLevel,
  type DiagnosisObservationState,
} from '@why-i-suck-at-chess/chess-domain';
import type { EvidenceFindingDraft } from '../evidence/evidence.types';
import type { OpeningRecurrenceEvidenceResult } from '../evidence/opening-recurrence.service';
import type { DiagnosisFindingDraft, DiagnosisFindingEffectDraft, DiagnosisFindingEvidenceReferenceDraft } from './diagnosis-finding.types';
import type { TimePressureExposureResult } from './time-pressure-exposure.service';
import type { TimePressureQualityResult } from './time-pressure-quality-collapse.service';
import type { PlayedTooFastResult } from './played-too-fast.service';
import type { EarlyTimeOveruseResult } from './early-time-overuse.service';
import type { ExactTimeControlUnderperformanceResult } from './exact-time-control-underperformance.service';
import type { IncrementEffectResult } from './increment-effect.service';
import type { OpponentMoveSpeedEffectResult } from './opponent-move-speed-effect.service';
import type { OpponentStrengthEffectResult } from './opponent-strength-effect.service';
import type { RatingContextCompositionResult } from './rating-context-composition.service';
import type { SessionDeteriorationResult } from './session-deterioration.service';
import type { LossStreakDeteriorationResult } from './loss-streak-deterioration.service';
import type { OverlongSessionStoppingPointResult } from './overlong-session-stopping-point.service';

export const DIAGNOSIS_CANDIDATE_PROJECTION_VERSION = 'diagnosis-candidate-projection-v1' as const;

export const CANONICAL_DIAGNOSIS_IDS_V1 = Object.freeze([
  'TACT-001', 'TACT-002', 'TACT-003', 'TACT-004', 'TACT-005', 'TACT-006',
  'OPEN-001', 'OPEN-002', 'OPEN-003', 'OPEN-004',
  'CONV-001', 'CONV-002', 'CONV-003',
  'PHASE-001',
  'END-001', 'END-002', 'END-003',
  'TIME-001', 'TIME-002', 'TIME-003', 'TIME-004', 'TIME-005', 'TIME-006', 'TIME-007',
  'SESSION-001', 'SESSION-002', 'SESSION-003',
  'CAL-001',
  'RATING-001', 'RATING-002',
] as const);

export type CanonicalDiagnosisIdV1 = typeof CANONICAL_DIAGNOSIS_IDS_V1[number];

export interface DiagnosisCandidateSourceMap {
  openingRecurrence: OpeningRecurrenceEvidenceResult;
  timePressureExposure: TimePressureExposureResult;
  timePressureQualityCollapse: TimePressureQualityResult;
  playedTooFast: PlayedTooFastResult;
  earlyTimeOveruse: EarlyTimeOveruseResult;
  exactTimeControlUnderperformance: ExactTimeControlUnderperformanceResult;
  incrementEffect: IncrementEffectResult;
  opponentMoveSpeedEffect: OpponentMoveSpeedEffectResult;
  opponentStrengthEffect: OpponentStrengthEffectResult;
  ratingContextComposition: RatingContextCompositionResult;
  sessionDeterioration: SessionDeteriorationResult;
  lossStreakDeterioration: LossStreakDeteriorationResult;
  overlongSessionStoppingPoint: OverlongSessionStoppingPointResult;
}

export type DiagnosisCandidateProducerKey = keyof DiagnosisCandidateSourceMap;

export interface DiagnosisCandidateProducer<K extends DiagnosisCandidateProducerKey> {
  key: K;
  version: typeof DIAGNOSIS_CANDIDATE_PROJECTION_VERSION;
  diagnosisIds: readonly CanonicalDiagnosisIdV1[];
  project(source: DiagnosisCandidateSourceMap[K]): readonly DiagnosisFindingDraft[];
}

export interface UnsupportedDiagnosisProjection {
  diagnosisId: CanonicalDiagnosisIdV1;
  reason: string;
}

const EVIDENCE_ORDER: Readonly<Record<DiagnosisEvidenceStrength, number>> = {
  INSUFFICIENT: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

interface DiagnosisEvidenceSignal {
  modality: 'RESULT' | 'QUALITY' | 'TIMING';
  strength: DiagnosisEvidenceStrength;
  detected: boolean;
  requiredEvidenceCoverage: number | null;
}

function selectSignalEvidence(
  signals: readonly DiagnosisEvidenceSignal[],
): DiagnosisEvidenceSignal {
  const supported = signals.filter((signal) => signal.strength !== 'INSUFFICIENT');
  const detected = supported.filter((signal) => signal.detected);
  const candidates = detected.length > 0 ? detected : supported;
  if (candidates.length === 0) {
    return signals[0] ?? {
      modality: 'RESULT',
      strength: 'INSUFFICIENT',
      detected: false,
      requiredEvidenceCoverage: null,
    };
  }
  return candidates.reduce(
    (best, signal) => EVIDENCE_ORDER[signal.strength] > EVIDENCE_ORDER[best.strength]
      ? signal
      : best,
  );
}

function evidenceStrengthFromSample(
  sample: number,
  coverageFraction: number | null,
): DiagnosisEvidenceStrength {
  if (coverageFraction === null || coverageFraction < 0.5 || sample < 5) return 'INSUFFICIENT';
  if (sample < 15) return 'LOW';
  if (sample < 40) return 'MEDIUM';
  return 'HIGH';
}

function percentToFraction(value: number | null): number | null {
  return value === null ? null : value / 100;
}

function minimumCoveragePercent(...values: readonly (number | null)[]): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finite.length === 0 ? null : Math.min(...finite) / 100;
}

function observationState(
  coverageStatus: string,
  strength: DiagnosisEvidenceStrength,
  detected: boolean,
): DiagnosisObservationState {
  if (coverageStatus === 'UNAVAILABLE') return 'REQUIRED_EVIDENCE_UNAVAILABLE';
  if (strength === 'INSUFFICIENT') return 'INSUFFICIENT_EVIDENCE';
  return detected ? 'PROBLEM_DETECTED' : 'NOT_DETECTED_WITH_ADEQUATE_COVERAGE';
}

function keyPart(value: string | number): string {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 48);
}

function finiteEffect(
  metric: string,
  value: number | null,
  unit: string,
  direction: string,
  comparator?: Readonly<Record<string, unknown>>,
): DiagnosisFindingEffectDraft | null {
  return value === null || !Number.isFinite(value)
    ? null
    : { metric, value, unit, direction, comparator: comparator ?? null };
}

function firstFiniteEffect(
  effects: readonly {
    metric: string;
    value: number | null;
    unit: string;
    direction: string;
  }[],
): DiagnosisFindingEffectDraft | null {
  const selected = effects.find(
    (effect) => effect.value !== null && Number.isFinite(effect.value) && effect.value !== 0,
  ) ?? effects.find(
    (effect) => effect.value !== null && Number.isFinite(effect.value),
  );
  return selected
    ? finiteEffect(selected.metric, selected.value, selected.unit, selected.direction)
    : null;
}

function qualityDeltaEffect(
  averageScoreLossDeltaCp: number | null,
  majorErrorRateDelta: number | null,
  blunderRateDelta: number | null,
  direction: string,
): DiagnosisFindingEffectDraft | null {
  return firstFiniteEffect([
    {
      metric: 'average-score-loss-delta',
      value: averageScoreLossDeltaCp,
      unit: 'CENTIPAWNS',
      direction,
    },
    {
      metric: 'major-error-rate-delta',
      value: majorErrorRateDelta,
      unit: 'PERCENTAGE_POINTS',
      direction,
    },
    {
      metric: 'blunder-rate-delta',
      value: blunderRateDelta,
      unit: 'PERCENTAGE_POINTS',
      direction,
    },
  ]);
}

function worseningQualityDeltaEffect(
  averageScoreLossDeltaCp: number | null,
  majorErrorRateDelta: number | null,
  blunderRateDelta: number | null,
): DiagnosisFindingEffectDraft | null {
  const effects = [
    {
      metric: 'average-score-loss-delta',
      value: averageScoreLossDeltaCp,
      unit: 'CENTIPAWNS',
      direction: 'HIGHER_IS_WORSE',
    },
    {
      metric: 'major-error-rate-delta',
      value: majorErrorRateDelta,
      unit: 'PERCENTAGE_POINTS',
      direction: 'HIGHER_IS_WORSE',
    },
    {
      metric: 'blunder-rate-delta',
      value: blunderRateDelta,
      unit: 'PERCENTAGE_POINTS',
      direction: 'HIGHER_IS_WORSE',
    },
  ] as const;
  const selected = effects.find(
    (effect) => effect.value !== null && Number.isFinite(effect.value) && effect.value > 0,
  );
  return selected
    ? finiteEffect(selected.metric, selected.value, selected.unit, selected.direction)
    : null;
}

function candidate(input: {
  findingKey: string;
  diagnosisId: CanonicalDiagnosisIdV1;
  findingLevel: DiagnosisFindingLevel;
  observationState: DiagnosisObservationState;
  claimKey: string;
  producerKey: string;
  producerVersion: string;
  sampleCount: number;
  distinctGameCount: number;
  distinctSessionCount?: number;
  requiredEvidenceCoverage: number | null;
  evidenceStrength: DiagnosisEvidenceStrength;
  dimensions?: Readonly<Record<string, unknown>>;
  coverage: Readonly<Record<string, unknown>>;
  effect?: DiagnosisFindingEffectDraft | null;
  sourceVersions: Readonly<Record<string, unknown>>;
  evidenceReferences?: readonly DiagnosisFindingEvidenceReferenceDraft[];
}): DiagnosisFindingDraft {
  return {
    findingKey: input.findingKey,
    diagnosisId: input.diagnosisId,
    findingLevel: input.findingLevel,
    observationState: input.observationState,
    claimKey: input.claimKey,
    producerKey: input.producerKey,
    producerVersion: input.producerVersion,
    sampleCount: input.sampleCount,
    distinctGameCount: input.distinctGameCount,
    distinctSessionCount: input.distinctSessionCount ?? 0,
    requiredEvidenceCoverage: input.requiredEvidenceCoverage,
    evidenceStrength: input.evidenceStrength,
    dimensions: input.dimensions ?? {},
    coverage: input.coverage,
    effect: input.effect ?? null,
    sourceVersions: input.sourceVersions,
    evidenceReferences: input.evidenceReferences ?? [],
  };
}

function openingFindingStrength(finding: EvidenceFindingDraft): DiagnosisEvidenceStrength {
  const value = finding.details?.evidenceStrength;
  return value === 'LOW' || value === 'MEDIUM' || value === 'HIGH'
    ? value
    : 'INSUFFICIENT';
}

interface OpeningSupportingGame {
  importedGameId: number;
  evidenceEventId?: number;
  sourceAnalysisRunId?: number;
  providerGameId?: string;
  plyNumber?: number;
  positionId?: number;
  moveUci?: string;
  scoreLossCp?: number | null;
  userEvalCp?: number | null;
  speedCategory?: string | null;
}

function openingSupportingGames(finding: EvidenceFindingDraft): OpeningSupportingGame[] {
  const value = finding.details?.supportingGames;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is OpeningSupportingGame => (
    typeof item === 'object'
    && item !== null
    && typeof (item as { importedGameId?: unknown }).importedGameId === 'number'
    && Number.isSafeInteger((item as { importedGameId: number }).importedGameId)
  ));
}

function openingReferences(
  finding: EvidenceFindingDraft,
): DiagnosisFindingEvidenceReferenceDraft[] {
  return openingSupportingGames(finding).map((game, index) => ({
    referenceKey: 'opening-game-' + game.importedGameId + '-ply-' + (game.plyNumber ?? 'unknown'),
    referenceType: 'IMPORTED_GAME_PLY',
    importedGameId: game.importedGameId,
    evidenceEventId: game.evidenceEventId ?? null,
    sourceAnalysisRunId: game.sourceAnalysisRunId ?? null,
    sourcePlyStart: game.plyNumber ?? null,
    sourcePlyEnd: game.plyNumber ?? null,
    eventIdentityKey: (
      game.plyNumber !== undefined
      && Number.isSafeInteger(game.plyNumber)
      && game.plyNumber > 0
    )
      ? diagnosisPlyEventIdentityKey({
          importedGameId: game.importedGameId,
          triggerPly: game.plyNumber,
          sourceKind: finding.type,
          sourceVersion: 'opening-v1',
        })
      : null,
    provenance: {
      providerGameId: game.providerGameId ?? null,
      positionId: game.positionId ?? null,
      moveUci: game.moveUci ?? null,
      scoreLossCp: game.scoreLossCp ?? null,
      userEvalCp: game.userEvalCp ?? null,
      speedCategory: game.speedCategory ?? null,
      source: 'opening-recurrence',
    },
    representative: index < 3,
  }));
}

function openingAbsentCandidate(
  diagnosisId: 'OPEN-002' | 'OPEN-003',
  source: OpeningRecurrenceEvidenceResult,
): DiagnosisFindingDraft {
  const strength = evidenceStrengthFromSample(
    source.coverage.analysedGames,
    percentToFraction(source.coverage.analysisCoveragePct),
  );
  const state = observationState(source.coverage.status, strength, false);
  return candidate({
    findingKey: diagnosisId.toLowerCase() + '-scope',
    diagnosisId,
    findingLevel: 'MECHANISM',
    observationState: state,
    claimKey: diagnosisId === 'OPEN-002'
      ? 'opening.repeated-early-move-error'
      : 'opening.recurring-bad-position',
    producerKey: 'opening-recurrence',
    producerVersion: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    sampleCount: source.coverage.analysedGames,
    distinctGameCount: source.coverage.analysedGames,
    requiredEvidenceCoverage: percentToFraction(source.coverage.analysisCoveragePct),
    evidenceStrength: strength,
    coverage: {
      ...source.coverage,
      projectedFindingCount: 0,
      sourceReferenceStatus: 'NO_RECURRING_FINDING_EMITTED',
    },
    sourceVersions: {
      candidateProjection: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
      openingEvidence: 'opening-v1',
    },
  });
}

function projectOpeningRecurrence(source: OpeningRecurrenceEvidenceResult): DiagnosisFindingDraft[] {
  const result: DiagnosisFindingDraft[] = [];
  for (const finding of source.findings) {
    if (finding.type !== 'REPEATED_EARLY_MOVE_ERROR' && finding.type !== 'RECURRING_BAD_OPENING_POSITION') {
      continue;
    }
    const diagnosisId = finding.type === 'REPEATED_EARLY_MOVE_ERROR' ? 'OPEN-002' : 'OPEN-003';
    const strength = openingFindingStrength(finding);
    const refs = openingReferences(finding);
    const distinctGames = typeof finding.measurements.distinctGames === 'number'
      ? finding.measurements.distinctGames
      : refs.length;
    const coverage = percentToFraction(source.coverage.analysisCoveragePct);
    const averageScoreLossCp = typeof finding.measurements.averageScoreLossCp === 'number'
      ? finding.measurements.averageScoreLossCp
      : null;
    const averageUserEvalCp = typeof finding.measurements.averageUserEvalCp === 'number'
      ? finding.measurements.averageUserEvalCp
      : null;
    const dimensions: Readonly<Record<string, unknown>> = diagnosisId === 'OPEN-002'
      ? {
          userColor: finding.details?.userColor ?? null,
          positionId: finding.details?.positionId ?? null,
          moveUci: finding.details?.moveUci ?? null,
          openingNames: finding.details?.openingNames ?? [],
          openingEcos: finding.details?.openingEcos ?? [],
        }
      : {
          userColor: finding.details?.userColor ?? null,
          positionId: finding.details?.positionId ?? null,
          openingNames: finding.details?.openingNames ?? [],
          openingEcos: finding.details?.openingEcos ?? [],
        };
    result.push(candidate({
      findingKey: diagnosisId.toLowerCase() + '-' + keyPart(finding.key),
      diagnosisId,
      findingLevel: 'MECHANISM',
      observationState: observationState(source.coverage.status, strength, true),
      claimKey: diagnosisId === 'OPEN-002'
        ? 'opening.repeated-early-move-error'
        : 'opening.recurring-bad-position',
      producerKey: 'opening-recurrence',
      producerVersion: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
      sampleCount: distinctGames,
      distinctGameCount: distinctGames,
      requiredEvidenceCoverage: coverage,
      evidenceStrength: strength,
      dimensions,
      coverage: {
        ...source.coverage,
        sourceFindingType: finding.type,
        sourceFindingKey: finding.key,
      },
      effect: diagnosisId === 'OPEN-002'
        ? finiteEffect(
            'average-score-loss',
            averageScoreLossCp,
            'CENTIPAWNS',
            'HIGHER_IS_WORSE',
            { baseline: 'SAME_NORMALIZED_POSITION_ALTERNATIVES' },
          )
        : finiteEffect(
            'average-user-evaluation',
            averageUserEvalCp,
            'CENTIPAWNS',
            'LOWER_IS_WORSE',
            { baseline: 'OPENING_BAD_POSITION_THRESHOLD' },
          ),
      sourceVersions: {
        candidateProjection: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
        openingEvidence: 'opening-v1',
      },
      evidenceReferences: refs,
    }));
  }
  if (!result.some((finding) => finding.diagnosisId === 'OPEN-002')) {
    result.push(openingAbsentCandidate('OPEN-002', source));
  }
  if (!result.some((finding) => finding.diagnosisId === 'OPEN-003')) {
    result.push(openingAbsentCandidate('OPEN-003', source));
  }
  return result;
}

function projectTimePressureExposure(source: TimePressureExposureResult): DiagnosisFindingDraft[] {
  const strength = source.exposure.evidenceStrength;
  return [candidate({
    findingKey: 'time-001-scope',
    diagnosisId: 'TIME-001',
    findingLevel: 'OBSERVATION',
    observationState: observationState(
      source.coverage.status,
      strength,
      source.exposure.pressureEnteringGames > 0,
    ),
    claimKey: 'time.frequent-pressure-exposure',
    producerKey: 'time-pressure-exposure',
    producerVersion: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    sampleCount: source.coverage.timingCoveredGames,
    distinctGameCount: source.coverage.timingCoveredGames,
    requiredEvidenceCoverage: percentToFraction(source.coverage.timingCoveragePercent),
    evidenceStrength: strength,
    dimensions: {
      exactTimeControls: source.contextBreakdown.map((item) => ({
        exactTimeControlKey: item.exactTimeControlKey,
        initialSeconds: item.initialSeconds,
        incrementSeconds: item.incrementSeconds,
      })),
    },
    coverage: {
      ...source.coverage,
      sourceReferenceStatus: 'SOURCE_AGGREGATE_DOES_NOT_EXPOSE_GAME_IDS',
    },
    effect: finiteEffect(
      'pressure-entry-rate',
      source.exposure.pressureEntryRatePercent,
      'PERCENT',
      'HIGHER_IS_WORSE',
    ),
    sourceVersions: {
      aggregate: source.policyVersion,
      timeBehavior: source.timeBehaviorPolicyVersion,
      timingDerivation: source.timingDerivationVersion,
      candidateProjection: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    },
  })];
}

function projectTimePressureQuality(source: TimePressureQualityResult): DiagnosisFindingDraft[] {
  const strength = source.comparison.evidenceStrength;
  const detected = (source.comparison.averageScoreLossDeltaCp ?? 0) > 0
    || (source.comparison.majorErrorRateDeltaPercent ?? 0) > 0
    || (source.comparison.blunderRateDeltaPercent ?? 0) > 0;
  return [candidate({
    findingKey: 'time-002-scope',
    diagnosisId: 'TIME-002',
    findingLevel: 'CONTRIBUTING_CONDITION',
    observationState: observationState(source.coverage.status, strength, detected),
    claimKey: 'time.quality-collapse-under-pressure',
    producerKey: 'time-pressure-quality-collapse',
    producerVersion: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    sampleCount: Math.min(
      source.comparison.baseline.analysedMoves,
      source.comparison.pressure.analysedMoves,
    ),
    distinctGameCount: Math.min(
      source.comparison.baseline.supportingGames,
      source.comparison.pressure.supportingGames,
    ),
    requiredEvidenceCoverage: minimumCoveragePercent(
      source.comparison.baseline.requiredEvidenceCoveragePercent,
      source.comparison.pressure.requiredEvidenceCoveragePercent,
    ),
    evidenceStrength: strength,
    dimensions: { matching: ['EXACT_TIME_CONTROL', 'PHASE'] },
    coverage: {
      ...source.coverage,
      baseline: source.comparison.baseline,
      pressure: source.comparison.pressure,
      sourceReferenceStatus: 'SOURCE_AGGREGATE_DOES_NOT_EXPOSE_GAME_IDS',
    },
    effect: worseningQualityDeltaEffect(
      source.comparison.averageScoreLossDeltaCp,
      source.comparison.majorErrorRateDeltaPercent,
      source.comparison.blunderRateDeltaPercent,
    ),
    sourceVersions: {
      aggregate: source.policyVersion,
      timeBehavior: source.timeBehaviorPolicyVersion,
      timingDerivation: source.timingDerivationVersion,
      analysis: source.analysisProvenance,
      candidateProjection: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    },
  })];
}

function projectPlayedTooFast(source: PlayedTooFastResult): DiagnosisFindingDraft[] {
  const strength = source.comparison.evidenceStrength;
  return [candidate({
    findingKey: 'time-003-scope',
    diagnosisId: 'TIME-003',
    findingLevel: 'MECHANISM',
    observationState: observationState(
      source.coverage.status,
      strength,
      source.comparison.mechanismStatus === 'WORSE_QUALITY_ASSOCIATION',
    ),
    claimKey: 'time.played-too-fast',
    producerKey: 'played-too-fast',
    producerVersion: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    sampleCount: Math.min(
      source.comparison.baseline.analysedMoves,
      source.comparison.fastAmple.analysedMoves,
    ),
    distinctGameCount: Math.min(
      source.comparison.baseline.supportingGames,
      source.comparison.fastAmple.supportingGames,
    ),
    requiredEvidenceCoverage: minimumCoveragePercent(
      source.comparison.baseline.requiredEvidenceCoveragePercent,
      source.comparison.fastAmple.requiredEvidenceCoveragePercent,
    ),
    evidenceStrength: strength,
    dimensions: { ...source.definitions },
    coverage: {
      ...source.coverage,
      recurrence: source.recurrence,
      mechanismStatus: source.comparison.mechanismStatus,
      sourceReferenceStatus: 'SOURCE_AGGREGATE_DOES_NOT_EXPOSE_GAME_IDS',
    },
    effect: finiteEffect(
      'average-score-loss-delta',
      source.comparison.averageScoreLossDeltaCp,
      'CENTIPAWNS',
      'HIGHER_IS_WORSE',
      { baseline: 'NORMAL_PACE_AMPLE_CLOCK', observed: 'FAST_AMPLE_CLOCK' },
    ),
    sourceVersions: {
      aggregate: source.policyVersion,
      timeBehavior: source.timeBehaviorPolicyVersion,
      timingDerivation: source.timingDerivationVersion,
      analysis: source.analysisProvenance,
      candidateProjection: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    },
  })];
}

function projectEarlyTimeOveruse(source: EarlyTimeOveruseResult): DiagnosisFindingDraft[] {
  const strength = source.chain.evidenceStrength;
  const games = source.games.filter((game) => game.completeChain);
  const referenceGames = games.slice(
    0,
    DIAGNOSIS_BOUNDEDNESS_POLICY.maxEvidenceEventReferencesPerFinding,
  );
  return [candidate({
    findingKey: 'time-004-scope',
    diagnosisId: 'TIME-004',
    findingLevel: 'MECHANISM',
    observationState: observationState(
      source.coverage.status,
      strength,
      source.chain.mechanismStatus === 'ORDERED_ASSOCIATION',
    ),
    claimKey: 'time.early-time-overuse',
    producerKey: 'early-time-overuse',
    producerVersion: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    sampleCount: source.chain.completeChainGames,
    distinctGameCount: source.chain.completeChainGames,
    requiredEvidenceCoverage: minimumCoveragePercent(
      source.coverage.earlyCoveragePercent,
      source.coverage.laterPressureCoveragePercent,
      source.coverage.qualityGameCoveragePercent,
      source.coverage.qualityMoveCoveragePercent,
    ),
    evidenceStrength: strength,
    dimensions: { ...source.definitions },
    coverage: {
      ...source.coverage,
      chain: source.chain,
      sourceReferenceStatus: referenceGames.length === games.length
        ? 'COMPLETE_EVENT_SET'
        : 'TRUNCATED_EVENT_SET',
      sourceReferenceCount: referenceGames.length,
      sourceReferenceTotalGames: games.length,
    },
    effect: finiteEffect(
      'later-average-score-loss-delta',
      source.chain.averageLaterScoreLossDeltaCp,
      'CENTIPAWNS',
      'HIGHER_IS_WORSE',
      { chain: 'EARLY_OVERUSE_TO_LATER_PRESSURE_TO_QUALITY' },
    ),
    sourceVersions: {
      aggregate: source.policyVersion,
      timeBehavior: source.timeBehaviorPolicyVersion,
      timingDerivation: source.timingDerivationVersion,
      analysis: source.analysisProvenance,
      candidateProjection: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    },
    evidenceReferences: referenceGames.map((game, index) => ({
      referenceKey: 'time-004-game-' + game.importedGameId,
      referenceType: 'IMPORTED_GAME',
      importedGameId: game.importedGameId,
      sourcePlyStart: game.early.lastOpeningPly,
      eventIdentityKey: diagnosisGameEventIdentityKey({
        importedGameId: game.importedGameId,
        sourceKind: 'EARLY_TIME_OVERUSE_COMPLETE_CHAIN',
        sourceVersion: source.policyVersion,
      }),
      provenance: {
        exactTimeControlKey: game.exactTimeControlKey,
        early: game.early,
        laterPressure: game.laterPressure,
        laterQuality: game.laterQuality,
      },
      representative: index < 3,
    })),
  })];
}

function projectExactTimeControl(source: ExactTimeControlUnderperformanceResult): DiagnosisFindingDraft[] {
  const available = source.comparisons.filter(
    (comparison) => comparison.status === 'AVAILABLE' && comparison.comparator !== null,
  );
  if (available.length === 0) {
    return [candidate({
      findingKey: 'time-005-scope',
      diagnosisId: 'TIME-005',
      findingLevel: 'OBSERVATION',
      observationState: source.coverage.status === 'UNAVAILABLE'
        ? 'REQUIRED_EVIDENCE_UNAVAILABLE'
        : 'INSUFFICIENT_EVIDENCE',
      claimKey: 'time.exact-control-underperformance',
      producerKey: 'exact-time-control-underperformance',
      producerVersion: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
      sampleCount: 0,
      distinctGameCount: 0,
      requiredEvidenceCoverage: minimumCoveragePercent(
        source.coverage.resultCoveragePercent,
        source.coverage.analysisCoveragePercent,
      ),
      evidenceStrength: 'INSUFFICIENT',
      coverage: { ...source.coverage, sourceReferenceStatus: 'NO_AVAILABLE_COMPARISON' },
      sourceVersions: {
        aggregate: source.policyVersion,
        timeBehavior: source.timeBehaviorPolicyVersion,
        candidateProjection: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
      },
    })];
  }
  return available.map((comparison) => {
    const comparator = comparison.comparator;
    if (!comparator) throw new Error('Available TIME-005 comparison is missing its comparator.');
    const resultDetected = comparison.evidenceStrength.result !== 'INSUFFICIENT'
      && comparison.deltas.scorePercentagePoints !== null
      && comparison.deltas.scorePercentagePoints < 0;
    const qualityDetected = comparison.evidenceStrength.quality !== 'INSUFFICIENT'
      && [
        comparison.deltas.averageScoreLossCp,
        comparison.deltas.majorErrorRatePercentagePoints,
        comparison.deltas.blunderRatePercentagePoints,
      ].some((value) => value !== null && value > 0);
    const detected = resultDetected || qualityDetected;
    const selectedEvidence = selectSignalEvidence([
      {
        modality: 'RESULT',
        strength: comparison.evidenceStrength.result,
        detected: resultDetected,
        requiredEvidenceCoverage: minimumCoveragePercent(
          comparison.target.resultCoveragePercent,
          comparator.resultCoveragePercent,
        ),
      },
      {
        modality: 'QUALITY',
        strength: comparison.evidenceStrength.quality,
        detected: qualityDetected,
        requiredEvidenceCoverage: minimumCoveragePercent(
          comparison.target.analysisCoveragePercent,
          comparator.analysisCoveragePercent,
        ),
      },
    ]);
    const strength = selectedEvidence.strength;
    return candidate({
      findingKey: 'time-005-' + keyPart(comparison.target.exactTimeControlKey),
      diagnosisId: 'TIME-005',
      findingLevel: 'OBSERVATION',
      observationState: observationState(source.coverage.status, strength, detected),
      claimKey: 'time.exact-control-underperformance',
      producerKey: 'exact-time-control-underperformance',
      producerVersion: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
      sampleCount: Math.min(comparison.target.eligibleGames, comparator.eligibleGames),
      distinctGameCount: Math.min(comparison.target.eligibleGames, comparator.eligibleGames),
      requiredEvidenceCoverage: selectedEvidence.requiredEvidenceCoverage,
      evidenceStrength: strength,
      dimensions: {
        targetExactTimeControlKey: comparison.target.exactTimeControlKey,
        comparatorExactTimeControlKey: comparator.exactTimeControlKey,
        initialSeconds: comparison.target.initialSeconds,
        targetIncrementSeconds: comparison.target.incrementSeconds,
        comparatorIncrementSeconds: comparator.incrementSeconds,
      },
      coverage: {
        ...source.coverage,
        target: comparison.target,
        comparator,
        ratingComposition: comparison.ratingComposition,
        sourceReferenceStatus: 'SOURCE_AGGREGATE_DOES_NOT_EXPOSE_GAME_IDS',
      },
      effect: selectedEvidence.strength === 'INSUFFICIENT'
        ? null
        : selectedEvidence.modality === 'QUALITY'
          ? worseningQualityDeltaEffect(
              comparison.deltas.averageScoreLossCp,
              comparison.deltas.majorErrorRatePercentagePoints,
              comparison.deltas.blunderRatePercentagePoints,
            )
          : finiteEffect(
              'score-percentage-point-delta',
              comparison.deltas.scorePercentagePoints,
              'PERCENTAGE_POINTS',
              'LOWER_IS_WORSE',
            ),
      sourceVersions: {
        aggregate: source.policyVersion,
        timeBehavior: source.timeBehaviorPolicyVersion,
        candidateProjection: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
      },
    });
  });
}

function projectIncrementEffect(source: IncrementEffectResult): DiagnosisFindingDraft[] {
  if (source.strata.length === 0) {
    return [candidate({
      findingKey: 'time-006-scope',
      diagnosisId: 'TIME-006',
      findingLevel: 'CONTRIBUTING_CONDITION',
      observationState: source.coverage.status === 'UNAVAILABLE'
        ? 'REQUIRED_EVIDENCE_UNAVAILABLE'
        : 'INSUFFICIENT_EVIDENCE',
      claimKey: 'time.increment-effect',
      producerKey: 'increment-effect',
      producerVersion: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
      sampleCount: 0,
      distinctGameCount: 0,
      requiredEvidenceCoverage: minimumCoveragePercent(
        source.coverage.resultCoveragePercent,
        source.coverage.analysisCoveragePercent,
        source.coverage.timingCoveragePercent,
      ),
      evidenceStrength: 'INSUFFICIENT',
      coverage: { ...source.coverage, sourceReferenceStatus: 'NO_MATCHED_INCREMENT_STRATUM' },
      sourceVersions: {
        aggregate: source.policyVersion,
        timeBehavior: source.timeBehaviorPolicyVersion,
        timingDerivation: source.timingDerivationVersion,
        candidateProjection: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
      },
    })];
  }
  return source.strata.map((stratum) => {
    const resultDetected = stratum.evidenceStrength.result !== 'INSUFFICIENT'
      && stratum.deltas.scorePercentagePoints !== null
      && stratum.deltas.scorePercentagePoints !== 0;
    const qualityDetected = stratum.evidenceStrength.quality !== 'INSUFFICIENT'
      && [
        stratum.deltas.averageScoreLossCp,
        stratum.deltas.majorErrorRatePercentagePoints,
        stratum.deltas.blunderRatePercentagePoints,
      ].some((value) => value !== null && value !== 0);
    const timingDetected = stratum.evidenceStrength.timing !== 'INSUFFICIENT'
      && [
        stratum.deltas.pressureMoveRatePercentagePoints,
        stratum.deltas.pressureEntryRatePercentagePoints,
      ].some((value) => value !== null && value !== 0);
    const detected = resultDetected || qualityDetected || timingDetected;
    const selectedEvidence = selectSignalEvidence([
      {
        modality: 'RESULT',
        strength: stratum.evidenceStrength.result,
        detected: resultDetected,
        requiredEvidenceCoverage: minimumCoveragePercent(
          stratum.noIncrement.resultCoveragePercent,
          stratum.increment.resultCoveragePercent,
        ),
      },
      {
        modality: 'QUALITY',
        strength: stratum.evidenceStrength.quality,
        detected: qualityDetected,
        requiredEvidenceCoverage: minimumCoveragePercent(
          stratum.noIncrement.analysisCoveragePercent,
          stratum.increment.analysisCoveragePercent,
        ),
      },
      {
        modality: 'TIMING',
        strength: stratum.evidenceStrength.timing,
        detected: timingDetected,
        requiredEvidenceCoverage: minimumCoveragePercent(
          stratum.noIncrement.pressure.timingCoveragePercent,
          stratum.increment.pressure.timingCoveragePercent,
        ),
      },
    ]);
    const strength = selectedEvidence.strength;
    const effect = selectedEvidence.strength === 'INSUFFICIENT'
      ? null
      : selectedEvidence.modality === 'QUALITY'
        ? qualityDeltaEffect(
            stratum.deltas.averageScoreLossCp,
            stratum.deltas.majorErrorRatePercentagePoints,
            stratum.deltas.blunderRatePercentagePoints,
            'CONTEXT_DIFFERENCE',
          )
        : selectedEvidence.modality === 'RESULT'
          ? finiteEffect(
              'score-percentage-point-delta',
              stratum.deltas.scorePercentagePoints,
              'PERCENTAGE_POINTS',
              'CONTEXT_DIFFERENCE',
            )
          : firstFiniteEffect([
              {
                metric: 'pressure-move-rate-delta',
                value: stratum.deltas.pressureMoveRatePercentagePoints,
                unit: 'PERCENTAGE_POINTS',
                direction: 'CONTEXT_DIFFERENCE',
              },
              {
                metric: 'pressure-entry-rate-delta',
                value: stratum.deltas.pressureEntryRatePercentagePoints,
                unit: 'PERCENTAGE_POINTS',
                direction: 'CONTEXT_DIFFERENCE',
              },
            ]);
    return candidate({
      findingKey: 'time-006-initial-' + keyPart(stratum.initialSeconds),
      diagnosisId: 'TIME-006',
      findingLevel: 'CONTRIBUTING_CONDITION',
      observationState: observationState(source.coverage.status, strength, detected),
      claimKey: 'time.increment-effect',
      producerKey: 'increment-effect',
      producerVersion: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
      sampleCount: Math.min(stratum.noIncrement.games, stratum.increment.games),
      distinctGameCount: Math.min(stratum.noIncrement.games, stratum.increment.games),
      requiredEvidenceCoverage: selectedEvidence.requiredEvidenceCoverage,
      evidenceStrength: strength,
      dimensions: {
        initialSeconds: stratum.initialSeconds,
        noIncrementControls: stratum.noIncrement.exactControls,
        incrementControls: stratum.increment.exactControls,
      },
      coverage: {
        ...source.coverage,
        noIncrement: stratum.noIncrement,
        increment: stratum.increment,
        ratingComposition: stratum.ratingComposition,
        sourceReferenceStatus: 'SOURCE_AGGREGATE_DOES_NOT_EXPOSE_GAME_IDS',
      },
      effect,
      sourceVersions: {
        aggregate: source.policyVersion,
        timeBehavior: source.timeBehaviorPolicyVersion,
        timingDerivation: source.timingDerivationVersion,
        candidateProjection: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
      },
    });
  });
}

function projectOpponentMoveSpeed(source: OpponentMoveSpeedEffectResult): DiagnosisFindingDraft[] {
  const timingDetected = source.comparison.evidenceStrength.timing !== 'INSUFFICIENT'
    && source.comparison.averageResponseTimeDeltaCentiseconds !== null
    && source.comparison.averageResponseTimeDeltaCentiseconds !== 0;
  const qualityDetected = source.comparison.evidenceStrength.quality !== 'INSUFFICIENT'
    && [
      source.comparison.averageScoreLossDeltaCp,
      source.comparison.majorErrorRateDeltaPercent,
      source.comparison.blunderRateDeltaPercent,
    ].some((value) => value !== null && value !== 0);
  const detected = timingDetected || qualityDetected;
  const selectedEvidence = selectSignalEvidence([
    {
      modality: 'TIMING',
      strength: source.comparison.evidenceStrength.timing,
      detected: timingDetected,
      requiredEvidenceCoverage: minimumCoveragePercent(
        source.comparison.baseline.requiredTimingCoveragePercent,
        source.comparison.exposed.requiredTimingCoveragePercent,
      ),
    },
    {
      modality: 'QUALITY',
      strength: source.comparison.evidenceStrength.quality,
      detected: qualityDetected,
      requiredEvidenceCoverage: minimumCoveragePercent(
        source.comparison.baseline.requiredQualityCoveragePercent,
        source.comparison.exposed.requiredQualityCoveragePercent,
      ),
    },
  ]);
  const strength = selectedEvidence.strength;
  const effect = selectedEvidence.strength === 'INSUFFICIENT'
    ? null
    : selectedEvidence.modality === 'QUALITY'
      ? qualityDeltaEffect(
          source.comparison.averageScoreLossDeltaCp,
          source.comparison.majorErrorRateDeltaPercent,
          source.comparison.blunderRateDeltaPercent,
          'CONTEXT_DIFFERENCE',
        )
      : finiteEffect(
          'average-response-time-delta',
          source.comparison.averageResponseTimeDeltaCentiseconds,
          'CENTISECONDS',
          'CONTEXT_DIFFERENCE',
        );
  return [candidate({
    findingKey: 'time-007-scope',
    diagnosisId: 'TIME-007',
    findingLevel: 'CONTRIBUTING_CONDITION',
    observationState: observationState(source.coverage.status, strength, detected),
    claimKey: 'time.opponent-move-speed-effect',
    producerKey: 'opponent-move-speed-effect',
    producerVersion: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    sampleCount: Math.min(
      source.comparison.baseline.eligibleResponses,
      source.comparison.exposed.eligibleResponses,
    ),
    distinctGameCount: Math.min(
      source.comparison.baseline.eligibleGames,
      source.comparison.exposed.eligibleGames,
    ),
    requiredEvidenceCoverage: selectedEvidence.requiredEvidenceCoverage,
    evidenceStrength: strength,
    dimensions: { ...source.definitions },
    coverage: {
      ...source.coverage,
      recurrence: source.recurrence,
      phaseComposition: source.phaseComposition,
      ratingComposition: source.ratingComposition,
      sourceReferenceStatus: 'SOURCE_AGGREGATE_DOES_NOT_EXPOSE_GAME_IDS',
    },
    effect,
    sourceVersions: {
      aggregate: source.policyVersion,
      timeBehavior: source.timeBehaviorPolicyVersion,
      timingDerivation: source.timingDerivationVersion,
      analysis: source.analysisProvenance,
      candidateProjection: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    },
  })];
}

function projectOpponentStrength(source: OpponentStrengthEffectResult): DiagnosisFindingDraft[] {
  const comparisons = source.comparisons.filter(
    (comparison) => comparison.status !== 'UNAVAILABLE' && comparison.baseline !== null,
  );
  if (comparisons.length === 0) {
    return [candidate({
      findingKey: 'rating-001-scope',
      diagnosisId: 'RATING-001',
      findingLevel: 'CONTRIBUTING_CONDITION',
      observationState: source.coverage.status === 'UNAVAILABLE'
        ? 'REQUIRED_EVIDENCE_UNAVAILABLE'
        : 'INSUFFICIENT_EVIDENCE',
      claimKey: 'rating.opponent-strength-effect',
      producerKey: 'opponent-strength-effect',
      producerVersion: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
      sampleCount: 0,
      distinctGameCount: 0,
      requiredEvidenceCoverage: minimumCoveragePercent(
        source.coverage.ratingCoveragePercent,
        source.coverage.exactControlCoveragePercent,
        source.coverage.resultCoveragePercent,
        source.coverage.analysisCoveragePercent,
      ),
      evidenceStrength: 'INSUFFICIENT',
      coverage: { ...source.coverage, sourceReferenceStatus: 'NO_MATCHED_RATING_COMPARISON' },
      sourceVersions: {
        aggregate: source.policyVersion,
        timeBehavior: source.timeBehaviorPolicyVersion,
        candidateProjection: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
      },
    })];
  }
  return comparisons.map((comparison) => {
    const baseline = comparison.baseline;
    if (!baseline) throw new Error('Comparable RATING-001 row is missing its baseline.');
    const resultDetected = comparison.evidenceStrength.result !== 'INSUFFICIENT'
      && comparison.deltas.scorePercentagePoints !== null
      && comparison.deltas.scorePercentagePoints !== 0;
    const qualityDetected = comparison.evidenceStrength.quality !== 'INSUFFICIENT'
      && [
        comparison.deltas.averageScoreLossCp,
        comparison.deltas.majorErrorRatePercentagePoints,
        comparison.deltas.blunderRatePercentagePoints,
      ].some((value) => value !== null && value !== 0);
    const detected = resultDetected || qualityDetected;
    const selectedEvidence = selectSignalEvidence([
      {
        modality: 'RESULT',
        strength: comparison.evidenceStrength.result,
        detected: resultDetected,
        requiredEvidenceCoverage: minimumCoveragePercent(
          comparison.target.resultCoveragePercent,
          baseline.resultCoveragePercent,
        ),
      },
      {
        modality: 'QUALITY',
        strength: comparison.evidenceStrength.quality,
        detected: qualityDetected,
        requiredEvidenceCoverage: minimumCoveragePercent(
          comparison.target.analysisCoveragePercent,
          baseline.analysisCoveragePercent,
        ),
      },
    ]);
    const strength = selectedEvidence.strength;
    return candidate({
      findingKey: 'rating-001-' + keyPart(comparison.exactTimeControlKey)
        + '-' + keyPart(comparison.targetBand),
      diagnosisId: 'RATING-001',
      findingLevel: 'CONTRIBUTING_CONDITION',
      observationState: observationState(source.coverage.status, strength, detected),
      claimKey: 'rating.opponent-strength-effect',
      producerKey: 'opponent-strength-effect',
      producerVersion: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
      sampleCount: Math.min(comparison.target.games, baseline.games),
      distinctGameCount: Math.min(comparison.target.games, baseline.games),
      requiredEvidenceCoverage: selectedEvidence.requiredEvidenceCoverage,
      evidenceStrength: strength,
      dimensions: {
        exactTimeControlKey: comparison.exactTimeControlKey,
        targetBand: comparison.targetBand,
        baselineBand: comparison.baselineBand,
      },
      coverage: {
        ...source.coverage,
        comparisonStatus: comparison.status,
        comparisonReason: comparison.reason,
        target: comparison.target,
        baseline,
        sourceReferenceStatus: 'SOURCE_AGGREGATE_DOES_NOT_EXPOSE_GAME_IDS',
      },
      effect: selectedEvidence.strength === 'INSUFFICIENT'
        ? null
        : selectedEvidence.modality === 'QUALITY'
          ? qualityDeltaEffect(
              comparison.deltas.averageScoreLossCp,
              comparison.deltas.majorErrorRatePercentagePoints,
              comparison.deltas.blunderRatePercentagePoints,
              'HIGHER_IS_WORSE',
            )
          : finiteEffect(
              'score-percentage-point-delta',
              comparison.deltas.scorePercentagePoints,
              'PERCENTAGE_POINTS',
              'LOWER_IS_WORSE',
            ),
      sourceVersions: {
        aggregate: source.policyVersion,
        timeBehavior: source.timeBehaviorPolicyVersion,
        candidateProjection: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
      },
    });
  });
}

function projectRatingContext(source: RatingContextCompositionResult): DiagnosisFindingDraft[] {
  const strength = source.comparison.evidenceStrength;
  return [candidate({
    findingKey: 'rating-002-scope',
    diagnosisId: 'RATING-002',
    findingLevel: 'OBSERVATION',
    observationState: observationState(
      source.coverage.status,
      strength,
      source.comparison.materialCompositionWarning === true,
    ),
    claimKey: 'rating.context-composition-warning',
    producerKey: 'rating-context-composition',
    producerVersion: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    sampleCount: Math.min(source.arms.left.inputGames, source.arms.right.inputGames),
    distinctGameCount: Math.min(source.arms.left.inputGames, source.arms.right.inputGames),
    requiredEvidenceCoverage: minimumCoveragePercent(
      source.arms.left.ratingCoveragePercent,
      source.arms.right.ratingCoveragePercent,
    ),
    evidenceStrength: strength,
    dimensions: {
      leftBandSharesPercent: source.arms.left.bandSharesPercent,
      rightBandSharesPercent: source.arms.right.bandSharesPercent,
    },
    coverage: {
      ...source.coverage,
      left: source.arms.left,
      right: source.arms.right,
      sourceReferenceStatus: 'SOURCE_AGGREGATE_DOES_NOT_EXPOSE_GAME_IDS',
    },
    effect: finiteEffect(
      'absolute-mean-rating-difference-delta',
      source.comparison.absoluteMeanRatingDifferenceDeltaPoints,
      'RATING_POINTS',
      'HIGHER_IS_MORE_CONFOUNDING',
    ),
    sourceVersions: {
      aggregate: source.policyVersion,
      timeBehavior: source.timeBehaviorPolicyVersion,
      candidateProjection: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    },
  })];
}

function sessionCandidate(input: {
  diagnosisId: 'SESSION-001' | 'SESSION-002';
  claimKey: string;
  producerKey: string;
  policyVersion: string;
  sessionizationPolicyVersion: string;
  coverageStatus: string;
  coverage: Readonly<Record<string, unknown>>;
  baseline: { analysedGames: number; analysedSessions: number; analysisCoveragePercent: number | null };
  observed: { analysedGames: number; analysedSessions: number; analysisCoveragePercent: number | null };
  averageScoreLossDeltaCp: number | null;
  majorErrorRateDeltaPercent: number | null;
  blunderRateDeltaPercent: number | null;
  evidenceStrength: DiagnosisEvidenceStrength;
}): DiagnosisFindingDraft {
  const detected = (input.averageScoreLossDeltaCp ?? 0) > 0
    || (input.majorErrorRateDeltaPercent ?? 0) > 0
    || (input.blunderRateDeltaPercent ?? 0) > 0;
  return candidate({
    findingKey: input.diagnosisId.toLowerCase() + '-scope',
    diagnosisId: input.diagnosisId,
    findingLevel: 'CONTRIBUTING_CONDITION',
    observationState: observationState(input.coverageStatus, input.evidenceStrength, detected),
    claimKey: input.claimKey,
    producerKey: input.producerKey,
    producerVersion: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    sampleCount: Math.min(input.baseline.analysedGames, input.observed.analysedGames),
    distinctGameCount: Math.min(input.baseline.analysedGames, input.observed.analysedGames),
    distinctSessionCount: Math.min(input.baseline.analysedSessions, input.observed.analysedSessions),
    requiredEvidenceCoverage: minimumCoveragePercent(
      input.baseline.analysisCoveragePercent,
      input.observed.analysisCoveragePercent,
    ),
    evidenceStrength: input.evidenceStrength,
    coverage: {
      ...input.coverage,
      baseline: input.baseline,
      observed: input.observed,
      sourceReferenceStatus: 'SOURCE_AGGREGATE_DOES_NOT_EXPOSE_GAME_IDS',
    },
    effect: worseningQualityDeltaEffect(
      input.averageScoreLossDeltaCp,
      input.majorErrorRateDeltaPercent,
      input.blunderRateDeltaPercent,
    ),
    sourceVersions: {
      aggregate: input.policyVersion,
      sessionization: input.sessionizationPolicyVersion,
      candidateProjection: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    },
  });
}

function projectSessionDeterioration(source: SessionDeteriorationResult): DiagnosisFindingDraft[] {
  return [sessionCandidate({
    diagnosisId: 'SESSION-001',
    claimKey: 'session.late-session-deterioration',
    producerKey: 'session-deterioration',
    policyVersion: source.policyVersion,
    sessionizationPolicyVersion: source.sessionizationPolicyVersion,
    coverageStatus: source.coverage.status,
    coverage: { ...source.coverage },
    baseline: source.comparison.early,
    observed: source.comparison.late,
    averageScoreLossDeltaCp: source.comparison.averageScoreLossDeltaCp,
    majorErrorRateDeltaPercent: source.comparison.majorErrorRateDeltaPercent,
    blunderRateDeltaPercent: source.comparison.blunderRateDeltaPercent,
    evidenceStrength: source.comparison.evidenceStrength,
  })];
}

function projectLossStreak(source: LossStreakDeteriorationResult): DiagnosisFindingDraft[] {
  return [sessionCandidate({
    diagnosisId: 'SESSION-002',
    claimKey: 'session.loss-streak-associated-deterioration',
    producerKey: 'loss-streak-deterioration',
    policyVersion: source.policyVersion,
    sessionizationPolicyVersion: source.sessionizationPolicyVersion,
    coverageStatus: source.coverage.status,
    coverage: { ...source.coverage },
    baseline: source.comparison.baseline,
    observed: source.comparison.afterLossStreak,
    averageScoreLossDeltaCp: source.comparison.averageScoreLossDeltaCp,
    majorErrorRateDeltaPercent: source.comparison.majorErrorRateDeltaPercent,
    blunderRateDeltaPercent: source.comparison.blunderRateDeltaPercent,
    evidenceStrength: source.comparison.evidenceStrength,
  })];
}

function projectOverlongSession(source: OverlongSessionStoppingPointResult): DiagnosisFindingDraft[] {
  const selected = source.selectedThreshold === null
    ? null
    : source.candidates.find((candidate) => candidate.threshold === source.selectedThreshold) ?? null;
  const strength: DiagnosisEvidenceStrength = selected?.comparison.evidenceStrength ?? 'INSUFFICIENT';
  return [candidate({
    findingKey: selected ? 'session-003-threshold-' + selected.threshold : 'session-003-scope',
    diagnosisId: 'SESSION-003',
    findingLevel: 'ROOT_CAUSE_CANDIDATE',
    observationState: observationState(source.coverage.status, strength, selected?.comparison.supported === true),
    claimKey: 'session.overlong-stopping-point',
    producerKey: 'overlong-session-stopping-point',
    producerVersion: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    sampleCount: selected
      ? Math.min(selected.comparison.preThreshold.analysedGames, selected.comparison.thresholdAndLater.analysedGames)
      : 0,
    distinctGameCount: selected
      ? Math.min(selected.comparison.preThreshold.analysedGames, selected.comparison.thresholdAndLater.analysedGames)
      : 0,
    distinctSessionCount: selected?.coverage.analysedComparableSessions ?? 0,
    requiredEvidenceCoverage: selected
      ? minimumCoveragePercent(
          selected.comparison.preThreshold.analysisCoveragePercent,
          selected.comparison.thresholdAndLater.analysisCoveragePercent,
        )
      : percentToFraction(source.coverage.analysisCoveragePercent),
    evidenceStrength: strength,
    dimensions: {
      selectedThreshold: source.selectedThreshold,
      candidateThresholds: source.candidateThresholds,
    },
    coverage: {
      ...source.coverage,
      selectedCandidate: selected,
      sourceReferenceStatus: 'SOURCE_AGGREGATE_DOES_NOT_EXPOSE_GAME_IDS',
    },
    effect: finiteEffect(
      'average-score-loss-delta',
      selected?.comparison.averageScoreLossDeltaCp ?? null,
      'CENTIPAWNS',
      'HIGHER_IS_WORSE',
      selected ? { threshold: selected.threshold } : undefined,
    ),
    sourceVersions: {
      aggregate: source.policyVersion,
      sessionization: source.sessionizationPolicyVersion,
      candidateProjection: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    },
  })];
}

export const DIAGNOSIS_CANDIDATE_PRODUCERS = Object.freeze({
  openingRecurrence: {
    key: 'openingRecurrence',
    version: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    diagnosisIds: ['OPEN-002', 'OPEN-003'],
    project: projectOpeningRecurrence,
  },
  timePressureExposure: {
    key: 'timePressureExposure',
    version: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    diagnosisIds: ['TIME-001'],
    project: projectTimePressureExposure,
  },
  timePressureQualityCollapse: {
    key: 'timePressureQualityCollapse',
    version: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    diagnosisIds: ['TIME-002'],
    project: projectTimePressureQuality,
  },
  playedTooFast: {
    key: 'playedTooFast',
    version: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    diagnosisIds: ['TIME-003'],
    project: projectPlayedTooFast,
  },
  earlyTimeOveruse: {
    key: 'earlyTimeOveruse',
    version: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    diagnosisIds: ['TIME-004'],
    project: projectEarlyTimeOveruse,
  },
  exactTimeControlUnderperformance: {
    key: 'exactTimeControlUnderperformance',
    version: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    diagnosisIds: ['TIME-005'],
    project: projectExactTimeControl,
  },
  incrementEffect: {
    key: 'incrementEffect',
    version: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    diagnosisIds: ['TIME-006'],
    project: projectIncrementEffect,
  },
  opponentMoveSpeedEffect: {
    key: 'opponentMoveSpeedEffect',
    version: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    diagnosisIds: ['TIME-007'],
    project: projectOpponentMoveSpeed,
  },
  opponentStrengthEffect: {
    key: 'opponentStrengthEffect',
    version: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    diagnosisIds: ['RATING-001'],
    project: projectOpponentStrength,
  },
  ratingContextComposition: {
    key: 'ratingContextComposition',
    version: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    diagnosisIds: ['RATING-002'],
    project: projectRatingContext,
  },
  sessionDeterioration: {
    key: 'sessionDeterioration',
    version: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    diagnosisIds: ['SESSION-001'],
    project: projectSessionDeterioration,
  },
  lossStreakDeterioration: {
    key: 'lossStreakDeterioration',
    version: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    diagnosisIds: ['SESSION-002'],
    project: projectLossStreak,
  },
  overlongSessionStoppingPoint: {
    key: 'overlongSessionStoppingPoint',
    version: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    diagnosisIds: ['SESSION-003'],
    project: projectOverlongSession,
  },
} satisfies { [K in DiagnosisCandidateProducerKey]: DiagnosisCandidateProducer<K> });

export const UNSUPPORTED_DIAGNOSIS_PROJECTIONS = Object.freeze([
  { diagnosisId: 'TACT-001', reason: 'No cross-game tactical-opportunity recurrence aggregate exists yet.' },
  { diagnosisId: 'TACT-002', reason: 'Per-game motif events exist, but no taxonomy-safe cross-game motif recurrence aggregate exists yet.' },
  { diagnosisId: 'TACT-003', reason: 'Per-game defensive-threat events exist, but no cross-game threat-blindness recurrence aggregate exists yet.' },
  { diagnosisId: 'TACT-004', reason: 'Per-game material events exist, but no cross-game hanging-material recurrence aggregate exists yet.' },
  { diagnosisId: 'TACT-005', reason: 'Per-game mate/threat events exist, but no cross-game mating-attack recurrence aggregate exists yet.' },
  { diagnosisId: 'TACT-006', reason: 'No canonical cross-game tactical-error-rate baseline aggregate exists yet.' },
  { diagnosisId: 'OPEN-001', reason: 'Current opening recurrence service does not own result-baseline semantics for OPEN-001.' },
  { diagnosisId: 'OPEN-004', reason: 'Opening timing is represented by TIME-003/TIME-004; no separate OPEN-004 aggregate exists.' },
  { diagnosisId: 'CONV-001', reason: 'Conversion evidence is per-game; repeated conversion aggregation is not implemented yet.' },
  { diagnosisId: 'CONV-002', reason: 'Knockout/draw-save evidence is per-game; repeated aggregation is not implemented yet.' },
  { diagnosisId: 'CONV-003', reason: 'No deterministic slow-bleed cross-game aggregate exists yet.' },
  { diagnosisId: 'PHASE-001', reason: 'Phase labels exist as context, but no player-relative phase underperformance aggregate exists yet.' },
  { diagnosisId: 'END-001', reason: 'Endgame conversion events exist only as source evidence; no repeated endgame aggregate exists yet.' },
  { diagnosisId: 'END-002', reason: 'No endgame-family recurrence aggregate exists yet.' },
  { diagnosisId: 'END-003', reason: 'No rook-endgame-specific recurrence aggregate exists yet.' },
  { diagnosisId: 'CAL-001', reason: 'Deferred until explicit user IANA timezone data exists.' },
] satisfies readonly UnsupportedDiagnosisProjection[]);

export function assertDiagnosisCandidateRegistryInvariants(): void {
  const ownerByDiagnosis = new Map<string, string>();
  for (const producer of Object.values(DIAGNOSIS_CANDIDATE_PRODUCERS)) {
    if (producer.version !== DIAGNOSIS_CANDIDATE_PROJECTION_VERSION) {
      throw new Error('Diagnosis candidate producer version drift: ' + producer.key);
    }
    for (const diagnosisId of producer.diagnosisIds) {
      const prior = ownerByDiagnosis.get(diagnosisId);
      if (prior) {
        throw new Error(
          'Diagnosis candidate projection has duplicate ownership for ' + diagnosisId
          + ': ' + prior + ' and ' + producer.key,
        );
      }
      ownerByDiagnosis.set(diagnosisId, producer.key);
    }
  }

  const unsupportedIds = new Set<string>();
  for (const item of UNSUPPORTED_DIAGNOSIS_PROJECTIONS) {
    if (unsupportedIds.has(item.diagnosisId)) {
      throw new Error('Duplicate unsupported diagnosis projection: ' + item.diagnosisId);
    }
    if (ownerByDiagnosis.has(item.diagnosisId)) {
      throw new Error('Diagnosis ID is both supported and unsupported: ' + item.diagnosisId);
    }
    unsupportedIds.add(item.diagnosisId);
  }

  for (const diagnosisId of CANONICAL_DIAGNOSIS_IDS_V1) {
    if (!ownerByDiagnosis.has(diagnosisId) && !unsupportedIds.has(diagnosisId)) {
      throw new Error('Diagnosis candidate registry omits canonical diagnosis ID: ' + diagnosisId);
    }
  }

  if (ownerByDiagnosis.size + unsupportedIds.size !== CANONICAL_DIAGNOSIS_IDS_V1.length) {
    throw new Error('Diagnosis candidate registry contains taxonomy drift.');
  }
}

export function projectDiagnosisCandidates<K extends DiagnosisCandidateProducerKey>(
  key: K,
  source: DiagnosisCandidateSourceMap[K],
): readonly DiagnosisFindingDraft[] {
  const producer = DIAGNOSIS_CANDIDATE_PRODUCERS[key] as unknown as DiagnosisCandidateProducer<K>;
  return producer.project(source);
}

assertDiagnosisCandidateRegistryInvariants();
