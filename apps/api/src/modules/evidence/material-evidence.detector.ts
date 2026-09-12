import {
  analyseLegalMaterialMove,
  materialBalanceForColor,
  type MaterialColor,
} from '@why-i-suck-at-chess/chess-domain';
import type {
  EvidenceDetector,
  EvidenceDetectorResult,
  EvidenceFindingDraft,
  EvidenceInputSnapshot,
} from './evidence.types';

export const MATERIAL_EVIDENCE_DETECTOR_KEY = 'material-state';
export const MATERIAL_EVIDENCE_DETECTOR_VERSION = 'material-v1';

const MATERIAL_ERROR_MIN_SCORE_LOSS_CP = 80;
const MAX_MATERIAL_FINDINGS = 240;

function validatedUserColor(snapshot: EvidenceInputSnapshot): MaterialColor | null {
  if (snapshot.game.userColor === 'WHITE' || snapshot.game.userColor === 'BLACK') {
    return snapshot.game.userColor;
  }
  return null;
}

function unavailableResult(reason: string) {
  return {
    coverage: {
      status: 'UNAVAILABLE' as const,
      reason,
      details: { requiredModality: 'board-and-engine' },
    },
    findings: [],
  };
}

function addFinding(
  findings: EvidenceFindingDraft[],
  finding: EvidenceFindingDraft,
  state: { truncated: boolean },
): void {
  if (findings.length >= MAX_MATERIAL_FINDINGS) {
    state.truncated = true;
    return;
  }
  findings.push(finding);
}

