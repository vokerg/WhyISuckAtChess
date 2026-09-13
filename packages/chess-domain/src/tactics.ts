import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';
import {
  MATERIAL_PIECE_VALUES,
  type MaterialColor,
} from './material';

export type TacticalColor = MaterialColor;
export type TacticalMotifType =
  | 'FORK'
  | 'PIN'
  | 'SKEWER'
  | 'DISCOVERED_ATTACK';

export interface TacticalTarget {
  square: Square;
  piece: PieceSymbol;
  value: number;
}

export interface TacticalMotif {
  type: TacticalMotifType;
  color: TacticalColor;
  attackerSquare: Square;
  attackerPiece: PieceSymbol;
  targets: TacticalTarget[];
  line?: Square[];
  revealedBy?: {
    from: Square;
    to: Square;
    piece: PieceSymbol;
  };
}

export interface TacticalMoveMotifs {
  moveUci: string;
  moverColor: TacticalColor;
  resultingFen: string;
  motifs: TacticalMotif[];
}

const FILES = 'abcdefgh';
const ORTHOGONAL_DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const DIAGONAL_DIRECTIONS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

function completeFen(fen: string): string {
  const fields = fen.trim().split(/\s+/);
  if (fields.length === 4) return fields.join(' ') + ' 0 1';
  return fen;
}

function chessFromFen(fen: string): Chess {
  return new Chess(completeFen(fen));
}

function toTacticalColor(color: Color): TacticalColor {
  return color === 'w' ? 'WHITE' : 'BLACK';
}

function toChessColor(color: TacticalColor): Color {
  return color === 'WHITE' ? 'w' : 'b';
}

