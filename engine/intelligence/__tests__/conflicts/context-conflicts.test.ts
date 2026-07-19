import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { after, describe, it } from 'node:test';
import {
  extractConflictRuleCandidates,
  loadExtractedConflictRules,
  mapInstructionTextToRule,
  saveConflictIgnore,
  scanContextConflicts,
  updateExtractedRuleStatus,
} from '../../index';

async function mkWorkspace(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mergecore-conflicts-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, 'utf8');
  }
  return root;
}

describe('mapInstructionTextToRule', () => {
  it('maps Prisma controller restriction to direct_database_access', () => {
    const mapped = mapInstructionTextToRule(
      'Controllers must not access Prisma directly.'
    );
    assert.ok(mapped);
    assert.equal(mapped!.ambiguous, false);
    assert.equal(mapped!.suggestedDetector, 'direct_database_access');
    assert.ok(mapped!.suggestedFields?.forbiddenImports?.includes('@prisma/client'));
    assert.ok(mapped!.appliesTo.some((g) => g.includes('controller')));
  });

  it('does not invent a rule from ordinary README prose', () => {
    const mapped = mapInstructionTextToRule(
      'This project uses TypeScript and prefers clear module boundaries.'
    );
    assert.equal(mapped, undefined);
  });

  it('marks vague must-language as ambiguous', () => {
    const mapped = mapInstructionTextToRule(
      'You must always keep the architecture clean and thoughtful.'
    );
    assert.ok(mapped);
    assert.equal(mapped!.ambiguous, true);
  });
});

