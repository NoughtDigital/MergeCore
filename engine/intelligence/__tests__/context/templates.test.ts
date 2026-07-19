import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import {
  assembleTaskContextPack,
  customiseTemplate,
  createRepositoryFileIndexer,
  getBuiltinTemplate,
  inheritBuiltinDefaults,
  listBuiltinTemplates,
  listContextPackTemplates,
  parseContextPackTemplateMarkdown,
  previewContextPackTemplate,
  resolveContextPackTemplate,
  saveContextPackTemplate,
  serialiseContextPackTemplate,
  setWorkspaceDefaultTemplate,
  TEMPLATE_FORBIDDEN_KEYS,
} from '../../dist/index.js';

const require = createRequire(import.meta.url);
const { billingRefundEvalRoot } = require('../../../../packages/test-fixtures/index.js') as {
  billingRefundEvalRoot: string;
};

async function copyFixture(src: string, dest: string): Promise<void> {
  await fs.cp(src, dest, { recursive: true });
}

describe('context-pack templates', () => {
  it('exposes ten built-in templates with required fields', () => {
    const builtins = listBuiltinTemplates();
    assert.equal(builtins.length, 10);
    const ids = new Set(builtins.map((t) => t.id));
    for (const id of [
      'new-feature',
      'bug-investigation',
      'refactor',
      'security-review',
      'dependency-upgrade',
      'api-change',
      'database-migration',
      'integration-implementation',
      'test-coverage',
      'onboarding-code-explanation',
    ]) {
      assert.ok(ids.has(id), `missing builtin ${id}`);
      const t = getBuiltinTemplate(id)!;
      assert.ok(t.sections.length >= 4);
      assert.ok(t.maxContextBudget > 0);
      assert.ok(t.preferredRelationshipKinds.length > 0);
      assert.ok(t.sourceTypes.length > 0);
      assert.equal(typeof t.requireTests, 'boolean');
      assert.equal(typeof t.prioritiseArchitecture, 'boolean');
      assert.equal(typeof t.uncertaintyBlocksCompletion, 'boolean');
    }
  });

  it('rejects malformed templates without frontmatter', () => {
    const parsed = parseContextPackTemplateMarkdown('# No frontmatter\n');
    assert.equal(parsed.ok, false);
    assert.ok(parsed.issues.some((i) => i.code === 'malformed'));
  });

  it('reports missing sections', () => {
    const parsed = parseContextPackTemplateMarkdown(`---
name: Empty sections
sections: []
---
`);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.issues.some((i) => i.code === 'missing_sections'));
  });

  it('inherits defaults from builtin when workspace template is partial', () => {
    const parsed = parseContextPackTemplateMarkdown(
      `---
name: Custom bug hunt
id: custom-bug
sections:
  - task
  - symptoms
  - uncertainty
  - sources
---
`,
      {
        inheritFrom: getBuiltinTemplate('bug-investigation'),
        source: 'workspace',
      }
    );
    assert.equal(parsed.ok, true);
    const inherited = inheritBuiltinDefaults(parsed.template!, 'bug-investigation');
    assert.equal(inherited.requireTests, true);
    assert.equal(inherited.uncertaintyBlocksCompletion, true);
    assert.ok(inherited.retrieval.dependencyDepth >= 2);
    assert.ok(inherited.preferredRelationshipKinds.includes('call'));
  });

  it('flags privacy-rule conflicts and strips forbidden keys', () => {
    const md = `---
name: Sneaky
id: sneaky
disable_privacy: true
skip_source_validation: true
sections:
  - task
  - sources
retrieval:
  dependency_depth: 2
  prioritise:
    - tests
---
`;
    const parsed = parseContextPackTemplateMarkdown(md, {
      inheritFrom: getBuiltinTemplate('new-feature'),
    });
    assert.ok(parsed.issues.some((i) => i.code === 'privacy_conflict'));
    assert.ok(
      TEMPLATE_FORBIDDEN_KEYS.some((k) =>
        parsed.issues.some((i) => i.message.includes(k) || i.path === k)
      )
    );
    // Still may parse if name+sections present after strip
    if (parsed.ok && parsed.template) {
      assert.equal(
        (parsed.template as { disable_privacy?: boolean }).disable_privacy,
        undefined
      );
    }
  });

  it('clamps budgets above the hard ceiling', () => {
    const parsed = parseContextPackTemplateMarkdown(
      `---
name: Huge
sections:
  - task
  - sources
retrieval:
  dependency_depth: 99
  max_chars: 999999
---
`,
      { inheritFrom: getBuiltinTemplate('new-feature') }
    );
    assert.equal(parsed.ok, true);
    assert.ok(parsed.issues.some((i) => i.code === 'budget_clamped'));
    assert.ok(parsed.template!.retrieval.dependencyDepth <= 4);
    assert.ok(parsed.template!.maxContextBudget <= 60_000);
  });

  it('round-trips serialise/parse for custom templates', () => {
    const base = getBuiltinTemplate('security-review')!;
    const custom = customiseTemplate(base, {
      baseId: base.id,
      id: 'ws-security',
      name: 'Workspace security',
      requireTests: true,
    });
    const md = serialiseContextPackTemplate(custom);
    assert.ok(md.startsWith('---'));
    const again = parseContextPackTemplateMarkdown(md, {
      inheritFrom: base,
      source: 'workspace',
    });
    assert.equal(again.ok, true);
    assert.equal(again.template!.id, 'ws-security');
    assert.equal(again.template!.name, 'Workspace security');
    assert.deepEqual([...again.template!.sections], [...custom.sections]);
  });
});

