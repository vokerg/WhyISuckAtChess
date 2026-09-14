import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';
import {
  MATERIAL_PIECE_VALUES,
  type MaterialColor,
} from './material';

export type DefensiveTacticalColor = MaterialColor;

export interface LegalMoveFact {
  moveUci: string;
  moverColor: DefensiveTacticalColor;
  from: Square;
  to: Square;
  piece: PieceSymbol;
  capturedPiece: PieceSymbol | null;
  promotion: PieceSymbol | null;
  resultingFen: string;
  givesCheck: boolean;
  givesCheckmate: boolean;
}

export interface DefenderTargetFact {
  square: Square;
  piece: PieceSymbol;
  value: number;
  defendersBefore: Square[];
  defendersAfter: Square[];
  attackersAfter: Square[];
  becameUndefended: boolean;
}

export interface DefenderRemovalFact {
  moveUci: string;
  moverColor: DefensiveTacticalColor;
  removedDefenderSquare: Square;
  removedDefenderPiece: PieceSymbol;
  targets: DefenderTargetFact[];
}

export interface OverloadedDefenderTarget {
  square: Square;
  piece: PieceSymbol;
  value: number;
  attackers: Square[];
}

export interface OverloadedDefenderFact {
  color: DefensiveTacticalColor;
  defenderSquare: Square;
  defenderPiece: PieceSymbol;
  targets: OverloadedDefenderTarget[];
}

export interface BackRankMateFact {
  moveUci: string;
  moverColor: DefensiveTacticalColor;
  matingPiece: PieceSymbol;
  from: Square;
  to: Square;
  kingSquare: Square;
  backRank: 1 | 8;
}

const FILES = 'abcdefgh';

function completeFen(fen: string): string {
  const fields = fen.trim().split(/\s+/);
  if (fields.length === 4) return fields.join(' ') + ' 0 1';
  return fen;
}

function chessFromFen(fen: string): Chess {
  return new Chess(completeFen(fen));
}

function toDomainColor(color: Color): DefensiveTacticalColor {
  return color === 'w' ? 'WHITE' : 'BLACK';
}

function toChessColor(color: DefensiveTacticalColor): Color {
  return color === 'WHITE' ? 'w' : 'b';
}

function oppositeChessColor(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

function pieceValue(piece: PieceSymbol): number {
  if (piece === 'k') return 100;
  return MATERIAL_PIECE_VALUES[piece];
}

function allSquares(): Square[] {
  const squares: Square[] = [];
  for (const file of FILES) {
    for (let rank = 1; rank <= 8; rank += 1) {
      squares.push((file + rank) as Square);
    }
  }
  return squares;
}

const BOARD_SQUARES = allSquares();

function parsedUci(uci: string): {
  from: Square;
  to: Square;
  promotion: PieceSymbol | undefined;
} | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci.length === 5 ? uci[4] as PieceSymbol : undefined,
  };
}

function legalMove(chess: Chess, uci: string) {
  const parsed = parsedUci(uci);
  if (!parsed) return null;
  return chess.moves({ verbose: true }).find((candidate) => (
    candidate.from === parsed.from
    && candidate.to === parsed.to
    && (candidate.promotion ?? undefined) === parsed.promotion
  )) ?? null;
}

function sortedSquares(squares: Square[]): Square[] {
  return [...squares].sort((left, right) => left.localeCompare(right));
}

function findKingSquare(chess: Chess, color: Color): Square | null {
  for (const square of BOARD_SQUARES) {
    const piece = chess.get(square);
    if (piece?.color === color && piece.type === 'k') return square;
  }
  return null;
}

export function inspectLegalUciMove(
  fen: string,
  uci: string,
): LegalMoveFact | null {
  const chess = chessFromFen(fen);
  const move = legalMove(chess, uci);
  if (!move) return null;

  chess.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion,
  });

  return {
    moveUci: uci,
    moverColor: toDomainColor(move.color),
    from: move.from,
    to: move.to,
    piece: move.piece,
    capturedPiece: move.captured ?? null,
    promotion: move.promotion ?? null,
    resultingFen: chess.fen(),
    givesCheck: chess.isCheck(),
    givesCheckmate: chess.isCheckmate(),
  };
}

