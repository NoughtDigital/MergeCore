import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createRepositoryFileIndexer } from '../../dist/index.js';

describe('indexer benchmark (measured)', () => {
  it('reports initial and single-file reindex timings for >=300 files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mergecore-bench-'));
    const count = 320;
    for (let i = 0; i < count; i++) {
      const dir = path.join(root, 'src', `mod${i % 40}`);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, `f${i}.ts`),
        `export function fn${i}(x: number): number {\n  return x + ${i};\n}\n`,
        'utf8'
      );
    }
    await fs.writeFile(path.join(root, 'README.md'), '# Bench\n', 'utf8');

    const indexer = await createRepositoryFileIndexer({ workspaceRoot: root });
    try {
      const t0 = performance.now();
      const initial = await indexer.startInitialIndex();
      const initialMs = performance.now() - t0;
      assert.ok(initial.fileCount >= count);
      assert.equal(initial.ready, true);

      const target = `src/mod0/f0.ts`;
      await fs.writeFile(
        path.join(root, target),
        `export function fn0(x: number): number {\n  return x + 999;\n}\n`,
        'utf8'
      );
      const t1 = performance.now();
      const single = await indexer.applyFileChanges([{ type: 'update', path: target }]);
      const singleFileReindexMs = performance.now() - t1;
      assert.ok(single.filesIndexed >= 1);

      // Measured timings — do not invent; print for observability.
      console.log(
        JSON.stringify({
          benchmark: 'repository-file-indexer',
          fileCount: count,
          initialMs: Math.round(initialMs * 100) / 100,
          singleFileReindexMs: Math.round(singleFileReindexMs * 100) / 100,
          chunkCount: initial.chunkCount,
          symbolCount: initial.symbolCount,
        })
      );
    } finally {
      await indexer.dispose();
    }
  });
});
