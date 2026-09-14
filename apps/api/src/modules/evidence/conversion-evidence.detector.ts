import { detectPhaseEvidence } from './phase-evidence.detector';
import type {
  EvidenceDetector,
  EvidenceDetectorResult,
  EvidenceFindingDraft,
  EvidenceInputSnapshot,
  EvidencePlySnapshot,
  EvidencePositionSnapshot,
} from './evidence.types';

export const CONVERSION_EVIDENCE_DETECTOR_KEY = 'conversion-transition';
export const CONVERSION_EVIDENCE_DETECTOR_VERSION = 'conversion-v1';

export const CONVERSION_WINNING_MIN_CP = 700;
export const CONVERSION_LOSING_MAX_CP = -700;

const MAX_CONVERSION_FINDINGS = 96;

type UserColor = 'WHITE' | 'BLACK';
type EvaluationState = 'WINNING' | 'DRAWABLE' | 'LOSING';

interface PhaseContext {
  phase: string;
  endgameFamily: string;
}

interface EvaluatedBoundary {
  boundaryPly: number;
  positionId: number;
  state: EvaluationState;
  scoreCpWhite: number | null;
  scoreCpForUser: number | null;
  mateWhite: number | null;
  mateForUser: number | null;
  sideToMove: string | null;
  phase: string;
  endgameFamily: string;
}

interface StateRun {
  state: EvaluationState;
  start: EvaluatedBoundary;
  end: EvaluatedBoundary;
}

function validatedUserColor(snapshot: EvidenceInputSnapshot): UserColor | null {
  if (snapshot.game.userColor === 'WHITE' || snapshot.game.userColor === 'BLACK') {
    return snapshot.game.userColor;
  }
  return null;
}

