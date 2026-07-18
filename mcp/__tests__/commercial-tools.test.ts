import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  toolExplainSymbol,
  toolGenerateTaskContext,
  toolGetArchitectureSummary,
  toolGetRelatedFiles,
  toolGetRelevantInstructions,
  toolIndexRepository,
  toolIndexStatus,
  toolSearchRepositoryContext,
} from '../src/tools.js';
import { assertWorkspacePermitted } from '../src/security.js';
import { isStructuredError } from '../src/errors.js';

const FIXTURE = resolve(
  fileURLToPath(new URL('../../packages/test-fixtures/billing-refund-eval', import.meta.url))
);

function parseResult(result: {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}): { payload: unknown; isError: boolean } {
  const text = result.content[0]?.text ?? '{}';
  return { payload: JSON.parse(text), isError: Boolean(result.isError) };
}

function errorCode(payload: unknown): string | undefined {
  if (isStructuredError(payload)) return payload.error.code;
  return undefined;
}

describe('MCP security gate', () => {
  const prevWorkspace = process.env.MERGECORE_WORKSPACE;
  const prevAllowed = process.env.MERGECORE_ALLOWED_ROOTS;

  after(() => {
    if (prevWorkspace === undefined) delete process.env.MERGECORE_WORKSPACE;
    else process.env.MERGECORE_WORKSPACE = prevWorkspace;
    if (prevAllowed === undefined) delete process.env.MERGECORE_ALLOWED_ROOTS;
    else process.env.MERGECORE_ALLOWED_ROOTS = prevAllowed;
  });

  it('rejects when neither MERGECORE_WORKSPACE nor MERGECORE_ALLOWED_ROOTS is set', () => {
    delete process.env.MERGECORE_WORKSPACE;
    delete process.env.MERGECORE_ALLOWED_ROOTS;
    const gate = assertWorkspacePermitted();
    assert.equal(gate.ok, false);
    if (!gate.ok) {
      const { payload } = parseResult(gate.response);
      assert.equal(errorCode(payload), 'workspace_not_permitted');
    }
  });

  it('rejects path traversal via toolSearchRepositoryContext pathHint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mergecore-mcp-trav-'));
    process.env.MERGECORE_WORKSPACE = root;
    delete process.env.MERGECORE_ALLOWED_ROOTS;
    try {
      // empty index → may be index_unavailable before path check; index first with a tiny file
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
      await toolIndexRepository();
      const result = await toolSearchRepositoryContext({
        query: 'a',
        pathHint: '../outside.ts',
      });
      const { payload, isError } = parseResult(result);
      assert.equal(isError, true);
      assert.equal(errorCode(payload), 'workspace_not_permitted');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('MCP commercial tools (protocol)', () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'mergecore-mcp-proto-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, 'src', 'alpha.ts'),
      [
        'export function alphaHelper(): number { return 1; }',
        'export function betaHelper(): number { return alphaHelper(); }',
        '',
      ].join('\n')
    );
    await writeFile(join(root, 'AGENTS.md'), '# Agents\n\nPrefer alphaHelper for numbers.\n');
    process.env.MERGECORE_WORKSPACE = root;
    delete process.env.MERGECORE_ALLOWED_ROOTS;
    await toolIndexRepository();
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('index_status includes schema version and storeDir under .mergecore/rag', async () => {
    const { payload, isError } = parseResult(await toolIndexStatus());
    assert.equal(isError, false);
    const status = payload as Record<string, unknown>;
    assert.ok(typeof status.schemaVersion === 'number' || typeof status.STORE_SCHEMA_VERSION === 'number');
    assert.ok(String(status.storeDir).endsWith('.mergecore/rag') || String(status.storeDir).includes('.mergecore/rag'));
    assert.ok((status.chunkCount as number) > 0);
    assert.equal(status.workspaceRoot, root);
  });

  it('search_repository_context returns ranked hits with reason/confidence', async () => {
    const { payload, isError } = parseResult(
      await toolSearchRepositoryContext({ query: 'alphaHelper', k: 8 })
    );
    assert.equal(isError, false);
    const body = payload as { hits: Array<{ reason?: string; confidence?: string; score?: number }> };
    assert.ok(body.hits.length > 0);
    assert.ok(body.hits.some((h) => h.reason && h.confidence && typeof h.score === 'number'));
  });

  it('explain_symbol returns ambiguous_symbol when multiple matches', async () => {
    await writeFile(
      join(root, 'src', 'dup.ts'),
      'export function alphaHelper(): string { return "x"; }\n'
    );
    await toolIndexRepository();
    const { payload, isError } = parseResult(
      await toolExplainSymbol({ symbol: 'alphaHelper' })
    );
    assert.equal(isError, true);
    assert.equal(errorCode(payload), 'ambiguous_symbol');
  });

  it('explain_symbol succeeds with filePath disambiguation', async () => {
    const { payload, isError } = parseResult(
      await toolExplainSymbol({ symbol: 'alphaHelper', filePath: 'src/alpha.ts' })
    );
    assert.equal(isError, false);
    const body = payload as { symbol: { name: string; path: string }; sources: unknown[] };
    assert.equal(body.symbol.name, 'alphaHelper');
    assert.ok(body.symbol.path.includes('alpha.ts'));
    assert.ok(body.sources.length > 0);
  });

  it('get_relevant_instructions returns AGENTS guidance', async () => {
    const { payload, isError } = parseResult(
      await toolGetRelevantInstructions({ targetFile: 'src/alpha.ts' })
    );
    assert.equal(isError, false);
    const body = payload as { instructions: Array<{ text: string; sourceFile: string }> };
    assert.ok(body.instructions.some((i) => /alphaHelper|Agents/i.test(i.text) || /AGENTS/i.test(i.sourceFile)));
  });

  it('get_related_files returns paths for a seed file', async () => {
    const { payload, isError } = parseResult(
      await toolGetRelatedFiles({ filePath: 'src/alpha.ts', query: 'alphaHelper', k: 8 })
    );
    assert.equal(isError, false);
    const body = payload as { files: Array<{ path: string }> };
    assert.ok(Array.isArray(body.files));
  });

  it('generate_task_context refuses empty index with index_unavailable', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'mergecore-mcp-empty-'));
    process.env.MERGECORE_WORKSPACE = empty;
    try {
      const { payload, isError } = parseResult(
        await toolGenerateTaskContext({ task: 'anything', persist: false })
      );
      assert.equal(isError, true);
      assert.equal(errorCode(payload), 'index_unavailable');
    } finally {
      process.env.MERGECORE_WORKSPACE = root;
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('get_architecture_summary returns uncertainty and sources', async () => {
    const { payload, isError } = parseResult(await toolGetArchitectureSummary({}));
    assert.equal(isError, false);
    const body = payload as { uncertainty: string[]; sources: unknown[]; modelProvider: string };
    assert.equal(body.modelProvider, 'none');
    assert.ok(Array.isArray(body.uncertainty));
    assert.ok(Array.isArray(body.sources));
  });
});

