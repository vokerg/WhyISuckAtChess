import { prismaDiagnosisFindingRepository } from '../dist/modules/diagnosis/diagnosis-finding.repository.prisma.js';
import { prismaDiagnosisRelationshipRepository } from '../dist/modules/diagnosis/diagnosis-relationship.repository.prisma.js';
import { prismaDiagnosisConsolidationRepository } from '../dist/modules/diagnosis/diagnosis-consolidation.repository.prisma.js';
import { prismaDiagnosisRankingRepository } from '../dist/modules/diagnosis/diagnosis-ranking.repository.prisma.js';
import { materializeCurrentDiagnosisRelationshipGraph } from '../dist/modules/diagnosis/diagnosis-relationship.service.js';
import { materializeCurrentDiagnosisConsolidation } from '../dist/modules/diagnosis/diagnosis-consolidation.service.js';
import { materializeCurrentDiagnosisRanking } from '../dist/modules/diagnosis/diagnosis-ranking.service.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import prismaModule from '../dist/prisma.js';
import { buildApp } from '../dist/app.js';
import { createLichessAccountImportService } from '../dist/modules/account-imports/account-import.service.js';
import { ImportedGamePlyIndexService } from '../dist/modules/imported-games/ply-index.service.js';
import { createStockfishAnalysisService } from '../dist/modules/engine-analysis/engine-analysis.service.js';
import { createEvidenceService } from '../dist/modules/evidence/evidence.service.js';
import { evidenceDetectors } from '../dist/modules/evidence/evidence.registry.js';
import { createDiagnosisWorkerService } from '../dist/modules/diagnosis/diagnosis-worker.service.js';
import { loadDiagnosisSourceSnapshot } from '../dist/modules/diagnosis/diagnosis-source.repository.prisma.js';
import { diagnosisMaterializationVersions } from '../dist/modules/diagnosis/diagnosis-materialization.versions.js';
import { materializeDiagnosis } from '../dist/modules/diagnosis/diagnosis-materialization.service.js';
import { prismaSessionDeteriorationRepository } from '../dist/modules/diagnosis/session-deterioration.repository.prisma.js';
import { diagnosisSummaryService } from '../dist/modules/diagnosis/diagnosis-summary.service.js';
import { runWorkerCycle } from '../dist/worker.js';
const prisma = prismaModule.default ?? prismaModule;

async function appFor(userId) {
  return buildApp({ prisma: { $disconnect: async () => {} }, authConfig: { mode: 'dev-single-user' },
    currentUserService: { resolveDevUser: async () => ({ auth: { userId, provider: 'dev', externalSubject: 'diagnosis-acceptance' } }), resolveExternalUser: async () => { throw Error('unused'); } } });
}

// Deterministic recorded NDJSON-shaped fixture, legal moves, synthetic clocks
// and identities; no live Lichess call and no claim of real engine adjudication.
function recordedGame(i, suffix) {
  const increment = i % 2 === 0 ? 0 : 2;
  const winner = increment ? 'white' : 'black';
  const result = increment ? '1-0' : '0-1';
  return {
    id: `diagnosis-${suffix}-${i}`, rated: true, variant: 'standard', speed: 'blitz', perf: 'blitz',
    createdAt: Date.parse('2026-09-10T10:00:00Z') + i * 120000,
    lastMoveAt: Date.parse('2026-09-10T10:01:00Z') + i * 120000,
    status: 'resign', winner, clock: { initial: 180, increment },
    clocks: increment ? [17900,17900,17800,17800] : [1000,17900,800,17800],
    players: { white: { user: { id: 'recorded-player', name: 'RecordedPlayer' }, rating: 1500 }, black: { user: { id: 'recorded-opponent', name: 'RecordedOpponent' }, rating: 1500 } },
    pgn: `[White "RecordedPlayer"]\n[Black "RecordedOpponent"]\n[Result "${result}"]\n[TimeControl "180+${increment}"]\n\n1. e4 e5 2. Nf3 Nc6 ${result}`,
  };
}

