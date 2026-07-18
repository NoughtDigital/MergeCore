import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  chunkMarkdownByHeadings,
  createInstructionResolver,
  discoverContextDocuments,
  pathMatchesGlob,
  PRECEDENCE,
} from '../../dist/index.js';

async function makeRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mergecore-instr-'));
}

async function write(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

describe('InstructionResolver', () => {
  it('resolves root and nested AGENTS.md with closest highest precedence', async () => {
    const root = await makeRoot();
    await write(
      root,
      'AGENTS.md',
      '# Root\n\n- Always use UK English in user-facing strings.\n'
    );
    await write(
      root,
      'apps/api/AGENTS.md',
      '# API\n\n- Must validate every request DTO.\n'
    );
    await write(
      root,
      'apps/api/billing/AGENTS.md',
      '# Billing\n\n- Must not log full card numbers.\n'
    );
    await write(root, 'apps/api/billing/refunds/RefundService.ts', 'export class RefundService {}\n');

    const resolver = await createInstructionResolver({ workspaceRoot: root });
    const target = 'apps/api/billing/refunds/RefundService.ts';
    const instr = await resolver.getApplicableInstructions(target);
    const binding = instr.filter((i) => i.binding === 'binding');

    assert.ok(binding.length >= 3);
    assert.equal(binding[0]!.sourceFile, 'apps/api/billing/AGENTS.md');
    assert.ok(binding[0]!.precedence > binding.find((i) => i.sourceFile === 'apps/api/AGENTS.md')!.precedence);
    assert.ok(
      binding.find((i) => i.sourceFile === 'apps/api/AGENTS.md')!.precedence >
        binding.find((i) => i.sourceFile === 'AGENTS.md')!.precedence
    );

    const explanation = await resolver.explainInstructionPrecedence(target);
    assert.ok(explanation.rationale.some((r) => /Nearest binding|apps\/api\/billing\/AGENTS/i.test(r)));
    assert.ok(explanation.ordered.every((i) => i.sourceFile && i.startLine >= 1 && i.endLine >= i.startLine));
  });

  it('treats README as contextual, not binding override', async () => {
    const root = await makeRoot();
    await write(root, 'AGENTS.md', '# Agents\n\n- Must use typed errors.\n');
    await write(root, 'README.md', '# Project\n\nThis is a lovely overview of the system.\n');
    await write(root, 'src/index.ts', 'export {}\n');

    const resolver = await createInstructionResolver({ workspaceRoot: root });
    const instr = await resolver.getApplicableInstructions('src/index.ts');
    const readme = instr.filter((i) => i.sourceFile.toLowerCase().includes('readme'));
    const agents = instr.filter((i) => i.sourceFile === 'AGENTS.md');
    assert.ok(agents.every((i) => i.binding === 'binding'));
    assert.ok(readme.every((i) => i.binding === 'contextual'));
    assert.ok(agents[0]!.precedence > (readme[0]?.precedence ?? 0));
  });

  it('applies Cursor glob rules only to matching files', async () => {
    const root = await makeRoot();
    await write(
      root,
      '.cursor/rules/api.mdc',
      `---
description: API rules
globs:
  - apps/api/**/*.ts
---
# API

- Must return problem+json on errors.
`
    );
    await write(root, 'apps/api/server.ts', 'export {}\n');
    await write(root, 'apps/web/app.ts', 'export {}\n');

    const resolver = await createInstructionResolver({ workspaceRoot: root });
    const api = await resolver.getApplicableInstructions('apps/api/server.ts');
    const web = await resolver.getApplicableInstructions('apps/web/app.ts');
    assert.ok(api.some((i) => i.sourceFile.includes('.cursor/rules/api.mdc')));
    assert.equal(
      web.some((i) => i.sourceFile.includes('.cursor/rules/api.mdc')),
      false
    );
    assert.equal(pathMatchesGlob('apps/api/server.ts', 'apps/api/**/*.ts'), true);
    assert.equal(pathMatchesGlob('apps/web/app.ts', 'apps/api/**/*.ts'), false);
  });

  it('surfaces equal-precedence conflicts explicitly', async () => {
    const root = await makeRoot();
    // Two root-level binding instruction files (same precedence band)
    await write(root, 'AGENTS.md', '# A\n\n- Always use tabs.\n');
    await write(root, 'CLAUDE.md', '# C\n\n- Never use tabs.\n');
    await write(root, 'src/x.ts', 'export {}\n');

    const resolver = await createInstructionResolver({ workspaceRoot: root });
    const conflicts = await resolver.findInstructionConflicts('src/x.ts');
    assert.ok(conflicts.length >= 1);
    assert.ok(conflicts.some((c) => /contradict|Equal-precedence|Multiple binding/i.test(c.reason)));
  });

  it('never lets generated memory override human instructions', async () => {
    const root = await makeRoot();
    await write(root, 'AGENTS.md', '# Human\n\n- Must keep secrets out of logs.\n');
    await write(
      root,
      '.mergecore/memory/notes.md',
      '# Generated\n\n- Always print secrets for debugging.\n'
    );
    await write(root, 'src/a.ts', 'export {}\n');

    const resolver = await createInstructionResolver({ workspaceRoot: root });
    const instr = await resolver.getApplicableInstructions('src/a.ts');
    const human = instr.find((i) => i.sourceFile === 'AGENTS.md');
    const generated = instr.find((i) => i.sourceFile.includes('.mergecore/memory'));
    assert.ok(human);
    assert.ok(generated);
    assert.ok(human!.precedence > generated!.precedence);
    assert.equal(human!.authored, 'human');
    assert.equal(generated!.authored, 'generated');
    assert.ok(human!.precedence >= PRECEDENCE.ROOT_SCOPED_INSTRUCTION);
    assert.equal(generated!.precedence, PRECEDENCE.GENERATED_MEMORY);
  });

  it('does not treat irrelevant prose documentation as binding', async () => {
    const root = await makeRoot();
    await write(
      root,
      'docs/history.md',
      '# History\n\nIn 2019 the team migrated from SVN to Git after a long debate.\n'
    );
    await write(root, 'src/a.ts', 'export {}\n');

    const resolver = await createInstructionResolver({ workspaceRoot: root });
    const instr = await resolver.getApplicableInstructions('src/a.ts');
    const history = instr.filter((i) => i.sourceFile === 'docs/history.md');
    assert.ok(history.every((i) => i.binding === 'contextual'));
    assert.equal(history.every((i) => i.documentType !== 'instruction' || i.binding !== 'binding'), true);
  });

  it('preserves Markdown heading ancestry and source ranges', async () => {
    const md = `# Title

## Setup

### Install

- Always run npm ci.

## Usage

Hello.
`;
    const sections = chunkMarkdownByHeadings('docs/guide.md', md);
    const install = sections.find((s) => s.title === 'Install');
    assert.ok(install);
    assert.deepEqual(install!.headingAncestry, ['Title', 'Setup', 'Install']);
    assert.ok(install!.startLine >= 1);
    assert.ok(install!.endLine >= install!.startLine);
    assert.ok(install!.text.includes('npm ci'));
  });

  it('discovers ADRs and CLAUDE.md', async () => {
    const root = await makeRoot();
    await write(root, 'docs/adr/0001-use-postgres.md', '# ADR 1\n\nWe decided to use Postgres.\n');
    await write(root, 'CLAUDE.md', '# Claude\n\n- Prefer small PRs.\n');
    await write(root, 'apps/web/CLAUDE.md', '# Web\n\n- Prefer CSS modules.\n');

    const docs = await discoverContextDocuments({ workspaceRoot: root });
    assert.ok(docs.some((d) => d.path === 'docs/adr/0001-use-postgres.md' && d.documentType === 'decision'));
    assert.ok(docs.some((d) => d.path === 'CLAUDE.md' && d.documentType === 'instruction'));
    assert.ok(docs.some((d) => d.path === 'apps/web/CLAUDE.md'));
  });

  it('supports user-configured paths at highest precedence', async () => {
    const root = await makeRoot();
    await write(root, 'AGENTS.md', '# Root\n\n- Always use bun.\n');
    await write(root, 'team/SPECIAL.md', '# Special\n\n- Always use npm.\n');
    await write(root, 'src/a.ts', 'export {}\n');

    const resolver = await createInstructionResolver({
      workspaceRoot: root,
      configuredPaths: ['team/SPECIAL.md'],
    });
    const instr = await resolver.getApplicableInstructions('src/a.ts');
    const special = instr.find((i) => i.sourceFile === 'team/SPECIAL.md');
    const agents = instr.find((i) => i.sourceFile === 'AGENTS.md');
    assert.ok(special);
    assert.ok(agents);
    assert.ok(special!.userConfigured);
    assert.ok(special!.precedence > agents!.precedence);
  });

  it('normalises Windows-style paths for scoping', async () => {
    const root = await makeRoot();
    await write(root, 'apps/api/AGENTS.md', '# API\n\n- Must use zod.\n');
    await write(root, 'apps/api/main.ts', 'export {}\n');

    const resolver = await createInstructionResolver({ workspaceRoot: root });
    const winTarget = 'apps\\api\\main.ts';
    const instr = await resolver.getApplicableInstructions(winTarget);
    assert.ok(instr.some((i) => i.sourceFile === 'apps/api/AGENTS.md'));

    const explanation = await resolver.explainInstructionPrecedence(winTarget);
    assert.equal(explanation.targetFile.replace(/\\/g, '/'), 'apps/api/main.ts');
  });

  it('handles multiple workspace roots without throwing', async () => {
    const rootA = await makeRoot();
    const rootB = await makeRoot();
    await write(rootA, 'AGENTS.md', '# A\n\n- Must ship tests.\n');
    await write(rootB, 'AGENTS.md', '# B\n\n- Must ship docs.\n');
    await write(rootA, 'src/a.ts', 'export {}\n');

    const resolver = await createInstructionResolver({
      workspaceRoot: rootA,
      workspaceRoots: [rootB],
    });
    const docs = await resolver.getApplicableDocuments('src/a.ts');
    assert.ok(docs.length >= 1);
  });
});
