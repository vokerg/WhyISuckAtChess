export class InvalidImportedGameCursorError extends Error {
  constructor() {
    super('Invalid imported-games cursor');
    this.name = 'InvalidImportedGameCursorError';
  }
}
