import prisma from '../../prisma';
import { prismaDiagnosisFindingRepository } from './diagnosis-finding.repository.prisma';
import type { DiagnosisFindingOverlapRepository } from './diagnosis-overlap.service';

export const prismaDiagnosisFindingOverlapRepository: DiagnosisFindingOverlapRepository = {
  ...prismaDiagnosisFindingRepository,

  async assertCurrentSourceReferences(appUserId, snapshot) {
    if (snapshot.appUserId !== appUserId) {
      throw new Error('Diagnosis overlap finding set belongs to another owner.');
    }

    const eventIds = [...new Set(snapshot.findings.flatMap((finding) => (
      finding.evidenceReferences.flatMap((reference) => (
        reference.evidenceEventId === null ? [] : [reference.evidenceEventId]
      ))
    )))];
    if (eventIds.length === 0) return;

    const rows = await prisma.evidenceEvent.findMany({
      where: { id: { in: eventIds } },
      select: {
        id: true,
        availability: true,
        run: {
          select: {
            importedGameId: true,
            status: true,
            isCurrent: true,
          },
        },
      },
    });
    if (rows.length !== eventIds.length) {
      throw new Error('Diagnosis overlap references a missing evidence event.');
    }
    if (
      rows.some((row) => (
        row.availability !== 'PRESENT'
        || row.run.status !== 'SUCCEEDED'
        || !row.run.isCurrent
      ))
    ) {
      throw new Error('Diagnosis overlap references stale or unavailable source evidence.');
    }

    const sourceGameIds = [...new Set(rows.map((row) => row.run.importedGameId))];
    const ownedGames = await prisma.importedGame.count({
      where: {
        appUserId,
        id: { in: sourceGameIds },
      },
    });
    if (ownedGames !== sourceGameIds.length) {
      throw new Error('Diagnosis overlap source evidence is outside the owned player scope.');
    }
  },
};
