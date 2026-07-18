import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildUserPrompt, buildSystemPrompt } from '../../../../engine/pipeline/prompts';

test('buildUserPrompt renders the Project conventions block when provided', () => {
  const prompt = buildUserPrompt({
    scope: 'file',
    filePath: 'src/foo.ts',
    languageId: 'typescript',
    codeOrDiff: 'export const x = 1;',
    projectRulesDigest: 'ts-rules: []',
    deterministicFindingsJson: '[]',
    maxFindings: 10,
    conventions: [
      {
        id: 'arch:actions-pattern',
        label: 'Uses Actions pattern',
        confidence: 'high',
        category: 'architecture',
        evidence: ['8 action files'],
      },
      {
        id: 'types:typescript-strict',
        label: 'Uses strict TypeScript',
        confidence: 'medium',
        category: 'types',
      },
    ],
  });
  assert.match(prompt, /Project conventions \(contextual memory/);
  assert.match(prompt, /arch:actions-pattern \(architecture\): Uses Actions pattern/);
  assert.match(prompt, /types:typescript-strict \(types\): Uses strict TypeScript/);
  assert.match(prompt, /8 action files/);
});

test('buildUserPrompt omits the conventions block when there are none', () => {
  const prompt = buildUserPrompt({
    scope: 'file',
    filePath: 'src/foo.ts',
    languageId: 'typescript',
    codeOrDiff: 'export const x = 1;',
    projectRulesDigest: 'ts-rules: []',
    deterministicFindingsJson: '[]',
    maxFindings: 10,
  });
  assert.ok(
    !/Project conventions \(contextual memory/.test(prompt),
    'expected no contextual-memory block when conventions list is empty'
  );
});

test('buildUserPrompt suppresses outvoted layering rivals', () => {
  const prompt = buildUserPrompt({
    scope: 'file',
    filePath: 'app/Services/FooService.php',
    languageId: 'php',
    codeOrDiff: '<?php class FooService {}',
    projectRulesDigest: 'php-rules: []',
    deterministicFindingsJson: '[]',
    maxFindings: 10,
    conventions: [
      {
        id: 'layering:services-over-helpers',
        label: 'Prefers services',
        confidence: 'high',
        category: 'layering',
        evidence: ['24 service files in Services/'],
      },
      {
        id: 'arch:actions-pattern',
        label: 'Uses Actions',
        confidence: 'medium',
        category: 'architecture',
        evidence: ['3 action files under Actions/'],
      },
    ],
  });
  assert.match(prompt, /layering:services-over-helpers/);
  assert.match(prompt, /Suppressed \(do not critique against\)/);
  assert.match(prompt, /arch:actions-pattern: outvoted by layering:services-over-helpers/);
  assert.ok(
    !/^- \[medium\] arch:actions-pattern/m.test(prompt),
    'Actions should not remain in the active critique list when Services dominate'
  );
});

test('buildSystemPrompt mentions the contextual memory rules', () => {
  const system = buildSystemPrompt();
  assert.match(system, /Contextual memory/);
  assert.match(system, /convention id/);
  assert.match(system, /Suppressed/);
  assert.match(system, /placement conflicts/);
});
