export enum MoveClassificationCode {
  Book = 1,
  Best = 2,
  Good = 3,
  Inaccuracy = 4,
  Mistake = 5,
  Blunder = 6,
  MissedOpportunity = 7,
  Brilliant = 8,
  Forced = 9,
}

export function moveClassificationLabel(code: number | null | undefined): string {
  switch (code) {
    case MoveClassificationCode.Book:
      return 'Book';
    case MoveClassificationCode.Best:
      return 'Best';
    case MoveClassificationCode.Good:
      return 'Good';
    case MoveClassificationCode.Inaccuracy:
      return 'Inaccuracy';
    case MoveClassificationCode.Mistake:
      return 'Mistake';
    case MoveClassificationCode.Blunder:
      return 'Blunder';
    case MoveClassificationCode.MissedOpportunity:
      return 'Missed opportunity';
    case MoveClassificationCode.Brilliant:
      return 'Brilliant';
    case MoveClassificationCode.Forced:
      return 'Forced';
    default:
      return 'Not analysed';
  }
}

export function classifyPly(input: {
  moveUci: string;
  bestMoveUci?: string | null;
  scoreLossCp: number | null | undefined;
  isBook?: boolean;
  isForced?: boolean;
  isBrilliantCandidate?: boolean;
}): MoveClassificationCode | null {
  if (input.isBook) return MoveClassificationCode.Book;
  if (input.isBrilliantCandidate) return MoveClassificationCode.Brilliant;
  if (input.isForced) return MoveClassificationCode.Forced;
  if (input.scoreLossCp === null || input.scoreLossCp === undefined) return null;
  if (input.moveUci === input.bestMoveUci || input.scoreLossCp === 0) {
    return MoveClassificationCode.Best;
  }
  if (input.scoreLossCp < 30) return MoveClassificationCode.Good;
  if (input.scoreLossCp < 80) return MoveClassificationCode.Inaccuracy;
  if (input.scoreLossCp < 180) return MoveClassificationCode.Mistake;
  return MoveClassificationCode.Blunder;
}
