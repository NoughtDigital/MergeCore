/**
 * Shared data contracts for MergeCore V0.1+.
 * Pure TypeScript types — no runtime dependencies.
 */

/** How a source reference was obtained. */
export type SourceType =
  | 'source'
  | 'symbol'
  | 'dependency'
  | 'memory'
  | 'config'
  | 'instruction'
  | 'lexical';

/** Why a path was excluded from indexing. */
export type ExclusionReason =
  | 'gitignore'
  | 'mergecoreignore'
  | 'default-exclude'
  | 'binary'
  | 'oversized'
  | 'symlink-escape'
  | 'unsupported'
  | 'temp-file'
  | 'cancelled'
  | 'privacy-rule'
  | 'global-exclusion'
  | 'workspace-exclusion'
  | 'language-exclusion';

export interface ExclusionRecord {
  readonly path: string;
  readonly reason: ExclusionReason;
  readonly detail?: string;
}

/**
 * Per-path privacy classification for indexing and model transmission.
 * Stronger classifications must not be weakened by nested config without confirmation.
 */
export type PrivacyClassification =
  | 'normal'
  | 'local_only'
  | 'metadata_only'
  | 'never_index'
  | 'never_send_to_model';

/** Where a privacy rule was defined. */
export type PrivacyRuleSource =
  | 'global'
  | 'workspace'
  | 'mergecoreignore'
  | 'gitignore'
  | 'vscode'
  | 'default'
  | 'override';

export interface PrivacyRule {
  readonly pattern: string;
  readonly classification: PrivacyClassification;
  /** When true, pattern is an inclusion that sets normal if no stronger rule applies. */
  readonly include?: boolean;
  readonly languages?: readonly string[];
  readonly extensions?: readonly string[];
  readonly source: PrivacyRuleSource;
  /** Absolute or workspace-relative path of the defining file, when known. */
  readonly rulePath?: string;
}

/**
 * Resolved privacy decision for a single path.
 * Hosts must honour allowsModelEvidence before any outbound pack.
 */
export interface PrivacyDecision {
  readonly path: string;
  readonly classification: PrivacyClassification;
  readonly matchedPattern?: string;
  readonly ruleSource: PrivacyRuleSource;
  readonly rulePath?: string;
  readonly exclusionReason?: ExclusionReason;
  readonly allowsRetrieval: boolean;
  readonly allowsModelEvidence: boolean;
  readonly allowsContentStorage: boolean;
  readonly allowsSymbolIndex: boolean;
  readonly included: boolean;
  readonly detail?: string;
}

/** High-level workspace identity used by hosts and the public API. */
export interface WorkspaceDescriptor {
  readonly rootPath: string;
  readonly displayName: string;
  readonly fingerprint: string;
  readonly indexedAt?: number;
  readonly languages: readonly string[];
}

/** Content fingerprint for a single file. */
export interface FileFingerprint {
  readonly path: string;
  readonly contentHash: string;
  readonly mtimeMs: number;
  readonly byteLength?: number;
}

export type ParseStatus = 'ok' | 'skipped' | 'error' | 'unchanged';

/** Indexed file metadata. */
export interface FileRecord {
  readonly workspaceId: string;
  readonly path: string;
  readonly fingerprint: FileFingerprint;
  readonly language: string;
  readonly byteLength: number;
  readonly mtimeMs: number;
  readonly contentHash: string;
  readonly indexedAt: number;
  readonly parseStatus: ParseStatus;
  readonly chunkIds: readonly string[];
  readonly symbolIds?: readonly string[];
  /** Privacy classification applied when the file was indexed. */
  readonly privacy?: PrivacyClassification;
}

/** Location of a symbol within a file (1-based lines). */
export interface SymbolLocation {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn?: number;
  readonly endColumn?: number;
}

/** Parameter on a function / method / constructor symbol. */
export interface SymbolParameter {
  readonly name: string;
  readonly typeText?: string;
  readonly optional?: boolean;
  readonly rest?: boolean;
}

/** First-class symbol extracted by a language adapter or compiler graph. */
export interface SymbolRecord {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly location: SymbolLocation;
  readonly exported?: boolean;
  readonly containerName?: string;
  readonly language: string;
  /**
   * Stable id of the LanguageAdapter (or compiler-backed adapter) that
   * produced this symbol. Required for multi-language workspaces.
   */
  readonly adapterId: string;
  readonly parameters?: readonly SymbolParameter[];
  /** Doc-comment summary (JSDoc, PHPDoc, etc.). */
  readonly jsdocSummary?: string;
  readonly returnTypeText?: string;
  readonly signatureText?: string;
  readonly overloadIndex?: number;
}

/**
 * How a graph edge was resolved.
 * Prefer language-neutral values (`compiler`, `ast`, `convention`) for new code.
 * TypeScript-specific aliases remain valid for stored indexes and hosts.
 */
export type EdgeResolutionMethod =
  | 'compiler'
  | 'ast'
  | 'convention'
  | 'typescript-checker'
  | 'typescript-ast'
  | 'path-alias'
  | 'naming-heuristic'
  | 'import-graph'
  | 'unresolved'
  | 'heuristic';

