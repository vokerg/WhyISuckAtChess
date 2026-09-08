# lichess module seam

Issue #10 implements the single authoritative Lichess connection boundary.

## Reference

Adapted from CRT at `13a7e2791944ebd52113afe9f76413b10634ddff`, especially `lichessConnectionService.ts`, `lichessAuth.ts`, `oauthTokenCrypto.ts`, and their OAuth tests.

## Preserve

- OAuth authorization-code flow with PKCE;
- short-lived state and callback identity lookup from the authenticated Lichess token;
- AES-256-GCM token encryption at rest;
- safe status contracts with no token material;
- best-effort upstream revoke followed by authoritative local disconnect.

## Why-specific changes

- one connection per `AppUser` and one application owner per Lichess user ID;
- OAuth state is consumed exactly once before token exchange, including cancellation/error callbacks;
- no puzzle scopes or unrelated broad OAuth scopes are requested;
- no arbitrary public/tracked account model and no anonymous credential fallback;
- expired, locally revoked, and undecryptable credentials are explicit reconnect-required states;
- disconnect still removes local authority when the token cannot be decrypted or revoked;
- reconnect/replacement may replace the current user's Lichess identity, but cannot claim an identity owned by another app user;
- replacement is serialized per app user so concurrent callbacks observe and revoke the credential they actually replace;
- every stored credential has an immutable generation ID; disconnect and provider-revocation writes are conditional on that generation so stale work cannot delete or revoke a newer reconnect.

## Import seam

Later import code must call `getCredentialForUser(appUserId)` and receive only the connected Lichess ID, username, usable access token, expiry, and opaque `credentialGeneration`. It must not query `LichessConnection` or OAuth state persistence directly. Provider `401/403` handling must pass that generation back to `markCredentialRevokedForUser(appUserId, credentialGeneration)`; the update is ignored when a reconnect has already installed a newer credential generation.
