import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import prismaModule from '../dist/prisma.js';
import {
  prismaEvidenceRepository,
} from '../dist/modules/evidence/evidence.repository.prisma.js';
import {
  createEvidenceService,
} from '../dist/modules/evidence/evidence.service.js';
import {
  materialEvidenceDetector,
} from '../dist/modules/evidence/material-evidence.detector.js';

const prisma = prismaModule.default ?? prismaModule;

async function createPosition(label, normalizedFen = null) {
  return prisma.position.create({
    data: {
      positionKey: Buffer.from(randomUUID().replaceAll('-', ''), 'hex'),
      normalizedFen: normalizedFen ?? 'evidence-' + label + '-' + randomUUID(),
    },
  });
}

function positionAnalysis(positionId, analysisRun, scoreCpWhite, bestMove) {
  return {
    positionId,
    analysisVersion: analysisRun.analysisVersion,
    engineName: analysisRun.engineName,
    engineVersion: analysisRun.engineVersion,
    settingsHash: analysisRun.settingsHash,
    depth: 16,
    scoreCpWhite,
    mateWhite: null,
    bestMove,
    bestPv: [bestMove],
    multiPvJson: [{
      multiPv: 1,
      depth: 16,
      scoreCpWhite,
      mateWhite: null,
      pv: [bestMove],
    }],
    rawInfoJson: ['fixture'],
  };
}

function materialDetector(version, seenSnapshots) {
  return {
    key: 'fixture.material',
    version,
    requiresCompleteAnalysis: true,
    async detect(snapshot) {
      seenSnapshots.push(snapshot);
      return {
        coverage: {
          status: 'COMPLETE',
          details: {
            plies: snapshot.plies.length,
            analysisRunId: snapshot.provenance.analysis?.runId ?? null,
          },
        },
        findings: [{
          key: 'ply-1-material-loss',
          type: 'MATERIAL_STATE_CHANGE',
          source: {
            startPly: 1,
            endPly: 1,
            positionId: snapshot.plies[0].afterPositionId,
          },
          measurements: {
            scoreLossCp: snapshot.plies[0].scoreLossCp,
            classificationCode: snapshot.plies[0].classificationCode,
          },
          details: {
            moveUci: snapshot.plies[0].moveUci,
          },
        }],
      };
    },
  };
}

