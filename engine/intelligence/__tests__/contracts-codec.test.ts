import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
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
      path: 'src/util.ts',
      startLine: 1,
      endLine: 4,
      sourceType: 'symbol',
      symbol: 'add',
      excerpt: 'export function add',
    };
    const parsed = parseSourceReference(serializeSourceReference(value));
    assert.deepEqual(parsed, value);
  });

  it('round-trips SymbolRecord', () => {
    const value: SymbolRecord = {
      id: 'typescript:src/util.ts:add:1',
      name: 'add',
      kind: 'function',
      location: { path: 'src/util.ts', startLine: 1, endLine: 3 },
      exported: true,
      language: 'typescript',
    };
    const parsed = parseSymbolRecord(serializeSymbolRecord(value));
    assert.deepEqual(parsed, value);
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
      schemaVersion: 3,
      cancellable: true,
      updatedAt: 1,
      fingerprint: 'abc',
    };
    const parsed = parseIndexStatus(serializeIndexStatus(value));
    assert.deepEqual(parsed, value);
  });

  it('round-trips ContextPack', () => {
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
          references: [
            {
              path: 'src/util.ts',
              startLine: 1,
              endLine: 3,
              sourceType: 'symbol',
              symbol: 'add',
            },
          ],
          score: 10,
        },
      ],
      instructions: [],
      references: [
        {
          path: 'src/util.ts',
          startLine: 1,
          endLine: 3,
          sourceType: 'symbol',
          symbol: 'add',
        },
      ],
      incomplete: false,
    };
    const parsed = parseContextPack(serializeContextPack(value));
    assert.deepEqual(parsed, value);
  });
});
