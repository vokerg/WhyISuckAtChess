import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpClient } from '@angular/common/http';
import {
  Injector,
  RendererFactory2,
  createComponent,
  createEnvironmentInjector,
  type EnvironmentInjector,
  type Renderer2,
} from '@angular/core';
import type { ImportedGameReplay } from '@why-i-suck-at-chess/contracts';
import { of } from 'rxjs';
import { ReplayEvidencePanelComponent } from '../src/app/features/games/components/replay-evidence-panel.component';
import { ImportedGamesApiService } from '../src/app/features/games/data-access/imported-games-api.service';
import { GameReplayStore } from '../src/app/features/games/state/game-replay.store';

type MemoryNode = {
  kind: 'root' | 'element' | 'text' | 'comment';
  name: string;
  value: string;
  parent: MemoryNode | null;
  children: MemoryNode[];
  attributes: Map<string, string>;
  properties: Map<string, unknown>;
  classes: Set<string>;
  styles: Map<string, string>;
};

function memoryNode(kind: MemoryNode['kind'], name = '', value = ''): MemoryNode {
  return {
    kind,
    name,
    value,
    parent: null,
    children: [],
    attributes: new Map(),
    properties: new Map(),
    classes: new Set(),
    styles: new Map(),
  };
}

function append(parent: MemoryNode, child: MemoryNode, before: MemoryNode | null = null): void {
  if (child.parent) {
    const previousIndex = child.parent.children.indexOf(child);
    if (previousIndex >= 0) child.parent.children.splice(previousIndex, 1);
  }
  child.parent = parent;
  if (before === null) {
    parent.children.push(child);
    return;
  }
  const index = parent.children.indexOf(before);
  if (index < 0) parent.children.push(child);
  else parent.children.splice(index, 0, child);
}

function createMemoryRenderer(root: MemoryNode): Renderer2 {
  return {
    destroy: () => undefined,
    createElement: (name: string) => memoryNode('element', name),
    createComment: (value: string) => memoryNode('comment', '', value),
    createText: (value: string) => memoryNode('text', '', value),
    appendChild: (parent: MemoryNode, child: MemoryNode) => append(parent, child),
    insertBefore: (parent: MemoryNode, child: MemoryNode, before: MemoryNode | null) =>
      append(parent, child, before),
    removeChild: (parent: MemoryNode, child: MemoryNode) => {
      const index = parent.children.indexOf(child);
      if (index >= 0) parent.children.splice(index, 1);
      child.parent = null;
    },
    selectRootElement: (selectorOrNode: string | MemoryNode) =>
      typeof selectorOrNode === 'string' ? root : selectorOrNode,
    parentNode: (node: MemoryNode) => node.parent,
    nextSibling: (node: MemoryNode) => {
      if (!node.parent) return null;
      const index = node.parent.children.indexOf(node);
      return index >= 0 ? node.parent.children[index + 1] ?? null : null;
    },
    setAttribute: (node: MemoryNode, name: string, value: string) => node.attributes.set(name, value),
    removeAttribute: (node: MemoryNode, name: string) => node.attributes.delete(name),
    addClass: (node: MemoryNode, name: string) => node.classes.add(name),
    removeClass: (node: MemoryNode, name: string) => node.classes.delete(name),
    setStyle: (node: MemoryNode, style: string, value: unknown) => node.styles.set(style, String(value)),
    removeStyle: (node: MemoryNode, style: string) => node.styles.delete(style),
    setProperty: (node: MemoryNode, name: string, value: unknown) => node.properties.set(name, value),
    setValue: (node: MemoryNode, value: string) => {
      node.value = value;
    },
    listen: () => () => undefined,
  } as unknown as Renderer2;
}

function textContent(node: MemoryNode): string {
  if (node.kind === 'text') return node.value;
  return node.children.map(textContent).join('');
}

function findElements(node: MemoryNode, name: string): MemoryNode[] {
  const matches = node.kind === 'element' && node.name === name ? [node] : [];
  return matches.concat(node.children.flatMap((child) => findElements(child, name)));
}

function normalizedText(node: MemoryNode): string {
  return textContent(node).replace(/\s+/g, ' ').trim();
}

