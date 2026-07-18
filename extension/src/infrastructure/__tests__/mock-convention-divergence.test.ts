import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ProjectConvention } from '@mergecore/intelligence';
import { emptyJsStack, emptyPhpStack } from '@mergecore/intelligence';
import { detectConventionDivergences, MockReviewEngine } from '../mock-review.engine';

function conv(
  partial: Partial<ProjectConvention> & Pick<ProjectConvention, 'id' | 'label' | 'category'>
): ProjectConvention {
  return {
    confidence: 'medium',
    ...partial,
  };
}

const menuConventions: ProjectConvention[] = [
  conv({
    id: 'layering:services-over-helpers',
    label: 'Prefers services over helpers',
    confidence: 'high',
    category: 'layering',
    evidence: ['24 service files in Services/', '2 files in Helpers/'],
  }),
  conv({
    id: 'arch:actions-pattern',
    label: 'Uses Actions pattern',
    confidence: 'medium',
    category: 'architecture',
    evidence: ['3 action files under Actions/'],
  }),
];

test('Menu fixture: Services dominate + Service under Services/ → no divergence', () => {
  const findings = detectConventionDivergences(
    menuConventions,
    '<?php\n\nclass AllergenTableDataService\n{\n    public function handle(): void {}\n}\n',
    'app/Services/AllergenTableDataService.php',
    'file'
  );
  assert.equal(findings.length, 0);
});

test('Actions-only + Service outside Services/ → warning', () => {
  const conventions: ProjectConvention[] = [
    conv({
      id: 'arch:actions-pattern',
      label: 'Uses Actions',
      confidence: 'high',
      category: 'architecture',
      evidence: ['18 action files under Actions/'],
    }),
  ];
  const findings = detectConventionDivergences(
    conventions,
    '<?php class CreateOrderService { public function handle() {} }',
    'app/Domain/CreateOrderService.php',
    'file'
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'mock-convention-service-in-actions-repo');
  assert.equal(findings[0].severity, 'warning');
});

test('both active + Service under Actions/ → placement warning', () => {
  const conventions: ProjectConvention[] = [
    conv({
      id: 'arch:actions-pattern',
      label: 'Uses Actions',
      confidence: 'medium',
      category: 'architecture',
      evidence: ['10 action files under Actions/'],
    }),
    conv({
      id: 'layering:services-over-helpers',
      label: 'Prefers services',
      confidence: 'medium',
      category: 'layering',
      evidence: ['9 service files in Services/'],
    }),
  ];
  const findings = detectConventionDivergences(
    conventions,
    '<?php class FooService {}',
    'app/Actions/FooService.php',
    'file'
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'mock-convention-service-placement');
  assert.match(findings[0].message, /placement|Actions/i);
});

test('git-diff without added Service class → no finding', () => {
  const conventions: ProjectConvention[] = [
    conv({
      id: 'arch:actions-pattern',
      label: 'Uses Actions',
      confidence: 'high',
      category: 'architecture',
      evidence: ['18 action files under Actions/'],
    }),
  ];
  const diff = [
    'diff --git a/app/Domain/CreateOrderService.php b/app/Domain/CreateOrderService.php',
    '--- a/app/Domain/CreateOrderService.php',
    '+++ b/app/Domain/CreateOrderService.php',
    '@@ -1,5 +1,6 @@',
    ' <?php',
    ' class CreateOrderService {',
    '+    // tweak',
    '     public function handle() {}',
    ' }',
  ].join('\n');
  const findings = detectConventionDivergences(
    conventions,
    diff,
    'app/Domain/CreateOrderService.php',
    'git-diff'
  );
  assert.equal(findings.length, 0);
});

test('git-diff with added Service class in Actions-only repo → warning', () => {
  const conventions: ProjectConvention[] = [
    conv({
      id: 'arch:actions-pattern',
      label: 'Uses Actions',
      confidence: 'high',
      category: 'architecture',
      evidence: ['18 action files under Actions/'],
    }),
  ];
  const diff = [
    'diff --git a/app/Domain/CreateOrderService.php b/app/Domain/CreateOrderService.php',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/app/Domain/CreateOrderService.php',
    '@@ -0,0 +1,3 @@',
    '+<?php',
    '+class CreateOrderService {',
    '+}',
  ].join('\n');
  const findings = detectConventionDivergences(
    conventions,
    diff,
    'app/Domain/CreateOrderService.php',
    'git-diff'
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'mock-convention-service-in-actions-repo');
});

test('MockReviewEngine tags findings as mock-rule and uses unified score', async () => {
  const engine = new MockReviewEngine();
  const result = await engine.review({
    scope: 'file',
    workspaceRoot: undefined,
    filePath: 'app/Domain/CreateOrderService.php',
    languageId: 'php',
    label: 'CreateOrderService.php',
    content: '<?php class CreateOrderService { public function handle() {} }',
    projectProfile: {
      workspaceRoot: '/tmp',
      collectedAt: 0,
      stacks: {
        php: emptyPhpStack(),
        javascript: emptyJsStack(),
      },
      signals: [],
      conventions: [
        conv({
          id: 'arch:actions-pattern',
          label: 'Uses Actions',
          confidence: 'high',
          category: 'architecture',
          evidence: ['18 action files under Actions/'],
        }),
      ],
      fingerprint: 'generic',
    },
  });
  assert.ok(result.findings.some((f) => f.code === 'MERGECORE_CONVENTION_DIVERGENCE'));
  assert.ok(result.findings.every((f) => f.source === 'mock-rule'));
  assert.equal(result.score, 9.45);
});
