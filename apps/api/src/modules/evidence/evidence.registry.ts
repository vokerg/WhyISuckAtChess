import { materialEvidenceDetector } from './material-evidence.detector';
import { phaseEvidenceDetector } from './phase-evidence.detector';
import type { EvidenceDetector } from './evidence.types';

/**
 * Phase 3 detectors register here as they land. Keeping the registry explicit makes
 * worker ownership visible and prevents HTTP routes from executing detector work.
 */
export const evidenceDetectors: EvidenceDetector[] = [
  materialEvidenceDetector,
  phaseEvidenceDetector,
];
