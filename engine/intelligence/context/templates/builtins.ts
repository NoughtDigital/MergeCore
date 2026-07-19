import type { DependencyEdgeKind } from '../../contracts/types';
import type { ContextPackTemplate, TemplatePrioritiseHint, TemplateSourceType } from './types';
import { TEMPLATE_BUDGET_CEILING } from './types';

function tpl(
  partial: Omit<ContextPackTemplate, 'source' | 'maxContextBudget'> & {
    maxContextBudget?: number;
  }
): ContextPackTemplate {
  const maxContextBudget = Math.min(
    partial.maxContextBudget ??
      partial.retrieval.maxChars ??
      (partial.retrieval.depth === 'deep'
        ? 40_000
        : partial.retrieval.depth === 'shallow'
          ? 10_000
          : 24_000),
    TEMPLATE_BUDGET_CEILING.maxChars
  );
  return {
    ...partial,
    source: 'builtin',
    maxContextBudget,
  };
}

const CALL_IMPORT: readonly DependencyEdgeKind[] = [
  'call',
  'import',
  'require',
  'typeUsage',
  'extends',
  'implements',
];

const SEC_REL: readonly DependencyEdgeKind[] = [
  'call',
  'import',
  'route',
  'integration',
  'fileDependency',
];

const ALL_SRC: readonly TemplateSourceType[] = [
  'source',
  'symbol',
  'instruction',
  'architecture',
  'dependency',
  'test',
];

