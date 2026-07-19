/**
 * Known section ids → display titles and content buckets used by the assembler.
 */

export interface SectionDefinition {
  readonly id: string;
  readonly title: string;
  /** Which evidence bag(s) feed this section. */
  readonly contentKeys: readonly string[];
}

export const SECTION_CATALOG: Readonly<Record<string, SectionDefinition>> = {
  task: { id: 'task', title: 'Task', contentKeys: ['task'] },
  repository_understanding: {
    id: 'repository_understanding',
    title: 'Repository understanding',
    contentKeys: ['understanding'],
  },
  applicable_instructions: {
    id: 'applicable_instructions',
    title: 'Applicable instructions',
    contentKeys: ['instructions'],
  },
  relevant_components: {
    id: 'relevant_components',
    title: 'Relevant components',
    contentKeys: ['components'],
  },
  related_types_and_dependencies: {
    id: 'related_types_and_dependencies',
    title: 'Related types and dependencies',
    contentKeys: ['dependencies', 'callers'],
  },
  existing_implementation_patterns: {
    id: 'existing_implementation_patterns',
    title: 'Existing implementation patterns',
    contentKeys: ['patterns'],
  },
  tests: {
    id: 'tests',
    title: 'Tests likely affected',
    contentKeys: ['tests'],
  },
  risks: {
    id: 'risks',
    title: 'Risks and edge cases',
    contentKeys: ['risks'],
  },
  inspection_order: {
    id: 'inspection_order',
    title: 'Suggested inspection order',
    contentKeys: ['inspection'],
  },
  uncertainty: {
    id: 'uncertainty',
    title: 'Uncertainty',
    contentKeys: ['uncertainty'],
  },
  sources: {
    id: 'sources',
    title: 'Sources',
    contentKeys: ['sources'],
  },
  // Feature
  change_scope: {
    id: 'change_scope',
    title: 'Change scope',
    contentKeys: ['understanding', 'components'],
  },
  acceptance_signals: {
    id: 'acceptance_signals',
    title: 'Acceptance signals',
    contentKeys: ['task', 'tests', 'inspection'],
  },
  // Bug investigation
  symptoms: {
    id: 'symptoms',
    title: 'Symptoms and likely locus',
    contentKeys: ['understanding', 'components'],
  },
  reproduction_paths: {
    id: 'reproduction_paths',
    title: 'Reproduction and call paths',
    contentKeys: ['dependencies', 'callers', 'inspection'],
  },
  regression_risk: {
    id: 'regression_risk',
    title: 'Regression risk',
    contentKeys: ['risks', 'tests'],
  },
  // Refactor
  refactor_targets: {
    id: 'refactor_targets',
    title: 'Refactor targets',
    contentKeys: ['components', 'patterns'],
  },
  coupling: {
    id: 'coupling',
    title: 'Coupling and dependents',
    contentKeys: ['dependencies', 'callers'],
  },
  // Security
  attack_surface: {
    id: 'attack_surface',
    title: 'Attack surface',
    contentKeys: ['components', 'risks'],
  },
  trust_boundaries: {
    id: 'trust_boundaries',
    title: 'Trust boundaries',
    contentKeys: ['understanding', 'instructions'],
  },
  permissions: {
    id: 'permissions',
    title: 'Permissions and auth',
    contentKeys: ['risks', 'instructions'],
  },
  data_flow: {
    id: 'data_flow',
    title: 'Data flow',
    contentKeys: ['dependencies', 'callers'],
  },
  // Dependency upgrade
  upgrade_surface: {
    id: 'upgrade_surface',
    title: 'Upgrade surface',
    contentKeys: ['dependencies', 'components'],
  },
  breaking_changes: {
    id: 'breaking_changes',
    title: 'Breaking-change watchlist',
    contentKeys: ['risks', 'callers', 'tests'],
  },
  // API change
  api_contract: {
    id: 'api_contract',
    title: 'API contract',
    contentKeys: ['components', 'patterns'],
  },
  consumers: {
    id: 'consumers',
    title: 'Consumers and callers',
    contentKeys: ['callers', 'dependencies'],
  },
  // Database migration
  schema_impact: {
    id: 'schema_impact',
    title: 'Schema impact',
    contentKeys: ['components', 'understanding'],
  },
  migration_steps: {
    id: 'migration_steps',
    title: 'Migration inspection order',
    contentKeys: ['inspection', 'risks'],
  },
  // Integration
  integration_points: {
    id: 'integration_points',
    title: 'Integration points',
    contentKeys: ['dependencies', 'components', 'risks'],
  },
  external_contracts: {
    id: 'external_contracts',
    title: 'External contracts',
    contentKeys: ['instructions', 'patterns'],
  },
  // Test coverage
  coverage_gaps: {
    id: 'coverage_gaps',
    title: 'Coverage gaps',
    contentKeys: ['tests', 'uncertainty'],
  },
  test_targets: {
    id: 'test_targets',
    title: 'Test targets',
    contentKeys: ['components', 'inspection'],
  },
  // Onboarding
  onboarding_map: {
    id: 'onboarding_map',
    title: 'Onboarding map',
    contentKeys: ['understanding', 'instructions'],
  },
  code_walkthrough: {
    id: 'code_walkthrough',
    title: 'Code walkthrough',
    contentKeys: ['components', 'patterns', 'dependencies'],
  },
  architecture_notes: {
    id: 'architecture_notes',
    title: 'Architecture notes',
    contentKeys: ['instructions', 'understanding'],
  },
};

export const CORE_SECTION_IDS = [
  'task',
  'repository_understanding',
  'applicable_instructions',
  'relevant_components',
  'related_types_and_dependencies',
  'existing_implementation_patterns',
  'tests',
  'risks',
  'inspection_order',
  'uncertainty',
  'sources',
] as const;

export function sectionTitle(id: string): string {
  return SECTION_CATALOG[id]?.title ?? humaniseSectionId(id);
}

export function humaniseSectionId(id: string): string {
  return id
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function isKnownSectionId(id: string): boolean {
  return Boolean(SECTION_CATALOG[id]);
}
