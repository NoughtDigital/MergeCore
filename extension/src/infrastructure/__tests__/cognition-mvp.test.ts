import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import {
  chunkPhp,
  indexWorkspace,
  retrieve,
  RagStore,
} from '@mergecore/intelligence';
import { Explainer } from '../explain/explainer';
import { auditHoverExplanation } from '../explain/hover-quality';
import { resolvePhpSymbolAt } from '../../presentation/hover/php-symbol';
import { EXPLANATION_MODES, getExplanationMode } from '../../domain/explanation-modes';

describe('cognition MVP', () => {
  it('chunks PHP methods with class-qualified symbols', () => {
    const php = `<?php
namespace App\\Http\\Controllers;

class OrderController
{
    public function store(Request $request)
    {
        return response()->json(['ok' => true]);
    }
}
`;
    const chunks = chunkPhp('app/Http/Controllers/OrderController.php', php, 'hash');
    assert.ok(chunks.some((c) => c.symbol === 'OrderController::store'));
  });

  it('resolves PHP symbol at cursor line', () => {
    const php = `<?php
class OrderController
{
    public function store()
    {
        return 1;
    }
}
`;
    const info = resolvePhpSymbolAt(php, 4);
    assert.equal(info?.symbol, 'OrderController::store');
    assert.equal(info?.kind, 'method');
  });

  it('all four explanation modes produce distinct depth', async () => {
    const explainer = new Explainer(undefined);
    const base = {
      symbol: 'OrderController::store',
      filePath: 'app/Http/Controllers/OrderController.php',
      code: 'public function store() { return 1; }',
      relatedSummary: '- `app/Models/Order.php` — model',
      ragContext: 'Prefer Actions for money mutations.',
      architecturalHints: '',
    };
    const texts = [];
    for (const mode of EXPLANATION_MODES) {
      const result = await explainer.explain({ ...base, mode: mode.id });
      assert.ok(result.markdown.includes('## Function Summary'));
      assert.ok(auditHoverExplanation(result.markdown).ok, `mode ${mode.id} failed quality`);
      texts.push(result.markdown);
    }
    assert.equal(new Set(texts).size, 4);
    assert.ok(texts[0]!.includes('step by step') || texts[0]!.includes(getExplanationMode('junior').title));
    assert.ok(texts[3]!.includes('concurrency') || texts[3]!.includes('enterprise') || texts[3]!.includes('critique'));
  });

  it('indexes a Laravel-like workspace to SQLite and retrieves memory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mergecore-rag-'));
    try {
      await writeFile(path.join(root, 'artisan'), '#!/usr/bin/env php\n', 'utf8');
      await writeFile(
        path.join(root, 'composer.json'),
        JSON.stringify({
          require: { 'laravel/framework': '^11.0' },
        }),
        'utf8'
      );
      await writeFile(
        path.join(root, 'README.md'),
        '# Demo\n\n## Architecture\n\nMoney mutations go through Actions.\n',
        'utf8'
      );
      await writeFile(
        path.join(root, 'decisions.md'),
        '# Decisions\n\nUse FormRequests for HTTP validation.\n',
        'utf8'
      );
      await mkdir(path.join(root, 'app', 'Http', 'Controllers'), { recursive: true });
      await writeFile(
        path.join(root, 'app', 'Http', 'Controllers', 'OrderController.php'),
        `<?php
namespace App\\Http\\Controllers;

class OrderController
{
    public function store()
    {
        return response()->json(['ok' => true]);
    }
}
`,
        'utf8'
      );

      const agentsPath = path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'rules',
        'packs',
        'laravel-core',
        'agents.md'
      );

      const result = await indexWorkspace({
        workspaceRoot: root,
        isLaravel: true,
        laravelAgentsPath: agentsPath,
      });

      assert.ok(result.chunks > 0, 'expected chunks');
      const jsonPath = path.join(root, '.mergecore', 'rag', 'index.json');
      const raw = await readFile(jsonPath, 'utf8');
      assert.ok(raw.includes('OrderController'));

      const sqlitePath = path.join(root, '.mergecore', 'rag', 'index.sqlite');
      await access(sqlitePath);

      const store = await RagStore.open(root);
      assert.ok(store.hasSqlite, 'expected sqlite-backed store');
      const hits = retrieve(store, 'money mutations Actions FormRequests', {
        k: 5,
        preferMemory: true,
      });
      assert.ok(hits.length > 0, 'expected retrieval hits');
      assert.ok(
        hits.some((h) => h.chunk.kind === 'memory' || h.chunk.text.includes('Actions')),
        'expected memory influence'
      );

      const second = await indexWorkspace({
        workspaceRoot: root,
        store,
        isLaravel: true,
        laravelAgentsPath: agentsPath,
      });
      assert.equal(second.filesIndexed, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
