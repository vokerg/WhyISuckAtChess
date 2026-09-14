import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import {
  OPENING_EVIDENCE_DETECTOR_KEY,
  OPENING_EVIDENCE_DETECTOR_VERSION,
} from './opening-evidence.detector';
import type {
  OpeningRecurrenceRepository,
  OpeningRecurrenceSample,
} from './opening-recurrence.service';

interface CountRow {
  count: number;
}

interface SampleRow {
  importedGameId: number;
  providerGameId: string;
  userColor: string | null;
  evidenceType: string;
  sourcePlyStart: number | null;
  sourcePositionId: number | null;
  measurements: Prisma.JsonValue;
  details: Prisma.JsonValue;
}

function record(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : null;
}

function stringValue(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: Prisma.JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function countEligibleGames(appUserId: number): Promise<number> {
  const rows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT COUNT(*)::int AS "count"
    FROM "ImportedGame" AS game
    WHERE game."appUserId" = ${appUserId}
      AND game."provider" = 'LICHESS'
      AND game."plyIndexStatus" = 'INDEXED'
      AND game."plyIndexedAt" IS NOT NULL
      AND game."speedCategory" IN ('bullet', 'blitz', 'rapid')
      AND (game."variant" IS NULL OR game."variant" IN ('chess', 'standard'))
      AND EXISTS (
        SELECT 1
        FROM "ImportedGamePly" AS ply
        WHERE ply."importedGameId" = game."id"
      )
  `);
  return rows[0]?.count ?? 0;
}

async function countAnalysedEvidenceGames(appUserId: number): Promise<number> {
  const rows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT COUNT(DISTINCT run."importedGameId")::int AS "count"
    FROM "EvidenceRun" AS run
    JOIN "ImportedGame" AS game
      ON game."id" = run."importedGameId"
    JOIN "GameAnalysisRun" AS analysis
      ON analysis."id" = run."sourceAnalysisRunId"
    WHERE game."appUserId" = ${appUserId}
      AND game."provider" = 'LICHESS'
      AND game."plyIndexStatus" = 'INDEXED'
      AND game."plyIndexedAt" IS NOT NULL
      AND game."speedCategory" IN ('bullet', 'blitz', 'rapid')
      AND (game."variant" IS NULL OR game."variant" IN ('chess', 'standard'))
      AND EXISTS (
        SELECT 1
        FROM "ImportedGamePly" AS ply
        WHERE ply."importedGameId" = game."id"
      )
      AND run."detectorKey" = ${OPENING_EVIDENCE_DETECTOR_KEY}
      AND run."detectorVersion" = ${OPENING_EVIDENCE_DETECTOR_VERSION}
      AND run."status" = 'SUCCEEDED'
      AND run."coverageStatus" = 'COMPLETE'
      AND run."isCurrent" = TRUE
      AND game."plyIndexedAt" = run."sourcePlyIndexedAt"
      AND analysis."snapshotId" = run."sourceAnalysisSnapshotId"
      AND analysis."sourcePlyIndexedAt" = game."plyIndexedAt"
      AND analysis."status" = 'SUCCEEDED'
      AND analysis."coverageStatus" = 'COMPLETE'
      AND NOT EXISTS (
        SELECT 1
        FROM "ImportedGamePly" AS mismatch
        WHERE mismatch."importedGameId" = game."id"
          AND mismatch."engineAnalysisRunId" IS DISTINCT FROM analysis."id"
      )
  `);
  return rows[0]?.count ?? 0;
}