function replayFixture(): ImportedGameReplay {
  const unavailablePositionEngine = {
    status: 'UNAVAILABLE' as const,
    analysisVersion: null,
    settingsHash: null,
    engineName: null,
    engineVersion: null,
    depth: null,
    bestMoveUci: null,
    scoreCpWhite: null,
    mateWhite: null,
  };
  const unavailableEngine = {
    status: 'UNAVAILABLE' as const,
    analysisRunId: null,
    scoreLossCp: null,
    classificationCode: null,
    beforePosition: unavailablePositionEngine,
  };
  const unavailableTiming = {
    status: 'UNAVAILABLE' as const,
    beforeMoveCentiseconds: null,
    effectiveIncrementCentiseconds: null,
    moveTimeCentiseconds: null,
    beforeClockProvenance: 'SOURCE_UNAVAILABLE',
    incrementProvenance: 'TIME_CONTROL',
    reliabilityFlags: [],
    unavailableReason: 'fixture',
    derivationVersion: null,
  };

  return {
    id: 42,
    provider: 'LICHESS',
    providerGameId: 'fixture-game',
    providerUrl: null,
    startedAt: null,
    endedAt: '2026-09-14T20:00:00Z',
    rated: true,
    variant: 'standard',
    speedCategory: 'blitz',
    timeControl: {
      raw: '180+2',
      initialSeconds: 180,
      incrementSeconds: 2,
      exactKey: '180+2',
      source: 'LICHESS',
    },
    white: { username: 'alice', rating: 1600 },
    black: { username: 'bob', rating: 1610 },
    userColor: 'WHITE',
    opponentUsername: 'bob',
    result: '0-1',
    resultForUser: 'LOSS',
    status: 'mate',
    opening: { eco: 'C20', name: 'King Pawn Game' },
    indexing: { status: 'INDEXED', indexedAt: '2026-09-14T20:01:00Z', error: null },
    timing: {
      alignmentStatus: 'UNAVAILABLE',
      coverageStatus: 'UNAVAILABLE',
      alignedPlyCount: 0,
      derivedPlyCount: 0,
      derivationVersion: null,
    },
    engine: {
      status: 'COMPLETED',
      coverageStatus: 'PARTIAL',
      runId: 90,
      positionsDone: 2,
      positionsTotal: 3,
      pliesDone: 1,
      pliesTotal: 2,
      engineName: 'Stockfish',
      engineVersion: '17',
      completedAt: '2026-09-14T20:02:00Z',
    },
    provenance: {
      source: 'LICHESS',
      connectedLichessUserId: 'u-1',
      connectedLichessUsername: 'alice',
      importedAt: '2026-09-14T20:00:30Z',
      sourceUpdatedAt: null,
      readModelUpdatedAt: '2026-09-14T20:03:00Z',
    },
    clockSource: {
      presence: 'ABSENT',
      stateCount: 0,
      unit: 'centiseconds',
      anomalies: [],
    },
    evidence: {
      compatibilityPolicy: 'KNOWN_TYPES_WITH_OPAQUE_FALLBACK',
      runs: [
        {
          runId: 101,
          detectorKey: 'material',
          detectorVersion: '2',
          coverage: {
            status: 'PARTIAL',
            reason: 'Engine coverage is partial.',
            details: { coveredPlies: 1, totalPlies: 2 },
          },
          provenance: {
            sourcePlyIndexedAt: '2026-09-14T20:01:00Z',
            sourceAnalysisRunId: 90,
            sourceAnalysisSnapshotId: 'snapshot-90',
          },
          events: [
            {
              evidenceKey: 'material:2',
              findingKey: 'hanging-material:2',
              availability: 'PRESENT',
              source: { startPly: 2, endPly: 2, positionId: 3 },
              presentation: {
                family: 'MATERIAL',
                kind: 'FINDING',
                label: 'Hanging material',
              },
              payload: {
                kind: 'KNOWN',
                evidenceType: 'HANGING_MATERIAL',
                measurements: { materialSwingCp: 320 },
                details: {},
              },
              unavailableReason: null,
            },
            {
              evidenceKey: 'tactical:2',
              findingKey: 'missed-tactic:2',
              availability: 'PRESENT',
              source: { startPly: 2, endPly: 2, positionId: 3 },
              presentation: {
                family: 'TACTICAL',
                kind: 'FINDING',
                label: 'Missed tactical motif',
              },
              payload: {
                kind: 'KNOWN',
                evidenceType: 'MISSED_TACTICAL_MOTIF',
                measurements: { motifCount: 1 },
                details: {},
              },
              unavailableReason: null,
            },
          ],
        },
      ],
    },
    plies: [
      {
        plyNumber: 1,
        moveUci: 'e2e4',
        moverColor: 'WHITE',
        isUserMove: true,
        beforePosition: { id: 1, normalizedFen: 'startpos' },
        afterPosition: { id: 2, normalizedFen: 'fen-after-1' },
        sourceClock: {
          status: 'UNAVAILABLE',
          sourceOrdinal: null,
          afterCentiseconds: null,
          semantics: null,
          alignmentVersion: null,
        },
        timing: unavailableTiming,
        engine: unavailableEngine,
        annotations: [],
        evidenceEventKeys: [],
      },
      {
        plyNumber: 2,
        moveUci: 'e7e5',
        moverColor: 'BLACK',
        isUserMove: false,
        beforePosition: { id: 2, normalizedFen: 'fen-after-1' },
        afterPosition: { id: 3, normalizedFen: 'fen-after-2' },
        sourceClock: {
          status: 'UNAVAILABLE',
          sourceOrdinal: null,
          afterCentiseconds: null,
          semantics: null,
          alignmentVersion: null,
        },
        timing: unavailableTiming,
        engine: unavailableEngine,
        annotations: [
          { kind: 'TACTICAL', label: 'Tactical event', severity: 'CRITICAL' },
        ],
        evidenceEventKeys: ['material:2', 'tactical:2'],
      },
    ],
  };
}

