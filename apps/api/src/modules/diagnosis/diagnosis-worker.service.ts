import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import { loadDiagnosisSourceSnapshot } from './diagnosis-source.repository.prisma';
import { diagnosisTransactionDatabase, materializeDiagnosis } from './diagnosis-materialization.service';

export const DIAGNOSIS_JOB_MAX_ATTEMPTS = 3;
export const DIAGNOSIS_JOB_STALE_MS = 5 * 60_000;
const OWNER_SCAN_LIMIT = 20;

export function createDiagnosisWorkerService(options: {
  database?: typeof prisma;
  now?: () => Date;
  // Bounded owner targeting is useful for operational recovery and acceptance.
  appUserId?: number;
  publish?: typeof materializeDiagnosis;
} = {}): { runOnce(): Promise<boolean> } {
  const database = options.database ?? prisma;
  const now = options.now ?? (() => new Date());
  const publish = options.publish ?? materializeDiagnosis;
  let ownerCursor = 0;
  return {
    async runOnce() {
      const time = now();
      await database.diagnosisMaterializationJob.updateMany({
        where: { status: 'RUNNING', heartbeatAt: { lt: new Date(time.getTime() - DIAGNOSIS_JOB_STALE_MS) } },
        data: { status: 'QUEUED', claimToken: null, heartbeatAt: null, runAfter: time, errorCode: 'STALE_CLAIM_RECOVERED' },
      });
      const owners = await database.appUser.findMany({
        where: options.appUserId ? { id: options.appUserId } : { id: { gt: ownerCursor } },
        orderBy: { id: 'asc' }, take: OWNER_SCAN_LIMIT, select: { id: true },
      });
      ownerCursor = owners.length === 0 ? 0 : owners[owners.length - 1].id;
      for (const owner of owners) {
        const source = await loadDiagnosisSourceSnapshot(owner.id, database);
        const job = await database.diagnosisMaterializationJob.upsert({
          where: { appUserId_scopeKey: { appUserId: owner.id, scopeKey: 'overall' } },
          create: { appUserId: owner.id, sourceKey: source.key, runAfter: time }, update: {},
        });
        if (job.sourceKey !== source.key) {
          await database.diagnosisMaterializationJob.updateMany({
            where: { id: job.id, sourceKey: job.sourceKey },
            data: { sourceKey: source.key, status: 'QUEUED', attempts: 0, runAfter: time, claimToken: null, heartbeatAt: null, errorCode: null, findingSetId: null },
          });
        }
      }
      const job = await database.diagnosisMaterializationJob.findFirst({
        where: { status: 'QUEUED', runAfter: { lte: time }, ...(options.appUserId ? { appUserId: options.appUserId } : {}) },
        orderBy: [{ runAfter: 'asc' }, { id: 'asc' }],
      });
      if (!job) return false;
      const source = await loadDiagnosisSourceSnapshot(job.appUserId, database);
      if (source.pending || source.key !== job.sourceKey) {
        await database.diagnosisMaterializationJob.updateMany({
          where: { id: job.id, sourceKey: job.sourceKey, status: 'QUEUED' },
          data: { runAfter: new Date(time.getTime() + 1000), errorCode: 'SOURCE_PROCESSING' },
        });
        return false;
      }
      if (job.attempts >= DIAGNOSIS_JOB_MAX_ATTEMPTS) {
        await database.diagnosisMaterializationJob.updateMany({
          where: { id: job.id, sourceKey: job.sourceKey, status: 'QUEUED' },
          data: { status: 'FAILED', errorCode: 'ATTEMPTS_EXHAUSTED' },
        });
        return true;
      }
      const claimToken = randomUUID();
      const claimed = await database.diagnosisMaterializationJob.updateMany({
        where: { id: job.id, status: 'QUEUED', sourceKey: source.key, attempts: job.attempts },
        data: { status: 'RUNNING', claimToken, heartbeatAt: time, attempts: { increment: 1 }, errorCode: null },
      });
      if (claimed.count !== 1) return false;
      try {
        await database.$transaction(async (tx) => {
          const claimedJob = await tx.diagnosisMaterializationJob.findFirst({ where: { id: job.id, sourceKey: source.key, claimToken, status: 'RUNNING' } });
          if (!claimedJob) throw new Error('DIAGNOSIS_CLAIM_LOST');
          const current = await loadDiagnosisSourceSnapshot(job.appUserId, tx);
          if (current.key !== source.key || current.pending) throw new Error('DIAGNOSIS_SOURCE_CHANGED');
          const previous = await tx.diagnosisFindingSet.findFirst({ where: { appUserId: job.appUserId, scopeKey: job.scopeKey, isCurrent: true }, orderBy: { id: 'desc' }, select: { calculationAsOf: true } });
          const calculationAsOf = new Date(Math.max(now().getTime(), (source.latestChange?.getTime() ?? 0) + 1, (previous?.calculationAsOf.getTime() ?? 0) + 1));
          const findingSetId = await publish(job.appUserId, current, calculationAsOf, diagnosisTransactionDatabase(tx));
          const completed = await tx.diagnosisMaterializationJob.updateMany({
            where: { id: job.id, sourceKey: source.key, claimToken, status: 'RUNNING' },
            data: { status: 'SUCCEEDED', findingSetId, claimToken: null, heartbeatAt: null, errorCode: null },
          });
          if (completed.count !== 1) throw new Error('DIAGNOSIS_CLAIM_LOST');
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000, maxWait: 5000 });
      } catch (error) {
        const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code :
          error instanceof Error && error.message.startsWith('DIAGNOSIS_') ? error.message : 'PUBLICATION_FAILED';
        await database.diagnosisMaterializationJob.updateMany({
          where: { id: job.id, sourceKey: source.key, claimToken, status: 'RUNNING' },
          data: {
            status: job.attempts + 1 >= DIAGNOSIS_JOB_MAX_ATTEMPTS ? 'FAILED' : 'QUEUED',
            claimToken: null, heartbeatAt: null, errorCode: code,
            runAfter: new Date(now().getTime() + 1000 * 2 ** job.attempts),
          },
        });
        console.error('Diagnosis publication deferred or failed', { appUserId: job.appUserId, code });
      }
      return true;
    },
  };
}