test('evidence persistence is idempotent, provenance-fenced, version-superseding, and claim-safe', async () => {
  const suffix = randomUUID();
  const positionIds = [];
  let userId = null;

  try {
    const user = await prisma.appUser.create({
      data: { authProvider: 'TEST', authSubject: 'evidence-' + suffix },
    });
    userId = user.id;

    const indexedAt = new Date('2026-09-12T08:15:00.000Z');
    const game = await prisma.importedGame.create({
      data: {
        appUserId: user.id,
        provider: 'LICHESS',
        providerGameId: 'evidence-' + suffix,
        connectedLichessUserId: 'fixture-user',
        connectedLichessUsername: 'FixtureUser',
        variant: 'standard',
        speedCategory: 'bullet',
        userColor: 'WHITE',
        resultForUser: 'LOSS',
        plyIndexStatus: 'INDEXED',
        plyIndexPolicyVersion: 1,
        plyIndexedAt: indexedAt,
        timingCoverageStatus: 'COMPLETE',
      },
    });

    const before = await createPosition('before');
    const after = await createPosition('after');
    positionIds.push(before.id, after.id);

    const analysisRun = await prisma.gameAnalysisRun.create({
      data: {
        importedGameId: game.id,
        analysisVersion: 'evidence-analysis-v1',
        settingsHash: 'fixture-settings',
        settingsJson: { depth: 16, multiPv: 3 },
        sourcePlyIndexedAt: indexedAt,
        engineName: 'FixtureFish',
        engineVersion: '1',
        status: 'SUCCEEDED',
        coverageStatus: 'COMPLETE',
        positionsTotal: 2,
        positionsDone: 2,
        pliesTotal: 1,
        pliesDone: 1,
        attempts: 1,
        startedAt: new Date('2026-09-12T08:15:01.000Z'),
        completedAt: new Date('2026-09-12T08:15:02.000Z'),
      },
    });

    await prisma.stockfishPositionAnalysis.createMany({
      data: [
        positionAnalysis(before.id, analysisRun, 120, 'e2e4'),
        positionAnalysis(after.id, analysisRun, 20, 'e7e5'),
      ],
    });
    await prisma.importedGamePly.create({
      data: {
        importedGameId: game.id,
        plyNumber: 1,
        beforePositionId: before.id,
        afterPositionId: after.id,
        moveUci: 'a2a3',
        moverColor: 'WHITE',
        isUserMove: true,
        engineAnalysisRunId: analysisRun.id,
        scoreLossCp: 100,
        classificationCode: 5,
      },
    });

    const v1Snapshots = [];
    const v1 = createEvidenceService({
      detectors: [materialDetector('v1', v1Snapshots)],
      repository: prismaEvidenceRepository,
      workerId: 'evidence-v1-' + suffix,
    });
    assert.equal(await v1.runOnce(), true);
    assert.equal(v1Snapshots.length, 1);
    assert.equal(v1Snapshots[0].provenance.analysis.runId, analysisRun.id);
    assert.equal(
      v1Snapshots[0].positions.every((position) => position.analysis !== null),
      true,
    );

    let current = await prismaEvidenceRepository.listCurrentEvidenceForGame(game.id);
    assert.equal(current.length, 1);
    assert.equal(current[0].detectorVersion, 'v1');
    assert.equal(current[0].coverageStatus, 'COMPLETE');
    assert.equal(current[0].events.length, 1);
    assert.equal(current[0].events[0].evidenceType, 'MATERIAL_STATE_CHANGE');
    assert.equal(current[0].events[0].measurements.scoreLossCp, 100);

    assert.equal(
      await v1.runOnce(),
      false,
      'the same detector/version/source projection must be idempotent',
    );
    assert.equal(
      await prisma.evidenceRun.count({
        where: {
          importedGameId: game.id,
          detectorKey: 'fixture.material',
          detectorVersion: 'v1',
        },
      }),
      1,
    );

    const v2Snapshots = [];
    const v2 = createEvidenceService({
      detectors: [materialDetector('v2', v2Snapshots)],
      repository: prismaEvidenceRepository,
      workerId: 'evidence-v2-' + suffix,
    });
    assert.equal(await v2.runOnce(), true);
    current = await prismaEvidenceRepository.listCurrentEvidenceForGame(game.id);
    assert.equal(current.length, 1);
    assert.equal(current[0].detectorVersion, 'v2');

    const historical = await prisma.evidenceRun.findMany({
      where: {
        importedGameId: game.id,
        detectorKey: 'fixture.material',
      },
      orderBy: { id: 'asc' },
      include: { events: true },
    });
    assert.equal(historical.length, 2);
    assert.equal(historical[0].detectorVersion, 'v1');
    assert.equal(historical[0].isCurrent, false);
    assert.ok(historical[0].supersededAt);
    assert.equal(historical[0].events.length, 1);
    assert.equal(historical[1].detectorVersion, 'v2');
    assert.equal(historical[1].isCurrent, true);

    const movedAt = new Date('2026-09-12T08:20:00.000Z');
    await prisma.importedGame.update({
      where: { id: game.id },
      data: { plyIndexedAt: movedAt },
    });
    current = await prismaEvidenceRepository.listCurrentEvidenceForGame(game.id);
    assert.deepEqual(
      current,
      [],
      'stale current evidence must disappear immediately when the indexed source moves',
    );

    const replacementAnalysisRun = await prisma.gameAnalysisRun.create({
      data: {
        importedGameId: game.id,
        analysisVersion: analysisRun.analysisVersion,
        settingsHash: analysisRun.settingsHash,
        settingsJson: analysisRun.settingsJson,
        sourcePlyIndexedAt: movedAt,
        engineName: analysisRun.engineName,
        engineVersion: analysisRun.engineVersion,
        status: 'SUCCEEDED',
        coverageStatus: 'COMPLETE',
        positionsTotal: 2,
        positionsDone: 2,
        pliesTotal: 1,
        pliesDone: 1,
        attempts: 1,
        startedAt: new Date('2026-09-12T08:20:01.000Z'),
        completedAt: new Date('2026-09-12T08:20:02.000Z'),
      },
    });
    await prisma.importedGamePly.update({
      where: {
        importedGameId_plyNumber: {
          importedGameId: game.id,
          plyNumber: 1,
        },
      },
      data: { engineAnalysisRunId: replacementAnalysisRun.id },
    });

    assert.equal(
      await v2.runOnce(),
      true,
      'the same detector version must become eligible for a new immutable source projection',
    );
    current = await prismaEvidenceRepository.listCurrentEvidenceForGame(game.id);
    assert.equal(current.length, 1);
    assert.equal(current[0].detectorVersion, 'v2');
    assert.equal(
      current[0].sourcePlyIndexedAt.getTime(),
      movedAt.getTime(),
    );
    assert.equal(current[0].sourceAnalysisRunId, replacementAnalysisRun.id);

    const afterSourceReplacement = await prisma.evidenceRun.findMany({
      where: {
        importedGameId: game.id,
        detectorKey: 'fixture.material',
      },
      orderBy: { id: 'asc' },
      include: { events: true },
    });
    assert.equal(afterSourceReplacement.length, 3);
    assert.equal(afterSourceReplacement[1].detectorVersion, 'v2');
    assert.equal(afterSourceReplacement[1].isCurrent, false);
    assert.equal(afterSourceReplacement[1].events.length, 1);
    assert.equal(afterSourceReplacement[2].detectorVersion, 'v2');
    assert.equal(afterSourceReplacement[2].isCurrent, true);
    assert.equal(afterSourceReplacement[2].events.length, 1);

    const noAnalysisDetector = {
      key: 'fixture.no-analysis',
      version: 'v1',
      requiresCompleteAnalysis: false,
    };
    const queuedId = await prismaEvidenceRepository.enqueueEligibleRun(noAnalysisDetector);
    assert.ok(queuedId);
    const oldClaim = await prismaEvidenceRepository.claimNext(
      'old-worker',
      [noAnalysisDetector],
    );
    assert.equal(oldClaim.id, queuedId);
    assert.equal(oldClaim.importedGameId, game.id);

    const noAnalysisSnapshot = await prismaEvidenceRepository.loadSnapshot(oldClaim);
    assert.equal(noAnalysisSnapshot.provenance.analysis, null);
    assert.equal(noAnalysisSnapshot.plies[0].engineAnalysisRunId, null);
    assert.equal(noAnalysisSnapshot.plies[0].scoreLossCp, null);
    assert.equal(noAnalysisSnapshot.plies[0].classificationCode, null);

    await prisma.evidenceRun.update({
      where: { id: queuedId },
      data: { heartbeatAt: new Date('2000-01-01T00:00:00.000Z') },
    });
    assert.equal(
      await prismaEvidenceRepository.recoverStaleRuns(new Date('2026-09-12T08:30:00.000Z')),
      1,
    );
    const newClaim = await prismaEvidenceRepository.claimNext(
      'new-worker',
      [noAnalysisDetector],
    );
    assert.equal(newClaim.id, queuedId);
    assert.notEqual(newClaim.claimToken, oldClaim.claimToken);

    assert.equal(
      await prismaEvidenceRepository.completeRun(oldClaim, {
        coverage: { status: 'COMPLETE' },
        findings: [],
      }),
      false,
      'an expired claim must be fenced from publishing late evidence',
    );
    assert.equal(
      await prismaEvidenceRepository.completeRun(newClaim, {
        coverage: { status: 'UNAVAILABLE', reason: 'fixture-no-analysis' },
        findings: [{
          key: 'coverage',
          type: 'FIXTURE_COVERAGE',
          availability: 'UNAVAILABLE',
          measurements: {},
          unavailableReason: 'fixture-no-analysis',
        }],
      }),
      true,
    );
    const settled = await prisma.evidenceRun.findUniqueOrThrow({
      where: { id: queuedId },
    });
    assert.equal(settled.status, 'SUCCEEDED');
    assert.equal(settled.coverageStatus, 'UNAVAILABLE');
    assert.equal(settled.isCurrent, true);
  } finally {
    if (userId !== null) {
      await prisma.appUser.delete({ where: { id: userId } }).catch(() => {});
    }
    if (positionIds.length > 0) {
      await prisma.stockfishPositionAnalysis.deleteMany({
        where: { positionId: { in: positionIds } },
      }).catch(() => {});
      await prisma.position.deleteMany({
        where: { id: { in: positionIds } },
      }).catch(() => {});
    }
    await prisma.$disconnect();
  }
});