/** Resolution methods treated as deterministic analysis (not convention heuristics). */
export const DETERMINISTIC_EDGE_RESOLUTION: ReadonlySet<EdgeResolutionMethod> =
  new Set([
    'compiler',
    'ast',
    'typescript-checker',
    'typescript-ast',
    'path-alias',
    'import-graph',
  ]);

export function isDeterministicEdgeResolution(
  method: EdgeResolutionMethod | undefined
): boolean {
  return method !== undefined && DETERMINISTIC_EDGE_RESOLUTION.has(method);
}

/** Confidence that a graph edge is correct. */
export type EdgeConfidence = 'certain' | 'high' | 'medium' | 'low' | 'heuristic';

/** Relationship kinds stored on dependency / code-graph edges. */
export type DependencyEdgeKind =
  | 'import'
  | 'require'
  | 'export'
  | 'reference'
  | 'call'
  | 'extends'
  | 'implements'
  | 'typeUsage'
  | 'fileDependency'
  | 'likelyTestCoverage'
  | 'route'
  | 'job'
  | 'event'
  | 'integration'
  | 'documentation';

/** Import / require / dependency / code-graph relationship. */
export interface DependencyEdge {
  readonly id: string;
  readonly fromPath: string;
  readonly toPath: string;
  readonly kind: DependencyEdgeKind;
  readonly specifier: string;
  readonly fromSymbol?: string;
  readonly toSymbol?: string;
  readonly startLine?: number;
  readonly startColumn?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly confidence?: EdgeConfidence;
  readonly resolutionMethod?: EdgeResolutionMethod;
  readonly evidence?: readonly string[];
}

/** Indexed text chunk used for lexical retrieval. */
export interface DocumentChunk {
  readonly id: string;
  readonly path: string;
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly kind: 'source' | 'memory' | 'config';
  readonly symbol?: string;
  readonly weight: number;
  readonly fileHash: string;
}

/** Discovered instruction / memory document (README, AGENTS.md, etc.). */
export interface InstructionDocument {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly kind: 'readme' | 'agents' | 'rules' | 'architecture' | 'other';
  readonly rules: readonly InstructionRule[];
  readonly source: SourceReference;
}

/** A single guidance rule extracted from an instruction document. */
export interface InstructionRule {
  readonly id: string;
  readonly text: string;
  readonly source: SourceReference;
}

/** Whether the source document was written by a human or generated. */
export type SourceAuthored = 'human' | 'generated';

/** How the reference was extracted from the repository. */
export type SourceExtraction = 'deterministic' | 'heuristic';

/**
 * Evidence pointer for a factual claim about the repository.
 * Relative paths use forward slashes; workspaceId scopes multi-root workspaces.
 */
export interface SourceReference {
  readonly workspaceId: string;
  /** Workspace-relative path (POSIX separators). */
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn?: number;
  readonly endColumn?: number;
  readonly sourceType: SourceType;
  /** Content hash (or other fingerprint) of the supporting file at capture time. */
  readonly sourceFingerprint: string;
  readonly symbolId?: string;
  /** Display name for the symbol when useful. */
  readonly symbol?: string;
  readonly authored: SourceAuthored;
  readonly extraction: SourceExtraction;
  readonly excerpt?: string;
  /** Stable id when packaged as model evidence (e.g. evidence-12). */
  readonly evidenceId?: string;
}

/** Normalised confidence band — not a calibrated probability. */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** Ordinal certainty for a single confidence component. */
export type ComponentCertainty = 'certain' | 'high' | 'medium' | 'low' | 'none';

/** Freshness of supporting source files relative to captured fingerprints. */
export type SourceFreshness = 'fresh' | 'stale' | 'missing' | 'unknown';

/**
 * Explainable confidence components. Diagnostic scores derived from these
 * are not statistical probabilities unless explicitly calibrated elsewhere.
 */
export interface ConfidenceComponents {
  readonly parserCertainty?: ComponentCertainty;
  readonly symbolResolutionCertainty?: ComponentCertainty;
  readonly dependencyResolutionCertainty?: ComponentCertainty;
  readonly documentClassificationCertainty?: ComponentCertainty;
  readonly instructionScopeCertainty?: ComponentCertainty;
  readonly independentSourceCount?: number;
  readonly sourceFreshness?: SourceFreshness;
  readonly modelGenerated?: boolean;
}

export interface ClaimConfidence {
  readonly level: ConfidenceLevel;
  readonly components: ConfidenceComponents;
  readonly rationale: readonly string[];
  /**
   * Optional diagnostic aggregate for tooling only.
   * Must never be presented as a calibrated probability.
   */
  readonly diagnosticScore?: number;
}

/**
 * One evidence-backed claim returned by retrieval / hosts.
 * Repository facts require ≥1 SourceReference; otherwise set generalConsideration.
 */
export interface ContextClaim {
  readonly id: string;
  readonly text: string;
  readonly confidence: ConfidenceLevel;
  readonly confidenceDetail: ClaimConfidence;
  readonly references: readonly SourceReference[];
  /**
   * When true, the statement is a general consideration — not a repository fact.
   * Required when references is empty.
   */
  readonly generalConsideration?: boolean;
  /** Legacy retrieval rank — not a probability. Prefer confidenceDetail. */
  readonly score?: number;
}

