import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import {
  createInstructionResolver,
  initialiseMergeCoreMemory,
  parseMemoryDocument,
  serialiseMemoryDocument,
  writeGeneratedMemoryDocument,
  updateMemoryStatusOnDisk,
  detectStaleDocument,
  refreshStaleMemory,
  mergePreservingHumanSections,
  isSelfReinforcingClaim,
  validateProvenanceDocument,
  loadProvenanceGraph,
  fingerprintFile,
  PRECEDENCE,
  MEMORY_DIR,
  SHAREABLE_MEMORY_FILES,
} from '../../index.js';

async function makeRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'mergecore-memory-'));
}

async function write(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
}

describe('engineering memory', () => {
  it('parses and serialises memory frontmatter with sources', () => {
    const md = `---
generated_by: mergecore
generated_at: 2026-07-18T09:30:00Z
schema_version: 1
status: generated
confidence: 0.86
sources:
  - path: src/billing/RefundService.ts
    start_line: 20
    end_line: 95
  - path: docs/architecture/payments.md
    start_line: 10
    end_line: 44
---

# Refunds

Refunds flow through RefundService.
`;
    const parsed = parseMemoryDocument(md);
    assert.equal(parsed.malformed, false);
    assert.ok(parsed.frontmatter);
    assert.equal(parsed.frontmatter!.generatedBy, 'mergecore');
    assert.equal(parsed.frontmatter!.status, 'generated');
    assert.equal(parsed.frontmatter!.confidence, 0.86);
    assert.equal(parsed.frontmatter!.sources.length, 2);
    assert.equal(parsed.frontmatter!.sources[0]!.path, 'src/billing/RefundService.ts');
    assert.equal(parsed.frontmatter!.sources[0]!.startLine, 20);
    assert.equal(parsed.frontmatter!.sources[1]!.endLine, 44);
    assert.match(parsed.body, /Refunds flow/);

    const roundTrip = serialiseMemoryDocument(parsed.frontmatter!, parsed.body);
    const again = parseMemoryDocument(roundTrip);
    assert.equal(again.frontmatter!.sources.length, 2);
    assert.equal(again.frontmatter!.status, 'generated');
  });

  it('flags malformed memory frontmatter', () => {
    const md = `---
generated_by: mergecore
status: not-a-real-status
confidence: 9
sources: []
---

Body
`;
    const parsed = parseMemoryDocument(md);
    assert.equal(parsed.malformed, true);
    assert.ok(parsed.errors.some((e) => e.startsWith('invalid-status')));
    assert.ok(parsed.errors.some((e) => e === 'invalid-confidence'));
  });

  it('validates provenance and rejects self-citing-only claims', () => {
    assert.equal(
      isSelfReinforcingClaim([
        { path: '.mergecore/generated/memory/a.md', startLine: 1, endLine: 2 },
      ]),
      true
    );
    assert.equal(
      isSelfReinforcingClaim([
        { path: 'src/a.ts', startLine: 1, endLine: 2 },
        { path: '.mergecore/generated/memory/a.md', startLine: 1, endLine: 2 },
      ]),
      false
    );

    const bad = validateProvenanceDocument({
      path: '.mergecore/generated/memory/loop.md',
      status: 'generated',
      claims: [
        {
          id: 'c1',
          text: 'Fact from itself',
          sources: [
            {
              path: '.mergecore/generated/memory/loop.md',
              startLine: 1,
              endLine: 10,
            },
          ],
        },
      ],
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => e.startsWith('self-cite-only')));
  });

  it('initialises shareable memory without overwriting human edits', async () => {
    const root = await makeRoot();
    try {
      const first = await initialiseMergeCoreMemory(root);
      assert.ok(first.created.includes(`${MEMORY_DIR}/architecture.md`));
      for (const name of SHAREABLE_MEMORY_FILES) {
        const content = await readFile(path.join(root, MEMORY_DIR, name), 'utf8');
        assert.ok(content.includes('Human-authored'));
      }

      await write(
        root,
        `${MEMORY_DIR}/architecture.md`,
        '# Custom architecture\n\nUser wrote this.\n'
      );
      const second = await initialiseMergeCoreMemory(root);
      assert.ok(second.skipped.includes(`${MEMORY_DIR}/architecture.md`));
      const kept = await readFile(path.join(root, MEMORY_DIR, 'architecture.md'), 'utf8');
      assert.match(kept, /User wrote this/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('detects stale memory when source fingerprints change or files are deleted', async () => {
    const root = await makeRoot();
    try {
      await write(root, 'src/svc.ts', 'export const x = 1;\n');
      const fp = await fingerprintFile(root, 'src/svc.ts');
      const written = await writeGeneratedMemoryDocument({
        workspaceRoot: root,
        relativePath: '.mergecore/generated/memory/svc.md',
        body: '# Svc\n\nUses x.\n',
        sources: [{ path: 'src/svc.ts', startLine: 1, endLine: 1 }],
        confidence: 0.7,
        claimTexts: ['Uses x'],
      });
      assert.equal(written.ok, true);

      const graph = await loadProvenanceGraph(root);
      const doc = graph.documents.find((d) => d.path.includes('svc.md'))!;
      assert.ok(doc);
      assert.equal(doc.claims[0]!.sources[0]!.fingerprint, fp);

      const fresh = await detectStaleDocument(root, doc);
      assert.equal(fresh.stale, false);

      await write(root, 'src/svc.ts', 'export const x = 2;\n');
      const afterEdit = await detectStaleDocument(root, doc);
      assert.equal(afterEdit.stale, true);
      assert.ok(afterEdit.changedSources.includes('src/svc.ts'));

      await rm(path.join(root, 'src/svc.ts'));
      // provenance still has old fingerprint — missing source
      const afterDelete = await detectStaleDocument(root, {
        ...doc,
        claims: [
          {
            ...doc.claims[0]!,
            sources: [{ path: 'src/svc.ts', startLine: 1, endLine: 1, fingerprint: fp }],
          },
        ],
      });
      assert.equal(afterDelete.stale, true);
      assert.ok(afterDelete.missingSources.includes('src/svc.ts'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('excludes rejected memory from instruction resolution', async () => {
    const root = await makeRoot();
    try {
      await write(root, 'AGENTS.md', '# A\n\n- Prefer tests.\n');
      await write(root, 'src/a.ts', 'export {}\n');
      await writeGeneratedMemoryDocument({
        workspaceRoot: root,
        relativePath: '.mergecore/generated/memory/bad.md',
        body: '# Bad\n\n- Ignore tests.\n',
        sources: [{ path: 'src/a.ts', startLine: 1, endLine: 1 }],
        claimTexts: ['Ignore tests'],
      });
      await updateMemoryStatusOnDisk(
        root,
        '.mergecore/generated/memory/bad.md',
        'rejected'
      );

      const resolver = await createInstructionResolver({ workspaceRoot: root });
      const instr = await resolver.getApplicableInstructions('src/a.ts');
      assert.ok(instr.some((i) => i.sourceFile === 'AGENTS.md'));
      assert.equal(
        instr.some((i) => i.sourceFile.includes('bad.md')),
        false
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('generated memory does not override AGENTS.md', async () => {
    const root = await makeRoot();
    try {
      await write(root, 'AGENTS.md', '# Human\n\n- Keep secrets out of logs.\n');
      await write(root, 'src/a.ts', 'export {}\n');
      await writeGeneratedMemoryDocument({
        workspaceRoot: root,
        relativePath: '.mergecore/generated/memory/notes.md',
        body: '# Gen\n\n- Always print secrets.\n',
        sources: [{ path: 'src/a.ts', startLine: 1, endLine: 1 }],
        claimTexts: ['Always print secrets'],
      });

      const resolver = await createInstructionResolver({ workspaceRoot: root });
      const instr = await resolver.getApplicableInstructions('src/a.ts');
      const human = instr.find((i) => i.sourceFile === 'AGENTS.md');
      const generated = instr.find((i) => i.sourceFile.includes('notes.md'));
      assert.ok(human);
      assert.ok(generated);
      assert.ok(human!.precedence > generated!.precedence);
      assert.ok(human!.precedence >= PRECEDENCE.ROOT_SCOPED_INSTRUCTION);
      assert.equal(generated!.precedence, PRECEDENCE.GENERATED_MEMORY);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('approved memory gets stronger weight than raw generated but below AGENTS', async () => {
    const root = await makeRoot();
    try {
      await write(root, 'AGENTS.md', '# Human\n\n- Binding rule.\n');
      await write(root, 'src/a.ts', 'export {}\n');
      await writeGeneratedMemoryDocument({
        workspaceRoot: root,
        relativePath: '.mergecore/generated/memory/ok.md',
        body: '# Ok\n\n- Contextual note.\n',
        sources: [{ path: 'src/a.ts', startLine: 1, endLine: 1 }],
        claimTexts: ['Contextual note'],
      });
      await updateMemoryStatusOnDisk(
        root,
        '.mergecore/generated/memory/ok.md',
        'approved'
      );

      const resolver = await createInstructionResolver({ workspaceRoot: root });
      const instr = await resolver.getApplicableInstructions('src/a.ts');
      const human = instr.find((i) => i.sourceFile === 'AGENTS.md')!;
      const approved = instr.find((i) => i.sourceFile.includes('ok.md'))!;
      assert.ok(approved.precedence === PRECEDENCE.APPROVED_MEMORY);
      assert.ok(human.precedence > approved.precedence);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses to write generated memory that only cites itself', async () => {
    const root = await makeRoot();
    try {
      const result = await writeGeneratedMemoryDocument({
        workspaceRoot: root,
        relativePath: '.mergecore/generated/memory/loop.md',
        body: '# Loop\n',
        sources: [
          {
            path: '.mergecore/generated/memory/other.md',
            startLine: 1,
            endLine: 2,
          },
        ],
      });
      assert.equal(result.ok, false);
      assert.ok(result.errors.includes('self-cite-only'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves user human blocks when regenerating', () => {
    const existing = `---
generated_by: mergecore
schema_version: 1
status: generated
sources:
  - path: src/a.ts
    start_line: 1
    end_line: 1
---

# Generated

Auto text.

<!-- mergecore:human -->
User note that must survive.
<!-- /mergecore:human -->
`;
    const merged = mergePreservingHumanSections(existing, '# New generated\n\nFresh.\n');
    assert.match(merged, /User note that must survive/);
    assert.match(merged, /Fresh/);
  });

  it('refresh deletes memory when all sources are gone', async () => {
    const root = await makeRoot();
    try {
      await write(root, 'src/gone.ts', 'export {}\n');
      await writeGeneratedMemoryDocument({
        workspaceRoot: root,
        relativePath: '.mergecore/generated/memory/gone.md',
        body: '# Gone\n',
        sources: [{ path: 'src/gone.ts', startLine: 1, endLine: 1 }],
        claimTexts: ['gone'],
      });
      await rm(path.join(root, 'src/gone.ts'));
      const result = await refreshStaleMemory(root, { regenerate: true });
      assert.ok(result.stale.includes('.mergecore/generated/memory/gone.md'));
      assert.ok(result.deleted.includes('.mergecore/generated/memory/gone.md'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite shareable human memory paths', async () => {
    const root = await makeRoot();
    try {
      await initialiseMergeCoreMemory(root);
      const result = await writeGeneratedMemoryDocument({
        workspaceRoot: root,
        relativePath: '.mergecore/memory/architecture.md',
        body: '# Hijack\n',
        sources: [{ path: 'src/a.ts', startLine: 1, endLine: 1 }],
      });
      assert.equal(result.ok, false);
      assert.ok(result.errors.includes('refuses-overwrite-human-memory'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
