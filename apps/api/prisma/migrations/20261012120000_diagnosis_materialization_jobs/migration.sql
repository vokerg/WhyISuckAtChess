CREATE TABLE "DiagnosisMaterializationJob" (
 "id" SERIAL PRIMARY KEY,
 "appUserId" INTEGER NOT NULL REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "scopeKey" VARCHAR(128) NOT NULL DEFAULT 'overall',
 "sourceKey" VARCHAR(64) NOT NULL,
 "status" VARCHAR(24) NOT NULL DEFAULT 'QUEUED',
 "attempts" INTEGER NOT NULL DEFAULT 0,
 "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "claimToken" VARCHAR(64),
 "heartbeatAt" TIMESTAMP(3),
 "errorCode" VARCHAR(64),
 "findingSetId" INTEGER,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "DiagnosisMaterializationJob_appUserId_scopeKey_key" ON "DiagnosisMaterializationJob"("appUserId", "scopeKey");
CREATE INDEX "DiagnosisMaterializationJob_status_runAfter_idx" ON "DiagnosisMaterializationJob"("status", "runAfter");