describe('MCP billing-refund e2e', () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'mergecore-mcp-refund-'));
    await cp(FIXTURE, root, { recursive: true });
    process.env.MERGECORE_WORKSPACE = root;
    delete process.env.MERGECORE_ALLOWED_ROOTS;
    await toolIndexRepository();
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('answers refund behaviour query with symbols, instructions, tests, and path#line refs', async () => {
    const query =
      'Where is subscription refund behaviour implemented and what instructions apply?';
    const search = parseResult(
      await toolSearchRepositoryContext({ query, k: 16, maxFiles: 12, maxSymbols: 16 })
    );
    assert.equal(search.isError, false);
    const hits = (search.payload as { hits: Array<{ path: string; symbol?: string; reference: { path: string; startLine: number } }> }).hits;
    const blob = JSON.stringify(hits).toLowerCase();
    assert.ok(/refund|subscription|createpartialrefund/i.test(blob), 'expected refund symbols/files');
    assert.ok(
      hits.some((h) => h.reference?.path && h.reference.startLine >= 1),
      'expected path#line refs'
    );

    const instr = parseResult(
      await toolGetRelevantInstructions({ targetFile: 'src/billing/refunds.ts' })
    );
    assert.equal(instr.isError, false);
    const instructions = (instr.payload as { instructions: Array<{ sourceFile: string; text: string }> }).instructions;
    const instrBlob = JSON.stringify(instructions).toLowerCase();
    assert.ok(
      /agents\.md|adr|partial refund/i.test(instrBlob),
      'expected AGENTS/ADR instructions'
    );

    const related = parseResult(
      await toolGetRelatedFiles({
        query: 'subscription refund',
        filePath: 'src/billing/refunds.ts',
        symbol: 'createPartialRefund',
        k: 16,
      })
    );
    assert.equal(related.isError, false);
    const files = (related.payload as { files: Array<{ path: string }> }).files;
    const paths = files.map((f) => f.path).join('\n');
    assert.ok(/test|refund|gateway|webhook|subscription/i.test(paths), 'expected related billing/test files');

    const status = parseResult(await toolIndexStatus());
    const storeDir = String((status.payload as { storeDir: string }).storeDir);
    assert.ok(storeDir.replace(/\\/g, '/').endsWith('.mergecore/rag'));
  });
});
