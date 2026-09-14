import type {
  EvidenceCoverageStatus,
  EvidenceFindingDraft,
} from './evidence.types';

export const OPENING_RECURRENCE_MAX_CANDIDATE_GAMES = 5000;
export const OPENING_RECURRENCE_MIN_ANALYSED_GAMES = 5;
export const OPENING_RECURRENCE_MIN_ANALYSIS_COVERAGE = 0.5;
export const OPENING_REPEATED_MOVE_MIN_GAMES = 5;
export const OPENING_REPEATED_MOVE_MIN_AVERAGE_CPL = 60;
export const OPENING_BAD_POSITION_MIN_GAMES = 5;
export const OPENING_RECURRENCE_SUPPORT_LIMIT = 8;

export type OpeningRecurrenceSampleKind =
  | 'MOVE_QUALITY'
  | 'BAD_POSITION_ENTRY';

export interface OpeningRecurrenceSample {
  kind: OpeningRecurrenceSampleKind;
  importedGameId: number;
  providerGameId: string;
  userColor: 'WHITE' | 'BLACK';
  speedCategory: string | null;
  plyNumber: number;
  positionId: number;
  moveUci: string;
  openingName: string | null;
  openingEco: string | null;
  scoreLossCp: number | null;
  userEvalCp: number | null;
}

export interface OpeningRecurrenceRepository {
  countEligibleGames(appUserId: number): Promise<number>;
  countAnalysedEvidenceGames(appUserId: number): Promise<number>;
  loadCurrentSamples(appUserId: number): Promise<OpeningRecurrenceSample[]>;
}

export interface OpeningRecurrenceCoverage {
  status: EvidenceCoverageStatus;
  reason: string | null;
  eligibleGames: number;
  analysedGames: number;
  analysisCoveragePct: number;
  sampleEvents: number;
  maxCandidateGames: number;
  minAnalysedGames: number;
  minAnalysisCoveragePct: number;
}

export interface OpeningRecurrenceEvidenceResult {
  coverage: OpeningRecurrenceCoverage;
  findings: EvidenceFindingDraft[];
}

interface Group {
  samples: OpeningRecurrenceSample[];
  byGame: Map<number, OpeningRecurrenceSample>;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function evidenceStrength(sample: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (sample >= 40) return 'HIGH';
  if (sample >= 15) return 'MEDIUM';
  return 'LOW';
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function grouped(
  samples: OpeningRecurrenceSample[],
  keyOf: (sample: OpeningRecurrenceSample) => string,
): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const sample of samples) {
    const key = keyOf(sample);
    let group = groups.get(key);
    if (!group) {
      group = { samples: [], byGame: new Map() };
      groups.set(key, group);
    }
    group.samples.push(sample);

    const prior = group.byGame.get(sample.importedGameId);
    if (
      !prior
      || (sample.scoreLossCp ?? Number.NEGATIVE_INFINITY)
        > (prior.scoreLossCp ?? Number.NEGATIVE_INFINITY)
    ) {
      group.byGame.set(sample.importedGameId, sample);
    }
  }
  return groups;
}

function supportingReferences(samples: OpeningRecurrenceSample[]) {
  return [...samples]
    .sort((left, right) =>
      (right.scoreLossCp ?? 0) - (left.scoreLossCp ?? 0)
      || (left.userEvalCp ?? 0) - (right.userEvalCp ?? 0)
      || left.importedGameId - right.importedGameId
      || left.plyNumber - right.plyNumber)
    .slice(0, OPENING_RECURRENCE_SUPPORT_LIMIT)
    .map((sample) => ({
      importedGameId: sample.importedGameId,
      providerGameId: sample.providerGameId,
      plyNumber: sample.plyNumber,
      positionId: sample.positionId,
      moveUci: sample.moveUci,
      scoreLossCp: sample.scoreLossCp,
      userEvalCp: sample.userEvalCp,
      speedCategory: sample.speedCategory,
    }));
}

function repeatedMoveFindings(
  samples: OpeningRecurrenceSample[],
): EvidenceFindingDraft[] {
  const moveSamples = samples.filter(
    (sample) => sample.kind === 'MOVE_QUALITY' && sample.scoreLossCp !== null,
  );
  const groups = grouped(
    moveSamples,
    (sample) => [sample.userColor, sample.positionId, sample.moveUci].join(':'),
  );
  const findings: EvidenceFindingDraft[] = [];

  for (const group of groups.values()) {
    const representatives = [...group.byGame.values()];
    if (representatives.length < OPENING_REPEATED_MOVE_MIN_GAMES) continue;
    const averageCpl = representatives.reduce(
      (sum, sample) => sum + (sample.scoreLossCp ?? 0),
      0,
    ) / representatives.length;
    if (averageCpl < OPENING_REPEATED_MOVE_MIN_AVERAGE_CPL) continue;

    const first = representatives[0];
    const maxCpl = Math.max(
      ...representatives.map((sample) => sample.scoreLossCp ?? 0),
    );
    findings.push({
      key: [
        'repeated-early-move',
        first.userColor.toLowerCase(),
        first.positionId,
        first.moveUci,
      ].join('-'),
      type: 'REPEATED_EARLY_MOVE_ERROR',
      measurements: {
        distinctGames: representatives.length,
        analysedMoveCount: representatives.length,
        averageScoreLossCp: round1(averageCpl),
        maxScoreLossCp: maxCpl,
        minGames: OPENING_REPEATED_MOVE_MIN_GAMES,
        minAverageScoreLossCp: OPENING_REPEATED_MOVE_MIN_AVERAGE_CPL,
      },
      details: {
        userColor: first.userColor,
        positionId: first.positionId,
        moveUci: first.moveUci,
        evidenceStrength: evidenceStrength(representatives.length),
        openingNames: uniqueStrings(representatives.map((sample) => sample.openingName)),
        openingEcos: uniqueStrings(representatives.map((sample) => sample.openingEco)),
        supportingGames: supportingReferences(representatives),
        grouping: 'exact-normalized-position-and-user-move',
      },
    });
  }

  return findings;
}

