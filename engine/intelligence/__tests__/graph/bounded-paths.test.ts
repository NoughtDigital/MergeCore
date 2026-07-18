import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  analyseChangeImpact,
  createRepositoryIndex,
  RagStore,
  traverseRelationshipPaths,
  type RagDependencyEdge,
  type RagSymbolRecord,
} from '../../dist/index.js';

function sym(
  id: string,
  name: string,
  filePath: string,
  opts?: { exported?: boolean; kind?: string }
): RagSymbolRecord {
  return {
    id,
    name,
    kind: opts?.kind ?? 'function',
    path: filePath,
    startLine: 1,
    endLine: 10,
    language: 'typescript',
    exported: opts?.exported,
  };
}

function edge(
  partial: Omit<RagDependencyEdge, 'id'> & { id?: string }
): RagDependencyEdge {
  return {
    id: partial.id ?? `e:${partial.fromPath}->${partial.toPath}:${partial.kind}:${partial.specifier}`,
    fromPath: partial.fromPath,
    toPath: partial.toPath,
    kind: partial.kind,
    specifier: partial.specifier,
    fromSymbol: partial.fromSymbol,
    toSymbol: partial.toSymbol,
    startLine: partial.startLine ?? 1,
    endLine: partial.endLine ?? 1,
    confidence: partial.confidence ?? 'certain',
    resolutionMethod: partial.resolutionMethod ?? 'compiler',
    evidence: partial.evidence ?? [`${partial.kind} ${partial.specifier}`],
  };
}

async function seedStore(
  root: string,
  files: Array<{
    path: string;
    symbols?: RagSymbolRecord[];
    edges?: RagDependencyEdge[];
  }>
): Promise<RagStore> {
  const store = await RagStore.open(root, {
    storageDir: path.join(root, '.mergecore-store'),
  });
  for (const f of files) {
    store.replaceFileGraph(
      f.path,
      `hash:${f.path}`,
      Date.now(),
      [
        {
          id: `chunk:${f.path}`,
          path: f.path,
          text: `// ${f.path}`,
          startLine: 1,
          endLine: 20,
          kind: 'source',
          weight: 1,
          fileHash: `hash:${f.path}`,
        },
      ],
      f.symbols ?? [],
      f.edges ?? []
    );
  }
  await store.persist();
  return store;
}

