import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';

export type MaterialColor = 'WHITE' | 'BLACK';
export type MaterialPiece = Exclude<PieceSymbol, 'k'>;

export const MATERIAL_PIECE_VALUES: Readonly<Record<MaterialPiece, number>> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
};

export interface MaterialInventory {
  white: Record<MaterialPiece, number>;
  black: Record<MaterialPiece, number>;
  whitePoints: number;
  blackPoints: number;
}

export interface LegalMaterialMove {
  uci: string;
  from: Square;
  to: Square;
  moverColor: MaterialColor;
  piece: PieceSymbol;
  capturedPiece: PieceSymbol | null;
  capturedOnTargetSquare: boolean;
  promotion: PieceSymbol | null;
  attackerValue: number;
  capturedValue: number;
  promotionGain: number;
  materialDeltaForMover: number;
  defenderSquares: Square[];
  isFavorableMaterialCapture: boolean;
}

function completeFen(fen: string): string {
  const fields = fen.trim().split(/\s+/);
  if (fields.length === 4) return fields.join(' ') + ' 0 1';
  return fen;
}

function chessFromFen(fen: string): Chess {
  return new Chess(completeFen(fen));
}

function toMaterialColor(color: Color): MaterialColor {
  return color === 'w' ? 'WHITE' : 'BLACK';
}

function toChessColor(color: MaterialColor): Color {
  return color === 'WHITE' ? 'w' : 'b';
}

function opposite(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

function emptyCounts(): Record<MaterialPiece, number> {
  return { p: 0, n: 0, b: 0, r: 0, q: 0 };
}

function pieceValue(piece: PieceSymbol | null | undefined): number {
  if (!piece || piece === 'k') return 0;
  return MATERIAL_PIECE_VALUES[piece];
}

export function materialInventory(fen: string): MaterialInventory {
  const chess = chessFromFen(fen);
  const white = emptyCounts();
  const black = emptyCounts();

  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece || piece.type === 'k') continue;
      const target = piece.color === 'w' ? white : black;
      target[piece.type] += 1;
    }
  }

  const points = (counts: Record<MaterialPiece, number>) => (
    counts.p * MATERIAL_PIECE_VALUES.p
    + counts.n * MATERIAL_PIECE_VALUES.n
    + counts.b * MATERIAL_PIECE_VALUES.b
    + counts.r * MATERIAL_PIECE_VALUES.r
    + counts.q * MATERIAL_PIECE_VALUES.q
  );

  return {
    white,
    black,
    whitePoints: points(white),
    blackPoints: points(black),
  };
}

export function materialBalanceForColor(
  fen: string,
  color: MaterialColor,
): number {
  const inventory = materialInventory(fen);
  return color === 'WHITE'
    ? inventory.whitePoints - inventory.blackPoints
    : inventory.blackPoints - inventory.whitePoints;
}

export function attackersOfSquare(
  fen: string,
  square: Square,
  color: MaterialColor,
): Square[] {
  return chessFromFen(fen).attackers(square, toChessColor(color));
}

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

export function analyseLegalMaterialMove(
  fen: string,
  uci: string,
): LegalMaterialMove | null {
  const parsed = parsedUci(uci);
  if (!parsed) return null;

  const chess = chessFromFen(fen);
  const move = chess.moves({ verbose: true }).find((candidate) => (
    candidate.from === parsed.from
    && candidate.to === parsed.to
    && (candidate.promotion ?? undefined) === parsed.promotion
  ));
  if (!move) return null;

  const beforeBalance = materialBalanceForColor(fen, toMaterialColor(move.color));
  const capturedOnTargetSquare = move.captured !== undefined
    && chess.get(move.to)?.color === opposite(move.color);
  const defenderSquares = capturedOnTargetSquare
    ? chess.attackers(move.to, opposite(move.color))
    : [];
  const attackerValue = pieceValue(move.piece);
  const capturedValue = pieceValue(move.captured);
  const promotionGain = move.promotion
    ? Math.max(0, pieceValue(move.promotion) - MATERIAL_PIECE_VALUES.p)
    : 0;

  chess.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion,
  });
  const moverColor = toMaterialColor(move.color);
  const afterBalance = materialBalanceForColor(chess.fen(), moverColor);
  const materialDeltaForMover = afterBalance - beforeBalance;

  return {
    uci,
    from: move.from,
    to: move.to,
    moverColor,
    piece: move.piece,
    capturedPiece: move.captured ?? null,
    capturedOnTargetSquare,
    promotion: move.promotion ?? null,
    attackerValue,
    capturedValue,
    promotionGain,
    materialDeltaForMover,
    defenderSquares,
    isFavorableMaterialCapture: capturedOnTargetSquare
      && move.captured !== undefined
      && (
        defenderSquares.length === 0
        || capturedValue > attackerValue
      ),
  };
}