describe('context conflict scan', () => {
  it('reports valid Prisma conflict with dual evidence', async () => {
    const root = await mkWorkspace({
      'AGENTS.md': `# Agents\n\n- Controllers must not access Prisma directly.\n`,
      'src/controllers/user.ts': `import { PrismaClient } from '@prisma/client';\nconst prisma = new PrismaClient();\nexport const list = () => prisma.user.findMany();\n`,
      '.mergecore/conflict-rules.json': JSON.stringify(
        {
          schemaVersion: 1,
          rules: [
            {
              id: 'no-direct-prisma-in-controllers',
              description: 'Controllers must not use Prisma directly',
              applies_to: ['src/controllers/**/*.ts'],
              forbidden_imports: ['@prisma/client'],
              database_access_patterns: ['PrismaClient', 'prisma.'],
              detector: 'direct_database_access',
              source: { path: 'AGENTS.md', line: 3 },
            },
          ],
        },
        null,
        2
      ),
    });
    try {
      const result = await scanContextConflicts({
        workspaceRoot: root,
        refreshExtraction: false,
      });
      assert.ok(result.findings.length >= 1, JSON.stringify(result.findings));
      const f = result.findings[0]!;
      assert.equal(
        f.message,
        'Documented rule conflicts with observed implementation.'
      );
      assert.ok(f.documentedRule.path.includes('AGENTS.md') || f.documentedRule.text.length > 0);
      assert.ok(f.observedCode.length > 0);
      assert.ok(f.affectedFiles.some((p) => p.includes('controllers/user.ts')));
      assert.equal(f.detector, 'direct_database_access');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('avoids false positives when controllers do not import Prisma', async () => {
    const root = await mkWorkspace({
      'src/controllers/user.ts': `import { UserService } from '../services/user';\nexport const list = () => UserService.list();\n`,
      'src/services/user.ts': `import { PrismaClient } from '@prisma/client';\nexport const UserService = { list: () => new PrismaClient().user.findMany() };\n`,
      '.mergecore/conflict-rules.json': JSON.stringify({
        schemaVersion: 1,
        rules: [
          {
            id: 'no-direct-prisma-in-controllers',
            description: 'Controllers must not use Prisma directly',
            applies_to: ['src/controllers/**'],
            forbidden_imports: ['@prisma/client'],
            detector: 'direct_database_access',
            database_access_patterns: ['PrismaClient'],
            source: { path: 'AGENTS.md', line: 1 },
          },
        ],
      }),
    });
    try {
      const result = await scanContextConflicts({
        workspaceRoot: root,
        refreshExtraction: false,
      });
      assert.equal(result.findings.length, 0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('does not scan disabled extracted rules', async () => {
    const root = await mkWorkspace({
      'AGENTS.md': `- Controllers must not access Prisma directly.\n`,
      'src/controllers/a.ts': `import { PrismaClient } from '@prisma/client';\n`,
    });
    try {
      const extracted = await extractConflictRuleCandidates({ workspaceRoot: root });
      assert.ok(extracted.candidates.length >= 1);
      const id = extracted.candidates[0]!.id;
      updateExtractedRuleStatus(root, id, 'disabled');
      const result = await scanContextConflicts({
        workspaceRoot: root,
        refreshExtraction: false,
      });
      assert.equal(result.findings.length, 0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('honours nested applies_to scopes', async () => {
    const root = await mkWorkspace({
      'src/controllers/admin/x.ts': `import { PrismaClient } from '@prisma/client';\n`,
      'src/other/y.ts': `import { PrismaClient } from '@prisma/client';\n`,
      '.mergecore/conflict-rules.json': JSON.stringify({
        schemaVersion: 1,
        rules: [
          {
            id: 'admin-only',
            description: 'Admin controllers must not use Prisma',
            applies_to: ['src/controllers/admin/**'],
            forbidden_imports: ['@prisma/client'],
            detector: 'forbidden_imports',
            source: { path: 'AGENTS.md', line: 1 },
          },
        ],
      }),
    });
    try {
      const result = await scanContextConflicts({
        workspaceRoot: root,
        refreshExtraction: false,
      });
      assert.equal(result.findings.length, 1);
      assert.deepEqual(result.findings[0]!.affectedFiles, [
        'src/controllers/admin/x.ts',
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('ignores generated memory when extracting', async () => {
    const root = await mkWorkspace({
      '.mergecore/generated/notes.md': `# Notes\n\n- Controllers must not access Prisma directly.\n`,
      'README.md': `# Hello\n\n- Controllers must not access Prisma directly.\n`,
    });
    try {
      const extracted = await extractConflictRuleCandidates({ workspaceRoot: root });
      assert.equal(extracted.candidates.length, 0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('skips ambiguous language until confirmed with edits', async () => {
    const root = await mkWorkspace({
      'AGENTS.md': `- You must always keep the architecture clean and thoughtful.\n`,
      'src/controllers/a.ts': `export const a = 1;\n`,
    });
    try {
      const extracted = await extractConflictRuleCandidates({ workspaceRoot: root });
      const amb = extracted.candidates.filter((c) => c.ambiguous);
      assert.ok(amb.length >= 1);
      // pending ambiguous must not scan
      const result = await scanContextConflicts({
        workspaceRoot: root,
        refreshExtraction: false,
      });
      assert.equal(result.findings.length, 0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('respects ignored conflicts', async () => {
    const root = await mkWorkspace({
      'src/controllers/user.ts': `import { PrismaClient } from '@prisma/client';\nconst prisma = new PrismaClient();\n`,
      '.mergecore/conflict-rules.json': JSON.stringify({
        schemaVersion: 1,
        rules: [
          {
            id: 'no-prisma',
            description: 'Controllers must not use Prisma directly',
            applies_to: ['src/controllers/**'],
            forbidden_imports: ['@prisma/client'],
            detector: 'forbidden_imports',
            source: { path: 'AGENTS.md', line: 1 },
          },
        ],
      }),
    });
    try {
      const first = await scanContextConflicts({
        workspaceRoot: root,
        refreshExtraction: false,
      });
      assert.ok(first.findings.length >= 1);
      const f = first.findings[0]!;
      saveConflictIgnore(root, {
        conflictId: f.id,
        ruleId: f.rule.id,
        paths: f.affectedFiles,
        ignoredAt: new Date().toISOString(),
      });
      const second = await scanContextConflicts({
        workspaceRoot: root,
        refreshExtraction: false,
      });
      assert.equal(second.findings.length, 0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('confirmed extraction becomes active', async () => {
    const root = await mkWorkspace({
      'AGENTS.md': `- Controllers must not access Prisma directly.\n`,
      'src/controllers/pay.ts': `import { PrismaClient } from '@prisma/client';\nexport const p = new PrismaClient();\n`,
    });
    try {
      const extracted = await extractConflictRuleCandidates({ workspaceRoot: root });
      const cand = extracted.candidates.find((c) => !c.ambiguous);
      assert.ok(cand);
      updateExtractedRuleStatus(root, cand!.id, 'confirmed');
      const stored = loadExtractedConflictRules(root).rules.find((r) => r.id === cand!.id);
      assert.equal(stored?.status, 'confirmed');
      const result = await scanContextConflicts({
        workspaceRoot: root,
        refreshExtraction: false,
      });
      assert.ok(result.findings.length >= 1);
      assert.equal(result.findings[0]!.userConfirmed, true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

after(() => {
  // no-op: each test cleans its temp dir
});
