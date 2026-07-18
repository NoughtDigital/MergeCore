import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { after, before, describe, it } from 'node:test';
import {
  createRepositoryFileIndexer,
  evaluatePathPrivacy,
  filterItemsForModelEvidence,
  filterPathsForModelEvidence,
  loadPrivacyDecisionsForPaths,
  previewIndexRules,
  redactChunkTextForPrivacy,
  savePrivacyOverride,
  wouldWeaken,
  type PrivacyRule,
} from '../../index';

async function mkTemp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mergecore-privacy-'));
}

async function writeFile(root: string, rel: string, body: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body, 'utf8');
}

describe('privacy rule engine', () => {
  let root: string;

  before(async () => {
    root = await mkTemp();
    await writeFile(root, 'src/app.ts', 'export const ok = 1;\n');
    await writeFile(root, 'secrets/token.txt', 'secret\n');
    await writeFile(root, 'customer.pem', '-----BEGIN-----\n');
    await writeFile(root, '.env', 'KEY=1\n');
    await writeFile(root, 'generated/out.ts', 'export const g = 1;\n');
    await writeFile(root, 'fixtures/private/data.ts', 'export const d = 1;\n');
    await writeFile(root, 'customer.php', '<?php class A {}\n');
    await writeFile(root, '.gitignore', 'ignored-by-git.ts\n');
    await writeFile(root, 'ignored-by-git.ts', 'export const x = 1;\n');
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('applies default never_index for secrets and pem', async () => {
    const secrets = await evaluatePathPrivacy({
      workspaceRoot: root,
      relPath: 'secrets/token.txt',
      skipGlobalFile: true,
    });
    assert.equal(secrets.classification, 'never_index');
    assert.equal(secrets.included, false);

    const pem = await evaluatePathPrivacy({
      workspaceRoot: root,
      relPath: 'key.pem',
      skipGlobalFile: true,
    });
    assert.equal(pem.classification, 'never_index');
  });

  it('classifies .env as never_send_to_model', async () => {
    const d = await evaluatePathPrivacy({
      workspaceRoot: root,
      relPath: '.env',
      skipGlobalFile: true,
    });
    assert.equal(d.classification, 'never_send_to_model');
    assert.equal(d.allowsModelEvidence, false);
    assert.equal(d.allowsRetrieval, true);
    assert.equal(d.included, true);
  });

  it('classifies generated as metadata_only', async () => {
    const d = await evaluatePathPrivacy({
      workspaceRoot: root,
      relPath: 'generated/out.ts',
      skipGlobalFile: true,
    });
    assert.equal(d.classification, 'metadata_only');
    assert.equal(d.allowsContentStorage, false);
  });

  it('classifies fixtures/private as local_only', async () => {
    const d = await evaluatePathPrivacy({
      workspaceRoot: root,
      relPath: 'fixtures/private/data.ts',
      skipGlobalFile: true,
    });
    assert.equal(d.classification, 'local_only');
    assert.equal(d.allowsModelEvidence, false);
  });

  it('maps gitignore to never_index', async () => {
    const d = await evaluatePathPrivacy({
      workspaceRoot: root,
      relPath: 'ignored-by-git.ts',
      skipGlobalFile: true,
    });
    assert.equal(d.classification, 'never_index');
    assert.equal(d.ruleSource, 'gitignore');
  });

  it('respects strength: never_index wins over never_send', async () => {
    const rules: PrivacyRule[] = [
      {
        pattern: 'shared/**',
        classification: 'never_send_to_model',
        source: 'workspace',
      },
      {
        pattern: 'shared/**',
        classification: 'never_index',
        source: 'global',
      },
    ];
    const d = await evaluatePathPrivacy({
      workspaceRoot: root,
      relPath: 'shared/a.ts',
      rules,
      skipGlobalFile: true,
    });
    assert.equal(d.classification, 'never_index');
  });

  it('blocks weaker nested rule without override', async () => {
    const rules: PrivacyRule[] = [
      {
        pattern: 'locked/**',
        classification: 'never_index',
        source: 'global',
      },
      {
        pattern: 'locked/**',
        classification: 'normal',
        include: true,
        source: 'workspace',
      },
    ];
    const blocked = await evaluatePathPrivacy({
      workspaceRoot: root,
      relPath: 'locked/a.ts',
      rules,
      skipGlobalFile: true,
    });
    assert.equal(blocked.classification, 'never_index');

    const allowed = await evaluatePathPrivacy({
      workspaceRoot: root,
      relPath: 'locked/a.ts',
      rules,
      overrides: { 'locked/a.ts': 'normal' },
      skipGlobalFile: true,
    });
    assert.equal(allowed.classification, 'normal');
    assert.equal(allowed.ruleSource, 'override');
  });

  it('wouldWeaken detects strength drop', () => {
    assert.equal(wouldWeaken('never_index', 'normal'), true);
    assert.equal(wouldWeaken('normal', 'never_send_to_model'), false);
  });

  it('workspace rules can add never_send on top of defaults', async () => {
    const ws = await mkTemp();
    try {
      await writeFile(ws, 'src/app.ts', 'export const ok = 1;\n');
      await writeFile(
        ws,
        '.mergecore/privacy.json',
        JSON.stringify({
          schemaVersion: 1,
          rules: [{ pattern: 'src/**', classification: 'never_send_to_model' }],
        })
      );
      const d = await evaluatePathPrivacy({
        workspaceRoot: ws,
        relPath: 'src/app.ts',
        skipGlobalFile: true,
      });
      assert.equal(d.classification, 'never_send_to_model');
      assert.equal(d.ruleSource, 'workspace');
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it('language-scoped rule matches php', async () => {
    const rules: PrivacyRule[] = [
      {
        pattern: '**/*',
        classification: 'never_send_to_model',
        languages: ['php'],
        source: 'workspace',
      },
    ];
    const php = await evaluatePathPrivacy({
      workspaceRoot: root,
      relPath: 'key.php',
      rules,
      skipGlobalFile: true,
    });
    assert.equal(php.classification, 'never_send_to_model');

    const ts = await evaluatePathPrivacy({
      workspaceRoot: root,
      relPath: 'src/app.ts',
      rules,
      skipGlobalFile: true,
    });
    assert.equal(ts.classification, 'normal');
  });

  it('filters model evidence paths', async () => {
    const decisions = await loadPrivacyDecisionsForPaths(
      root,
      ['.env', 'src/app.ts', 'secrets/token.txt'],
      { skipGlobalFile: true }
    );
    const allowed = filterPathsForModelEvidence(
      ['.env', 'src/app.ts', 'secrets/token.txt'],
      decisions
    );
    assert.ok(!allowed.includes('.env'));
    assert.ok(!allowed.includes('secrets/token.txt'));
    assert.ok(allowed.includes('src/app.ts'));
  });

  it('redacts chunk text for restricted classifications', () => {
    assert.match(
      redactChunkTextForPrivacy('secret', 'never_send_to_model'),
      /omitted/
    );
    assert.equal(redactChunkTextForPrivacy('ok', 'normal'), 'ok');
  });

  it('savePrivacyOverride persists weaker class', async () => {
    const ws = await mkTemp();
    try {
      savePrivacyOverride(ws, 'locked/b.ts', 'normal');
      const d = await evaluatePathPrivacy({
        workspaceRoot: ws,
        relPath: 'locked/b.ts',
        rules: [
          {
            pattern: 'locked/**',
            classification: 'never_index',
            source: 'global',
          },
        ],
        skipGlobalFile: true,
      });
      assert.equal(d.classification, 'normal');
      assert.equal(d.ruleSource, 'override');
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });
});

describe('privacy indexer modes', () => {
  it('metadata_only stores symbols without chunk text', async () => {
    const root = await mkTemp();
    try {
      await writeFile(
        root,
        'generated/widget.ts',
        'export function widget() { return 1; }\n'
      );
      await writeFile(root, 'src/ok.ts', 'export const ok = true;\n');
      const indexer = await createRepositoryFileIndexer({
        workspaceRoot: root,
        debugExclusions: true,
        skipGlobalPrivacyFile: true,
        useCompilerGraph: false,
      });
      try {
        await indexer.startInitialIndex();
        const store = indexer.getRagStore();
        const gen = store.getFile('generated/widget.ts');
        assert.ok(gen);
        assert.equal(gen!.privacy, 'metadata_only');
        assert.equal(gen!.chunkIds.length, 0);
        const ok = store.getFile('src/ok.ts');
        assert.ok(ok);
        assert.ok((ok!.privacy ?? 'normal') === 'normal');
        assert.ok(ok!.chunkIds.length > 0);
      } finally {
        await indexer.dispose();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('never_send_to_model tags indexed files', async () => {
    const root = await mkTemp();
    try {
      await writeFile(root, '.env', 'SECRET=1\n');
      // .env may not be a supported index extension — use customer-data
      await writeFile(
        root,
        'customer-data/profile.ts',
        'export const profile = { id: 1 };\n'
      );
      const indexer = await createRepositoryFileIndexer({
        workspaceRoot: root,
        debugExclusions: true,
        skipGlobalPrivacyFile: true,
        useCompilerGraph: false,
      });
      try {
        await indexer.startInitialIndex();
        const store = indexer.getRagStore();
        const file = store.getFile('customer-data/profile.ts');
        assert.ok(file);
        assert.equal(file!.privacy, 'never_send_to_model');
        assert.ok(file!.chunkIds.length > 0);
      } finally {
        await indexer.dispose();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('previewIndexRules', () => {
  it('returns included, excluded, and restricted rows', async () => {
    const root = await mkTemp();
    try {
      await writeFile(root, 'src/a.ts', 'export const a = 1;\n');
      await writeFile(root, 'secrets/x.txt', 'no\n');
      await writeFile(root, 'src/private.ts', 'export const secret = 1;\n');
      await writeFile(
        root,
        '.mergecore/privacy.json',
        JSON.stringify({
          schemaVersion: 1,
          rules: [{ pattern: 'src/private.ts', classification: 'never_send_to_model' }],
        })
      );
      const preview = await previewIndexRules({
        workspaceRoot: root,
        skipGlobalFile: true,
        maxFiles: 100,
      });
      assert.ok(preview.excluded.some((r) => r.path.includes('secrets')));
      assert.ok(preview.restricted.some((r) => r.path === 'src/private.ts'));
      assert.ok(preview.included.some((r) => r.path === 'src/a.ts'));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('model evidence filter', () => {
  it('filters items by decision map', () => {
    const decisions = new Map([
      [
        'a.ts',
        {
          path: 'a.ts',
          classification: 'normal' as const,
          ruleSource: 'default' as const,
          allowsRetrieval: true,
          allowsModelEvidence: true,
          allowsContentStorage: true,
          allowsSymbolIndex: true,
          included: true,
        },
      ],
      [
        '.env',
        {
          path: '.env',
          classification: 'never_send_to_model' as const,
          ruleSource: 'default' as const,
          allowsRetrieval: true,
          allowsModelEvidence: false,
          allowsContentStorage: true,
          allowsSymbolIndex: true,
          included: true,
        },
      ],
    ]);
    const items = filterItemsForModelEvidence(
      [{ path: 'a.ts' }, { path: '.env' }],
      decisions
    );
    assert.deepEqual(items.map((i) => i.path), ['a.ts']);
  });
});
