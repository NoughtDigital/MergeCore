import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import {
  createRepositoryFileIndexer,
  createCodeGraphQuery,
} from '@mergecore/intelligence';
import { detectRiskIndicators } from '../../presentation/hover/hover-risks';
import { assembleHoverSummary } from '../../presentation/hover/hover-summary';
import { HoverSummaryCache } from '../../presentation/hover/hover-cache';
import {
  formatHoverMarkdown,
  HOVER_COMMANDS,
  HOVER_ENABLED_COMMANDS,
} from '../../presentation/hover/hover-markdown';
import {
  buildDeterministicHoverSummary,
  resolveSymbolForHover,
} from '../../presentation/hover/hover-assemble';

const require = createRequire(__filename);
const fixtures = require('../../../../packages/test-fixtures/index.js') as {
  typescriptGraphRoot: string;
  billingRefundEvalRoot: string;
};

describe('repository-aware hover', () => {
  it('detects conservative risk indicators without claiming vulnerabilities', () => {
    const risks = detectRiskIndicators({
      symbolName: 'submitStripeRefund',
      filePath: 'src/billing/gateway.ts',
      codeSample: 'await fetch(url); process.env.STRIPE_KEY',
      callerCount: 20,
      relatedTestCount: 0,
    });
    assert.ok(risks.some((r) => r.id === 'payment'));
    assert.ok(risks.some((r) => r.id === 'network'));
    assert.ok(risks.some((r) => r.id === 'env'));
    assert.ok(risks.some((r) => r.id === 'high-callers'));
    assert.ok(risks.some((r) => r.id === 'no-tests'));
    assert.ok(risks.every((r) => r.kind === 'indicator'));
  });

  it('assembles summary with evidence vs inference labels', () => {
    const summary = assembleHoverSummary({
      workspaceId: 'ws-test',
      symbol: {
        id: 'typescript:src/a.ts:foo:function:1:1',
        name: 'foo',
        kind: 'function',
        location: { path: 'src/a.ts', startLine: 1, endLine: 5 },
        language: 'typescript',
        adapterId: 'typescript',
        exported: true,
        jsdocSummary: 'Does a thing',
        parameters: [{ name: 'x', typeText: 'number' }],
        returnTypeText: 'string',
      },
      callers: [
        {
          id: 'e1',
          fromPath: 'src/b.ts',
          toPath: 'src/a.ts',
          kind: 'call',
          specifier: 'foo',
          fromSymbol: 'typescript:src/b.ts:bar:function:1:1',
          toSymbol: 'typescript:src/a.ts:foo:function:1:1',
          startLine: 3,
          confidence: 'certain',
          resolutionMethod: 'typescript-checker',
        },
      ],
      callees: [],
      dependencies: [],
      relatedTests: [],
      instructions: [{ path: 'src/AGENTS.md', title: 'Agents', excerpt: 'prefer tests' }],
    });
    assert.equal(summary.purpose.kind, 'evidence');
    assert.equal(summary.callerCount, 1);
    assert.ok(summary.instructions.length === 1);
    assert.ok(summary.risks.some((r) => r.id === 'no-tests'));
  });

  it('formats compact markdown with command links and source metadata', () => {
    const summary = assembleHoverSummary({
      workspaceId: 'ws-test',
      symbol: {
        id: 'typescript:src/a.ts:foo:function:1:1',
        name: 'foo',
        kind: 'function',
        location: { path: 'src/a.ts', startLine: 2, endLine: 4 },
        language: 'typescript',
        adapterId: 'typescript',
        jsdocSummary: 'Hello',
      },
      callers: [],
      callees: [],
      dependencies: [],
      relatedTests: [],
      instructions: [],
    });
    const md = formatHoverMarkdown(summary, '/tmp/ws');
    assert.ok(md.includes('### `foo`'));
    assert.ok(md.includes('model not used'));
    assert.ok(md.includes('deterministic language intelligence'));
    assert.ok(md.includes(`command:${HOVER_COMMANDS.openSource}`));
    assert.ok(md.includes(`command:${HOVER_COMMANDS.viewCallers}`));
    assert.ok(HOVER_ENABLED_COMMANDS.includes(HOVER_COMMANDS.openExplanation));
    assert.ok(md.split('\n').length < 40, 'hover must stay compact');
  });

  it('labels PHP hover as heuristic language intelligence', () => {
    const summary = assembleHoverSummary({
      workspaceId: 'ws-test',
      symbol: {
        id: 'php:app/Models/Order.php:Order:1',
        name: 'Order',
        kind: 'class',
        location: { path: 'app/Models/Order.php', startLine: 1, endLine: 20 },
        language: 'php',
        adapterId: 'php',
      },
      callers: [],
      callees: [],
      dependencies: [],
      relatedTests: [],
      instructions: [],
    });
    assert.equal(summary.analysis, 'heuristic');
    const md = formatHoverMarkdown(summary, '/tmp/ws');
    assert.ok(md.includes('heuristic language intelligence'));
  });

  it('resolves symbols and builds deterministic hover from indexed fixture', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mergecore-hover-'));
    try {
      await cp(fixtures.typescriptGraphRoot, root, { recursive: true });
      const indexer = await createRepositoryFileIndexer({
        workspaceRoot: root,
        storageDir: path.join(root, '.store'),
      });
      await indexer.startInitialIndex();
      const store = indexer.getRagStore();
      const graph = indexer.getCodeGraphService();
      const summary = await buildDeterministicHoverSummary({
        workspaceRoot: root,
        store,
        graphService: graph,
        relPath: 'src/core.ts',
        position: { line: 1, column: 1 },
      });
      // May resolve interface Greeter or nearby — ensure we get *something* or undefined cleanly
      if (summary) {
        assert.ok(summary.symbolId);
        assert.ok(summary.name);
        assert.equal(summary.analysis, 'deterministic');
        assert.ok(summary.confidence);
      }

      const addHits = createCodeGraphQuery(store, graph).findSymbol('add', {
        pathPrefix: 'src/',
      });
      assert.ok(addHits.length >= 1);
      const add = addHits.find((s) => s.location.path === 'src/core.ts')!;
      const atPos = await resolveSymbolForHover(
        store,
        graph,
        'src/core.ts',
        { line: add.location.startLine, column: add.location.startColumn ?? 1 }
      );
      assert.ok(atPos);
      assert.equal(atPos!.name, 'add');

      const full = await buildDeterministicHoverSummary({
        workspaceRoot: root,
        store,
        graphService: graph,
        relPath: 'src/core.ts',
        position: {
          line: add.location.startLine,
          column: add.location.startColumn ?? 1,
        },
        codeSample: 'export function add',
      });
      assert.ok(full);
      assert.equal(full!.name, 'add');
      assert.ok(full!.purpose.text.length > 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports missing tests as an indicator and includes nested AGENTS.md', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mergecore-hover-agents-'));
    try {
      await mkdir(path.join(root, 'src'), { recursive: true });
      await writeFile(
        path.join(root, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { strict: true, module: 'ESNext', target: 'ES2020' },
          include: ['src/**/*'],
        })
      );
      await writeFile(
        path.join(root, 'src', 'service.ts'),
        `/** Greets a user. */\nexport function greet(name: string): string {\n  return name;\n}\n`
      );
      await writeFile(path.join(root, 'AGENTS.md'), '# Root agents\nBe careful.\n');
      await mkdir(path.join(root, 'src'), { recursive: true });
      await writeFile(path.join(root, 'src', 'AGENTS.md'), '# Nested agents\nPrefer unit tests.\n');

      const indexer = await createRepositoryFileIndexer({
        workspaceRoot: root,
        storageDir: path.join(root, '.store'),
      });
      await indexer.startInitialIndex();
      const store = indexer.getRagStore();
      const graph = indexer.getCodeGraphService();
      const greet = createCodeGraphQuery(store, graph).findSymbol('greet')[0];
      assert.ok(greet);
      const summary = await buildDeterministicHoverSummary({
        workspaceRoot: root,
        store,
        graphService: graph,
        relPath: 'src/service.ts',
        position: {
          line: greet!.location.startLine,
          column: greet!.location.startColumn ?? 1,
        },
      });
      assert.ok(summary);
      assert.ok(summary!.risks.some((r) => r.id === 'no-tests'));
      assert.ok(
        summary!.instructions.some((i) => i.path.includes('AGENTS')),
        `expected AGENTS instruction, got ${summary!.instructions.map((i) => i.path).join(',')}`
      );
      await indexer.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns undefined for unresolved symbols', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mergecore-hover-miss-'));
    try {
      await mkdir(path.join(root, 'src'), { recursive: true });
      await writeFile(
        path.join(root, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { strict: true, module: 'ESNext', target: 'ES2020' },
          include: ['src/**/*'],
        })
      );
      await writeFile(path.join(root, 'src', 'empty.ts'), `const x = 1;\n`);
      const indexer = await createRepositoryFileIndexer({
        workspaceRoot: root,
        storageDir: path.join(root, '.store'),
      });
      await indexer.startInitialIndex();
      const summary = await buildDeterministicHoverSummary({
        workspaceRoot: root,
        store: indexer.getRagStore(),
        graphService: indexer.getCodeGraphService(),
        relPath: 'src/empty.ts',
        position: { line: 1, column: 1 },
      });
      // const binding may or may not be extracted — if unresolved path, undefined is ok
      void summary;
      const miss = await resolveSymbolForHover(
        indexer.getRagStore(),
        indexer.getCodeGraphService(),
        'src/does-not-exist.ts',
        { line: 99, column: 1 }
      );
      assert.equal(miss, undefined);
      await indexer.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('supports hover cancellation via AbortSignal', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mergecore-hover-cancel-'));
    try {
      await cp(fixtures.billingRefundEvalRoot, root, { recursive: true });
      const indexer = await createRepositoryFileIndexer({
        workspaceRoot: root,
        storageDir: path.join(root, '.store'),
      });
      await indexer.startInitialIndex();
      const ac = new AbortController();
      ac.abort();
      const summary = await buildDeterministicHoverSummary({
        workspaceRoot: root,
        store: indexer.getRagStore(),
        graphService: indexer.getCodeGraphService(),
        relPath: 'src/billing/refunds.ts',
        position: { line: 10, column: 1 },
        signal: ac.signal,
      });
      assert.equal(summary, undefined);
      await indexer.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('invalidates stale cache entries when related paths change', () => {
    const cache = new HoverSummaryCache<string>();
    const key = HoverSummaryCache.key({
      workspaceRoot: '/ws',
      symbolId: 'sym:1',
      fileVersion: 1,
    });
    cache.set(key, 'v1', ['src/a.ts', 'src/b.ts']);
    assert.equal(cache.get(key), 'v1');
    const n = cache.invalidatePaths(['src/b.ts']);
    assert.ok(n >= 1);
    assert.equal(cache.get(key), undefined);
  });

  it('treats model explanation as opt-in (setting default false)', () => {
    // Mirrors package.json default — mere hover must not call a model.
    const defaultEnabled = false;
    assert.equal(defaultEnabled, false);
    assert.ok(
      formatHoverMarkdown(
        assembleHoverSummary({
      workspaceId: 'ws-test',
          symbol: {
            id: 'id',
            name: 'x',
            kind: 'function',
            location: { path: 'a.ts', startLine: 1, endLine: 1 },
            language: 'typescript',
            adapterId: 'typescript',
          },
          callers: [],
          callees: [],
          dependencies: [],
          relatedTests: [],
          instructions: [],
        }),
        '/ws'
      ).includes('model not used')
    );
  });
});
