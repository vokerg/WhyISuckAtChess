import {
  detectTacticalMotifs,
  detectTacticalMotifsCreatedByMove,
  oppositeTacticalColor,
  tacticalMotifIdentity,
  type TacticalColor,
  type TacticalMotif,
} from '@why-i-suck-at-chess/chess-domain';
import type {
  EvidenceDetector,
  EvidenceDetectorResult,
  EvidenceFindingDraft,
  EvidenceInputSnapshot,
  EvidencePositionSnapshot,
  EvidencePlySnapshot,
} from './evidence.types';

export const TACTICAL_MOTIF_EVIDENCE_DETECTOR_KEY = 'tactical-motif';
export const TACTICAL_MOTIF_EVIDENCE_DETECTOR_VERSION = 'tactical-motif-v1';

const TACTICAL_MOTIF_MIN_SCORE_LOSS_CP = 80;
const MAX_TACTICAL_MOTIF_FINDINGS = 192;

type MotifState =
  | 'EXISTING'
  | 'CREATED_BY_BEST_MOVE'
  | 'NEWLY_ALLOWED'
  | 'CREATED_BY_BEST_REPLY';

function validatedUserColor(snapshot: EvidenceInputSnapshot): TacticalColor | null {
  if (snapshot.game.userColor === 'WHITE' || snapshot.game.userColor === 'BLACK') {
    return snapshot.game.userColor;
  }
  return null;
}

function parsedMove(uci: string): { from: string; to: string } | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}

function moveDirectlyUsesMotif(uci: string, motif: TacticalMotif): boolean {
  const move = parsedMove(uci);
  return move !== null
    && move.from === motif.attackerSquare
    && motif.targets.some((target) => target.square === move.to);
}

function moveDirectlyUsesNewlyAllowedMotif(
  uci: string,
  motif: TacticalMotif,
  beforeMotifs: TacticalMotif[],
): boolean {
  if (motif.type !== 'FORK') return moveDirectlyUsesMotif(uci, motif);

  const previousFork = beforeMotifs.find((candidate) => (
    candidate.type === 'FORK'
    && candidate.attackerSquare === motif.attackerSquare
    && candidate.attackerPiece === motif.attackerPiece
  ));
  if (!previousFork) return moveDirectlyUsesMotif(uci, motif);

  const previousTargetSquares = new Set(
    previousFork.targets.map((target) => target.square),
  );
  const move = parsedMove(uci);
  return move !== null
    && move.from === motif.attackerSquare
    && motif.targets.some((target) => (
      target.square === move.to
      && !previousTargetSquares.has(target.square)
    ));
}

function motifDetails(motif: TacticalMotif) {
  return {
    motif: motif.type,
    attackerSquare: motif.attackerSquare,
    attackerPiece: motif.attackerPiece,
    targets: motif.targets.map((target) => ({
      square: target.square,
      piece: target.piece,
      value: target.value,
    })),
    line: motif.line ?? [],
    revealedBy: motif.revealedBy ?? null,
  };
}

function motifMeasurements(
  motif: TacticalMotif,
  ply: EvidencePlySnapshot,
  before: EvidencePositionSnapshot,
  after: EvidencePositionSnapshot,
) {
  const targetValues = motif.targets.map((target) => target.value);
  return {
    scoreLossCp: ply.scoreLossCp,
    targetCount: motif.targets.length,
    targetValueTotal: targetValues.reduce((sum, value) => sum + value, 0),
    maxTargetValue: Math.max(...targetValues),
    scoreCpWhiteBefore: before.analysis?.scoreCpWhite ?? null,
    scoreCpWhiteAfter: after.analysis?.scoreCpWhite ?? null,
    mateWhiteBefore: before.analysis?.mateWhite ?? null,
    mateWhiteAfter: after.analysis?.mateWhite ?? null,
  };
}

function findingKey(
  type: string,
  plyNumber: number,
  state: MotifState,
  motif: TacticalMotif,
): string {
  return [
    type.toLowerCase(),
    'p' + plyNumber,
    state.toLowerCase(),
    motif.type.toLowerCase(),
    motif.attackerSquare,
    motif.targets.map((target) => target.square).sort().join('-'),
  ].join('-');
}

