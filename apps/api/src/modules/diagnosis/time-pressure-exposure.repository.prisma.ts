import type { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import {
  PHASE_EVIDENCE_DETECTOR_KEY,
  PHASE_EVIDENCE_DETECTOR_VERSION,
} from '../evidence/phase-evidence.detector';
import {
  TIME_PRESSURE_EXPOSURE_MAX_CANDIDATE_GAMES,
  type TimePressureExposureRepository,
  type TimePressureExposureScope,
  type TimePressurePhase,
  type TimePressureSourceGame,
} from './time-pressure-exposure.service';

interface PhaseRange {
  startBoundaryPly: number;
  endBoundaryPly: number;
  phase: TimePressurePhase;
}

function buildWhere(
  appUserId: number,
  scope: TimePressureExposureScope,
): Prisma.ImportedGameWhereInput {
  const startedAt = {
    ...(scope.from ? { gte: scope.from } : {}),
    ...(scope.to ? { lt: scope.to } : {}),
  };

  return {
    appUserId,
    ...(scope.from || scope.to ? { startedAt } : {}),
  };
}

function jsonObject(value: Prisma.JsonValue): Prisma.JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Prisma.JsonObject
    : null;
}

function jsonNumber(value: Prisma.JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function jsonString(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function phaseValue(value: string | null): TimePressurePhase | null {
  return value === 'OPENING' || value === 'MIDDLEGAME' || value === 'ENDGAME'
    ? value
    : null;
}

function phaseRanges(events: readonly {
  measurementsJson: Prisma.JsonValue;
  detailsJson: Prisma.JsonValue;
}[]): PhaseRange[] {
  return events.flatMap((event) => {
    const measurements = jsonObject(event.measurementsJson);
    const details = jsonObject(event.detailsJson);
    if (!measurements || !details) return [];

    const startBoundaryPly = jsonNumber(measurements.startBoundaryPly);
    const endBoundaryPly = jsonNumber(measurements.endBoundaryPly);
    const phase = phaseValue(jsonString(details.phase));
    if (
      startBoundaryPly === null
      || endBoundaryPly === null
      || !Number.isInteger(startBoundaryPly)
      || !Number.isInteger(endBoundaryPly)
      || startBoundaryPly < 0
      || endBoundaryPly < startBoundaryPly
      || !phase
    ) {
      return [];
    }

    return [{ startBoundaryPly, endBoundaryPly, phase }];
  }).sort((left, right) => left.startBoundaryPly - right.startBoundaryPly);
}

function phaseAtBoundary(ranges: readonly PhaseRange[], boundaryPly: number): TimePressurePhase | null {
  return ranges.find(
    (range) => boundaryPly >= range.startBoundaryPly && boundaryPly <= range.endBoundaryPly,
  )?.phase ?? null;
}

export const prismaTimePressureExposureRepository: TimePressureExposureRepository = {
  async countCandidates(appUserId, scope) {
    return prisma.importedGame.count({
      where: buildWhere(appUserId, scope),
    });
  },

  async loadCandidates(appUserId, scope) {
    const rows = await prisma.importedGame.findMany({
      where: buildWhere(appUserId, scope),
      orderBy: [
        { startedAt: { sort: 'asc', nulls: 'last' } },
        { id: 'asc' },
      ],
      take: TIME_PRESSURE_EXPOSURE_MAX_CANDIDATE_GAMES,
      select: {
        id: true,
        variant: true,
        speedCategory: true,
        exactTimeControlKey: true,
        timeControlInitial: true,
        timeControlIncrement: true,
        timingDerivationVersion: true,
        plyIndexedAt: true,
        plies: {
          where: { isUserMove: true },
          orderBy: { plyNumber: 'asc' },
          select: {
            plyNumber: true,
            clockBeforeMoveCentiseconds: true,
            timingDerivationVersion: true,
            timingDerivationStatus: true,
            timingReliabilityFlags: true,
          },
        },
        evidenceRuns: {
          where: {
            detectorKey: PHASE_EVIDENCE_DETECTOR_KEY,
            detectorVersion: PHASE_EVIDENCE_DETECTOR_VERSION,
            isCurrent: true,
            status: 'SUCCEEDED',
          },
          orderBy: { createdAt: 'desc' },
          take: 2,
          select: {
            sourcePlyIndexedAt: true,
            events: {
              where: {
                evidenceType: 'POSITION_PHASE_RANGE',
                availability: 'PRESENT',
              },
              orderBy: { id: 'asc' },
              select: {
                measurementsJson: true,
                detailsJson: true,
              },
            },
          },
        },
      },
    });

    return rows.map<TimePressureSourceGame>((row) => {
      const currentPhaseRun = row.evidenceRuns.length === 1
        && row.plyIndexedAt
        && row.evidenceRuns[0].sourcePlyIndexedAt.getTime() === row.plyIndexedAt.getTime()
        ? row.evidenceRuns[0]
        : null;
      const ranges = currentPhaseRun ? phaseRanges(currentPhaseRun.events) : [];

      return {
        importedGameId: row.id,
        variant: row.variant,
        speedCategory: row.speedCategory,
        exactTimeControlKey: row.exactTimeControlKey,
        timeControlInitial: row.timeControlInitial,
        timeControlIncrement: row.timeControlIncrement,
        timingDerivationVersion: row.timingDerivationVersion,
        userMoves: row.plies.map((ply) => ({
          plyNumber: ply.plyNumber,
          clockBeforeMoveCentiseconds: ply.clockBeforeMoveCentiseconds,
          timingDerivationVersion: ply.timingDerivationVersion,
          timingDerivationStatus: ply.timingDerivationStatus,
          timingReliabilityFlags: ply.timingReliabilityFlags,
          phase: phaseAtBoundary(ranges, ply.plyNumber - 1),
        })),
      };
    });
  },
};
