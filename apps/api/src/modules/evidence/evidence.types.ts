export type EvidenceCoverageStatus =
  | 'COMPLETE'
  | 'PARTIAL'
  | 'UNAVAILABLE'
  | 'INCOMPLETE';

export type EvidenceAvailability =
  | 'PRESENT'
  | 'UNAVAILABLE'
  | 'INCOMPLETE';

export interface EvidenceAnalysisProvenance {
  runId: number;
  snapshotId: string;
  analysisVersion: string;
  settingsHash: string;
  engineName: string;
  engineVersion: string;
}

export interface EvidenceMultiPvLineSnapshot {
  multiPv: number;
  depth: number;
  scoreCpWhite: number | null;
  mateWhite: number | null;
  pv: string[];
}

export interface EvidencePositionAnalysisSnapshot {
  depth: number;
  scoreCpWhite: number | null;
  mateWhite: number | null;
  bestMove: string | null;
  bestPv: string[];
  multiPv: EvidenceMultiPvLineSnapshot[];
}

export interface EvidencePositionSnapshot {
  id: number;
  normalizedFen: string;
  analysis: EvidencePositionAnalysisSnapshot | null;
}

export interface EvidencePlySnapshot {
  plyNumber: number;
  beforePositionId: number;
  afterPositionId: number;
  moveUci: string;
  moverColor: string;
  isUserMove: boolean;
  sourceClockOrdinal: number | null;
  sourceClockAfterCentiseconds: number | null;
  sourceClockSemantics: string | null;
  clockBeforeMoveCentiseconds: number | null;
  effectiveIncrementCentiseconds: number | null;
  clockDeltaMoveTimeCentiseconds: number | null;
  beforeClockProvenance: string;
  incrementProvenance: string;
  timingDerivationVersion: number | null;
  timingDerivationStatus: string;
  timingReliabilityFlags: string[];
  timingUnavailableReason: string | null;
  engineAnalysisRunId: number | null;
  scoreLossCp: number | null;
  classificationCode: number | null;
}

export interface EvidenceInputSnapshot {
  game: {
    id: number;
    appUserId: number;
    provider: string;
    providerGameId: string;
    userColor: string | null;
    resultForUser: string | null;
    speedCategory: string | null;
    variant: string | null;
    timeControlInitial: number | null;
    timeControlIncrement: number | null;
    exactTimeControlKey: string | null;
    openingName: string | null;
    openingEco: string | null;
  };
  provenance: {
    sourcePlyIndexedAt: Date;
    plyIndexPolicyVersion: number | null;
    clockAlignmentVersion: number | null;
    timingDerivationVersion: number | null;
    timingCoverageStatus: string;
    analysis: EvidenceAnalysisProvenance | null;
  };
  positions: EvidencePositionSnapshot[];
  plies: EvidencePlySnapshot[];
}

export interface EvidenceFindingDraft {
  key: string;
  type: string;
  availability?: EvidenceAvailability;
  source?: {
    startPly?: number | null;
    endPly?: number | null;
    positionId?: number | null;
  };
  measurements: Record<string, unknown>;
  details?: Record<string, unknown>;
  unavailableReason?: string | null;
}

export interface EvidenceDetectorResult {
  coverage: {
    status: EvidenceCoverageStatus;
    reason?: string | null;
    details?: Record<string, unknown>;
  };
  findings: EvidenceFindingDraft[];
}

export interface EvidenceDetectorIdentity {
  key: string;
  version: string;
  requiresCompleteAnalysis: boolean;
  refreshOnCompleteAnalysis?: boolean;
}

export interface EvidenceDetector extends EvidenceDetectorIdentity {
  detect(
    snapshot: EvidenceInputSnapshot,
  ): EvidenceDetectorResult | Promise<EvidenceDetectorResult>;
}

export interface EvidenceRunClaim {
  id: number;
  importedGameId: number;
  detectorKey: string;
  detectorVersion: string;
  workKey: string;
  sourcePlyIndexedAt: Date;
  sourceAnalysisRunId: number | null;
  sourceAnalysisSnapshotId: string | null;
  attempts: number;
  maxAttempts: number;
  workerId: string;
  claimToken: string;
}
