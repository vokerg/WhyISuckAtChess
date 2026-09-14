import { detectPhaseEvidence } from './phase-evidence.detector';
import type {
  EvidenceDetector,
  EvidenceDetectorResult,
  EvidenceFindingDraft,
  EvidenceInputSnapshot,
  EvidencePositionSnapshot,
} from './evidence.types';

export const OPENING_EVIDENCE_DETECTOR_KEY = 'opening-context';
export const OPENING_EVIDENCE_DETECTOR_VERSION = 'opening-v1';
export const OPENING_EVIDENCE_MAX_PLY = 20;
export const OPENING_BAD_POSITION_MAX_USER_CP = -80;

type UserColor = 'WHITE' | 'BLACK';

function userColor(snapshot: EvidenceInputSnapshot): UserColor | null {
  return snapshot.game.userColor === 'WHITE' || snapshot.game.userColor === 'BLACK'
    ? snapshot.game.userColor
    : null;
}

function finite(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function effectiveScoreCpWhite(position: EvidencePositionSnapshot | undefined): number | null {
  const analysis = position?.analysis;
  if (!analysis) return null;
  const mate = finite(analysis.mateWhite);
  if (mate !== null) {
    if (mate > 0) return 100_000;
    if (mate < 0) return -100_000;
    return 0;
  }
  return finite(analysis.scoreCpWhite);
}

function scoreCpForUser(
  position: EvidencePositionSnapshot | undefined,
  color: UserColor,
): number | null {
  const white = effectiveScoreCpWhite(position);
  if (white === null) return null;
  return color === 'WHITE' ? white : -white;
}

function phaseByBoundary(snapshot: EvidenceInputSnapshot): Map<number, string> {
  const result = detectPhaseEvidence(snapshot);
  const phases = new Map<number, string>();
  for (const finding of result.findings) {
    if (finding.type !== 'POSITION_PHASE_RANGE') continue;
    const start = finding.measurements.startBoundaryPly;
    const end = finding.measurements.endBoundaryPly;
    const phase = finding.details?.phase;
    if (
      typeof start !== 'number'
      || typeof end !== 'number'
      || typeof phase !== 'string'
    ) {
      continue;
    }
    for (let boundary = start; boundary <= end; boundary += 1) {
      phases.set(boundary, phase);
    }
  }
  return phases;
}

function openingDetails(snapshot: EvidenceInputSnapshot, color: UserColor) {
  return {
    userColor: color,
    openingName: snapshot.game.openingName,
    openingEco: snapshot.game.openingEco,
    speedCategory: snapshot.game.speedCategory,
    exactTimeControlKey: snapshot.game.exactTimeControlKey,
    maxOpeningPly: OPENING_EVIDENCE_MAX_PLY,
  };
}

export function detectOpeningEvidence(
  snapshot: EvidenceInputSnapshot,
): EvidenceDetectorResult {
  const color = userColor(snapshot);
  if (!color) {
    return {
      coverage: {
        status: 'UNAVAILABLE',
        reason: 'user-color-unavailable',
        details: { maxOpeningPly: OPENING_EVIDENCE_MAX_PLY },
      },
      findings: [{
        key: 'opening-coverage-gap',
        type: 'OPENING_EVIDENCE_COVERAGE_GAP',
        availability: 'UNAVAILABLE',
        measurements: { eligibleOpeningPlies: 0, incompleteOpeningPlies: 0 },
        details: { maxOpeningPly: OPENING_EVIDENCE_MAX_PLY },
        unavailableReason: 'user-color-unavailable',
      }],
    };
  }

  const plies = [...snapshot.plies]
    .sort((left, right) => left.plyNumber - right.plyNumber)
    .filter((ply) => ply.plyNumber <= OPENING_EVIDENCE_MAX_PLY);

  if (plies.length === 0) {
    return {
      coverage: {
        status: 'UNAVAILABLE',
        reason: 'no-early-indexed-plies',
        details: { maxOpeningPly: OPENING_EVIDENCE_MAX_PLY },
      },
      findings: [{
        key: 'opening-coverage-gap',
        type: 'OPENING_EVIDENCE_COVERAGE_GAP',
        availability: 'UNAVAILABLE',
        measurements: { eligibleOpeningPlies: 0, incompleteOpeningPlies: 0 },
        details: { maxOpeningPly: OPENING_EVIDENCE_MAX_PLY },
        unavailableReason: 'no-early-indexed-plies',
      }],
    };
  }

  if (snapshot.provenance.analysis === null) {
    return {
      coverage: {
        status: 'INCOMPLETE',
        reason: 'required-engine-evidence-missing',
        details: { maxOpeningPly: OPENING_EVIDENCE_MAX_PLY },
      },
      findings: [{
        key: 'opening-coverage-gap',
        type: 'OPENING_EVIDENCE_COVERAGE_GAP',
        availability: 'INCOMPLETE',
        measurements: {
          eligibleOpeningPlies: plies.length,
          incompleteOpeningPlies: plies.length,
        },
        details: {
          maxOpeningPly: OPENING_EVIDENCE_MAX_PLY,
          missingAnalysisPlies: plies.map((ply) => ply.plyNumber).slice(0, 32),
        },
        unavailableReason: 'required-engine-evidence-missing',
      }],
    };
  }

  const positions = new Map(
    snapshot.positions.map((position) => [position.id, position]),
  );
  const phases = phaseByBoundary(snapshot);
  const findings: EvidenceFindingDraft[] = [];
  const incompleteOpeningPlies: number[] = [];
  let eligibleOpeningPlies = 0;
  let userMoveSamples = 0;
  let badPositionEntries = 0;

  for (const ply of plies) {
    const beforeBoundary = ply.plyNumber - 1;
    const beforePhase = phases.get(beforeBoundary);
    if (beforePhase === undefined || beforePhase === 'UNKNOWN') {
      incompleteOpeningPlies.push(ply.plyNumber);
      continue;
    }
    if (beforePhase !== 'OPENING') continue;

    eligibleOpeningPlies += 1;
    const before = positions.get(ply.beforePositionId);
    const after = positions.get(ply.afterPositionId);
    const beforeUserCp = scoreCpForUser(before, color);
    const afterUserCp = scoreCpForUser(after, color);

    if (beforeUserCp === null || afterUserCp === null) {
      incompleteOpeningPlies.push(ply.plyNumber);
      continue;
    }

    if (ply.isUserMove) {
      const scoreLossCp = finite(ply.scoreLossCp);
      if (scoreLossCp === null) {
        incompleteOpeningPlies.push(ply.plyNumber);
      } else {
        findings.push({
          key: 'opening-move-p' + ply.plyNumber,
          type: 'OPENING_MOVE_QUALITY_SAMPLE',
          source: {
            startPly: ply.plyNumber,
            endPly: ply.plyNumber,
            positionId: ply.beforePositionId,
          },
          measurements: {
            scoreLossCp,
            classificationCode: ply.classificationCode,
            beforeUserEvalCp: beforeUserCp,
            afterUserEvalCp: afterUserCp,
          },
          details: {
            ...openingDetails(snapshot, color),
            moveUci: ply.moveUci,
            beforePositionId: ply.beforePositionId,
            afterPositionId: ply.afterPositionId,
            phase: 'OPENING',
          },
        });
        userMoveSamples += 1;
      }
    }

    if (
      beforeUserCp > OPENING_BAD_POSITION_MAX_USER_CP
      && afterUserCp <= OPENING_BAD_POSITION_MAX_USER_CP
    ) {
      findings.push({
        key: 'opening-bad-entry-p' + ply.plyNumber,
        type: 'OPENING_BAD_POSITION_ENTRY',
        source: {
          startPly: ply.plyNumber,
          endPly: ply.plyNumber,
          positionId: ply.afterPositionId,
        },
        measurements: {
          beforeUserEvalCp: beforeUserCp,
          afterUserEvalCp: afterUserCp,
          thresholdUserEvalCp: OPENING_BAD_POSITION_MAX_USER_CP,
        },
        details: {
          ...openingDetails(snapshot, color),
          moveUci: ply.moveUci,
          moverColor: ply.moverColor,
          isUserMove: ply.isUserMove,
          beforePositionId: ply.beforePositionId,
          afterPositionId: ply.afterPositionId,
          phase: 'OPENING',
          thresholdEntry: true,
        },
      });
      badPositionEntries += 1;
    }
  }

  const incomplete = [...new Set(incompleteOpeningPlies)].sort((a, b) => a - b);
  if (incomplete.length > 0) {
    const first = plies.find((ply) => ply.plyNumber === incomplete[0]);
    findings.push({
      key: 'opening-coverage-gap',
      type: 'OPENING_EVIDENCE_COVERAGE_GAP',
      availability: 'INCOMPLETE',
      source: first
        ? {
            startPly: first.plyNumber,
            endPly: first.plyNumber,
            positionId: first.beforePositionId,
          }
        : undefined,
      measurements: {
        eligibleOpeningPlies,
        incompleteOpeningPlies: incomplete.length,
        userMoveSamples,
        badPositionEntries,
      },
      details: {
        maxOpeningPly: OPENING_EVIDENCE_MAX_PLY,
        badPositionThresholdUserEvalCp: OPENING_BAD_POSITION_MAX_USER_CP,
        incompleteOpeningPlyNumbers: incomplete.slice(0, 32),
      },
      unavailableReason: 'opening-phase-or-engine-evidence-incomplete',
    });
  }

  return {
    coverage: {
      status: incomplete.length > 0 ? 'INCOMPLETE' : 'COMPLETE',
      reason: incomplete.length > 0
        ? 'opening-phase-or-engine-evidence-incomplete'
        : null,
      details: {
        maxOpeningPly: OPENING_EVIDENCE_MAX_PLY,
        badPositionThresholdUserEvalCp: OPENING_BAD_POSITION_MAX_USER_CP,
        eligibleOpeningPlies,
        userMoveSamples,
        badPositionEntries,
        incompleteOpeningPlies: incomplete.length,
      },
    },
    findings,
  };
}

export const openingEvidenceDetector: EvidenceDetector = {
  key: OPENING_EVIDENCE_DETECTOR_KEY,
  version: OPENING_EVIDENCE_DETECTOR_VERSION,
  requiresCompleteAnalysis: true,
  detect: detectOpeningEvidence,
};
