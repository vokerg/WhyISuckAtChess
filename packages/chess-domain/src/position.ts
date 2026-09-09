import { Chess } from 'chess.js';

/**
 * Provider-neutral position identity. Move counters are deliberately excluded;
 * board, side to move, castling rights, and en-passant state remain material.
 */
export function normalizeFenForPosition(fen: string): string {
  const chess = fen === 'startpos' ? new Chess() : new Chess(fen);
  return chess.fen().split(/\s+/).slice(0, 4).join(' ');
}
