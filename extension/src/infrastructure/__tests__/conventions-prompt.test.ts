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

test('buildSystemPrompt mentions the contextual memory rules', () => {
  const system = buildSystemPrompt();
  assert.match(system, /Contextual memory/);
  assert.match(system, /convention id/);
});