export const BUILTIN_TEMPLATES: readonly ContextPackTemplate[] = [
  tpl({
    id: 'new-feature',
    name: 'New feature',
    description: 'Scoped feature work: change surface, patterns, tests, and acceptance signals.',
    sections: [
      'task',
      'change_scope',
      'applicable_instructions',
      'relevant_components',
      'related_types_and_dependencies',
      'existing_implementation_patterns',
      'acceptance_signals',
      'tests',
      'risks',
      'inspection_order',
      'uncertainty',
      'sources',
    ],
    retrieval: {
      depth: 'standard',
      dependencyDepth: 2,
      prioritise: ['instructions', 'public_apis', 'tests', 'architecture'],
      maxChars: 24_000,
    },
    preferredRelationshipKinds: CALL_IMPORT,
    sourceTypes: ALL_SRC,
    riskCategories: ['auth', 'payment', 'db-write', 'no-tests'],
    requireTests: true,
    prioritiseArchitecture: true,
    uncertaintyBlocksCompletion: false,
  }),
  tpl({
    id: 'bug-investigation',
    name: 'Bug investigation',
    description: 'Symptom-led debugging: locus, call paths, regressions, and uncertainty.',
    sections: [
      'task',
      'symptoms',
      'reproduction_paths',
      'relevant_components',
      'related_types_and_dependencies',
      'regression_risk',
      'tests',
      'risks',
      'inspection_order',
      'uncertainty',
      'sources',
    ],
    retrieval: {
      depth: 'deep',
      dependencyDepth: 3,
      prioritise: ['callers', 'callees', 'tests', 'symptoms'],
      maxChars: 36_000,
      k: 24,
    },
    preferredRelationshipKinds: ['call', 'import', 'require', 'typeUsage', 'likelyTestCoverage'],
    sourceTypes: ['source', 'symbol', 'dependency', 'test', 'instruction'],
    riskCategories: ['no-tests', 'high-callers', 'network', 'db-write'],
    requireTests: true,
    prioritiseArchitecture: false,
    uncertaintyBlocksCompletion: true,
  }),
  tpl({
    id: 'refactor',
    name: 'Refactor',
    description: 'Safe structural change: coupling, dependents, patterns, and regression risk.',
    sections: [
      'task',
      'refactor_targets',
      'coupling',
      'applicable_instructions',
      'existing_implementation_patterns',
      'tests',
      'regression_risk',
      'inspection_order',
      'uncertainty',
      'sources',
    ],
    retrieval: {
      depth: 'deep',
      dependencyDepth: 3,
      prioritise: ['callers', 'architecture', 'tests'],
      maxChars: 40_000,
    },
    preferredRelationshipKinds: [
      'call',
      'import',
      'export',
      'extends',
      'implements',
      'typeUsage',
      'likelyTestCoverage',
    ],
    sourceTypes: ALL_SRC,
    riskCategories: ['high-callers', 'no-tests'],
    requireTests: true,
    prioritiseArchitecture: true,
    uncertaintyBlocksCompletion: true,
  }),
  tpl({
    id: 'security-review',
    name: 'Security review',
    description: 'Attack surface, trust boundaries, permissions, and data flow.',
    sections: [
      'task',
      'attack_surface',
      'trust_boundaries',
      'permissions',
      'data_flow',
      'applicable_instructions',
      'tests',
      'risks',
      'uncertainty',
      'sources',
    ],
    retrieval: {
      depth: 'deep',
      dependencyDepth: 3,
      prioritise: [
        'instructions',
        'authentication',
        'network_calls',
        'database_writes',
      ] as TemplatePrioritiseHint[],
      maxChars: 40_000,
    },
    preferredRelationshipKinds: SEC_REL,
    sourceTypes: ['source', 'symbol', 'instruction', 'architecture', 'dependency', 'test'],
    riskCategories: ['auth', 'network', 'db-write', 'env', 'crypto', 'fs-write'],
    requireTests: true,
    prioritiseArchitecture: true,
    uncertaintyBlocksCompletion: true,
  }),
  tpl({
    id: 'dependency-upgrade',
    name: 'Dependency upgrade',
    description: 'Upgrade surface, importers, breaking-change watchlist, and tests.',
    sections: [
      'task',
      'upgrade_surface',
      'breaking_changes',
      'consumers',
      'tests',
      'risks',
      'inspection_order',
      'uncertainty',
      'sources',
    ],
    retrieval: {
      depth: 'standard',
      dependencyDepth: 3,
      prioritise: ['callers', 'integrations', 'tests', 'config'],
      maxChars: 28_000,
    },
    preferredRelationshipKinds: ['import', 'require', 'export', 'call', 'integration'],
    sourceTypes: ['source', 'dependency', 'test', 'instruction', 'symbol'],
    riskCategories: ['network', 'payment', 'no-tests', 'high-callers'],
    requireTests: true,
    prioritiseArchitecture: false,
    uncertaintyBlocksCompletion: true,
  }),
  tpl({
    id: 'api-change',
    name: 'API change',
    description: 'Public contract, consumers, routes, and compatibility risks.',
    sections: [
      'task',
      'api_contract',
      'consumers',
      'related_types_and_dependencies',
      'applicable_instructions',
      'tests',
      'risks',
      'inspection_order',
      'uncertainty',
      'sources',
    ],
    retrieval: {
      depth: 'standard',
      dependencyDepth: 3,
      prioritise: ['public_apis', 'routes', 'callers', 'tests'],
      maxChars: 28_000,
    },
    preferredRelationshipKinds: ['export', 'call', 'import', 'route', 'typeUsage'],
    sourceTypes: ALL_SRC,
    riskCategories: ['auth', 'high-callers', 'no-tests'],
    requireTests: true,
    prioritiseArchitecture: true,
    uncertaintyBlocksCompletion: true,
  }),
  tpl({
    id: 'database-migration',
    name: 'Database migration',
    description: 'Schema impact, write paths, rollback risks, and migration order.',
    sections: [
      'task',
      'schema_impact',
      'data_flow',
      'migration_steps',
      'applicable_instructions',
      'tests',
      'risks',
      'uncertainty',
      'sources',
    ],
    retrieval: {
      depth: 'deep',
      dependencyDepth: 3,
      prioritise: ['database_writes', 'migrations', 'tests', 'instructions'],
      maxChars: 36_000,
    },
    preferredRelationshipKinds: ['call', 'import', 'fileDependency', 'likelyTestCoverage'],
    sourceTypes: ['source', 'symbol', 'instruction', 'dependency', 'test'],
    riskCategories: ['db-write', 'no-tests', 'env'],
    requireTests: true,
    prioritiseArchitecture: true,
    uncertaintyBlocksCompletion: true,
  }),
  tpl({
    id: 'integration-implementation',
    name: 'Integration implementation',
    description: 'External providers, contracts, network/auth risks, and tests.',
    sections: [
      'task',
      'integration_points',
      'external_contracts',
      'data_flow',
      'applicable_instructions',
      'tests',
      'risks',
      'inspection_order',
      'uncertainty',
      'sources',
    ],
    retrieval: {
      depth: 'deep',
      dependencyDepth: 3,
      prioritise: ['integrations', 'network_calls', 'authentication', 'instructions'],
      maxChars: 36_000,
    },
    preferredRelationshipKinds: ['integration', 'import', 'call', 'event', 'route'],
    sourceTypes: ALL_SRC,
    riskCategories: ['network', 'auth', 'payment', 'env', 'crypto'],
    requireTests: true,
    prioritiseArchitecture: true,
    uncertaintyBlocksCompletion: true,
  }),
  tpl({
    id: 'test-coverage',
    name: 'Test coverage',
    description: 'Coverage gaps, test targets, and related production code.',
    sections: [
      'task',
      'test_targets',
      'coverage_gaps',
      'relevant_components',
      'related_types_and_dependencies',
      'tests',
      'inspection_order',
      'uncertainty',
      'sources',
    ],
    retrieval: {
      depth: 'standard',
      dependencyDepth: 2,
      prioritise: ['tests', 'coverage', 'callers'],
      maxChars: 24_000,
    },
    preferredRelationshipKinds: ['likelyTestCoverage', 'call', 'import'],
    sourceTypes: ['test', 'source', 'symbol', 'dependency'],
    riskCategories: ['no-tests'],
    requireTests: true,
    prioritiseArchitecture: false,
    uncertaintyBlocksCompletion: false,
  }),
  tpl({
    id: 'onboarding-code-explanation',
    name: 'Onboarding and code explanation',
    description: 'Map the subsystem, walk key code, and surface architecture notes.',
    sections: [
      'task',
      'onboarding_map',
      'architecture_notes',
      'code_walkthrough',
      'applicable_instructions',
      'existing_implementation_patterns',
      'tests',
      'inspection_order',
      'uncertainty',
      'sources',
    ],
    retrieval: {
      depth: 'standard',
      dependencyDepth: 2,
      prioritise: ['architecture', 'instructions', 'public_apis'],
      maxChars: 28_000,
    },
    preferredRelationshipKinds: ['import', 'call', 'export', 'documentation', 'route'],
    sourceTypes: ['instruction', 'architecture', 'source', 'symbol', 'documentation', 'test'],
    riskCategories: [],
    requireTests: false,
    prioritiseArchitecture: true,
    uncertaintyBlocksCompletion: false,
  }),
];

export function getBuiltinTemplate(id: string): ContextPackTemplate | undefined {
  const key = id.trim().toLowerCase();
  return BUILTIN_TEMPLATES.find((t) => t.id === key || slugifyName(t.name) === key);
}

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function listBuiltinTemplates(): readonly ContextPackTemplate[] {
  return BUILTIN_TEMPLATES;
}
