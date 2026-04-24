import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BUILTIN_PROD_RISK_RULES,
  PROD_RISK_CATEGORIES,
  scanProdRisks,
  type ProdRiskRule,
} from '@mergecore/intelligence';

async function makeWorkspace(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mergecore-prodrisk-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }
  return root;
}

test('prod-risk: built-in rule set covers every required category', () => {
  const covered = new Set(BUILTIN_PROD_RISK_RULES.map((r) => r.category));
  for (const cat of PROD_RISK_CATEGORIES) {
    assert.ok(
      covered.has(cat),
      `built-in rule set missing a rule for category '${cat}' — the scanner would silently skip it`
    );
  }
});

test('prod-risk: every built-in rule declares at least one language and a concrete fix hint', () => {
  for (const rule of BUILTIN_PROD_RISK_RULES) {
    assert.ok(
      rule.languages.length > 0,
      `rule ${rule.id} has no languages — the scanner would never evaluate it`
    );
    assert.ok(
      rule.fixHint && rule.fixHint.length > 0,
      `rule ${rule.id} has no fixHint — findings would be useless to the reviewer`
    );
    assert.ok(rule.id.length > 0, 'rule missing id');
    assert.ok(rule.ruleVersion.length > 0, `rule ${rule.id} missing ruleVersion`);
  }
});

test('prod-risk: flags missing rate limiter in an Express app', async () => {
  const root = await makeWorkspace({
    'server.ts': `import express from 'express';\nconst app = express();\napp.post('/login', (req, res) => res.end());\napp.listen(3000);\n`,
  });
  try {
    const scan = await scanProdRisks({ workspaceRoot: root });
    const hits = scan.findings.filter((f) => f.category === 'no-rate-limits');
    assert.ok(hits.length >= 1, `expected at least one no-rate-limits finding, got ${hits.length}`);
    const summary = scan.summary.find((s) => s.category === 'no-rate-limits');
    assert.ok(summary, 'no-rate-limits missing from summary rollup');
    assert.ok(summary.count >= 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('prod-risk: negative pattern suppresses Express rule when rate-limit is used', async () => {
  const root = await makeWorkspace({
    'server.ts': `import express from 'express';\nimport rateLimit from 'express-rate-limit';\nconst app = express();\napp.use(rateLimit({ windowMs: 60000, max: 100 }));\napp.listen(3000);\n`,
  });
  try {
    const scan = await scanProdRisks({ workspaceRoot: root });
    const hits = scan.findings.filter((f) => f.ruleId === 'ts:rl:express-no-rate-limit');
    assert.equal(hits.length, 0, 'expected rate-limit rule to be suppressed by the negative pattern');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('prod-risk: detects console.log in a server file path', async () => {
  const root = await makeWorkspace({
    'src/api/handler.ts': `export function handle() { console.log('hello'); }\n`,
  });
  try {
    const scan = await scanProdRisks({ workspaceRoot: root });
    const hits = scan.findings.filter((f) => f.category === 'weak-logging');
    assert.ok(hits.length >= 1, 'expected weak-logging finding on api/handler.ts');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('prod-risk: module-scope Map without eviction flagged as memory leak', async () => {
  const root = await makeWorkspace({
    'cache.ts': `const cache = new Map();\nexport function put(k: string, v: unknown) { cache.set(k, v); }\n`,
  });
  try {
    const scan = await scanProdRisks({ workspaceRoot: root });
    const hits = scan.findings.filter((f) => f.ruleId === 'ts:leak:module-scope-map');
    assert.ok(hits.length >= 1, 'expected module-scope map leak rule to fire');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('prod-risk: requiredSignals gates rules out when profile lacks them', async () => {
  const root = await makeWorkspace({
    'Job.php': `<?php\nclass BigJob implements ShouldQueue {\n  public function handle() {}\n}\n`,
  });
  try {
    // No profile signals → required-signal rules should not fire.
    const scan = await scanProdRisks({ workspaceRoot: root });
    const laravelHits = scan.findings.filter((f) => f.ruleId === 'php:queue:infinite-retry');
    assert.equal(
      laravelHits.length,
      0,
      'Laravel-gated rule should not fire without path:artisan signal'
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('prod-risk: requiredSignals fires the rule when signals are present', async () => {
  const root = await makeWorkspace({
    'Job.php': `<?php\nclass BigJob implements ShouldQueue {\n  public function handle() {}\n}\n`,
  });
  try {
    const scan = await scanProdRisks({
      workspaceRoot: root,
      profile: {
        workspaceRoot: root,
        collectedAt: Date.now(),
        stacks: {
          php: { hasComposerJson: true, filament: false, livewire: false, pest: false, phpunit: false },
          javascript: { hasPackageJson: false, typeScript: false, react: false, vue: false, vite: false, inertia: false },
        },
        signals: ['path:artisan', 'php:composer'],
        conventions: [],
        fingerprint: 'path:artisan|php:composer',
      },
    });
    const hits = scan.findings.filter((f) => f.ruleId === 'php:queue:infinite-retry');
    assert.ok(hits.length >= 1, 'Laravel-gated rule should fire once profile includes path:artisan');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('prod-risk: extraRules from a simulated pack override a builtin by id', async () => {
  const root = await makeWorkspace({
    'unused.ts': `const cache = new Map();\nexport { cache };\n`,
  });
  try {
    const override: ProdRiskRule = {
      id: 'ts:leak:module-scope-map',
      ruleVersion: '999',
      category: 'memory-leaks',
      severity: 'critical',
      title: 'Pack override: module-scope Map forbidden here',
      description: 'Overridden by pack for this test.',
      fixHint: 'Use the pack-specified cache primitive.',
      origin: 'test-pack',
      languages: ['typescript'],
      patterns: [String.raw`new\s+Map\s*\(\s*\)`],
    };
    const scan = await scanProdRisks({
      workspaceRoot: root,
      extraRules: [override],
    });
    const hits = scan.findings.filter((f) => f.ruleId === 'ts:leak:module-scope-map');
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].severity, 'critical', 'pack override should raise severity to critical');
    assert.equal(hits[0].origin, 'test-pack', 'origin should point at the overriding pack');
    assert.equal(hits[0].ruleVersion, '999');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('prod-risk: ruleSetFingerprint is stable and changes with rule overrides', async () => {
  const root = await makeWorkspace({ 'empty.ts': '// nothing\n' });
  try {
    const a = await scanProdRisks({ workspaceRoot: root });
    const b = await scanProdRisks({ workspaceRoot: root });
    assert.equal(a.ruleSetFingerprint, b.ruleSetFingerprint, 'fingerprint should be deterministic');
    const c = await scanProdRisks({
      workspaceRoot: root,
      extraRules: [
        {
          id: 'ts:leak:module-scope-map',
          ruleVersion: '2',
          category: 'memory-leaks',
          severity: 'warning',
          title: 'test',
          description: 'test',
          fixHint: 'test',
          origin: 'test-pack',
          languages: ['typescript'],
          patterns: ['test'],
        },
      ],
    });
    assert.notEqual(
      a.ruleSetFingerprint,
      c.ruleSetFingerprint,
      'bumping a rule version should change the fingerprint so caches invalidate'
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('prod-risk: scan empty workspace returns clean summary with all categories missing', async () => {
  const root = await makeWorkspace({
    'README.md': '# hello\n',
  });
  try {
    const scan = await scanProdRisks({ workspaceRoot: root });
    assert.equal(scan.findings.length, 0);
    assert.equal(scan.summary.length, 0);
    assert.ok(scan.activeRuleIds.length > 0, 'active rule set should still be populated');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
