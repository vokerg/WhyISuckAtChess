import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import prismaModule from '../dist/prisma.js';
import {
  prismaDiagnosisFindingRepository,
} from '../dist/modules/diagnosis/diagnosis-finding.repository.prisma.js';
import {
  replaceCurrentDiagnosisFindingScope,
  validateDiagnosisFindingSetDraft,
} from '../dist/modules/diagnosis/diagnosis-finding.service.js';

const prisma = prismaModule.default ?? prismaModule;

function baseFinding(overrides = {}) {
  return {
    findingKey: 'time-pressure-collapse',
    diagnosisId: 'TIME-002',
    findingLevel: 'MECHANISM',
    observationState: 'PROBLEM_DETECTED',
    claimKey: 'time.quality-collapse-under-pressure',
    producerKey: 'time-pressure-quality-collapse',
    producerVersion: 'time-pressure-quality-collapse-v1',
    sampleCount: 12,
    distinctGameCount: 8,
    distinctSessionCount: 3,
    requiredEvidenceCoverage: 0.8,
    evidenceStrength: 'MEDIUM',
    dimensions: {
      exactTimeControlKey: '180+2',
      phase: 'MIDDLEGAME',
    },
    coverage: {
      status: 'PARTIAL',
      requiredEvidenceCoverage: 0.8,
    },
    effect: {
      metric: 'average-score-loss-delta',
      value: 74.5,
      unit: 'centipawns',
      direction: 'HIGHER_IS_WORSE',
      comparator: { baseline: 'NORMAL_CLOCK' },
    },
    sourceVersions: {
      aggregate: 'time-pressure-quality-collapse-v1',
      timingPolicy: 'time-behavior-v1',
    },
    evidenceReferences: [],
    ...overrides,
  };
}

function findingSet(materializationKey, finding, calculationVersion = 'finding-materialization-v1') {
  return {
    materializationKey,
    scopeKey: 'all-supported-games',
    scope: {
      kind: 'OWNED_PLAYER',
      filters: { speeds: ['bullet', 'blitz', 'rapid'] },
    },
    taxonomyVersion: 'diagnostic-taxonomy-v1',
    synthesisPolicyVersion: 'diagnosis-synthesis-v1',
    calculationVersion,
    policyVersions: {
      synthesis: 'diagnosis-synthesis-v1',
      eventIdentity: 'diagnosis-event-identity-v1',
      consolidation: 'diagnosis-consolidation-v1',
      ranking: 'diagnosis-ranking-v1',
    },
    calculationAsOf: new Date('2026-09-22T05:00:00.000Z'),
    findings: [finding],
  };
}

