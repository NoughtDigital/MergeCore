import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { createRepositoryIndex } from '../dist/index.js';

const require = createRequire(__filename);
const fixtures = require('../../../packages/test-fixtures/index.js') as {
  typescriptMiniRoot: string;
  javascriptMiniRoot: string;
};

async function copyFixture(srcRoot: string): Promise<string> {
  const dest = await fs.mkdtemp(path.join(os.tmpdir(), 'mergecore-fixture-'));
  await fs.cp(srcRoot, dest, { recursive: true });
  return dest;
}

describe('createRepositoryIndex public API (no VS Code)', () => {
  it('indexes a TypeScript fixture and retrieves evidence-backed claims', async () => {
    const workspace = await copyFixture(fixtures.typescriptMiniRoot);
    const repo = await createRepositoryIndex(workspace);
    try {
      const statusBefore = await repo.getStatus();
      assert.equal(statusBefore.workspaceRoot, path.resolve(workspace));

      const status = await repo.index();
      assert.ok(status.fileCount >= 3, `expected files, got ${status.fileCount}`);
      assert.ok(status.chunkCount > 0, 'expected chunks');
      assert.ok(status.symbolCount > 0, `expected symbols, got ${status.symbolCount}`);
      assert.ok(status.edgeCount > 0, `expected dependency edges, got ${status.edgeCount}`);
      assert.equal(status.ready, true);

      // dist/ignored.js must not be indexed (RAG_WALK_EXCLUDE + gitignore)
      const ignored = path.join(workspace, '.mergecore', 'rag', 'index.json');
      const mirror = JSON.parse(await fs.readFile(ignored, 'utf8')) as {
        files: Record<string, unknown>;
      };
      assert.equal(mirror.files['dist/ignored.js'], undefined);

      const result = await repo.retrieve('formatGreeting', { k: 8 });
      assert.ok(result.claims.length > 0, 'expected claims');
      assert.ok(result.claims.some((c) => c.references.some((r) => r.path.includes('util'))));
      for (const claim of result.claims) {
        assert.ok(claim.references.length > 0, 'every claim needs source references');
        for (const ref of claim.references) {
          assert.ok(ref.path);
          assert.ok(ref.startLine >= 1);
          assert.ok(ref.endLine >= ref.startLine);
          assert.ok(ref.sourceType);
        }
      }

      const pack = await repo.buildContextPack('greet', { k: 6 });
      assert.equal(pack.query, 'greet');
      assert.ok(pack.claims.length > 0);
      assert.ok(pack.instructions.some((d) => d.kind === 'readme'));
      assert.ok(pack.references.length > 0);
    } finally {
      await repo.close();
    }
  });

  it('indexes a JavaScript fixture with import and require edges', async () => {
    const workspace = await copyFixture(fixtures.javascriptMiniRoot);
    const repo = await createRepositoryIndex(workspace);
    try {
      const status = await repo.index();
      assert.ok(status.fileCount >= 3);
      assert.ok(status.symbolCount > 0);
      assert.ok(status.edgeCount >= 2, `expected import+require edges, got ${status.edgeCount}`);

      const result = await repo.retrieve('shout', { k: 8 });
      assert.ok(result.claims.length > 0);
      assert.equal(typeof result.incomplete, 'boolean');
    } finally {
      await repo.close();
    }
  });
});