function finiteNumber(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sideToMove(normalizedFen: string): string | null {
  const active = normalizedFen.trim().split(/\s+/)[1];
  if (active === 'w') return 'WHITE';
  if (active === 'b') return 'BLACK';
  return null;
}

function phaseContexts(snapshot: EvidenceInputSnapshot): Map<number, PhaseContext> {
  const result = detectPhaseEvidence(snapshot);
  const contexts = new Map<number, PhaseContext>();

  for (const finding of result.findings) {
    if (finding.type !== 'POSITION_PHASE_RANGE') continue;
    const start = finding.measurements.startBoundaryPly;
    const end = finding.measurements.endBoundaryPly;
    const phase = finding.details?.phase;
    const endgameFamily = finding.details?.endgameFamily;
    if (
      typeof start !== 'number'
      || typeof end !== 'number'
      || typeof phase !== 'string'
      || typeof endgameFamily !== 'string'
    ) {
      continue;
    }

    for (let boundaryPly = start; boundaryPly <= end; boundaryPly += 1) {
      contexts.set(boundaryPly, { phase, endgameFamily });
    }
  }

  return contexts;
}

function evaluationAtBoundary(
  boundaryPly: number,
  position: EvidencePositionSnapshot,
  userColor: UserColor,
  phase: PhaseContext,
): EvaluatedBoundary | null {
  const analysis = position.analysis;
  if (!analysis) return null;

  const scoreCpWhite = finiteNumber(analysis.scoreCpWhite);
  const mateWhite = finiteNumber(analysis.mateWhite);
  const scoreCpForUser = scoreCpWhite === null
    ? null
    : userColor === 'WHITE'
      ? scoreCpWhite
      : -scoreCpWhite;
  const mateForUser = mateWhite === null
    ? null
    : userColor === 'WHITE'
      ? mateWhite
      : -mateWhite;

  let state: EvaluationState | null = null;
  if (mateForUser !== null && mateForUser !== 0) {
    state = mateForUser > 0 ? 'WINNING' : 'LOSING';
  } else if (scoreCpForUser !== null) {
    state = scoreCpForUser >= CONVERSION_WINNING_MIN_CP
      ? 'WINNING'
      : scoreCpForUser <= CONVERSION_LOSING_MAX_CP
        ? 'LOSING'
        : 'DRAWABLE';
  }
  if (!state) return null;

  return {
    boundaryPly,
    positionId: position.id,
    state,
    scoreCpWhite,
    scoreCpForUser,
    mateWhite,
    mateForUser,
    sideToMove: sideToMove(position.normalizedFen),
    phase: phase.phase,
    endgameFamily: phase.endgameFamily,
  };
}

function runsFor(segment: EvaluatedBoundary[]): StateRun[] {
  const runs: StateRun[] = [];
  for (const boundary of segment) {
    const current = runs.at(-1);
    if (current?.state === boundary.state) {
      current.end = boundary;
      continue;
    }
    runs.push({
      state: boundary.state,
      start: boundary,
      end: boundary,
    });
  }
  return runs;
}

function severityLevel(from: EvaluationState, to: EvaluationState): number {
  const rank: Record<EvaluationState, number> = {
    LOSING: -1,
    DRAWABLE: 0,
    WINNING: 1,
  };
  return Math.abs(rank[to] - rank[from]);
}

function severityLabel(from: EvaluationState, to: EvaluationState): string {
  return severityLevel(from, to) >= 2 ? 'DECISIVE' : 'MAJOR';
}

function sourceStartPly(start: EvaluatedBoundary, end: EvaluatedBoundary): number {
  return Math.min(end.boundaryPly, Math.max(1, start.boundaryPly + 1));
}

function transitionMeasurements(
  start: EvaluatedBoundary,
  end: EvaluatedBoundary,
) {
  return {
    severityLevel: severityLevel(start.state, end.state),
    sequencePlyCount: Math.max(1, end.boundaryPly - start.boundaryPly),
    scoreCpForUserStart: start.scoreCpForUser,
    scoreCpForUserEnd: end.scoreCpForUser,
    scoreCpSwingForUser: (
      start.scoreCpForUser !== null
      && end.scoreCpForUser !== null
    ) ? end.scoreCpForUser - start.scoreCpForUser : null,
    mateForUserStart: start.mateForUser,
    mateForUserEnd: end.mateForUser,
    scoreCpWhiteStart: start.scoreCpWhite,
    scoreCpWhiteEnd: end.scoreCpWhite,
    mateWhiteStart: start.mateWhite,
    mateWhiteEnd: end.mateWhite,
  };
}

function transitionDetails(
  start: EvaluatedBoundary,
  end: EvaluatedBoundary,
  transitionPly: EvidencePlySnapshot,
  extra: Record<string, unknown> = {},
) {
  return {
    fromState: start.state,
    toState: end.state,
    severity: severityLabel(start.state, end.state),
    startBoundaryPly: start.boundaryPly,
    endBoundaryPly: end.boundaryPly,
    startPositionId: start.positionId,
    endPositionId: end.positionId,
    startSideToMove: start.sideToMove,
    endSideToMove: end.sideToMove,
    startPhase: start.phase,
    endPhase: end.phase,
    startEndgameFamily: start.endgameFamily,
    endEndgameFamily: end.endgameFamily,
    transitionPly: transitionPly.plyNumber,
    transitionMoveUci: transitionPly.moveUci,
    transitionMoverColor: transitionPly.moverColor,
    transitionIsUserMove: transitionPly.isUserMove,
    detectorPolicy: {
      winningMinCp: CONVERSION_WINNING_MIN_CP,
      losingMaxCp: CONVERSION_LOSING_MAX_CP,
      mateOverridesCentipawns: true,
    },
    ...extra,
  };
}

function transitionFinding(
  type: 'FAILED_CONVERSION' | 'EVALUATION_THROW' | 'EVALUATION_SAVE',
  start: EvaluatedBoundary,
  end: EvaluatedBoundary,
  transitionPly: EvidencePlySnapshot,
  extra: Record<string, unknown> = {},
): EvidenceFindingDraft {
  return {
    key: [
      type.toLowerCase(),
      'p' + sourceStartPly(start, end),
      'p' + end.boundaryPly,
    ].join('-'),
    type,
    source: {
      startPly: sourceStartPly(start, end),
      endPly: end.boundaryPly,
      positionId: end.positionId,
    },
    measurements: transitionMeasurements(start, end),
    details: transitionDetails(start, end, transitionPly, extra),
  };
}

function unavailableResult(reason: string): EvidenceDetectorResult {
  return {
    coverage: {
      status: 'UNAVAILABLE',
      reason,
      details: {
        requiredModality: 'complete-engine-analysis-and-phase-context',
        winningMinCp: CONVERSION_WINNING_MIN_CP,
        losingMaxCp: CONVERSION_LOSING_MAX_CP,
      },
    },
    findings: [{
      key: 'conversion-coverage-gap',
      type: 'CONVERSION_EVIDENCE_COVERAGE_GAP',
      availability: 'UNAVAILABLE',
      measurements: {
        incompleteBoundaryCount: 0,
        analysisGapCount: 0,
        phaseGapCount: 0,
      },
      details: {
        winningMinCp: CONVERSION_WINNING_MIN_CP,
        losingMaxCp: CONVERSION_LOSING_MAX_CP,
      },
      unavailableReason: reason,
    }],
  };
}

function nextBoundary(
  segment: EvaluatedBoundary[],
  boundaryPly: number,
): EvaluatedBoundary | null {
  return segment.find((entry) => entry.boundaryPly === boundaryPly + 1) ?? null;
}

function isUserTransition(
  ply: EvidencePlySnapshot | undefined,
  userColor: UserColor,
): ply is EvidencePlySnapshot {
  return Boolean(
    ply
    && ply.isUserMove
    && ply.moverColor === userColor,
  );
}

export function detectConversionEvidence(
  snapshot: EvidenceInputSnapshot,
): EvidenceDetectorResult {
  const userColor = validatedUserColor(snapshot);
  if (!userColor) return unavailableResult('user-color-unavailable');

  const analysisRunId = snapshot.provenance.analysis?.runId ?? null;
  if (analysisRunId === null) {
    return unavailableResult('complete-engine-analysis-unavailable');
  }

  const plies = [...snapshot.plies].sort(
    (left, right) => left.plyNumber - right.plyNumber,
  );
  const firstPly = plies[0];
  if (!firstPly) return unavailableResult('no-indexed-plies');

  const positions = new Map(
    snapshot.positions.map((position) => [position.id, position]),
  );
  const phases = phaseContexts(snapshot);
  const plyByNumber = new Map(plies.map((ply) => [ply.plyNumber, ply]));
  const positionIdByBoundary = new Map<number, number>([
    [0, firstPly.beforePositionId],
    ...plies.map((ply) => [ply.plyNumber, ply.afterPositionId] as const),
  ]);

  const references = [...positionIdByBoundary.entries()]
    .map(([boundaryPly, positionId]) => ({ boundaryPly, positionId }))
    .sort((left, right) => left.boundaryPly - right.boundaryPly);

  const segments: EvaluatedBoundary[][] = [];
  let currentSegment: EvaluatedBoundary[] = [];
  const analysisGapBoundaries: number[] = [];
  const phaseGapBoundaries: number[] = [];

  const flushSegment = () => {
    if (currentSegment.length > 0) segments.push(currentSegment);
    currentSegment = [];
  };

  for (const reference of references) {
    const transitionPly = reference.boundaryPly === 0
      ? firstPly
      : plyByNumber.get(reference.boundaryPly);
    const position = positions.get(reference.positionId);
    const phase = phases.get(reference.boundaryPly);
    const provenanceCurrent = transitionPly?.engineAnalysisRunId === analysisRunId;

    if (!position || !provenanceCurrent) {
      analysisGapBoundaries.push(reference.boundaryPly);
      flushSegment();
      continue;
    }
    if (
      !phase
      || phase.phase === 'UNKNOWN'
      || phase.endgameFamily === 'UNKNOWN'
    ) {
      phaseGapBoundaries.push(reference.boundaryPly);
      flushSegment();
      continue;
    }

    const evaluated = evaluationAtBoundary(
      reference.boundaryPly,
      position,
      userColor,
      phase,
    );
    if (!evaluated) {
      analysisGapBoundaries.push(reference.boundaryPly);
      flushSegment();
      continue;
    }

    const previous = currentSegment.at(-1);
    if (
      previous
      && evaluated.boundaryPly !== previous.boundaryPly + 1
    ) {
      flushSegment();
    }
    currentSegment.push(evaluated);
  }
  flushSegment();

  const findings: EvidenceFindingDraft[] = [];
  let findingsTruncated = false;
  let failedConversions = 0;
  let throws = 0;
  let saves = 0;

  const addFinding = (finding: EvidenceFindingDraft): boolean => {
    if (findings.length >= MAX_CONVERSION_FINDINGS) {
      findingsTruncated = true;
      return false;
    }
    findings.push(finding);
    return true;
  };

  for (const segment of segments) {
    const runs = runsFor(segment);
    const consumedTransitions = new Set<number>();

    for (let index = 0; index < runs.length - 1; index += 1) {
      if (consumedTransitions.has(index)) continue;

      const from = runs[index];
      const to = runs[index + 1];
      if (!from || !to) continue;

      const transitionPly = plyByNumber.get(to.start.boundaryPly);

      if (from.state === 'WINNING' && to.state === 'DRAWABLE') {
        if (!isUserTransition(transitionPly, userColor)) continue;

        const possibleLoss = runs[index + 2];
        const lossPly = possibleLoss?.state === 'LOSING'
          ? plyByNumber.get(possibleLoss.start.boundaryPly)
          : undefined;

        if (
          possibleLoss?.state === 'LOSING'
          && isUserTransition(lossPly, userColor)
        ) {
          if (addFinding(transitionFinding(
            'EVALUATION_THROW',
            from.start,
            possibleLoss.start,
            lossPly,
            {
              originatedFromWinningState: true,
              traversedDrawableBand: true,
              firstNonWinningBoundaryPly: to.start.boundaryPly,
            },
          ))) {
            throws += 1;
          }
          consumedTransitions.add(index + 1);
        } else if (addFinding(transitionFinding(
          'FAILED_CONVERSION',
          from.start,
          to.start,
          transitionPly,
        ))) {
          failedConversions += 1;
        }
        continue;
      }

      if (
        (from.state === 'WINNING' || from.state === 'DRAWABLE')
        && to.state === 'LOSING'
        && isUserTransition(transitionPly, userColor)
      ) {
        if (addFinding(transitionFinding(
          'EVALUATION_THROW',
          from.start,
          to.start,
          transitionPly,
          { originatedFromWinningState: from.state === 'WINNING' },
        ))) {
          throws += 1;
        }
        continue;
      }

      if (
        from.state === 'LOSING'
        && (to.state === 'DRAWABLE' || to.state === 'WINNING')
        && transitionPly
      ) {
        let confirmedEnd = to.start;
        let confirmationPly = transitionPly;

        if (!isUserTransition(transitionPly, userColor)) {
          const candidate = nextBoundary(segment, to.start.boundaryPly);
          const candidatePly = candidate
            ? plyByNumber.get(candidate.boundaryPly)
            : undefined;
          if (
            !candidate
            || candidate.state === 'LOSING'
            || !isUserTransition(candidatePly, userColor)
          ) {
            continue;
          }
          confirmedEnd = candidate;
          confirmationPly = candidatePly;
        }

        if (addFinding(transitionFinding(
          'EVALUATION_SAVE',
          from.start,
          confirmedEnd,
          confirmationPly,
          {
            recoveryCreatedPly: transitionPly.plyNumber,
            recoveryCreatedByUser: isUserTransition(transitionPly, userColor),
            confirmationPly: confirmationPly.plyNumber,
          },
        ))) {
          saves += 1;
        }
      }
    }
  }

  const incompleteBoundaries = [...new Set([
    ...analysisGapBoundaries,
    ...phaseGapBoundaries,
  ])].sort((left, right) => left - right);
  const hasCoverageGap = incompleteBoundaries.length > 0;

  if (hasCoverageGap) {
    const firstBoundary = incompleteBoundaries[0];
    const sourcePly = firstBoundary === undefined
      ? undefined
      : firstBoundary === 0
        ? firstPly
        : plyByNumber.get(firstBoundary);
    const sourcePositionId = firstBoundary === undefined
      ? undefined
      : positionIdByBoundary.get(firstBoundary);

    findings.push({
      key: 'conversion-coverage-gap',
      type: 'CONVERSION_EVIDENCE_COVERAGE_GAP',
      availability: 'INCOMPLETE',
      source: sourcePly
        ? {
            startPly: sourcePly.plyNumber,
            endPly: sourcePly.plyNumber,
            positionId: sourcePositionId ?? null,
          }
        : undefined,
      measurements: {
        incompleteBoundaryCount: incompleteBoundaries.length,
        analysisGapCount: analysisGapBoundaries.length,
        phaseGapCount: phaseGapBoundaries.length,
      },
      details: {
        incompleteBoundaries: incompleteBoundaries.slice(0, 32),
        analysisGapBoundaries: analysisGapBoundaries.slice(0, 32),
        phaseGapBoundaries: phaseGapBoundaries.slice(0, 32),
        winningMinCp: CONVERSION_WINNING_MIN_CP,
        losingMaxCp: CONVERSION_LOSING_MAX_CP,
      },
      unavailableReason: analysisGapBoundaries.length > 0
        ? 'required-engine-evidence-missing'
        : 'required-phase-context-missing',
    });
  }

  return {
    coverage: {
      status: hasCoverageGap
        ? 'INCOMPLETE'
        : findingsTruncated
          ? 'PARTIAL'
          : 'COMPLETE',
      reason: hasCoverageGap
        ? analysisGapBoundaries.length > 0
          ? 'required-engine-evidence-missing'
          : 'required-phase-context-missing'
        : findingsTruncated
          ? 'conversion-finding-limit-reached'
          : null,
      details: {
        segments: segments.length,
        failedConversions,
        throws,
        saves,
        winningMinCp: CONVERSION_WINNING_MIN_CP,
        losingMaxCp: CONVERSION_LOSING_MAX_CP,
        findingLimit: MAX_CONVERSION_FINDINGS,
        findingsTruncated,
      },
    },
    findings,
  };
}

export const conversionEvidenceDetector: EvidenceDetector = {
  key: CONVERSION_EVIDENCE_DETECTOR_KEY,
  version: CONVERSION_EVIDENCE_DETECTOR_VERSION,
  requiresCompleteAnalysis: true,
  detect: detectConversionEvidence,
};