test('real persisted import -> analysis/evidence -> diagnosis lifecycle, API and recovery', async () => {
  const suffix = randomUUID();
  const user = await prisma.appUser.create({ data: { authProvider: 'TEST', authSubject: suffix } });
  const other = await prisma.appUser.create({ data: { authProvider: 'TEST', authSubject: suffix + '-other' } });
  let app; let otherApp; let browser;
  let clock = new Date();
  const worker = createDiagnosisWorkerService({ appUserId: user.id, now: () => clock });
  const advance = () => { clock = new Date(Math.max(clock.getTime() + 5000, Date.now())); };
  try {
    app = await appFor(user.id); otherApp = await appFor(other.id);
    let summary = (await app.inject('/api/diagnosis/summary?scopeKey=overall')).json();
    assert.equal(summary.refresh.state, 'NO_SOURCE');
    if (process.env.RUN_DIAGNOSIS_BROWSER_ACCEPTANCE === '1') {
      const apiOrigin = await app.listen({ host: '127.0.0.1', port: 0 });
      const { startDiagnosisBrowser } = await import('../../web/e2e/diagnosis-worker-browser.mjs');
      browser = await startDiagnosisBrowser(apiOrigin);
      await browser.page.getByText('Connect Lichess and import games to build evidence.').waitFor();
    }
    await worker.runOnce();
    summary = await diagnosisSummaryService.getSummary(user.id, 'overall');
    assert.equal(summary.status, 'AVAILABLE', JSON.stringify(summary)); assert.equal(summary.items.length, 0);
    assert.equal(summary.refresh.state, 'NO_SOURCE');
    const imports = createLichessAccountImportService({
      connectionService: { getCredentialForUser: async () => ({ lichessUserId: 'recorded-player', username: 'RecordedPlayer', accessToken: 'recorded-token', credentialGeneration: 'recorded-generation' }), markCredentialRevokedForUser: async () => true },
      fetchImpl: async () => new Response(Array.from({ length: 80 }, (_, i) => JSON.stringify(recordedGame(i, suffix))).join('\n') + '\n'),
    });
    const requested = await imports.requestImport(user.id, { from: new Date('2026-09-10T00:00:00Z'), to: new Date('2026-09-11T00:00:00Z'), rated: true });
    await prisma.importRun.update({ where: { id: requested.id }, data: { status: 'RUNNING', startedAt: new Date(), claimedAt: new Date(), heartbeatAt: new Date() } });
    const run = await imports.getRun(user.id, requested.id);
    assert.equal((await imports.executeRun(run)).status, 'COMPLETED');
    const games = await prisma.importedGame.findMany({ where: { appUserId: user.id }, orderBy: { id: 'asc' } });
    assert.equal(games.length, 80);
    summary = await diagnosisSummaryService.getSummary(user.id, 'overall');
    assert.equal(summary.status, 'UNAVAILABLE'); assert.equal(summary.refresh.state, 'PROCESSING');
    if (browser) {
      await browser.page.reload();
      await browser.page.getByText('Your imported games are still being indexed or analysed.').waitFor();
    }
    for (const game of games) await ImportedGamePlyIndexService.indexOne(user.id, game.id);
    advance(); await worker.runOnce();
    assert.equal((await diagnosisSummaryService.getSummary(user.id, 'overall')).status, 'UNAVAILABLE', 'unscheduled analysis must prevent publication');
    const analysis = createStockfishAnalysisService({ engineFactory: async () => ({
      engineName: 'DiagnosisAcceptanceDouble-' + suffix, engineVersion: '1',
      async analyzeFen(fen) {
        // A bounded fixture evaluation drop after White's Nf3 creates repeated
        // early-move evidence. Accepted engine/evidence services derive facts.
        const bad = fen.split(' ')[0].includes('5N2');
        return { depth: 8, scoreCpWhite: bad ? -400 : 0, mateWhite: null, bestMove: null, bestPv: [], multiPv: [], rawInfo: ['diagnosis acceptance engine double'] };
      }, close: async () => {},
    }) });
    const evidence = createEvidenceService({ detectors: evidenceDetectors });
    const noop = { runOnce: async () => false };
    for (let i = 0; i < 650; i++) {
      advance();
      await runWorkerCycle({ importService: noop, plyIndexService: noop, analysisService: analysis, evidenceService: evidence, diagnosisService: worker });
      const job = await prisma.diagnosisMaterializationJob.findUnique({ where: { appUserId_scopeKey: { appUserId: user.id, scopeKey: 'overall' } } });
      if (job.status === 'FAILED') assert.fail('publication failed: ' + job.errorCode);
      if (job.status === 'SUCCEEDED') break;
    }
    summary = (await app.inject('/api/diagnosis/summary?scopeKey=overall')).json();
    assert.equal(summary.status, 'AVAILABLE', JSON.stringify(summary));
    assert.equal(summary.refresh.state, 'READY');
    assert.equal(await prisma.evidenceRun.count({where:{importedGame:{appUserId:user.id},detectorKey:'phase-context',status:'SUCCEEDED',isCurrent:true,sourceAnalysisRunId:null}}),80,'pure phase geometry remains valid after complete analysis');
    if (browser) {
      await browser.page.getByRole('button', { name: 'Check again' }).click();
      await browser.page.getByRole('list', { name: 'Ranked diagnosis findings' }).waitFor();
      await browser.page.getByText('Diagnosis processing is complete.').waitFor();
    }
    assert.ok(summary.items.some((item) => item.diagnosisId === 'TIME-005'), JSON.stringify(summary));
    const opening = summary.items.find((item) => item.diagnosisId === 'OPEN-002');
    assert.ok(opening, 'persisted repeated opening error');
    assert.ok(opening.representativeEvidence.length > 0);
    const detail = (await app.inject(`/api/diagnosis/findings/${opening.findingId}?scopeKey=overall`)).json();
    assert.equal(detail.status, 'AVAILABLE');
    const ref = opening.representativeEvidence[0];
    const replay = await app.inject(`/api/imported-games/${ref.importedGameId}/replay`);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.ok(ref.sourcePlyStart > 0);
    const comparison = await app.inject('/api/diagnosis/time-controls');
    assert.equal(comparison.statusCode, 200, comparison.body);
    const alien = (await otherApp.inject(`/api/diagnosis/findings/${opening.findingId}?scopeKey=overall`)).json();
    assert.equal(alien.status, 'UNAVAILABLE');
    assert.notEqual((await otherApp.inject(`/api/imported-games/${ref.importedGameId}/replay`)).statusCode, 200);
    // Detector rollout must ignore unclaimable historical queue rows.
    const sourceAnalysis = await prisma.gameAnalysisRun.findFirstOrThrow({ where: { importedGameId:games[0].id, status:'SUCCEEDED' }, orderBy:{id:'desc'} });
    await prisma.evidenceRun.create({ data: {
      importedGameId: games[0].id, detectorKey:'opening-context', detectorVersion:'opening-v1', workKey:randomUUID(),
      sourcePlyIndexedAt: sourceAnalysis.sourcePlyIndexedAt, sourceAnalysisRunId:sourceAnalysis.id,
      sourceAnalysisSnapshotId:sourceAnalysis.snapshotId, status:'QUEUED',
    } });
    assert.equal((await loadDiagnosisSourceSnapshot(user.id)).pending, false, 'obsolete detector work cannot block current readiness');
    advance(); await worker.runOnce();
    summary = await diagnosisSummaryService.getSummary(user.id, 'overall');
    const firstId = summary.findingSetId;
    advance(); await worker.runOnce();
    assert.equal((await diagnosisSummaryService.getSummary(user.id, 'overall')).findingSetId, firstId, 'idempotent scan');
    // Source mutation invalidates reads immediately, then creates an immutable
    // replacement. This also covers partial clock data without inventing facts.
    await prisma.importedGame.update({ where: { id: games[0].id }, data: { updatedAt: new Date(clock.getTime() + 1) } });
    assert.equal((await diagnosisSummaryService.getSummary(user.id, 'overall')).status, 'UNAVAILABLE');
    advance(); await worker.runOnce();
    summary = await diagnosisSummaryService.getSummary(user.id, 'overall');
    assert.equal(summary.status, 'AVAILABLE', JSON.stringify(summary)); assert.notEqual(summary.findingSetId, firstId);
    assert.equal((await prisma.diagnosisFindingSet.findUnique({ where: { id: firstId } })).isCurrent, false);
    // Crash mid-composition rolls back all revisions; durable retry publishes.
    await prisma.importedGame.update({ where: { id: games[0].id }, data: { updatedAt: new Date(clock.getTime() + 1) } });
    const beforeCrash = summary.findingSetId;
    const crashing = createDiagnosisWorkerService({ appUserId: user.id, now: () => clock, publish: async (...args) => { await materializeDiagnosis(...args); throw Error('simulated crash before commit'); } });
    advance(); await crashing.runOnce();
    assert.equal((await prisma.diagnosisFindingSet.findUnique({ where: { id: beforeCrash } })).isCurrent, true);
    advance(); await worker.runOnce();
    assert.equal((await diagnosisSummaryService.getSummary(user.id, 'overall')).status, 'AVAILABLE');
    // Competing workers claim only once and a restarted stale claim recovers.
    const key = (await loadDiagnosisSourceSnapshot(user.id)).key;
    const where = { appUserId_scopeKey: { appUserId: user.id, scopeKey: 'overall' } };
    await prisma.diagnosisMaterializationJob.update({ where, data: { sourceKey: key, status: 'RUNNING', claimToken: 'dead-worker', heartbeatAt: new Date(clock.getTime() - 600000), attempts: 1 } });
    advance(); await Promise.all([worker.runOnce(), createDiagnosisWorkerService({ appUserId: user.id, now: () => clock }).runOnce()]);
    assert.equal((await prisma.diagnosisMaterializationJob.findUnique({ where })).status, 'SUCCEEDED');
    // Root continuation uses a distinct immutable materialization key. Retain
    // the actual accepted leaves/hierarchy here and prove same-source recovery
    // reads the final revision even after its leaf key has been superseded.
    const parent = await prismaDiagnosisFindingRepository.getCurrentScope(user.id,'overall',diagnosisMaterializationVersions);
    const continuation = await prismaDiagnosisFindingRepository.replaceCurrentScope(user.id, {
      ...diagnosisMaterializationVersions, materializationKey:'root-synth-v1-source-'+parent.id,
      scopeKey:'overall',scope:parent.scope,calculationAsOf:parent.calculationAsOf,
      findings:parent.findings,
    });
    await materializeCurrentDiagnosisRelationshipGraph(user.id,'overall',diagnosisMaterializationVersions,prismaDiagnosisRelationshipRepository);
    await materializeCurrentDiagnosisConsolidation(user.id,'overall',diagnosisMaterializationVersions,prismaDiagnosisConsolidationRepository);
    await materializeCurrentDiagnosisRanking(user.id,'overall',diagnosisMaterializationVersions,prismaDiagnosisRankingRepository);
    await prisma.diagnosisMaterializationJob.update({where,data:{status:'QUEUED',attempts:0,runAfter:clock}});
    advance(); await worker.runOnce();
    assert.equal((await prisma.diagnosisMaterializationJob.findUnique({where})).findingSetId,continuation.id);
    // A calculation-policy rollout changes work identity and hides the old
    // ranking even before the scanner has run; no source mutation is required.
    const oldCalculationVersion = diagnosisMaterializationVersions.calculationVersion;
    try {
      diagnosisMaterializationVersions.calculationVersion = 'diagnosis-materialization-rollout-test';
      assert.equal((await diagnosisSummaryService.getSummary(user.id, 'overall')).status, 'UNAVAILABLE');
      advance(); await worker.runOnce();
      summary = await diagnosisSummaryService.getSummary(user.id, 'overall');
      assert.equal(summary.status, 'AVAILABLE');
      assert.equal(summary.versions.calculation, 'diagnosis-materialization-rollout-test');
    } finally { diagnosisMaterializationVersions.calculationVersion = oldCalculationVersion; }
    // A stale claimant loses to a newer source publication during its snapshot.
    await prisma.importedGame.update({ where: { id: games[0].id }, data: { updatedAt: new Date(clock.getTime() + 1) } });
    const racing = createDiagnosisWorkerService({ appUserId: user.id, now: () => clock, publish: async (...args) => {
      await prisma.importedGame.update({ where: { id: games[0].id }, data: { updatedAt: new Date(clock.getTime() + 2) } });
      advance(); await createDiagnosisWorkerService({ appUserId: user.id, now: () => clock }).runOnce();
      return materializeDiagnosis(...args);
    } });
    advance(); await racing.runOnce();
    const afterRace = await prisma.diagnosisMaterializationJob.findUnique({ where });
    assert.equal(afterRace.status, 'SUCCEEDED');
    assert.equal(afterRace.sourceKey, (await loadDiagnosisSourceSnapshot(user.id)).key);
    assert.equal(await prisma.diagnosisFindingSet.count({where:{appUserId:user.id,scopeKey:'overall',isCurrent:true}}),1);
    // Bounded attempts become a visible failure; a new source allows recovery.
    await prisma.importedGame.update({ where: { id: games[0].id }, data: { updatedAt: new Date(clock.getTime() + 1) } });
    const failing = createDiagnosisWorkerService({ appUserId: user.id, now: () => clock, publish: async () => { throw Error('persistent fixture failure'); } });
    for (let i = 0; i < 3; i++) { advance(); await failing.runOnce(); }
    assert.equal((await prisma.diagnosisMaterializationJob.findUnique({ where })).status, 'FAILED');
    assert.equal((await diagnosisSummaryService.getSummary(user.id, 'overall')).refresh.state, 'FAILED');
    await prisma.importedGame.update({ where: { id: games[0].id }, data: { updatedAt: new Date(clock.getTime() + 1) } });
    advance(); await worker.runOnce();
    assert.equal((await diagnosisSummaryService.getSummary(user.id, 'overall')).status, 'AVAILABLE');
  } finally {
    await browser?.stop();
    await app?.close(); await otherApp?.close();
    await prisma.appUser.deleteMany({ where: { id: { in: [user.id, other.id] } } });
    await prisma.$disconnect();
  }
});

