import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import prismaModule from '../dist/prisma.js';
import { createPrismaExactTimeControlRepository } from '../dist/modules/diagnosis/exact-time-control-underperformance.repository.prisma.js';
import { createPrismaOpponentStrengthEffectRepository } from '../dist/modules/diagnosis/opponent-strength-effect.repository.prisma.js';

const prisma = prismaModule.default ?? prismaModule;

for (const timeZone of ['UTC', 'Europe/Copenhagen', 'America/New_York']) {
  test(`raw diagnosis scopes match Prisma UTC bounds in ${timeZone}`, async () => {
    // SET LOCAL and every query share one connection; no pool/session defaults
    // are changed, and the test also works against a UTC CI database.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('TimeZone', ${timeZone}, true)`;
      const suffix = randomUUID();
      const owner = await tx.appUser.create({ data: { authProvider: 'TEST', authSubject: `scope-owner-${suffix}` } });
      const other = await tx.appUser.create({ data: { authProvider: 'TEST', authSubject: `scope-other-${suffix}` } });
      try {
        // Both daylight-saving and standard-time dates; include millisecond
        // boundaries so [from, to) semantics cannot pass after a zone shift.
        for (const month of ['01', '07']) {
          const from = new Date(`2026-${month}-19T09:00:00.001Z`);
          const to = new Date(`2026-${month}-19T11:00:00.001Z`);
          const ids = [];
          for (const [appUserId, startedAt] of [
            [owner.id, new Date(from.getTime() - 1)],
            [owner.id, from],
            [owner.id, new Date(from.getTime() + 3_600_000)],
            [owner.id, new Date(to.getTime() - 1)],
            [owner.id, to],
            [owner.id, null],
            [other.id, from],
          ]) {
            const game = await tx.importedGame.create({ data: {
              appUserId, provider: 'LICHESS', providerGameId: randomUUID(),
              connectedLichessUserId: 'fixture', connectedLichessUsername: 'Fixture', startedAt,
            } });
            ids.push(game.id);
          }
          for (const factory of [createPrismaExactTimeControlRepository, createPrismaOpponentStrengthEffectRepository]) {
            const repository = factory(tx, null);
            for (const [scope, expectedIds] of [
              [{ from, to }, ids.slice(1, 4)],
              [{ from }, ids.slice(1, 5)],
              [{ to }, ids.slice(0, 4)],
            ]) {
              // Restrict other months for one-sided scopes by querying before
              // inserting the next month's fixtures, then remove this month.
              assert.equal(await repository.countCandidates(owner.id, scope), expectedIds.length);
              assert.deepEqual((await repository.loadCandidates(owner.id, scope)).map((game) => game.importedGameId), expectedIds);
            }
          }
          await tx.importedGame.deleteMany({ where: { id: { in: ids } } });
        }
      } finally {
        await tx.appUser.deleteMany({ where: { id: { in: [owner.id, other.id] } } });
      }
    }, { timeout: 15_000 });
  });
}
