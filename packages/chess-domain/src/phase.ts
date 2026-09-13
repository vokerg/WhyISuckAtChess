import { Chess, type Square } from 'chess.js';

export const POSITION_PHASE_CLASSIFIER_VERSION = 'phase-v1';

export type PositionPhase =
  | 'OPENING'
  | 'MIDDLEGAME'
  | 'ENDGAME'
  | 'UNKNOWN';

export type EndgameFamily =
  | 'NONE'
  | 'PAWN'
  | 'ROOK'
  | 'QUEEN'
  | 'MINOR_PIECE'
  | 'BISHOP_VS_KNIGHT'
  | 'OPPOSITE_COLORED_BISHOPS'
  | 'SAME_COLORED_BISHOPS'
  | 'ROOK_AND_MINOR'
  | 'MIXED_PIECE'
  | 'UNKNOWN';

export interface PositionPhaseMeasurements {
  pawnCount: number;
  majorMinorPieceCount: number;
  phaseUnits: number;
  queenCount: number;
  rookCount: number;
  bishopCount: number;
  knightCount: number;
  homeDevelopmentPieceCount: number;
}

export interface PositionPhaseClassification {
  phase: PositionPhase;
  endgameFamily: EndgameFamily;
  measurements: PositionPhaseMeasurements | null;
}

interface BoardFacts extends PositionPhaseMeasurements {
  white: Record<'n' | 'b' | 'r' | 'q', number>;
  black: Record<'n' | 'b' | 'r' | 'q', number>;
  whiteBishopSquares: Square[];
  blackBishopSquares: Square[];
}

const PHASE_UNIT_VALUE: Readonly<Record<'n' | 'b' | 'r' | 'q', number>> = {
  n: 1,
  b: 1,
  r: 2,
  q: 4,
};

const HOME_DEVELOPMENT_PIECES: ReadonlyArray<{
  square: Square;
  color: 'w' | 'b';
  type: 'n' | 'b' | 'q';
}> = [
  { square: 'b1', color: 'w', type: 'n' },
  { square: 'c1', color: 'w', type: 'b' },
  { square: 'd1', color: 'w', type: 'q' },
  { square: 'f1', color: 'w', type: 'b' },
  { square: 'g1', color: 'w', type: 'n' },
  { square: 'b8', color: 'b', type: 'n' },
  { square: 'c8', color: 'b', type: 'b' },
  { square: 'd8', color: 'b', type: 'q' },
  { square: 'f8', color: 'b', type: 'b' },
  { square: 'g8', color: 'b', type: 'n' },
];

function completeFen(fen: string): string {
  const fields = fen.trim().split(/\s+/);
  if (fields.length === 4) return fields.join(' ') + ' 0 1';
  return fen;
}

function squareAt(row: number, column: number): Square {
  const file = String.fromCharCode('a'.charCodeAt(0) + column);
  const rank = String(8 - row);
  return (file + rank) as Square;
}

function emptyPieceCounts(): Record<'n' | 'b' | 'r' | 'q', number> {
  return { n: 0, b: 0, r: 0, q: 0 };
}

function boardFacts(fen: string): BoardFacts | null {
  try {
    const chess = new Chess(completeFen(fen));
    const white = emptyPieceCounts();
    const black = emptyPieceCounts();
    const whiteBishopSquares: Square[] = [];
    const blackBishopSquares: Square[] = [];
    let pawnCount = 0;

    const board = chess.board();
    for (let row = 0; row < board.length; row += 1) {
      for (let column = 0; column < board[row].length; column += 1) {
        const piece = board[row][column];
        if (!piece || piece.type === 'k') continue;
        if (piece.type === 'p') {
          pawnCount += 1;
          continue;
        }

        const counts = piece.color === 'w' ? white : black;
        const type = piece.type as keyof typeof counts;
        counts[type] += 1;
        if (piece.type === 'b') {
          const target = piece.color === 'w'
            ? whiteBishopSquares
            : blackBishopSquares;
          target.push(squareAt(row, column));
        }
      }
    }

    const queenCount = white.q + black.q;
    const rookCount = white.r + black.r;
    const bishopCount = white.b + black.b;
    const knightCount = white.n + black.n;
    const majorMinorPieceCount = queenCount + rookCount + bishopCount + knightCount;
    const phaseUnits = (
      queenCount * PHASE_UNIT_VALUE.q
      + rookCount * PHASE_UNIT_VALUE.r
      + bishopCount * PHASE_UNIT_VALUE.b
      + knightCount * PHASE_UNIT_VALUE.n
    );
    const homeDevelopmentPieceCount = HOME_DEVELOPMENT_PIECES.filter((home) => {
      const piece = chess.get(home.square);
      return piece?.color === home.color && piece.type === home.type;
    }).length;

    return {
      pawnCount,
      majorMinorPieceCount,
      phaseUnits,
      queenCount,
      rookCount,
      bishopCount,
      knightCount,
      homeDevelopmentPieceCount,
      white,
      black,
      whiteBishopSquares,
      blackBishopSquares,
    };
  } catch {
    return null;
  }
}