export function detectMaterialEvidence(
  snapshot: EvidenceInputSnapshot,
): EvidenceDetectorResult {
  const userColor = validatedUserColor(snapshot);
  if (!userColor) {
    return unavailableResult('user-color-unavailable');
  }
  const analysisRunId = snapshot.provenance.analysis?.runId ?? null;
  const positions = new Map(snapshot.positions.map((position) => [position.id, position]));
  const findings: EvidenceFindingDraft[] = [];
  const state = { truncated: false };
  const analysisGapPlies: number[] = [];
  const boardGapPlies: number[] = [];
  let materialChanges = 0;
  let hangingFindings = 0;
  let missedMaterialWins = 0;
  let analysedUserPlies = 0;
  let userPlies = 0;

  for (const ply of snapshot.plies) {
    const before = positions.get(ply.beforePositionId);
    const after = positions.get(ply.afterPositionId);
    if (!before || !after) {
      boardGapPlies.push(ply.plyNumber);
      continue;
    }

    const playedMove = analyseLegalMaterialMove(before.normalizedFen, ply.moveUci);
    if (!playedMove) {
      boardGapPlies.push(ply.plyNumber);
      continue;
    }

    const materialBefore = materialBalanceForColor(before.normalizedFen, userColor);
    const materialAfter = materialBalanceForColor(after.normalizedFen, userColor);
    const materialDeltaForUser = materialAfter - materialBefore;

    if (materialDeltaForUser !== 0) {
      materialChanges += 1;
      addFinding(findings, {
        key: 'material-change-p' + ply.plyNumber,
        type: 'MATERIAL_STATE_CHANGE',
        source: {
          startPly: ply.plyNumber,
          endPly: ply.plyNumber,
          positionId: ply.afterPositionId,
        },
        measurements: {
          materialBalanceBefore: materialBefore,
          materialBalanceAfter: materialAfter,
          materialDeltaForUser,
          capturedValue: playedMove.capturedValue,
          promotionGain: playedMove.promotionGain,
          scoreLossCp: ply.isUserMove ? ply.scoreLossCp : null,
          scoreCpWhiteBefore: before.analysis?.scoreCpWhite ?? null,
          scoreCpWhiteAfter: after.analysis?.scoreCpWhite ?? null,
          mateWhiteBefore: before.analysis?.mateWhite ?? null,
          mateWhiteAfter: after.analysis?.mateWhite ?? null,
        },
        details: {
          beforePositionId: ply.beforePositionId,
          afterPositionId: ply.afterPositionId,
          moveUci: ply.moveUci,
          moverColor: ply.moverColor,
          isUserMove: ply.isUserMove,
          movedPiece: playedMove.piece,
          capturedPiece: playedMove.capturedPiece,
          promotion: playedMove.promotion,
        },
      }, state);
    }

    if (!ply.isUserMove) continue;
    userPlies += 1;

    if (
      analysisRunId === null
      || ply.engineAnalysisRunId !== analysisRunId
      || ply.scoreLossCp === null
      || !Number.isFinite(ply.scoreLossCp)
      || before.analysis === null
      || after.analysis === null
    ) {
      analysisGapPlies.push(ply.plyNumber);
      continue;
    }
    analysedUserPlies += 1;

    let missedCaptureFrom: string | null = null;
    const bestMove = before.analysis.bestMove;
    if (
      ply.scoreLossCp >= MATERIAL_ERROR_MIN_SCORE_LOSS_CP
      && bestMove
      && bestMove !== ply.moveUci
    ) {
      const bestMaterialMove = analyseLegalMaterialMove(
        before.normalizedFen,
        bestMove,
      );
      if (
        bestMaterialMove?.capturedPiece
        && bestMaterialMove.capturedOnTargetSquare
        && bestMaterialMove.isFavorableMaterialCapture
      ) {
        missedCaptureFrom = bestMaterialMove.from;
        missedMaterialWins += 1;
        addFinding(findings, {
          key: 'missed-material-win-p' + ply.plyNumber,
          type: 'MISSED_MATERIAL_WIN',
          source: {
            startPly: ply.plyNumber,
            endPly: ply.plyNumber,
            positionId: ply.beforePositionId,
          },
          measurements: {
            scoreLossCp: ply.scoreLossCp,
            attackerValue: bestMaterialMove.attackerValue,
            capturedValue: bestMaterialMove.capturedValue,
            immediateMaterialGain: bestMaterialMove.materialDeltaForMover,
            defenderCount: bestMaterialMove.defenderSquares.length,
            scoreCpWhiteBefore: before.analysis.scoreCpWhite,
            mateWhiteBefore: before.analysis.mateWhite,
          },
          details: {
            beforePositionId: ply.beforePositionId,
            afterPositionId: ply.afterPositionId,
            playedMoveUci: ply.moveUci,
            bestMoveUci: bestMove,
            attackerSquare: bestMaterialMove.from,
            targetSquare: bestMaterialMove.to,
            attackerPiece: bestMaterialMove.piece,
            capturedPiece: bestMaterialMove.capturedPiece,
            defenderSquares: bestMaterialMove.defenderSquares,
            mechanism: bestMaterialMove.defenderSquares.length === 0
              ? 'FREE_CAPTURE'
              : 'FAVORABLE_EXCHANGE',
          },
        }, state);
      }
    }

    const bestReply = after.analysis.bestMove
      ? analyseLegalMaterialMove(after.normalizedFen, after.analysis.bestMove)
      : null;
    if (
      ply.scoreLossCp >= MATERIAL_ERROR_MIN_SCORE_LOSS_CP
      && bestReply?.capturedPiece
      && bestReply.capturedOnTargetSquare
      && bestReply.moverColor !== userColor
      && bestReply.defenderSquares.length === 0
      && bestReply.capturedValue > 0
      && missedCaptureFrom !== bestReply.to
      && !(
        missedCaptureFrom === playedMove.from
        && bestReply.to === playedMove.to
      )
    ) {
      hangingFindings += 1;
      addFinding(findings, {
        key: 'hanging-material-p' + ply.plyNumber,
        type: 'HANGING_MATERIAL',
        source: {
          startPly: ply.plyNumber,
          endPly: ply.plyNumber,
          positionId: ply.afterPositionId,
        },
        measurements: {
          scoreLossCp: ply.scoreLossCp,
          targetValue: bestReply.capturedValue,
          attackerValue: bestReply.attackerValue,
          defenderCount: 0,
          scoreCpWhiteAfter: after.analysis.scoreCpWhite,
          mateWhiteAfter: after.analysis.mateWhite,
        },
        details: {
          beforePositionId: ply.beforePositionId,
          afterPositionId: ply.afterPositionId,
          playedMoveUci: ply.moveUci,
          bestReplyUci: after.analysis.bestMove,
          attackerSquare: bestReply.from,
          targetSquare: bestReply.to,
          attackerPiece: bestReply.piece,
          hangingPiece: bestReply.capturedPiece,
          mechanism: 'UNDEFENDED_EN_PRISE',
        },
      }, state);
    }
  }

  const incompletePlies = [...new Set([
    ...boardGapPlies,
    ...analysisGapPlies,
  ])].sort((left, right) => left - right);

  const completeAnalysisUnavailable = analysisRunId === null;
  const hasCoverageGap = completeAnalysisUnavailable || incompletePlies.length > 0;
  const coverageGapReason = boardGapPlies.length > 0
    ? 'required-board-or-engine-evidence-missing'
    : completeAnalysisUnavailable
      ? 'complete-engine-analysis-unavailable'
      : 'required-engine-evidence-missing';

  if (hasCoverageGap) {
    const firstPly = incompletePlies[0] ?? snapshot.plies[0]?.plyNumber;
    const sourcePly = firstPly === undefined
      ? undefined
      : snapshot.plies.find((ply) => ply.plyNumber === firstPly);
    findings.push({
      key: 'material-coverage-gap',
      type: 'MATERIAL_EVIDENCE_COVERAGE_GAP',
      availability: completeAnalysisUnavailable && boardGapPlies.length === 0
        ? 'UNAVAILABLE'
        : 'INCOMPLETE',
      source: sourcePly
        ? {
            startPly: sourcePly.plyNumber,
            endPly: sourcePly.plyNumber,
            positionId: sourcePly.beforePositionId,
          }
        : undefined,
      measurements: {
        incompletePlyCount: incompletePlies.length,
        boardGapCount: boardGapPlies.length,
        analysisGapCount: analysisGapPlies.length,
      },
      details: {
        completeAnalysisAvailable: !completeAnalysisUnavailable,
        incompletePlies: incompletePlies.slice(0, 32),
      },
      unavailableReason: coverageGapReason,
    });
  }

  const coverageStatus = hasCoverageGap
    ? 'INCOMPLETE'
    : state.truncated
      ? 'PARTIAL'
      : 'COMPLETE';

  return {
    coverage: {
      status: coverageStatus,
      reason: hasCoverageGap
        ? coverageGapReason
        : state.truncated
          ? 'material-finding-limit-reached'
          : null,
      details: {
        userPlies,
        analysedUserPlies,
        materialChanges,
        hangingFindings,
        missedMaterialWins,
        findingLimit: MAX_MATERIAL_FINDINGS,
        findingsTruncated: state.truncated,
      },
    },
    findings,
  };
}

export const materialEvidenceDetector: EvidenceDetector = {
  key: MATERIAL_EVIDENCE_DETECTOR_KEY,
  version: MATERIAL_EVIDENCE_DETECTOR_VERSION,
  requiresCompleteAnalysis: false,
  refreshOnCompleteAnalysis: true,
  detect: detectMaterialEvidence,
};