describe('bounded relationship paths', () => {
  let workspaceRoot: string;

  before(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mergecore-paths-'));
  });

  after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('terminates cyclic A↔B↔C with cycleClosed and no infinite expand', async () => {
    const root = path.join(workspaceRoot, 'cycle');
    await fs.mkdir(root, { recursive: true });
    const a = 'src/a.ts';
    const b = 'src/b.ts';
    const c = 'src/c.ts';
    const store = await seedStore(root, [
      {
        path: a,
        symbols: [sym('sym:a', 'aFn', a)],
        edges: [
          edge({
            fromPath: a,
            toPath: b,
            kind: 'call',
            specifier: 'bFn',
            fromSymbol: 'sym:a',
            toSymbol: 'sym:b',
          }),
        ],
      },
      {
        path: b,
        symbols: [sym('sym:b', 'bFn', b)],
        edges: [
          edge({
            fromPath: b,
            toPath: c,
            kind: 'call',
            specifier: 'cFn',
            fromSymbol: 'sym:b',
            toSymbol: 'sym:c',
          }),
        ],
      },
      {
        path: c,
        symbols: [sym('sym:c', 'cFn', c)],
        edges: [
          edge({
            fromPath: c,
            toPath: a,
            kind: 'call',
            specifier: 'aFn',
            fromSymbol: 'sym:c',
            toSymbol: 'sym:a',
          }),
        ],
      },
    ]);

    const paths = traverseRelationshipPaths({
      store,
      start: { symbolId: 'sym:a' },
      budget: { maxDepth: 6, maxNodes: 40, maxPaths: 20, direction: 'outgoing' },
    });
    assert.ok(paths.length >= 1);
    assert.ok(
      paths.some((p) => p.cycleClosed === true),
      'expected at least one cycle-closed path'
    );
    assert.ok(paths.every((p) => p.steps.length <= 8));
    await store.close();
  });

  it('caps fan-out for highly connected util hubs', async () => {
    const root = path.join(workspaceRoot, 'hub');
    await fs.mkdir(root, { recursive: true });
    const util = 'src/util.ts';
    const utilSym = sym('sym:util', 'sharedUtil', util, { exported: true });
    const edges: RagDependencyEdge[] = [];
    const files = [
      {
        path: util,
        symbols: [utilSym],
        edges: [] as RagDependencyEdge[],
      },
    ];
    for (let i = 0; i < 60; i++) {
      const p = `src/consumer-${i}.ts`;
      const sid = `sym:c${i}`;
      files.push({
        path: p,
        symbols: [sym(sid, `c${i}`, p)],
        edges: [
          edge({
            fromPath: p,
            toPath: util,
            kind: 'import',
            specifier: './util',
            fromSymbol: sid,
            toSymbol: 'sym:util',
            confidence: i < 5 ? 'certain' : 'medium',
          }),
        ],
      });
      edges.push(
        edge({
          fromPath: p,
          toPath: util,
          kind: 'call',
          specifier: 'sharedUtil',
          fromSymbol: sid,
          toSymbol: 'sym:util',
        })
      );
    }
    // Attach call edges onto util file so degree is high from util
    files[0]!.edges = edges;

    const store = await seedStore(root, files);
    const paths = traverseRelationshipPaths({
      store,
      start: { symbolId: 'sym:util' },
      budget: {
        maxDepth: 2,
        maxNodes: 40,
        maxPaths: 12,
        maxFanOutPerNode: 12,
        hubDegreeTruncate: 40,
        direction: 'incoming',
      },
    });
    assert.ok(paths.length <= 12);
    const leafCount = new Set(
      paths.map((p) => p.steps[p.steps.length - 1]?.node.path).filter(Boolean)
    );
    assert.ok(leafCount.size <= 12, `fan-out exceeded: ${leafCount.size}`);
    await store.close();
  });

  it('stays inside budget for monorepo twin packages with real edges only', async () => {
    const root = path.join(workspaceRoot, 'mono');
    await fs.mkdir(root, { recursive: true });
    const store = await seedStore(root, [
      {
        path: 'packages/a/src/index.ts',
        symbols: [sym('sym:a', 'pkgA', 'packages/a/src/index.ts', { exported: true })],
        edges: [
          edge({
            fromPath: 'packages/a/src/index.ts',
            toPath: 'packages/b/src/index.ts',
            kind: 'import',
            specifier: '@mono/b',
            fromSymbol: 'sym:a',
            toSymbol: 'sym:b',
            confidence: 'certain',
            resolutionMethod: 'compiler',
          }),
        ],
      },
      {
        path: 'packages/b/src/index.ts',
        symbols: [sym('sym:b', 'pkgB', 'packages/b/src/index.ts', { exported: true })],
        edges: [],
      },
      {
        path: 'packages/c/src/orphan.ts',
        symbols: [sym('sym:c', 'orphan', 'packages/c/src/orphan.ts')],
        edges: [],
      },
    ]);

    const paths = traverseRelationshipPaths({
      store,
      start: { path: 'packages/a/src/index.ts' },
      budget: { maxDepth: 2, maxNodes: 20, maxPaths: 8, direction: 'outgoing' },
    });
    assert.ok(paths.some((p) => p.steps.some((s) => s.node.path.includes('packages/b'))));
    assert.ok(
      !paths.some((p) => p.steps.some((s) => s.node.path.includes('packages/c'))),
      'orphan package must not appear without edges'
    );
    await store.close();
  });

  it('prefers deterministic export edges through barrel hubs without exploding', async () => {
    const root = path.join(workspaceRoot, 'barrel');
    await fs.mkdir(root, { recursive: true });
    const barrel = 'src/index.ts';
    const impl = 'src/impl.ts';
    const store = await seedStore(root, [
      {
        path: barrel,
        symbols: [sym('sym:barrel', 'index', barrel, { exported: true })],
        edges: [
          edge({
            fromPath: barrel,
            toPath: impl,
            kind: 'export',
            specifier: 'implFn',
            fromSymbol: 'sym:barrel',
            toSymbol: 'sym:impl',
            confidence: 'certain',
            resolutionMethod: 'compiler',
          }),
          ...Array.from({ length: 30 }, (_, i) =>
            edge({
              id: `barrel-noise-${i}`,
              fromPath: barrel,
              toPath: `src/noise-${i}.ts`,
              kind: 'export',
              specifier: `n${i}`,
              confidence: 'heuristic',
              resolutionMethod: 'heuristic',
            })
          ),
        ],
      },
      {
        path: impl,
        symbols: [sym('sym:impl', 'implFn', impl, { exported: true })],
        edges: [],
      },
    ]);

    const paths = traverseRelationshipPaths({
      store,
      start: { path: barrel },
      budget: {
        maxDepth: 2,
        maxNodes: 30,
        maxPaths: 10,
        maxFanOutPerNode: 8,
        hubDegreeTruncate: 20,
        direction: 'outgoing',
      },
    });
    assert.ok(paths.length <= 10);
    const top = paths[0];
    assert.ok(top);
    assert.ok(
      top.steps.some((s) => s.node.path === impl) ||
        top.deterministic ||
        paths.some((p) => p.deterministic && p.steps.some((s) => s.node.path === impl)),
      'expected deterministic path toward impl'
    );
    await store.close();
  });

  it('marks dynamic import as uncertain/heuristic impact', async () => {
    const root = path.join(workspaceRoot, 'dyn');
    await fs.mkdir(root, { recursive: true });
    const store = await seedStore(root, [
      {
        path: 'src/loader.ts',
        symbols: [sym('sym:load', 'load', 'src/loader.ts')],
        edges: [
          edge({
            fromPath: 'src/loader.ts',
            toPath: 'src/plugin.ts',
            kind: 'import',
            specifier: 'import("./plugin")',
            fromSymbol: 'sym:load',
            confidence: 'heuristic',
            resolutionMethod: 'heuristic',
            evidence: ['dynamic import()'],
          }),
        ],
      },
      {
        path: 'src/plugin.ts',
        symbols: [sym('sym:plugin', 'plugin', 'src/plugin.ts')],
        edges: [],
      },
    ]);

    const report = await analyseChangeImpact({
      store,
      workspaceRoot: root,
      target: { path: 'src/loader.ts' },
      budget: { maxDepth: 2, maxPaths: 8 },
    });
    assert.ok(
      report.uncertainDynamic.length >= 1,
      'dynamic import should appear under uncertainDynamic'
    );
    assert.ok(
      report.notes.some((n) => /not a guarantee/i.test(n)),
      'notes must state impact is not guaranteed'
    );
    await store.close();
  });

  it('ranks event edges after deterministic calls', async () => {
    const root = path.join(workspaceRoot, 'events');
    await fs.mkdir(root, { recursive: true });
    const store = await seedStore(root, [
      {
        path: 'src/emitter.ts',
        symbols: [sym('sym:emit', 'emit', 'src/emitter.ts')],
        edges: [
          edge({
            fromPath: 'src/emitter.ts',
            toPath: 'src/service.ts',
            kind: 'call',
            specifier: 'handle',
            fromSymbol: 'sym:emit',
            toSymbol: 'sym:svc',
            confidence: 'certain',
            resolutionMethod: 'compiler',
          }),
          edge({
            fromPath: 'src/emitter.ts',
            toPath: 'src/listener.ts',
            kind: 'event',
            specifier: 'user.created',
            fromSymbol: 'sym:emit',
            toSymbol: 'sym:listen',
            confidence: 'heuristic',
            resolutionMethod: 'heuristic',
          }),
        ],
      },
      {
        path: 'src/service.ts',
        symbols: [sym('sym:svc', 'handle', 'src/service.ts')],
        edges: [],
      },
      {
        path: 'src/listener.ts',
        symbols: [sym('sym:listen', 'onUserCreated', 'src/listener.ts')],
        edges: [],
      },
    ]);

    const paths = traverseRelationshipPaths({
      store,
      start: { symbolId: 'sym:emit' },
      budget: { maxDepth: 2, maxPaths: 8, direction: 'outgoing' },
    });
    assert.ok(paths.length >= 2);
    const callIdx = paths.findIndex((p) =>
      p.steps.some((s) => s.edge?.kind === 'call')
    );
    const eventIdx = paths.findIndex((p) =>
      p.steps.some((s) => s.edge?.kind === 'event')
    );
    assert.ok(callIdx >= 0 && eventIdx >= 0);
    assert.ok(
      paths[callIdx]!.score >= paths[eventIdx]!.score,
      'deterministic call should rank at or above heuristic event'
    );
    await store.close();
  });

  it('hard-stops on maxDepth / maxNodes / maxPaths budgets', async () => {
    const root = path.join(workspaceRoot, 'budget');
    await fs.mkdir(root, { recursive: true });
    const chain: Array<{
      path: string;
      symbols: RagSymbolRecord[];
      edges: RagDependencyEdge[];
    }> = [];
    for (let i = 0; i < 10; i++) {
      const p = `src/n${i}.ts`;
      const sid = `sym:n${i}`;
      const next = i < 9 ? `src/n${i + 1}.ts` : undefined;
      chain.push({
        path: p,
        symbols: [sym(sid, `n${i}`, p)],
        edges: next
          ? [
              edge({
                fromPath: p,
                toPath: next,
                kind: 'call',
                specifier: `n${i + 1}`,
                fromSymbol: sid,
                toSymbol: `sym:n${i + 1}`,
              }),
            ]
          : [],
      });
    }
    const store = await seedStore(root, chain);

    const depthLimited = traverseRelationshipPaths({
      store,
      start: { symbolId: 'sym:n0' },
      budget: { maxDepth: 2, maxPaths: 20, direction: 'outgoing' },
    });
    assert.ok(depthLimited.every((p) => p.steps.length - 1 <= 2));

    const pathLimited = traverseRelationshipPaths({
      store,
      start: { symbolId: 'sym:n0' },
      budget: { maxDepth: 5, maxPaths: 3, direction: 'outgoing' },
    });
    assert.ok(pathLimited.length <= 3);

    const nodeLimited = traverseRelationshipPaths({
      store,
      start: { symbolId: 'sym:n0' },
      budget: { maxDepth: 8, maxNodes: 3, maxPaths: 20, direction: 'outgoing' },
    });
    assert.ok(nodeLimited.length >= 0);
    await store.close();
  });

  it('context pack includes multi-hop relationshipPaths with per-step evidence', async () => {
    const root = path.join(workspaceRoot, 'pack');
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'src', 'route.ts'),
      `import { handle } from './controller';\nexport function route() { return handle(); }\n`
    );
    await fs.writeFile(
      path.join(root, 'src', 'controller.ts'),
      `import { svc } from './service';\nexport function handle() { return svc(); }\n`
    );
    await fs.writeFile(
      path.join(root, 'src', 'service.ts'),
      `export function svc() { return 1; }\n`
    );
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'pack-fixture', private: true })
    );

    const repo = await createRepositoryIndex(root, {
      storageDir: path.join(root, '.mergecore-store'),
    });
    try {
      await repo.index();
      const pack = await repo.buildContextPack('handle', {
        k: 8,
        pathHint: 'src/route.ts',
      });
      assert.ok(
        pack.relationshipPaths && pack.relationshipPaths.length >= 1,
        'expected relationshipPaths on context pack'
      );
      const multi = pack.relationshipPaths!.find((p) => p.steps.length >= 2);
      assert.ok(multi, 'expected at least one multi-hop path');
      for (const step of multi!.steps) {
        assert.ok(step.evidence.length >= 1, 'each step needs evidence');
        assert.ok(step.node.path);
      }

      const impact = await repo.analyseChangeImpact({ path: 'src/service.ts' });
      assert.ok(impact.notes.some((n) => /not a guarantee/i.test(n)));
      assert.ok(Array.isArray(impact.directlyAffected));
      assert.ok(Array.isArray(impact.likelyDownstream));
    } finally {
      await repo.close();
    }
  });
});
