import { Prisma } from '@prisma/client';

// Alias contract: the owned ImportedGame table is named game. Prisma DateTime
// columns store UTC as timestamp(3) without time zone. Raw Date parameters are
// timestamptz, whose implicit comparison would apply the database session zone.
export function diagnosisScopeSql(
  appUserId: number,
  scope: { from?: Date; to?: Date },
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`game."appUserId" = ${appUserId}`];
  if (scope.from) conditions.push(Prisma.sql`game."startedAt" >= ${scope.from.toISOString()}::timestamp(3)`);
  if (scope.to) conditions.push(Prisma.sql`game."startedAt" < ${scope.to.toISOString()}::timestamp(3)`);
  return Prisma.join(conditions, ' AND ');
}