function addMotifFinding(
  findings: EvidenceFindingDraft[],
  identities: Set<string>,
  state: { truncated: boolean },
  args: {
    type: 'MISSED_TACTICAL_MOTIF' | 'ALLOWED_TACTICAL_MOTIF' | 'OPPONENT_TACTICAL_MOTIF';
    motifState: MotifState;
    motif: TacticalMotif;
    ply: EvidencePlySnapshot;
    before: EvidencePositionSnapshot;
    after: EvidencePositionSnapshot;
    sourcePositionId: number;
    engineMoveUci: string;
  },
): boolean {
  const key = findingKey(
    args.type,
    args.ply.plyNumber,
    args.motifState,
    args.motif,
  );
  if (identities.has(key)) return false;
  identities.add(key);
  if (findings.length >= MAX_TACTICAL_MOTIF_FINDINGS) {
    state.truncated = true;
    return false;
  }

  findings.push({
    key,
    type: args.type,
    source: {
      startPly: args.ply.plyNumber,
      endPly: args.ply.plyNumber,
      positionId: args.sourcePositionId,
    },
    measurements: motifMeasurements(
      args.motif,
      args.ply,
      args.before,
      args.after,
    ),
    details: {
      ...motifDetails(args.motif),
      motifState: args.motifState,
      playedMoveUci: args.ply.moveUci,
      engineMoveUci: args.engineMoveUci,
      beforePositionId: args.ply.beforePositionId,
      afterPositionId: args.ply.afterPositionId,
      detectorPolicy: {
        minScoreLossCp: TACTICAL_MOTIF_MIN_SCORE_LOSS_CP,
      },
    },
  });
  return true;
}

function unavailableResult(reason: string): EvidenceDetectorResult {
  return {
    coverage: {
      status: 'UNAVAILABLE',
      reason,
      details: {
        requiredModality: 'board-and-engine',
        minScoreLossCp: TACTICAL_MOTIF_MIN_SCORE_LOSS_CP,
      },
    },
    findings: [{
      key: 'tactical-motif-coverage-gap',
      type: 'TACTICAL_MOTIF_COVERAGE_GAP',
      availability: 'UNAVAILABLE',
      measurements: {
        incompletePlyCount: 0,
        boardGapCount: 0,
        analysisGapCount: 0,
      },
      details: {
        minScoreLossCp: TACTICAL_MOTIF_MIN_SCORE_LOSS_CP,
      },
      unavailableReason: reason,
    }],
  };
}

