// Phase 7 #125: deterministic policy sensitivity matrix, NOT empirical diagnosis accuracy.
// Uses versioned production policy functions and synthetic/unreviewed fixtures only.
// Run after building the API: node apps/api/test/support/phase-7-calibration-sensitivity.mjs
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TIME_BEHAVIOR_POLICY_VERSION,
  TIME_EARLY_OVERUSE_MEDIAN_MULTIPLIER,
  classifyMoveSpeed,
  classifyRemainingClock,
  comparativeTimingBehaviorEvidenceStrength,
  isAmpleClock,
  isMaterialRatingCompositionDifference,
  timingBehaviorEvidenceStrength,
} from '../../dist/modules/timing/time-behavior-policy.js';
import { buildDiagnosisRanking } from '../../dist/modules/diagnosis/diagnosis-ranking.service.js';

const corpus = JSON.parse(readFileSync(
  new URL('../fixtures/phase-7-gold-corpus.v1.json', import.meta.url), 'utf8',
));

function finding(id, diagnosisId, overrides = {}) {
  return {
    id, diagnosisId,
    findingKey: overrides.findingKey ?? 'calibration-' + id,
    findingLevel: overrides.findingLevel ?? 'MECHANISM',
    observationState: overrides.observationState ?? 'PROBLEM_DETECTED',
    claimKey: 'synthetic-calibration.' + diagnosisId,
    producerKey: overrides.producerKey ?? 'synthetic-calibration',
    producerVersion: 'synthetic-v1',
    sampleCount: overrides.distinctGameCount ?? 15,
    distinctGameCount: overrides.distinctGameCount ?? 15,
    distinctSessionCount: 0,
    requiredEvidenceCoverage: overrides.requiredEvidenceCoverage ?? 0.8,
    evidenceStrength: overrides.evidenceStrength ?? 'MEDIUM',
    dimensions: {},
    coverage: {},
    effect: overrides.effect === undefined ? {
      metric: 'average-score-loss-delta', value: overrides.effectCp ?? 60,
      unit: 'CENTIPAWNS', direction: 'HIGHER_IS_WORSE', comparator: null,
    } : overrides.effect,
    sourceVersions: { fixture: 'synthetic-v1' },
    evidenceReferences: [],
  };
}

function consolidation(item, index) {
  return {
    id: index + 1, findingId: item.id, representativeFindingId: null,
    state: 'TOP_LEVEL', topLevelEligible: true,
    clusterKey: 'synthetic:' + item.findingKey, reasonKeys: [],
    policyVersion: 'diagnosis-consolidation-v1',
    support: { findingKey: item.findingKey, diagnosisId: item.diagnosisId,
      materialOverlapPeerFindingIds: [], confounderFindingIds: [] },
  };
}

function snapshot(findings, overrides = {}) {
  return {
    id: 125, appUserId: 7, materializationKey: 'synthetic-sensitivity',
    scopeKey: 'synthetic-calibration-scope', scope: { fixture: true },
    taxonomyVersion: 'diagnostic-taxonomy-v1',
    synthesisPolicyVersion: 'diagnosis-synthesis-v1',
    calculationVersion: 'finding-materialization-v1',
    policyVersions: {
      eventIdentity: 'diagnosis-event-identity-v1',
      consolidation: 'diagnosis-consolidation-v1',
      ranking: 'diagnosis-ranking-v1',
    },
    calculationAsOf: new Date('2026-10-15T00:00:00Z'),
    isCurrent: overrides.isCurrent ?? true,
    supersededAt: null,
    findings, relationships: [],
    consolidations: findings.map(consolidation),
    rootSupports: overrides.rootSupports ?? [],
  };
}

function rank(findings, overrides) {
  const result = buildDiagnosisRanking(snapshot(findings, overrides));
  return {
    allRowCount: result.rankings.length,
    rows: result.rankings.filter((row) => row.topLevelRanked).map((row) => ({
      findingId: row.findingId,
      rankPosition: row.rankPosition,
      finalScore: Number(row.finalScore.toFixed(8)),
      evidenceMultiplier: row.evidenceMultiplier,
      rankingPolicyVersion: row.rankingPolicyVersion,
    })),
    suppressedRootChildren: result.rankings.filter((row) => (
      !row.topLevelRanked && row.parentRootFindingIds.length > 0
    )).map((row) => row.findingId).sort((a, b) => a - b),
  };
}

