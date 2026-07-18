import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  assignEvidenceIds,
  assertClaimAttributed,
  AttributionError,
  computeClaimConfidence,
  createAttributedClaim,
  createSourceReference,
  formatClaimAttributionLabel,
  GENERAL_CONSIDERATION_LABEL,
  inspectSourceReference,
  normaliseSourcePath,
  parseModelClaimsJson,
  sourceRangeForReveal,
  validateModelClaimBundle,
} from '../../dist/index.js';
import { sha256 } from '../../dist/rag/hash.js';

describe('source attribution', () => {
  it('normalises Windows paths in SourceReference', () => {
    const ref = createSourceReference({
      workspaceId: 'ws',
      path: 'src\\billing\\refunds.ts',
      startLine: 10,
      endLine: 20,
      startColumn: 3,
      endColumn: 15,
      sourceType: 'symbol',
      sourceFingerprint: 'fp',
      symbolId: 'sym:1',
      extraction: 'deterministic',
    });
    assert.equal(ref.path, 'src/billing/refunds.ts');
    assert.equal(normaliseSourcePath('a\\b\\c.ts'), 'a/b/c.ts');
    const range = sourceRangeForReveal(ref);
    assert.equal(range.startLine, 10);
    assert.equal(range.startColumn, 3);
    assert.equal(range.endColumn, 15);
  });

  it('requires sources or general-consideration label', () => {
    assert.throws(
      () =>
        createAttributedClaim({
          id: 'bad',
          text: 'No evidence',
          references: [],
          generalConsideration: false,
        }),
      AttributionError
    );
    const general = createAttributedClaim({
      id: 'g1',
      text: 'Prefer idempotent handlers',
      generalConsideration: true,
    });
    assert.equal(general.generalConsideration, true);
    assert.equal(formatClaimAttributionLabel(general), GENERAL_CONSIDERATION_LABEL);
    assertClaimAttributed(general);
  });

  it('supports multiple independent sources on a claim', () => {
    const refs = [
      createSourceReference({
        workspaceId: 'ws',
        path: 'src/a.ts',
        startLine: 1,
        endLine: 2,
        sourceType: 'source',
        sourceFingerprint: 'a',
      }),
      createSourceReference({
        workspaceId: 'ws',
        path: 'src/b.ts',
        startLine: 4,
        endLine: 8,
        sourceType: 'source',
        sourceFingerprint: 'b',
      }),
    ];
    const claim = createAttributedClaim({
      id: 'c1',
      text: 'A depends on B',
      references: refs,
      components: {
        independentSourceCount: 2,
        parserCertainty: 'certain',
        sourceFreshness: 'fresh',
      },
    });
    assert.equal(claim.references.length, 2);
    assert.equal(claim.confidence, 'high');
    assert.ok(claim.confidenceDetail.rationale.length > 0);
    assert.ok(typeof claim.confidenceDetail.diagnosticScore === 'number');
  });

  it('marks heuristic extraction in confidence components', () => {
    const ref = createSourceReference({
      workspaceId: 'ws',
      path: 'src/x.ts',
      startLine: 1,
      endLine: 1,
      sourceType: 'lexical',
      sourceFingerprint: 'x',
      extraction: 'heuristic',
    });
    const claim = createAttributedClaim({
      id: 'h1',
      text: 'Likely related',
      references: [ref],
      components: {
        parserCertainty: 'medium',
        symbolResolutionCertainty: 'low',
        independentSourceCount: 1,
        sourceFreshness: 'unknown',
      },
    });
    assert.equal(ref.extraction, 'heuristic');
    assert.ok(['medium', 'low'].includes(claim.confidence));
  });

  it('assigns and validates model evidence IDs; rejects invents', () => {
    const refs = assignEvidenceIds([
      createSourceReference({
        workspaceId: 'ws',
        path: 'src/billing/refunds.ts',
        startLine: 12,
        endLine: 18,
        sourceType: 'symbol',
        sourceFingerprint: 'fp1',
        symbol: 'createPartialRefund',
      }),
      createSourceReference({
        workspaceId: 'ws',
        path: 'AGENTS.md',
        startLine: 1,
        endLine: 4,
        sourceType: 'instruction',
        sourceFingerprint: 'fp2',
      }),
    ]);
    assert.equal(refs[0]!.evidenceId, 'evidence-1');
    assert.equal(refs[1]!.evidenceId, 'evidence-2');

    const map = new Map(refs.map((r) => [r.evidenceId!, r]));
    const ok = validateModelClaimBundle(
      {
        claims: [
          {
            text: 'Refund requests are queued before provider processing.',
            evidenceIds: ['evidence-1', 'evidence-2'],
            certainty: 'high',
          },
        ],
      },
      map
    );
    assert.equal(ok.accepted.length, 1);
    assert.equal(ok.rejected.length, 0);
    assert.equal(ok.accepted[0]!.references.length, 2);

    const bad = validateModelClaimBundle(
      {
        claims: [
          {
            text: 'Invented path claim',
            evidenceIds: ['evidence-999'],
            certainty: 'high',
          },
          {
            text: 'No ids',
            evidenceIds: [],
          },
        ],
      },
      map
    );
    assert.equal(bad.accepted.length, 0);
    assert.equal(bad.rejected.length, 2);
    assert.ok(bad.rejected.some((r) => r.reason.startsWith('unknown_evidence_ids')));
    assert.ok(bad.rejected.some((r) => r.reason === 'missing_evidence_ids'));
  });

  it('parses fenced model claim JSON', () => {
    const raw = `Here you go:\n\`\`\`json\n${JSON.stringify({
      claims: [{ text: 'X', evidenceIds: ['evidence-1'], certainty: 'medium' }],
    })}\n\`\`\``;
    const parsed = parseModelClaimsJson(raw);
    assert.ok(parsed);
    assert.equal(parsed!.claims[0]!.evidenceIds[0], 'evidence-1');
  });

  it('inspects stale fingerprints and deleted files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mergecore-attr-'));
    const rel = 'src/keep.ts';
    const abs = join(root, rel);
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(abs, 'export const a = 1;\n');
    const fp = sha256('export const a = 1;\n');
    const roots = [{ workspaceId: 'ws-a', rootPath: root }];

    const fresh = createSourceReference({
      workspaceId: 'ws-a',
      path: rel,
      startLine: 1,
      endLine: 1,
      sourceType: 'source',
      sourceFingerprint: fp,
    });
    const ok = await inspectSourceReference(roots, fresh, {
      exists: async (p) => {
        try {
          await import('node:fs/promises').then((fs) => fs.access(p));
          return true;
        } catch {
          return false;
        }
      },
      fingerprint: async () => fp,
    });
    assert.equal(ok.status, 'ok');

    const stale = await inspectSourceReference(roots, fresh, {
      exists: async () => true,
      fingerprint: async () => 'other-hash',
    });
    assert.equal(stale.status, 'stale');

    const missing = await inspectSourceReference(
      roots,
      createSourceReference({
        workspaceId: 'ws-a',
        path: 'src/gone.ts',
        startLine: 1,
        endLine: 1,
        sourceType: 'source',
        sourceFingerprint: 'x',
      }),
      {
        exists: async () => false,
      }
    );
    assert.equal(missing.status, 'missing');

    await rm(root, { recursive: true, force: true });
  });

  it('resolves multi-root workspaces by workspaceId', async () => {
    const a = await mkdtemp(join(tmpdir(), 'mergecore-mr-a-'));
    const b = await mkdtemp(join(tmpdir(), 'mergecore-mr-b-'));
    await mkdir(join(a, 'src'), { recursive: true });
    await mkdir(join(b, 'src'), { recursive: true });
    await writeFile(join(a, 'src', 'a.ts'), 'export const a = 1;\n');
    await writeFile(join(b, 'src', 'b.ts'), 'export const b = 1;\n');

    const ref = createSourceReference({
      workspaceId: 'ws-b',
      path: 'src/b.ts',
      startLine: 1,
      endLine: 1,
      sourceType: 'source',
      sourceFingerprint: '',
    });
    const result = await inspectSourceReference(
      [
        { workspaceId: 'ws-a', rootPath: a },
        { workspaceId: 'ws-b', rootPath: b },
      ],
      ref,
      {
        exists: async (p) => {
          try {
            await import('node:fs/promises').then((fs) => fs.access(p));
            return true;
          } catch {
            return false;
          }
        },
      }
    );
    assert.equal(result.status, 'ok');
    assert.ok(result.absolutePath?.includes(b));

    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  });

  it('does not treat diagnosticScore as a probability label', () => {
    const detail = computeClaimConfidence({
      parserCertainty: 'high',
      independentSourceCount: 2,
      sourceFreshness: 'fresh',
      modelGenerated: false,
    });
    assert.ok(detail.level === 'high' || detail.level === 'medium');
    // diagnosticScore exists for tooling but must not be presented as P(truth)
    assert.ok(detail.diagnosticScore !== undefined);
    assert.ok(detail.diagnosticScore! >= 0 && detail.diagnosticScore! <= 1);
    assert.ok(detail.rationale.every((r) => !/probabilit/i.test(r)));
  });
});
