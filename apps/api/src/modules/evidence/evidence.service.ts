import {
  prismaEvidenceRepository,
  type EvidenceRepository,
} from './evidence.repository.prisma';
import type {
  EvidenceDetector,
  EvidenceDetectorIdentity,
  EvidenceDetectorResult,
  EvidenceInputSnapshot,
} from './evidence.types';

export const MAX_EVIDENCE_FINDINGS_PER_RUN = 256;
const DEFAULT_STALE_AFTER_MS = 5 * 60_000;
const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export interface EvidenceService {
  runOnce(): Promise<boolean>;
}

function staleAfterMs(explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const configured = Number(process.env.EVIDENCE_STALE_AFTER_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.trunc(configured)
    : DEFAULT_STALE_AFTER_MS;
}

function detectorIdentity(detector: EvidenceDetector): EvidenceDetectorIdentity {
  return {
    key: detector.key,
    version: detector.version,
    requiresCompleteAnalysis: detector.requiresCompleteAnalysis,
  };
}

function detectorMap(detectors: EvidenceDetector[]): Map<string, EvidenceDetector> {
  const map = new Map<string, EvidenceDetector>();
  for (const detector of detectors) {
    if (
      detector.key.length === 0
      || detector.key.length > 64
      || !ID_PATTERN.test(detector.key)
    ) {
      throw new Error('Evidence detector key must be a stable 1-64 character identifier');
    }
    if (
      detector.version.length === 0
      || detector.version.length > 64
      || !ID_PATTERN.test(detector.version)
    ) {
      throw new Error(
        'Evidence detector version must be a stable 1-64 character identifier',
      );
    }
    const mapKey = detector.key + '@' + detector.version;
    if (map.has(mapKey)) {
      throw new Error('Duplicate evidence detector registration: ' + mapKey);
    }
    map.set(mapKey, detector);
  }
  return map;
}

function assertJsonSerializable(value: unknown, label: string): void {
  try {
    JSON.stringify(value);
  } catch {
    throw new Error(label + ' must be JSON serializable');
  }
}

export function validateEvidenceDetectorResult(
  snapshot: EvidenceInputSnapshot,
  result: EvidenceDetectorResult,
): void {
  const coverageStatuses = new Set([
    'COMPLETE',
    'PARTIAL',
    'UNAVAILABLE',
    'INCOMPLETE',
  ]);
  if (!coverageStatuses.has(result.coverage.status)) {
    throw new Error('Evidence detector returned an unsupported coverage status');
  }
  assertJsonSerializable(result.coverage, 'Evidence coverage');

  if (!Array.isArray(result.findings)) {
    throw new Error('Evidence detector findings must be an array');
  }
  if (result.findings.length > MAX_EVIDENCE_FINDINGS_PER_RUN) {
    throw new Error(
      'Evidence detector exceeded the per-run finding limit of '
      + MAX_EVIDENCE_FINDINGS_PER_RUN,
    );
  }

  const findingKeys = new Set<string>();
  const positionIds = new Set(snapshot.positions.map((position) => position.id));
  const maxPly = snapshot.plies.at(-1)?.plyNumber ?? 0;

  for (const finding of result.findings) {
    if (
      finding.key.length === 0
      || finding.key.length > 128
      || !ID_PATTERN.test(finding.key)
    ) {
      throw new Error('Evidence finding key must be a stable 1-128 character identifier');
    }
    if (findingKeys.has(finding.key)) {
      throw new Error('Evidence detector emitted duplicate finding key ' + finding.key);
    }
    findingKeys.add(finding.key);

    if (
      finding.type.length === 0
      || finding.type.length > 96
      || !ID_PATTERN.test(finding.type)
    ) {
      throw new Error('Evidence type must be a stable 1-96 character identifier');
    }
    if (
      finding.availability !== undefined
      && !['PRESENT', 'UNAVAILABLE', 'INCOMPLETE'].includes(finding.availability)
    ) {
      throw new Error('Evidence finding has an unsupported availability state');
    }

    const startPly = finding.source?.startPly ?? null;
    const endPly = finding.source?.endPly ?? startPly;
    if (
      startPly !== null
      && (!Number.isInteger(startPly) || startPly < 1 || startPly > maxPly)
    ) {
      throw new Error('Evidence finding start ply is outside the source snapshot');
    }
    if (
      endPly !== null
      && (!Number.isInteger(endPly) || endPly < 1 || endPly > maxPly)
    ) {
      throw new Error('Evidence finding end ply is outside the source snapshot');
    }
    if (startPly !== null && endPly !== null && endPly < startPly) {
      throw new Error('Evidence finding end ply precedes its start ply');
    }

    const positionId = finding.source?.positionId ?? null;
    if (positionId !== null && !positionIds.has(positionId)) {
      throw new Error('Evidence finding references a position outside the source snapshot');
    }
    if (
      finding.unavailableReason !== undefined
      && finding.unavailableReason !== null
      && finding.unavailableReason.length > 256
    ) {
      throw new Error('Evidence unavailable reason exceeds 256 characters');
    }

    assertJsonSerializable(finding.measurements, 'Evidence measurements');
    assertJsonSerializable(finding.details ?? {}, 'Evidence details');
  }
}

export function createEvidenceService(options: {
  detectors: EvidenceDetector[];
  repository?: EvidenceRepository;
  workerId?: string;
  staleAfterMs?: number;
}): EvidenceService {
  const repository = options.repository ?? prismaEvidenceRepository;
  const detectors = [...options.detectors];
  const registered = detectorMap(detectors);
  const identities = detectors.map(detectorIdentity);
  const workerId = options.workerId ?? 'evidence-' + process.pid;
  const staleLeaseMs = staleAfterMs(options.staleAfterMs);

  return {
    async runOnce(): Promise<boolean> {
      if (detectors.length === 0) return false;

      await repository.recoverStaleRuns(new Date(Date.now() - staleLeaseMs));
      for (const detector of detectors) {
        await repository.enqueueEligibleRun(detectorIdentity(detector));
      }

      const run = await repository.claimNext(workerId, identities);
      if (!run) return false;
      const detector = registered.get(run.detectorKey + '@' + run.detectorVersion);
      if (!detector) {
        await repository.markFailure(
          run,
          'Claimed evidence run has no registered detector implementation.',
        );
        return true;
      }

      try {
        const snapshot = await repository.loadSnapshot(run);
        if (
          detector.requiresCompleteAnalysis
          && snapshot.provenance.analysis === null
        ) {
          throw new Error('Evidence detector requires complete engine analysis');
        }
        const result = await detector.detect(snapshot);
        validateEvidenceDetectorResult(snapshot, result);
        const completed = await repository.completeRun(run, result);
        if (!completed) {
          await repository.markFailure(
            run,
            'Evidence source projection changed before completion.',
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await repository.markFailure(run, message);
      }
      return true;
    },
  };
}