export function buildCalibrationSensitivityMatrix() {
  const clockCases = [999, 1_000, 1_001, 3_000, 3_001, null].map((clockCs) => ({
    clockCs, band: classifyRemainingClock(clockCs),
  }));
  const ampleCases = [
    [6_000, 4_499], [6_000, 4_500],
    [18_000, 4_499], [18_000, 4_500],
    [60_000, 14_999], [60_000, 15_000],
    [60_000, null],
  ].map(([initialCs, remainingCs]) => ({
    initialCs, remainingCs, ample: isAmpleClock(remainingCs, initialCs),
  }));
  const speedCases = [99, 100, 101, null].map((moveTimeCs) => ({
    moveTimeCs, speed: classifyMoveSpeed(moveTimeCs),
  }));

  const grades = [4, 5, 14, 15, 39, 40].flatMap((supportingGames) => (
    [null, 49.9, 50, 100].map((requiredEvidenceCoveragePercent) => ({
      supportingGames, requiredEvidenceCoveragePercent,
      grade: timingBehaviorEvidenceStrength({
        supportingGames, requiredEvidenceCoveragePercent,
      }),
    }))
  ));
  const comparativeCases = [
    { id: 'balanced-high', left: [40, 100], right: [40, 100] },
    { id: 'weaker-arm-14', left: [40, 100], right: [14, 100] },
    { id: 'weaker-arm-4', left: [40, 100], right: [4, 100] },
    { id: 'low-coverage-arm', left: [40, 100], right: [40, 49.9] },
    { id: 'weaker-arm-39', left: [40, 100], right: [39, 100] },
  ].map((entry) => ({
    id: entry.id, left: entry.left, right: entry.right,
    grade: comparativeTimingBehaviorEvidenceStrength(
      { supportingGames: entry.left[0], requiredEvidenceCoveragePercent: entry.left[1] },
      { supportingGames: entry.right[0], requiredEvidenceCoveragePercent: entry.right[1] },
    ),
  }));
  const ratingCompositionCases = [
    { id: 'balanced', mean: 99.9, band: 19.9 },
    { id: 'mean-threshold', mean: -100, band: 0 },
    { id: 'band-threshold', mean: 0, band: 20 },
    { id: 'unknown', mean: null, band: null },
  ].map((entry) => ({
    id: entry.id, warning: isMaterialRatingCompositionDifference({
      meanRatingDifferenceDeltaPoints: entry.mean,
      maxBandShareDeltaPercentagePoints: entry.band,
    }),
  }));

  const a = finding(1, 'TIME-002', { effectCp: 60 });
  const b = finding(2, 'TIME-003', { effectCp: 40 });
  const sparse = finding(3, 'TIME-004', {
    distinctGameCount: 4, requiredEvidenceCoverage: 0.25,
    evidenceStrength: 'INSUFFICIENT', observationState: 'INSUFFICIENT_EVIDENCE',
    effectCp: 300,
  });
  const neutral = finding(4, 'TIME-001', {
    observationState: 'NOT_DETECTED_WITH_ADEQUATE_COVERAGE', effectCp: 0,
  });
  const mechanism = finding(5, 'TIME-004', { effectCp: 70 });
  const context = finding(6, 'TIME-002', {
    findingLevel: 'CONTRIBUTING_CONDITION', effectCp: 60,
  });
  const root = finding(7, 'CLOCK_MANAGEMENT_DRIVING_TACTICAL_COLLAPSE', {
    findingLevel: 'ROOT_CAUSE_CANDIDATE', producerKey: 'diagnosis-root-synthesis',
    effect: null,
  });

  const rankingCases = {
    baseline: rank([a, b]),
    reversedInput: rank([b, a]),
    addedSparseHugeEffect: rank([a, b, sparse]),
    addedAdequateNeutral: rank([a, b, neutral]),
    coverageBelowGate: rank([{ ...a, requiredEvidenceCoverage: 0.499 }, b]),
    coverageAtGate: rank([{ ...a, requiredEvidenceCoverage: 0.5 }, b]),
    largerSeverity: rank([{ ...a, effect: { ...a.effect, value: 100 } }, b]),
    strongerEvidence: rank([{ ...a, evidenceStrength: 'HIGH' }, b]),
    supportedRoot: rank([mechanism, context, root], {
      rootSupports: [
        { id: 1, rootFindingId: 7, supportingFindingId: 5,
          role: 'MECHANISM', support: { fixture: true } },
        { id: 2, rootFindingId: 7, supportingFindingId: 6,
          role: 'CONDITION_OR_OBSERVATION', support: { fixture: true } },
      ],
    }),
  };
  let staleFindingSetRejected = false;
  try {
    rank([a, b], { isCurrent: false });
  } catch (error) {
    staleFindingSetRejected = /current canonical finding set/.test(String(error));
  }

  return {
    reportVersion: 'phase-7-calibration-sensitivity-v1',
    inputStatus: 'SYNTHETIC_UNREVIEWED_POLICY_PROBES',
    humanReviewedCases: 0,
    domainAccuracy: null,
    policyVersions: {
      timing: TIME_BEHAVIOR_POLICY_VERSION,
      ranking: 'diagnosis-ranking-v1',
    },
    corpus: {
      schemaVersion: corpus.schemaVersion,
      reviewStatus: corpus.domainReviewStatus,
      sourceCaseCount: corpus.cases.length,
      timingCaseIds: corpus.cases.filter((entry) => (
        entry.family === 'TIME_PRESSURE_EXPOSURE'
      )).map((entry) => entry.id),
    },
    earlyOveruseMedianMultiplier: TIME_EARLY_OVERUSE_MEDIAN_MULTIPLIER,
    clockCases, ampleCases, speedCases, grades,
    comparativeCases, ratingCompositionCases,
    rankingCases, staleFindingSetRejected,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(buildCalibrationSensitivityMatrix(), null, 2) + '\n');
}