async function loadCurrentSamples(appUserId: number): Promise<OpeningRecurrenceSample[]> {
  const rows = await prisma.$queryRaw<SampleRow[]>(Prisma.sql`
    SELECT
      game."id" AS "importedGameId",
      game."providerGameId" AS "providerGameId",
      game."userColor" AS "userColor",
      event."evidenceType" AS "evidenceType",
      event."sourcePlyStart" AS "sourcePlyStart",
      event."sourcePositionId" AS "sourcePositionId",
      event."measurementsJson" AS "measurements",
      event."detailsJson" AS "details"
    FROM "EvidenceRun" AS run
    JOIN "ImportedGame" AS game
      ON game."id" = run."importedGameId"
    JOIN "GameAnalysisRun" AS analysis
      ON analysis."id" = run."sourceAnalysisRunId"
    JOIN "EvidenceEvent" AS event
      ON event."runId" = run."id"
    WHERE game."appUserId" = ${appUserId}
      AND game."provider" = 'LICHESS'
      AND game."plyIndexStatus" = 'INDEXED'
      AND game."plyIndexedAt" IS NOT NULL
      AND game."speedCategory" IN ('bullet', 'blitz', 'rapid')
      AND (game."variant" IS NULL OR game."variant" IN ('chess', 'standard'))
      AND EXISTS (
        SELECT 1
        FROM "ImportedGamePly" AS ply
        WHERE ply."importedGameId" = game."id"
      )
      AND run."detectorKey" = ${OPENING_EVIDENCE_DETECTOR_KEY}
      AND run."detectorVersion" = ${OPENING_EVIDENCE_DETECTOR_VERSION}
      AND run."status" = 'SUCCEEDED'
      AND run."coverageStatus" = 'COMPLETE'
      AND run."isCurrent" = TRUE
      AND game."plyIndexedAt" = run."sourcePlyIndexedAt"
      AND analysis."snapshotId" = run."sourceAnalysisSnapshotId"
      AND analysis."sourcePlyIndexedAt" = game."plyIndexedAt"
      AND analysis."status" = 'SUCCEEDED'
      AND analysis."coverageStatus" = 'COMPLETE'
      AND event."availability" = 'PRESENT'
      AND event."evidenceType" IN (
        'OPENING_MOVE_QUALITY_SAMPLE',
        'OPENING_BAD_POSITION_ENTRY'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "ImportedGamePly" AS mismatch
        WHERE mismatch."importedGameId" = game."id"
          AND mismatch."engineAnalysisRunId" IS DISTINCT FROM analysis."id"
      )
    ORDER BY game."id" ASC, event."sourcePlyStart" ASC, event."id" ASC
  `);

  const samples: OpeningRecurrenceSample[] = [];
  for (const row of rows) {
    if (
      (row.userColor !== 'WHITE' && row.userColor !== 'BLACK')
      || row.sourcePlyStart === null
      || row.sourcePositionId === null
    ) {
      continue;
    }
    const measurements = record(row.measurements);
    const details = record(row.details);
    if (!measurements || !details) continue;
    const moveUci = stringValue(details.moveUci);
    if (!moveUci) continue;

    if (row.evidenceType === 'OPENING_MOVE_QUALITY_SAMPLE') {
      const scoreLossCp = numberValue(measurements.scoreLossCp);
      if (scoreLossCp === null) continue;
      samples.push({
        kind: 'MOVE_QUALITY',
        importedGameId: row.importedGameId,
        providerGameId: row.providerGameId,
        userColor: row.userColor,
        speedCategory: stringValue(details.speedCategory),
        plyNumber: row.sourcePlyStart,
        positionId: row.sourcePositionId,
        moveUci,
        openingName: stringValue(details.openingName),
        openingEco: stringValue(details.openingEco),
        scoreLossCp,
        userEvalCp: numberValue(measurements.afterUserEvalCp),
      });
      continue;
    }

    if (row.evidenceType === 'OPENING_BAD_POSITION_ENTRY') {
      const userEvalCp = numberValue(measurements.afterUserEvalCp);
      if (userEvalCp === null) continue;
      samples.push({
        kind: 'BAD_POSITION_ENTRY',
        importedGameId: row.importedGameId,
        providerGameId: row.providerGameId,
        userColor: row.userColor,
        speedCategory: stringValue(details.speedCategory),
        plyNumber: row.sourcePlyStart,
        positionId: row.sourcePositionId,
        moveUci,
        openingName: stringValue(details.openingName),
        openingEco: stringValue(details.openingEco),
        scoreLossCp: null,
        userEvalCp,
      });
    }
  }
  return samples;
}

export const prismaOpeningRecurrenceRepository: OpeningRecurrenceRepository = {
  countEligibleGames,
  countAnalysedEvidenceGames,
  loadCurrentSamples,
};
