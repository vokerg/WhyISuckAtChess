export type ChessColor = 'WHITE' | 'BLACK';

export function activeColorFromFen(fen: string): 'w' | 'b' {
  return fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w';
}

export function scoreFromSideToMoveToWhite(
  value: number | null | undefined,
  fenOrActiveColor: string | 'w' | 'b',
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const activeColor = fenOrActiveColor === 'w' || fenOrActiveColor === 'b'
    ? fenOrActiveColor
    : activeColorFromFen(fenOrActiveColor);
  return activeColor === 'b' ? -value : value;
}

export function effectiveScoreCpWhite(
  scoreCpWhite: number | null | undefined,
  mateWhite: number | null | undefined,
): number | null {
  if (typeof scoreCpWhite === 'number' && Number.isFinite(scoreCpWhite)) {
    return Math.max(-32_000, Math.min(32_000, Math.round(scoreCpWhite)));
  }
  if (typeof mateWhite !== 'number' || !Number.isFinite(mateWhite)) return null;
  return mateWhite >= 0 ? 1_000 : -1_000;
}

export function scoreLossForSide(
  bestCpWhite: number | null | undefined,
  playedCpWhite: number | null | undefined,
  side: ChessColor,
): number | null {
  if (
    typeof bestCpWhite !== 'number'
    || !Number.isFinite(bestCpWhite)
    || typeof playedCpWhite !== 'number'
    || !Number.isFinite(playedCpWhite)
  ) {
    return null;
  }
  const rawLoss = side === 'WHITE'
    ? bestCpWhite - playedCpWhite
    : playedCpWhite - bestCpWhite;
  return Math.max(0, Math.min(32_000, Math.round(rawLoss)));
}
