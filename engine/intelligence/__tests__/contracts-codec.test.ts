import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseContextClaim,
  parseContextPack,
  parseIndexStatus,
  parseSourceReference,
  parseSymbolRecord,
  serializeContextPack,
  serializeIndexStatus,
  serializeSourceReference,
  serializeSymbolRecord,
  type ContextPack,
  type IndexStatus,
  type SourceReference,
  type SymbolRecord,
} from '../dist/index.js';

describe('shared contract codec', () => {
  it('round-trips SourceReference', () => {
    const value: SourceReference = {
      workspaceId: 'ws-abc',
      path: 'src/util.ts',
      startLine: 1,
      endLine: 4,
      startColumn: 1,
      endColumn: 12,
      sourceType: 'symbol',
      sourceFingerprint: 'deadbeef',
      symbolId: 'typescript:src/util.ts:add:1',
      symbol: 'add',
      authored: 'human',
      extraction: 'deterministic',
      excerpt: 'export function add',
      evidenceId: 'evidence-1',
    };
    const parsed = parseSourceReference(serializeSourceReference(value));
    assert.deepEqual(parsed, value);
  });

  it('fills legacy SourceReference defaults on parse', () => {
    const legacy = JSON.stringify({
      path: 'src\\win\\util.ts',
      startLine: 2,
      endLine: 5,
      sourceType: 'source',
    });
    const parsed = parseSourceReference(legacy);
    assert.equal(parsed.path, 'src/win/util.ts');
    assert.equal(parsed.workspaceId, 'unknown');
    assert.equal(parsed.authored, 'human');
    assert.equal(parsed.extraction, 'deterministic');
    assert.equal(parsed.sourceFingerprint, '');
  });

  it('round-trips SymbolRecord', () => {
    const value: SymbolRecord = {
      id: 'typescript:src/util.ts:add:1',
      name: 'add',
      kind: 'function',
      location: { path: 'src/util.ts', startLine: 1, endLine: 3 },
      exported: true,
      language: 'typescript',
      adapterId: 'typescript',
    };
    const parsed = parseSymbolRecord(serializeSymbolRecord(value));
    assert.deepEqual(parsed, value);
  });

  it('fills legacy SymbolRecord adapterId from language', () => {
    const legacy = JSON.stringify({
      id: 'php:app/Order.php:Order:1',
      name: 'Order',
      kind: 'class',
      location: { path: 'app/Order.php', startLine: 1, endLine: 10 },
      language: 'php',
    });
    const parsed = parseSymbolRecord(legacy);
    assert.equal(parsed.adapterId, 'php');
  });

  it('round-trips IndexStatus', () => {
    const value: IndexStatus = {
      workspaceRoot: '/tmp/repo',
      workspaceId: 'abc123',
      ready: true,
      busy: false,
      phase: 'done',
      fileCount: 3,
      chunkCount: 10,
      symbolCount: 5,
      edgeCount: 2,
      filesIndexed: 3,
      filesSkipped: 1,
      filesPending: 0,
      storeDir: '/tmp/repo/.mergecore/rag',
      hasSqlite: true,
      schemaVersion: 4,
      cancellable: true,
      updatedAt: 1,
      fingerprint: 'abc',
    };
    const parsed = parseIndexStatus(serializeIndexStatus(value));
    assert.deepEqual(parsed, value);
  });

  it('round-trips ContextPack', () => {
    const ref: SourceReference = {
      workspaceId: 'ws-1',
      path: 'src/util.ts',
      startLine: 1,
      endLine: 3,
      sourceType: 'symbol',
      sourceFingerprint: 'abc',
      symbol: 'add',
      authored: 'human',
      extraction: 'deterministic',
    };
    const value: ContextPack = {
      id: 'pack:1',
      workspaceRoot: '/tmp/repo',
      query: 'add',
      createdAt: 42,
      claims: [
        {
          id: 'claim:1',
          text: 'function add',
          confidence: 'high',
          confidenceDetail: {
            level: 'high',
            components: {
              independentSourceCount: 1,
              sourceFreshness: 'fresh',
              modelGenerated: false,
              parserCertainty: 'certain',
            },
            rationale: ['component-certainty=1.00', 'independent-sources=1'],
            diagnosticScore: 0.9,
          },
          references: [ref],
          score: 10,
        },
      ],
      instructions: [],
      references: [ref],
      incomplete: false,
    };
    const parsed = parseContextPack(serializeContextPack(value));
    assert.deepEqual(parsed, value);
  });

  it('maps legacy uncertain confidence to low', () => {
    const legacy = JSON.stringify({
      id: 'c1',
      text: 'maybe',
      confidence: 'uncertain',
      references: [
        {
          path: 'a.ts',
          startLine: 1,
          endLine: 1,
          sourceType: 'lexical',
        },
      ],
    });
    const claim = parseContextClaim(legacy);
    assert.equal(claim.confidence, 'low');
    assert.ok(claim.confidenceDetail);
    assert.equal(claim.references[0]!.path, 'a.ts');
  });
});
