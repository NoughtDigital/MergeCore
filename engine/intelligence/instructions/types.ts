/**
 * Context-document and scoped-instruction contracts.
 */

export type ContextDocumentType =
  | 'instruction'
  | 'architecture'
  | 'decision'
  | 'convention'
  | 'integration'
  | 'glossary'
  | 'risk'
  | 'general_documentation'
  | 'generated_memory';

export type AuthoredBy = 'human' | 'generated';

export type ClassificationConfidence = 'high' | 'medium' | 'low';

/** How binding an instruction is for agent behaviour. */
export type InstructionBinding = 'binding' | 'contextual' | 'generated';

export interface ContextDocumentFrontmatter {
  readonly raw?: string;
  readonly globs?: readonly string[];
  readonly description?: string;
  readonly alwaysApply?: boolean;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** A discovered context / instruction document on disk. */
export interface ContextDocument {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly documentType: ContextDocumentType;
  readonly scope: string;
  readonly authored: AuthoredBy;
  readonly classificationConfidence: ClassificationConfidence;
  readonly binding: InstructionBinding;
  /** Explicit user-configured path (highest precedence class). */
  readonly userConfigured: boolean;
  readonly frontmatter?: ContextDocumentFrontmatter;
  readonly contentHash: string;
  readonly startLine: number;
  readonly endLine: number;
}

/** Markdown section with heading ancestry preserved. */
export interface MarkdownSection {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly headingAncestry: readonly string[];
  readonly level: number;
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * A single applicable instruction (or contextual note) for a target file.
 * Precedence is higher for closer / more binding sources.
 */
export interface ApplicableInstruction {
  readonly id: string;
  readonly text: string;
  readonly sourceFile: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly scope: string;
  readonly documentType: ContextDocumentType;
  readonly precedence: number;
  readonly authored: AuthoredBy;
  readonly classificationConfidence: ClassificationConfidence;
  readonly binding: InstructionBinding;
  readonly headingAncestry: readonly string[];
  readonly userConfigured: boolean;
  readonly frontmatter?: ContextDocumentFrontmatter;
  readonly excerpt?: string;
}

export interface InstructionConflict {
  readonly topic: string;
  readonly reason: string;
  readonly instructions: readonly ApplicableInstruction[];
}

export interface InstructionPrecedenceExplanation {
  readonly targetFile: string;
  readonly ordered: readonly ApplicableInstruction[];
  readonly rationale: readonly string[];
  readonly conflicts: readonly InstructionConflict[];
}

export interface InstructionResolverOptions {
  readonly workspaceRoot: string;
  /** Additional workspace roots (multi-root). */
  readonly workspaceRoots?: readonly string[];
  /** User-configured Markdown paths (relative to a workspace root). */
  readonly configuredPaths?: readonly string[];
  /** MergeCore context directory relative name (default `.mergecore/context`). */
  readonly contextDirectory?: string;
  /** Pre-loaded documents; when omitted, discovery runs against disk. */
  readonly documents?: readonly ContextDocument[];
  /** Optional pre-parsed sections keyed by path. */
  readonly sectionsByPath?: ReadonlyMap<string, readonly MarkdownSection[]>;
}
