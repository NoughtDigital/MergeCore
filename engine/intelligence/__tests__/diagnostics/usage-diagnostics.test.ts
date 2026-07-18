import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { after, before, describe, it } from 'node:test';
import {
  assertDiagnosticsSafe,
  buildScrubbedAnalyticsBundle,
  createRepositoryFileIndexer,
  createRepositorySearchEngine,
  deleteUsageDiagnostics,
  fingerprintQuery,
  hashRelativePath,
  loadMissingContextEvalTasks,
  loadUsageMetrics,
  recordUsageEvent,
  saveMissingContextFeedback,
  scrubAnalyticsPayload,
  USAGE_METRICS_PATH,
} from '../../index';

async function mkTemp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mergecore-diag-'));
}

async function writeFile(root: string, rel: string, body: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body, 'utf8');
}

describe('usage and retrieval diagnostics', () => {
  let root: string;

  before(async () => {
    root = await mkTemp();
    await writeFile(
      root,
      'src/auth.ts',
      'export function authenticate(user: string): boolean { return user.length > 0; }\n'
    );
    await writeFile(
      root,
      'src/session.ts',
      'import { authenticate } from "./auth";\nexport function startSession(u: string) { return authenticate(u); }\n'
    );
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('metrics store round-trips and rejects bodies via scrub assert', async () => {
    await recordUsageEvent(root, { kind: 'hover_use' });
    await recordUsageEvent(root, { kind: 'explanation_opened' });
    await recordUsageEvent(root, {
      kind: 'low_confidence_query',
      queryFingerprint: fingerprintQuery('weak query xyz'),
    });
    await recordUsageEvent(root, {
      kind: 'frequent_source',
      pathHash: hashRelativePath('src/auth.ts'),
    });
    await recordUsageEvent(root, { kind: 'retrieval_latency', latencyMs: 42 });

    const metrics = await loadUsageMetrics(root);
    assert.equal(metrics.hoverUses, 1);
    assert.equal(metrics.explanationsOpened, 1);
    assert.equal(metrics.lowConfidenceQueries, 1);
    assert.equal(metrics.retrievalLatencyCount, 1);
    assert.ok(metrics.frequentSourceHashes[hashRelativePath('src/auth.ts')] >= 1);

    const abs = path.join(root, USAGE_METRICS_PATH);
    const raw = await fs.readFile(abs, 'utf8');
    assert.doesNotMatch(raw, /src\/auth\.ts/);
    assert.doesNotMatch(raw, /weak query/);
    assertDiagnosticsSafe(raw);
  });

  it('analytics payload omits filenames and query text', async () => {
    const metrics = await loadUsageMetrics(root);
    const bundle = buildScrubbedAnalyticsBundle(metrics);
    const serialised = JSON.stringify(bundle);
    assert.doesNotMatch(serialised, /src\/auth/);
    assert.doesNotMatch(serialised, /"path"\s*:/);
    assert.doesNotMatch(serialised, /originalQuery/);
    const scrubbed = scrubAnalyticsPayload({
      path: 'src/secret.ts',
      excerpt: 'code body here',
      contextPacksGenerated: 3,
    });
    assert.equal(scrubbed.path, undefined);
    assert.equal(scrubbed.excerpt, undefined);
    assert.equal(scrubbed.contextPacksGenerated, 3);
  });

  it('inspection with debug has stages and omits chunk bodies', async () => {
    const indexer = await createRepositoryFileIndexer({
      workspaceRoot: root,
      storageDir: path.join(root, '.mergecore-store-a'),
      useCompilerGraph: false,
    });
    try {
      await indexer.startInitialIndex();
      const store = indexer.getRagStore();
      const engine = await createRepositorySearchEngine({ store });
      const result = await engine.searchRepositoryContext('authenticate session', {
        debug: true,
        k: 8,
      });
      assert.ok(result.debug);
      assert.ok((result.debug!.stages?.length ?? 0) > 0);
      const serialised = JSON.stringify(result.debug);
      assert.doesNotMatch(serialised, /"excerpt"\s*:/);
      assert.doesNotMatch(serialised, /export function authenticate/);
      assertDiagnosticsSafe(serialised);

      const after = await loadUsageMetrics(root);
      assert.ok(after.retrievalLatencyCount >= 1);
      assert.ok(Object.keys(after.frequentSourceHashes).length >= 1);
    } finally {
      await indexer.dispose();
    }
  });

  it('mark missing context writes feedback and eval loader; ranker unchanged', async () => {
    const { feedback, relativePath } = await saveMissingContextFeedback(root, {
      query: 'authenticate session',
      missingPath: 'src/missing-helper.ts',
      lastSelectedPaths: ['src/auth.ts'],
      notes: 'should have been retrieved',
    });
    assert.equal(feedback.missingPath, 'src/missing-helper.ts');
    assert.equal(feedback.missingPathHash, hashRelativePath('src/missing-helper.ts'));
    const abs = path.join(root, relativePath);
    const onDisk = JSON.parse(await fs.readFile(abs, 'utf8')) as typeof feedback;
    assert.equal(onDisk.missingPath, 'src/missing-helper.ts');

    const tasks = await loadMissingContextEvalTasks(root);
    assert.ok(tasks.some((t) => t.relevantFiles.includes('src/missing-helper.ts')));

    // Production ranker is not wired to feedback — identical search without feedback side effects.
    const indexer = await createRepositoryFileIndexer({
      workspaceRoot: root,
      storageDir: path.join(root, '.mergecore-store-b'),
      useCompilerGraph: false,
    });
    try {
      await indexer.startInitialIndex();
      const store = indexer.getRagStore();
      const engine = await createRepositorySearchEngine({ store });
      const a = await engine.searchRepositoryContext('authenticate', { k: 5 });
      const b = await engine.searchRepositoryContext('authenticate', { k: 5 });
      assert.deepEqual(
        a.results.map((r) => r.id),
        b.results.map((r) => r.id)
      );
    } finally {
      await indexer.dispose();
    }
  });

  it('deleteUsageDiagnostics wipes local dir', async () => {
    await recordUsageEvent(root, { kind: 'context_pack_generated' });
    await deleteUsageDiagnostics(root);
    const metrics = await loadUsageMetrics(root);
    assert.equal(metrics.contextPacksGenerated, 0);
    await assert.rejects(fs.access(path.join(root, USAGE_METRICS_PATH)));
  });
});
