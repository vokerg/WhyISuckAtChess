export type AuthConfig = DevSingleUserAuthConfig | ClerkAuthConfig;

export interface DevSingleUserAuthConfig {
  mode: 'dev-single-user';
}

export interface ClerkAuthConfig {
  mode: 'clerk';
  issuer: string;
  jwksUrl: URL;
  audience?: string;
  authorizedParties: string[];
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when AUTH_MODE=clerk`);
  return value;
}

export function loadAuthConfig(): AuthConfig {
  const mode = process.env['AUTH_MODE']?.trim();

  if (!mode) {
    throw new Error('AUTH_MODE is required; expected dev-single-user or clerk');
  }

  if (mode === 'dev-single-user') {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('AUTH_MODE=dev-single-user is not allowed when NODE_ENV=production');
    }
    return { mode };
  }

  if (mode === 'clerk') {
    const issuer = requiredEnv('CLERK_JWT_ISSUER');
    const jwksUrlValue = requiredEnv('CLERK_JWKS_URL');
    let jwksUrl: URL;
    try {
      jwksUrl = new URL(jwksUrlValue);
    } catch {
      throw new Error('CLERK_JWKS_URL must be a valid URL');
    }

    const authorizedParties = requiredEnv('CLERK_AUTHORIZED_PARTIES')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (authorizedParties.length === 0) {
      throw new Error('CLERK_AUTHORIZED_PARTIES must contain at least one origin');
    }

    return {
      mode,
      issuer,
      jwksUrl,
      audience: process.env['CLERK_JWT_AUDIENCE']?.trim() || undefined,
      authorizedParties,
    };
  }

  throw new Error(`Unsupported AUTH_MODE "${mode}"; expected dev-single-user or clerk`);
}