export function oppositeTacticalColor(color: TacticalColor): TacticalColor {
  return color === 'WHITE' ? 'BLACK' : 'WHITE';
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

function coordinates(square: Square): [number, number] {
  return [FILES.indexOf(square[0]), Number(square[1]) - 1];
}

function squareAt(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return (FILES[file] + String(rank + 1)) as Square;
}

function sliderDirections(piece: PieceSymbol) {
  if (piece === 'b') return DIAGONAL_DIRECTIONS;
  if (piece === 'r') return ORTHOGONAL_DIRECTIONS;
  if (piece === 'q') {
    return [...ORTHOGONAL_DIRECTIONS, ...DIAGONAL_DIRECTIONS] as const;
  }
  return [] as const;
}

function target(square: Square, piece: PieceSymbol): TacticalTarget {
  return { square, piece, value: pieceValue(piece) };
}

function sortedTargets(targets: TacticalTarget[]): TacticalTarget[] {
  return [...targets].sort((left, right) => left.square.localeCompare(right.square));
}

export function tacticalMotifIdentity(motif: TacticalMotif): string {
  return [
    motif.type,
    motif.color,
    motif.attackerSquare,
    motif.targets.map((entry) => entry.square).sort().join(','),
    motif.revealedBy?.from ?? '',
    motif.revealedBy?.to ?? '',
  ].join('|');
}

function dedupeMotifs(motifs: TacticalMotif[]): TacticalMotif[] {
  const byIdentity = new Map<string, TacticalMotif>();
  for (const motif of motifs) {
    byIdentity.set(tacticalMotifIdentity(motif), motif);
  }
  return [...byIdentity.values()].sort(
    (left, right) => tacticalMotifIdentity(left).localeCompare(tacticalMotifIdentity(right)),
  );
}

function forkMotifs(chess: Chess, color: TacticalColor): TacticalMotif[] {
  const chessColor = toChessColor(color);
  const enemyColor = chessColor === 'w' ? 'b' : 'w';
  const enemies = BOARD_SQUARES.flatMap((square) => {
    const piece = chess.get(square);
    return piece?.color === enemyColor ? [{ square, piece }] : [];
  });
  const motifs: TacticalMotif[] = [];

  for (const attackerSquare of BOARD_SQUARES) {
    const attacker = chess.get(attackerSquare);
    if (!attacker || attacker.color !== chessColor) continue;

    const targets = enemies.flatMap(({ square, piece }) => (
      chess.attackers(square, chessColor).includes(attackerSquare)
        ? [target(square, piece.type)]
        : []
    ));
    if (targets.length < 2) continue;

    motifs.push({
      type: 'FORK',
      color,
      attackerSquare,
      attackerPiece: attacker.type,
      targets: sortedTargets(targets),
    });
  }

  return motifs;
}

function rayMotifs(chess: Chess, color: TacticalColor): TacticalMotif[] {
  const chessColor = toChessColor(color);
  const motifs: TacticalMotif[] = [];

  for (const attackerSquare of BOARD_SQUARES) {
    const attacker = chess.get(attackerSquare);
    if (!attacker || attacker.color !== chessColor) continue;
    const directions = sliderDirections(attacker.type);
    if (directions.length === 0) continue;
    const [startFile, startRank] = coordinates(attackerSquare);

    for (const [fileDelta, rankDelta] of directions) {
      const occupied: Array<{
        square: Square;
        piece: NonNullable<ReturnType<Chess['get']>>;
      }> = [];
      const line: Square[] = [attackerSquare];

      for (let distance = 1; distance <= 7; distance += 1) {
        const square = squareAt(
          startFile + fileDelta * distance,
          startRank + rankDelta * distance,
        );
        if (!square) break;
        line.push(square);
        const piece = chess.get(square);
        if (!piece) continue;
        occupied.push({ square, piece });
        if (occupied.length === 2) break;
        if (piece.color === chessColor) break;
      }

      if (occupied.length < 2) continue;
      const [front, behind] = occupied;
      if (
        front.piece.color === chessColor
        || behind.piece.color === chessColor
      ) {
        continue;
      }

      if (behind.piece.type === 'k' && front.piece.type !== 'k') {
        motifs.push({
          type: 'PIN',
          color,
          attackerSquare,
          attackerPiece: attacker.type,
          targets: [
            target(front.square, front.piece.type),
            target(behind.square, behind.piece.type),
          ],
          line,
        });
        continue;
      }

      if (pieceValue(front.piece.type) > pieceValue(behind.piece.type)) {
        motifs.push({
          type: 'SKEWER',
          color,
          attackerSquare,
          attackerPiece: attacker.type,
          targets: [
            target(front.square, front.piece.type),
            target(behind.square, behind.piece.type),
          ],
          line,
        });
      }
    }
  }

  return motifs;
}

export function detectTacticalMotifs(
  fen: string,
  color: TacticalColor,
): TacticalMotif[] {
  const chess = chessFromFen(fen);
  return dedupeMotifs([
    ...forkMotifs(chess, color),
    ...rayMotifs(chess, color),
  ]);
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

function isStrictlyBetween(
  start: Square,
  candidate: Square,
  end: Square,
): boolean {
  const [startFile, startRank] = coordinates(start);
  const [candidateFile, candidateRank] = coordinates(candidate);
  const [endFile, endRank] = coordinates(end);
  const fileDistance = endFile - startFile;
  const rankDistance = endRank - startRank;
  const aligned = (
    fileDistance === 0
    || rankDistance === 0
    || Math.abs(fileDistance) === Math.abs(rankDistance)
  );
  if (!aligned) return false;

  const fileStep = Math.sign(fileDistance);
  const rankStep = Math.sign(rankDistance);
  let file = startFile + fileStep;
  let rank = startRank + rankStep;
  while (file !== endFile || rank !== endRank) {
    if (file === candidateFile && rank === candidateRank) return true;
    file += fileStep;
    rank += rankStep;
  }
  return false;
}

function discoveredAttackMotifs(
  before: Chess,
  after: Chess,
  move: {
    from: Square;
    to: Square;
    piece: PieceSymbol;
    color: Color;
  },
): TacticalMotif[] {
  const color = toTacticalColor(move.color);
  const chessColor = move.color;
  const enemyColor = chessColor === 'w' ? 'b' : 'w';
  const motifs: TacticalMotif[] = [];

  for (const targetSquare of BOARD_SQUARES) {
    const targetPiece = after.get(targetSquare);
    if (!targetPiece || targetPiece.color !== enemyColor) continue;

    for (const attackerSquare of after.attackers(targetSquare, chessColor)) {
      if (attackerSquare === move.to) continue;
      const afterAttacker = after.get(attackerSquare);
      const beforeAttacker = before.get(attackerSquare);
      if (
        !afterAttacker
        || !beforeAttacker
        || afterAttacker.color !== chessColor
        || beforeAttacker.color !== chessColor
        || afterAttacker.type !== beforeAttacker.type
        || sliderDirections(afterAttacker.type).length === 0
      ) {
        continue;
      }
      if (before.attackers(targetSquare, chessColor).includes(attackerSquare)) {
        continue;
      }
      if (!isStrictlyBetween(attackerSquare, move.from, targetSquare)) {
        continue;
      }

      motifs.push({
        type: 'DISCOVERED_ATTACK',
        color,
        attackerSquare,
        attackerPiece: afterAttacker.type,
        targets: [target(targetSquare, targetPiece.type)],
        revealedBy: {
          from: move.from,
          to: move.to,
          piece: move.piece,
        },
      });
    }
  }

  return motifs;
}

export function detectTacticalMotifsCreatedByMove(
  fen: string,
  uci: string,
): TacticalMoveMotifs | null {
  const parsed = parsedUci(uci);
  if (!parsed) return null;

  const before = chessFromFen(fen);
  const move = before.moves({ verbose: true }).find((candidate) => (
    candidate.from === parsed.from
    && candidate.to === parsed.to
    && (candidate.promotion ?? undefined) === parsed.promotion
  ));
  if (!move) return null;

  const moverColor = toTacticalColor(move.color);
  const beforeMotifs = new Set(
    detectTacticalMotifs(fen, moverColor).map(tacticalMotifIdentity),
  );
  const beforeForDiscovery = chessFromFen(fen);
  before.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion,
  });
  const resultingFen = before.fen();
  const after = chessFromFen(resultingFen);
  const createdStatic = detectTacticalMotifs(resultingFen, moverColor)
    .filter((motif) => !beforeMotifs.has(tacticalMotifIdentity(motif)));
  const discovered = discoveredAttackMotifs(beforeForDiscovery, after, {
    from: move.from,
    to: move.to,
    piece: move.piece,
    color: move.color,
  });

  return {
    moveUci: uci,
    moverColor,
    resultingFen,
    motifs: dedupeMotifs([...createdStatic, ...discovered]),
  };
}
