import type { PrismaClient } from '@prisma/client';
import prisma from '../prisma';
import type { RequestAuth } from './request-auth';

export interface ExternalIdentity {
  provider: string;
  externalSubject: string;
  email?: string;
  displayName?: string;
}

export function createCurrentAppUserService(database: PrismaClient = prisma) {
  const resolveExternalUser = async (identity: ExternalIdentity) => database.$transaction(async (transaction) => {
    const user = await transaction.appUser.upsert({
      where: {
        authProvider_authSubject: {
          authProvider: identity.provider,
          authSubject: identity.externalSubject,
        },
      },
      update: {
        email: identity.email,
        displayName: identity.displayName,
      },
      create: {
        authProvider: identity.provider,
        authSubject: identity.externalSubject,
        email: identity.email,
        displayName: identity.displayName,
      },
    });

    return {
      user,
      auth: {
        userId: user.id,
        provider: identity.provider,
        externalSubject: identity.externalSubject,
        ...(identity.email ? { email: identity.email } : {}),
      } satisfies RequestAuth,
    };
  });

  return {
    resolveExternalUser,
    resolveDevUser: () => resolveExternalUser({
      provider: 'dev',
      externalSubject: 'dev-single-user',
      displayName: 'Local user',
    }),
    getById: (userId: number) => database.appUser.findUniqueOrThrow({ where: { id: userId } }),
  };
}

export type CurrentAppUserService = ReturnType<typeof createCurrentAppUserService>;
export const currentAppUserService = createCurrentAppUserService();
