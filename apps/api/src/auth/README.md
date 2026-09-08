# auth seam

Issue #10 implements the application-auth boundary here.

## Reference

Adapted from CRT at `13a7e2791944ebd52113afe9f76413b10634ddff`, especially `auth.plugin.ts`, `auth.config.ts`, `current-app-user.service.ts`, and request-auth helpers.

## Preserve

- external authentication subject -> stable internal `AppUser` resolution;
- transactional first-seen user provisioning;
- request-scoped ownership through the internal app-user ID;
- Clerk JWT verification with issuer/audience/authorized-party checks;
- a local single-user mode for development only.

## Why-specific boundary

`auth` knows nothing about Lichess provider semantics. It only resolves the authenticated application user. Production explicitly rejects `dev-single-user`; local/test execution defaults to it when `AUTH_MODE` is unset.

The Lichess module consumes only `request.auth.userId`. No browser-supplied application-user ID is accepted by connection routes.