function badPositionFindings(
  samples: OpeningRecurrenceSample[],
): EvidenceFindingDraft[] {
  const badSamples = samples.filter(
    (sample) => sample.kind === 'BAD_POSITION_ENTRY' && sample.userEvalCp !== null,
  );
  const groups = grouped(
    badSamples,
    (sample) => [sample.userColor, sample.positionId].join(':'),
  );
  const findings: EvidenceFindingDraft[] = [];

  for (const group of groups.values()) {
    const representatives = [...group.byGame.values()];
    if (representatives.length < OPENING_BAD_POSITION_MIN_GAMES) continue;

    const first = representatives[0];
    const values = representatives.map((sample) => sample.userEvalCp ?? 0);
    const averageUserEvalCp = values.reduce((sum, value) => sum + value, 0)
      / values.length;
    findings.push({
      key: [
        'recurring-bad-opening-position',
        first.userColor.toLowerCase(),
        first.positionId,
      ].join('-'),
      type: 'RECURRING_BAD_OPENING_POSITION',
      measurements: {
        distinctGames: representatives.length,
        evaluatedGames: representatives.length,
        averageUserEvalCp: Math.round(averageUserEvalCp),
        worstUserEvalCp: Math.min(...values),
        minGames: OPENING_BAD_POSITION_MIN_GAMES,
      },
      details: {
        userColor: first.userColor,
        positionId: first.positionId,
        evidenceStrength: evidenceStrength(representatives.length),
        openingNames: uniqueStrings(representatives.map((sample) => sample.openingName)),
        openingEcos: uniqueStrings(representatives.map((sample) => sample.openingEco)),
        supportingGames: supportingReferences(representatives),
        grouping: 'exact-normalized-threshold-entry-position',
      },
    });
  }

  return findings;
}

function coverage(
  status: EvidenceCoverageStatus,
  reason: string | null,
  eligibleGames: number,
  analysedGames: number,
  sampleEvents: number,
): OpeningRecurrenceCoverage {
  const analysisCoverage = eligibleGames > 0 ? analysedGames / eligibleGames : 0;
  return {
    status,
    reason,
    eligibleGames,
    analysedGames,
    analysisCoveragePct: round1(analysisCoverage * 100),
    sampleEvents,
    maxCandidateGames: OPENING_RECURRENCE_MAX_CANDIDATE_GAMES,
    minAnalysedGames: OPENING_RECURRENCE_MIN_ANALYSED_GAMES,
    minAnalysisCoveragePct: OPENING_RECURRENCE_MIN_ANALYSIS_COVERAGE * 100,
  };
}

export function aggregateOpeningRecurrenceEvidence(input: {
  eligibleGames: number;
  analysedGames: number;
  samples: OpeningRecurrenceSample[];
}): OpeningRecurrenceEvidenceResult {
  const analysisCoverage = input.eligibleGames > 0
    ? input.analysedGames / input.eligibleGames
    : 0;

  if (input.eligibleGames === 0) {
    return {
      coverage: coverage('UNAVAILABLE', 'no-eligible-games', 0, 0, 0),
      findings: [],
    };
  }
  if (input.analysedGames < OPENING_RECURRENCE_MIN_ANALYSED_GAMES) {
    return {
      coverage: coverage(
        'UNAVAILABLE',
        'insufficient-analysed-games',
        input.eligibleGames,
        input.analysedGames,
        0,
      ),
      findings: [],
    };
  }
  if (analysisCoverage < OPENING_RECURRENCE_MIN_ANALYSIS_COVERAGE) {
    return {
      coverage: coverage(
        'INCOMPLETE',
        'insufficient-analysis-coverage',
        input.eligibleGames,
        input.analysedGames,
        0,
      ),
      findings: [],
    };
  }

  const findings = [
    ...repeatedMoveFindings(input.samples),
    ...badPositionFindings(input.samples),
  ].sort((left, right) =>
    left.type.localeCompare(right.type) || left.key.localeCompare(right.key));

  return {
    coverage: coverage(
      'COMPLETE',
      null,
      input.eligibleGames,
      input.analysedGames,
      input.samples.length,
    ),
    findings,
  };
}

export async function getOpeningRecurrenceEvidence(
  appUserId: number,
  repository: OpeningRecurrenceRepository,
): Promise<OpeningRecurrenceEvidenceResult> {
  const eligibleGames = await repository.countEligibleGames(appUserId);
  if (eligibleGames > OPENING_RECURRENCE_MAX_CANDIDATE_GAMES) {
    return {
      coverage: coverage(
        'UNAVAILABLE',
        'opening-recurrence-scope-too-large',
        eligibleGames,
        0,
        0,
      ),
      findings: [],
    };
  }

  const analysedGames = await repository.countAnalysedEvidenceGames(appUserId);
  const analysisCoverage = eligibleGames > 0 ? analysedGames / eligibleGames : 0;
  if (
    eligibleGames === 0
    || analysedGames < OPENING_RECURRENCE_MIN_ANALYSED_GAMES
    || analysisCoverage < OPENING_RECURRENCE_MIN_ANALYSIS_COVERAGE
  ) {
    return aggregateOpeningRecurrenceEvidence({
      eligibleGames,
      analysedGames,
      samples: [],
    });
  }

  const samples = await repository.loadCurrentSamples(appUserId);
  return aggregateOpeningRecurrenceEvidence({
    eligibleGames,
    analysedGames,
    samples,
  });
}
