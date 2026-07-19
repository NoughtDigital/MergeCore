import type { DependencyEdgeKind } from '../../contracts/types';
import type { TaskContextDepth } from '../task-context-types';

/** Hard ceiling — templates cannot raise budgets above these. */
export const TEMPLATE_BUDGET_CEILING = {
  maxFiles: 32,
  maxSymbols: 48,
  maxChunks: 56,
  maxDependencyDepth: 4,
  maxChars: 60_000,
  maxTokensApprox: 15_000,
  k: 40,
} as const;

/** Keys that templates must never set — privacy / validation stay enforced. */
export const TEMPLATE_FORBIDDEN_KEYS = [
  'disable_privacy',
  'disablePrivacy',
  'skip_privacy',
  'skipPrivacy',
  'bypass_privacy',
  'bypassPrivacy',
  'ignore_privacy',
  'ignorePrivacy',
  'skip_source_validation',
  'skipSourceValidation',
  'bypass_source_validation',
  'bypassSourceValidation',
  'allow_never_send',
  'allowNeverSend',
  'for_model_evidence_without_filter',
  'forModelEvidenceWithoutFilter',
] as const;

export type TemplateSourceType =
  | 'source'
  | 'symbol'
  | 'instruction'
  | 'architecture'
  | 'dependency'
  | 'test'
  | 'memory'
  | 'documentation';

export type TemplatePrioritiseHint =
  | 'instructions'
  | 'architecture'
  | 'authentication'
  | 'network_calls'
  | 'database_writes'
  | 'tests'
  | 'integrations'
  | 'routes'
  | 'public_apis'
  | 'callers'
  | 'callees'
  | 'migrations'
  | 'config'
  | 'symptoms'
  | 'coverage';

export interface TemplateRetrievalSettings {
  readonly depth: TaskContextDepth;
  readonly dependencyDepth: number;
  readonly prioritise: readonly TemplatePrioritiseHint[];
  readonly maxFiles?: number;
  readonly maxSymbols?: number;
  readonly maxChunks?: number;
  readonly maxChars?: number;
  readonly k?: number;
}

export interface ContextPackTemplate {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly source: 'builtin' | 'workspace';
  readonly filePath?: string;
  /** Ordered section ids (snake_case). */
  readonly sections: readonly string[];
  readonly retrieval: TemplateRetrievalSettings;
  readonly preferredRelationshipKinds: readonly DependencyEdgeKind[];
  readonly sourceTypes: readonly TemplateSourceType[];
  readonly riskCategories: readonly string[];
  readonly requireTests: boolean;
  readonly prioritiseArchitecture: boolean;
  readonly uncertaintyBlocksCompletion: boolean;
  /** Effective max chars after ceiling clamp. */
  readonly maxContextBudget: number;
  /** Optional free-form body guidance from the Markdown file. */
  readonly bodyGuidance?: string;
}

export interface TemplateParseIssue {
  readonly code:
    | 'malformed'
    | 'missing_sections'
    | 'missing_name'
    | 'privacy_conflict'
    | 'unknown_section'
    | 'budget_clamped'
    | 'forbidden_key';
  readonly message: string;
  readonly path?: string;
}

export interface TemplateParseResult {
  readonly ok: boolean;
  readonly template?: ContextPackTemplate;
  readonly issues: readonly TemplateParseIssue[];
}

export interface TemplatePreview {
  readonly template: ContextPackTemplate;
  readonly retrieval: {
    readonly depth: TaskContextDepth;
    readonly dependencyDepth: number;
    readonly maxFiles: number;
    readonly maxSymbols: number;
    readonly maxChunks: number;
    readonly maxChars: number;
    readonly k: number;
    readonly prioritise: readonly string[];
  };
  readonly sections: readonly string[];
  readonly preferredRelationshipKinds: readonly string[];
  readonly sourceTypes: readonly string[];
  readonly riskCategories: readonly string[];
  readonly requireTests: boolean;
  readonly prioritiseArchitecture: boolean;
  readonly uncertaintyBlocksCompletion: boolean;
  readonly notes: readonly string[];
}

export interface TemplateCustomiseInput {
  readonly baseId: string;
  readonly name?: string;
  readonly id?: string;
  readonly sections?: readonly string[];
  readonly retrieval?: Partial<TemplateRetrievalSettings>;
  readonly preferredRelationshipKinds?: readonly DependencyEdgeKind[];
  readonly sourceTypes?: readonly TemplateSourceType[];
  readonly riskCategories?: readonly string[];
  readonly requireTests?: boolean;
  readonly prioritiseArchitecture?: boolean;
  readonly uncertaintyBlocksCompletion?: boolean;
  readonly maxContextBudget?: number;
  readonly bodyGuidance?: string;
}

export interface ResolveTemplatesOptions {
  readonly workspaceRoot: string;
  /** Override default template id (else workspace default / builtin). */
  readonly templateId?: string;
  /** Partial overrides applied after resolve (customise-without-save). */
  readonly customise?: Partial<TemplateCustomiseInput>;
}