function squareColor(square: Square): 0 | 1 {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(square[1]) - 1;
  return ((file + rank) % 2) as 0 | 1;
}

function endgameFamilyFromFacts(facts: BoardFacts): EndgameFamily {
  const minors = facts.bishopCount + facts.knightCount;

  if (facts.majorMinorPieceCount === 0) {
    return facts.pawnCount > 0 ? 'PAWN' : 'UNKNOWN';
  }

  if (facts.queenCount === 0 && facts.rookCount === 0) {
    const bishopVsKnight = (
      facts.white.b > 0
      && facts.white.n === 0
      && facts.black.n > 0
      && facts.black.b === 0
    ) || (
      facts.black.b > 0
      && facts.black.n === 0
      && facts.white.n > 0
      && facts.white.b === 0
    );
    if (bishopVsKnight) return 'BISHOP_VS_KNIGHT';

    if (
      facts.bishopCount === 2
      && facts.knightCount === 0
      && facts.whiteBishopSquares.length === 1
      && facts.blackBishopSquares.length === 1
    ) {
      return squareColor(facts.whiteBishopSquares[0])
        === squareColor(facts.blackBishopSquares[0])
        ? 'SAME_COLORED_BISHOPS'
        : 'OPPOSITE_COLORED_BISHOPS';
    }
    return 'MINOR_PIECE';
  }

  if (facts.queenCount > 0 && facts.rookCount === 0) return 'QUEEN';
  if (facts.rookCount > 0 && facts.queenCount === 0 && minors === 0) return 'ROOK';
  if (facts.rookCount > 0 && facts.queenCount === 0 && minors > 0) {
    return 'ROOK_AND_MINOR';
  }
  return 'MIXED_PIECE';
}

function structuralPhase(facts: BoardFacts): PositionPhase {
  const endgame = (
    facts.majorMinorPieceCount <= 6
    || (facts.queenCount === 0 && facts.phaseUnits <= 10)
  );
  if (endgame) return 'ENDGAME';

  const opening = (
    facts.phaseUnits >= 20
    && facts.pawnCount >= 12
    && facts.homeDevelopmentPieceCount >= 5
  );
  return opening ? 'OPENING' : 'MIDDLEGAME';
}

export function classifyEndgameFamily(fen: string): EndgameFamily {
  const facts = boardFacts(fen);
  return facts ? endgameFamilyFromFacts(facts) : 'UNKNOWN';
}

export function classifyPositionPhase(fen: string): PositionPhaseClassification {
  const facts = boardFacts(fen);
  if (!facts) {
    return {
      phase: 'UNKNOWN',
      endgameFamily: 'UNKNOWN',
      measurements: null,
    };
  }

  const phase = structuralPhase(facts);
  return {
    phase,
    endgameFamily: phase === 'ENDGAME'
      ? endgameFamilyFromFacts(facts)
      : 'NONE',
    measurements: {
      pawnCount: facts.pawnCount,
      majorMinorPieceCount: facts.majorMinorPieceCount,
      phaseUnits: facts.phaseUnits,
      queenCount: facts.queenCount,
      rookCount: facts.rookCount,
      bishopCount: facts.bishopCount,
      knightCount: facts.knightCount,
      homeDevelopmentPieceCount: facts.homeDevelopmentPieceCount,
    },
  };
}

const PHASE_ORDER: Readonly<Record<Exclude<PositionPhase, 'UNKNOWN'>, number>> = {
  OPENING: 0,
  MIDDLEGAME: 1,
  ENDGAME: 2,
};

export function stabilizeGamePhase(
  previous: PositionPhase | null,
  structural: PositionPhase,
): PositionPhase {
  if (structural === 'UNKNOWN') return 'UNKNOWN';
  if (previous === null || previous === 'UNKNOWN') return structural;
  return PHASE_ORDER[structural] >= PHASE_ORDER[previous]
    ? structural
    : previous;
}
