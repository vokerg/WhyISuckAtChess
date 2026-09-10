import { Chess } from 'chess.js';
import { normalizeFenForPosition } from './position';

export type ChessColor = 'WHITE' | 'BLACK';

export interface ReconstructedPly {
  plyNumber: number;
  moverColor: ChessColor;
  moveUci: string;
  beforeFen: string;
  afterFen: string;
  beforeNormalizedFen: string;
  afterNormalizedFen: string;
}

function toUci(move: { from: string; to: string; promotion?: string }): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

export function reconstructPgnPlies(pgn: string): ReconstructedPly[] {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    throw new Error('Could not parse imported game PGN');
  }

  const history = chess.history({ verbose: true }) as Array<{
    from: string;
    to: string;
    promotion?: string;
    before?: string;
    after?: string;
  }>;

  return history.map((move, index) => {
    if (!move.before || !move.after) {
      throw new Error('Could not reconstruct move positions from imported game PGN');
    }

    return {
      plyNumber: index + 1,
      moverColor: index % 2 === 0 ? 'WHITE' : 'BLACK',
      moveUci: toUci(move),
      beforeFen: move.before,
      afterFen: move.after,
      beforeNormalizedFen: normalizeFenForPosition(move.before),
      afterNormalizedFen: normalizeFenForPosition(move.after),
    };
  });
}

export function fenTurnColor(fen: string): ChessColor {
  const turn = fen.trim().split(/\s+/)[1];
  if (turn === 'w') return 'WHITE';
  if (turn === 'b') return 'BLACK';
  throw new Error(`Could not determine side to move from FEN: ${fen}`);
}
