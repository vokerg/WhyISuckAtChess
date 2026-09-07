-- Application auth identity and authoritative Lichess OAuth connection.
CREATE TABLE "AppUser" (
    "id" SERIAL NOT NULL,
    "authProvider" VARCHAR(32) NOT NULL,
    "authSubject" VARCHAR(255) NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LichessConnection" (
    "id" SERIAL NOT NULL,
    "appUserId" INTEGER NOT NULL,
    "lichessUserId" VARCHAR(64) NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "accessTokenCiphertext" TEXT NOT NULL,
    "accessTokenIv" TEXT NOT NULL,
    "accessTokenAuthTag" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LichessConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OAuthLoginState" (
    "id" SERIAL NOT NULL,
    "appUserId" INTEGER NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "state" VARCHAR(128) NOT NULL,
    "codeVerifier" VARCHAR(256),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "OAuthLoginState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppUser_authProvider_authSubject_key" ON "AppUser"("authProvider", "authSubject");
CREATE UNIQUE INDEX "LichessConnection_appUserId_key" ON "LichessConnection"("appUserId");
CREATE UNIQUE INDEX "LichessConnection_lichessUserId_key" ON "LichessConnection"("lichessUserId");
CREATE INDEX "LichessConnection_username_idx" ON "LichessConnection"("username");
CREATE UNIQUE INDEX "OAuthLoginState_state_key" ON "OAuthLoginState"("state");
CREATE INDEX "OAuthLoginState_appUserId_provider_idx" ON "OAuthLoginState"("appUserId", "provider");
CREATE INDEX "OAuthLoginState_expiresAt_idx" ON "OAuthLoginState"("expiresAt");

ALTER TABLE "LichessConnection" ADD CONSTRAINT "LichessConnection_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OAuthLoginState" ADD CONSTRAINT "OAuthLoginState_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
