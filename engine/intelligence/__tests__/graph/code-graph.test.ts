import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import {
  createCodeGraphQuery,
  createRepositoryFileIndexer,
  STORE_SCHEMA_VERSION,
} from '../../dist/index.js';

const require = createRequire(import.meta.url);
const { typescriptGraphRoot } = require('../../../../packages/test-fixtures/index.js') as {
  typescriptGraphRoot: string;
};

async function copyFixture(src: string, dest: string): Promise<void> {
  await fs.cp(src, dest, { recursive: true });
}

describe('TS/JS code graph', () => {
  let workspaceRoot: string;
  let storageDir: string;

  before(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mergecore-graph-'));
    storageDir = path.join(workspaceRoot, '.mergecore-store');
    await copyFixture(typescriptGraphRoot, workspaceRoot);
  });

  after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('extracts symbols, callers, inheritance, and marks uncertain dynamics', async () => {
    const indexer = await createRepositoryFileIndexer({
      workspaceRoot,
      storageDir,
    });
    try {
      const status = await indexer.startInitialIndex();
      assert.equal(status.schemaVersion, STORE_SCHEMA_VERSION);
      assert.ok(status.symbolCount > 5);
      assert.ok(status.edgeCount > 5);

      const store = indexer.getRagStore();
      const query = createCodeGraphQuery(store, indexer.getCodeGraphService());

      const addHits = query.findSymbol('add', { kind: 'function', pathPrefix: 'src/' });
      assert.ok(addHits.length >= 1);
      const addSym = addHits.find((s) => s.location.path === 'src/core.ts');
      assert.ok(addSym);
      assert.ok(addSym!.jsdocSummary?.toLowerCase().includes('adds'));
      assert.ok(addSym!.parameters && addSym!.parameters.length >= 1);

      const helloClass = query.findSymbol('HelloService', { kind: 'class' })[0];
      assert.ok(helloClass);
      const extendsEdges = store
        .allEdges()
        .filter((e) => e.kind === 'extends' && e.fromSymbol === helloClass!.id);
      assert.ok(extendsEdges.length >= 1);
      assert.equal(extendsEdges[0]!.confidence, 'certain');

      const implementsEdges = store
        .allEdges()
        .filter((e) => e.kind === 'implements' && e.fromSymbol === helloClass!.id);
      assert.ok(implementsEdges.length >= 1);

      const callers = query.getCallers(addSym!.id);
      assert.ok(
        callers.length >= 1,
        `expected callers of add, got ${callers.length}`
      );
      assert.ok(callers.every((c) => c.startLine !== undefined));

      const dynamicCalls = store
        .allEdges()
        .filter(
          (e) =>
            e.kind === 'call' &&
            e.fromPath === 'src/hello.ts' &&
            (e.confidence === 'heuristic' || e.resolutionMethod === 'unresolved')
        );
      assert.ok(dynamicCalls.length >= 1, 'expected unresolved dynamic call edges');

      const aliasImport = store
        .allEdges()
        .filter(
          (e) =>
            e.fromPath === 'src/hello.ts' &&
            e.kind === 'import' &&
            e.specifier.includes('@lib/')
        );
      assert.ok(aliasImport.length >= 1);
      assert.ok(
        aliasImport.some(
          (e) => e.resolutionMethod === 'path-alias' || e.toPath.includes('format')
        )
      );

      const reExport = store
        .allEdges()
        .filter((e) => e.fromPath === 'src/hello.ts' && e.kind === 'export');
      assert.ok(reExport.length >= 1);

      const atPos = query.getSymbolAtPosition('src/core.ts', {
        line: addSym!.location.startLine,
        column: addSym!.location.startColumn ?? 1,
      });
      assert.ok(atPos);
      assert.equal(atPos!.id, addSym!.id);

      const def = query.getSymbolDefinition(addSym!.id);
      assert.equal(def?.id, addSym!.id);

      const related = query.getRelatedTests(addSym!.id);
      assert.ok(related.length >= 1, 'expected related tests for add');
      assert.ok(related.every((r) => (r.evidence?.length ?? 0) > 0));
      assert.ok(
        related.every((r) => r.confidence !== undefined),
        'related tests must expose confidence'
      );

      const deps = query.getDependencies(helloClass!.id);
      const traverse = query.traverseGraph(addSym!.id, {
        maxDepth: 2,
        direction: 'incoming',
        kinds: ['call'],
      });
      assert.ok(traverse.length >= 1);
      void deps;
    } finally {
      await indexer.dispose();
    }
  });

  it('updates graph incrementally when a symbol is deleted', async () => {
    const indexer = await createRepositoryFileIndexer({
      workspaceRoot,
      storageDir: path.join(workspaceRoot, '.mergecore-store-inc'),
    });
    try {
      await indexer.startInitialIndex();
      const store = indexer.getRagStore();
      const query = createCodeGraphQuery(store, indexer.getCodeGraphService());
      const before = query.findSymbol('indirect');
      assert.ok(before.length >= 1);

      const appPath = path.join(workspaceRoot, 'src', 'app.ts');
      const original = await fs.readFile(appPath, 'utf8');
      const stripped = original
        .replace(/export function indirect\(\): string \{\n  return main\(\);\n\}\n/, '')
        .replace(/export function indirect\(\): string \{\r?\n  return main\(\);\r?\n\}\r?\n/, '');
      await fs.writeFile(appPath, stripped, 'utf8');

      await indexer.applyFileChanges([{ type: 'update', path: 'src/app.ts' }]);

      const after = query.findSymbol('indirect');
      assert.equal(after.length, 0);

      // Call edges from deleted symbol should be gone
      const stale = store
        .allEdges()
        .filter((e) => e.fromSymbol?.includes(':indirect:'));
      assert.equal(stale.length, 0);

      await fs.writeFile(appPath, original, 'utf8');
      await indexer.applyFileChanges([{ type: 'update', path: 'src/app.ts' }]);
      assert.ok(query.findSymbol('indirect').length >= 1);
    } finally {
      await indexer.dispose();
    }
  });

  it('does not claim tested solely from similar filenames', async () => {
    const indexer = await createRepositoryFileIndexer({
      workspaceRoot,
      storageDir: path.join(workspaceRoot, '.mergecore-store-tests'),
    });
    try {
      await indexer.startInitialIndex();
      const store = indexer.getRagStore();
      const namingOnly = store
        .allEdges()
        .filter(
          (e) =>
            e.kind === 'likelyTestCoverage' &&
            e.resolutionMethod === 'naming-heuristic' &&
            (!e.evidence || e.evidence.every((ev) => !ev.startsWith('imports:')))
        );
      // Naming-only edges must be heuristic and include the note
      for (const e of namingOnly) {
        assert.equal(e.confidence, 'heuristic');
        assert.ok(e.evidence?.some((ev) => ev.includes('not-sufficient')));
      }

      const importBacked = store
        .allEdges()
        .filter(
          (e) =>
            e.kind === 'likelyTestCoverage' &&
            e.evidence?.some((ev) => ev.startsWith('imports:'))
        );
      assert.ok(importBacked.length >= 1);
      assert.ok(
        importBacked.every(
          (e) => e.confidence === 'high' || e.confidence === 'certain'
        )
      );
    } finally {
      await indexer.dispose();
    }
  });
});
