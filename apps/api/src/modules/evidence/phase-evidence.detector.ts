import {
  POSITION_PHASE_CLASSIFIER_VERSION,
  classifyEndgameFamily,
  classifyPositionPhase,
  stabilizeGamePhase,
  type EndgameFamily,
  type PositionPhase,
  type PositionPhaseMeasurements,
} from '@why-i-suck-at-chess/chess-domain';
import type {
  EvidenceDetector,
  EvidenceDetectorResult,
  EvidenceFindingDraft,
  EvidenceInputSnapshot,
} from './evidence.types';

export const PHASE_EVIDENCE_DETECTOR_KEY = 'phase-context';
export const PHASE_EVIDENCE_DETECTOR_VERSION = 'phase-v1';

interface ClassifiedPosition {
  boundaryPly: number;
  positionId: number;
  phase: PositionPhase;
  structuralPhase: PositionPhase;
  endgameFamily: EndgameFamily;
  measurements: PositionPhaseMeasurements | null;
}

interface PositionRange {
  start: ClassifiedPosition;
  end: ClassifiedPosition;
  positionCount: number;
}

function sourceForRange(range: PositionRange) {
  const startPly = range.start.boundaryPly === 0
    ? (range.end.boundaryPly >= 1 ? 1 : null)
    : range.start.boundaryPly;
  const endPly = range.end.boundaryPly >= 1
    ? range.end.boundaryPly
    : null;
  return {
    startPly,
    endPly,
    positionId: range.start.positionId,
  };
}

function rangeFinding(range: PositionRange, index: number): EvidenceFindingDraft {
  return {
    key: 'phase-range-' + index,
    type: 'POSITION_PHASE_RANGE',
    availability: range.start.phase === 'UNKNOWN' ? 'INCOMPLETE' : 'PRESENT',
    source: sourceForRange(range),
    measurements: {
      positionCount: range.positionCount,
      startBoundaryPly: range.start.boundaryPly,
      endBoundaryPly: range.end.boundaryPly,
      startPhaseUnits: range.start.measurements?.phaseUnits ?? null,
      endPhaseUnits: range.end.measurements?.phaseUnits ?? null,
      startMajorMinorPieceCount:
        range.start.measurements?.majorMinorPieceCount ?? null,
      endMajorMinorPieceCount:
        range.end.measurements?.majorMinorPieceCount ?? null,
      startPawnCount: range.start.measurements?.pawnCount ?? null,
      endPawnCount: range.end.measurements?.pawnCount ?? null,
    },
    details: {
      classifierVersion: POSITION_PHASE_CLASSIFIER_VERSION,
      phase: range.start.phase,
      endgameFamily: range.start.endgameFamily,
      structuralStartPhase: range.start.structuralPhase,
      structuralEndPhase: range.end.structuralPhase,
      startPositionId: range.start.positionId,
      endPositionId: range.end.positionId,
    },
    ...(range.start.phase === 'UNKNOWN'
      ? { unavailableReason: 'position-phase-unavailable' }
      : {}),
  };
}

function sameContext(left: ClassifiedPosition, right: ClassifiedPosition): boolean {
  return left.phase === right.phase
    && left.endgameFamily === right.endgameFamily;
}

function compactRanges(entries: ClassifiedPosition[]): PositionRange[] {
  const ranges: PositionRange[] = [];
  for (const entry of entries) {
    const current = ranges.at(-1);
    if (current && sameContext(current.end, entry)) {
      current.end = entry;
      current.positionCount += 1;
      continue;
    }
    ranges.push({ start: entry, end: entry, positionCount: 1 });
  }
  return ranges;
}