test('zero-game, sparse and missing-clock histories preserve unknown evidence states', async () => {
  const user = await prisma.appUser.create({ data: { authProvider: 'TEST', authSubject: randomUUID() } });
  let clock = new Date();
  const worker = createDiagnosisWorkerService({ appUserId: user.id, now: () => clock });
  const advance = () => { clock = new Date(Math.max(Date.now(), clock.getTime() + 5000)); };
  try {
    const imports = createLichessAccountImportService({
      connectionService: { getCredentialForUser: async () => ({ lichessUserId: 'recorded-player', username: 'RecordedPlayer', accessToken: 'fixture', credentialGeneration: 'fixture' }), markCredentialRevokedForUser: async () => true },
      fetchImpl: async () => new Response(''),
    });
    const requested = await imports.requestImport(user.id, { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-02T00:00:00Z'), rated: true });
    await prisma.importRun.update({ where: { id: requested.id }, data: { status: 'RUNNING', startedAt: new Date(), heartbeatAt: new Date(), claimedAt: new Date() } });
    await imports.executeRun(await imports.getRun(user.id, requested.id));
    advance(); await worker.runOnce();
    let summary = await diagnosisSummaryService.getSummary(user.id, 'overall');
    assert.equal(summary.refresh.state, 'NO_GAMES');
    assert.equal(summary.items.length, 0);
    assert.equal(summary.evidenceState, 'REQUIRED_EVIDENCE_UNAVAILABLE');
    const sparse = createLichessAccountImportService({
      connectionService: { getCredentialForUser: async () => ({ lichessUserId: 'recorded-player', username: 'RecordedPlayer', accessToken: 'fixture', credentialGeneration: 'fixture' }), markCredentialRevokedForUser: async () => true },
      fetchImpl: async () => new Response([0,1,2].map((i) => JSON.stringify({ ...recordedGame(i, randomUUID()), clocks: i === 0 ? undefined : i === 1 ? [15000] : [17900,17900,17800,17800] })).join('\n') + '\n'),
    });
    const next = await sparse.requestImport(user.id, { from: new Date('2026-09-10T00:00:00Z'), to: new Date('2026-09-11T00:00:00Z'), rated: true });
    await prisma.importRun.update({ where: { id: next.id }, data: { status: 'RUNNING', startedAt: new Date(), heartbeatAt: new Date(), claimedAt: new Date() } });
    await sparse.executeRun(await sparse.getRun(user.id, next.id));
    const games = await prisma.importedGame.findMany({ where: { appUserId: user.id }, orderBy: { id: 'asc' } });
    const analysis = createStockfishAnalysisService({ engineFactory: async () => ({ engineName: 'SparseDouble-' + user.id, engineVersion: '1', analyzeFen: async () => ({ depth:8, scoreCpWhite:0, mateWhite:null, bestMove:null, bestPv:[], multiPv:[], rawInfo:[] }), close: async () => {} }) });
    for (const game of games) await ImportedGamePlyIndexService.indexOne(user.id, game.id);
    advance(); await worker.runOnce();
    assert.equal((await diagnosisSummaryService.getSummary(user.id, 'overall')).status, 'UNAVAILABLE');
    const evidence = createEvidenceService({ detectors: evidenceDetectors });
    for (let i = 0; i < 30; i++) {
      await analysis.runOnce(); await evidence.runOnce(); advance(); await worker.runOnce();
      if ((await diagnosisSummaryService.getSummary(user.id, 'overall')).status === 'AVAILABLE') break;
    }
    summary = await diagnosisSummaryService.getSummary(user.id, 'overall');
    assert.equal(summary.status, 'AVAILABLE', JSON.stringify(summary));
    assert.equal(summary.items.length, 0);
    assert.equal(summary.evidenceState, 'INSUFFICIENT_EVIDENCE');
    const stored = await prisma.importedGame.findMany({ where: { appUserId: user.id }, orderBy: { id: 'asc' } });
    assert.deepEqual(stored.map((game) => game.rawClockPresence), ['ABSENT','PRESENT','PRESENT']);
    const refs = await prisma.diagnosisFinding.findMany({ where: { findingSet: { appUserId: user.id, isCurrent:true }, diagnosisId:'TIME-001' } });
    assert.equal(refs[0].observationState, 'INSUFFICIENT_EVIDENCE');
    // New current attempt fails while old successful per-ply projections remain.
    const failedId = await analysis.requestReanalysis(games[0].id);
    await prisma.gameAnalysisRun.update({where:{id:failedId},data:{status:'FAILED',coverageStatus:'INCOMPLETE',completedAt:new Date()}});
    const quality = await prismaSessionDeteriorationRepository.loadGameQuality(user.id,[games[0].id]);
    assert.equal(quality[0].analysedUserMoves, 0, 'latest failed analysis cannot fall back to old successful plies');
    for (let i=0;i<5;i++) { await evidence.runOnce(); advance(); await worker.runOnce(); }
    assert.equal((await loadDiagnosisSourceSnapshot(user.id)).pending, false, 'material refresh and readiness agree after failed reanalysis');
    // An indexed source with no plies is explicitly uncovered, never perpetually
    // pending unschedulable engine or detector work.
    await prisma.importedGamePly.deleteMany({where:{importedGameId:games[2].id}});
    assert.equal((await loadDiagnosisSourceSnapshot(user.id)).pending, false);
  } finally {
    await prisma.appUser.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
