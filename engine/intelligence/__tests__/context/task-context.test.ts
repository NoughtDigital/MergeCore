import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import {
  assembleTaskContextPack,
  budgetsForDepth,
  createRepositoryFileIndexer,
  packHasRequiredSections,
  parseTaskContextFrontmatter,
  REQUIRED_TASK_CONTEXT_SECTIONS,
  writeTaskContextPack,
} from '../../index.js';

const require = createRequire(import.meta.url);
const fixtures = require('../../../../packages/test-fixtures/index.js') as {
  billingRefundEvalRoot: string;
  typescriptGraphRoot: string;
};

async function makeRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'mergecore-task-ctx-'));
}

async function write(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
}

async function indexRoot(root: string) {
  const indexer = await createRepositoryFileIndexer({
    workspaceRoot: root,
    storageDir: path.join(root, '.store'),
  });
  await indexer.startInitialIndex();
  return indexer;
}

describe('Generate Task Context', () => {
  it('builds a pack for partial subscription refunds with instructions, code, tests, sources', async () => {
    const root = await makeRoot();
    try {
      await cp(fixtures.billingRefundEvalRoot, root, { recursive: true });
      const indexer = await indexRoot(root);
      const pack = await assembleTaskContextPack({
        workspaceRoot: root,
        store: indexer.getRagStore(),
        task: 'Add partial refunds to subscriptions.',
        depth: 'standard',
        graphService: indexer.getCodeGraphService(),
      });
      for (const h of REQUIRED_TASK_CONTEXT_SECTIONS) {
        assert.ok(pack.markdown.includes(`# ${h}`), `missing ${h}`);
      }
      assert.ok(packHasRequiredSections(pack.markdown));
      assert.match(pack.markdown, /refund|billing|subscription/i);
      assert.ok(
        pack.markdown.includes('AGENTS.md') ||
          pack.sections
            .find((s) => s.title === 'Applicable instructions')
            ?.bullets.some((b) => /agents|adr|convention/i.test(b))
      );
      assert.ok(
        pack.sections
          .find((s) => s.title === 'Tests likely affected')
          ?.bullets.some((b) => /refund|test/i.test(b)) ||
          pack.markdown.includes('tests/')
      );
      assert.ok(pack.meta.sources.length > 0);
      assert.equal(pack.meta.modelProvider, 'none');
      assert.equal(pack.meta.dataLeftMachine, false);
      await indexer.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('covers a protected API endpoint task', async () => {
    const root = await makeRoot();
    try {
      await write(
        root,
        'tsconfig.json',
        JSON.stringify({
          compilerOptions: { strict: true, module: 'ESNext', target: 'ES2020' },
          include: ['src/**/*', 'tests/**/*'],
        })
      );
      await write(
        root,
        'AGENTS.md',
        '# Agents\n\n- Protect mutating routes with auth middleware.\n'
      );
      await write(
        root,
        'src/middleware/auth.ts',
        `export function requireAuth(req: { user?: string }): void {\n  if (!req.user) throw new Error('unauthorised');\n}\n`
      );
      await write(
        root,
        'src/routes/orders.ts',
        `import { requireAuth } from '../middleware/auth';\nexport function createOrder(req: { user?: string }): string {\n  requireAuth(req);\n  return 'ok';\n}\n`
      );
      await write(
        root,
        'tests/orders.test.ts',
        `import { createOrder } from '../src/routes/orders';\ntest('rejects anonymous', () => {\n  expect(() => createOrder({})).toThrow();\n});\n`
      );
      const indexer = await indexRoot(root);
      const pack = await assembleTaskContextPack({
        workspaceRoot: root,
        store: indexer.getRagStore(),
        task: 'Add a protected API endpoint for creating orders',
        depth: 'standard',
        selectedFiles: ['src/routes/orders.ts'],
        graphService: indexer.getCodeGraphService(),
      });
      assert.ok(pack.markdown.includes('# Applicable instructions'));
      assert.ok(/auth|protect|orders/i.test(pack.markdown));
      assert.ok(pack.sections.some((s) => s.title === 'Risks and edge cases'));
      await indexer.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('handles shared type changes with importers', async () => {
    const root = await makeRoot();
    try {
      await write(
        root,
        'tsconfig.json',
        JSON.stringify({
          compilerOptions: { strict: true, module: 'ESNext', target: 'ES2020' },
          include: ['src/**/*'],
        })
      );
      await write(
        root,
        'src/types.ts',
        `export type Money = { amount: number; currency: string };\n`
      );
      await write(
        root,
        'src/a.ts',
        `import type { Money } from './types';\nexport function format(m: Money): string { return String(m.amount); }\n`
      );
      await write(
        root,
        'src/b.ts',
        `import type { Money } from './types';\nexport function double(m: Money): Money { return { ...m, amount: m.amount * 2 }; }\n`
      );
      const indexer = await indexRoot(root);
      const pack = await assembleTaskContextPack({
        workspaceRoot: root,
        store: indexer.getRagStore(),
        task: 'Change the shared Money type',
        depth: 'standard',
        selectedFiles: ['src/types.ts'],
        graphService: indexer.getCodeGraphService(),
      });
      assert.ok(/types\.ts|Money|a\.ts|b\.ts/i.test(pack.markdown));
      await indexer.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('handles a frontend component task', async () => {
    const root = await makeRoot();
    try {
      await write(
        root,
        'tsconfig.json',
        JSON.stringify({
          compilerOptions: {
            strict: true,
            module: 'ESNext',
            target: 'ES2020',
            jsx: 'react-jsx',
          },
          include: ['src/**/*'],
        })
      );
      await write(
        root,
        'src/Button.tsx',
        `export function Button(props: { label: string }): JSX.Element {\n  return <button type="button">{props.label}</button>;\n}\n`
      );
      await write(
        root,
        'src/App.tsx',
        `import { Button } from './Button';\nexport function App(): JSX.Element {\n  return <Button label="Go" />;\n}\n`
      );
      const indexer = await indexRoot(root);
      const pack = await assembleTaskContextPack({
        workspaceRoot: root,
        store: indexer.getRagStore(),
        task: 'Edit the Button frontend component',
        depth: 'shallow',
        selectedFiles: ['src/Button.tsx'],
        graphService: indexer.getCodeGraphService(),
      });
      assert.ok(/Button|App/i.test(pack.markdown));
      await indexer.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('orders inspection for a utility with many callers', async () => {
    const root = await makeRoot();
    try {
      await cp(fixtures.typescriptGraphRoot, root, { recursive: true });
      const indexer = await indexRoot(root);
      const pack = await assembleTaskContextPack({
        workspaceRoot: root,
        store: indexer.getRagStore(),
        task: 'Change the shared add utility',
        depth: 'deep',
        pathHint: 'src/core.ts',
        graphService: indexer.getCodeGraphService(),
      });
      const order = pack.sections.find((s) => s.title === 'Suggested inspection order');
      assert.ok(order && order.bullets.length > 0);
      assert.ok(/core\.ts|add|hello/i.test(pack.markdown));
      await indexer.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('surfaces uncertainty when repository evidence is insufficient', async () => {
    const root = await makeRoot();
    try {
      await write(root, 'README.md', '# Empty-ish\n');
      const indexer = await createRepositoryFileIndexer({
        workspaceRoot: root,
        storageDir: path.join(root, '.store'),
      });
      // do not index much
      await indexer.startInitialIndex();
      const pack = await assembleTaskContextPack({
        workspaceRoot: root,
        store: indexer.getRagStore(),
        task: 'Implement quantum teleporter billing bridge',
        depth: 'shallow',
      });
      const unc = pack.sections.find((s) => s.title === 'Uncertainty');
      assert.ok(unc && unc.bullets.length > 0);
      assert.ok(pack.meta.incomplete || pack.meta.confidence < 0.5);
      assert.ok(!pack.markdown.includes('src/invented-teleporter.ts'));
      await indexer.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('respects shallow vs deep budgets', async () => {
    const root = await makeRoot();
    try {
      await cp(fixtures.billingRefundEvalRoot, root, { recursive: true });
      const indexer = await indexRoot(root);
      const shallow = await assembleTaskContextPack({
        workspaceRoot: root,
        store: indexer.getRagStore(),
        task: 'Add partial refunds to subscriptions.',
        depth: 'shallow',
        graphService: indexer.getCodeGraphService(),
      });
      const deep = await assembleTaskContextPack({
        workspaceRoot: root,
        store: indexer.getRagStore(),
        task: 'Add partial refunds to subscriptions.',
        depth: 'deep',
        graphService: indexer.getCodeGraphService(),
      });
      assert.ok(budgetsForDepth('shallow').budgets.maxFiles < budgetsForDepth('deep').budgets.maxFiles);
      assert.ok(shallow.meta.sources.length <= deep.meta.sources.length + 2);
      assert.ok(shallow.markdown.length <= deep.markdown.length + 500);
      await indexer.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not invent source paths beyond retrieved evidence', async () => {
    const root = await makeRoot();
    try {
      await cp(fixtures.billingRefundEvalRoot, root, { recursive: true });
      const indexer = await indexRoot(root);
      const pack = await assembleTaskContextPack({
        workspaceRoot: root,
        store: indexer.getRagStore(),
        task: 'Add partial refunds to subscriptions.',
        depth: 'shallow',
        graphService: indexer.getCodeGraphService(),
      });
      for (const s of pack.meta.sources) {
        assert.ok(!/teleporter|invented-fake/i.test(s.path));
      }
      await indexer.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists pack under context-packs with required frontmatter', async () => {
    const root = await makeRoot();
    try {
      await cp(fixtures.billingRefundEvalRoot, root, { recursive: true });
      const indexer = await indexRoot(root);
      const pack = await assembleTaskContextPack({
        workspaceRoot: root,
        store: indexer.getRagStore(),
        task: 'Add partial refunds to subscriptions.',
        depth: 'shallow',
        graphService: indexer.getCodeGraphService(),
      });
      const written = await writeTaskContextPack(root, pack);
      assert.match(written.relativePath, /\.mergecore\/generated\/context-packs\//);
      const content = await readFile(written.absolutePath, 'utf8');
      const parsed = parseTaskContextFrontmatter(content);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.frontmatter?.generatedBy, 'mergecore');
      assert.ok(parsed.frontmatter?.task?.includes('partial refunds'));
      assert.ok(parsed.frontmatter?.indexRevision);
      assert.equal(parsed.frontmatter?.modelProvider, 'none');
      assert.equal(parsed.frontmatter?.dataLeftMachine, false);
      await indexer.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
