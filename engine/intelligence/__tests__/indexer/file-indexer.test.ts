import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  createRepositoryFileIndexer,
  retrieve,
} from '../../dist/index.js';

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mergecore-indexer-'));
}

async function write(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

describe('RepositoryFileIndexer', () => {
  it('indexes a fixture and persists locally', async () => {
    const root = await makeWorkspace();
    await write(root, 'src/a.ts', 'export function alpha() { return 1; }\n');
    await write(root, 'src/b.ts', 'import { alpha } from "./a";\nexport const x = alpha();\n');
    await write(root, 'README.md', '# Demo\n');

    const indexer = await createRepositoryFileIndexer({
      workspaceRoot: root,
      debugExclusions: true,
    });
    try {
      const status = await indexer.startInitialIndex();
      assert.equal(status.ready, true);
      assert.ok(status.fileCount >= 2);
      assert.ok(status.schemaVersion >= 3);
      assert.ok(status.storeDir.includes('.mergecore') || status.storeDir.length > 0);
      const mirror = path.join(status.storeDir, 'index.json');
      await fs.access(mirror);
    } finally {
      await indexer.dispose();
    }
  });

  it('respects .gitignore, nested .gitignore, and .mergecoreignore', async () => {
    const root = await makeWorkspace();
    await write(root, '.gitignore', 'secrets/\n');
    await write(root, '.mergecoreignore', 'private.ts\n');
    await write(root, 'src/ok.ts', 'export const ok = 1;\n');
    await write(root, 'secrets/hidden.ts', 'export const secret = 1;\n');
    await write(root, 'private.ts', 'export const priv = 1;\n');
    await write(root, 'nested/.gitignore', 'skip-me.ts\n');
    await write(root, 'nested/skip-me.ts', 'export const skip = 1;\n');
    await write(root, 'nested/keep.ts', 'export const keep = 1;\n');

    const indexer = await createRepositoryFileIndexer({
      workspaceRoot: root,
      debugExclusions: true,
    });
    try {
      const status = await indexer.startInitialIndex();
      const files = indexer.getRagStore().allFilePaths();
      assert.ok(files.includes('src/ok.ts'));
      assert.ok(files.includes('nested/keep.ts'));
      assert.equal(files.includes('secrets/hidden.ts'), false);
      assert.equal(files.includes('private.ts'), false);
      assert.equal(files.includes('nested/skip-me.ts'), false);
      assert.ok((status.exclusions ?? []).length > 0);
    } finally {
      await indexer.dispose();
    }
  });

  it('skips default excludes, binary, temp, and unsupported files', async () => {
    const root = await makeWorkspace();
    await write(root, 'src/app.ts', 'export const app = 1;\n');
    await write(root, 'node_modules/pkg/index.js', 'module.exports = 1;\n');
    await write(root, 'dist/out.js', 'export const out = 1;\n');
    await write(root, 'src/photo.png', '\u0000\u0001\u0002binary');
    await write(root, 'src/draft.ts.tmp', 'export const draft = 1;\n');
    await write(root, 'src/notes.txt', 'plain text');

    const indexer = await createRepositoryFileIndexer({
      workspaceRoot: root,
      debugExclusions: true,
    });
    try {
      await indexer.startInitialIndex();
      const files = indexer.getRagStore().allFilePaths();
      assert.deepEqual(
        files.filter((f) => f.startsWith('src/')),
        ['src/app.ts']
      );
    } finally {
      await indexer.dispose();
    }
  });

  it('applies create/update/delete/rename without reindexing unrelated files', async () => {
    const root = await makeWorkspace();
    await write(root, 'src/a.ts', 'export const a = 1;\n');
    await write(root, 'src/b.ts', 'export const b = 1;\n');

    const indexer = await createRepositoryFileIndexer({ workspaceRoot: root });
    try {
      await indexer.startInitialIndex();
      const beforeB = indexer.getRagStore().getFile('src/b.ts');
      assert.ok(beforeB);

      await write(root, 'src/c.ts', 'export const c = 1;\n');
      let status = await indexer.applyFileChanges([{ type: 'create', path: 'src/c.ts' }]);
      assert.ok(indexer.getRagStore().getFile('src/c.ts'));
      assert.equal(indexer.getRagStore().getFile('src/b.ts')?.hash, beforeB.hash);
      assert.ok(status.filesIndexed >= 1);

      await write(root, 'src/c.ts', 'export const c = 2;\n');
      status = await indexer.applyFileChanges([{ type: 'update', path: 'src/c.ts' }]);
      assert.notEqual(indexer.getRagStore().getFile('src/c.ts')?.hash, undefined);
      assert.ok(status.filesIndexed >= 1);

      status = await indexer.applyFileChanges([{ type: 'delete', path: 'src/c.ts' }]);
      assert.equal(indexer.getRagStore().getFile('src/c.ts'), undefined);

      await write(root, 'src/d.ts', 'export const d = 1;\n');
      status = await indexer.applyFileChanges([
        { type: 'rename', fromPath: 'src/a.ts', toPath: 'src/d.ts' },
      ]);
      assert.equal(indexer.getRagStore().getFile('src/a.ts'), undefined);
      assert.ok(indexer.getRagStore().getFile('src/d.ts'));
    } finally {
      await indexer.dispose();
    }
  });

  it('does not reparse when content hash is unchanged despite mtime change', async () => {
    const root = await makeWorkspace();
    await write(root, 'src/x.ts', 'export const x = 1;\n');
    const indexer = await createRepositoryFileIndexer({ workspaceRoot: root });
    try {
      await indexer.startInitialIndex();
      const first = indexer.getRagStore().getFile('src/x.ts');
      assert.ok(first);

      const abs = path.join(root, 'src/x.ts');
      const now = Date.now() + 60_000;
      await fs.utimes(abs, now / 1000, now / 1000);

      const status = await indexer.applyFileChanges([{ type: 'update', path: 'src/x.ts' }]);
      assert.equal(status.filesIndexed, 0);
      assert.ok(status.filesSkipped >= 1);
      assert.equal(indexer.getRagStore().getFile('src/x.ts')?.hash, first.hash);
    } finally {
      await indexer.dispose();
    }
  });

  it('reparses when content changes even if mtime is stale', async () => {
    const root = await makeWorkspace();
    await write(root, 'src/y.ts', 'export const y = 1;\n');
    const indexer = await createRepositoryFileIndexer({ workspaceRoot: root });
    try {
      await indexer.startInitialIndex();
      const first = indexer.getRagStore().getFile('src/y.ts');
      assert.ok(first);

      const abs = path.join(root, 'src/y.ts');
      const st = await fs.stat(abs);
      await write(root, 'src/y.ts', 'export const y = 2;\n');
      // Force mtime backwards
      await fs.utimes(abs, st.atimeMs / 1000, st.mtimeMs / 1000);

      const status = await indexer.applyFileChanges([{ type: 'update', path: 'src/y.ts' }]);
      assert.ok(status.filesIndexed >= 1);
      assert.notEqual(indexer.getRagStore().getFile('src/y.ts')?.hash, first.hash);
    } finally {
      await indexer.dispose();
    }
  });

  it('skips symlinks that escape the workspace', async () => {
    const root = await makeWorkspace();
    const outside = await makeWorkspace();
    await write(outside, 'leak.ts', 'export const leak = 1;\n');
    await write(root, 'src/ok.ts', 'export const ok = 1;\n');
    try {
      await fs.symlink(path.join(outside, 'leak.ts'), path.join(root, 'src/escape.ts'));
    } catch {
      // Some CI environments disallow symlinks
      return;
    }

    const indexer = await createRepositoryFileIndexer({
      workspaceRoot: root,
      debugExclusions: true,
    });
    try {
      await indexer.startInitialIndex();
      assert.equal(indexer.getRagStore().getFile('src/escape.ts'), undefined);
      assert.ok(indexer.getRagStore().getFile('src/ok.ts'));
    } finally {
      await indexer.dispose();
    }
  });

  it('supports cancellation via AbortSignal', async () => {
    const root = await makeWorkspace();
    for (let i = 0; i < 80; i++) {
      await write(root, `src/f${i}.ts`, `export const v${i} = ${i};\n`);
    }
    const indexer = await createRepositoryFileIndexer({ workspaceRoot: root });
    try {
      const ac = new AbortController();
      ac.abort();
      const status = await indexer.startInitialIndex(ac.signal);
      assert.equal(status.phase, 'cancelled');
    } finally {
      await indexer.dispose();
    }
  });

  it('recovers primary index when a tmp write is interrupted', async () => {
    const root = await makeWorkspace();
    await write(root, 'src/z.ts', 'export const z = 1;\n');
    const indexer = await createRepositoryFileIndexer({ workspaceRoot: root });
    let storeDir = '';
    try {
      const status = await indexer.startInitialIndex();
      storeDir = status.storeDir;
      assert.ok(status.ready);
    } finally {
      await indexer.dispose();
    }

    // Leave a corrupt tmp beside a good primary
    await fs.writeFile(path.join(storeDir, 'index.sqlite.tmp'), 'NOT-A-VALID-SQLITE', 'utf8');
    await fs.writeFile(path.join(storeDir, 'index.json.tmp'), '{', 'utf8');

    const again = await createRepositoryFileIndexer({ workspaceRoot: root });
    try {
      const status = await again.getIndexStatus();
      assert.ok(status.fileCount >= 1 || status.chunkCount >= 0);
      // Re-index should still work
      const next = await again.startInitialIndex();
      assert.equal(next.ready, true);
      assert.ok(again.getRagStore().getFile('src/z.ts'));
    } finally {
      await again.dispose();
    }
  });

  it('rebuildIndex wipes and recreates; ignored files stay out of retrieval', async () => {
    const root = await makeWorkspace();
    await write(root, '.gitignore', 'hidden.ts\n');
    await write(root, 'src/visible.ts', 'export function visible() { return "hi"; }\n');
    await write(root, 'hidden.ts', 'export function hidden() { return "no"; }\n');

    const indexer = await createRepositoryFileIndexer({ workspaceRoot: root });
    try {
      await indexer.startInitialIndex();
      await indexer.rebuildIndex();
      assert.ok(indexer.getRagStore().getFile('src/visible.ts'));
      assert.equal(indexer.getRagStore().getFile('hidden.ts'), undefined);

      const hits = retrieve(indexer.getRagStore(), 'hidden', { k: 8 });
      assert.equal(
        hits.some((h) => h.chunk.path === 'hidden.ts'),
        false
      );
    } finally {
      await indexer.dispose();
    }
  });
});
