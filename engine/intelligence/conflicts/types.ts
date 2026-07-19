/**
 * Conservative instruction↔implementation conflict detection.
 * Findings always require documented rule evidence and observed code evidence.
 */

export type ConflictDetectorKind =
  | 'forbidden_imports'
  | 'required_abstraction'
  | 'prohibited_directory_deps'
  | 'naming_rules'
  | 'required_test_location'
  | 'direct_database_access'
  | 'network_provider_access'
  | 'environment_variable_access';

export type ConflictConfidence = 'high' | 'medium' | 'low';

export type ExtractedRuleStatus = 'pending' | 'confirmed' | 'disabled' | 'edited';

export interface ConflictRuleSource {
  readonly path: string;
  readonly line?: number;
  readonly startLine?: number;
  readonly endLine?: number;
}

/** Structured, user-authored or confirmed rule (scannable). */
export interface ConflictRule {
  readonly id: string;
  readonly description: string;
  readonly appliesTo: readonly string[];
  readonly enabled: boolean;
  readonly detector: ConflictDetectorKind;
  readonly forbiddenImports?: readonly string[];
  /** Specifiers / symbols that must appear when the path matches. */
  readonly requiredAbstractions?: readonly string[];
  /** Directory prefixes that must not be imported from appliesTo paths. */
  readonly prohibitedDirectories?: readonly string[];
  /** Basename must match this regex (source string). */
  readonly namingPattern?: string;
  /** When true, namingPattern is a "must match"; when false, "must not match". */
  readonly namingMustMatch?: boolean;
  /** Expected test path globs (for example colocated *.test.ts or under tests/). */
  readonly requiredTestGlobs?: readonly string[];
  /** Identifiers / import stubs indicating direct DB access. */
  readonly databaseAccessPatterns?: readonly string[];
  /** Identifiers / import stubs for network providers. */
  readonly networkProviderPatterns?: readonly string[];
  /** Env var name patterns (e.g. process.env.FOO or getenv("FOO")). */
  readonly environmentVariablePatterns?: readonly string[];
  readonly source?: ConflictRuleSource;
  /** True when the rule was confirmed from an extracted instruction. */
  readonly userConfirmed: boolean;
}

/** Candidate extracted from an instruction document — not active until confirmed. */
export interface ExtractedConflictRule {
  readonly id: string;
  readonly status: ExtractedRuleStatus;
  readonly originalText: string;
  readonly description: string;
  readonly source: ConflictRuleSource & {
    readonly startLine: number;
    readonly endLine: number;
  };
  readonly appliesTo: readonly string[];
  readonly suggestedDetector?: ConflictDetectorKind;
  readonly suggestedFields?: Partial<
    Pick<
      ConflictRule,
      | 'forbiddenImports'
      | 'requiredAbstractions'
      | 'prohibitedDirectories'
      | 'namingPattern'
      | 'namingMustMatch'
      | 'requiredTestGlobs'
      | 'databaseAccessPatterns'
      | 'networkProviderPatterns'
      | 'environmentVariablePatterns'
    >
  >;
  /** Ambiguous / prose — kept for review but never auto-scanned. */
  readonly ambiguous: boolean;
  readonly fromGeneratedMemory: boolean;
}

export interface ConflictCodeEvidence {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly excerpt: string;
  readonly detail: string;
}

export interface ContextConflictFinding {
  readonly id: string;
  readonly message: string;
  readonly rule: ConflictRule;
  readonly detector: ConflictDetectorKind;
  readonly confidence: ConflictConfidence;
  readonly documentedRule: {
    readonly text: string;
    readonly path: string;
    readonly startLine: number;
    readonly endLine: number;
  };
  readonly observedCode: readonly ConflictCodeEvidence[];
  readonly affectedFiles: readonly string[];
  readonly userConfirmed: boolean;
  readonly ignored: boolean;
}

export interface ContextConflictScanResult {
  readonly workspaceRoot: string;
  readonly findings: readonly ContextConflictFinding[];
  readonly rulesScanned: number;
  readonly extractedPending: number;
  readonly notes: readonly string[];
}

export interface ConflictIgnoreEntry {
  readonly conflictId: string;
  readonly ruleId: string;
  readonly paths?: readonly string[];
  readonly ignoredAt: string;
  readonly reason?: string;
}
