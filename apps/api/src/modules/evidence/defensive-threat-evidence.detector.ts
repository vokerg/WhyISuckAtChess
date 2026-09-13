import {
  detectBackRankMateByMove,
  detectDefenderRemovalCreatedByMove,
  detectOverloadedDefenders,
  detectTacticalMotifsCreatedByMove,
  inspectLegalUciMove,
  oppositeTacticalColor,
  type OverloadedDefenderFact,
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

export const DEFENSIVE_THREAT_EVIDENCE_DETECTOR_KEY = 'defensive-threat';
export const DEFENSIVE_THREAT_EVIDENCE_DETECTOR_VERSION = 'defensive-threat-v1';

const DEFENSIVE_THREAT_MIN_SCORE_LOSS_CP = 80;
const MAX_DEFENSIVE_THREAT_FINDINGS = 192;

type UserColor = 'WHITE' | 'BLACK';

interface ThreatMechanism {
  kind:
    | 'DEFENDER_REMOVAL'
    | 'OVERLOADED_DEFENDER'
    | 'BACK_RANK_MATE'
    | 'MATING_THREAT'
    | 'CORE_TACTICAL_MOTIF';
  details: Record<string, unknown>;
}

function validatedUserColor(snapshot: EvidenceInputSnapshot): UserColor | null {
  if (snapshot.game.userColor === 'WHITE' || snapshot.game.userColor === 'BLACK') {
    return snapshot.game.userColor;
  }
  return null;
}

function favorableMate(mateWhite: number | null, color: UserColor): boolean {
  if (mateWhite === null || !Number.isFinite(mateWhite) || mateWhite === 0) return false;
  return color === 'WHITE' ? mateWhite > 0 : mateWhite < 0;
}

function parsedMove(uci: string): { from: string; to: string } | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}

function moveUsesMotif(uci: string, motif: TacticalMotif): boolean {
  const move = parsedMove(uci);
  return move !== null
    && move.from === motif.attackerSquare
    && motif.targets.some((target) => target.square === move.to);
}

function overloadIdentity(overload: OverloadedDefenderFact): string {
  return [
    overload.defenderSquare,
    overload.defenderPiece,
    overload.targets.map((target) => target.square).sort().join(','),
  ].join('|');
}

function newlyCreatedOverloads(
  beforeFen: string,
  afterFen: string,
  userColor: UserColor,
): OverloadedDefenderFact[] {
  const before = detectOverloadedDefenders(beforeFen, userColor);
  const beforeIdentities = new Set(before.map(overloadIdentity));
  return detectOverloadedDefenders(afterFen, userColor)
    .filter((entry) => !beforeIdentities.has(overloadIdentity(entry)));
}

function bestLineForMove(
  position: EvidencePositionSnapshot,
  moveUci: string,
) {
  return position.analysis?.multiPv.find(
    (line) => line.pv[0] === moveUci,
  ) ?? null;
}

function measurements(
  ply: EvidencePlySnapshot,
  before: EvidencePositionSnapshot,
  after: EvidencePositionSnapshot,
) {
  return {
    scoreLossCp: ply.scoreLossCp,
    scoreCpWhiteBefore: before.analysis?.scoreCpWhite ?? null,
    scoreCpWhiteAfter: after.analysis?.scoreCpWhite ?? null,
    mateWhiteBefore: before.analysis?.mateWhite ?? null,
    mateWhiteAfter: after.analysis?.mateWhite ?? null,
  };
}

function addFinding(
  findings: EvidenceFindingDraft[],
  identities: Set<string>,
  state: { truncated: boolean },
  finding: EvidenceFindingDraft,
): boolean {
  if (identities.has(finding.key)) return false;
  identities.add(finding.key);
  if (findings.length >= MAX_DEFENSIVE_THREAT_FINDINGS) {
    state.truncated = true;
    return false;
  }
  findings.push(finding);
  return true;
}

function unavailableResult(reason: string): EvidenceDetectorResult {
  return {
    coverage: {
      status: 'UNAVAILABLE',
      reason,
      details: {
        requiredModality: 'board-engine-multipv',
        minScoreLossCp: DEFENSIVE_THREAT_MIN_SCORE_LOSS_CP,
      },
    },
    findings: [{
      key: 'defensive-threat-coverage-gap',
      type: 'DEFENSIVE_THREAT_COVERAGE_GAP',
      availability: 'UNAVAILABLE',
      measurements: {
        incompletePlyCount: 0,
        boardGapCount: 0,
        analysisGapCount: 0,
        multiPvGapCount: 0,
      },
      details: {
        minScoreLossCp: DEFENSIVE_THREAT_MIN_SCORE_LOSS_CP,
      },
      unavailableReason: reason,
    }],
  };
}

