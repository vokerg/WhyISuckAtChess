-- Fence Lichess credential lifecycle mutations so stale work cannot affect a newer reconnect.
ALTER TABLE "LichessConnection"
ADD COLUMN "credentialGeneration" UUID NOT NULL DEFAULT gen_random_uuid();
