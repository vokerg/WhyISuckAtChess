# positions module

Owns provider-neutral reusable position identity.

Normalized FEN uses the first four canonical FEN fields (board, side to move, castling rights, en-passant state). `position-key.ts` derives a 16-byte SHA-256 prefix and every persistence resolution verifies the stored normalized FEN against the expected FEN so a hash collision or inconsistent mapping fails visibly.

Game-specific clocks, timing, provider metadata, and later engine classifications do not belong on `Position`.