test('canonical finding persistence replaces current scope without deleting source facts', async () => {
  const suffix = randomUUID();
  let userId = null;
  let otherUserId = null;

  try {
    const user = await prisma.appUser.create({
      data: { authProvider: 'TEST', authSubject: 'diagnosis-owner-' + suffix },
    });
    userId = user.id;
    const otherUser = await prisma.appUser.create({
      data: { authProvider: 'TEST', authSubject: 'diagnosis-other-' + suffix },
    });
    otherUserId = otherUser.id;

    const indexedAt = new Date('2026-09-22T04:00:00.000Z');
    const game = await prisma.importedGame.create({
      data: {
        appUserId: user.id,
        provider: 'LICHESS',
        providerGameId: 'diagnosis-game-' + suffix,
        connectedLichessUserId: 'fixture-user',
        connectedLichessUsername: 'FixtureUser',
        plyIndexStatus: 'INDEXED',
        plyIndexedAt: indexedAt,
      },
    });
    const otherGame = await prisma.importedGame.create({
      data: {
        appUserId: otherUser.id,
        provider: 'LICHESS',
        providerGameId: 'diagnosis-other-game-' + suffix,
        connectedLichessUserId: 'fixture-other',
        connectedLichessUsername: 'FixtureOther',
      },
    });
    const sameOwnerOtherGame = await prisma.importedGame.create({
      data: {
        appUserId: user.id,
        provider: 'LICHESS',
        providerGameId: 'diagnosis-same-owner-other-game-' + suffix,
        connectedLichessUserId: 'fixture-user',
        connectedLichessUsername: 'FixtureUser',
        plyIndexStatus: 'INDEXED',
        plyIndexedAt: indexedAt,
      },
    });

    const analysisRun = await prisma.gameAnalysisRun.create({
      data: {
        importedGameId: game.id,
        analysisVersion: 'fixture-analysis-v1',
        settingsHash: 'fixture-settings-' + suffix,
        settingsJson: { depth: 16, multiPv: 3 },
        sourcePlyIndexedAt: indexedAt,
        engineName: 'FixtureFish',
        engineVersion: '1',
        status: 'SUCCEEDED',
        coverageStatus: 'COMPLETE',
        completedAt: new Date('2026-09-22T04:01:00.000Z'),
      },
    });
    const evidenceRun = await prisma.evidenceRun.create({
      data: {
        importedGameId: game.id,
        detectorKey: 'fixture-diagnosis-source',
        detectorVersion: 'v1',
        workKey: randomUUID().replaceAll('-', ''),
        sourcePlyIndexedAt: indexedAt,
        sourceAnalysisRunId: analysisRun.id,
        sourceAnalysisSnapshotId: analysisRun.snapshotId,
        status: 'SUCCEEDED',
        coverageStatus: 'COMPLETE',
        isCurrent: true,
        completedAt: new Date('2026-09-22T04:02:00.000Z'),
      },
    });
    const event = await prisma.evidenceEvent.create({
      data: {
        evidenceKey: randomUUID().replaceAll('-', ''),
        runId: evidenceRun.id,
        findingKey: 'pressure-event',
        evidenceType: 'TIME_PRESSURE_QUALITY',
        sourcePlyStart: 15,
        sourcePlyEnd: 15,
        measurementsJson: { scoreLossCp: 180 },
        detailsJson: { clockBand: 'PRESSURE' },
      },
    });
    const otherEvidenceRun = await prisma.evidenceRun.create({
      data: {
        importedGameId: sameOwnerOtherGame.id,
        detectorKey: 'fixture-diagnosis-other-source',
        detectorVersion: 'v1',
        workKey: randomUUID().replaceAll('-', ''),
        sourcePlyIndexedAt: indexedAt,
        status: 'SUCCEEDED',
        coverageStatus: 'COMPLETE',
        isCurrent: true,
        completedAt: new Date('2026-09-22T04:03:00.000Z'),
      },
    });
    const otherEvent = await prisma.evidenceEvent.create({
      data: {
        evidenceKey: randomUUID().replaceAll('-', ''),
        runId: otherEvidenceRun.id,
        findingKey: 'other-event',
        evidenceType: 'FIXTURE_EVENT',
        measurementsJson: { value: 1 },
        detailsJson: { fixture: true },
      },
    });

    const firstDraft = findingSet(
      randomUUID().replaceAll('-', ''),
      baseFinding({
        evidenceReferences: [{
          referenceKey: 'event-' + event.id,
          referenceType: 'EVIDENCE_EVENT',
          importedGameId: game.id,
          evidenceEventId: event.id,
          sourceAnalysisRunId: analysisRun.id,
          sourcePlyStart: 15,
          sourcePlyEnd: 15,
          provenance: {
            detectorKey: evidenceRun.detectorKey,
            detectorVersion: evidenceRun.detectorVersion,
            analysisSnapshotId: analysisRun.snapshotId,
          },
          representative: true,
        }],
      }),
    );

    const first = await replaceCurrentDiagnosisFindingScope(
      user.id,
      firstDraft,
      prismaDiagnosisFindingRepository,
    );
    assert.equal(first.isCurrent, true);
    assert.equal(first.findings.length, 1);
    assert.equal(first.findings[0].effect.value, 74.5);
    assert.equal(first.findings[0].effect.unit, 'centipawns');
    assert.equal(first.findings[0].evidenceReferences[0].evidenceEventId, event.id);

    const repeated = await replaceCurrentDiagnosisFindingScope(
      user.id,
      firstDraft,
      prismaDiagnosisFindingRepository,
    );
    assert.equal(repeated.id, first.id, 'same materialization key must be idempotent');

    const revisedTimeFinding = baseFinding({
      producerVersion: 'time-pressure-quality-collapse-v2',
      effect: {
        metric: 'average-score-loss-delta',
        value: 81,
        unit: 'centipawns',
        direction: 'HIGHER_IS_WORSE',
        comparator: { baseline: 'NORMAL_CLOCK' },
      },
      evidenceReferences: [{
        referenceKey: 'game-' + game.id,
        referenceType: 'IMPORTED_GAME',
        importedGameId: game.id,
        sourcePlyStart: 15,
        sourcePlyEnd: 15,
        provenance: {
          aggregate: 'time-pressure-quality-collapse-v2',
          analysisSnapshotId: analysisRun.snapshotId,
        },
        representative: true,
      }],
    });
    const rootCandidate = baseFinding({
      findingKey: 'root-clock-tactics',
      diagnosisId: 'ROOT-CLOCK-TACTICS',
      findingLevel: 'ROOT_CAUSE_CANDIDATE',
      claimKey: 'root.clock-management-driving-tactical-collapse',
      producerKey: 'diagnosis-root-synthesis',
      producerVersion: 'diagnosis-synthesis-v1',
      effect: null,
      sourceVersions: {
        synthesis: 'diagnosis-synthesis-v1',
        children: ['TACT-001', 'TIME-002'],
      },
      evidenceReferences: [{
        referenceKey: 'root-support-' + game.id,
        referenceType: 'IMPORTED_GAME',
        importedGameId: game.id,
        provenance: {
          synthesis: 'diagnosis-synthesis-v1',
          childFindingKeys: ['time-pressure-collapse'],
        },
        representative: true,
      }],
    });
    const secondDraft = {
      ...findingSet(
        randomUUID().replaceAll('-', ''),
        revisedTimeFinding,
        'finding-materialization-v2',
      ),
      findings: [revisedTimeFinding, rootCandidate],
    };

    const second = await replaceCurrentDiagnosisFindingScope(
      user.id,
      secondDraft,
      prismaDiagnosisFindingRepository,
    );
    assert.notEqual(second.id, first.id);
    assert.equal(second.isCurrent, true);
    const persistedTimeFinding = second.findings.find(
      (finding) => finding.findingKey === 'time-pressure-collapse',
    );
    const persistedRootCandidate = second.findings.find(
      (finding) => finding.findingKey === 'root-clock-tactics',
    );
    assert.equal(
      persistedTimeFinding?.producerVersion,
      'time-pressure-quality-collapse-v2',
    );
    assert.equal(persistedRootCandidate?.findingLevel, 'ROOT_CAUSE_CANDIDATE');
    assert.equal(persistedRootCandidate?.producerKey, 'diagnosis-root-synthesis');

    const historical = await prisma.diagnosisFindingSet.findUniqueOrThrow({
      where: { id: first.id },
    });
    assert.equal(historical.isCurrent, false);
    assert.ok(historical.supersededAt);

    const current = await prismaDiagnosisFindingRepository.getCurrentScope(
      user.id,
      firstDraft.scopeKey,
    );
    assert.equal(current.id, second.id);

    await assert.rejects(
      () => replaceCurrentDiagnosisFindingScope(
        user.id,
        firstDraft,
        prismaDiagnosisFindingRepository,
      ),
      /already been superseded/,
    );

    const sourceGame = await prisma.importedGame.findUnique({ where: { id: game.id } });
    const sourceEvent = await prisma.evidenceEvent.findUnique({ where: { id: event.id } });
    assert.ok(sourceGame, 'finding recalculation must not delete imported-game source facts');
    assert.ok(sourceEvent, 'finding recalculation must not delete evidence source facts');

    const foreignSourceDraft = findingSet(
      randomUUID().replaceAll('-', ''),
      baseFinding({
        findingKey: 'foreign-source',
        evidenceReferences: [{
          referenceKey: 'foreign-game',
          referenceType: 'IMPORTED_GAME',
          importedGameId: otherGame.id,
          provenance: { fixture: true },
        }],
      }),
      'finding-materialization-v3',
    );
    await assert.rejects(
      () => replaceCurrentDiagnosisFindingScope(
        user.id,
        foreignSourceDraft,
        prismaDiagnosisFindingRepository,
      ),
      /outside the owned player scope/,
    );

    const mixedSourceDraft = findingSet(
      randomUUID().replaceAll('-', ''),
      baseFinding({
        findingKey: 'mixed-source',
        evidenceReferences: [{
          referenceKey: 'mixed-game-and-event',
          referenceType: 'EVIDENCE_EVENT',
          importedGameId: game.id,
          evidenceEventId: otherEvent.id,
          provenance: { fixture: true },
        }],
      }),
      'finding-materialization-v4',
    );
    await assert.rejects(
      () => replaceCurrentDiagnosisFindingScope(
        user.id,
        mixedSourceDraft,
        prismaDiagnosisFindingRepository,
      ),
      /combines sources from different games/,
    );

    await prisma.evidenceRun.update({
      where: { id: otherEvidenceRun.id },
      data: {
        isCurrent: false,
        supersededAt: new Date('2026-09-22T04:04:00.000Z'),
      },
    });
    const staleEvidenceDraft = findingSet(
      randomUUID().replaceAll('-', ''),
      baseFinding({
        findingKey: 'stale-evidence',
        evidenceReferences: [{
          referenceKey: 'stale-event',
          referenceType: 'EVIDENCE_EVENT',
          evidenceEventId: otherEvent.id,
          provenance: { fixture: true },
        }],
      }),
      'finding-materialization-v5',
    );
    await assert.rejects(
      () => replaceCurrentDiagnosisFindingScope(
        user.id,
        staleEvidenceDraft,
        prismaDiagnosisFindingRepository,
      ),
      /not current and succeeded/,
    );

    const currentAfterRejectedWrite = await prismaDiagnosisFindingRepository.getCurrentScope(
      user.id,
      firstDraft.scopeKey,
    );
    assert.equal(
      currentAfterRejectedWrite.id,
      second.id,
      'rejected replacement must leave the current scope unchanged',
    );
  } finally {
    if (userId !== null) {
      await prisma.appUser.delete({ where: { id: userId } }).catch(() => {});
    }
    if (otherUserId !== null) {
      await prisma.appUser.delete({ where: { id: otherUserId } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
});

test('finding-set validation enforces Phase 5 boundedness and representative limits', () => {
  const tooManyFindings = {
    ...findingSet('bounded-findings', baseFinding()),
    findings: Array.from({ length: 201 }, (_, index) => baseFinding({
      findingKey: 'finding-' + index,
      diagnosisId: 'FIXTURE-' + index,
    })),
  };
  assert.throws(
    () => validateDiagnosisFindingSetDraft(1, tooManyFindings),
    /current-finding bound/,
  );

  const tooManyRepresentatives = findingSet(
    'bounded-representatives',
    baseFinding({
      evidenceReferences: Array.from({ length: 4 }, (_, index) => ({
        referenceKey: 'representative-' + index,
        referenceType: 'IMPORTED_GAME',
        importedGameId: index + 1,
        provenance: { fixture: index },
        representative: true,
      })),
    }),
  );
  assert.throws(
    () => validateDiagnosisFindingSetDraft(1, tooManyRepresentatives),
    /representative-example bound/,
  );
});

test('root-cause candidates use the same canonical lifecycle without detector-only fields', () => {
  const draft = findingSet(
    'root-candidate-fixture',
    baseFinding({
      findingKey: 'root-clock-tactics',
      diagnosisId: 'ROOT-CLOCK-TACTICS',
      findingLevel: 'ROOT_CAUSE_CANDIDATE',
      claimKey: 'root.clock-management-driving-tactical-collapse',
      producerKey: 'diagnosis-root-synthesis',
      producerVersion: 'diagnosis-synthesis-v1',
      sourceVersions: {
        synthesis: 'diagnosis-synthesis-v1',
        children: ['TACT-001', 'TIME-002'],
      },
      evidenceReferences: [],
    }),
  );

  assert.doesNotThrow(() => validateDiagnosisFindingSetDraft(1, draft));
});