async function loadedStore(): Promise<GameReplayStore> {
  const replay = replayFixture();
  const injector = Injector.create({
    providers: [
      GameReplayStore,
      ImportedGamesApiService,
      {
        provide: HttpClient,
        useValue: {
          get: (url: string) => {
            assert.equal(url, '/api/imported-games/42/replay');
            return of(replay);
          },
        },
      },
    ],
  });
  const store = injector.get(GameReplayStore);
  store.initialize(42);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(store.loading(), false);
  return store;
}

function renderEvidence(store: GameReplayStore): MemoryNode {
  const root = memoryNode('root', 'host');
  const renderer = createMemoryRenderer(root);
  const parent = Injector.create({ providers: [] }) as unknown as EnvironmentInjector;
  const environmentInjector = createEnvironmentInjector(
    [{ provide: RendererFactory2, useValue: { createRenderer: () => renderer } }],
    parent,
  );

  const componentRef = createComponent(ReplayEvidencePanelComponent, {
    environmentInjector,
    hostElement: root as unknown as Element,
  });
  componentRef.setInput('events', store.currentEvidence());
  componentRef.setInput('coverage', store.evidenceCoverage());
  componentRef.setInput('hasSelectedPly', store.currentPly() !== null);
  componentRef.setInput('missingEventKeys', store.currentEvidenceMissingKeys());
  componentRef.setInput('annotations', store.currentPly()?.annotations ?? []);
  componentRef.changeDetectorRef.detectChanges();
  return root;
}

test('API replay evidence flows through state into rendered Angular evidence details', async () => {
  const store = await loadedStore();
  store.selectPly(2);

  assert.equal(store.currentEvidence().length, 2);
  assert.equal(store.evidenceCoverage().status, 'PARTIAL');

  const root = renderEvidence(store);
  const text = normalizedText(root);

  assert.match(text, /Hanging material/);
  assert.match(text, /Material Swing Cp 320/);
  assert.match(text, /Missed tactical motif/);
  assert.match(text, /Tactical event · CRITICAL/);
  assert.match(text, /Replay evidence coverage is PARTIAL/);
  assert.match(text, /material v2 · run 101 · analysis run 90/);
  assert.equal(findElements(root, 'details').length, 2);
  assert.equal(findElements(root, 'details').filter((node) => node.attributes.has('open')).length, 1);
});

test('partial coverage is rendered differently from a complete no-finding state', async () => {
  const store = await loadedStore();
  store.selectPly(1);

  assert.equal(store.currentEvidence().length, 0);
  assert.equal(store.evidenceCoverage().status, 'PARTIAL');

  const text = normalizedText(renderEvidence(store));
  assert.match(text, /evidence coverage is PARTIAL/);
  assert.match(text, /Missing evidence is not equivalent to a negative finding/);
  assert.doesNotMatch(text, /under complete detector coverage/);
});