export function detectDefensiveThreatEvidence(
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
  const plies = [...snapshot.plies].sort(
    (left, right) => left.plyNumber - right.plyNumber,
  );
  const plyByNumber = new Map(plies.map((ply) => [ply.plyNumber, ply]));
  const findings: EvidenceFindingDraft[] = [];
  const findingIdentities = new Set<string>();
  const state = { truncated: false };
  const boardGapPlies: number[] = [];
  const analysisGapPlies: number[] = [];
  const multiPvGapPlies: number[] = [];
  let analysedUserPlies = 0;
  let threatBlindnessCount = 0;
  let defenderRemovalCount = 0;
  let overloadCount = 0;
  let backRankCount = 0;
  let missedMateCount = 0;

  for (const ply of plies) {
    if (!ply.isUserMove) continue;

    const before = positions.get(ply.beforePositionId);
    const after = positions.get(ply.afterPositionId);
    if (!before || !after || ply.moverColor !== userColor) {
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

    if (before.analysis.multiPv.length === 0) {
      multiPvGapPlies.push(ply.plyNumber);
      continue;
    }
    analysedUserPlies += 1;

    const bestMove = before.analysis.bestMove;
    const bestMoveFact = bestMove
      ? inspectLegalUciMove(before.normalizedFen, bestMove)
      : null;
    const playedMoveFact = inspectLegalUciMove(before.normalizedFen, ply.moveUci);
    if (!playedMoveFact) {
      boardGapPlies.push(ply.plyNumber);
      continue;
    }

    const userHadMate = favorableMate(before.analysis.mateWhite, userColor);
    const userStillHasMate = favorableMate(after.analysis.mateWhite, userColor);
    if (
      userHadMate
      && bestMove
      && bestMove !== ply.moveUci
      && bestMoveFact
      && !userStillHasMate
    ) {
      const backRankMate = detectBackRankMateByMove(
        before.normalizedFen,
        bestMove,
      );
      const type = backRankMate
        ? 'MISSED_BACK_RANK_MATE'
        : 'MISSED_FORCED_MATE';
      if (addFinding(findings, findingIdentities, state, {
        key: type.toLowerCase() + '-p' + ply.plyNumber,
        type,
        source: {
          startPly: ply.plyNumber,
          endPly: ply.plyNumber,
          positionId: ply.beforePositionId,
        },
        measurements: measurements(ply, before, after),
        details: {
          playedMoveUci: ply.moveUci,
          bestMoveUci: bestMove,
          bestPv: before.analysis.bestPv,
          bestMultiPvLine: bestLineForMove(before, bestMove),
          immediateMate: bestMoveFact.givesCheckmate,
          backRankMate,
          beforePositionId: ply.beforePositionId,
          afterPositionId: ply.afterPositionId,
        },
      })) {
        missedMateCount += 1;
        if (backRankMate) backRankCount += 1;
      }
    }

    if (ply.scoreLossCp < DEFENSIVE_THREAT_MIN_SCORE_LOSS_CP) continue;
    if (!bestMove || bestMove === ply.moveUci || !bestMoveFact) continue;

    const creatingPly = plyByNumber.get(ply.plyNumber - 1);
    if (
      !creatingPly
      || creatingPly.isUserMove
      || creatingPly.moverColor !== opponentColor
      || creatingPly.afterPositionId !== ply.beforePositionId
    ) {
      continue;
    }

    const creatingBefore = positions.get(creatingPly.beforePositionId);
    if (!creatingBefore) {
      boardGapPlies.push(ply.plyNumber);
      continue;
    }
    const creatingMoveFact = inspectLegalUciMove(
      creatingBefore.normalizedFen,
      creatingPly.moveUci,
    );
    if (!creatingMoveFact || creatingMoveFact.moverColor !== opponentColor) {
      boardGapPlies.push(ply.plyNumber);
      continue;
    }

    const defensiveLine = bestLineForMove(before, bestMove);
    if (!defensiveLine) {
      multiPvGapPlies.push(ply.plyNumber);
      continue;
    }

    const opponentBestReply = after.analysis.bestMove;
    if (!opponentBestReply) {
      analysisGapPlies.push(ply.plyNumber);
      continue;
    }
    const replyFact = inspectLegalUciMove(after.normalizedFen, opponentBestReply);
    if (!replyFact || replyFact.moverColor !== opponentColor) {
      boardGapPlies.push(ply.plyNumber);
      continue;
    }

    const mechanisms: ThreatMechanism[] = [];
    const removal = detectDefenderRemovalCreatedByMove(
      creatingBefore.normalizedFen,
      creatingPly.moveUci,
    );
    const removalTarget = removal?.targets.find(
      (target) => target.square === replyFact.to,
    );
    if (removal && removalTarget) {
      mechanisms.push({
        kind: 'DEFENDER_REMOVAL',
        details: {
          removedDefenderSquare: removal.removedDefenderSquare,
          removedDefenderPiece: removal.removedDefenderPiece,
          target: removalTarget,
        },
      });
      if (addFinding(findings, findingIdentities, state, {
        key: 'defender-removal-threat-p' + creatingPly.plyNumber + '-r' + ply.plyNumber,
        type: 'DEFENDER_REMOVAL_THREAT',
        source: {
          startPly: creatingPly.plyNumber,
          endPly: ply.plyNumber,
          positionId: ply.beforePositionId,
        },
        measurements: measurements(ply, before, after),
        details: {
          creatingMoveUci: creatingPly.moveUci,
          defensiveMoveUci: bestMove,
          playedResponseUci: ply.moveUci,
          exploitingReplyUci: opponentBestReply,
          removedDefenderSquare: removal.removedDefenderSquare,
          removedDefenderPiece: removal.removedDefenderPiece,
          target: removalTarget,
        },
      })) {
        defenderRemovalCount += 1;
      }
    }

    const overloads = newlyCreatedOverloads(
      creatingBefore.normalizedFen,
      before.normalizedFen,
      userColor,
    );
    const exploitedOverload = overloads.find((overload) => (
      overload.targets.some((target) => target.square === replyFact.to)
    ));
    if (exploitedOverload) {
      const exploitedTarget = exploitedOverload.targets.find(
        (target) => target.square === replyFact.to,
      );
      mechanisms.push({
        kind: 'OVERLOADED_DEFENDER',
        details: {
          defenderSquare: exploitedOverload.defenderSquare,
          defenderPiece: exploitedOverload.defenderPiece,
          targets: exploitedOverload.targets,
          exploitedTarget,
        },
      });
      if (addFinding(findings, findingIdentities, state, {
        key: 'overloaded-defender-threat-p' + creatingPly.plyNumber + '-r' + ply.plyNumber,
        type: 'OVERLOADED_DEFENDER_THREAT',
        source: {
          startPly: creatingPly.plyNumber,
          endPly: ply.plyNumber,
          positionId: ply.beforePositionId,
        },
        measurements: measurements(ply, before, after),
        details: {
          creatingMoveUci: creatingPly.moveUci,
          defensiveMoveUci: bestMove,
          playedResponseUci: ply.moveUci,
          exploitingReplyUci: opponentBestReply,
          defenderSquare: exploitedOverload.defenderSquare,
          defenderPiece: exploitedOverload.defenderPiece,
          targets: exploitedOverload.targets,
          exploitedTarget,
        },
      })) {
        overloadCount += 1;
      }
    }

    const createdMotifs = detectTacticalMotifsCreatedByMove(
      creatingBefore.normalizedFen,
      creatingPly.moveUci,
    );
    if (createdMotifs?.moverColor === opponentColor) {
      const exploitedMotif = createdMotifs.motifs.find(
        (motif) => moveUsesMotif(opponentBestReply, motif),
      );
      if (exploitedMotif) {
        mechanisms.push({
          kind: 'CORE_TACTICAL_MOTIF',
          details: {
            motif: exploitedMotif.type,
            attackerSquare: exploitedMotif.attackerSquare,
            attackerPiece: exploitedMotif.attackerPiece,
            targets: exploitedMotif.targets,
            line: exploitedMotif.line ?? [],
            revealedBy: exploitedMotif.revealedBy ?? null,
          },
        });
      }
    }

    const backRankMate = detectBackRankMateByMove(
      after.normalizedFen,
      opponentBestReply,
    );
    if (backRankMate) {
      mechanisms.push({
        kind: 'BACK_RANK_MATE',
        details: { backRankMate },
      });
      if (addFinding(findings, findingIdentities, state, {
        key: 'back-rank-threat-p' + creatingPly.plyNumber + '-r' + ply.plyNumber,
        type: 'BACK_RANK_THREAT',
        source: {
          startPly: creatingPly.plyNumber,
          endPly: ply.plyNumber,
          positionId: ply.beforePositionId,
        },
        measurements: measurements(ply, before, after),
        details: {
          creatingMoveUci: creatingPly.moveUci,
          defensiveMoveUci: bestMove,
          playedResponseUci: ply.moveUci,
          matingReplyUci: opponentBestReply,
          backRankMate,
        },
      })) {
        backRankCount += 1;
      }
    }

    const opponentHadMateBeforeResponse = favorableMate(
      before.analysis.mateWhite,
      opponentColor,
    );
    const opponentHasMateAfterResponse = favorableMate(
      after.analysis.mateWhite,
      opponentColor,
    );
    if (
      !opponentHadMateBeforeResponse
      && (opponentHasMateAfterResponse || replyFact.givesCheckmate)
    ) {
      mechanisms.push({
        kind: 'MATING_THREAT',
        details: {
          mateWhiteAfterResponse: after.analysis.mateWhite,
          immediateMateReply: replyFact.givesCheckmate,
        },
      });
    }

    if (mechanisms.length === 0) continue;

    if (addFinding(findings, findingIdentities, state, {
      key: 'threat-blindness-p' + creatingPly.plyNumber + '-r' + ply.plyNumber,
      type: 'THREAT_BLINDNESS',
      source: {
        startPly: creatingPly.plyNumber,
        endPly: ply.plyNumber,
        positionId: ply.beforePositionId,
      },
      measurements: {
        ...measurements(ply, before, after),
        mechanismCount: mechanisms.length,
      },
      details: {
        creatingOpponentPly: creatingPly.plyNumber,
        creatingMoveUci: creatingPly.moveUci,
        creatingMoveWasCapture: creatingMoveFact.capturedPiece !== null,
        creatingMoveGaveCheck: creatingMoveFact.givesCheck,
        responsePly: ply.plyNumber,
        playedResponseUci: ply.moveUci,
        defensiveMoveUci: bestMove,
        defensivePv: defensiveLine.pv,
        exploitingReplyUci: opponentBestReply,
        mechanisms,
        detectorPolicy: {
          minScoreLossCp: DEFENSIVE_THREAT_MIN_SCORE_LOSS_CP,
          requiresConcreteMechanism: true,
          requiresEngineDefensiveAlternative: true,
          requiresEngineExploitation: true,
        },
      },
    })) {
      threatBlindnessCount += 1;
    }
  }

  const incompletePlies = [...new Set([
    ...boardGapPlies,
    ...analysisGapPlies,
    ...multiPvGapPlies,
  ])].sort((left, right) => left - right);
  const hasCoverageGap = incompletePlies.length > 0;
  const coverageGapReason = boardGapPlies.length > 0
    ? 'required-board-or-engine-evidence-missing'
    : multiPvGapPlies.length > 0
      ? 'required-multipv-evidence-missing'
      : 'required-engine-evidence-missing';

  if (hasCoverageGap) {
    const firstPlyNumber = incompletePlies[0];
    const sourcePly = plies.find((ply) => ply.plyNumber === firstPlyNumber);
    findings.push({
      key: 'defensive-threat-coverage-gap',
      type: 'DEFENSIVE_THREAT_COVERAGE_GAP',
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
        multiPvGapCount: multiPvGapPlies.length,
      },
      details: {
        incompletePlies: incompletePlies.slice(0, 32),
        minScoreLossCp: DEFENSIVE_THREAT_MIN_SCORE_LOSS_CP,
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
          ? 'defensive-threat-finding-limit-reached'
          : null,
      details: {
        analysedUserPlies,
        threatBlindnessCount,
        defenderRemovalCount,
        overloadCount,
        backRankCount,
        missedMateCount,
        minScoreLossCp: DEFENSIVE_THREAT_MIN_SCORE_LOSS_CP,
        findingLimit: MAX_DEFENSIVE_THREAT_FINDINGS,
        findingsTruncated: state.truncated,
      },
    },
    findings,
  };
}

export const defensiveThreatEvidenceDetector: EvidenceDetector = {
  key: DEFENSIVE_THREAT_EVIDENCE_DETECTOR_KEY,
  version: DEFENSIVE_THREAT_EVIDENCE_DETECTOR_VERSION,
  requiresCompleteAnalysis: true,
  detect: detectDefensiveThreatEvidence,
};