/** Result of a retrieve query. */
export interface ContextResult {
  readonly workspaceRoot: string;
  readonly query: string;
  readonly claims: readonly ContextClaim[];
  readonly references: readonly SourceReference[];
  readonly incomplete: boolean;
  readonly notes?: readonly string[];
}

/** Assembled pack of claims and instruction context for agents/UI. */
export interface ContextPack {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly query: string;
  readonly createdAt: number;
  readonly claims: readonly ContextClaim[];
  readonly instructions: readonly InstructionDocument[];
  readonly references: readonly SourceReference[];
  readonly incomplete: boolean;
  /** Ranked relationship paths explaining how evidence connects (optional). */
  readonly relationshipPaths?: readonly RelationshipPath[];
}

/** A node on an explainable relationship path. */
export interface RelationshipPathNode {
  readonly symbolId?: string;
  readonly name?: string;
  readonly path: string;
  readonly kind?: string;
}

/** One hop on a relationship path, with source evidence. */
export interface RelationshipPathStep {
  readonly node: RelationshipPathNode;
  /** Edge used to enter this node from the previous step (absent for the seed). */
  readonly edge?: DependencyEdge;
  readonly evidence: readonly SourceReference[];
}

/** A ranked, bounded path through the repository graph. */
export interface RelationshipPath {
  readonly id: string;
  readonly steps: readonly RelationshipPathStep[];
  readonly score: number;
  readonly reasons: readonly string[];
  readonly confidence: EdgeConfidence;
  readonly deterministic: boolean;
  readonly cycleClosed?: boolean;
}

export type TraverseDirection = 'outgoing' | 'incoming' | 'both';

export type TraverseWeightProfile = 'impact' | 'entry' | 'tests' | 'default';

export interface TraverseStopWhen {
  readonly hitEntryPoint?: boolean;
  readonly hitTest?: boolean;
  readonly hitIntegration?: boolean;
  readonly hitInstruction?: boolean;
}

/** Budgets and filters for bounded relationship traversal. */
export interface TraverseBudget {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxPaths?: number;
  readonly maxFanOutPerNode?: number;
  readonly hubDegreeTruncate?: number;
  readonly kinds?: readonly DependencyEdgeKind[];
  readonly direction?: TraverseDirection;
  readonly minConfidence?: EdgeConfidence;
  readonly stopWhen?: TraverseStopWhen;
  readonly weightProfile?: TraverseWeightProfile;
}

export interface ChangeImpactTarget {
  readonly symbolId?: string;
  readonly path?: string;
}

export interface ChangeImpactNode {
  readonly symbolId?: string;
  readonly name?: string;
  readonly path: string;
  readonly reason: string;
  readonly confidence: EdgeConfidence;
}

/** Likely impact of changing a symbol or file — not a guarantee. */
export interface ChangeImpactReport {
  readonly target: ChangeImpactTarget;
  readonly workspaceRoot: string;
  readonly directlyAffected: readonly ChangeImpactNode[];
  readonly likelyDownstream: readonly RelationshipPath[];
  readonly relatedTests: readonly ChangeImpactNode[];
  readonly publicInterfaces: readonly ChangeImpactNode[];
  readonly externalIntegrations: readonly ChangeImpactNode[];
  readonly applicableRules: readonly ApplicableInstructionRef[];
  readonly uncertainDynamic: readonly ChangeImpactNode[];
  readonly notes: readonly string[];
}

/** Lightweight instruction pointer for impact reports (avoids circular imports). */
export interface ApplicableInstructionRef {
  readonly id: string;
  readonly text: string;
  readonly sourceFile: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly binding?: string;
}

/** Progress phases emitted during indexing. */
export type IndexPhase =
  | 'idle'
  | 'scanning'
  | 'chunking'
  | 'embedding'
  | 'persisting'
  | 'done'
  | 'cancelled'
  | 'error';

/** Parse / analysis diagnostic produced by a language adapter (not a linter). */
export interface AdapterDiagnostic {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly code?: string;
}

/** Status of the local repository index. */
export interface IndexStatus {
  readonly workspaceRoot: string;
  readonly workspaceId: string;
  readonly ready: boolean;
  readonly busy: boolean;
  readonly phase: IndexPhase;
  readonly fileCount: number;
  readonly chunkCount: number;
  readonly symbolCount: number;
  readonly edgeCount: number;
  readonly filesIndexed: number;
  readonly filesSkipped: number;
  readonly filesPending: number;
  readonly storeDir: string;
  readonly hasSqlite: boolean;
  readonly schemaVersion: number;
  readonly cancellable: boolean;
  readonly updatedAt?: number;
  readonly fingerprint?: string;
  readonly lastError?: string;
  readonly exclusions?: readonly ExclusionRecord[];
  /**
   * Recent adapter diagnostics from the latest index pass (capped).
   * Not persisted to SQLite — status/debug channel only.
   */
  readonly diagnostics?: readonly AdapterDiagnostic[];
}