test('material evidence worker publishes board facts before analysis and refreshes after complete analysis', async () => {
  const suffix = randomUUID();
  const positionIds = [];
  let userId = null;

  try {
    const user = await prisma.appUser.create({
      data: { authProvider: 'TEST', authSubject: 'material-refresh-' + suffix },
    });
    userId = user.id;

    const indexedAt = new Date('2026-09-12T10:30:00.000Z');
    const game = await prisma.importedGame.create({
      data: {
        appUserId: user.id,
        provider: 'LICHESS',
        providerGameId: 'material-refresh-' + suffix,
        connectedLichessUserId: 'fixture-user',
        connectedLichessUsername: 'FixtureUser',
        variant: 'standard',
        speedCategory: 'bullet',
        userColor: 'WHITE',
        resultForUser: 'WIN',
        plyIndexStatus: 'INDEXED',
        plyIndexPolicyVersion: 1,
        plyIndexedAt: indexedAt,
        timingCoverageStatus: 'COMPLETE',
      },
    });

    const before = await createPosition(
      'material-before',
      '4k3/8/8/3q4/2B5/8/8/4K3 w - -',
    );
    const after = await createPosition(
      'material-after',
      '4k3/8/8/3B4/8/8/8/4K3 b - -',
    );
    positionIds.push(before.id, after.id);

    await prisma.importedGamePly.create({
      data: {
        importedGameId: game.id,
        plyNumber: 1,
        beforePositionId: before.id,
        afterPositionId: after.id,
        moveUci: 'c4d5',
        moverColor: 'WHITE',
        isUserMove: true,
      },
    });

    const service = createEvidenceService({
      detectors: [materialEvidenceDetector],
      repository: prismaEvidenceRepository,
      workerId: 'material-refresh-' + suffix,
    });

    assert.equal(
      await service.runOnce(),
      true,
      'board-only material evidence must run before Stockfish coverage exists',
    );

    let current = await prismaEvidenceRepository.listCurrentEvidenceForGame(game.id);
    assert.equal(current.length, 1);
    assert.equal(current[0].sourceAnalysisRunId, null);
    assert.equal(current[0].coverageStatus, 'INCOMPLETE');
    assert.equal(
      current[0].events.some((event) => event.evidenceType === 'MATERIAL_STATE_CHANGE'),
      true,
    );
    const initialGap = current[0].events.find(
      (event) => event.evidenceType === 'MATERIAL_EVIDENCE_COVERAGE_GAP',
    );
    assert.ok(initialGap);
    assert.equal(initialGap.availability, 'UNAVAILABLE');
    assert.equal(
      initialGap.unavailableReason,
      'complete-engine-analysis-unavailable',
    );

    const analysisRun = await prisma.gameAnalysisRun.create({
      data: {
        importedGameId: game.id,
        analysisVersion: 'material-refresh-v1',
        settingsHash: 'material-refresh-settings',
        settingsJson: { depth: 16, multiPv: 3 },
        sourcePlyIndexedAt: indexedAt,
        engineName: 'FixtureFish',
        engineVersion: '1',
        status: 'SUCCEEDED',
        coverageStatus: 'COMPLETE',
        positionsTotal: 2,
        positionsDone: 2,
        pliesTotal: 1,
        pliesDone: 1,
        attempts: 1,
        startedAt: new Date('2026-09-12T10:30:01.000Z'),
        completedAt: new Date('2026-09-12T10:30:02.000Z'),
      },
    });
    await prisma.stockfishPositionAnalysis.createMany({
      data: [
        positionAnalysis(before.id, analysisRun, -600, 'c4d5'),
        positionAnalysis(after.id, analysisRun, 300, 'e8e7'),
      ],
    });
    await prisma.importedGamePly.update({
      where: {
        importedGameId_plyNumber: {
          importedGameId: game.id,
          plyNumber: 1,
        },
      },
      data: {
        engineAnalysisRunId: analysisRun.id,
        scoreLossCp: 0,
        classificationCode: 0,
      },
    });

    assert.equal(
      await service.runOnce(),
      true,
      'complete Stockfish coverage must create a new immutable material evidence projection',
    );

    current = await prismaEvidenceRepository.listCurrentEvidenceForGame(game.id);
    assert.equal(current.length, 1);
    assert.equal(current[0].sourceAnalysisRunId, analysisRun.id);
    assert.equal(current[0].coverageStatus, 'COMPLETE');
    assert.equal(
      current[0].events.some(
        (event) => event.evidenceType === 'MATERIAL_EVIDENCE_COVERAGE_GAP',
      ),
      false,
    );
    assert.equal(
      current[0].events.some((event) => event.evidenceType === 'MATERIAL_STATE_CHANGE'),
      true,
    );

    const historical = await prisma.evidenceRun.findMany({
      where: {
        importedGameId: game.id,
        detectorKey: materialEvidenceDetector.key,
        detectorVersion: materialEvidenceDetector.version,
      },
      orderBy: { id: 'asc' },
    });
    assert.equal(historical.length, 2);
    assert.equal(historical[0].sourceAnalysisRunId, null);
    assert.equal(historical[0].isCurrent, false);
    assert.ok(historical[0].supersededAt);
    assert.equal(historical[1].sourceAnalysisRunId, analysisRun.id);
    assert.equal(historical[1].isCurrent, true);
  } finally {
    if (userId !== null) {
      await prisma.appUser.delete({ where: { id: userId } }).catch(() => {});
    }
    if (positionIds.length > 0) {
      await prisma.stockfishPositionAnalysis.deleteMany({
        where: { positionId: { in: positionIds } },
      }).catch(() => {});
      await prisma.position.deleteMany({
        where: { id: { in: positionIds } },
      }).catch(() => {});
    }
    await prisma.$disconnect();
  }
});


