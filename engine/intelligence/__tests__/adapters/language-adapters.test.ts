import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PhpLanguageAdapter,
  TypeScriptLanguageAdapter,
  collectAdapterEdges,
  createRepositoryFileIndexer,
  createRepositorySearchEngine,
  detectWorkspaceLanguages,
  defaultLanguageAdapters,
  evaluateRetrievalTasks,
  resolveLanguageAdapter,
} from '../../dist/index.js';

const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/test-fixtures'
);
const phpMiniRoot = path.join(fixturesRoot, 'php-mini');

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

describe('language adapter system', () => {
  it('reports capabilities without pretending unsupported features exist', () => {
    const php = new PhpLanguageAdapter();
    assert.equal(php.capabilities.fileExtensionDetection, true);
    assert.equal(php.capabilities.symbolExtraction, 'heuristic');
    assert.equal(php.capabilities.callersOrReferences, 'heuristic');
    assert.equal(php.capabilities.prefersCompilerGraph, undefined);

    const ts = new TypeScriptLanguageAdapter();
    assert.equal(ts.capabilities.prefersCompilerGraph, true);
    assert.equal(ts.capabilities.symbolExtraction, 'deterministic');
    assert.equal(ts.capabilities.callersOrReferences, 'deterministic');
  });

  it('resolves adapters by extension in multi-language workspaces', () => {
    const adapters = defaultLanguageAdapters();
    assert.equal(resolveLanguageAdapter('app/Models/Order.php', adapters).adapterId, 'php');
    assert.equal(resolveLanguageAdapter('src/util.ts', adapters).adapterId, 'typescript');
    assert.equal(resolveLanguageAdapter('src/index.js', adapters).adapterId, 'javascript');
  });

  it('detects PHP/Laravel projects', () => {
    const hints = detectWorkspaceLanguages(phpMiniRoot, [
      'composer.json',
      'artisan',
      'app',
      'routes',
    ]);
    const php = hints.find((h) => h.adapterId === 'php');
    assert.ok(php);
    assert.equal(php!.confidence, 'high');
    assert.ok(php!.frameworkHints?.includes('laravel'));
  });

  it('extracts PHP symbols with adapterId and Laravel roles', () => {
    const adapter = new PhpLanguageAdapter(phpMiniRoot);
    const content = fs.readFileSync(
      path.join(phpMiniRoot, 'app/Http/Controllers/OrderController.php'),
      'utf8'
    );
    const symbols = adapter.extractSymbols(
      'app/Http/Controllers/OrderController.php',
      content
    );
    assert.ok(symbols.every((s) => s.adapterId === 'php'));
    assert.ok(symbols.some((s) => s.name === 'OrderController' && s.kind === 'class'));
    assert.ok(symbols.some((s) => s.name === 'refund' && s.kind === 'method'));
    assert.ok(symbols.some((s) => s.name === '__construct' && s.kind === 'constructor'));
  });

  it('extracts PHP use/extends/implements/routes/tests as edges', () => {
    const adapter = new PhpLanguageAdapter(phpMiniRoot);
    const controller = fs.readFileSync(
      path.join(phpMiniRoot, 'app/Http/Controllers/OrderController.php'),
      'utf8'
    );
    const edges = collectAdapterEdges(
      adapter,
      'app/Http/Controllers/OrderController.php',
      controller
    );
    assert.ok(edges.some((e) => e.kind === 'import' && e.specifier.includes('Order')));
    assert.ok(
      edges.some(
        (e) =>
          e.kind === 'typeUsage' &&
          (e.evidence?.includes('constructor-injection') ?? false)
      )
    );

    const routes = fs.readFileSync(path.join(phpMiniRoot, 'routes/api.php'), 'utf8');
    const routeEdges = collectAdapterEdges(adapter, 'routes/api.php', routes);
    assert.ok(routeEdges.some((e) => e.specifier.startsWith('route:POST')));
    assert.ok(
      routeEdges.every(
        (e) =>
          e.resolutionMethod === 'convention' ||
          e.resolutionMethod === 'heuristic' ||
          e.resolutionMethod === 'unresolved'
      )
    );

    const job = fs.readFileSync(path.join(phpMiniRoot, 'app/Jobs/ProcessRefund.php'), 'utf8');
    const jobEdges = collectAdapterEdges(adapter, 'app/Jobs/ProcessRefund.php', job);
    assert.ok(jobEdges.some((e) => e.kind === 'implements'));

    const test = fs.readFileSync(
      path.join(phpMiniRoot, 'tests/Feature/OrderRefundTest.php'),
      'utf8'
    );
    const testEdges = collectAdapterEdges(
      adapter,
      'tests/Feature/OrderRefundTest.php',
      test
    );
    assert.ok(testEdges.some((e) => e.kind === 'likelyTestCoverage'));
  });

  it('indexes php-mini through the same core indexer APIs', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mergecore-php-'));
    const root = path.join(tmp, 'repo');
    copyDir(phpMiniRoot, root);
    const storageDir = path.join(tmp, 'rag');

    const indexer = await createRepositoryFileIndexer({
      workspaceRoot: root,
      storageDir,
      useCompilerGraph: true,
    });
    try {
      const status = await indexer.startInitialIndex();
      assert.ok(status.fileCount >= 8, `expected files, got ${status.fileCount}`);
      assert.ok(status.symbolCount >= 5, `expected symbols, got ${status.symbolCount}`);
      assert.ok(status.edgeCount >= 5, `expected edges, got ${status.edgeCount}`);

      const store = indexer.getRagStore();
      const symbols = store.allSymbols();
      assert.ok(symbols.every((s) => s.adapterId === 'php' || s.adapterId === 'typescript' || s.adapterId === 'javascript'));
      assert.ok(symbols.some((s) => s.language === 'php' && s.adapterId === 'php'));

      const xref = store.allEdges().filter((e) => e.evidence?.includes('cross-language-route-string'));
      assert.ok(xref.length >= 1, 'expected cross-language route evidence');

      const engine = await createRepositorySearchEngine({ store });
      const result = await engine.searchRepositoryContext('OrderController refund');
      assert.ok(result.results.length > 0);
      assert.equal(result.incomplete === true || result.results.length > 0, true);
    } finally {
      await indexer.dispose();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('evaluates php-mini retrieval tasks', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mergecore-php-eval-'));
    const root = path.join(tmp, 'repo');
    copyDir(phpMiniRoot, root);
    const storageDir = path.join(tmp, 'rag');

    const indexer = await createRepositoryFileIndexer({
      workspaceRoot: root,
      storageDir,
      useCompilerGraph: false,
    });
    try {
      await indexer.startInitialIndex();
      const store = indexer.getRagStore();
      const engine = await createRepositorySearchEngine({ store });
      const tasks = JSON.parse(
        fs.readFileSync(path.join(phpMiniRoot, 'eval-tasks.json'), 'utf8')
      ) as { tasks: Array<{ id: string; query: string; relevantFiles: string[] }> };

      const k = 8;
      const retrievedByTask = new Map<string, string[]>();
      for (const task of tasks.tasks) {
        const files = await engine.findRelevantFiles(task.query, { k: 16 });
        retrievedByTask.set(
          task.id,
          files.map((f) => f.path)
        );
      }
      const summary = evaluateRetrievalTasks(tasks.tasks, retrievedByTask, k);
      assert.equal(summary.tasks.length, tasks.tasks.length);
      assert.ok(summary.meanRecallAtK > 0, 'mean recall should be > 0');
      for (const s of summary.tasks) {
        assert.ok(s.recallAtK > 0, `${s.taskId} recall should be > 0`);
      }
    } finally {
      await indexer.dispose();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