describe('context-pack templates integration', () => {
  let workspaceRoot: string;
  let storageDir: string;

  before(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mergecore-tpl-'));
    storageDir = path.join(workspaceRoot, '.mergecore-store');
    await copyFixture(billingRefundEvalRoot, workspaceRoot);
  });

  after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('loads workspace templates and workspace default', async () => {
    const custom = customiseTemplate(getBuiltinTemplate('bug-investigation')!, {
      baseId: 'bug-investigation',
      id: 'team-bug',
      name: 'Team bug pack',
    });
    const saved = await saveContextPackTemplate(workspaceRoot, custom, {
      setDefault: true,
    });
    assert.ok(saved.relativePath.includes('.mergecore/templates/'));
    const loaded = await listContextPackTemplates(workspaceRoot);
    assert.equal(loaded.defaultId, 'team-bug');
    assert.ok(loaded.workspace.some((t) => t.id === 'team-bug'));

    await setWorkspaceDefaultTemplate(workspaceRoot, 'new-feature');
    const again = await listContextPackTemplates(workspaceRoot);
    assert.equal(again.defaultId, 'new-feature');
  });

  it('preview exposes retrieval settings without privacy overrides', async () => {
    const { template } = await resolveContextPackTemplate({
      workspaceRoot,
      templateId: 'security-review',
    });
    const preview = previewContextPackTemplate(template);
    assert.equal(preview.template.id, 'security-review');
    assert.ok(preview.retrieval.dependencyDepth >= 2);
    assert.ok(preview.sections.includes('attack_surface'));
    assert.ok(
      preview.notes.some((n) => /privacy/i.test(n)),
      'preview must note privacy cannot be disabled'
    );
  });

  it('bug-investigation pack differs meaningfully from new-feature pack', async () => {
    const indexer = await createRepositoryFileIndexer({
      workspaceRoot,
      storageDir,
    });
    try {
      await indexer.startInitialIndex();
      const store = indexer.getRagStore();
      const task = 'Investigate partial subscription refund failures';

      const feature = await assembleTaskContextPack({
        workspaceRoot,
        store,
        task,
        templateId: 'new-feature',
        graphService: indexer.getCodeGraphService(),
      });
      const bug = await assembleTaskContextPack({
        workspaceRoot,
        store,
        task,
        templateId: 'bug-investigation',
        graphService: indexer.getCodeGraphService(),
      });

      assert.equal(feature.meta.templateId, 'new-feature');
      assert.equal(bug.meta.templateId, 'bug-investigation');
      assert.ok(feature.markdown.includes('# Change scope'));
      assert.ok(bug.markdown.includes('# Symptoms and likely locus'));
      assert.ok(bug.markdown.includes('# Reproduction and call paths'));
      assert.ok(!feature.markdown.includes('# Symptoms and likely locus'));
      assert.notEqual(feature.markdown, bug.markdown);
      assert.ok(feature.meta.sources.length > 0);
      assert.ok(bug.meta.sources.length > 0);
      assert.ok(feature.meta.budgets.maxChars > 0);
      assert.ok(bug.meta.budgets.maxDependencyDepth >= feature.meta.budgets.maxDependencyDepth);
      assert.equal(bug.meta.modelProvider, 'none');
      assert.equal(bug.meta.dataLeftMachine, false);
    } finally {
      await indexer.dispose();
    }
  });
});