export function detectDefenderRemovalCreatedByMove(
  fen: string,
  uci: string,
): DefenderRemovalFact | null {
  const before = chessFromFen(fen);
  const move = legalMove(before, uci);
  if (!move || !move.captured) return null;

  const moverColor = move.color;
  const defendedColor = oppositeChessColor(moverColor);
  const removedDefender = before.get(move.to);
  if (!removedDefender || removedDefender.color !== defendedColor) return null;

  const candidateTargets = BOARD_SQUARES.flatMap((square) => {
    if (square === move.to) return [];
    const piece = before.get(square);
    if (!piece || piece.color !== defendedColor || piece.type === 'k') return [];
    const defendersBefore = before.attackers(square, defendedColor);
    if (!defendersBefore.includes(move.to)) return [];
    if (before.attackers(square, moverColor).length === 0) return [];
    return [{ square, piece, defendersBefore }];
  });

  before.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion,
  });

  const targets: DefenderTargetFact[] = [];
  for (const candidate of candidateTargets) {
    const remaining = before.get(candidate.square);
    if (
      !remaining
      || remaining.color !== defendedColor
      || remaining.type !== candidate.piece.type
    ) {
      continue;
    }

    const attackersAfter = before.attackers(candidate.square, moverColor);
    if (attackersAfter.length === 0) continue;
    const defendersAfter = before.attackers(candidate.square, defendedColor);
    if (defendersAfter.length >= candidate.defendersBefore.length) continue;

    targets.push({
      square: candidate.square,
      piece: remaining.type,
      value: pieceValue(remaining.type),
      defendersBefore: sortedSquares(candidate.defendersBefore),
      defendersAfter: sortedSquares(defendersAfter),
      attackersAfter: sortedSquares(attackersAfter),
      becameUndefended: defendersAfter.length === 0,
    });
  }

  if (targets.length === 0) return null;
  targets.sort((left, right) => left.square.localeCompare(right.square));

  return {
    moveUci: uci,
    moverColor: toDomainColor(moverColor),
    removedDefenderSquare: move.to,
    removedDefenderPiece: removedDefender.type,
    targets,
  };
}

export function detectOverloadedDefenders(
  fen: string,
  color: DefensiveTacticalColor,
): OverloadedDefenderFact[] {
  const chess = chessFromFen(fen);
  const chessColor = toChessColor(color);
  const enemyColor = oppositeChessColor(chessColor);
  const results: OverloadedDefenderFact[] = [];

  for (const defenderSquare of BOARD_SQUARES) {
    const defender = chess.get(defenderSquare);
    if (
      !defender
      || defender.color !== chessColor
      || defender.type === 'k'
    ) {
      continue;
    }

    const targets: OverloadedDefenderTarget[] = [];
    for (const targetSquare of BOARD_SQUARES) {
      if (targetSquare === defenderSquare) continue;
      const target = chess.get(targetSquare);
      if (
        !target
        || target.color !== chessColor
        || target.type === 'k'
      ) {
        continue;
      }

      const attackers = chess.attackers(targetSquare, enemyColor);
      if (attackers.length === 0) continue;
      const defenders = chess.attackers(targetSquare, chessColor);
      if (!defenders.includes(defenderSquare)) continue;

      targets.push({
        square: targetSquare,
        piece: target.type,
        value: pieceValue(target.type),
        attackers: sortedSquares(attackers),
      });
    }

    if (targets.length < 2) continue;
    targets.sort((left, right) => left.square.localeCompare(right.square));
    results.push({
      color,
      defenderSquare,
      defenderPiece: defender.type,
      targets,
    });
  }

  return results.sort(
    (left, right) => left.defenderSquare.localeCompare(right.defenderSquare),
  );
}

export function detectBackRankMateByMove(
  fen: string,
  uci: string,
): BackRankMateFact | null {
  const before = chessFromFen(fen);
  const move = legalMove(before, uci);
  if (!move || (move.piece !== 'r' && move.piece !== 'q')) return null;

  const defendingColor = oppositeChessColor(move.color);
  before.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion,
  });
  if (!before.isCheckmate()) return null;

  const kingSquare = findKingSquare(before, defendingColor);
  if (!kingSquare) return null;
  const backRank = defendingColor === 'w' ? 1 : 8;
  if (Number(kingSquare[1]) !== backRank) return null;
  if (Number(move.to[1]) !== backRank) return null;
  if (!before.attackers(kingSquare, move.color).includes(move.to)) return null;

  return {
    moveUci: uci,
    moverColor: toDomainColor(move.color),
    matingPiece: move.piece,
    from: move.from,
    to: move.to,
    kingSquare,
    backRank,
  };
}