export function detectPhaseEvidence(
  snapshot: EvidenceInputSnapshot,
): EvidenceDetectorResult {
  const plies = [...snapshot.plies].sort(
    (left, right) => left.plyNumber - right.plyNumber,
  );
  const firstPly = plies[0];
  if (!firstPly) {
    return {
      coverage: {
        status: 'UNAVAILABLE',
        reason: 'no-indexed-plies',
        details: {
          classifierVersion: POSITION_PHASE_CLASSIFIER_VERSION,
          classifiedPositions: 0,
          unknownPositions: 0,
        },
      },
      findings: [{
        key: 'phase-coverage-gap',
        type: 'PHASE_EVIDENCE_COVERAGE_GAP',
        availability: 'UNAVAILABLE',
        measurements: { unknownPositionCount: 0 },
        details: { classifierVersion: POSITION_PHASE_CLASSIFIER_VERSION },
        unavailableReason: 'no-indexed-plies',
      }],
    };
  }

  const positions = new Map(
    snapshot.positions.map((position) => [position.id, position]),
  );
  const references = [
    { boundaryPly: 0, positionId: firstPly.beforePositionId },
    ...plies.map((ply) => ({
      boundaryPly: ply.plyNumber,
      positionId: ply.afterPositionId,
    })),
  ];

  const classified: ClassifiedPosition[] = [];
  const unknownBoundaryPlies: number[] = [];
  let stablePhase: PositionPhase | null = null;

  for (const reference of references) {
    const position = positions.get(reference.positionId);
    if (!position) {
      unknownBoundaryPlies.push(reference.boundaryPly);
      classified.push({
        ...reference,
        phase: 'UNKNOWN',
        structuralPhase: 'UNKNOWN',
        endgameFamily: 'UNKNOWN',
        measurements: null,
      });
      continue;
    }

    const structural = classifyPositionPhase(position.normalizedFen);
    if (structural.phase === 'UNKNOWN') {
      unknownBoundaryPlies.push(reference.boundaryPly);
      classified.push({
        ...reference,
        phase: 'UNKNOWN',
        structuralPhase: 'UNKNOWN',
        endgameFamily: 'UNKNOWN',
        measurements: structural.measurements,
      });
      continue;
    }

    const phase = stabilizeGamePhase(stablePhase, structural.phase);
    stablePhase = phase;
    const endgameFamily = phase === 'ENDGAME'
      ? classifyEndgameFamily(position.normalizedFen)
      : 'NONE';
    if (endgameFamily === 'UNKNOWN') {
      unknownBoundaryPlies.push(reference.boundaryPly);
    }

    classified.push({
      ...reference,
      phase,
      structuralPhase: structural.phase,
      endgameFamily,
      measurements: structural.measurements,
    });
  }

  const ranges = compactRanges(classified);
  const findings = ranges.map(rangeFinding);
  const unknownPositionCount = classified.filter(
    (entry) => entry.phase === 'UNKNOWN' || entry.endgameFamily === 'UNKNOWN',
  ).length;

  if (unknownPositionCount > 0) {
    const firstUnknown = classified.find(
      (entry) => entry.phase === 'UNKNOWN' || entry.endgameFamily === 'UNKNOWN',
    );
    const sourcePositionExists = firstUnknown
      ? positions.has(firstUnknown.positionId)
      : false;
    findings.push({
      key: 'phase-coverage-gap',
      type: 'PHASE_EVIDENCE_COVERAGE_GAP',
      availability: 'INCOMPLETE',
      source: firstUnknown
        ? {
            startPly: firstUnknown.boundaryPly >= 1
              ? firstUnknown.boundaryPly
              : null,
            endPly: firstUnknown.boundaryPly >= 1
              ? firstUnknown.boundaryPly
              : null,
            positionId: sourcePositionExists ? firstUnknown.positionId : null,
          }
        : undefined,
      measurements: {
        unknownPositionCount,
        classifiedPositionCount: classified.length - unknownPositionCount,
        rangeCount: ranges.length,
      },
      details: {
        classifierVersion: POSITION_PHASE_CLASSIFIER_VERSION,
        unknownBoundaryPlies: unknownBoundaryPlies.slice(0, 32),
      },
      unavailableReason: 'required-board-position-unavailable-or-invalid',
    });
  }

  return {
    coverage: {
      status: unknownPositionCount > 0 ? 'INCOMPLETE' : 'COMPLETE',
      reason: unknownPositionCount > 0
        ? 'required-board-position-unavailable-or-invalid'
        : null,
      details: {
        classifierVersion: POSITION_PHASE_CLASSIFIER_VERSION,
        classifiedPositions: classified.length - unknownPositionCount,
        unknownPositions: unknownPositionCount,
        rangeCount: ranges.length,
      },
    },
    findings,
  };
}

export const phaseEvidenceDetector: EvidenceDetector = {
  key: PHASE_EVIDENCE_DETECTOR_KEY,
  version: PHASE_EVIDENCE_DETECTOR_VERSION,
  requiresCompleteAnalysis: false,
  detect: detectPhaseEvidence,
};