export function detectTacticalMotifEvidence(
  snapshot: EvidenceInputSnapshot,
): EvidenceDetectorResult {
  const userColor = validatedUserColor(snapshot);
  if (!userColor) return unavailableResult('user-color-unavailable');

  const analysisRunId = snapshot.provenance.analysis?.runId ?? null;
  if (analysisRunId === null) {
    return unavailableResult('complete-engine-analysis-unavailable');
  }

  const opponentColor = oppositeTacticalColor(userColor);
  const positions = new Map(snapshot.positions.map((position) => [position.id, position]));
  const findings: EvidenceFindingDraft[] = [];
  const findingIdentities = new Set<string>();
  const state = { truncated: false };
  const boardGapPlies: number[] = [];
  const analysisGapPlies: number[] = [];
  let userPlies = 0;
  let analysedUserPlies = 0;
  let existingMisses = 0;
  let createdMisses = 0;
  let newlyAllowed = 0;
  let opponentThreats = 0;

  for (const ply of [...snapshot.plies].sort(
    (left, right) => left.plyNumber - right.plyNumber,
  )) {
    if (!ply.isUserMove) continue;
    userPlies += 1;

    const before = positions.get(ply.beforePositionId);
    const after = positions.get(ply.afterPositionId);
    if (
      !before
      || !after
      || ply.moverColor !== userColor
    ) {
      boardGapPlies.push(ply.plyNumber);
      continue;
    }

    if (
      ply.engineAnalysisRunId !== analysisRunId
      || ply.scoreLossCp === null
      || !Number.isFinite(ply.scoreLossCp)
      || before.analysis === null
      || after.analysis === null
    ) {
      analysisGapPlies.push(ply.plyNumber);
      continue;
    }
    analysedUserPlies += 1;

    if (ply.scoreLossCp < TACTICAL_MOTIF_MIN_SCORE_LOSS_CP) continue;

    try {
      if (!detectTacticalMotifsCreatedByMove(before.normalizedFen, ply.moveUci)) {
        boardGapPlies.push(ply.plyNumber);
        continue;
      }

      const bestMove = before.analysis.bestMove;
      if (bestMove && bestMove !== ply.moveUci) {
        const existing = detectTacticalMotifs(before.normalizedFen, userColor);
        for (const motif of existing) {
          if (!moveDirectlyUsesMotif(bestMove, motif)) continue;
          if (addMotifFinding(findings, findingIdentities, state, {
            type: 'MISSED_TACTICAL_MOTIF',
            motifState: 'EXISTING',
            motif,
            ply,
            before,
            after,
            sourcePositionId: ply.beforePositionId,
            engineMoveUci: bestMove,
          })) {
            existingMisses += 1;
          }
        }

        const createdByBestMove = detectTacticalMotifsCreatedByMove(
          before.normalizedFen,
          bestMove,
        );
        if (createdByBestMove?.moverColor === userColor) {
          for (const motif of createdByBestMove.motifs) {
            if (addMotifFinding(findings, findingIdentities, state, {
              type: 'MISSED_TACTICAL_MOTIF',
              motifState: 'CREATED_BY_BEST_MOVE',
              motif,
              ply,
              before,
              after,
              sourcePositionId: ply.beforePositionId,
              engineMoveUci: bestMove,
            })) {
              createdMisses += 1;
            }
          }
        }
      }

      const bestReply = after.analysis.bestMove;
      if (!bestReply) continue;

      const opponentBefore = detectTacticalMotifs(
        before.normalizedFen,
        opponentColor,
      );
      const opponentBeforeIdentities = new Set(
        opponentBefore.map(tacticalMotifIdentity),
      );
      const newlyAllowedMotifs = detectTacticalMotifs(
        after.normalizedFen,
        opponentColor,
      ).filter(
        (motif) => !opponentBeforeIdentities.has(tacticalMotifIdentity(motif)),
      );

      for (const motif of newlyAllowedMotifs) {
        if (!moveDirectlyUsesNewlyAllowedMotif(
          bestReply,
          motif,
          opponentBefore,
        )) continue;
        if (addMotifFinding(findings, findingIdentities, state, {
          type: 'ALLOWED_TACTICAL_MOTIF',
          motifState: 'NEWLY_ALLOWED',
          motif,
          ply,
          before,
          after,
          sourcePositionId: ply.afterPositionId,
          engineMoveUci: bestReply,
        })) {
          newlyAllowed += 1;
        }
      }

      const createdByReply = detectTacticalMotifsCreatedByMove(
        after.normalizedFen,
        bestReply,
      );
      if (createdByReply?.moverColor === opponentColor) {
        for (const motif of createdByReply.motifs) {
          if (addMotifFinding(findings, findingIdentities, state, {
            type: 'OPPONENT_TACTICAL_MOTIF',
            motifState: 'CREATED_BY_BEST_REPLY',
            motif,
            ply,
            before,
            after,
            sourcePositionId: ply.afterPositionId,
            engineMoveUci: bestReply,
          })) {
            opponentThreats += 1;
          }
        }
      }
    } catch {
      boardGapPlies.push(ply.plyNumber);
    }
  }

  const incompletePlies = [...new Set([
    ...boardGapPlies,
    ...analysisGapPlies,
  ])].sort((left, right) => left - right);
  const hasCoverageGap = incompletePlies.length > 0;
  const coverageGapReason = boardGapPlies.length > 0
    ? 'required-board-or-engine-evidence-missing'
    : 'required-engine-evidence-missing';

  if (hasCoverageGap) {
    const firstPlyNumber = incompletePlies[0];
    const sourcePly = snapshot.plies.find(
      (ply) => ply.plyNumber === firstPlyNumber,
    );
    findings.push({
      key: 'tactical-motif-coverage-gap',
      type: 'TACTICAL_MOTIF_COVERAGE_GAP',
      availability: 'INCOMPLETE',
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
        incompletePlies: incompletePlies.slice(0, 32),
        minScoreLossCp: TACTICAL_MOTIF_MIN_SCORE_LOSS_CP,
      },
      unavailableReason: coverageGapReason,
    });
  }

  return {
    coverage: {
      status: hasCoverageGap
        ? 'INCOMPLETE'
        : state.truncated
          ? 'PARTIAL'
          : 'COMPLETE',
      reason: hasCoverageGap
        ? coverageGapReason
        : state.truncated
          ? 'tactical-motif-finding-limit-reached'
          : null,
      details: {
        userPlies,
        analysedUserPlies,
        existingMisses,
        createdMisses,
        newlyAllowed,
        opponentThreats,
        minScoreLossCp: TACTICAL_MOTIF_MIN_SCORE_LOSS_CP,
        findingLimit: MAX_TACTICAL_MOTIF_FINDINGS,
        findingsTruncated: state.truncated,
      },
    },
    findings,
  };
}

export const tacticalMotifEvidenceDetector: EvidenceDetector = {
  key: TACTICAL_MOTIF_EVIDENCE_DETECTOR_KEY,
  version: TACTICAL_MOTIF_EVIDENCE_DETECTOR_VERSION,
  requiresCompleteAnalysis: true,
  detect: detectTacticalMotifEvidence,
};