test('late board-only publication cannot supersede an already published analysis-backed projection', async () => {
  const suffix = randomUUID();
  const positionIds = [];
  let userId = null;

  try {
    const user = await prisma.appUser.create({
      data: { authProvider: 'TEST', authSubject: 'evidence-race-' + suffix },
    });
    userId = user.id;

    const indexedAt = new Date('2026-09-12T11:00:00.000Z');
    const game = await prisma.importedGame.create({
      data: {
        appUserId: user.id,
        provider: 'LICHESS',
        providerGameId: 'evidence-race-' + suffix,
        connectedLichessUserId: 'fixture-user',
        connectedLichessUsername: 'FixtureUser',
        variant: 'standard',
        speedCategory: 'bullet',
        userColor: 'WHITE',
        resultForUser: 'LOSS',
        plyIndexStatus: 'INDEXED',
        plyIndexPolicyVersion: 1,
        plyIndexedAt: indexedAt,
        timingCoverageStatus: 'COMPLETE',
      },
    });

    const before = await createPosition('race-before');
    const after = await createPosition('race-after');
    positionIds.push(before.id, after.id);
    await prisma.importedGamePly.create({
      data: {
        importedGameId: game.id,
        plyNumber: 1,
        beforePositionId: before.id,
        afterPositionId: after.id,
        moveUci: 'a2a3',
        moverColor: 'WHITE',
        isUserMove: true,
      },
    });

    const detectorKey = 'fixture.material-race-' + suffix;
    const detector = {
      key: detectorKey,
      version: 'v1',
      requiresCompleteAnalysis: false,
      refreshOnCompleteAnalysis: true,
    };

    const boardRun = await prisma.evidenceRun.create({
      data: {
        importedGameId: game.id,
        detectorKey,
        detectorVersion: detector.version,
        workKey: 'board-' + suffix,
        sourcePlyIndexedAt: indexedAt,
      },
    });
    const boardClaim = await prismaEvidenceRepository.claimNext(
      'board-race-' + suffix,
      [detector],
    );
    assert.equal(boardClaim.id, boardRun.id);
    assert.equal(boardClaim.sourceAnalysisRunId, null);

    const analysisRun = await prisma.gameAnalysisRun.create({
      data: {
        importedGameId: game.id,
        analysisVersion: 'race-analysis-v1',
        settingsHash: 'race-settings-' + suffix,
        settingsJson: { depth: 16, multiPv: 3 },
        sourcePlyIndexedAt: indexedAt,
        engineName: 'FixtureFish',
        engineVersion: '1',
        status: 'SUCCEEDED',
        coverageStatus: 'COMPLETE',
        positionsTotal: 2,
        positionsDone: 2,
        pliesTotal: 1,
        pliesDone: 1,
        attempts: 1,
        startedAt: new Date('2026-09-12T11:00:01.000Z'),
        completedAt: new Date('2026-09-12T11:00:02.000Z'),
      },
    });
    await prisma.importedGamePly.update({
      where: {
        importedGameId_plyNumber: {
          importedGameId: game.id,
          plyNumber: 1,
        },
      },
      data: {
        engineAnalysisRunId: analysisRun.id,
        scoreLossCp: 100,
        classificationCode: 5,
      },
    });

    const analysisEvidenceRun = await prisma.evidenceRun.create({
      data: {
        importedGameId: game.id,
        detectorKey,
        detectorVersion: detector.version,
        workKey: 'analysis-' + suffix,
        sourcePlyIndexedAt: indexedAt,
        sourceAnalysisRunId: analysisRun.id,
        sourceAnalysisSnapshotId: analysisRun.snapshotId,
      },
    });
    const analysisClaim = await prismaEvidenceRepository.claimNext(
      'analysis-race-' + suffix,
      [detector],
    );
    assert.equal(analysisClaim.id, analysisEvidenceRun.id);
    assert.equal(analysisClaim.sourceAnalysisRunId, analysisRun.id);
    assert.equal(
      await prismaEvidenceRepository.completeRun(analysisClaim, {
        coverage: { status: 'COMPLETE' },
        findings: [],
      }),
      true,
    );

    let current = await prismaEvidenceRepository.listCurrentEvidenceForGame(game.id);
    assert.equal(current.length, 1);
    assert.equal(current[0].id, analysisEvidenceRun.id);
    assert.equal(current[0].sourceAnalysisRunId, analysisRun.id);

    assert.equal(
      await prismaEvidenceRepository.completeRun(boardClaim, {
        coverage: {
          status: 'INCOMPLETE',
          reason: 'complete-engine-analysis-unavailable',
        },
        findings: [],
      }),
      false,
      'a late board-only result must be fenced after analysis-backed publication',
    );
    await prismaEvidenceRepository.markFailure(
      boardClaim,
      'Evidence source projection changed before completion.',
    );

    const staleBoardRun = await prisma.evidenceRun.findUniqueOrThrow({
      where: { id: boardRun.id },
    });
    assert.equal(staleBoardRun.status, 'SUPERSEDED');
    assert.equal(staleBoardRun.isCurrent, false);
    assert.ok(staleBoardRun.supersededAt);

    current = await prismaEvidenceRepository.listCurrentEvidenceForGame(game.id);
    assert.equal(current.length, 1);
    assert.equal(current[0].id, analysisEvidenceRun.id);
    assert.equal(current[0].sourceAnalysisRunId, analysisRun.id);
  } finally {
    if (userId !== null) {
      await prisma.appUser.delete({ where: { id: userId } }).catch(() => {});
    }
    if (positionIds.length > 0) {
      await prisma.position.deleteMany({
        where: { id: { in: positionIds } },
      }).catch(() => {});
    }
    await prisma.$disconnect();
  }
});
