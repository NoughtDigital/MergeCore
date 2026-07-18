import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import {
  createRepositoryFileIndexer,
  createRepositorySearchEngine,
  evaluateRetrievalTasks,
  type EvalTask,
} from '../../dist/index.js';

const require = createRequire(import.meta.url);
const { billingRefundEvalRoot } = require('../../../../packages/test-fixtures/index.js') as {
  billingRefundEvalRoot: string;
};

async function copyFixture(src: string, dest: string): Promise<void> {
  await fs.cp(src, dest, { recursive: true });
}

describe('hybrid repository retrieval', () => {
  let workspaceRoot: string;
  let storageDir: string;

  before(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mergecore-retrieve-'));
    storageDir = path.join(workspaceRoot, '.mergecore-store');
    await copyFixture(billingRefundEvalRoot, workspaceRoot);
  });

  after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('ranks billing/refund/gateway/webhook/tests ahead of unrelated files', async () => {
    const indexer = await createRepositoryFileIndexer({
      workspaceRoot,
      storageDir,
    });
    try {
      await indexer.startInitialIndex();
      const engine = await createRepositorySearchEngine({
        store: indexer.getRagStore(),
      });

      const query = 'add partial subscription refunds';
      const result = await engine.searchRepositoryContext(query, {
        k: 20,
        debug: true,
        budgets: {
          maxFiles: 12,
          maxSymbols: 20,
          maxChunks: 16,
          maxDependencyDepth: 2,
          maxChars: 40_000,
        },
      });

      assert.ok(result.results.length > 0);
      for (const hit of result.results) {
        assert.ok(hit.reason.length > 0, `missing reason for ${hit.id}`);
        assert.ok(hit.score !== undefined);
        assert.ok(hit.breakdown);
        assert.ok(hit.reference.path);
        assert.ok(hit.confidence);
        assert.ok(hit.analysis === 'deterministic' || hit.analysis === 'heuristic');
      }

      const files = await engine.findRelevantFiles(query, { k: 16 });
      const paths = files.map((f) => f.path);
      const relevant = [
        'src/billing/refunds.ts',
        'src/billing/gateway.ts',
        'src/billing/subscriptions.ts',
        'src/billing/webhooks.ts',
        'tests/refunds.spec.ts',
      ];
      for (const r of relevant) {
        assert.ok(
          paths.some((p) => p === r || p.endsWith(r)),
          `expected ${r} in top files, got ${paths.slice(0, 10).join(', ')}`
        );
      }

      const top5 = paths.slice(0, 5);
      assert.ok(
        !top5.includes('src/utils/formatting.ts'),
        'unrelated formatting util should not dominate top-5'
      );
      assert.ok(
        !top5.some((p) => p.includes('generated')),
        'generated dump should not dominate top-5'
      );

      // README must not dominate
      const readmeRank = paths.indexOf('README.md');
      const refundRank = paths.findIndex((p) => p.includes('billing/refunds'));
      if (readmeRank >= 0 && refundRank >= 0) {
        assert.ok(refundRank < readmeRank, 'refunds should rank above unrelated README');
      }

      assert.ok(result.debug);
      assert.ok(result.debug!.candidateCount >= result.results.length);
      assert.ok(typeof result.debug!.elapsedMs === 'number');
      // Debug must not include full file bodies
      const debugBlob = JSON.stringify(result.debug);
      assert.ok(!debugBlob.includes('GENERATED = ['));
    } finally {
      await indexer.dispose();
    }
  });

  it('returns exact symbol matches with high confidence', async () => {
    const indexer = await createRepositoryFileIndexer({
      workspaceRoot,
      storageDir: path.join(workspaceRoot, '.store-sym'),
    });
    try {
      await indexer.startInitialIndex();
      const engine = await createRepositorySearchEngine({
        store: indexer.getRagStore(),
      });
      const symbols = await engine.findRelevantSymbols('createPartialRefund');
      assert.ok(symbols.length >= 1);
      const hit = symbols.find((s) => s.symbolName === 'createPartialRefund');
      assert.ok(hit);
      assert.ok((hit!.breakdown.exactSymbol ?? 0) >= 80);
      assert.equal(hit!.confidence, 'high');
      assert.ok(hit!.reason.toLowerCase().includes('symbol'));
    } finally {
      await indexer.dispose();
    }
  });

  it('includes scoped instructions and ADR relevance', async () => {
    const indexer = await createRepositoryFileIndexer({
      workspaceRoot,
      storageDir: path.join(workspaceRoot, '.store-instr'),
    });
    try {
      await indexer.startInitialIndex();
      const engine = await createRepositorySearchEngine({
        store: indexer.getRagStore(),
      });
      const result = await engine.searchRepositoryContext(
        'partial subscription refunds',
        { k: 30, pathHint: 'src/billing/refunds.ts' }
      );
      const instrOrArch = result.results.filter(
        (r) =>
          r.resultType === 'instruction' ||
          r.resultType === 'architecture' ||
          r.path.includes('AGENTS.md') ||
          r.path.includes('adr')
      );
      assert.ok(
        instrOrArch.length >= 1,
        `expected instruction/ADR hits, got types=${result.results.map((r) => r.resultType).join(',')}`
      );
    } finally {
      await indexer.dispose();
    }
  });

  it('boosts explicitly selected files and enforces token budget', async () => {
    const indexer = await createRepositoryFileIndexer({
      workspaceRoot,
      storageDir: path.join(workspaceRoot, '.store-budget'),
    });
    try {
      await indexer.startInitialIndex();
      const engine = await createRepositorySearchEngine({
        store: indexer.getRagStore(),
      });
      const selected = await engine.searchRepositoryContext('refunds', {
        selectedFiles: ['src/utils/formatting.ts'],
        k: 20,
      });
      const fmt = selected.results.find((r) => r.path.includes('formatting'));
      assert.ok(fmt);
      assert.ok((fmt!.breakdown.userSelected ?? 0) >= 100);

      const tight = await engine.searchRepositoryContext(
        'add partial subscription refunds',
        {
          budgets: { maxChars: 800, maxTokensApprox: 200, maxFiles: 3, maxChunks: 2 },
          k: 50,
          debug: true,
        }
      );
      const totalChars = tight.results.reduce((s, r) => s + r.charEstimate, 0);
      assert.ok(totalChars <= 800 + 50, `char budget exceeded: ${totalChars}`);
      assert.ok(
        tight.debug?.rejected.some((r) => r.action === 'budget'),
        'expected budget rejections in debug'
      );
    } finally {
      await indexer.dispose();
    }
  });

  it('orders equal scores deterministically', async () => {
    const indexer = await createRepositoryFileIndexer({
      workspaceRoot,
      storageDir: path.join(workspaceRoot, '.store-order'),
    });
    try {
      await indexer.startInitialIndex();
      const engine = await createRepositorySearchEngine({
        store: indexer.getRagStore(),
      });
      const a = await engine.searchRepositoryContext('refund gateway webhook', { k: 12 });
      const b = await engine.searchRepositoryContext('refund gateway webhook', { k: 12 });
      assert.deepEqual(
        a.results.map((r) => r.id),
        b.results.map((r) => r.id)
      );
    } finally {
      await indexer.dispose();
    }
  });

  it('reports real P@K / R@K / MRR on the eval fixture', async () => {
    const indexer = await createRepositoryFileIndexer({
      workspaceRoot,
      storageDir: path.join(workspaceRoot, '.store-eval'),
    });
    try {
      await indexer.startInitialIndex();
      const engine = await createRepositorySearchEngine({
        store: indexer.getRagStore(),
      });
      const raw = JSON.parse(
        await fs.readFile(path.join(workspaceRoot, 'eval-tasks.json'), 'utf8')
      ) as { tasks: EvalTask[] };
      const k = 5;
      const retrievedByTask = new Map<string, string[]>();
      for (const task of raw.tasks) {
        const files = await engine.findRelevantFiles(task.query, { k: 16 });
        retrievedByTask.set(
          task.id,
          files.map((f) => f.path)
        );
      }
      const summary = evaluateRetrievalTasks(raw.tasks, retrievedByTask, k);
      // Report real measured metrics (do not fabricate).
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          evaluation: 'billing-refund-eval',
          k: summary.k,
          meanPrecisionAtK: Number(summary.meanPrecisionAtK.toFixed(4)),
          meanRecallAtK: Number(summary.meanRecallAtK.toFixed(4)),
          meanMrr: Number(summary.meanMrr.toFixed(4)),
          tasks: summary.tasks.map((t) => ({
            id: t.taskId,
            precisionAtK: Number(t.precisionAtK.toFixed(4)),
            recallAtK: Number(t.recallAtK.toFixed(4)),
            mrr: Number(t.mrr.toFixed(4)),
            retrievedTop: t.retrievedFiles.slice(0, k),
          })),
        })
      );
      assert.ok(summary.meanRecallAtK > 0, 'recall must be > 0 on fixture');
      assert.ok(summary.meanMrr > 0, 'MRR must be > 0 on fixture');
      assert.ok(
        summary.meanPrecisionAtK >= 0.4,
        `expected reasonable P@${k}, got ${summary.meanPrecisionAtK}`
      );
    } finally {
      await indexer.dispose();
    }
  });

  it('getContextForFile and getContextForSymbol return local evidence', async () => {
    const indexer = await createRepositoryFileIndexer({
      workspaceRoot,
      storageDir: path.join(workspaceRoot, '.store-ctx'),
    });
    try {
      await indexer.startInitialIndex();
      const engine = await createRepositorySearchEngine({
        store: indexer.getRagStore(),
      });
      const fileCtx = await engine.getContextForFile('src/billing/refunds.ts');
      assert.ok(fileCtx.results.some((r) => r.path.includes('billing')));

      const symbols = await engine.findRelevantSymbols('createPartialRefund');
      const id = symbols[0]?.symbolId;
      assert.ok(id);
      const symCtx = await engine.getContextForSymbol(id!);
      assert.ok(symCtx.results.length >= 1);
      assert.ok(symCtx.results[0]?.reason);
    } finally {
      await indexer.dispose();
    }
  });
});
